import { appendFileOnlyLog } from './hideWatched.js';
import { noteProgressChanged } from './watchProgressStore.js';

/**
 * markWatched.js — tell YouTube a video has been watched, without watching it.
 *
 * Asked for on the subscriptions page: a video you have already seen elsewhere,
 * or have decided not to watch, sits in the shelf forever. Hiding it locally
 * was not what was wanted — it had to count on the account, so the same video
 * is also gone when you open YouTube on a PC.
 *
 * There is no "mark as watched" endpoint. What there is, and what yt-dlp's
 * --mark-watched uses, is the playback tracking YouTube's own player reports
 * to. Every /youtubei/v1/player response carries a playbackTracking block with
 * two URLs, and the player pings them as it plays:
 *
 *   videostatsPlaybackUrl   "a playback started", which is what writes the
 *                           entry into watch history
 *   videostatsWatchtimeUrl  "this much has been played", which is what moves
 *                           the red progress bar on the thumbnail
 *
 * Both are pinged here, the second claiming the whole duration, because history
 * alone leaves the video looking unwatched where it is listed. A CPN — a client
 * playback nonce the player generates per playback — ties the two together, and
 * YouTube ignores a watchtime report whose CPN it has not seen start.
 *
 * Honest about what is not known: these are undocumented and YouTube can stop
 * honouring them from a TV client at any time, in which case this quietly does
 * nothing on the account while still hiding the video locally. Every step is
 * logged with its HTTP status so a capture says which half worked.
 */

// The alphabet YouTube's own player uses for a CPN, and its length. Both
// matter: a nonce of the wrong shape is rejected before anything is recorded.
const CPN_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
const CPN_LENGTH = 16;

function makeCpn() {
    let out = '';
    // crypto.getRandomValues is absent on some of these engines — Cobalt on
    // 5.5 among them, which is why the service needed a polyfill for it once
    // already. Math.random is fine here: this is a correlation id, not a
    // secret.
    for (let i = 0; i < CPN_LENGTH; i++) {
        out += CPN_ALPHABET.charAt(Math.floor(Math.random() * CPN_ALPHABET.length));
    }
    return out;
}

function innerTubeClient() {
    try {
        const mappings = Object.values(window._yttv || {}).find(a => a && a.mappings);
        return mappings?.get('KabukiInnerTubeClient') || null;
    } catch (_) {
        return null;
    }
}

function identityService() {
    try {
        const mappings = Object.values(window._yttv || {}).find(a => a && a.mappings);
        return mappings?.get('CurrentIdentityService') || null;
    } catch (_) {
        return null;
    }
}

/**
 * The params for a video, asked of /next when the tile has none.
 *
 * A subscriptions tile turned out to carry no params at all — the capture said
 * so outright:
 *
 *   markWatched.noTracking {"videoId":"MSD1WLg1l5s","trackingKeys":[],
 *     "status":"UNPLAYABLE","reason":"Die Seite muss neu geladen werden.",
 *     "hadParams":false}
 *
 * So they have to come from somewhere, and /next is the one request in this
 * codebase known to work from here: requestNextAndNavigateChannel has been
 * asking it for the channel behind a video for a while. Its response carries
 * the endpoint for the video it was asked about, and that endpoint has the
 * params a player request wants.
 *
 * playerParams is preferred over params where both exist, because they are not
 * the same token: params is what /next takes and playerParams is what /player
 * takes, and sending one where the other belongs is a plausible reading of
 * "Die Seite muss neu geladen werden".
 *
 * Resolves to a string or null. A failure here is not fatal — the player
 * request is still made, just as poorly as before, which is no worse than not
 * trying.
 */
/**
 * Whether a response carries a feedback token, and what sits around it.
 *
 * Names only. A feedback token is an opaque capability tied to the account and
 * to one action; it has no place in a log file that gets posted into an issue.
 * The labels beside it are what identify the action, and those are what decide
 * whether this route is usable.
 */
function describeFeedback(node, depth) {
    // paths as well as labels. A label can be absent — the first capture had
    // three tokens and not one label — but the chain of keys leading to a
    // token is always there, and it identifies the action structurally:
    // a token under engagementPanels is a different thing from one under an
    // overlay or a menu, whatever either is called.
    const out = { tokens: 0, labels: [], keys: [], paths: [] };
    const MAX_PATHS = 6;

    /**
     * Whatever reads as this node's own label, or null.
     *
     * Widened after the first capture came back with three tokens and no
     * labels at all: title and label were the only two fields read, and
     * whatever carries the text beside these tokens is neither. Every field
     * here is a place the app puts a human-readable string, and the first one
     * found wins.
     */
    const labelOf = (value) => {
        const fromNode = (node) => {
            if (!node) return null;
            if (typeof node === 'string') return node;
            return node.simpleText
                || (node.runs && node.runs[0] && node.runs[0].text)
                || (node.content && typeof node.content === 'string' ? node.content : null)
                || null;
        };
        const text = fromNode(value.title)
            || fromNode(value.text)
            || fromNode(value.label)
            || fromNode(value.defaultText)
            || fromNode(value.buttonText)
            || fromNode(value.headline)
            || fromNode(value.message)
            || (value.accessibility && value.accessibility.accessibilityData
                && value.accessibility.accessibilityData.label)
            || (value.accessibilityData && value.accessibilityData.label)
            || null;
        return text ? String(text).slice(0, 40) : null;
    };

    // The label is carried down rather than read beside the token, because
    // they are not in the same place: YouTube puts the token under
    // onTap.innertubeCommand.feedbackEndpoint and the title on the list item
    // several levels above it. Reading only the token's own object found the
    // token every time and never once named it.
    const walk = (value, at, parentKey, inherited, trail) => {
        if (!value || typeof value !== 'object' || at > 12) return;
        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) {
                walk(value[i], at + 1, parentKey, inherited, trail);
            }
            return;
        }
        const label = labelOf(value) || inherited;
        if (typeof value.feedbackToken === 'string' && value.feedbackToken) {
            out.tokens++;
            if (parentKey && out.keys.indexOf(parentKey) === -1) out.keys.push(parentKey);
            if (label && out.labels.indexOf(label) === -1) out.labels.push(label);
            if (out.paths.length < MAX_PATHS) {
                const path = trail.join('.');
                if (out.paths.indexOf(path) === -1) out.paths.push(path);
            }
        }
        const names = Object.keys(value);
        for (let i = 0; i < names.length; i++) {
            // Array indices are left out of the trail: which of four overlays
            // carried it is noise, and including them made two tokens of the
            // same kind read as two different shapes.
            walk(value[names[i]], at + 1, names[i], label, trail.concat([names[i]]));
        }
    };
    walk(node, depth || 0, null, null, []);
    return out;
}

function paramsFromNext(videoId, identity) {
    return new Promise((resolve) => {
        const client = innerTubeClient();
        if (!client) {
            // Was silent, and that silence was indistinguishable in a capture
            // from the fallback never having been reached at all.
            appendFileOnlyLog('markWatched.paramsFromNext.noClient', { videoId: videoId });
            return resolve(null);
        }
        const request = {
            path: '/youtubei/v1/next',
            payload: {
                videoId: videoId,
                racyCheckOk: true,
                contentCheckOk: true,
                playbackContext: {
                    lactMilliseconds: Math.floor(Math.random() * 2000),
                    isLyricsMode: false
                },
                autonavState: 'STATE_NONE'
            },
            clickTracking: { clickTrackingParams: null }
        };
        if (identity) request.identity = identity;
        try {
            client.fetch(request).subscribe(function (response) {
                let found = null;
                let where = null;
                try {
                    const endpoint = response?.currentVideoEndpoint?.watchEndpoint;
                    if (endpoint?.playerParams) {
                        found = String(endpoint.playerParams);
                        where = 'currentVideoEndpoint.playerParams';
                    } else if (endpoint?.params) {
                        found = String(endpoint.params);
                        where = 'currentVideoEndpoint.params';
                    }
                } catch (_) { }
                // The shape, but only when nothing was found: if /next does
                // carry params this says so in one word, and if it does not,
                // the keys say where to look instead of guessing. A capture on
                // 20 October had a player request refused with hadParams:false
                // and no line from here at all, which left no way to tell
                // whether /next was asked and came back empty or was never
                // asked.
                const detail = { videoId: videoId, found: !!found, where: where };
                // Whether YouTube offers a feedback token for this video.
                //
                // This is the last unexplored route to marking a video
                // watched on the account. The /player route is closed: no
                // signed params exist on the tile or here, so the request
                // comes back UNPLAYABLE every time. The engagement panel route
                // is closed too — a subscriptions tile carries no panel
                // reference at all, which addLongPress.feedbackPanel reports
                // as "not found". A token in this response would be the one
                // remaining way, and sendFeedbackToken already exists to use
                // it.
                //
                // The token itself is never logged: it is an opaque
                // account-scoped capability. Only whether one is there, and
                // the names of the fields around it, which is what says
                // whether it is the right kind of token.
                try {
                    detail.feedback = describeFeedback(response);
                } catch (_) { }
                if (!found) {
                    try {
                        const endpoint = response?.currentVideoEndpoint?.watchEndpoint;
                        detail.responseKeys = Object.keys(response || {});
                        detail.endpointKeys = endpoint ? Object.keys(endpoint) : null;
                        detail.hasCurrentVideoEndpoint = !!response?.currentVideoEndpoint;
                    } catch (_) { }
                }
                appendFileOnlyLog('markWatched.paramsFromNext', detail);
                resolve(found);
            }, function (err) {
                appendFileOnlyLog('markWatched.paramsFromNext.failed', { videoId: videoId, message: err && err.message || String(err) });
                resolve(null);
            });
        } catch (err) {
            appendFileOnlyLog('markWatched.paramsFromNext.failed', { videoId: videoId, message: err && err.message || String(err) });
            resolve(null);
        }
    });
}

/**
 * The player response for one video, through the app's authenticated client.
 *
 * The first version of this sent { videoId } and nothing else, and YouTube
 * answered with no playback tracking at all:
 *
 *   markWatched.noTracking {"videoId":"MSD1WLg1l5s","trackingKeys":[],
 *     "status":"UNPLAYABLE"}
 *
 * UNPLAYABLE with an empty tracking block is what a player request that is not
 * really a player request gets. The app's own calls do not look like that —
 * requestNextAndNavigateChannel sends the identity, the signed params off the
 * tile's watchEndpoint, the two check flags and a playbackContext, and that
 * one works. This now sends the same things, because the whole point of going
 * through the app's client is to make a request YouTube treats as the app's.
 *
 * `params` matters most of the three: it is the signed token the tile carries
 * for opening that exact video, and a player request without it is asking
 * about a video the caller cannot show it has any business playing.
 */
function playerResponse(videoId, watchParams) {
    return new Promise((resolve, reject) => {
        const client = innerTubeClient();
        if (!client) return reject(new Error('KabukiInnerTubeClient unavailable'));

        const payload = {
            videoId: videoId,
            racyCheckOk: true,
            contentCheckOk: true,
            // A player-shaped playbackContext, not the /next-shaped one this
            // sent before. /next takes { lactMilliseconds, isLyricsMode };
            // /player takes a contentPlaybackContext, and the previous version
            // handed it the wrong one. Another plausible reading of "Die Seite
            // muss neu geladen werden".
            playbackContext: {
                contentPlaybackContext: {
                    html5Preference: 'HTML5_PREF_WANTS',
                    lactMilliseconds: Math.floor(Math.random() * 2000)
                }
            }
        };

        const send = (identity, params) => {
            if (params) payload.params = params;
            try {
                const request = { path: '/youtubei/v1/player', payload: payload, clickTracking: { clickTrackingParams: null } };
                if (identity) request.identity = identity;
                // Set across the call, not in the payload: playerRequestShape
                // needs to tell our request from the app's, and a marker field
                // in the payload would be sent to YouTube. Cleared in a
                // finally, since fetch can throw.
                window.__ttMarkWatchedInFlight = true;
                try {
                    client.fetch(request).subscribe(resolve, reject);
                } finally {
                    window.__ttMarkWatchedInFlight = false;
                }
            } catch (err) {
                reject(err);
            }
        };

        // The tile's own params when it has them, /next's when it does not.
        //
        // One line per attempt saying which of the three happened, because the
        // interesting failure is a request sent with no params at all: that
        // comes back UNPLAYABLE with an empty tracking block, and without this
        // the capture showed only the refusal and not the reason for it.
        const withParamsThenSend = (identity) => {
            if (watchParams) {
                appendFileOnlyLog('markWatched.params', { videoId: videoId, from: 'tile', identity: !!identity });
                return send(identity, watchParams);
            }
            paramsFromNext(videoId, identity).then(
                (fetched) => {
                    appendFileOnlyLog('markWatched.params', {
                        videoId: videoId, from: fetched ? 'next' : 'none', identity: !!identity,
                    });
                    send(identity, fetched);
                },
                () => {
                    appendFileOnlyLog('markWatched.params', { videoId: videoId, from: 'rejected', identity: !!identity });
                    send(identity, null);
                }
            );
        };

        // The identity is what makes this the signed-in account's request
        // rather than an anonymous one, which is the difference between
        // something appearing in your history and nowhere. Asked for the same
        // way the working /next call asks, and the request still goes without
        // it rather than not at all.
        const identityApi = identityService();
        if (!identityApi || typeof identityApi.get !== 'function') return withParamsThenSend(null);
        try {
            identityApi.get().then(withParamsThenSend, () => withParamsThenSend(null));
        } catch (_) {
            withParamsThenSend(null);
        }
    });
}

/**
 * Add or replace query parameters on a tracking URL.
 *
 * Built by hand rather than with URL/URLSearchParams: the base URL already
 * carries a long list of parameters that have to survive untouched, and URL is
 * one of the things missing from the older engines here.
 */
function withParams(baseUrl, params) {
    const url = String(baseUrl || '');
    if (!url) return '';
    const cut = url.indexOf('?');
    const head = cut === -1 ? url : url.slice(0, cut);
    const query = cut === -1 ? '' : url.slice(cut + 1);

    // Split and rebuild rather than pattern-match each key. A RegExp built
    // from a key would do the same thing, and is the kind of thing CodeQL
    // reports (js/regex-injection) even where every key is a literal in this
    // file — and it would also match a key that merely ends with the one being
    // replaced. This cannot.
    const parts = query ? query.split('&') : [];
    const kept = [];
    for (const part of parts) {
        if (!part) continue;
        const eq = part.indexOf('=');
        const name = decodeURIComponent(eq === -1 ? part : part.slice(0, eq));
        if (Object.prototype.hasOwnProperty.call(params, name)) continue;
        kept.push(part);
    }
    for (const key of Object.keys(params)) {
        const value = params[key];
        if (value === null || value === undefined) continue;
        kept.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    }
    return kept.length ? head + '?' + kept.join('&') : head;
}

/**
 * Ping one tracking URL.
 *
 * credentials: 'include' is the point of the whole exercise — these are plain
 * GETs to youtube.com and it is the session cookie on them that decides whose
 * history gets the entry. The page is youtube.com on every path this runs on,
 * so the cookie is there to send.
 */
function ping(url, what) {
    return fetch(url, { method: 'GET', credentials: 'include', cache: 'no-store' })
        .then((res) => {
            appendFileOnlyLog('markWatched.' + what, { status: res.status, ok: res.ok });
            return res.ok;
        })
        .catch((err) => {
            appendFileOnlyLog('markWatched.' + what + '.failed', { message: err && err.message || String(err) });
            return false;
        });
}

/** Remember it locally too, so the tile goes now rather than on the next load. */
function recordLocally(videoId) {
    try {
        if (!window._ttVideoProgressCache) window._ttVideoProgressCache = {};
        window._ttVideoProgressCache[videoId] = 100;
        noteProgressChanged(videoId);
        return true;
    } catch (err) {
        appendFileOnlyLog('markWatched.local.failed', { videoId, message: err && err.message || String(err) });
        return false;
    }
}

/**
 * Mark one video watched.
 *
 * Resolves to what actually happened:
 *   'account' — YouTube accepted it, and it is recorded here as well
 *   'none'    — YouTube did not, and nothing was hidden anywhere
 *
 * Nothing is written locally until YouTube has accepted it, and that is a
 * deliberate reversal. The first version hid the video here first so the tile
 * left the shelf immediately whatever happened, which turned out to be exactly
 * wrong: a video hidden only on the TV is the thing this feature exists to
 * avoid. Asked for in those words — if it cannot be hidden for YouTube, so it
 * is also hidden on a PC, then do not hide it. So a refusal now leaves the
 * video where it was, and the toast says so.
 */
export function markVideoWatched(videoId, watchParams) {
    const id = String(videoId || '').trim();
    if (!id) return Promise.resolve('none');

    return playerResponse(id, watchParams).then((response) => {
        const tracking = response?.playbackTracking || {};
        const playbackUrl = tracking.videostatsPlaybackUrl?.baseUrl;
        const watchtimeUrl = tracking.videostatsWatchtimeUrl?.baseUrl;
        const lengthSeconds = Number(response?.videoDetails?.lengthSeconds || 0);

        if (!playbackUrl) {
            appendFileOnlyLog('markWatched.noTracking', {
                videoId: id,
                trackingKeys: Object.keys(tracking),
                // Named so a capture shows whether the response was refused
                // outright rather than simply shaped differently. This is what
                // identified the near-empty request: UNPLAYABLE, with nothing
                // in the tracking block at all.
                status: response?.playabilityStatus?.status || null,
                reason: response?.playabilityStatus?.reason || null,
                hadParams: !!watchParams,
            });
            return 'none';
        }

        const cpn = makeCpn();
        // ver=2 and the cpn are what yt-dlp sends, and final=1 says this is the
        // last report for this playback so nothing is waiting for more.
        const playback = withParams(playbackUrl, { ver: 2, cpn: cpn, final: 1 });

        return ping(playback, 'playback').then((playbackOk) => {
            if (!playbackOk) return 'none';
            if (!watchtimeUrl || !(lengthSeconds > 0)) {
                // History has the entry, which is the part that reaches a PC;
                // without a duration there is no honest watchtime to claim.
                appendFileOnlyLog('markWatched.noWatchtime', { videoId: id, lengthSeconds, hasUrl: !!watchtimeUrl });
                recordLocally(id);
                return 'account';
            }
            // st/et are the span played, as a pair of lists, and YouTube wants
            // them to agree with each other and with the duration. Claiming
            // the whole video is what fills the progress bar.
            const whole = lengthSeconds.toFixed(3);
            const watchtime = withParams(watchtimeUrl, {
                ver: 2,
                cpn: cpn,
                st: '0,' + whole,
                et: whole + ',' + whole,
                state: 'paused',
                final: 1,
            });
            return ping(watchtime, 'watchtime').then(() => {
                // Only now, once YouTube has it, is it remembered here — so
                // the tile leaving the shelf always means the same thing.
                recordLocally(id);
                return 'account';
            });
        });
    }).catch((err) => {
        appendFileOnlyLog('markWatched.failed', { videoId: id, message: err && err.message || String(err) });
        return 'none';
    });
}
