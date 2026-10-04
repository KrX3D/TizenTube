import { appendFileOnlyLog } from './hideWatched.js';

/**
 * settingsChannel.js — how the page reaches the service that does LAN work.
 *
 * Settings transfer needs request and response: hand over this TV's settings,
 * ask what another TV has. Where the page can send that depends on how
 * TizenTube was loaded, and the answer is not the same in all three cases.
 * This is the same wall remote logging hit, and the shapes of the answers are
 * taken from what was already proven on-device there (see logServer.js).
 *
 *   direct      Standalone, proxy path. The page is served from
 *               localhost:8099, so plain HTTP to another port on this TV is
 *               fine. One fetch, nothing clever.
 *
 *   bridge      Standalone, CDP-injection path. The page is real
 *               https://youtube.com, where a fetch to anything http:// is
 *               blocked as mixed content — confirmed on-device for logging,
 *               which is why that queues instead. So requests queue too, and
 *               injector.js carries them over the CDP connection it already
 *               holds and writes the answer back into the page.
 *
 *   tizenbrew   TizenBrew-injected mode. There is no standalone service, but
 *               this project's own DIAL service is running, and in a plain
 *               HTTP context the page can reach it directly. In TizenBrew's
 *               HTTPS Cobalt context it cannot, and TizenBrew's own CDP poll
 *               only carries log lines one way, so there is nothing to carry a
 *               request back on: the feature reports itself unavailable rather
 *               than appearing to work.
 */

// The DIAL service, which is where the settings routes live: it is the one
// server this project runs in both modes.
const SERVICE_ORIGIN = 'http://localhost:8085';
const BRIDGE_TIMEOUT_MS = 15000;

export function channelKind() {
    try {
        if (window.location.hostname === 'localhost') return 'direct';
        if (window.__ttStandalone === true) return 'bridge';
        if (window.location.protocol === 'http:') return 'tizenbrew';
        return 'unavailable';
    } catch (e) {
        return 'unavailable';
    }
}

export function channelAvailable() {
    return channelKind() !== 'unavailable';
}

let _nextId = 1;

/**
 * Ask the service for something.
 *
 * Resolves with the parsed body, or rejects. Every caller treats a rejection
 * as "this did not happen" and says so on screen — there is no half-done
 * state to recover from, because nothing is written until the import screen
 * applies it.
 */
export function serviceRequest(path, body) {
    const kind = channelKind();
    if (kind === 'unavailable') {
        return Promise.reject(new Error('unavailable'));
    }
    if (kind === 'bridge') return bridgeRequest(path, body);

    const url = SERVICE_ORIGIN + path;
    const options = body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : { method: 'GET' };
    return fetch(url, options).then((res) => {
        if (!res.ok && res.status !== 404) throw new Error('HTTP ' + res.status);
        return res.json();
    });
}

/**
 * The injected path: leave the request in the page for injector.js to find.
 *
 * The poll it is drained by runs every two seconds and is deliberately kept
 * cheap, so this adds no work of its own while nothing is being transferred:
 * an empty queue costs the poll nothing it was not already paying.
 */
function bridgeRequest(path, body) {
    return new Promise((resolve, reject) => {
        let id;
        try {
            if (!Array.isArray(window.__ttRequestQueue)) window.__ttRequestQueue = [];
            if (!window.__ttRequestResults || typeof window.__ttRequestResults !== 'object') {
                window.__ttRequestResults = {};
            }
            id = 'r' + (_nextId++);
            window.__ttRequestQueue.push({ id, path, body: body || null });
        } catch (err) {
            return reject(err);
        }

        const startedAt = Date.now();
        const poll = setInterval(() => {
            let result;
            try {
                result = window.__ttRequestResults[id];
            } catch (e) {
                result = null;
            }
            if (result) {
                clearInterval(poll);
                try { delete window.__ttRequestResults[id]; } catch (e) { /* no matter */ }
                if (result.error) return reject(new Error(result.error));
                return resolve(result.body);
            }
            if (Date.now() - startedAt > BRIDGE_TIMEOUT_MS) {
                clearInterval(poll);
                appendFileOnlyLog('settingsTransfer.bridge.timeout', { path });
                reject(new Error('timeout'));
            }
        }, 250);
    });
}

/** Start serving this TV's settings to the other one. */
export function startSharing(payload) {
    return serviceRequest('/tizentube/settings/share', { payload });
}

/** Stop, which is what closing the export screen does. */
export function stopSharing() {
    return serviceRequest('/tizentube/settings/stop', {}).catch(() => null);
}

/** Other TVs on this network running TizenTube. */
export function findPeers() {
    return serviceRequest('/tizentube/settings/peers');
}

/** What that TV is sharing. */
export function fetchPeerSettings(host) {
    return serviceRequest('/tizentube/settings/peer?host=' + encodeURIComponent(host));
}
