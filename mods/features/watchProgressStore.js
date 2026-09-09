/**
 * watchProgressStore.js — persist watch progress across app restarts.
 *
 * getWatchPercent() has three sources, in order: the response's own resume
 * overlay, a lockup progress bar, and window._ttVideoProgressCache as the
 * fallback. That cache is populated only from frameworkUpdates mutations as
 * videos are watched, and it was plain in-memory state — a power cycle emptied
 * it.
 *
 * Reported symptom: watch videos 19 and 20 of a playlist, power the TV off,
 * come back, and both are still shown as unwatched — and re-entering the
 * playlist never fixes it, because nothing repopulates the cache until
 * something is watched again. In a warm session the same steps work.
 *
 * So the progress the app already knows about has to survive a restart. Only
 * the fallback is persisted; a resume overlay in the live response still wins,
 * which matters when a video is re-watched from the start — YouTube reports the
 * new, low progress and that takes precedence over anything stored here.
 */

const STORAGE_KEY = 'ytaf-watch-progress';
const FORMAT_VERSION = 1;

// Bounds. Tizen's localStorage quota is not generous and this shares it with
// the config blob, so the store is capped by count and by age. 1000 entries is
// a few weeks of heavy viewing at roughly 40 bytes each.
const MAX_ENTRIES = 1000;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

// Writes are debounced rather than synchronous. updateProgressCache() runs on
// every response carrying frameworkUpdates mutations, and localStorage writes
// block the same thread as YouTube's rendering — the exact cost that made the
// log queue's once-a-second serialize a documented cause of navigation stutter.
const FLUSH_DELAY_MS = 5000;

// id -> last-seen timestamp, kept alongside the percentages so pruning can drop
// the oldest first. Percentages themselves live in window._ttVideoProgressCache
// so getWatchPercent() needs no changes.
let _seenAt = {};
let _flushTimer = null;

function readStored() {
  try {
    const raw = window.localStorage[STORAGE_KEY];
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== FORMAT_VERSION || !parsed.entries) return null;
    return parsed.entries;
  } catch (_) {
    // Corrupt or unavailable (private mode, quota, disabled storage) — treat as
    // empty rather than letting it throw into the response pipeline.
    return null;
  }
}

/**
 * Seed the in-memory cache from storage. Anything already in memory wins, since
 * it came from this session's live responses.
 */
export function loadProgressCache() {
  try {
    const entries = readStored();
    if (!entries) return 0;
    if (!window._ttVideoProgressCache) window._ttVideoProgressCache = {};
    const now = Date.now();
    let loaded = 0;
    for (const id of Object.keys(entries)) {
      const entry = entries[id];
      if (!Array.isArray(entry)) continue;
      const pct = Number(entry[0]);
      const ts = Number(entry[1]);
      if (!isFinite(pct)) continue;
      if (isFinite(ts) && (now - ts) > MAX_AGE_MS) continue;
      _seenAt[id] = isFinite(ts) ? ts : now;
      if (window._ttVideoProgressCache[id] === undefined) {
        window._ttVideoProgressCache[id] = pct;
        loaded++;
      }
    }
    return loaded;
  } catch (_) {
    return 0;
  }
}

/** Called when a percentage is recorded, to schedule a debounced write. */
export function noteProgressChanged(videoId) {
  try {
    if (videoId) _seenAt[videoId] = Date.now();
    if (_flushTimer) return;
    _flushTimer = setTimeout(() => {
      _flushTimer = null;
      flushProgressCache();
    }, FLUSH_DELAY_MS);
  } catch (_) { }
}

/**
 * Write the cache out, pruned by age and then by count, oldest first.
 * Safe to call at any time; used by the debounce above and by the
 * page-lifecycle handlers below.
 */
export function flushProgressCache() {
  try {
    const cache = window._ttVideoProgressCache;
    if (!cache) return;
    const now = Date.now();

    let ids = Object.keys(cache).filter(id => {
      const pct = Number(cache[id]);
      if (!isFinite(pct)) return false;
      const ts = _seenAt[id];
      // An id with no timestamp came from this session before any note; treat
      // it as current rather than dropping it.
      return !(isFinite(ts) && (now - ts) > MAX_AGE_MS);
    });

    if (ids.length > MAX_ENTRIES) {
      ids.sort((a, b) => (_seenAt[b] || 0) - (_seenAt[a] || 0));
      ids = ids.slice(0, MAX_ENTRIES);
    }

    const entries = {};
    for (const id of ids) entries[id] = [Number(cache[id]), _seenAt[id] || now];

    window.localStorage[STORAGE_KEY] = JSON.stringify({ v: FORMAT_VERSION, entries });
  } catch (_) {
    // Quota exceeded or storage unavailable. Losing persistence degrades to the
    // previous in-memory-only behaviour, which is strictly better than throwing.
  }
}

// The debounce can be outrun by the app closing, and a TV going to standby is
// exactly the case this whole module exists for. Flush on every lifecycle hook
// available; they are cheap and no-op when nothing changed.
if (!window.__ttWatchProgressStoreInit) {
  window.__ttWatchProgressStoreInit = true;
  loadProgressCache();
  try {
    const flushNow = () => flushProgressCache();
    window.addEventListener('pagehide', flushNow);
    window.addEventListener('beforeunload', flushNow);
    // Cobalt does not reliably fire the unload events above, but it does move
    // the document to hidden when the app is backgrounded or the TV suspends.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushNow();
    });
  } catch (_) { }
}
