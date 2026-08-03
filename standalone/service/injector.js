// The TizenBrew-way of TizenTube. Uses CDP and SDB to inject the userscript.

const adbhost = require('adbhost');
const CDP = require('chrome-remote-interface');
const fetch = require('node-fetch');


var isConnecting = false;
const isTizen3 = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version').startsWith('3.0');

// Confirmed on-device: TizenBrew — a completely separate app/service, not
// sharing any code path with this one — hits the exact same "closes itself,
// needs several relaunches before it works" pattern. That rules out
// anything specific to this app's own code as the sole cause; it points at
// something systemic in how the SDB debug daemon / Cobalt's CDP session
// handling behaves across successive debug-session requests. TizenBrew's
// own debugger.js retries internally (up to 15 attempts) without the user
// needing to do anything — the difference is index.html here calls
// tizen.application.getCurrentApplication().exit() immediately after
// *triggering* the debugger, with no confirmation it actually succeeded; if
// that attempt then fails, there's nothing left alive to retry from, so the
// user has to manually relaunch the whole app every time (what they were
// doing by reopening ~5 times). This makes the service retry automatically
// instead, the way TizenBrew does.
let _activeSessionId = 0;
const MAX_RETRY_ATTEMPTS = 10;
const RETRY_DELAY_MS = 750;

// On this path the page is real https://youtube.com, so a page-initiated
// fetch to http://localhost:8099 (logServer.js's normal standalone relay) is
// cross-origin *and* HTTPS-page-to-HTTP-target — Cobalt blocks that as mixed
// content, silently. logServer.js instead queues log entries into
// window.__ttLogQueue for this path; drain it over the same CDP connection
// already open for injection (same technique TizenBrew's own service uses
// for the equivalent problem) so delivery doesn't depend on page-side
// networking at all.
function pollLogQueue(client, relayLog) {
    if (typeof relayLog !== 'function') return;

    // The interval below has no lifecycle tied to the CDP connection it
    // depends on. Confirmed on-device: once that connection closes (page
    // navigation, app exit, etc.), every subsequent tick threw an unhandled
    // "WebSocket.send... not opened" rejection on the exact same
    // Chrome.send/enqueueCommand path the real userscript-injection
    // evaluate() call uses — noisy at best, and plausibly contributing
    // instability right when injection is trying to happen. Stop on
    // disconnect, and as a defensive fallback in case that event doesn't
    // fire reliably, also stop after a few consecutive failures.
    let consecutiveFailures = 0;
    const interval = setInterval(() => {
        client.Runtime.evaluate({
            expression: '(function(){ var q = window.__ttLogQueue || []; window.__ttLogQueue = []; return JSON.stringify(q); })()',
            returnByValue: true
        }).then(result => {
            consecutiveFailures = 0;
            const value = result && result.result && result.result.value;
            if (!value) return;
            let entries;
            try { entries = JSON.parse(value); } catch (e) { return; }
            for (const entry of entries) {
                relayLog(entry, entry.__ttLogHost, entry.__ttLogPort);
            }
        }).catch(() => {
            consecutiveFailures++;
            if (consecutiveFailures >= 3) clearInterval(interval);
        });
    }, 1000);

    client.on('disconnect', () => clearInterval(interval));
}

function retryOrGiveUp(sessionId, attempt, args, relayLog, reason) {
    if (sessionId !== _activeSessionId) return; // superseded by a newer attempt, abort silently
    if (attempt >= MAX_RETRY_ATTEMPTS) {
        isConnecting = false;
        if (typeof relayLog === 'function') {
            relayLog({ ts: new Date().toISOString(), level: 'ERROR', context: 'Injector', message: `Giving up after ${MAX_RETRY_ATTEMPTS} attempts (${reason})` });
        }
        return;
    }
    if (typeof relayLog === 'function') {
        relayLog({ ts: new Date().toISOString(), level: 'INFO', context: 'Injector', message: `Retrying (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS}) after: ${reason}` });
    }
    setTimeout(() => startDebugger(args, relayLog, sessionId, attempt + 1), RETRY_DELAY_MS);
}

function connectToDebugger(host, port, args, relayLog, sessionId, attempt) {
    fetch(`http://${host}:${port}`).then(_ => {
        CDP({ host, port, local: true }, client => {
            if (sessionId !== _activeSessionId) {
                // A newer top-level call superseded this one while we were
                // still connecting — close this stale client, don't inject.
                try { client.close(); } catch (e) { }
                return;
            }
            // isConnecting deliberately NOT reset here — see the comment on
            // the isConnecting=true assignment in startDebugger for why it
            // now stays true for the whole session (all retries), not just
            // until a CDP socket opens.
            let injected = false;

            // Explicitly close the client on any failure path before
            // retrying, rather than only relying on the natural 'disconnect'
            // event — an evaluate() call can reject without the underlying
            // connection actually dropping, which would otherwise leave this
            // CDP client (and whatever device-side debug session it holds
            // open) dangling while a retry spins up an entirely new one.
            // Suspected of being why TizenBrew — a separate app entirely —
            // also needed several relaunches during the same broken window:
            // if debug sessions are a limited, shared, per-device resource,
            // leaked ones here would starve everyone, not just this app.
            function failAndRetry(reason) {
                try { client.close(); } catch (e) { }
                retryOrGiveUp(sessionId, attempt, args, relayLog, reason);
            }

            client.Runtime.enable();
            client.Page.enable();

            client.on('disconnect', () => {
                if (!injected) retryOrGiveUp(sessionId, attempt, args, relayLog, 'CDP disconnected before injection succeeded');
            });

            function logNonFatal(label) {
                return e => {
                    if (typeof relayLog === 'function') {
                        relayLog({ ts: new Date().toISOString(), level: 'ERROR', context: 'Injector', message: `${label} FAILED (non-fatal): ${e && e.stack || e}` });
                    }
                };
            }

            // Confirmed on-device: standalone reliably works exactly once
            // after any cache clear, then breaks on every subsequent launch
            // until the cache/data is cleared again (on Tizen 5.5, cache
            // alone sometimes wasn't enough — data had to be cleared too) —
            // on the pure CDP-injection path (real youtube.com, no proxy/
            // rewriting involved at all), reproduced repeatedly on both TVs.
            // A TV reboot alone did not fix it (rules out in-memory state).
            // Network.setCacheDisabled alone (a prior attempt at this fix)
            // only stops *new* caching for this session — it doesn't clear
            // what's already cached/stored from the previous run, and
            // didn't resolve the issue on retest. Actively clear cache,
            // cookies, and per-origin storage before navigating instead —
            // replicating what the user's manual Clear Cache/Clear Data
            // TV settings action does, programmatically, on every launch.
            // Each call is independently non-fatal (Page.setBypassCSP
            // already turned out not to exist on this Cobalt CDP
            // implementation; other domains may be similarly incomplete)
            // and all proceed to Page.navigate() regardless of outcome.
            const preNavigateCleanup = client.Network.enable()
                .then(() => client.Network.setCacheDisabled({ cacheDisabled: true }).catch(logNonFatal('Network.setCacheDisabled')))
                .then(() => client.Network.clearBrowserCache().catch(logNonFatal('Network.clearBrowserCache')))
                .then(() => client.Network.clearBrowserCookies().catch(logNonFatal('Network.clearBrowserCookies')))
                .then(() => client.Storage && client.Storage.clearDataForOrigin
                    ? client.Storage.clearDataForOrigin({
                        origin: 'https://www.youtube.com',
                        storageTypes: 'cookies,local_storage,indexeddb,cache_storage,service_workers,websql'
                    }).catch(logNonFatal('Storage.clearDataForOrigin'))
                    : null)
                .catch(logNonFatal('pre-navigate cleanup chain'));

            // Only start log-polling after injection has actually succeeded
            // once, not immediately alongside Page.navigate() — keeps it
            // fully out of the way of the critical early injection window.
            let logPollStarted = false;

            client.on('Runtime.executionContextCreated', m => {
                fetch('https://cdn.jsdelivr.net/npm/@krx3d/tizentube2/dist/userScript.js').then(res => res.text()).then(modFile => {
                    // Marker so the userscript can tell it's running under this
                    // standalone app even though this path loads real youtube.com
                    // directly (window.location.hostname isn't 'localhost' here,
                    // unlike the proxy path).
                    return client.Runtime.evaluate({ expression: 'window.__ttStandalone = true;\n' + modFile, contextId: m.context.id });
                }).then(() => {
                    injected = true;
                    // The one true success point for the whole session (all
                    // retries) — see startDebugger's isConnecting=true
                    // comment for why nothing before this point touches it.
                    isConnecting = false;
                    if (typeof relayLog === 'function') {
                        relayLog({ ts: new Date().toISOString(), level: 'INFO', context: 'Injector', message: `Injection evaluate() succeeded for contextId=${m.context.id}` });
                    }
                    if (!logPollStarted) {
                        logPollStarted = true;
                        pollLogQueue(client, relayLog);
                    }
                }).catch(e => {
                    if (typeof relayLog === 'function') {
                        relayLog({ ts: new Date().toISOString(), level: 'ERROR', context: 'Injector', message: `Injection evaluate() FAILED for contextId=${m.context.id}: ${e && e.stack || e}` });
                    }
                    failAndRetry(`injection evaluate() failed: ${e && e.message || e}`);
                });
            });

            // Wait for the cleanup attempts above so the clear actually takes
            // effect before this navigation, rather than racing it.
            preNavigateCleanup.then(() => {
                return client.Page.navigate({ url: `https://youtube.com/tv?additionalDataUrl=http%3A%2F%2Flocalhost%3A8085%2Fdial%2Fapps%2FYouTube${args ? `&${args}` : ''}` });
            }).catch(e => {
                if (typeof relayLog === 'function') {
                    relayLog({ ts: new Date().toISOString(), level: 'ERROR', context: 'Injector', message: `Page.navigate FAILED: ${e && e.stack || e}` });
                }
                failAndRetry(`Page.navigate failed: ${e && e.message || e}`);
            });

            // Confirmed on-device (Tizen 5.5): Cobalt's CDP implementation
            // doesn't support this method at all ('Page.setBypassCSP' wasn't
            // found) — an unhandled rejection right alongside Page.navigate().
            // Injection here is via Runtime.evaluate() of the userscript text
            // directly, not a page-loaded <script src> that CSP would block,
            // so this call was never actually load-bearing for injection to
            // work; catch it so an unsupported protocol method can't produce
            // an unhandled rejection here regardless of whether it's also
            // contributing to the connection instability seen on both TVs.
            client.Page.setBypassCSP({ enabled: true }).catch(e => {
                if (typeof relayLog === 'function') {
                    relayLog({ ts: new Date().toISOString(), level: 'ERROR', context: 'Injector', message: `Page.setBypassCSP FAILED (non-fatal, not required for eval-based injection): ${e && e.stack || e}` });
                }
            });
        })
    }).catch(e => {
        if (sessionId !== _activeSessionId) return; // superseded, stop waiting
        return setTimeout(() => connectToDebugger(host, port, args, relayLog, sessionId, attempt), 100);
    })
}

function canConnectToDaemon() {
    return fetch('http://127.0.0.1:8001/api/v2/').then(res => res.json())
        .then(json => {
            return { canConnectToDaemon: (json.device.developerIP === '127.0.0.1' || json.device.developerIP === '1.0.0.127') && json.device.developerMode === '1', ip: json.device.ip, isConnecting }
        }).catch(e => {
            return canConnectToDaemon();
        });
}

function startDebugger(args, relayLog, sessionId, attempt) {
    if (sessionId === undefined) {
        // Fresh top-level call (not a retry) — starts a new session,
        // superseding any retry loop still in flight from a previous one.
        _activeSessionId++;
        sessionId = _activeSessionId;
        // Set for the ENTIRE session up front, not just once an ADB/CDP
        // socket happens to be open. Confirmed on-device: every retry-path
        // handler below used to reset this back to false right before
        // scheduling its retry, leaving a real window (the 750ms
        // RETRY_DELAY_MS gap, or longer) where a freshly (re)launched
        // index.html could poll getState, see isConnecting:false, and
        // conclude "ready" — triggering its OWN brand-new top-level
        // /tizentube/debugger call. That call resets _activeSessionId's
        // attempt counter back to 0, which silently defeats
        // MAX_RETRY_ATTEMPTS forever: every hijack is itself a real
        // shell:0 debug launch (it steals the foreground, matching "closes
        // itself / reopens itself even from another app"), and each one
        // re-arms a fresh 10-attempt budget instead of ever reaching it.
        // Only a TV reboot (wiping this module's in-memory state) broke
        // the cycle. isConnecting now only goes false at the two true
        // terminal points: a successful injection, or actually giving up
        // after MAX_RETRY_ATTEMPTS.
        isConnecting = true;
    } else if (sessionId !== _activeSessionId) {
        return Promise.resolve(false); // superseded, abort silently
    }
    if (attempt === undefined) attempt = 0;

    return canConnectToDaemon().then(res => {
        if (!res.canConnectToDaemon) return false;
        if (sessionId !== _activeSessionId) return false; // superseded while checking
        const client = adbhost.createConnection({ host: '127.0.0.1', port: 26101 });

        // No 'error' listener previously existed on this stream at all — in
        // Node, an EventEmitter that emits 'error' with zero listeners
        // throws, which can crash the whole service process uncaught. That
        // would explain a service that silently disappears mid-attempt with
        // no log line at all (relayLog itself needs the process alive).
        client._stream.on('error', (err) => {
            if (sessionId !== _activeSessionId) return;
            if (typeof relayLog === 'function') {
                relayLog({ ts: new Date().toISOString(), level: 'ERROR', context: 'Injector', message: `ADB stream error before shell command: ${err && err.stack || err}` });
            }
            retryOrGiveUp(sessionId, attempt, args, relayLog, `ADB stream error: ${err && err.message || err}`);
        });

        // 'connect' never firing at all (daemon busy/unreachable) was
        // previously an indefinite, silent hang — nothing else in this
        // function would ever run, and no timeout existed to notice.
        const connectTimeout = setTimeout(() => {
            if (sessionId !== _activeSessionId) return;
            if (typeof relayLog === 'function') {
                relayLog({ ts: new Date().toISOString(), level: 'ERROR', context: 'Injector', message: 'ADB stream never connected within 5s' });
            }
            try { client._stream.end(); } catch (e) { }
            retryOrGiveUp(sessionId, attempt, args, relayLog, 'ADB stream connect timeout');
        }, 5000);

        client._stream.on('connect', () => {
            clearTimeout(connectTimeout);
            if (sessionId !== _activeSessionId) {
                try { client._stream.end(); } catch (e) { }
                return;
            }
            const packageId = tizen.application.getAppInfo().packageId;
            if (typeof relayLog === 'function') {
                relayLog({ ts: new Date().toISOString(), level: 'INFO', context: 'Injector', message: `ADB connected, requesting shell:0 debug ${packageId}.TizenTubeStandalone` });
            }

            // Safety net: without this, a stuck attempt (no debug shell
            // response, no CDP connection) would hang until something else
            // intervened. Confirmed on-device: because the service is
            // long-running in the background, that stuck state persisted
            // across every subsequent app launch until a full TV reboot
            // killed the service process. Re-armed on every retry attempt
            // (not just the first) so the whole retry budget (up to
            // MAX_RETRY_ATTEMPTS) is covered, not just one attempt's worth —
            // harmless no-op if a connection already succeeded by the time
            // this fires. Does NOT touch isConnecting — see the comment on
            // isConnecting=true in startDebugger for why it stays true
            // across every retry in this session, only going false at the
            // two true terminal points (success, or actually giving up).
            const safetyTimeout = setTimeout(() => {
                if (sessionId !== _activeSessionId) return;
                if (typeof relayLog === 'function') {
                    relayLog({ ts: new Date().toISOString(), level: 'ERROR', context: 'Injector', message: 'Safety-net timeout: no debug shell response or CDP connection within 20s' });
                }
                retryOrGiveUp(sessionId, attempt, args, relayLog, 'safety-net 20s timeout');
            }, 20000);

            // Always end this ADB stream, whether or not the debug line
            // ever appears — previously only happened inside the
            // dataString.includes('debug') branch, leaving the stream open
            // indefinitely on any attempt where that never matched. An ADB
            // host connection never released is exactly the kind of leak
            // that could starve later debug-session attempts, from this
            // app or (if it's a shared, per-device resource) any other.
            let streamEnded = false;
            const endStreamOnce = () => {
                if (streamEnded) return;
                streamEnded = true;
                try { client._stream.end(); } catch (e) { }
            };
            const streamEndFallback = setTimeout(endStreamOnce, 5000);

            const shellCmd = client.createStream(`shell:0 debug ${packageId}.TizenTubeStandalone${isTizen3 ? ' 0' : ''}`);
            shellCmd.on('error', (err) => {
                if (typeof relayLog === 'function') {
                    relayLog({ ts: new Date().toISOString(), level: 'ERROR', context: 'Injector', message: `shell:0 debug stream error: ${err && err.stack || err}` });
                }
                clearTimeout(safetyTimeout);
                endStreamOnce();
                retryOrGiveUp(sessionId, attempt, args, relayLog, `shell stream error: ${err && err.message || err}`);
            });
            shellCmd.on('data', (data) => {
                const dataString = data.toString();
                // Always log the raw response — previously only logged (and
                // acted on) when it contained 'debug'; anything else (an
                // error from the device's wascmd dispatcher, an empty/
                // unexpected reply, a package-id mismatch after a reinstall)
                // was silently dropped, with no way to ever see it.
                if (typeof relayLog === 'function') {
                    relayLog({ ts: new Date().toISOString(), level: 'INFO', context: 'Injector', message: `shell:0 debug raw response: ${JSON.stringify(dataString.slice(0, 500))}` });
                }
                if (dataString.includes('debug')) {
                    const port = Number(dataString.substr(dataString.indexOf(':') + 1, 6).replace(' ', ''));
                    clearTimeout(safetyTimeout);
                    connectToDebugger(res.ip, port, args, relayLog, sessionId, attempt);
                    clearTimeout(streamEndFallback);
                    setTimeout(endStreamOnce, 1000);
                }
            });
        });

        return true;
    });
}

module.exports = {
    startDebugger,
    canConnectToDaemon
};