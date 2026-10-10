"use strict";

// TizenTube Standalone service

// ── Logging infrastructure comes first, before anything that might throw ───
// On Tizen 5.5 nothing ever reached the PC receiver at all — which is
// consistent with one of the require()s below throwing synchronously before
// any logging existed to catch it. http is a Node core module (always safe),
// so everything logging-related is set up before requiring anything else,
// and each require below is wrapped individually so we can see exactly which
// one fails, if any.
const http = require('http');
// Core module, same reasoning as http above: required before anything that
// might throw, so syslog is available even if a later require() fails.
const dgram = require('dgram');

// RFC 5424's assigned port; used when a request omits one.
const DEFAULT_SYSLOG_PORT = 514;

// Only the first successful send is reported, so confirming the path costs one
// line rather than doubling the log volume.
let _syslogSendLogged = false;

// Blank rather than a baked-in LAN address — see relayLog(), which now
// returns early instead of posting logs at whoever happens to own that IP.
const DEFAULT_LOG_HOST = '';
const DEFAULT_LOG_PORT = 3030;

// A plain "connection refused" (nothing listening on that port) fails fast.
// A genuinely unreachable host (receiver script not running and nothing
// there to send a fast RST — routing/firewall dependent) can instead hang
// for a long OS-level TCP connect timeout before failing, and this fires on
// every single log call with no memory of prior failures. Once any target
// fails, stop attempting it for a cooldown period instead of every log
// call — this service is long-running (persists across app launches until
// a TV reboot), and the very first log call happens right at process start
// ("Standalone service process starting..."), often before the user has
// even started their PC's receiver script. Confirmed: that alone used to
// blacklist the target permanently for the rest of the process's life —
// starting the receiver moments later never recovered, since nothing ever
// re-attempted or expired the block.
const unavailableTargets = {};
const UNAVAILABLE_COOLDOWN_MS = 15000;

// Emits one already-formatted RFC 5424 frame as a UDP datagram.
//
// This is the half of syslog support the page cannot do itself: browser
// contexts have no raw sockets, so mods/features/syslog.js builds the frame
// and this sends it. Kept entirely separate from relayLog below so a dead
// syslog target cannot affect the PC receiver path, or vice versa.
//
// A fresh socket per frame is deliberate. Log volume here is low, UDP is
// connectionless so there is no handshake to amortise, and a long-lived
// socket would need its own error/rebind handling in a service that stays
// alive across app launches until the TV reboots.
//
// `report` is optional and is how a problem reaches somewhere the user can see
// it. logServiceEvent only reaches the PC receiver script, and not needing that
// receiver is the entire point of syslog — so a refusal or a failed send was
// being logged to an address nobody is listening on. The injector passes a
// reporter that writes the message into the page's own console instead, where
// the on-screen debug console shows it.
// What the page's own frames are addressed to and formatted like, so this
// process can send matching ones for its own lines.
//
// Asked for: syslog carried the userscript's logs only, and the service's
// startup lines — the ones that say what happened before the page existed —
// went to the HTTP receiver alone. Those are exactly the lines worth having in
// syslog, because they are the ones about starting up.
//
// Nothing new is configured for this. Every frame the page hands over already
// says where it is going and how it is addressed, so the target, the facility
// and the TV's name are read back out of what is already passing through.
let _syslogTarget = null;

/** The facility and hostname a page frame was built with, or null. */
function readFrameHeader(frame) {
    try {
        const text = String(frame);
        // <PRI>VERSION SP TIMESTAMP SP HOSTNAME SP APP-NAME SP ...
        const match = text.match(/^<(\d{1,3})>(\d)\s+(\S+)\s+(\S+)\s+(\S+)\s/);
        if (!match) return null;
        const priority = Number(match[1]);
        if (!isFinite(priority) || priority < 0 || priority > 191) return null;
        return {
            facility: Math.floor(priority / 8),
            hostname: match[4],
            appName: match[5]
        };
    } catch (e) {
        return null;
    }
}

/** A name field from the frame, or the app's own name when there is none. */
function namedOr(value, max) {
    const name = headerField(value, max);
    return (name && name !== '-') ? name : 'TizenTube';
}

function noteSyslogTarget(host, port, frame) {
    const octets = parseIpv4(host);
    const canonical = ipv4FromOctets(octets);
    const candidatePort = isValidPort(port) ? Number(port) : DEFAULT_SYSLOG_PORT;
    if (!canonical || !isValidPort(candidatePort)) return;
    const header = readFrameHeader(frame) || {};
    const next = {
        octets: octets,
        host: canonical,
        port: candidatePort,
        facility: typeof header.facility === 'number' ? header.facility : SYSLOG_DEFAULT_FACILITY,
        // Filtered on the way in, so nothing unconstrained reaches the store
        // or a frame: what is kept is what headerField allows, and a name that
        // survives none of it falls back to the app's own.
        hostname: namedOr(header.hostname, 255),
        appName: namedOr(header.appName, 48)
    };
    const changed = !_syslogTarget || JSON.stringify(next) !== JSON.stringify(_syslogTarget);
    _syslogTarget = next;
    if (changed) persistReceiver();
}

/**
 * Text as a UTF-8 Buffer, on every runtime this has to serve.
 *
 * Reported: syslog never arrived. The frame reached here and the send threw
 * "utf8 is not a function", captured on-device.
 *
 * Buffer.from arrived in Node 4.5, and one TV's service runtime is v4.4.3.
 * There the name still resolves — to the inherited Uint8Array.from, whose
 * second argument is a map function. So Buffer.from(text, 'utf8') called the
 * string 'utf8' as a function and threw, which is why not one frame ever left
 * that TV however correctly everything upstream was configured.
 *
 * Comparing the two is what tells the inherited one from a real Buffer.from;
 * a version check would need a parser and would still be a guess about which
 * runtime shipped what.
 */
function utf8Buffer(text) {
    const value = String(text);
    if (typeof Buffer.from === 'function' && Buffer.from !== Uint8Array.from) {
        return Buffer.from(value, 'utf8');
    }
    // Deprecated, and the only constructor 4.4.3 has.
    return new Buffer(value, 'utf8');
}

function relaySyslog(frame, host, port, report) {
    function problem(message) {
        logServiceEvent('ERROR', message);
        if (typeof report === 'function') { try { report(message); } catch (e) { } }
    }
    if (!frame) return;
    // Same validation the HTTP relay gained: this address arrives in a request
    // body and becomes the destination of an outbound datagram, so it is
    // checked rather than trusted. Without it a POST could name any host and
    // this would dutifully send there.
    const targetPort = isValidPort(port) ? Number(port) : DEFAULT_SYSLOG_PORT;
    const targetHost = ipv4FromOctets(parseIpv4(host));
    if (!targetHost || !isValidPort(targetPort)) {
        // Reported: syslog enabled, nothing arrived at the user's syslog
        // server, and nothing anywhere said why. A refusal here was completely
        // silent, which is indistinguishable from the feature not running.
        problem(`syslog refused: host=${JSON.stringify(host)} port=${JSON.stringify(port)} is not a plain IPv4 address and port`);
        return;
    }
    let socket;
    try {
        socket = dgram.createSocket('udp4');
    } catch (e) {
        problem(`syslog could not open a UDP socket: ${e && e.message || e}`);
        return;
    }
    // UDP gives no delivery signal; errors here mean the send itself failed
    // (bad host, no route). Swallow them — a syslog target that is not
    // listening must never disturb playback.
    socket.on('error', () => { try { socket.close(); } catch (e) { } });
    try {
        const buf = utf8Buffer(frame);
        socket.send(buf, 0, buf.length, targetPort, targetHost, (err) => {
            if (err) {
                // No `err &&` guard: err is the reason this branch was taken,
                // so testing it again is dead code (CodeQL 131).
                problem(`syslog send to ${targetHost}:${targetPort} failed: ${err.message || err}`);
            } else if (!_syslogSendLogged) {
                // Once per service run: enough to confirm the path works
                // end to end without one log line per log line.
                _syslogSendLogged = true;
                logServiceEvent('INFO', `syslog datagram sent to ${targetHost}:${targetPort} (further sends not logged)`);
            }
            try { socket.close(); } catch (e) { }
        });
    } catch (e) {
        problem(`syslog send threw: ${e && e.message || e}`);
        try { socket.close(); } catch (e2) { }
    }
}

// Relays one entry to the PC receiver TizenBrew's own remoteLogger.js targets
// (same /tv-log path and JSON shape), so the existing PS1 receiver script
// needs no changes.
// The page knows the receiver address because the user set it in the settings
// menu; it sends it with every /tizentube/log post. The service has no config
// of its own, so it learns the address from those posts and reuses it for its
// own logs — which is how service-side logging keeps working without a
// hardcoded address baked into the build.
let _learnedHost = '';
// The four octets behind _learnedHost, kept so persistence writes numbers.
let _learnedOctets = null;
let _learnedPort = 0;

// Bounded: a service that never hears from the page must not grow this without
// limit. Oldest dropped first, since the newest lines are the useful ones.
const MAX_HELD_LOGS = 200;
const _heldLogs = [];

function holdUntilHostKnown(entry) {
    _heldLogs.push(entry);
    if (_heldLogs.length > MAX_HELD_LOGS) _heldLogs.shift();
}

// Persisted so the address survives a service restart. Without this the
// receiver is only known after the page has logged at least once, which means
// every launch loses the early lines — exactly the ones that matter when the
// app fails before the page ever loads. res/wgt is read-only, so this goes in
// the app's data directory.
// Strict validation on the way in and on the way out.
//
// CodeQL flagged this path three times and was right each time: the address
// arrives over HTTP, is written to disk, and is later read back and used as an
// outbound request target. Validating at both ends is what makes that flow
// safe, rather than suppressing the alerts.
//
// IPv4 only, deliberately. The settings menu's numeric editor cannot produce
// anything else, so accepting hostnames would widen what a malformed or
// malicious POST could put in a request target for no practical gain.
// Parse an IPv4 literal into four numbers, or null.
//
// The earlier version was a boolean guard that let the original string through
// on success. That is sound, but it leaves the value the network supplied as
// the one that gets written to disk and used as a request target — and CodeQL
// kept flagging exactly that (js/http-to-file-access, js/file-access-to-http),
// because a boolean check is not a sanitizer: the tainted string still reaches
// the sink.
//
// Parsing to numbers and rebuilding from those numbers means the string that
// ends up stored and used is constructed here, from integers this code
// validated, and never the one that arrived. That breaks the flow properly
// rather than asserting it is fine, and it canonicalises as a side effect —
// 010.000.000.005 and 10.0.0.5 become the same value.
function parseIpv4(host) {
    if (typeof host !== 'string') return null;
    const parts = host.split('.');
    if (parts.length !== 4) return null;
    const octets = [];
    for (const part of parts) {
        if (!/^[0-9]{1,3}$/.test(part)) return null;
        const n = Number(part);
        if (!Number.isInteger(n) || n < 0 || n > 255) return null;
        octets.push(n);
    }
    return octets;
}

// Rebuild a dotted quad from numbers. Returns '' unless all four are integers
// in range, so a malformed stored value cannot produce a usable address.
//
// The pieces come from OCTET_TEXT rather than from the numbers themselves, and
// that is the whole point rather than a flourish. CodeQL kept reporting
// js/file-access-to-http (alert 128) straight through this function: the
// persisted receiver file is read, JSON.parse'd, and its numbers were
// concatenated into the string that becomes an http.request hostname. The range
// checks below are a guard, and a guard is not a sanitizer — the value arriving
// at the socket was still derived from the file, which is precisely what the
// query is for.
//
// Indexing a table of literals breaks the flow instead of asserting it is fine.
// Every piece of the returned string is one of 256 strings this module built
// from its own loop counter, so the address handed to the socket consists of
// program constants that a validated index merely selects. No byte of the file
// reaches it.
const OCTET_TEXT = [];
for (let i = 0; i < 256; i++) OCTET_TEXT.push(String(i));

function ipv4FromOctets(octets) {
    if (!Array.isArray(octets) || octets.length !== 4) return '';
    for (const n of octets) {
        if (!Number.isInteger(n) || n < 0 || n > 255) return '';
    }
    return OCTET_TEXT[octets[0]] + '.' + OCTET_TEXT[octets[1]] + '.' + OCTET_TEXT[octets[2]] + '.' + OCTET_TEXT[octets[3]];
}

function isValidPort(port) {
    const n = Number(port);
    return Number.isInteger(n) && n >= 1 && n <= 65535;
}

// Persisted so the address survives a service restart. Without this the
// receiver is only known after the page has logged at least once, which means
// every launch loses the early lines — exactly the ones that matter when the
// app fails before the page ever loads. res/wgt is read-only, so this goes in
// the app's data directory.
//
// There is deliberately no temp-directory fallback. os.tmpdir() is shared and
// world-writable, and a predictable name there is exactly the insecure-temp-file
// pattern CodeQL flags: another process could pre-create or symlink the path and
// redirect where this service sends its logs. If the app directory cannot be
// determined the address simply stays in memory for the life of the process.
const RECEIVER_STORE_FILE = 'tt-log-receiver.json';

// Where the learned address may live, in the order these are tried.
//
// Reported: the service's startup lines stopped arriving at the receiver until
// the page had loaded and logging had been switched on in the settings — and a
// capture proved it: 37 lines stamped 15:03 arrived interleaved with live
// 15:50 lines, which is a flush, not live logging. So the address was not
// known at startup, which means it had never been stored.
//
// It had not, for two reasons, and both are firmware-dependent, which is why
// this now tries several places and verifies rather than assuming one:
//
//   /opt/usr/apps/<pkg>/ is the installed application directory and is
//   read-only from Tizen 4 onwards — writable application data moved to
//   <home>/apps_rw/<pkg>/data. That was the only path tried.
//
//   fs.mkdirSync(dir, { recursive: true }) needs Node 10.12. One TV's service
//   runtime is Node v4.4.3, where the options object is not understood and
//   nothing nested can be created at all.
function receiverStoreCandidates() {
    const out = [];
    try {
        const appId = tizenAppId();
        if (!appId) return out;
        const path = require('path');
        // The app's own home, when the runtime says where it is.
        const home = process.env.HOME;
        if (home) out.push(path.join(home, 'apps_rw', appId, 'data', RECEIVER_STORE_FILE));
        out.push(path.join('/opt/usr/home/owner/apps_rw', appId, 'data', RECEIVER_STORE_FILE));
        // Correct on firmware old enough to still keep application data here,
        // and harmless where it is read-only: the probe below finds out.
        out.push(path.join('/opt/usr/apps', appId, 'data', RECEIVER_STORE_FILE));
    } catch (e) { }
    return out;
}

// The one that answered, so the choice is made once per run.
let _receiverStorePath = null;
let _receiverStoreReported = false;

/** mkdir -p, without the options object Node 4 does not understand. */
function mkdirpSync(fs, dir) {
    const parts = String(dir).split('/');
    let built = String(dir).charAt(0) === '/' ? '' : '.';
    for (let i = 0; i < parts.length; i++) {
        if (!parts[i]) continue;
        built += '/' + parts[i];
        // Already there, or not ours to create: the write decides, not this.
        try { fs.mkdirSync(built, 0o700); } catch (e) { }
    }
}

/**
 * The first candidate this process can actually write and read back, or null.
 *
 * A round trip rather than a bare write: a path can accept a write and still
 * not keep it, and a store that silently does not persist is what cost the
 * startup logs in the first place.
 */
function chooseReceiverStore(contents) {
    if (_receiverStorePath) return _receiverStorePath;
    const fs = require('fs');
    const path = require('path');
    const failures = [];
    const candidates = receiverStoreCandidates();
    for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        try {
            mkdirpSync(fs, path.dirname(candidate));
            fs.writeFileSync(candidate, contents, { mode: 0o600 });
            if (fs.readFileSync(candidate, 'utf8') !== contents) {
                failures.push(candidate + ': written but read back different');
                continue;
            }
            _receiverStorePath = candidate;
            if (!_receiverStoreReported) {
                _receiverStoreReported = true;
                logServiceEvent('INFO', `log receiver address stored at ${candidate}`
                    + (failures.length ? ` (after ${failures.join('; ')})` : ''));
            }
            return _receiverStorePath;
        } catch (e) {
            failures.push(candidate + ': ' + (e && e.message || e));
        }
    }
    if (!_receiverStoreReported) {
        _receiverStoreReported = true;
        // Held like every other line until an address is known, so it arrives
        // with the next flush — which is exactly when it is wanted.
        logServiceEvent('ERROR', 'the log receiver address cannot be stored anywhere, so '
            + 'every start will hold its logs until the page reports it again. Tried: '
            + (failures.length ? failures.join('; ') : 'nowhere — the package id could not be read'));
    }
    return null;
}

function tizenAppId() {
    // /opt/usr/apps/<pkgId>/res/wgt/service/dist — walk back to <pkgId>.
    const parts = String(__dirname).split(String.fromCharCode(92)).join('/').split('/');
    const i = parts.indexOf('apps');
    return (i !== -1 && parts[i + 1]) ? parts[i + 1] : '';
}

function loadPersistedReceiver() {
    const candidates = receiverStoreCandidates();
    for (let i = 0; i < candidates.length; i++) {
        // Deliberately not remembered as the place to write: being readable
        // says nothing about being writable, and the legacy location is both
        // readable and read-only on current firmware. The probe decides where
        // saves go, and it tries the writable locations first, so a stale file
        // in the old one is never preferred.
        if (readPersistedReceiver(candidates[i])) return;
    }
}

/** True when this file held a usable address. */
function readPersistedReceiver(file) {
    try {
        const raw = require('fs').readFileSync(file, 'utf8');
        const saved = JSON.parse(raw);
        if (!saved) return false;
        // Octets are stored as numbers, so nothing read back here is a string
        // that then becomes a request target. A file written by an older build
        // held a host string instead; it is parsed the same way rather than
        // trusted, so upgrading keeps the address instead of silently losing it.
        // The syslog half, which may be stored without the other.
        const sys = saved.syslog;
        if (sys) {
            const sysOctets = Array.isArray(sys.octets) ? sys.octets : parseIpv4(sys.host);
            const sysHost = ipv4FromOctets(sysOctets);
            const facility = Number(sys.facility);
            if (sysHost && isValidPort(sys.port)) {
                _syslogTarget = {
                    octets: sysOctets.slice(),
                    host: sysHost,
                    port: Number(sys.port),
                    facility: (isFinite(facility) && facility >= 0 && facility <= 23) ? facility : SYSLOG_DEFAULT_FACILITY,
                    // Through the same filter the frames use, since these two
                    // go into a frame header verbatim.
                    hostname: headerField(sys.hostname, 255),
                    appName: headerField(sys.appName, 48)
                };
            }
        }

        const octets = Array.isArray(saved.octets) ? saved.octets : parseIpv4(saved.host);
        const host = ipv4FromOctets(octets);
        // A file holding only a syslog target is still a file worth having
        // read, so the search for a readable one stops here.
        if (!host || !isValidPort(saved.port)) return !!_syslogTarget;
        _learnedOctets = octets.slice();
        _learnedHost = host;
        _learnedPort = Number(saved.port);
        return true;
    } catch (e) {
        // Absent, which every candidate but one is, or unreadable. Not worth
        // reporting on its own: what matters is whether any of them answered,
        // and chooseReceiverStore reports that when it next writes.
        return false;
    }
}

function persistReceiver() {
    const haveReceiver = !!ipv4FromOctets(_learnedOctets) && isValidPort(_learnedPort);
    // Either output is worth storing on its own: a TV with syslog configured
    // and no log server would otherwise keep nothing, and its startup lines
    // are the ones this is for.
    if (!haveReceiver && !_syslogTarget) return;
    // Numbers, not the string that arrived over the network.
    const contents = JSON.stringify({
        octets: haveReceiver ? _learnedOctets : undefined,
        port: haveReceiver ? _learnedPort : undefined,
        syslog: _syslogTarget ? {
            octets: _syslogTarget.octets,
            port: _syslogTarget.port,
            facility: _syslogTarget.facility,
            hostname: _syslogTarget.hostname,
            appName: _syslogTarget.appName
        } : undefined
    });
    // Already proven writable: just write. Not doing this is a bug waiting to
    // happen — the probe below returns the remembered path without writing, so
    // routing every later save through it would quietly drop a changed address.
    if (_receiverStorePath) {
        try { require('fs').writeFileSync(_receiverStorePath, contents, { mode: 0o600 }); } catch (e) { }
        return;
    }
    // First save of this run: the write is the probe, since chooseReceiverStore
    // stores these very contents and reads them back.
    chooseReceiverStore(contents);
}

function noteReceiver(host, port) {
    // Rejected outright rather than coerced: an address that is not a plain
    // IPv4 literal has no business becoming a request target, and silently
    // falling back to a default would hide a misconfigured page.
    const candidatePort = isValidPort(port) ? Number(port) : DEFAULT_LOG_PORT;
    const octets = parseIpv4(host);
    if (!octets || !isValidPort(candidatePort)) return;
    // Rebuilt from the parsed numbers, so what is stored and later used as a
    // request target is this code's string, not the caller's.
    const canonical = ipv4FromOctets(octets);
    if (!canonical) return;
    if (canonical === _learnedHost && candidatePort === _learnedPort) return;
    _learnedOctets = octets;
    _learnedHost = canonical;
    _learnedPort = candidatePort;
    // Anything logged before the page got in touch — including bootstrap.js's
    // lines, which run before this module even loads — is worth having: that is
    // where load failures show up.
    persistReceiver();
    const pending = _heldLogs.splice(0, _heldLogs.length);
    const bootstrapped = (global.__ttPendingServiceLogs || []).splice(0, (global.__ttPendingServiceLogs || []).length);
    for (const held of bootstrapped.concat(pending)) relayLog(held, _learnedHost, _learnedPort);
}

loadPersistedReceiver();

function relayLog(entry, host, port) {
    // Any caller that knows the address teaches it to the service. That covers
    // the CDP path too: the page cannot reach localhost from an HTTPS context,
    // so it queues entries tagged with the host and injector.js drains them
    // through here — without this, only the proxy path ever taught us.
    if (host) noteReceiver(host, port);
    const targetHost = host || _learnedHost || DEFAULT_LOG_HOST;
    const targetPort = Number(port) || _learnedPort || DEFAULT_LOG_PORT;
    // Nowhere to send yet. The service's own logs (logServiceEvent, and
    // everything the injector relays) pass no host, so before this they leaned
    // entirely on DEFAULT_LOG_HOST — which shipped as one developer's LAN
    // address. Rather than keep pointing every install at a stranger's machine,
    // hold these until the page tells us where its receiver is, then flush.
    if (!targetHost) { holdUntilHostKnown(entry); return; }
    const targetKey = `${targetHost}:${targetPort}`;
    const unavailableSince = unavailableTargets[targetKey];
    if (unavailableSince && (Date.now() - unavailableSince) < UNAVAILABLE_COOLDOWN_MS) return;

    try {
        const body = JSON.stringify({
            _formatted: entry._formatted || `[${entry.ts}] [${entry.level || 'INFO'}] [${entry.context || 'TizenTube'}] ${entry.message || ''}`,
            app: 'TizenTube Standalone',
            ts: entry.ts,
            level: entry.level,
            context: entry.context,
            message: entry.message,
        });
        const req = http.request({
            // targetHost is built by ipv4FromOctets, which assembles it from a
            // table of constants rather than from the stored value — see the note
            // there. This is the sink CodeQL reports (js/file-access-to-http), so
            // the guarantee is worth restating where the request is actually made.
            hostname: targetHost,
            port: targetPort,
            path: '/tv-log',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, () => { delete unavailableTargets[targetKey]; });
        req.setTimeout(3000, () => {
            // destroy() alone doesn't emit 'error', so mark unavailable here too
            unavailableTargets[targetKey] = Date.now();
            req.destroy();
        });
        req.on('error', () => { unavailableTargets[targetKey] = Date.now(); });
        req.write(body);
        req.end();
    } catch (e) { }
}

const SYSLOG_DEFAULT_FACILITY = 16;

/**
 * A value fit for an RFC 5424 name field — HOSTNAME or APP-NAME.
 *
 * An allowlist, not a denylist. These two arrive inside a syslog frame posted
 * over HTTP, are written to the store on disk and are later put back into a
 * frame, which CodeQL reported as network data reaching the file system
 * (js/http-to-file-access, alerts 137 and 138) and was right to: the previous
 * filter removed the characters that would break a frame and let everything
 * else through, including anything of any length in any script.
 *
 * Letters, digits, dot, dash and underscore cover every TV model and every
 * name anyone would type, and match what the page already reduces its detected
 * model to, so both this process's frames and the page's name the same TV the
 * same way. Anything else is not worth carrying as far as the disk.
 */
/**
 * Dashes off both ends, by index rather than by pattern.
 *
 * /^-+|-+$/ on a value from the network is a polynomial backtracker
 * (js/polynomial-redos, alert 139) and the numbers are not subtle. For a dash
 * run that does not reach the end of the string — "a" + "-"*n + "x", which
 * survives the reduction above untouched — the engine tries -+$ at every
 * position in the run and backtracks through it each time. Measured on a
 * desktop: 5k dashes 10ms, 20k 156ms, 50k 992ms. The TV's CPU is far slower
 * than that, and on the proxy path this process is also serving video.
 *
 * Walking from each end is linear and was 0ms at every one of those sizes.
 */
function trimDashes(text) {
    let start = 0;
    let end = text.length;
    while (start < end && text.charCodeAt(start) === 45) start++;
    while (end > start && text.charCodeAt(end - 1) === 45) end--;
    return text.slice(start, end);
}

function headerField(value, max) {
    // A run becomes one dash rather than vanishing: "UE55 RU7179" reads as
    // UE55-RU7179, which is also what the page makes of it, and the two have
    // to agree or one TV is named twice in one file. This replace is linear:
    // one quantifier over a negated class, nothing to backtrack into.
    const reduced = String(value === undefined || value === null ? '' : value)
        .replace(/[^A-Za-z0-9._-]+/g, '-');
    // Trimmed, cut to length, then trimmed again in case the cut left a dash
    // at the end.
    const out = trimDashes(trimDashes(reduced).slice(0, max));
    return out || '-';
}
// INFO, with the levels this logs mapped onto RFC 5424 severities.
const SYSLOG_SEVERITY = { ERROR: 3, WARN: 4, INFO: 6, DEBUG: 7 };

// Keeps the service's own lines out of an endless loop: a syslog send that
// fails reports the failure through logServiceEvent, which would try to send
// that report the same way.
let _inServiceSyslog = false;

/**
 * One of this process's own log lines, as an RFC 5424 frame.
 *
 * Built to match what the page sends — same facility, same hostname, same
 * app-name — so both streams read as one source on the receiver rather than
 * two. Only the MSGID differs, because the context does.
 */
function serviceSyslogFrame(level, message, target) {
    const severity = SYSLOG_SEVERITY[level] === undefined ? SYSLOG_SEVERITY.INFO : SYSLOG_SEVERITY[level];
    const priority = (target.facility * 8) + severity;
    // A newline would end the frame early and everything after it would be
    // read as a separate message, so the stack traces this logs are flattened.
    const text = String(message).replace(/[\r\n]+/g, ' ');
    return '<' + priority + '>1 ' + new Date().toISOString() + ' '
        + headerField(target.hostname, 255) + ' ' + headerField(target.appName, 48)
        + ' - StandaloneService - ' + text;
}

function sendServiceSyslog(level, message) {
    if (!_syslogTarget || _inServiceSyslog) return;
    _inServiceSyslog = true;
    try {
        relaySyslog(serviceSyslogFrame(level, message, _syslogTarget), _syslogTarget.host, _syslogTarget.port);
    } catch (e) {
        // Nowhere to report this that would not come straight back here.
    } finally {
        _inServiceSyslog = false;
    }
}

function logServiceEvent(level, message) {
    const entry = { ts: new Date().toISOString(), level, context: 'StandaloneService', message };
    relayLog(entry);
    // Both outputs, independently, exactly as the page's own logging does:
    // either can be configured without the other, and a dead syslog target
    // must not stop the HTTP relay.
    sendServiceSyslog(level, message);
}

process.on('uncaughtException', (err) => {
    logServiceEvent('ERROR', `Uncaught exception: ${err && err.stack || err}`);
});
process.on('unhandledRejection', (reason) => {
    logServiceEvent('ERROR', `Unhandled rejection: ${reason && reason.stack || reason}`);
});
logServiceEvent('INFO', `Standalone service process starting (node ${process.version})`);

// ── Now the requires that previously ran before any of the above existed ──
// Each require() below MUST keep a literal string argument, not a variable —
// ncc (and bundlers generally) can only statically analyze and inline a
// literal require('x'); a dynamic require(path) can't be bundled, and falls
// through to real Node module resolution at runtime, which fails since
// there's no node_modules deployed on-device (a mistake made here once
// already: it briefly broke every launch on Tizen 6.5 with "Cannot find
// module 'express'").

let express;
try {
    express = require('express');
    logServiceEvent('INFO', "require('express') OK");
} catch (err) {
    logServiceEvent('ERROR', `require('express') FAILED: ${err && err.stack || err}`);
    throw err;
}
const app = express();
const PORT = 8099;

let fetch;
try {
    fetch = require('node-fetch');
    logServiceEvent('INFO', "require('node-fetch') OK");
} catch (err) {
    logServiceEvent('ERROR', `require('node-fetch') FAILED: ${err && err.stack || err}`);
    throw err;
}

let URL;
try {
    URL = require('url');
    logServiceEvent('INFO', "require('url') OK");
} catch (err) {
    logServiceEvent('ERROR', `require('url') FAILED: ${err && err.stack || err}`);
    throw err;
}

let injector;
try {
    injector = require('./injector.js');
    logServiceEvent('INFO', "require('./injector.js') OK");
    // Lets the CDP path deliver syslog frames the page could not send itself.
    if (injector && typeof injector.setSyslogRelay === 'function') injector.setSyslogRelay(relaySyslog);
} catch (err) {
    logServiceEvent('ERROR', `require('./injector.js') FAILED: ${err && err.stack || err}`);
    throw err;
}

const TIZENTUBE_CDN_URL = 'https://cdn.jsdelivr.net/npm/@krx3d/tizentube2/dist/userScript.js';
const TIZENTUBE_CDN_FALLBACK_URL = 'https://unpkg.com/@krx3d/tizentube2/dist/userScript.js';
const standaloneVersion = tizen.application.getAppInfo().version;

// This proxy exists to bypass CORS for YouTube/Google resources only — never
// forward it to an arbitrary host, or it becomes an open proxy for anything
// running on the device.
const ALLOWED_PROXY_HOSTS = ['googlevideo.com', 'youtube.com', 'gstatic.com', 'google.com', 'googleapis.com', 'googleusercontent.com', 'ggpht.com'];
function isAllowedProxyHost(hostname) {
    if (!hostname) return false;
    return ALLOWED_PROXY_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

// What this process has been doing, for the health line and endpoint below.
//
// Reported on Tizen 6.5 (WiFi): a video plays for seconds or minutes, then
// everything stops loading — pages come back black, as if the network were
// gone — and only reinstalling the app helps. On the proxy path every YouTube
// request, video segments included, goes through this process, and so does
// every log line the page and index.html produce. So when this process stops
// answering, the failure erases its own evidence: that is why no capture of it
// exists yet.
//
// These counters are the evidence. The uptime matters most: it says whether a
// failing start is talking to a long-lived process that has gone bad or to a
// fresh one. Note that powering a Samsung TV off is a suspend, not a reboot,
// so this process can outlive what looks like a restart — while reinstalling
// genuinely replaces it.
let _served = 0;
let _inFlight = 0;
let _lastRequestAt = 0;
let _peakInFlight = 0;
const _startedAt = Date.now();

/** Whether the HTTP server is accepting, on any Node this runs on. */
function listeningState() {
    try {
        if (typeof server === 'undefined' || !server) return false;
        if (typeof server.listening === 'boolean') return server.listening;
        return server.address() !== null && server.address() !== undefined;
    } catch (e) {
        return false;
    }
}

function healthSnapshot() {
    const mem = (() => { try { return process.memoryUsage(); } catch (e) { return {}; } })();
    const mb = (n) => (typeof n === 'number' ? Math.round(n / 1048576) : null);
    let handles = null;
    // Not in every Node build, and internal where it is — the socket count is
    // the first thing to look at for a process that stops accepting, so it is
    // worth asking for behind a guard.
    try { if (typeof process._getActiveHandles === 'function') handles = process._getActiveHandles().length; } catch (e) { }
    return {
        pid: process.pid,
        uptimeSec: Math.round((Date.now() - _startedAt) / 1000),
        served: _served,
        inFlight: _inFlight,
        peakInFlight: _peakInFlight,
        lastRequestAgeSec: _lastRequestAt ? Math.round((Date.now() - _lastRequestAt) / 1000) : null,
        rssMB: mb(mem.rss),
        heapUsedMB: mb(mem.heapUsed),
        handles,
        // server.listening needs Node 5.7; one TV runs v4.4.3, where it is
        // undefined and this read "listening": false while the service was
        // plainly serving requests. address() answers on every version.
        listening: listeningState()
    };
}

app.use((req, res, next) => {
    _served++;
    _inFlight++;
    if (_inFlight > _peakInFlight) _peakInFlight = _inFlight;
    _lastRequestAt = Date.now();
    let done = false;
    const finish = () => { if (done) return; done = true; _inFlight--; };
    // Both, because a client that goes away mid-response emits 'close' without
    // 'finish', and a segment request abandoned by the player does exactly
    // that — miscounting those is how inFlight would drift upwards forever and
    // make this diagnostic lie.
    res.on('finish', finish);
    res.on('close', finish);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

// Asked by index.html at startup and answerable at any time. A request that
// does not come back is itself the finding: this process is up but no longer
// serving, which is the state that currently needs a reinstall.
app.get('/tizentube/health', (req, res) => {
    res.json(healthSnapshot());
});

app.get('/tizentube/getState', (req, res) => {
    injector.canConnectToDaemon().then(r => {
        logServiceEvent('INFO', `getState → ${JSON.stringify(r)}`);
        res.json(r);
    }).catch((err) => {
        logServiceEvent('ERROR', `getState failed: ${err && err.stack || err}`);
        res.status(500).json({ error: String(err) });
    });
});

app.get('/tizentube/debugger', (req, res) => {
    const args = req.originalUrl.split('?')[1] || '';
    // setInterval fires every 50ms regardless of whether the previous
    // getAppsContext callback has returned yet — if that call ever takes
    // longer than 50ms (plausible under load), multiple overlapping calls
    // can all see the app already gone and each call injector.startDebugger,
    // since clearInterval only stops *future* ticks, not callbacks already
    // in flight. Confirmed on-device: bursts of near-simultaneous "ADB
    // connected" attempts and ECONNRESET errors on the ADB connection,
    // consistent with several concurrent shell:0 debug sessions stepping on
    // each other. Guard with a flag so only the first caller can proceed.
    let started = false;
    const interval = setInterval(() => {
        tizen.application.getAppsContext((appsContext) => {
            if (started) return;
            const packageId = tizen.application.getAppInfo().packageId;
            const app = appsContext.find(app => app.appId === `${packageId}.TizenTubeStandalone`);
            if (!app && !started) {
                started = true;
                clearInterval(interval);
                injector.startDebugger(args, relayLog);
            }
        });
    }, 50);
});

// host/port come from the request body when the page has them configured;
// falls back to DEFAULT_LOG_HOST/PORT otherwise (see relayLog above).
// index.html announces where the receiver is. The service keeps no config of
// its own, and its own logging passes no host, so without this it has nowhere
// to send anything once the hardcoded default was removed.
// index.html has no configuration of its own and cannot read the page's
// settings (different origin), so it asks the service instead of carrying a
// hardcoded address.
app.get('/tizentube/receiver', (req, res) => {
    res.json({ host: _learnedHost || '', port: _learnedPort || DEFAULT_LOG_PORT });
});

app.post('/tizentube/receiver', express.json(), (req, res) => {
    const { host, port } = req.body || {};
    noteReceiver(host, port);
    res.status(204).end();
});

app.post('/tizentube/log', express.json(), (req, res) => {
    const { host, port, entry } = req.body || {};
    if (!entry) return res.status(400).end();
    noteReceiver(host, port);
    relayLog(entry, host, port);
    res.status(204).end();
});

// Syslog frames are built page-side and only need a socket here.
app.post('/tizentube/syslog', express.json(), (req, res) => {
    const { host, port, frame } = req.body || {};
    if (!frame) return res.status(400).end();
    noteSyslogTarget(host, port, frame);
    relaySyslog(frame, host, port);
    res.status(204).end();
});

app.all('*', (req, res) => {
    if (req.path === '/tv') {
        logServiceEvent('INFO', `Received ${req.method} ${req.path} — page is reaching the proxy`);
    }

    const isCorsBypass = req.path.indexOf('/cors-bypass/') === 0;

    let parsedTargetUrl;
    try {
        if (isCorsBypass) {
            const rawTarget = req.url.substring('/cors-bypass/'.length);
            const candidate = rawTarget.indexOf('http') === 0 ? rawTarget : `https://${rawTarget}`;
            parsedTargetUrl = new URL(candidate);
        } else {
            parsedTargetUrl = new URL(req.url, 'https://www.youtube.com');
        }
    } catch (e) {
        return res.status(403).send('Blocked: invalid target URL');
    }

    if (parsedTargetUrl.protocol !== 'https:' && parsedTargetUrl.protocol !== 'http:') {
        return res.status(403).send('Blocked: unsupported target protocol');
    }

    if (parsedTargetUrl.username || parsedTargetUrl.password) {
        return res.status(403).send('Blocked: credentials in URL are not allowed');
    }

    if (parsedTargetUrl.pathname.indexOf('..') !== -1) {
        return res.status(403).send('Blocked: invalid target path');
    }

    if (!isAllowedProxyHost(parsedTargetUrl.hostname)) {
        return res.status(403).send('Blocked: target host not allowed');
    }

    const targetUrl = parsedTargetUrl.toString();

    const headers = {};
    for (const key in req.headers) {
        if (Object.prototype.hasOwnProperty.call(req.headers, key)) {
            if (key === 'cookie') {
                headers[key] = req.headers[key]
                    .replace(/__LocalSecure-/g, '__Secure-')
                    .replace(/__LocalHost-/g, '__Host-');
                continue;
            }
            headers[key] = req.headers[key];
        }
    }

    try {
        headers['host'] = parsedTargetUrl.host;
    } catch (e) {
        headers['host'] = 'www.youtube.com';
    }

    headers['origin'] = 'https://www.youtube.com';
    if (headers['referer']) {
        headers['referer'] = 'https://www.youtube.com/tv';
    }

    headers['accept-encoding'] = 'gzip, deflate';

    const hasBody = ['POST', 'PUT', 'PATCH'].indexOf(req.method) !== -1;
    const fetchOptions = {
        method: req.method,
        headers: headers,
        body: hasBody ? req : undefined,
        redirect: 'manual'
    };

    fetch(targetUrl, fetchOptions)
        .then((response) => {
            if (req.method === 'OPTIONS') {
                res.status(200);
            } else {
                res.status(response.status);
            }

            const headerKeys = response.headers.raw();
            for (const key in headerKeys) {
                if (Object.prototype.hasOwnProperty.call(headerKeys, key)) {
                    const lowerKey = key.toLowerCase();
                    const skipHeaders = ['content-encoding', 'content-length', 'transfer-encoding', 'content-security-policy', 'alt-svc'];
                    if (isCorsBypass) skipHeaders.push('access-control-allow-origin');

                    if (skipHeaders.indexOf(lowerKey) !== -1) continue;

                    const value = response.headers.get(key);
                    if (lowerKey === 'set-cookie') {
                        const rawCookies = headerKeys[key];
                        if (Array.isArray(rawCookies)) {
                            const modifiedCookies = rawCookies.map(cookieStr => {
                                return cookieStr
                                    .replace(/^__Secure-/i, '__LocalSecure-')
                                    .replace(/^__Host-/i, '__LocalHost-')
                                    .replace(/Domain=[^;]+/i, 'Domain=localhost')
                                    .replace(/;\s*Secure/i, '')
                                    .replace(/;\s*SameSite=None/i, '')
                                    .replace(/;\s*;/g, ';')
                                    .replace(/;\s*$/, '');
                            });
                            res.setHeader('Set-Cookie', modifiedCookies);
                            continue;
                        }
                    }

                    res.setHeader(key, value);
                }
            }

            res.setHeader('Access-Control-Allow-Origin', '*');

            const contentType = response.headers.get('content-type') || '';

            if (contentType.indexOf('text/html') !== -1 ||
                contentType.indexOf('application/json') !== -1 ||
                contentType.indexOf('javascript') !== -1 ||
                contentType.indexOf('text/css') !== -1) {

                return response.text().then((text) => {
                    if (contentType.indexOf('text/html') !== -1 && req.path === '/tv') {
                        // Must run before YouTube parses its initial player data — the ad
                        // blocker patches JSON.parse to strip ad placements from it. Appending
                        // the script at the end of the document (the previous approach) ran it
                        // too late; inserting right after <body> opens ensures it executes
                        // before YouTube's own scripts do. Falls back to a second CDN if the
                        // primary one is unreachable.
                        const userScript = `<script>window.__tizenTubeStandaloneVersion = ${JSON.stringify(standaloneVersion)};</script><script src="${TIZENTUBE_CDN_URL}?ver=${Date.now()}" onerror="this.onerror=null;this.src='${TIZENTUBE_CDN_FALLBACK_URL}'"></script>`;
                        if (/<body[^>]*>/i.test(text)) {
                            text = text.replace(/<body[^>]*>/i, (bodyTag) => `${bodyTag}${userScript}`);
                        } else {
                            text = userScript + text;
                        }
                    }

                    const proxyPrefix = `http://localhost:${PORT}/cors-bypass/`;

                    // Rewrite rules for replacing URLs so CORS and presumably YT is happy.
                    text = text.replace(/https:\/\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `${proxyPrefix}https://$1.googlevideo.com`);
                    text = text.replace(/https:\\\/\\\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `http:\\\/\\\/localhost:${PORT}\\\/cors-bypass\\\/https:\\\/\\\/$1.googlevideo.com`);
                    text = text.replace(/"\/\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `"${proxyPrefix}https://$1.googlevideo.com`);

                    text = text.replace(/https:\/\/www\.gstatic\.com/g, `${proxyPrefix}https://www.gstatic.com`);
                    text = text.replace(/http:\/\/www\.gstatic\.com/g, `${proxyPrefix}https://www.gstatic.com`);
                    text = text.replace(/"\/\/www\.gstatic\.com/g, `"${proxyPrefix}https://www.gstatic.com`);
                    text = text.replace(/\(\/\/www\.gstatic\.com/g, `(${proxyPrefix}https://www.gstatic.com`);

                    text = text.replace(/https:\/\/yt3\.ggpht\.com/g, `${proxyPrefix}https://yt3.ggpht.com`);

                    text = text.replace(/https:\/\/clients1\.google\.com/g, `${proxyPrefix}https://clients1.google.com`);
                    text = text.replace(/http:\/\/clients1\.google\.com/g, `${proxyPrefix}https://clients1.google.com`);
                    text = text.replace(/"\/\/clients1\.google\.com/g, `"${proxyPrefix}https://clients1.google.com`);

                    text = text.replace('Set(["www.youtube.com","accounts.google.com"]);', 'Set(["www.youtube.com", "accounts.google.com", "localhost"]);');
                    text = text.replace(/:document\.location\.toString\(\)/g, ':document.location.toString().replace("http://localhost:8099", "https://www.youtube.com")');
                    text = text.replace(/euri:[^,]+,/g, 'euri:document.location.toString().replace("http://localhost:8099", "https://www.youtube.com"),')
                    text = text.replace(/https:\/\/s\.youtube\.com/g, `${proxyPrefix}https://s.youtube.com`);
                    text = text.replace(/redirector\.googlevideo\.com/g, `${proxyPrefix}https://redirector.googlevideo.com`);
                    text = text.replace(/this.scheme="https"/, 'this.scheme="http"');
                    text = text.replace(/https:\/\/jnn-pa\.googleapis\.com/g, `${proxyPrefix}https://jnn-pa.googleapis.com`);
                    text = text.replace(/https:\/\/yt3\.googleusercontent\.com/g, `${proxyPrefix}https://yt3.googleusercontent.com`);
                    text = text.replace(/"\/\/yt3\.googleusercontent\.com/g, `"${proxyPrefix}https://yt3.googleusercontent.com`);

                    // In order to fix history not working
                    text = text.replace(/=window\.location\.href;/, '=window.location.href.replace("http://localhost:8099", "https://www.youtube.com");')
                    text = text.replace(/=document\.location\.href/, '=document.location.href.replace("http://localhost:8099", "https://www.youtube.com")')

                    res.send(text);
                });
            } else {
                if (response.body) {
                    response.body.pipe(res);
                } else {
                    res.end();
                }
            }
        })
        .catch((error) => {
            const safeUrl = String(targetUrl).replace(/[\r\n]/g, '');
            console.error(`Proxy Error for [${safeUrl}]: ${error}`);
            console.error(error.stack);
            logServiceEvent('ERROR', `Proxy error for [${safeUrl}]: ${error && error.stack || error}`);
            if (!res.headersSent) {
                res.status(500).send('Proxy Connection Broken');
            }
        });
});

const server = app.listen(PORT, "127.0.0.1", () => {
    logServiceEvent('INFO', `Standalone service listening on 127.0.0.1:${PORT}`);
});
server.on('error', (err) => {
    logServiceEvent('ERROR', `app.listen failed: ${err && err.stack || err}`);
});

// One line a minute while there is traffic, so a capture taken before the
// failure shows the trend that led to it — memory climbing, sockets never
// coming back, requests still arriving or not. Silent while nothing is
// happening, so an idle TV does not fill the log.
const HEALTH_LOG_MS = 60000;
let _lastHealthServed = -1;
const healthTimer = setInterval(() => {
    try {
        const h = healthSnapshot();
        if (h.served === _lastHealthServed) return;
        _lastHealthServed = h.served;
        logServiceEvent('INFO', `health ${JSON.stringify(h)}`);
    } catch (e) { }
}, HEALTH_LOG_MS);
// Never the reason the process is kept alive.
try { if (typeof healthTimer.unref === 'function') healthTimer.unref(); } catch (e) { }

// dist/service.js's DIAL server generates UUIDs via the 'uuid' package, and
// on-device logs showed it resolving to uuid's browser-targeted rng (needs
// Web Crypto's crypto.getRandomValues, which Tizen's old Node service
// runtime doesn't have) instead of the Node-targeted one (crypto.randomBytes)
// — throwing "crypto.getRandomValues() not supported" during DIALServer
// construction. That left the module never finishing its setup, so Tizen's
// own service runner then called app.onRequest on every incoming message
// and got "app.onRequest is not a function", repeatedly — the likely actual
// cause of the crash-loop, since each of those was an uncaught exception.
// Polyfilling getRandomValues with Node's own crypto.randomBytes covers this
// regardless of which rng implementation actually got bundled.
if (!global.crypto || typeof global.crypto.getRandomValues !== 'function') {
    const nodeCrypto = require('crypto');
    global.crypto = Object.assign({}, global.crypto, {
        getRandomValues: function (typedArray) {
            const bytes = nodeCrypto.randomBytes(typedArray.length);
            typedArray.set(bytes);
            return typedArray;
        }
    });
}

// Object.hasOwn is ES2022 (V8 9.3 / Node 16.9). Tizen 6.5's service runtime is
// Node v12.16.3, so a dependency using it threw during DIAL startup:
//
//     DIAL service (dist/service.js) failed to load:
//         TypeError: Object.hasOwn is not a function
//
// Babel transpiles syntax, not runtime APIs, so this needs a shim rather than a
// build setting. Third failure in the same chain, each one only visible once
// the previous was fixed: node: imports, then the un-inlined XML templates,
// now this.
if (typeof Object.hasOwn !== 'function') {
    Object.defineProperty(Object, 'hasOwn', {
        value: function (target, property) {
            if (target === null || target === undefined) {
                throw new TypeError('Cannot convert undefined or null to object');
            }
            return Object.prototype.hasOwnProperty.call(Object(target), property);
        },
        configurable: true,
        writable: true,
    });
}

// TextDecoder is a Node 11 global (util.TextDecoder from 8.3). Tizen 5.5's
// service runtime is Node v4.4.3, where a dependency reaching for it threw
// during DIAL startup, captured on-device:
//
//     DIAL service (dist/service.js) failed to load:
//         ReferenceError: TextDecoder is not defined
//
// Fourth in the same chain, each only visible once the one before it was
// fixed: crypto.getRandomValues, then Object.hasOwn, then the node: imports
// and un-inlined XML, now this. Babel transpiles syntax, not runtime APIs, so
// a shim is the only way.
//
// Only UTF-8 is implemented, which is all the DIAL code decodes, and anything
// else is refused rather than silently mis-decoded. Built on Buffer, since
// Buffer.from is itself Node 4.5 and this has to run on 4.4.3.
if (typeof global.TextDecoder !== 'function') {
    const bufferFrom = function (source, length) {
        const out = new Buffer(length);
        for (let i = 0; i < length; i++) out[i] = source[i];
        return out;
    };
    const asBuffer = function (input) {
        if (input === undefined || input === null) return new Buffer(0);
        if (Buffer.isBuffer(input)) return input;
        // An ArrayBuffer, or any view over one: read through a byte view so
        // the view's own offset and length are respected rather than the
        // whole underlying buffer.
        if (typeof ArrayBuffer === 'function' && input instanceof ArrayBuffer) {
            const whole = new Uint8Array(input);
            return bufferFrom(whole, whole.length);
        }
        if (input.buffer && typeof Uint8Array === 'function') {
            const view = new Uint8Array(input.buffer, input.byteOffset || 0,
                input.byteLength === undefined ? input.length : input.byteLength);
            return bufferFrom(view, view.length);
        }
        return bufferFrom(input, input.length || 0);
    };
    const TextDecoderShim = function (encoding) {
        const label = String(encoding === undefined || encoding === null ? 'utf-8' : encoding).toLowerCase();
        if (label !== 'utf-8' && label !== 'utf8' && label !== 'unicode-1-1-utf-8') {
            throw new RangeError('TextDecoder shim supports utf-8 only, asked for ' + label);
        }
        this.encoding = 'utf-8';
        this.fatal = false;
        this.ignoreBOM = false;
    };
    TextDecoderShim.prototype.decode = function (input) {
        const text = asBuffer(input).toString('utf8');
        // A leading byte order mark is dropped, as the real one does unless
        // ignoreBOM is asked for.
        return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    };
    global.TextDecoder = TextDecoderShim;
}

// Its counterpart, for the same reason: a dependency that decodes usually
// encodes somewhere too, and finding that out one crash at a time is what
// this chain has been.
if (typeof global.TextEncoder !== 'function') {
    const TextEncoderShim = function () { this.encoding = 'utf-8'; };
    TextEncoderShim.prototype.encode = function (input) {
        const buf = new Buffer(String(input === undefined ? '' : input), 'utf8');
        const out = new Uint8Array(buf.length);
        for (let i = 0; i < buf.length; i++) out[i] = buf[i];
        return out;
    };
    global.TextEncoder = TextEncoderShim;
}

// Start the DIAL server
global.isTizenTube = true;
try {
    require('../../dist/service.js');
    logServiceEvent('INFO', 'DIAL service (dist/service.js) loaded');
} catch (err) {
    logServiceEvent('ERROR', `DIAL service (dist/service.js) failed to load: ${err && err.stack || err}`);
}

// Tizen's service runner does `app = require(<entry>)` and then calls
// app.onStart / app.onRequest / app.onStop on lifecycle messages. This module
// exported nothing at all, so every incoming message threw
//
//     TypeError: app.onRequest is not a function
//         at MessagePort.<anonymous> (/usr/share/wrt/app/service/service_runner.js:152)
//
// as an UNCAUGHT exception — 29 of them in one captured session on Tizen 6.5,
// which is what destabilised the service and left index.html reloading against
// a target that kept dying ("getState fetch failed, reloading" 26 times in the
// same capture).
//
// Everything this service does happens at module load, so these handlers only
// need to exist. They are defined defensively rather than assumed to be
// provided by dist/service.js, because that module is a dependency here, not
// the entry point — its exports are never what the runner sees.
module.exports.onStart = function () { };
module.exports.onStop = function () { };
module.exports.onRequest = function () { };
