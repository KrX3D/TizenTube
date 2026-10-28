import { appendFileOnlyLog } from './hideWatched.js';

/**
 * deArrowCache.js — remember DeArrow branding so it can be applied in time.
 *
 * The problem
 * ───────────
 * deArrowify runs inside the JSON.parse hook, while the browse response is
 * still a plain object nobody has looked at. It reads each tile's video id and
 * fires a request to sponsor.ajay.app, then writes the title into the object
 * when that request comes back — a few hundred milliseconds later, by which
 * time YouTube TV has already built the tile and put it on screen. The write
 * lands on an object the app has finished reading, so the original title stays
 * up. Upstream measured this on their own build: about 190 branding requests
 * all succeeding, and not one changed title (reisxd/TizenTube#741).
 *
 * Their fix holds the readyState 4 handlers for /browse, /search and /next
 * until branding for every video in the response has arrived, up to two
 * seconds. That is not safe here. With five concurrent requests and forty
 * items in a Home response it is eight round trips, so the two second ceiling
 * would be reached on most loads, and every Home and search navigation on a
 * Chrome 47 TV would pay it.
 *
 * What this does instead
 * ──────────────────────
 * Nothing ever waits. Branding that has been seen before is already in hand
 * when the response is parsed, so it is written into the object at the only
 * moment that is guaranteed to work — before the app reads it. Branding that
 * has not been seen is still fetched in the background and still written
 * late (harmless, and it works on whichever paths re-read the object), but its
 * real purpose is to be in the cache for next time.
 *
 * Home and search show largely the same videos from one visit to the next, so
 * from the second sighting of a video onwards its title is correct, with no
 * added latency and nothing held back. The fetch that would have been made is
 * also skipped, which on a slow TV matters more than it sounds: those
 * responses are parsed through the patched JSON.parse, so each one carries the
 * cost of every filter in adblock.js.
 *
 * Negative results are cached too, with a shorter life. Most videos have no
 * DeArrow submission at all, and without remembering that, every Home load
 * would re-ask about the same forty videos for ever.
 */

// Bound before adblock.js patches JSON.parse. This module is imported from the
// top of adblock.js, so the originals are still in place when it runs, and our
// own stored blob has no business going through YouTube's filters.
const _parse = JSON.parse.bind(JSON);
const _stringify = JSON.stringify.bind(JSON);

const STORE_KEY = 'tt-dearrow-branding';
const VERSION = 1;

// Enough for several screens of Home plus a few searches. The blob is one
// small record per video, so this is tens of kilobytes rather than hundreds.
const MAX_ENTRIES = 800;

// Community titles change rarely, so a week costs nothing. A video with no
// submission might get one, so forget those sooner.
const HIT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 24 * 60 * 60 * 1000;

// Writes are batched. Forty videos arriving within a second of each other
// would otherwise mean forty serialisations of a growing object, during the
// busiest moment of a page load.
const FLUSH_AFTER_MS = 5000;

// A Map, not an object: the keys come from response data, and writing
// cache[id] on a plain object would let a crafted id reach Object.prototype.
// playlistBatchCollect.js uses a Map for the same reason.
//
// The Map alone turned out not to be enough. Serialising it back out walks
// every key onto a plain object, and `out['__proto__'] = entry` there sets a
// prototype instead of adding a property — so that entry vanished from the
// stored blob, which a test of this file caught. Hence both the id check below
// and the null-prototype object in _flush.
let _entries = null;
let _dirty = false;
let _flushTimer = null;

function _now() {
    try { return Date.now(); } catch (_) { return 0; }
}

// Exactly what a YouTube video id is. deArrowify already refuses anything that
// is not eleven characters, so this rejects nothing real; it is here so the
// cache cannot be made to hold a key that is not an id, whatever calls it.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function _validId(videoID) {
    try { return VIDEO_ID.test(String(videoID)); } catch (_) { return false; }
}

/** The stored blob, read once per session. */
function _load() {
    if (_entries) return _entries;
    _entries = new Map();
    try {
        const raw = window.localStorage[STORE_KEY];
        if (!raw) return _entries;
        const blob = _parse(raw);
        if (!blob || blob.v !== VERSION || !blob.e || typeof blob.e !== 'object') return _entries;
        const now = _now();
        const ids = Object.keys(blob.e);
        for (let i = 0; i < ids.length; i++) {
            if (!_validId(ids[i])) { _dirty = true; continue; }
            const entry = blob.e[ids[i]];
            if (!entry || typeof entry !== 'object') continue;
            const age = now - (Number(entry.a) || 0);
            const ttl = entry.t === null || entry.t === undefined ? MISS_TTL_MS : HIT_TTL_MS;
            // Expired on the way in, so a stale blob shrinks instead of being
            // carried around and re-checked entry by entry on every lookup.
            if (age > ttl) { _dirty = true; continue; }
            _entries.set(ids[i], entry);
        }
    } catch (_) {
        // No storage, or something unreadable in it. An empty cache behaves
        // exactly like the old code did, which is the right way to fail.
    }
    return _entries;
}

function _flush() {
    _flushTimer = null;
    if (!_dirty || !_entries) return;
    try {
        // Oldest out first when over the cap.
        if (_entries.size > MAX_ENTRIES) {
            const byAge = [];
            _entries.forEach((entry, id) => byAge.push([Number(entry.a) || 0, id]));
            byAge.sort((a, b) => a[0] - b[0]);
            const excess = _entries.size - MAX_ENTRIES;
            for (let i = 0; i < excess; i++) _entries.delete(byAge[i][1]);
        }
        // No prototype, so every key is an ordinary own property and none of
        // them can mean anything to the object itself.
        const out = Object.create(null);
        _entries.forEach((entry, id) => { out[id] = entry; });
        window.localStorage[STORE_KEY] = _stringify({ v: VERSION, e: out });
        _dirty = false;
    } catch (_) {
        // Storage full or unavailable. The in-memory cache still serves this
        // session, so this is a lost optimisation rather than a failure.
        _dirty = false;
    }
}

function _scheduleFlush() {
    if (_flushTimer) return;
    try {
        _flushTimer = setTimeout(_flush, FLUSH_AFTER_MS);
        if (typeof _flushTimer.unref === 'function') _flushTimer.unref();
    } catch (_) {
        _flush();
    }
}

/**
 * Branding for a video, or null when it is not known.
 *
 * `{ title, thumbTimestamp }`, either of which may be null — a video can have
 * a submitted title and no thumbnail, or neither, and "neither" is itself
 * worth remembering.
 */
export function readBranding(videoID) {
    try {
        const entry = _load().get(String(videoID));
        if (!entry) return null;
        const ttl = entry.t === null || entry.t === undefined ? MISS_TTL_MS : HIT_TTL_MS;
        if (_now() - (Number(entry.a) || 0) > ttl) {
            _entries.delete(String(videoID));
            _dirty = true;
            return null;
        }
        return {
            title: entry.t === undefined ? null : entry.t,
            thumbTimestamp: entry.h === undefined ? null : entry.h,
        };
    } catch (_) {
        return null;
    }
}

/** Remember what sponsor.ajay.app said, including that it said nothing. */
export function writeBranding(videoID, title, thumbTimestamp) {
    if (!_validId(videoID)) return;
    try {
        _load().set(String(videoID), {
            t: title === undefined ? null : title,
            h: thumbTimestamp === undefined ? null : thumbTimestamp,
            a: _now(),
        });
        _dirty = true;
        _scheduleFlush();
    } catch (_) { }
}

/** How many videos are remembered — for the diagnostic line only. */
export function brandingCacheSize() {
    try { return _load().size; } catch (_) { return 0; }
}

// Last chance to persist. Cobalt does not always deliver these, which is why
// the debounce above is the real mechanism rather than a backstop.
try {
    window.addEventListener('pagehide', _flush);
    window.addEventListener('beforeunload', _flush);
} catch (_) { }

try {
    appendFileOnlyLog('dearrow.cache.ready', { remembered: brandingCacheSize() });
} catch (_) { }
