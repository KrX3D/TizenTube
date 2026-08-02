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
    setInterval(() => {
        client.Runtime.evaluate({
            expression: '(function(){ var q = window.__ttLogQueue || []; window.__ttLogQueue = []; return JSON.stringify(q); })()',
            returnByValue: true
        }).then(result => {
            const value = result && result.result && result.result.value;
            if (!value) return;
            let entries;
            try { entries = JSON.parse(value); } catch (e) { return; }
            for (const entry of entries) {
                relayLog(entry, entry.__ttLogHost, entry.__ttLogPort);
            }
        }).catch(() => { });
    }, 1000);
}

function connectToDebugger(host, port, args, relayLog) {
    fetch(`http://${host}:${port}`).then(_ => {
        CDP({ host, port, local: true }, client => {
            isConnecting = false;
            client.Runtime.enable();
            client.Page.enable();

            client.on('Runtime.executionContextCreated', m => {
                fetch('https://cdn.jsdelivr.net/npm/@krx3d/tizentube2/dist/userScript.js').then(res => res.text()).then(modFile => {
                    // Marker so the userscript can tell it's running under this
                    // standalone app even though this path loads real youtube.com
                    // directly (window.location.hostname isn't 'localhost' here,
                    // unlike the proxy path).
                    client.Runtime.evaluate({ expression: 'window.__ttStandalone = true;\n' + modFile, contextId: m.context.id });
                }).catch(e => {
                    client.Runtime.evaluate({ expression: 'alert("Failed to request to JSDelivr CDN.")', contextId: m.context.id });
                });
            });

            client.Page.navigate({ url: `https://youtube.com/tv?additionalDataUrl=http%3A%2F%2Flocalhost%3A8085%2Fdial%2Fapps%2FYouTube${args ? `&${args}` : ''}` });

            client.Page.setBypassCSP({ enabled: true });

            pollLogQueue(client, relayLog);
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