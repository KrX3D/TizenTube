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
function relaySyslog(frame, host, port) {
    if (!frame) return;
    // Same validation the HTTP relay gained: this address arrives in a request
    // body and becomes the destination of an outbound datagram, so it is
    // checked rather than trusted. Without it a POST could name any host and
    // this would dutifully send there.
    const targetPort = isValidPort(port) ? Number(port) : DEFAULT_SYSLOG_PORT;
    const targetHost = ipv4FromOctets(parseIpv4(host));
    if (!targetHost || !isValidPort(targetPort)) return;
    let socket;
    try {
        socket = dgram.createSocket('udp4');
    } catch (e) {
        return;
    }
    // UDP gives no delivery signal; errors here mean the send itself failed
    // (bad host, no route). Swallow them — a syslog target that is not
    // listening must never disturb playback.
    socket.on('error', () => { try { socket.close(); } catch (e) { } });
    try {
        const buf = Buffer.from(String(frame), 'utf8');
        socket.send(buf, 0, buf.length, targetPort, targetHost, () => {
            try { socket.close(); } catch (e) { }
        });
    } catch (e) {
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
function ipv4FromOctets(octets) {
    if (!Array.isArray(octets) || octets.length !== 4) return '';
    for (const n of octets) {
        if (!Number.isInteger(n) || n < 0 || n > 255) return '';
    }
    return octets[0] + '.' + octets[1] + '.' + octets[2] + '.' + octets[3];
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
const RECEIVER_STORE = (function () {
    try {
        const appId = tizenAppId();
        if (appId) return require('path').join('/opt/usr/apps', appId, 'data', 'tt-log-receiver.json');
    } catch (e) { }
    return null;
})();

function tizenAppId() {
    // /opt/usr/apps/<pkgId>/res/wgt/service/dist — walk back to <pkgId>.
    const parts = String(__dirname).split(String.fromCharCode(92)).join('/').split('/');
    const i = parts.indexOf('apps');
    return (i !== -1 && parts[i + 1]) ? parts[i + 1] : '';
}

function loadPersistedReceiver() {
    if (!RECEIVER_STORE) return;
    try {
        const raw = require('fs').readFileSync(RECEIVER_STORE, 'utf8');
        const saved = JSON.parse(raw);
        if (!saved) return;
        // Octets are stored as numbers, so nothing read back here is a string
        // that then becomes a request target. A file written by an older build
        // held a host string instead; it is parsed the same way rather than
        // trusted, so upgrading keeps the address instead of silently losing it.
        const octets = Array.isArray(saved.octets) ? saved.octets : parseIpv4(saved.host);
        const host = ipv4FromOctets(octets);
        if (!host || !isValidPort(saved.port)) return;
        _learnedOctets = octets.slice();
        _learnedHost = host;
        _learnedPort = Number(saved.port);
    } catch (e) {
        // Absent on first run, or unreadable — neither is worth reporting,
        // since reporting it would itself need a receiver.
    }
}

function persistReceiver() {
    if (!RECEIVER_STORE || !ipv4FromOctets(_learnedOctets) || !isValidPort(_learnedPort)) return;
    try {
        const fs = require('fs');
        const path = require('path');
        try { fs.mkdirSync(path.dirname(RECEIVER_STORE), { recursive: true, mode: 0o700 }); } catch (e) { }
        // Numbers, not the string that arrived over the network.
        fs.writeFileSync(RECEIVER_STORE, JSON.stringify({ octets: _learnedOctets, port: _learnedPort }), { mode: 0o600 });
    } catch (e) { }
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

function logServiceEvent(level, message) {
    relayLog({ ts: new Date().toISOString(), level, context: 'StandaloneService', message });
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

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
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
