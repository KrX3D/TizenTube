/**
 * dnsFallback.js — resolve names even where the system resolver never answers.
 *
 * Reported upstream as reisxd/TizenTube#702, on a 2024 S90D running Tizen 9:
 * the service starts, port 8101 accepts connections, CONNECT to an IP literal
 * succeeds, and CONNECT to a hostname never answers at all. Cobalt sends every
 * request through the proxy, waits, and shows "A network error has occurred".
 * dns.lookup in the service process never returns — not even for localhost —
 * while the network itself is fine. The suspected mechanism is the system
 * resolver pointing at a loopback forwarder that per-app loopback isolation
 * (#695) puts out of reach, which fits every symptom but is not proven.
 *
 * dns.lookup is getaddrinfo, which goes through that system resolver. c-ares —
 * dns.resolve4 and friends — talks to DNS servers over UDP itself and never
 * calls getaddrinfo, so it is unaffected. The fix is to answer through c-ares
 * when getaddrinfo will not answer.
 *
 * Three things this does differently from the patch in the issue, each because
 * of a TV that patch would have broken:
 *
 *   1. No dns.Resolver. That class arrived in Node 8.3, and Tizen 5.5's
 *      service engine is Node 4.4.3 — `new dns.Resolver()` is a TypeError
 *      there, which would take out the TV this fork is developed on. Babel
 *      transpiles the bundle's syntax for that engine but cannot conjure a
 *      missing builtin. Used when present, and the module-level dns.resolve4
 *      (which has existed throughout) when not.
 *
 *   2. No hardcoded router address. The servers come from dns.getServers(),
 *      minus the loopback entries that are the suspected cause, and public
 *      resolvers are used only if that leaves nothing at all.
 *
 *   3. getaddrinfo is still asked first, and still wins when it answers. A
 *      TV whose resolver works keeps using it; the second path opens only
 *      after getaddrinfo has stayed silent for HEDGE_MS. Switching every TV
 *      to c-ares to fix one would be a much bigger change than the evidence
 *      supports.
 */

const dns = require('dns');
const net = require('net');

// How long getaddrinfo gets on its own before c-ares is asked in parallel.
// Long enough that a working resolver — a few milliseconds, or one round trip
// on a cold cache — is never raced, short enough that a hang is not what the
// viewer waits through.
const HEDGE_MS = 400;

// After this many answers inside HEDGE_MS, getaddrinfo is trusted and nothing
// is hedged any more. A healthy TV therefore pays for at most this many extra
// queries, and usually none: the first lookups happen before any page loads.
const TRUST_AFTER = 3;

// Used only when dns.getServers() offers nothing that is not loopback, which
// is the case the issue describes. Worth being explicit about: it sends this
// TV's DNS queries to Cloudflare and Google, and it happens only when the app
// can otherwise resolve nothing at all and so does not work.
const PUBLIC_FALLBACKS = ['1.1.1.1', '8.8.8.8'];

function isLoopback(address) {
    const value = String(address || '');
    return value === '::1'
        || value === '0.0.0.0'
        || value === '::'
        || /^127\./.test(value)
        // getServers can return an address with a port, as [::1]:53.
        || /^\[?::1\]?(:\d+)?$/.test(value)
        || /^127\.[\d.]+(:\d+)?$/.test(value);
}

/** The DNS servers to ask directly, and whether they had to be invented. */
function pickServers() {
    let system = [];
    try {
        system = typeof dns.getServers === 'function' ? dns.getServers() : [];
    } catch (e) {
        system = [];
    }
    const usable = (system || []).filter(address => address && !isLoopback(address));
    if (usable.length) return { servers: usable, invented: false, system: system };
    return { servers: PUBLIC_FALLBACKS.slice(), invented: true, system: system };
}

/**
 * A resolve4/resolve6 pair bound to those servers, or null if c-ares cannot be
 * steered on this engine.
 *
 * dns.Resolver keeps the servers to itself, which is the better behaviour
 * because nothing else in the process is affected. Without it, the servers are
 * a process-wide setting, so they are only set when the system's own are
 * unusable — overwriting a working configuration to fix a broken one would be
 * its own bug.
 */
function makeResolver(choice, log) {
    if (typeof dns.Resolver === 'function') {
        try {
            const resolver = new dns.Resolver();
            resolver.setServers(choice.servers);
            log('INFO', `dns fallback: using dns.Resolver with ${choice.servers.join(', ')}`);
            return {
                resolve4: resolver.resolve4.bind(resolver),
                resolve6: typeof resolver.resolve6 === 'function' ? resolver.resolve6.bind(resolver) : null,
            };
        } catch (e) {
            log('WARN', `dns fallback: dns.Resolver refused those servers (${e && e.message}); falling back to the module-level resolver`);
        }
    }

    if (typeof dns.resolve4 !== 'function') {
        log('ERROR', 'dns fallback: this engine has neither dns.Resolver nor dns.resolve4, so names can only be resolved by the system resolver');
        return null;
    }

    if (choice.invented) {
        try {
            dns.setServers(choice.servers);
            log('INFO', `dns fallback: no usable system DNS server, so the process will ask ${choice.servers.join(', ')} directly`);
        } catch (e) {
            log('WARN', `dns fallback: could not set DNS servers (${e && e.message})`);
        }
    } else {
        log('INFO', `dns fallback: using dns.resolve4 with the system's own servers (${choice.servers.join(', ')})`);
    }

    return {
        resolve4: dns.resolve4.bind(dns),
        resolve6: typeof dns.resolve6 === 'function' ? dns.resolve6.bind(dns) : null,
    };
}

/**
 * Replace dns.lookup with one that falls back to c-ares.
 *
 * Everything in the process that opens a connection by name goes through
 * dns.lookup on the one cached dns module object — net, http, express,
 * node-fetch — so replacing this property is enough to reach all of them.
 * That is also why it is installed before anything listens.
 *
 * @param {(level: string, message: string) => void} logServiceEvent
 */
function installDnsFallback(logServiceEvent) {
    const log = typeof logServiceEvent === 'function' ? logServiceEvent : function () { };

    if (typeof dns.lookup !== 'function') return false;
    if (dns.lookup.__ttDnsFallback) return true;

    const choice = pickServers();
    const resolver = makeResolver(choice, log);
    if (!resolver) return false;

    const systemLookup = dns.lookup;
    // 'hedge'  — ask getaddrinfo, open the second path if it stays silent
    // 'system' — getaddrinfo has proved itself; nothing else is asked
    // 'cares'  — getaddrinfo has proved it will not answer
    let mode = 'hedge';
    let quickAnswers = 0;
    let reported = false;

    function normaliseArgs(options) {
        if (typeof options === 'number') return { family: options };
        if (!options || typeof options !== 'object') return {};
        return options;
    }

    function deliver(callback, wantAll, address, family) {
        if (wantAll) return callback(null, [{ address: address, family: family }]);
        return callback(null, address, family);
    }

    function lookup(hostname, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        const opts = normaliseArgs(options);
        const wantAll = !!opts.all;
        const name = String(hostname === undefined || hostname === null ? '' : hostname);

        if (typeof callback !== 'function') {
            return systemLookup.call(dns, hostname, options, callback);
        }

        // An address needs no resolving, and localhost is answered here because
        // the resolver that cannot answer for it is the broken one. Both match
        // what getaddrinfo would have said.
        const literal = net.isIP(name);
        if (literal) {
            return process.nextTick(() => deliver(callback, wantAll, name, literal));
        }
        if (name === 'localhost') {
            const wants6 = Number(opts.family) === 6;
            return process.nextTick(() => deliver(callback, wantAll, wants6 ? '::1' : '127.0.0.1', wants6 ? 6 : 4));
        }
        if (!name) {
            return systemLookup.call(dns, hostname, options, callback);
        }

        let settled = false;
        const startedAt = Date.now();

        const viaCares = (reason) => {
            const wants6 = Number(opts.family) === 6;
            const resolve = wants6 && resolver.resolve6 ? resolver.resolve6 : resolver.resolve4;
            const family = (wants6 && resolver.resolve6) ? 6 : 4;
            let called = false;
            try {
                resolve(name, (err, addresses) => {
                    if (called) return;
                    called = true;
                    if (settled) return;
                    if (err || !addresses || !addresses.length) {
                        // Nothing left to try that has not already been tried:
                        // getaddrinfo is either hung or has failed, and c-ares
                        // has failed too. The error is reported as c-ares saw
                        // it, which at least names a cause.
                        settled = true;
                        return callback(err || new Error(`no address for ${name}`));
                    }
                    settled = true;
                    if (mode !== 'cares' && reason === 'silent') {
                        mode = 'cares';
                        if (!reported) {
                            reported = true;
                            log('ERROR', `dns: the system resolver did not answer for ${name} within ${HEDGE_MS}ms, `
                                + `but ${choice.servers.join(', ')} answered directly. This is reisxd/TizenTube#702: `
                                + 'getaddrinfo on this TV never returns, so every request through the proxy would otherwise '
                                + 'hang until Cobalt gives up with "A network error has occurred". Names are now resolved '
                                + 'without it. A static DNS server set on the TV or in the router is the lasting fix.');
                        }
                    }
                    deliver(callback, wantAll, addresses[0], family);
                });
            } catch (e) {
                if (settled) return;
                settled = true;
                callback(e);
            }
        };

        if (mode === 'cares') return viaCares('known');

        let hedge = null;
        if (mode === 'hedge') {
            // Deliberately not unref'd. A lookup someone is waiting on is real
            // pending work, and an unref'd timer does not hold the event loop
            // open — so with getaddrinfo hung and nothing else going on, the
            // hedge never fired and the lookup never settled at all. Caught by
            // the test, which has no server listening to keep the loop alive;
            // on a TV the service's own listener hid it.
            hedge = setTimeout(() => {
                if (settled) return;
                viaCares('silent');
            }, HEDGE_MS);
        }

        let systemCalled = false;
        try {
            systemLookup.call(dns, name, opts, function (err, address, family) {
                if (systemCalled) return;
                systemCalled = true;
                if (hedge) clearTimeout(hedge);
                if (settled) return;

                if (!err) {
                    if (mode === 'hedge' && (Date.now() - startedAt) < HEDGE_MS) {
                        quickAnswers++;
                        if (quickAnswers >= TRUST_AFTER) mode = 'system';
                    }
                    settled = true;
                    // Passed straight through: with options.all the arguments
                    // are already the array shape the caller asked for.
                    return callback(null, address, family);
                }

                // A real failure rather than a hang — NXDOMAIN for a name that
                // does not exist, say. c-ares gets a turn anyway, since a
                // resolver that is misconfigured rather than unreachable fails
                // fast with the same codes.
                viaCares('error');
            });
        } catch (e) {
            if (hedge) clearTimeout(hedge);
            if (!settled) viaCares('threw');
        }
    }

    lookup.__ttDnsFallback = true;
    try {
        dns.lookup = lookup;
    } catch (e) {
        log('ERROR', `dns fallback: could not replace dns.lookup (${e && e.message})`);
        return false;
    }

    log('INFO', 'dns fallback: installed. The system resolver is asked first and still wins when it answers; '
        + `c-ares is asked as well only once a lookup has gone ${HEDGE_MS}ms without an answer.`);
    return true;
}

module.exports = { installDnsFallback: installDnsFallback, isLoopback: isLoopback, pickServers: pickServers };
