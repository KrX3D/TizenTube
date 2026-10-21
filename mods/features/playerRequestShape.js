import { appendFileOnlyLog } from './hideWatched.js';

/**
 * playerRequestShape.js — what the app sends to /player, and what we send.
 *
 * Mark as watched works by asking /player for the video, then firing the
 * playback-tracking pings the response carries. The ask is refused:
 *
 *   markWatched.params     {"videoId":"Fq-qILSiZmA","from":"tile","identity":true}
 *   markWatched.noTracking {"status":"UNPLAYABLE","hadParams":true,
 *                           "reason":"Die Seite muss neu geladen werden."}
 *
 * hadParams:true is the part that matters. The signed params were there, they
 * were sent, and the answer was the same as without them — so the missing
 * params were never the cause, which is what three earlier readings of this
 * said. "Die Seite muss neu geladen werden" is YouTube rejecting the request
 * itself, and the app makes the same request successfully seconds earlier for
 * the same video on the same client.
 *
 * So the difference is in what we send, and that is entirely ours to fix. This
 * records the shape of both: key names only, once per distinct shape, for the
 * app's requests and for ours, so the two can be read side by side and the
 * missing field named instead of guessed. signatureTimestamp is the usual
 * answer to this error, but naming it in advance is how the last three
 * readings went wrong.
 *
 * Key names only — never values. A player payload carries signed tokens and
 * identifies the account, and none of that belongs in a file that gets pasted
 * into an issue.
 */

const PLAYER_PATH = '/youtubei/v1/player';

// One line per distinct shape. Two shapes are expected — the app's and ours —
// so the cap is for a client that varies its payload per request rather than
// for normal use.
const MAX_SHAPES = 8;
const _seen = {};
let _shapeCount = 0;

// Nested objects worth describing rather than just naming. A payload's top
// level is mostly scalars; what differs between a request that works and one
// that does not tends to be inside these.
const DESCEND = ['playbackContext', 'contentPlaybackContext', 'context', 'client', 'user', 'request'];

/** Key names, one level deep, descending only where it is informative. */
function shapeOf(value, depth) {
    if (!value || typeof value !== 'object' || depth > 3) return null;
    const out = {};
    const names = Object.keys(value).sort();
    for (let i = 0; i < names.length; i++) {
        const name = names[i];
        const child = value[name];
        if (child && typeof child === 'object' && !Array.isArray(child) && DESCEND.indexOf(name) !== -1) {
            out[name] = shapeOf(child, depth + 1);
        } else if (Array.isArray(child)) {
            out[name] = '[' + child.length + ']';
        } else {
            // The type, not the value: enough to see that a field is there
            // and roughly what it is.
            out[name] = typeof child;
        }
    }
    return out;
}

function note(request) {
    try {
        const payload = request && request.payload;
        if (!payload) return;
        // From the XHR hook there is no request object to read an identity
        // from, only a body — so that field says "not known here" rather than
        // "no identity", which are different things.
        const identityKnown = Object.prototype.hasOwnProperty.call(request, 'identity')
            || Object.prototype.hasOwnProperty.call(request, 'path');
        const shape = shapeOf(payload, 0);
        const mine = !!window.__ttMarkWatchedInFlight;
        const signature = (mine ? 'mine|' : 'app|') + (identityKnown ? 'client|' : 'xhr|') + JSON.stringify(shape);
        if (_seen[signature] || _shapeCount >= MAX_SHAPES) return;
        _seen[signature] = true;
        _shapeCount++;
        appendFileOnlyLog('playerRequest.shape', {
            // Which side made it, which is the whole point of the comparison.
            mine,
            // No `request &&` here: the early return above already proved it,
            // since a falsy request could not have produced a payload.
            hasIdentity: identityKnown ? !!request.identity : null,
            via: identityKnown ? 'client' : 'xhr',
            keys: Object.keys(payload).sort(),
            shape,
        });
    } catch (_) { }
}

/**
 * Watch the InnerTube client's own fetch.
 *
 * Wrapped rather than hooked at the network layer because the payload is the
 * subject: by the time it is a request body it has been serialised and the
 * client's own context merged in, and it is the merge that is in question.
 *
 * The call is passed through untouched. A thrown observer would break playback
 * for a diagnostic, so it cannot throw.
 */
function wrap(client) {
    if (!client || typeof client.fetch !== 'function' || client.__ttShapeWatched) return false;
    const original = client.fetch;
    client.fetch = function (request) {
        try {
            if (request && request.path === PLAYER_PATH) note(request);
        } catch (_) { }
        return original.apply(this, arguments);
    };
    client.__ttShapeWatched = true;
    return true;
}

/**
 * The same, at the XHR layer, which is the only place the app's own request
 * can be seen.
 *
 * The client wrapper caught ours and nothing else:
 *
 *   playerRequest.shape {"mine":true,"hasIdentity":true,
 *     "keys":["contentCheckOk","params","playbackContext","racyCheckOk","videoId"]}
 *
 * One line, and no mine:false to compare it against. The app does not reach
 * /player through KabukiInnerTubeClient.fetch — whatever it uses, wrapping
 * that one client cannot see it, and a comparison with nothing on the other
 * side is not a comparison.
 *
 * XMLHttpRequest is below all of it. Cobalt's fetch is a polyfill over XHR,
 * so one hook here catches both however the request was made. The body is
 * read, shaped and dropped; the request is not touched.
 */
function watchXhr() {
    try {
        const XHR = window.XMLHttpRequest;
        if (!XHR || !XHR.prototype || XHR.prototype.__ttShapeWatched) return false;
        const open = XHR.prototype.open;
        const send = XHR.prototype.send;
        if (typeof open !== 'function' || typeof send !== 'function') return false;

        XHR.prototype.open = function (method, url) {
            try { this.__ttUrl = String(url || ''); } catch (_) { }
            return open.apply(this, arguments);
        };

        XHR.prototype.send = function (body) {
            try {
                if (this.__ttUrl && this.__ttUrl.indexOf(PLAYER_PATH) !== -1 && typeof body === 'string') {
                    // Only a JSON body is shaped. Anything else is not the
                    // payload this is about, and parsing it would be a
                    // guess at someone else's format.
                    if (body.charAt(0) === '{') {
                        note({ payload: JSON.parse(body) });
                    }
                }
            } catch (_) { }
            return send.apply(this, arguments);
        };

        XHR.prototype.__ttShapeWatched = true;
        return true;
    } catch (_) {
        return false;
    }
}

function innerTubeClient() {
    try {
        const mappings = Object.values(window._yttv || {}).find(a => a && a.mappings);
        return (mappings && mappings.get('KabukiInnerTubeClient')) || null;
    } catch (_) {
        return null;
    }
}

// The XHR hook goes on at once. It needs nothing from the app, and the app's
// own first player request can come before the client is even reachable —
// which is one reason the client wrapper never saw one.
if (watchXhr()) {
    appendFileOnlyLog('playerRequest.watchingXhr', {});
}

// The client wrapper stays as well. It is the one that can say an identity
// went with the request, which the body alone cannot.
//
// The client appears some way into startup, and the app's first player request
// follows soon after — so this waits for it rather than racing it, and stops
// as soon as it has wrapped one.
const WAIT_EVERY_MS = 500;
const WAIT_ATTEMPTS = 120;
let _attempts = 0;
const waiting = setInterval(() => {
    _attempts++;
    const client = innerTubeClient();
    if (client && wrap(client)) {
        clearInterval(waiting);
        appendFileOnlyLog('playerRequest.watching', { afterMs: _attempts * WAIT_EVERY_MS });
    } else if (_attempts >= WAIT_ATTEMPTS) {
        clearInterval(waiting);
        appendFileOnlyLog('playerRequest.noClient', { afterSec: Math.round(_attempts * WAIT_EVERY_MS / 1000) });
    }
}, WAIT_EVERY_MS);
try { if (typeof waiting.unref === 'function') waiting.unref(); } catch (_) { }

export { shapeOf, wrap, watchXhr };
