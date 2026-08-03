// The TizenBrew-way of TizenTube. Uses CDP and SDB to inject the userscript.

const adbhost = require('adbhost');
const CDP = require('chrome-remote-interface');
const fetch = require('node-fetch');


var isConnecting = false;
const isTizen3 = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version').startsWith('3.0');

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

function connectToDebugger(host, port, args, relayLog) {
    fetch(`http://${host}:${port}`).then(_ => {
        CDP({ host, port, local: true }, client => {
            isConnecting = false;
            client.Runtime.enable();
            client.Page.enable();

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
                    if (!logPollStarted) {
                        logPollStarted = true;
                        pollLogQueue(client, relayLog);
                    }
                }).catch(e => {
                    client.Runtime.evaluate({ expression: 'alert("Failed to request to JSDelivr CDN.")', contextId: m.context.id });
                });
            });

            client.Page.navigate({ url: `https://youtube.com/tv?additionalDataUrl=http%3A%2F%2Flocalhost%3A8085%2Fdial%2Fapps%2FYouTube${args ? `&${args}` : ''}` });

            client.Page.setBypassCSP({ enabled: true });
        })
    }).catch(e => {
        return setTimeout(() => connectToDebugger(host, port, args, relayLog), 100);
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

function startDebugger(args, relayLog) {
    return canConnectToDaemon().then(res => {
        if (!res.canConnectToDaemon) return false;
        const client = adbhost.createConnection({ host: '127.0.0.1', port: 26101 });

        client._stream.on('connect', () => {
            const packageId = tizen.application.getAppInfo().packageId;
            isConnecting = true;
            // Safety net: if this attempt never completes — the shell command
            // never produces a 'debug' line, or connectToDebugger's own CDP
            // connection never succeeds and keeps retrying — isConnecting
            // would otherwise stay stuck true forever, since only a
            // successful CDP() connection resets it. Confirmed on-device:
            // because this service is long-running in the background, that
            // stuck state persisted across every subsequent app launch
            // (useInjectorOrProxy's getState kept returning isConnecting:
            // true, a state it didn't even have a branch for) until a full
            // TV reboot killed the service process. Bound the worst case to
            // a timeout instead of a permanent hang; harmless no-op if a
            // connection already succeeded by the time this fires.
            setTimeout(() => { isConnecting = false; }, 20000);
            const shellCmd = client.createStream(`shell:0 debug ${packageId}.TizenTubeStandalone${isTizen3 ? ' 0' : ''}`);
            shellCmd.on('data', (data) => {
                const dataString = data.toString();
                if (dataString.includes('debug')) {
                    const port = Number(dataString.substr(dataString.indexOf(':') + 1, 6).replace(' ', ''));
                    connectToDebugger(res.ip, port, args, relayLog);
                    setTimeout(() => client._stream.end(), 1000);
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