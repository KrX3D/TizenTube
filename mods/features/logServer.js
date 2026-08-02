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

const MAX_QUEUE = 300;

export function isEnabled() {
    try { return !!configRead('logServerEnabled'); } catch { return false; }
}

function pushToQueue(entry) {
    if (!Array.isArray(window.__ttLogQueue)) window.__ttLogQueue = [];
    if (window.__ttLogQueue.length < MAX_QUEUE) window.__ttLogQueue.push(entry);
}

export function sendRemotePayload(_url, entry) {
    if (!isEnabled()) return false;

    if (window.location.hostname === 'localhost' || window.__ttStandalone === true) {
        // Standalone mode: no TizenBrew present. Relay through the local
        // standalone service instead. The service forwards to the PC
        // receiver configured here.
        //
        // Two sub-paths, detected differently since only one of them is
        // actually same-origin with this fetch:
        // - proxy path: page is served from localhost:8099 itself (same
        //   origin, plain HTTP → plain HTTP, no restrictions).
        // - CDP-injection path (injector.js): page is real https://youtube.com
        //   — window.__ttStandalone is set there since hostname isn't
        //   'localhost'. This fetch to http://localhost:8099 is cross-origin
        //   *and* HTTPS-page-to-HTTP-target, which some engines block as
        //   mixed content. Unconfirmed on-device whether Cobalt enforces
        //   that; if entries never arrive from this path specifically, that's
        //   the first thing to check.
        const host = configRead('logServerHost');
        const port = configRead('logServerPort');
        if (!host) return false;
        try {
            fetch('http://localhost:8099/tizentube/log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ host, port, entry }),
            }).catch(function () { });
        } catch (_) { }
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
                pushToQueue(entry);
            } catch (_) {}
        }
        return result;
    };
}

install();
