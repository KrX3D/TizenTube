/**
 * logServer.js — Remote log forwarding via TizenBrew CDP queue
 *
 * TizenTube pushes log entries into window.__ttLogQueue (a plain JS array).
 * TizenBrew's service polls that queue every second via CDP Runtime.evaluate
 * and forwards entries into logBus → remoteLogger → PS1 receiver on PC.
 *
 * No XHR or WebSocket is used — Cobalt blocks both from the HTTPS YouTube TV
 * page context. The CDP channel (already open for module injection) is the
 * only reliable path back to the TizenBrew service.
 *
 * Enable/disable: Settings → Miscellaneous → Remote Log Server → Enable Remote Logging
 */

import { configRead } from '../config.js';

// Lowered from 300 — this queue gets JSON.stringify'd in-page, on the same
// thread as YouTube's own rendering, once per poll (injector.js
// pollLogQueue). Confirmed on-device: with regular console.* output now
// also flowing through this queue (not just the sparser file-only
// stream), the larger the worst-case backlog, the more that poll competes
// with real page work — observed as hangs during navigation specifically
// when remote logging was enabled.
const MAX_QUEUE = 100;

export function isEnabled() {
    try { return !!configRead('logServerEnabled'); } catch { return false; }
}

function pushToQueue(entry) {
    if (!Array.isArray(window.__ttLogQueue)) window.__ttLogQueue = [];
    if (window.__ttLogQueue.length < MAX_QUEUE) window.__ttLogQueue.push(entry);
}

// Long messages are split into multiple sent parts rather than truncated —
// previously a message over the length cap was cut off and the remainder
// silently discarded. Each part is sent as its own log entry, tagged
// "[i/N]", so nothing is lost — the PC receiver just sees consecutive
// lines instead of one long one. Chunk size is generous (not the old
// display-oriented 500) since this only bounds a single queue/HTTP
// payload, not on-screen readability (that's handled separately in
// visualConsole.js for the visual console specifically).
const MAX_MSG_CHUNK = 1000;

function buildFormatted(entry, message) {
    const ts = entry.ts || new Date().toISOString();
    const level = entry.level || 'INFO';
    const context = entry.context || 'TizenTube';
    return `[${ts}] [${level}] [${context}] ${message}`;
}

function sendOne(_url, entry) {
    if (window.location.hostname === 'localhost' || window.__ttStandalone === true) {
        // Standalone mode: no TizenBrew present. Two sub-paths, delivered
        // differently since only one is actually same-origin with a fetch:
        const host = configRead('logServerHost');
        const port = configRead('logServerPort');
        if (!host) return false;

        if (window.location.hostname === 'localhost') {
            // Proxy path: page is served from localhost:8099 itself — same
            // origin, plain HTTP → plain HTTP, no restrictions. Relay
            // directly through the local standalone service, which
            // forwards to the PC receiver.
            try {
                fetch('http://localhost:8099/tizentube/log', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ host, port, entry }),
                }).catch(function () { });
            } catch (_) { }
        } else {
            // CDP-injection path (injector.js): page is real
            // https://youtube.com — a fetch to http://localhost:8099 from
            // here is cross-origin *and* HTTPS-page-to-HTTP-target, which
            // Cobalt blocks as mixed content (confirmed on-device: entries
            // never arrived). Queue instead; injector.js drains this over
            // the same CDP connection already open for injection, so
            // delivery doesn't depend on page-side networking at all.
            pushToQueue(Object.assign({}, entry, { __ttLogHost: host, __ttLogPort: port }));
        }
        return true;
    }

    // TizenBrew-injected mode: try HTTP POST to the TizenBrew relay first (works
    // when TizenTube runs in a plain HTTP context, e.g. Tizen 5.5 proxy path where
    // Cobalt doesn't block localhost XHR). Falls back to __ttLogQueue which is
    // drained by TizenBrew's CDP poll (the only path that works in the HTTPS
    // Cobalt context on 6.5+).
    try {
        fetch('http://127.0.0.1:8081/tv-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry),
        }).catch(function () {
            pushToQueue(entry);
        });
    } catch (_) {
        pushToQueue(entry);
    }
    return true;
}

// Shared by the "Test Log Server Connection" settings button and the blue
// remote-key shortcut (speedUI.js) — both need the same send-a-ping-and-
// report-the-outcome logic, so it lives here once instead of duplicated.
// Returns a result object rather than showing a toast itself, since the two
// callers use different toast/i18n setups and this module intentionally has
// no UI dependencies.
export function sendTestPing() {
    if (!isEnabled()) return { enabled: false, queued: false };
    const ts = new Date().toISOString();
    const queued = sendRemotePayload(null, {
        ts,
        level: 'INFO',
        context: 'TizenTube',
        message: 'Manual test ping',
        _formatted: `[${ts}] [INFO] [TizenTube] Manual test ping`,
    });
    return { enabled: true, queued };
}

export function sendRemotePayload(_url, entry) {
    if (!isEnabled()) return false;

    const fullMessage = (entry && entry.message) || '';
    if (fullMessage.length <= MAX_MSG_CHUNK) return sendOne(_url, entry);

    const totalParts = Math.ceil(fullMessage.length / MAX_MSG_CHUNK);
    let anySent = false;
    for (let i = 0; i < totalParts; i++) {
        const chunkMsg = `[${i + 1}/${totalParts}] ` + fullMessage.slice(i * MAX_MSG_CHUNK, (i + 1) * MAX_MSG_CHUNK);
        const chunkedEntry = Object.assign({}, entry, {
            message: chunkMsg,
            _formatted: buildFormatted(entry, chunkMsg),
        });
        if (sendOne(_url, chunkedEntry)) anySent = true;
    }
    return anySent;
}

// ── Install ───────────────────────────────────────────────────────────────────

function install() {
    if (window.__ttLogServerInstalled) return;
    window.__ttLogServerInstalled = true;

    if (!Array.isArray(window.__ttFileOnlyLogs)) window.__ttFileOnlyLogs = [];
    const origPush = Array.prototype.push;
    const arr = window.__ttFileOnlyLogs;
    arr.push = function (...args) {
        const result = origPush.apply(this, args);
        if (!isEnabled()) return result;
        for (const line of args) {
            try {
                const raw = String(line);
                const m = raw.match(/^\[([^\]]+)\] \[TT_ADBLOCK_FILE\] (\S+) ([\s\S]*)$/);
                let entry;
                if (m) {
                    const ts      = m[1];
                    const label   = m[2];
                    const payload = (() => { try { return JSON.parse(m[3]); } catch { return m[3]; } })();
                    const payloadStr = typeof payload === 'object' ? JSON.stringify(payload) : String(payload);
                    entry = {
                        ts,
                        level:      'INFO',
                        label,
                        payload,
                        _formatted: `[${ts}] [INFO] [TizenTube] ${label} ${payloadStr}`,
                        context:    'TizenTube',
                        message:    `${label} ${payloadStr}`,
                        data:       payload,
                    };
                } else {
                    const ts = new Date().toISOString();
                    entry = {
                        ts,
                        level:      'INFO',
                        label:      'raw',
                        payload:    raw,
                        _formatted: `[${ts}] [INFO] [TizenTube] ${raw}`,
                        context:    'TizenTube',
                        message:    raw,
                    };
                }
                // Routed through sendRemotePayload (not pushToQueue directly)
                // so long file-only entries (e.g. parse.error stack traces)
                // get the same chunked-send treatment as everything else —
                // split into multiple sent parts instead of lost entirely.
                sendRemotePayload(null, entry);
            } catch (_) {}
        }
        return result;
    };
}

install();
