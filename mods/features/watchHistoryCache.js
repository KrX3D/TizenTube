/**
 * watchHistoryCache.js — keep the watched-video ids across app restarts.
 *
 * The race this exists for, from the 6.5 TV on 6 November:
 *
 *   13:31:10  page.store      {"source":"nav","next":"subscriptions"}
 *   13:31:11  parse.begin     {"detectedPage":"subscriptions"}
 *   13:31:12  parse.begin     {"detectedPage":"subscriptions"}     ×9 more
 *   13:31:15  watchHistory.loaded {"count":178,"tookMs":3051}
 *   13:31:38  parse.begin     {"detectedPage":"subscriptions"}
 *
 * Every Subscriptions response was parsed, filtered and rendered in the three
 * seconds before the history arrived. The filter asks isInWatchHistory() for
 * each tile and during that window the answer is no for all 178 of them, so
 * nothing is hidden and the page sits there with watched videos on it. The
 * next parse is twenty-three seconds later, when the viewer navigated away and
 * back — which is why that is the thing that appears to fix it.
 *
 * Fetching sooner is not available: the history walk is twelve requests and
 * takes three to five seconds every time, and the page does not wait. Holding
 * the first responses until it finishes would stall the whole app for that
 * long, which is worse than the bug.
 *
 * So the ids are kept. The set barely changes between one app start and the
 * next, so last session's copy is a near-perfect answer for the only moment
 * the real one is missing, and it is available synchronously at import. The
 * network fetch still runs and still replaces it a few seconds later; this
 * only covers the gap.
 *
 * What it cannot cover is a video watched somewhere else since the last app
 * start. That one is missing from the cache, so it is visible until the fetch
 * lands — the same behaviour as before, for a handful of videos instead of all
 * of them.
 *
 * Ids only. No titles, no channels, no timestamps per video — the same promise
 * watchHistory.js makes.
 */

// Bound before adblock.js patches JSON.parse. This blob is ours and has no
// business going through YouTube's filters.
const _parse = JSON.parse.bind(JSON);
const _stringify = JSON.stringify.bind(JSON);

const STORAGE_KEY = 'ytaf-watch-history';
const FORMAT_VERSION = 1;

// The fetch itself walks twelve pages of fifteen, so a few hundred is the real
// size. The cap is for a stored blob that somehow grew, not for normal use.
const MAX_IDS = 3000;

// Old enough that the account's own history has almost certainly moved on.
// Past this the seed is dropped and the first render waits for the fetch, which
// is the behaviour this module replaces rather than a failure.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** A video id, exactly. Nothing else is allowed into the store. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Last session's watched ids, or null.
 *
 * @returns {null|{ids: string[], ageMs: number}}
 */
export function readCachedWatchHistory() {
    try {
        const raw = window.localStorage[STORAGE_KEY];
        if (!raw) return null;
        const blob = _parse(raw);
        if (!blob || blob.v !== FORMAT_VERSION || !Array.isArray(blob.ids)) return null;
        const at = Number(blob.at) || 0;
        const ageMs = Date.now() - at;
        if (!isFinite(ageMs) || ageMs < 0 || ageMs > MAX_AGE_MS) return null;
        const ids = [];
        for (let i = 0; i < blob.ids.length && ids.length < MAX_IDS; i++) {
            const id = String(blob.ids[i]);
            if (VIDEO_ID.test(id)) ids.push(id);
        }
        if (!ids.length) return null;
        return { ids, ageMs };
    } catch (_) {
        // No storage, or something unreadable in it. Returning null leaves the
        // first render exactly as it was before this module existed.
        return null;
    }
}

/**
 * Keep this fetch's ids for the next app start.
 *
 * Called after a successful walk, so what is stored is always a complete set
 * rather than a partial one that would read as "these are the only watched
 * videos" on the next start.
 */
export function writeCachedWatchHistory(ids) {
    try {
        if (!Array.isArray(ids) || !ids.length) return false;
        const keep = [];
        for (let i = 0; i < ids.length && keep.length < MAX_IDS; i++) {
            const id = String(ids[i]);
            if (VIDEO_ID.test(id)) keep.push(id);
        }
        if (!keep.length) return false;
        window.localStorage[STORAGE_KEY] = _stringify({ v: FORMAT_VERSION, at: Date.now(), ids: keep });
        return true;
    } catch (_) {
        // Quota or storage unavailable. The fetched set still serves this
        // session; only the next start loses its head start.
        return false;
    }
}
