import { configRead } from '../config.js';
import { appendFileOnlyLog, setWatchedLookup } from './hideWatched.js';

/**
 * watchHistory.js — ask YouTube what you have watched, since it will not say.
 *
 * Hiding watched videos reads the watch state off each tile. On the 6.5 TV
 * that state is never sent. From a full day's capture:
 *
 *   thumbnailOverlayResumePlaybackRenderer   0 occurrences
 *
 *   hideVideo.noProgressShape {"pageName":"subscriptions",
 *     "overlays":["thumbnailOverlayTimeStatusRenderer"],"badges":[],
 *     "tileKeys":["contentId","contentType","header","metadata",
 *       "onLongPressCommand","onSelectCommand","style","trackingParams"],
 *     "hasWatchProgressPercentage":false,"hasPercentDurationWatched":false}
 *
 * The only overlay on a subscriptions tile is its duration. There is no resume
 * overlay, no played overlay, no watched badge, no progress field, and no
 * badges key at all — so the filter has nothing to judge those tiles by, and
 * the 33 of them in that capture stayed on screen while the 34 it could judge
 * were hidden. Reading the response harder cannot fix that: the information is
 * not in it.
 *
 * What the account does know is its own history, and this client can ask for
 * it — the library page shows a Verlauf shelf, which is the same feed. So the
 * ids are fetched once and kept, and a video in that set counts as watched
 * wherever it appears. That is also what the request was all along: a video
 * finished on a PC should not come back on the TV.
 *
 * Nothing is sent anywhere. The response is read for video ids and nothing
 * else — no titles, no channels, no timestamps are stored or logged.
 */

const HISTORY_BROWSE_ID = 'FEhistory';

// Pages of history to walk.
//
// Three was a guess at "roughly the last couple of hundred videos" and it was
// wrong by a factor of five: the first capture with this working loaded 43 ids
// from three pages, so a page of this feed is about fourteen entries. Fourteen
// is nothing against a subscriptions feed that goes back weeks, and 18 videos
// in that same capture stayed on screen with nothing known about them.
//
// Twelve pages is around 170 videos, which does reach back as far as the feed
// does. They cost one request each, once per cooldown, and they stop early the
// moment a page brings no continuation — so a short history still costs one
// request, not twelve.
const MAX_PAGES = 12;

// How long a fetched set is trusted. Long enough that moving around the app
// costs nothing, short enough that watching something on a PC shows up on the
// TV within the same sitting.
const REFRESH_MS = 10 * 60 * 1000;

// A ceiling on the set, so a very long history cannot grow without bound.
const MAX_IDS = 3000;

// The deep walk's limit. History responses nest shelves inside sections
// inside continuations; ten is comfortably past that and stops a pathological
// response taking the page with it.
const MAX_DEPTH = 10;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

let _watched = Object.create(null);
let _count = 0;
let _fetchedAt = 0;
let _inFlight = false;

function enabled() {
    try {
        return configRead('hideWatchedVideosFromHistory') !== false;
    } catch (_) {
        return true;
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

/** Every video id in a history response, however it is nested. */
function collectVideoIds(node, out, depth) {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return out;
    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) collectVideoIds(node[i], out, depth + 1);
        return out;
    }
    // A tile's own id, and the id its select command plays. Both are read
    // because the two feeds that make up history — tiles and lockups — put it
    // in different places, and a shelf has been reshaped more than once.
    const candidates = [
        node.videoId,
        node.contentId,
    ];
    for (let i = 0; i < candidates.length; i++) {
        const id = candidates[i];
        if (typeof id === 'string' && VIDEO_ID.test(id)) out[id] = true;
    }
    for (const key of Object.keys(node)) {
        collectVideoIds(node[key], out, depth + 1);
    }
    return out;
}

/** The token that asks for the next page, wherever this response put it. */
function continuationToken(node, depth) {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return null;
    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
            const found = continuationToken(node[i], depth + 1);
            if (found) return found;
        }
        return null;
    }
    const direct = (node.continuationCommand && node.continuationCommand.token)
        || (node.nextContinuationData && node.nextContinuationData.continuation)
        || null;
    if (typeof direct === 'string' && direct) return direct;
    for (const key of Object.keys(node)) {
        const found = continuationToken(node[key], depth + 1);
        if (found) return found;
    }
    return null;
}

function browse(client, payload) {
    return new Promise((resolve) => {
        try {
            client.fetch({ path: '/youtubei/v1/browse', payload: payload })
                .subscribe(resolve, (err) => {
                    appendFileOnlyLog('watchHistory.failed', { message: (err && err.message) || String(err) });
                    resolve(null);
                });
        } catch (err) {
            appendFileOnlyLog('watchHistory.failed', { message: (err && err.message) || String(err) });
            resolve(null);
        }
    });
}

/**
 * Fetch the history and remember its video ids.
 *
 * The previous set is kept until a new one arrives, and an empty result is not
 * treated as success — a response that came back before sign-in would
 * otherwise wipe the set and be trusted for ten minutes.
 */
export function refreshWatchHistory(reason) {
    if (!enabled() || _inFlight) return Promise.resolve(_count);
    if (_fetchedAt && Date.now() - _fetchedAt < REFRESH_MS) return Promise.resolve(_count);
    const client = innerTubeClient();
    if (!client) return Promise.resolve(_count);

    _inFlight = true;
    const found = Object.create(null);
    const startedAt = Date.now();

    // What each page contributed, so a short result says which of the two it
    // was: a history with little in it, or continuations that stopped being
    // followed. The first version could not tell those apart.
    const perPage = [];
    const page = (payload, pagesLeft) => browse(client, payload).then((response) => {
        if (!response) return null;
        const before = Object.keys(found).length;
        collectVideoIds(response, found, 0);
        perPage.push(Object.keys(found).length - before);
        if (pagesLeft <= 1 || Object.keys(found).length >= MAX_IDS) return null;
        const token = continuationToken(response, 0);
        if (!token) return null;
        // A page that added nothing twice over is the end of the feed however
        // many continuations it keeps offering.
        if (perPage.length >= 2 && perPage[perPage.length - 1] === 0 && perPage[perPage.length - 2] === 0) return null;
        return page({ continuation: token }, pagesLeft - 1);
    });

    return page({ browseId: HISTORY_BROWSE_ID }, MAX_PAGES).then(() => {
        _inFlight = false;
        const ids = Object.keys(found);
        if (!ids.length) {
            appendFileOnlyLog('watchHistory.empty', {
                reason: reason || null, tookMs: Date.now() - startedAt, pages: perPage.length,
            });
            return _count;
        }
        if (ids.length > MAX_IDS) ids.length = MAX_IDS;
        const next = Object.create(null);
        for (let i = 0; i < ids.length; i++) next[ids[i]] = true;
        _watched = next;
        _count = ids.length;
        _fetchedAt = Date.now();
        appendFileOnlyLog('watchHistory.loaded', {
            reason: reason || null, count: _count, tookMs: Date.now() - startedAt,
            pages: perPage.length, perPage: perPage,
        });
        return _count;
    }, (err) => {
        _inFlight = false;
        appendFileOnlyLog('watchHistory.failed', { message: (err && err.message) || String(err) });
        return _count;
    });
}

/** Whether history says this video has been watched. */
export function isInWatchHistory(videoId) {
    if (!videoId || !enabled()) return false;
    return _watched[videoId] === true;
}

export function watchHistoryCount() {
    return _count;
}

// Registered rather than imported by hideWatched.js, which holds
// appendFileOnlyLog and must not import anything that imports it back.
setWatchedLookup(isInWatchHistory);

// The client appears some way into startup, so the first fetch waits for it
// rather than racing it. Same approach as the long press menu's playlist warm.
const WAIT_EVERY_MS = 1000;
const WAIT_ATTEMPTS = 30;
let _waited = 0;
const waitForClient = setInterval(() => {
    _waited++;
    if (innerTubeClient()) {
        clearInterval(waitForClient);
        refreshWatchHistory('startup');
    } else if (_waited >= WAIT_ATTEMPTS) {
        clearInterval(waitForClient);
        appendFileOnlyLog('watchHistory.noClient', { afterSec: _waited });
    }
}, WAIT_EVERY_MS);
try { if (typeof waitForClient.unref === 'function') waitForClient.unref(); } catch (_) { }

// Moving to a feed where hiding matters is the moment a stale set shows. The
// cooldown inside refreshWatchHistory means this is usually free.
try {
    window.addEventListener('hashchange', () => {
        try {
            const hash = String(window.location.hash || '');
            if (hash.indexOf('FEsubscriptions') !== -1 || hash.indexOf('FEwhat_to_watch') !== -1) {
                refreshWatchHistory('nav');
            }
        } catch (_) { }
    });
} catch (_) { }
