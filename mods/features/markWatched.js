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

/** The player response for one video, through the app's authenticated client. */
function playerResponse(videoId) {
    return new Promise((resolve, reject) => {
        const client = innerTubeClient();
        if (!client) return reject(new Error('KabukiInnerTubeClient unavailable'));
        try {
            client.fetch({ path: '/youtubei/v1/player', payload: { videoId } })
                .subscribe(resolve, reject);
        } catch (err) {
            reject(err);
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
 * Resolves to what actually happened, so the toast can tell the truth rather
 * than claim success for a ping YouTube refused:
 *   'account' — history was told, and the local cache updated as well
 *   'local'   — only the local cache; the video hides here but not on a PC
 */
export function markVideoWatched(videoId) {
    const id = String(videoId || '').trim();
    if (!id) return Promise.resolve('none');

    // Locally first, and deliberately not conditional on the rest. The video
    // should leave the shelf whether or not YouTube cooperates, and the request
    // below takes a moment that the person is watching an unchanged screen for.
    const localOk = recordLocally(id);

    return playerResponse(id).then((response) => {
        const tracking = response?.playbackTracking || {};
        const playbackUrl = tracking.videostatsPlaybackUrl?.baseUrl;
        const watchtimeUrl = tracking.videostatsWatchtimeUrl?.baseUrl;
        const lengthSeconds = Number(response?.videoDetails?.lengthSeconds || 0);

        if (!playbackUrl) {
            appendFileOnlyLog('markWatched.noTracking', {
                videoId: id,
                trackingKeys: Object.keys(tracking),
                // Named so a capture shows whether the response was refused
                // outright rather than simply shaped differently.
                status: response?.playabilityStatus?.status || null,
            });
            return localOk ? 'local' : 'none';
        }

        const cpn = makeCpn();
        // ver=2 and the cpn are what yt-dlp sends, and final=1 says this is the
        // last report for this playback so nothing is waiting for more.
        const playback = withParams(playbackUrl, { ver: 2, cpn: cpn, final: 1 });

        return ping(playback, 'playback').then((playbackOk) => {
            if (!playbackOk) return localOk ? 'local' : 'none';
            if (!watchtimeUrl || !(lengthSeconds > 0)) {
                // History has the entry, which is the part that reaches a PC;
                // without a duration there is no honest watchtime to claim.
                appendFileOnlyLog('markWatched.noWatchtime', { videoId: id, lengthSeconds, hasUrl: !!watchtimeUrl });
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
            return ping(watchtime, 'watchtime').then(() => 'account');
        });
    }).catch((err) => {
        appendFileOnlyLog('markWatched.failed', { videoId: id, message: err && err.message || String(err) });
        return localOk ? 'local' : 'none';
    });
}
