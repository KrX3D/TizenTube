/**
 * playlistBatchCollect.js
 *
 * Strategy: let real XHR through immediately, collect all remaining batches
 * in the background, store in window.__ttPrefetchedBatch.  adblock.js injects
 * the result into the next playlist continuation JSON.parse — no XHR delivery,
 * no 614KB re-parse.
 *
 * Two trigger paths feed the same background collector:
 *  - scheduleCollectAfterNativeSettles(): called by adblock.js on playlist
 *    page load and again for each continuation YouTube delivers itself. It
 *    waits for that native loading to go quiet, then hands autoStartCollect()
 *    the items already accumulated plus the newest token, so collection
 *    resumes from where YouTube stopped rather than refetching from batch 2.
 *  - The XHR send() seed path below: a fallback for when the auto-trigger's
 *    captured context/url isn't available yet (e.g. very first browse of a
 *    session) — starts from the first scroll-triggered continuation request.
 *  Both converge on _collectAll(), which loops until no continuation token
 *  is left or MAX is hit, writing every additional batch into
 *  window.__ttPrefetchedBatch as it goes.
 *
 * Duplicate-request problem and solution (confirmed on-device)
 * ────────────────────────────────────────────────────────────
 * The XHR seed path used to fire its own independent _nativeFetch for the
 * exact same URL+body as the real XHR it had just let through, purely to get
 * an unfiltered copy of data the real request was already fetching. Sending
 * that duplicate, plus _collectAll's own immediate next-batch fetch, meant
 * up to three continuation requests landing within tens of milliseconds of
 * each other. On-device logs showed the very first _collectAll fetch coming
 * back as a bare `{"error":...}` in that situation — server-side throttling.
 * Net effect: the "prefetched" batch was just a duplicate of data already
 * delivered natively, and the background collector never got past batch 1.
 *
 * Fix: read the real XHR's own response (`this.responseText` on its `load`
 * event) instead of firing a duplicate request. Only genuinely new batches
 * (2+) require a real extra fetch, and those now happen one at a time after
 * the previous one actually returns, instead of all bunched together.
 *
 * Even after removing the duplicate, and after adding a multi-second pacing
 * delay before each fetch (still kept — see BATCH_FETCH_DELAY_MS below, it's
 * cheap insurance and matches real scroll timing), _collectAll's own fetch
 * kept coming back as the same bare {"error":...} every time regardless of
 * delay. The actual differentiator across every test, once compared: every
 * request that succeeded (native pass-throughs, and the old duplicate seed
 * fetch which copied this.__ttReqHeaders) carried the real request's full
 * header set; _collectAll's own fetchOpts has only ever sent `content-type`.
 * Missing headers (likely X-Goog-Visitor-Id / X-Youtube-Client-Name /
 * X-Youtube-Client-Version or similar), not timing, is what the server was
 * rejecting.
 *
 * Fix: capture the real request's headers (this.__ttReqHeaders) alongside
 * context/url, and pass them through to every _collectAll fetch.
 *
 * Recursive-XHR problem and solution
 * ────────────────────────────────────
 * _nativeFetch is the whatwg-fetch polyfill, which creates a real XMLHttpRequest
 * internally and calls xhr.send().  Our patched send() would normally intercept
 * that and start yet another seed fetch, causing an exponential chain.
 *
 * Fix: set window.__ttPrefetchStarted = true SYNCHRONOUSLY (before any await)
 * so that when the polyfill's internal XHR hits the patched send(), it sees the
 * flag and falls straight through to _origXHRSend without starting another seed.
 *
 * Filtered-data problem and solution
 * ────────────────────────────────────
 * The polyfill's response.json() calls JSON.parse, which adblock.js has patched
 * to filter out watched items.  _collectAll would therefore collect only keep-one
 * items per batch instead of raw items. Likewise, reading a real XHR's response
 * via `.response`/`.responseText` is unaffected by that patch (it only intercepts
 * calls to the global JSON.parse function), but we still parse it with the saved
 * native JSON.parse for clarity and consistency with the rest of this file.
 *
 * Fix: save a reference to the native JSON.parse at module-init time (before
 * adblock.js patches it) and use that in all _collectAll response parsing.
 *
 * CAVEAT on _nativeJSONParse's name — verified from the built bundle's module
 * order (playlistContinue 311408 < playlistBatchCollect 323762 < adblock
 * 361069): playlistContinue.js patches JSON.parse BEFORE this module runs, so
 * what we capture is playlistContinue.js's wrapper, not the true native
 * function. The property this code actually depends on still holds — adblock.js
 * patches later, so its watched-item filtering is genuinely bypassed. But
 * playlistContinue.js's storePlItems DOES see every background-collected batch,
 * so window.__ttCurrentPlaylistItems counts items that were fetched in the
 * background and never rendered in the UI. Anything treating that array as
 * "what the user can currently see" will be wrong by exactly the prefetched
 * amount (see adblock.js's _verifyAutoLoadEffect).
 *
 * Navigation safety
 * ──────────────────
 * _collectAll aborts on hashchange/popstate.  Before storing the result we check
 * the URL still matches; stale prefetch from another playlist is discarded.
 * Global state is also cleared on every navigation so a fresh collect starts.
 *
 * Only active when enablePlaylistBatchCollect is true — opt-in, default:
 * false (config.js). Settings → User Interface Settings → Playlist Batch
 * Load → "Load All at Once".
 */

import { appendFileOnlyLog, getItemVideoId } from './hideWatched.js';
import { configRead } from '../config.js';

function _log(label, payload) {
  try { appendFileOnlyLog(label, payload); } catch (_) {}
}

// ── Save native implementations BEFORE adblock.js patches them ───────────────
// playlistBatchCollect.js is imported at the top of adblock.js, so this module
// runs first — JSON.parse and window.fetch are still native at this point.

const _nativeJSONParse = JSON.parse.bind(JSON);

const _nativeFetch = (typeof window.fetch === 'function')
  ? window.fetch.bind(window)
  : null;

// ── Navigation: clear stale state when entering a new page ───────────────────
// _lastBrowseContext/_lastBrowseUrl back the auto-trigger (see autoStartCollect
// below) — captured from whichever browse XHR fires most recently so the
// initial page-load request's own context/url is available immediately,
// without waiting for a scroll-triggered continuation request.
//
// IMPORTANT: these two are NOT cleared on navigation, unlike the prefetch
// state below. Confirmed on-device: the hashchange for entering a playlist
// fires WHILE that same playlist's own initial browse request is still in
// flight — context gets captured when the request is sent, then the
// hashchange fires and used to null it out again before the response even
// comes back, so autoStartCollect always saw null and silently no-opped
// (auto_skip_no_context) every single time. context/url aren't page-specific
// anyway (InnerTube context is client/session info, and the endpoint URL is
// the same browse endpoint regardless of page) — each new browse request
// naturally overwrites the previous one, no reset needed.
let _lastBrowseContext = null;
let _lastBrowseUrl     = null;
let _lastBrowseHeaders = null;

function _clearState() {
  window.__ttPrefetchedBatch  = null;
  window.__ttPrefetchStarted  = false;
  // Must be cleared too, or one completed playlist would permanently block
  // collection on every later one.
  window.__ttCollectCancel    = false;
  // __ttContinuationAcc is deliberately NOT cleared here. It is keyed by
  // playlist, and noteContinuationBatch replaces it whenever the key differs,
  // so stale data from another playlist can never be used. Clearing it on
  // hashchange actively broke collection: that event fires mid-visit while the
  // playlist's own continuations are still arriving, so batches accumulated
  // before it were thrown away. On-device that left the accumulator holding
  // only the last two batches (from_native {collected: 23} for a playlist
  // whose continuations total 53), which is why collection never completed and
  // the cache could never be written. Same reasoning as _lastBrowseContext
  // above, which was fixed for the identical reason.
  clearTimeout(window.__ttNativeSettleTimer);
  window.__ttNativeSettleTimer = null;
  window.__ttLatestContinuations = null;
  // Per-visit guards: cleared on real navigation so the next visit can run
  // its own collect+reload, while staying set across a SOFT_RELOAD_PAGE
  // (which does not navigate) so that reload cannot repeat.
  window.__ttServedFromCache = null;
  window.__ttFullReloadDone = new Set();
}
window.addEventListener('hashchange', _clearState);
window.addEventListener('popstate',   _clearState);

// ── URL detection ─────────────────────────────────────────────────────────────
function _isBrowseUrl(url) {
  try { return String(url).includes('/youtubei/v1/browse'); }
  catch (_) { return false; }
}

// ── Request body parsing ──────────────────────────────────────────────────────
function _parseBody(options) {
  try {
    const b = options?.body;
    if (!b) return null;
    return _nativeJSONParse(typeof b === 'string' ? b : new TextDecoder().decode(b));
  } catch (_) { return null; }
}

// ── Continuation token extraction ─────────────────────────────────────────────
function _getToken(continuations) {
  if (!Array.isArray(continuations)) return null;
  return continuations[0]?.nextContinuationData?.continuation
      || continuations[0]?.reloadContinuationData?.continuation
      || null;
}

// ── AbortController shim for older WebKit ─────────────────────────────────────
function _makeAbort() {
  if (typeof AbortController !== 'undefined') return new AbortController();
  const signal = { aborted: false };
  return { signal, abort() { signal.aborted = true; } };
}

// ── Pacing between background fetches ─────────────────────────────────────────
// Confirmed on-device (twice): firing a continuation fetch within ~50-300ms
// of the previous browse/continuation request gets rejected outright with a
// bare {"error":...} — every request spaced by several seconds (i.e. every
// real, manually-triggered scroll) succeeds. Looks like server-side
// anti-automation throttling on the endpoint — a real scroll physically
// can't happen that fast. So instead of firing every background fetch back
// to back, wait a human-scroll-like interval before each one.
// Lowered from 2500ms. That figure was chosen while timing was wrongly blamed
// for the {"error":...} rejections; the real cause was missing request headers,
// and no fetch has failed since those were added. It also costs real time now
// that seeding means usually a single fetch — 2.5s of it was pure latency.
const BATCH_FETCH_DELAY_MS = 400;
function _delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Auto-reveal: trigger display the moment prefetch is ready ────────────────
// Confirmed on-device: window.__ttPrefetchedBatch being ready is not enough —
// adblock.js only injects it into a continuation response when one actually
// happens, and that has always required the user to scroll to trigger it. On
// a playlist visited briefly (common when checking several playlists in a
// row) the user can navigate away before ever scrolling, so a fully
// collected batch (batches:N, hasMore:false) sometimes never gets shown at
// all. adblock.js exposes window.__ttAttemptPlaylistAutoLoad — the same
// resolveCommand-based "load more" trigger it already uses for its own
// keep-one/empty-batch auto-load case — as a window global specifically so
// this module can fire it without an ES import back to adblock.js (this
// module must load and capture native JSON.parse/fetch before adblock.js
// patches them; a circular import risks breaking that ordering).
function _triggerReveal(reason) {
  try {
    if (typeof window.__ttAttemptPlaylistAutoLoad === 'function') {
      window.__ttAttemptPlaylistAutoLoad(reason);
      _log('playlist.batch_collect.reveal_triggered', { reason });
    } else {
      _log('playlist.batch_collect.reveal_unavailable', { reason });
    }
  } catch (err) {
    _log('playlist.batch_collect.reveal_error', { reason, err: String(err?.message || err) });
  }
}

// ── Core: collect all remaining batches ───────────────────────────────────────
// IMPORTANT: uses _nativeJSONParse (not patched JSON.parse) so watched items
// are NOT filtered out during collection — we need the raw batch data.

async function _collectAll(url, plc, context, headers) {
  const MAX = Math.max(1, Math.min(500, Number(configRead('playlistBatchCollectMaxBatches') || 50)));

  if (!context || !_nativeFetch) return null;

  const allContents = Array.isArray(plc.contents) ? [...plc.contents] : [];
  let continuations = plc.continuations;
  let batchesLoaded = 1;
  let fetchCount = 0;
  const abort = _makeAbort();
  const nativeAbort = typeof AbortController !== 'undefined';

  const onNav = () => abort.abort();
  window.addEventListener('hashchange', onNav, { once: true });
  window.addEventListener('popstate',   onNav, { once: true });


  try {
    while (continuations && batchesLoaded < MAX && !abort.signal.aborted) {
      if (window.__ttCollectCancel) { _log('playlist.batch_collect.cancelled', { batch: batchesLoaded }); break; }
      const token = _getToken(continuations);
      if (!token) {
        _log('playlist.batch_collect.no_token', {
          batch: batchesLoaded,
          continuationsShape: (() => { try { return JSON.stringify(continuations).slice(0, 300); } catch (_) { return null; } })(),
        });
        break;
      }

      // Pace only BETWEEN our own fetches. The first one needs no delay:
      // nothing of ours precedes it, and the scheduler has already waited out
      // the native burst before we get here, so the gap is covered. Skipping
      // it saves the full delay in the common case, where seeding leaves just
      // one batch to fetch. Every iteration is sequential anyway — each fetch
      // is awaited, parsed and appended before the loop reaches the next.
      if (fetchCount > 0) await _delay(BATCH_FETCH_DELAY_MS);
      fetchCount++;
      if (abort.signal.aborted) break;

      // Carry the real request's headers (X-Goog-Visitor-Id, X-Youtube-Client-*,
      // etc.) — without them the server rejects this with a bare {"error":...}
      // regardless of pacing. See the header-vs-timing note at the top of the
      // file for how this was confirmed.
      const mergedHeaders = Object.assign({ 'content-type': 'application/json' }, headers || {});
      const fetchOpts = {
        method:      'POST',
        headers:     mergedHeaders,
        body:        JSON.stringify({ context, continuation: token }),
        credentials: 'include',
        mode:        'cors',
      };
      if (nativeAbort) fetchOpts.signal = abort.signal;

      _log('playlist.batch_collect.fetching', {
        batch: batchesLoaded,
        headerKeys: Object.keys(mergedHeaders),
        // context is non-null here — _collectAll returns early when it is falsy.
        contextKeys: typeof context === 'object' ? Object.keys(context) : null,
        tokenLen: token.length,
      });

      let nextData;
      let httpStatus, httpStatusText, rawText;
      try {
        const nextResp = await _nativeFetch(url, fetchOpts);
        httpStatus     = nextResp.status;
        httpStatusText = nextResp.statusText;
        // Use _nativeJSONParse — the polyfill's .json() calls the patched
        // JSON.parse which would filter out watched items, corrupting the data.
        rawText = await nextResp.text();
        nextData = _nativeJSONParse(rawText);
      } catch (err) {
        _log('playlist.batch_collect.sub_error', {
          batch: batchesLoaded,
          aborted: abort.signal.aborted,
          err: String(err?.message || err),
          httpStatus, httpStatusText,
        });
        break;
      }

      const nextPlc = nextData?.continuationContents?.playlistVideoListContinuation;
      if (!nextPlc) {
        // Full body, uncapped — a bare {"error":...} response is small, and
        // the status/body together are what actually explain the rejection
        // (401/403/429/etc.), not just the top-level key names.
        _log('playlist.batch_collect.no_plc', {
          batch: batchesLoaded,
          httpStatus, httpStatusText,
          responseKeys: nextData && typeof nextData === 'object' ? Object.keys(nextData) : null,
          responseBody: rawText,
          headerKeys: Object.keys(mergedHeaders),
        });
        break;
      }

      const newItems = Array.isArray(nextPlc.contents) ? nextPlc.contents : [];
      allContents.push(...newItems);
      continuations = nextPlc.continuations || null;
      batchesLoaded++;
      // Per-batch, not just the final aggregate — if the loop stops
      // mid-collection on a long playlist, this shows exactly which batch
      // and what the token looked like right before it happened, instead
      // of only a totals summary with no visibility into the sequence.
      _log('playlist.batch_collect.batch_fetched', {
        batch: batchesLoaded,
        newItems: newItems.length,
        totalSoFar: allContents.length,
        hasMore: !!continuations,
      });
    }
  } finally {
    window.removeEventListener('hashchange', onNav);
    window.removeEventListener('popstate',   onNav);
  }

  _log('playlist.batch_collect.done', {
    rawItems:  allContents.length,
    batches:   batchesLoaded,
    hasMore:   !!continuations,
    hitLimit:  batchesLoaded >= MAX,
    aborted:   abort.signal.aborted,
  });

  return { allContents, continuations, aborted: abort.signal.aborted };
}

// ── Full-playlist cache and one-shot reload ──────────────────────────────────
// Goal: get the ENTIRE playlist into the INITIAL page response, because that
// response is the only one where continuations can be nulled without starving
// YouTube's refill loop — and with no continuation there is no keep-one branch,
// so no helper tile is ever created. Helpers are what leave the permanently
// stranded blank slots (the virtual list's data model is unreachable on Tizen
// 5.0, 654577e), so removing the need for them is the only way to be rid of
// them.
//
// The catch is ordering: on a first visit the full list only exists AFTER the
// background collector finishes, which is well after the initial response has
// already been rendered. Injecting into a later continuation cannot fix it
// either — the initial batch has already kept its helper by then. So once
// collection completes we cache the whole playlist and reload the page once;
// the reloaded initial response is served from cache, complete, with
// continuations nulled.
//
// Reloading per batch (rather than after collection) would not work: a reload
// re-fetches the FIRST page, so it would loop on batch 1 forever.
const FULL_CACHE_MAX_PLAYLISTS = 3;

function playlistKeyFromHash() {
  try { return String(window.location?.hash || ''); } catch (_) { return ''; }
}

// Backed by a Map, not a plain object, because the key is the location hash.
// That is attacker-influenceable via a crafted URL, and writing cache[key] on
// a plain object would let a hash of #__proto__ reach Object.prototype
// (flagged by CodeQL as remote property injection). A Map treats every key as
// ordinary data, with no prototype chain to walk into.
function getFullCache() {
  if (!(window.__ttPlaylistFullCache instanceof Map)) window.__ttPlaylistFullCache = new Map();
  return window.__ttPlaylistFullCache;
}

export function getCachedFullPlaylist(key) {
  const entry = getFullCache().get(key);
  return entry && Array.isArray(entry.contents) ? entry.contents : null;
}

// Drop a cached playlist once it has been injected. The cache is strictly a
// hand-off from the pre-reload pass to the reloaded page, NOT a store to reuse
// on later visits.
//
// It holds raw renderer objects captured at collection time, and
// getWatchPercent() reads watched state primarily from data embedded in those
// renderers (thumbnailOverlayResumePlaybackRenderer and friends), consulting
// the live _ttVideoProgressCache only as a fallback. So a cached item keeps
// whatever progress it had when it was captured: watch a video, come back, and
// the injected copy still presents it as unwatched, which is exactly what was
// reported. Serving a fresh response instead costs one more collect+reload
// cycle per visit, which is worth it for correct watched state.
export function consumeCachedFullPlaylist(key) {
  const cache = getFullCache();
  if (!cache.has(key)) return;
  cache.delete(key);
  // Mark this page load as already complete so the scheduler stands down:
  // it has the whole playlist and no continuation token, and letting it
  // collect again would store a new cache entry and reload a second time.
  // The reload guard is NOT cleared here — it is cleared on real navigation
  // (_clearState), which is what lets the next visit run its own cycle
  // without allowing a loop within this one.
  window.__ttServedFromCache = key;
}

// adblock.js hands us the raw, unfiltered contents of the initial response so
// the cached list can start with batch 1 — _collectAll only ever returns the
// CONTINUATION batches (53 of 68 on the measured playlist), never the first.
export function noteInitialPlaylistContents(key, contents) {
  if (!Array.isArray(contents) || !contents.length) return;
  window.__ttInitialPlaylistContents = { key, contents: contents.slice() };
  // Fresh page load for this playlist: restart the native tally. It is
  // deliberately NOT cleared in _clearState — something wipes the accumulator
  // mid-visit (the cause of seeded:0) and this counter has to survive that to
  // be a trustworthy floor. Resetting here instead keeps it per-visit, so a
  // second visit cannot double it and lock caching out permanently.
  window.__ttNativeSeen = { key, ids: new Set() };
}

function storeFullPlaylist(key, collectedContents) {
  const initial = window.__ttInitialPlaylistContents;
  if (!initial || initial.key !== key || !Array.isArray(initial.contents)) {
    _log('playlist.full_cache.skip_no_initial', { key });
    return false;
  }
  // Refuse to cache a list shorter than what the page has already shown.
  //
  // Observed on-device: a playlist whose native load had already delivered 68
  // items (15 initial + three continuations of 15 + a final 8) was cached as
  // just 23 — full_cache.stored {initial:15, collected:8, total:23} — because
  // the accumulator was empty at collection time (native_settled {seeded:0})
  // and the collector only fetched the last batch. Injecting that on the next
  // visit renders a playlist with its middle missing, which is what produced
  // the alternating good/broken entries: the broken cache is served and
  // consumed, the next visit loads fresh and looks right, then caches badly
  // again.
  //
  // __ttCurrentPlaylistItems (playlistContinue.js) accumulates every item the
  // page has actually parsed, so it is the honest floor. Caching is skipped
  // rather than fixed up here because a partial list has no continuation token
  // to recover the remainder from - better to serve a fresh response.
  const total = initial.contents.length + collectedContents.length;
  const seenCount = Array.isArray(window.__ttCurrentPlaylistItems) ? window.__ttCurrentPlaylistItems.length : 0;
  // initial + everything native delivered is the true size; take the larger of
  // the two signals so a partial collection cannot slip past either.
  const nativeSeen = (window.__ttNativeSeen && window.__ttNativeSeen.key === key)
    ? initial.contents.length + window.__ttNativeSeen.ids.size
    : 0;
  const floor = Math.max(seenCount, nativeSeen);
  if (floor && total < floor) {
    _log('playlist.full_cache.skip_incomplete', {
      key, total, floor, seenCount, nativeSeen,
      initial: initial.contents.length,
      collected: collectedContents.length,
    });
    return false;
  }

  const cache = getFullCache();
  // Bound the cache: these are full renderer objects and this runs on a TV.
  if (cache.size >= FULL_CACHE_MAX_PLAYLISTS && !cache.has(key)) {
    let oldestKey = null, oldestTs = Infinity;
    for (const [k2, v] of cache) { if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k2; } }
    if (oldestKey !== null) cache.delete(oldestKey);
  }
  cache.set(key, { contents: initial.contents.concat(collectedContents), ts: Date.now() });
  _log('playlist.full_cache.stored', {
    key,
    floor, seenCount, nativeSeen,
    initial: initial.contents.length,
    collected: collectedContents.length,
    total: cache.get(key).contents.length,
  });
  return true;
}

// Reload once per playlist, and only after a COMPLETE collection — a partial
// list would render as a truncated playlist with no way to load the rest,
// since the injected response carries no continuation token.
function maybeReloadForFullPlaylist(key) {
  if (!(window.__ttFullReloadDone instanceof Set)) window.__ttFullReloadDone = new Set();
  if (window.__ttFullReloadDone.has(key)) {
    _log('playlist.full_cache.reload_skipped', { key, reason: 'already_reloaded' });
    return;
  }
  if (playlistKeyFromHash() !== key) {
    _log('playlist.full_cache.reload_skipped', { key, reason: 'navigated_away' });
    return;
  }
  window.__ttFullReloadDone.add(key);
  _log('playlist.full_cache.reloading', { key });
  try {
    // Reached through a window global rather than an ES import. This module
    // must evaluate BEFORE adblock.js so it can capture JSON.parse ahead of
    // adblock's patch; importing resolveCommand (which pulls in settings/UI)
    // would risk reordering that. adblock.js publishes the global.
    const rc = window.__ttResolveCommand;
    if (typeof rc !== 'function') {
      _log('playlist.full_cache.reload_error', { key, err: 'resolveCommand unavailable' });
      return;
    }
    rc({ signalAction: { signal: 'SOFT_RELOAD_PAGE' } });
  } catch (err) {
    _log('playlist.full_cache.reload_error', { key, err: String(err?.message || err) });
  }
}

// Accumulate the playlist from YOUTUBE'S OWN continuation responses.
//
// The background collector re-downloads batches YouTube has usually already
// fetched, and it is far slower doing it. Measured on a 68-video all-watched
// playlist: YouTube delivered every batch between 19:50:42.395 and
// 19:50:43.128 — 0.73s — while the collector, paced at 2.5s per fetch, ran
// from 19:50:45.006 to 19:50:52.963 and only then triggered the reload. That
// left roughly ten seconds of helper tiles on screen for data already in hand.
//
// adblock.js already sees every continuation response before it filters them,
// so it can hand the raw items straight here. When a response arrives with no
// continuation token the playlist is complete, and the reload can happen
// immediately instead of waiting for a redundant re-download.
export function noteContinuationBatch(key, contents, continuations) {
  if (!configRead('enablePlaylistBatchCollect')) return;
  if (!Array.isArray(contents) || !contents.length) return;
  if (getCachedFullPlaylist(key)) return; // already complete; this is the reloaded pass

  // Dedupe by video id. Two handlers feed this (object-root and array-root),
  // and a batch that reached both would otherwise be counted twice, putting
  // duplicate tiles in the cached playlist.
  if (!window.__ttContinuationAcc || window.__ttContinuationAcc.key !== key) {
    window.__ttContinuationAcc = { key, contents: [], seen: {} };
  }
  // Independent tally of what YouTube itself delivered for this playlist.
  // storeFullPlaylist needs a floor it can trust, and the previous attempt
  // used __ttCurrentPlaylistItems (playlistContinue.js). On-device that guard
  // never fired while a 23-item cache was still being stored for a playlist
  // whose native load had delivered 68, so that array is not dependable here.
  // Counts UNIQUE video ids, not raw batch lengths: both the object-root and
  // array-root handlers feed this, so the same batch can arrive twice. Raw
  // lengths gave nativeSeen 84 and 92 for a 68-item playlist, a floor nothing
  // could satisfy. Items with no id are ignored rather than counted, since
  // they would double-count the same way — undercounting the floor merely
  // risks accepting a slightly short cache, while overcounting blocks caching
  // outright.
  if (!window.__ttNativeSeen || window.__ttNativeSeen.key !== key) window.__ttNativeSeen = { key, ids: new Set() };
  for (const item of contents) {
    const nid = getItemVideoId(item);
    if (nid) window.__ttNativeSeen.ids.add(nid);
  }

  const acc = window.__ttContinuationAcc;
  for (const item of contents) {
    const id = getItemVideoId(item);
    if (id) {
      if (acc.seen[id]) continue;
      acc.seen[id] = true;
    }
    acc.contents.push(item);
  }

  // Each native batch pushes the settle timer out and supersedes the token, so
  // the collector resumes from the furthest point YouTube reached.
  scheduleCollectAfterNativeSettles(continuations, 'native_batch');

  if (continuations) return;

  // No continuation token: this was the last batch, so initial + everything
  // accumulated is the whole playlist.
  const collected = window.__ttContinuationAcc.contents;
  _log('playlist.full_cache.from_native', { key, collected: collected.length });
  if (storeFullPlaylist(key, collected)) {
    // YouTube already delivered the whole playlist, so the collector is now
    // re-downloading data we hold. Cancel it rather than let it run on for
    // several more seconds of pointless requests.
    window.__ttCollectCancel = true;
    window.__ttContinuationAcc = null;
    maybeReloadForFullPlaylist(key);
  }
}

// ── Auto-trigger on playlist page load ────────────────────────────────────────
// Called by adblock.js right after the initial playlist page's own
// continuation token is parsed (topPlaylistRenderer.continuations) — starts
// background collection immediately, instead of waiting for the user to
// scroll down once to fire the old seed-triggering continuation request.
// Uses the context/url captured from that same page-load request by the XHR
// send() override above (browse requests always carry `context`, continuation
// or not) — the InnerTube context is client/session info, not tied to any
// one request, so reusing it here is the same assumption _collectAll already
// makes when reusing one captured context across every batch it fetches.
// Wait for YouTube to stop loading on its own, then resume from where it got
// to — rather than re-downloading everything it already delivered.
//
// Measured on a 68-video all-watched playlist: YouTube fetches the initial 15
// plus three continuations of 15 (60 of 68) in about 0.75s and then stops. All
// three carry hasContinuation:true, so there is never a completion signal, and
// the last 8 items are never fetched unless the user scrolls. Starting the
// collector at page load meant it re-fetched batches 2-5 from scratch — 53
// items, 45 of which were already on screen — taking ~10s, with helper tiles
// visible the whole time.
//
// So: hold off until the native burst goes quiet, then hand the collector the
// items already accumulated plus the newest continuation token. It fetches
// only what is genuinely missing (one batch here instead of four).
const NATIVE_SETTLE_MS = 700;

export function scheduleCollectAfterNativeSettles(continuations, reason) {
  if (!configRead('enablePlaylistBatchCollect')) return;
  if (window.__ttPrefetchStarted || window.__ttPrefetchedBatch) return;

  const key = playlistKeyFromHash();
  if (getCachedFullPlaylist(key)) return; // reloaded pass: already complete
  if (window.__ttServedFromCache === key) return; // page already holds the full list

  // Newest token wins — each native continuation supersedes the last.
  if (_getToken(continuations)) window.__ttLatestContinuations = continuations;

  clearTimeout(window.__ttNativeSettleTimer);
  window.__ttNativeSettleTimer = setTimeout(() => {
    // Clear the handle as the timer fires: the XHR seed path treats a set
    // handle as "scheduler owns this" and would otherwise defer forever,
    // losing its fallback role if the scheduled run cannot start.
    window.__ttNativeSettleTimer = null;
    if (playlistKeyFromHash() !== key) return;
    const acc = window.__ttContinuationAcc;
    const seed = (acc && acc.key === key && Array.isArray(acc.contents)) ? acc.contents : [];
    _log('playlist.batch_collect.native_settled', { reason, seeded: seed.length });
    autoStartCollect(window.__ttLatestContinuations, seed);
  }, NATIVE_SETTLE_MS);
}

function autoStartCollect(continuations, seedContents) {
  if (!configRead('enablePlaylistBatchCollect')) return;
  if (window.__ttPrefetchStarted || window.__ttPrefetchedBatch) return;

  if (!_lastBrowseContext || !_lastBrowseUrl) {
    _log('playlist.batch_collect.auto_skip_no_context', {});
    return;
  }

  const token = _getToken(continuations);
  if (!token) return;

  // Fresh run: clear any cancel left over from a previous playlist.
  window.__ttCollectCancel = false;
  _log('playlist.batch_collect.auto_triggered', {
    headerKeys: _lastBrowseHeaders ? Object.keys(_lastBrowseHeaders) : null,
    seeded: Array.isArray(seedContents) ? seedContents.length : 0,
  });

  window.__ttPrefetchStarted = true;
  const startHash = String(window.location?.hash || '');
  const context    = _lastBrowseContext;
  const url        = _lastBrowseUrl;
  const headers    = _lastBrowseHeaders;
  const startKey   = playlistKeyFromHash();

  ;(async () => {
    let collected = null;
    try {
      collected = await _collectAll(url, { contents: Array.isArray(seedContents) ? seedContents : [], continuations }, context, headers);
    } catch (err) {
      _log('playlist.batch_collect.auto_error', { err: String(err?.message || err) });
    }

    window.__ttPrefetchStarted = false;

    if (!collected) return;

    if (String(window.location?.hash || '') !== startHash) {
      _log('playlist.batch_collect.stale_discard', { startHash, currentHash: String(window.location?.hash || '') });
      return;
    }

    window.__ttPrefetchedBatch = {
      allContents:   collected.allContents,
      continuations: collected.continuations,
    };
    _log('playlist.batch_collect.prefetch_ready', {
      items:   collected.allContents.length,
      hasMore: !!collected.continuations,
      auto:    true,
    });

    // Complete collection (no continuation token left) means we now hold the
    // whole playlist. Cache it and reload once, so the initial response can be
    // served complete with continuations nulled — and with no continuation
    // there is no keep-one branch, hence no helper tile at all.
    // A partial collection is deliberately NOT cached: the injected response
    // carries no continuation token, so a truncated list would have no way to
    // ever load its remainder.
    if (!collected.continuations && !collected.aborted) {
      if (storeFullPlaylist(startKey, collected.allContents)) {
        maybeReloadForFullPlaylist(startKey);
        return;
      }
    }
    _triggerReveal('playlist.batch_collect.auto_reveal');
  })();
}

// ── XHR interception ──────────────────────────────────────────────────────────

if (typeof XMLHttpRequest !== 'undefined') {
  const _origXHROpen      = XMLHttpRequest.prototype.open;
  const _origXHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const _origXHRSend      = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__ttUrl        = url;
    this.__ttMethod     = method;
    this.__ttReqHeaders = {};
    return _origXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__ttReqHeaders) this.__ttReqHeaders[name] = value;
    return _origXHRSetHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const url = this.__ttUrl;

    // Fast path: not a browse URL
    if (!_isBrowseUrl(url)) return _origXHRSend.apply(this, arguments);

    // If background collect is running, let ALL XHRs through unchanged.
    // This covers _collectAll sub-requests (via _nativeFetch/polyfill) AND
    // YouTube TV's own continuation retries while collect is in progress.
    if (window.__ttPrefetchStarted) {
      _log('playlist.batch_collect.xhr_skip_already_running', {});
      return _origXHRSend.apply(this, arguments);
    }

    // Capture context/url/headers from EVERY browse request (continuation or
    // not) — this is what lets autoStartCollect() below fire from the initial
    // playlist page load's own request, without waiting for a scroll.
    const reqBody = _parseBody({ body });
    if (reqBody?.context) {
      _lastBrowseContext = reqBody.context;
      _lastBrowseUrl     = url;
      _lastBrowseHeaders = Object.assign({}, this.__ttReqHeaders || {});
      // Key names only — never log header values, some of these carry auth/
      // session tokens (e.g. Authorization, cookies-as-header equivalents).
      _log('playlist.batch_collect.headers_captured', { keys: Object.keys(_lastBrowseHeaders) });
    }

    // Must be a continuation request
    if (!reqBody?.continuation || !reqBody?.context) {
      // A browse-URL XHR that isn't a continuation request — expected for
      // the initial playlist page load. Logged (not silent) since if this
      // fires for what should have been a continuation request, it points
      // at a request-body-shape mismatch as the actual cause.
      _log('playlist.batch_collect.xhr_not_continuation', {
        hasBody: !!reqBody,
        bodyKeys: reqBody && typeof reqBody === 'object' ? Object.keys(reqBody) : null,
      });
      return _origXHRSend.apply(this, arguments);
    }

    // Feature flag
    if (!configRead('enablePlaylistBatchCollect')) return _origXHRSend.apply(this, arguments);

    // Prefetch data already ready — let real XHR through; JSON.parse injection
    // in adblock.js will consume __ttPrefetchedBatch on the next response.
    if (window.__ttPrefetchedBatch) {
      _log('playlist.batch_collect.xhr_prefetch_already_ready', {
        items: window.__ttPrefetchedBatch.allContents?.length ?? null,
        hasMore: !!window.__ttPrefetchedBatch.continuations,
      });
      return _origXHRSend.apply(this, arguments);
    }

    // Stand down if the settle-scheduler is armed. This path fires on the
    // FIRST continuation request (~400ms in), well before the settle timer,
    // and it sets __ttPrefetchStarted — which then makes autoStartCollect
    // bail at its own guard, so the seeded run never happens and collection
    // restarts from batch 2 as if none of this existed. Confirmed on-device:
    // xhr_seed_triggered present, native_settled absent, and the collector
    // refetching batches YouTube had already delivered.
    if (window.__ttNativeSettleTimer) {
      _log('playlist.batch_collect.xhr_seed_deferred', { reason: 'settle_scheduled' });
      return _origXHRSend.apply(this, arguments);
    }

    _log('playlist.batch_collect.xhr_seed_triggered', { url: String(url) });

    // CRITICAL: set __ttPrefetchStarted SYNCHRONOUSLY before send(), so that
    // if _collectAll's own sub-fetches (via _nativeFetch's internal XHR) or
    // any of YouTube TV's own retries hit our patched send() while we're
    // reading this response, they fall straight through to _origXHRSend
    // instead of starting a second seed.
    window.__ttPrefetchStarted = true;

    const startHash = String(window.location?.hash || '');
    const seedKey    = playlistKeyFromHash();
    const seedUrl    = url;
    const context     = reqBody.context;
    // Use this specific request's own headers (not the module-level
    // _lastBrowseHeaders, which could theoretically have been overwritten by
    // another concurrent browse request by the time this fires) — captured
    // synchronously here, before any await.
    const seedHeaders = Object.assign({}, this.__ttReqHeaders || {});
    _log('playlist.batch_collect.seed_headers', { keys: Object.keys(seedHeaders) });

    // Read the REAL response instead of firing a duplicate request for data
    // we're already fetching. this.responseText is the raw string XHR
    // received — untouched by adblock.js's JSON.parse patch, which only
    // intercepts calls to the global JSON.parse function, not XHR response
    // properties — so parsing it with _nativeJSONParse gives the same
    // unfiltered data a second fetch used to, without the extra request.
    this.addEventListener('load', function onLoad() {
      this.removeEventListener('load', onLoad);

      let firstData;
      try {
        firstData = _nativeJSONParse(this.responseText);
      } catch (err) {
        _log('playlist.batch_collect.seed_error', { err: String(err?.message || err) });
        window.__ttPrefetchStarted = false;
        return;
      }

      const plc = firstData?.continuationContents?.playlistVideoListContinuation;
      if (!plc || !Array.isArray(plc.contents) || !plc.continuations) {
        // !plc (no contents at all) is the actually-suspicious case worth a
        // full body dump — plc-with-no-continuations just means this is
        // legitimately the last batch (common, not an error), and its body
        // is the real playlist page data, which can be large.
        _log('playlist.batch_collect.xhr_no_plc', {
          httpStatus:        this.status,
          httpStatusText:    this.statusText,
          hasPlc:            !!plc,
          hasContinuations:  !!(plc?.continuations),
          responseTopKeys:   firstData && typeof firstData === 'object' ? Object.keys(firstData) : null,
          continuationKeys:  firstData?.continuationContents && typeof firstData.continuationContents === 'object' ? Object.keys(firstData.continuationContents) : null,
          responseBody:      plc ? undefined : this.responseText,
        });
        window.__ttPrefetchStarted = false;
        return;
      }

      _log('playlist.batch_collect.seed_fetched', {
        seedItems: plc.contents.length,
        continuationsShape: (() => { try { return JSON.stringify(plc.continuations).slice(0, 300); } catch (_) { return null; } })(),
      });

      // __ttPrefetchStarted is already true — _collectAll sub-requests will go
      // through the _origXHRSend fast path in send().
      ;(async () => {
        let collected = null;
        try {
          collected = await _collectAll(seedUrl, plc, context, seedHeaders);
        } catch (err) {
          _log('playlist.batch_collect.collect_error', { err: String(err?.message || err) });
        }

        window.__ttPrefetchStarted = false;

        if (!collected) return;

        // Discard if the user navigated to a different page while collecting.
        if (String(window.location?.hash || '') !== startHash) {
          _log('playlist.batch_collect.stale_discard', { startHash, currentHash: String(window.location?.hash || '') });
          return;
        }

        window.__ttPrefetchedBatch = {
          allContents:   collected.allContents,
          continuations: collected.continuations,
        };
        _log('playlist.batch_collect.prefetch_ready', {
          items:   collected.allContents.length,
          hasMore: !!collected.continuations,
        });
        // Same completion handling as the scheduled path. Without this the
        // seed path could finish a full collection and still never reload,
        // which is exactly what was observed: batches loaded, no reload, and
        // the page only corrected itself once a manual scroll produced the
        // final native batch.
        if (!collected.continuations && !collected.aborted) {
          if (storeFullPlaylist(seedKey, collected.allContents)) {
            maybeReloadForFullPlaylist(seedKey);
            return;
          }
        }
        _triggerReveal('playlist.batch_collect.seed_reveal');
      })();
    });

    return _origXHRSend.apply(this, arguments);
  };

  _log('playlist.batch_collect.xhr_installed', {});
}

// ── Fetch override ────────────────────────────────────────────────────────────
// Covers desktop browser dev/testing where window.fetch is used natively.
// Uses the same background-collect pattern as the XHR path.

if (_nativeFetch) {
  window.fetch = async function playlistBatchCollectFetch(url, options) {
    // Same decision points as the XHR path above, logged the same way for
    // parity — this path is desktop dev/testing only per the comment
    // below, but kept consistent in case it's ever hit unexpectedly.
    if (!_isBrowseUrl(url))              return _nativeFetch(url, options);
    if (window.__ttPrefetchStarted) {
      _log('playlist.batch_collect.fetch_skip_already_running', {});
      return _nativeFetch(url, options);
    }
    if (window.__ttPrefetchedBatch) {
      _log('playlist.batch_collect.fetch_prefetch_already_ready', {
        items: window.__ttPrefetchedBatch.allContents?.length ?? null,
        hasMore: !!window.__ttPrefetchedBatch.continuations,
      });
      return _nativeFetch(url, options);
    }

    const reqBody = _parseBody(options);
    // options.headers can be a plain object or a Headers instance — normalize
    // to a plain object either way.
    const optHeaders = (() => {
      try {
        if (!options?.headers) return {};
        if (typeof options.headers.forEach === 'function' && typeof options.headers.entries === 'function') {
          const out = {};
          options.headers.forEach((v, k) => { out[k] = v; });
          return out;
        }
        return Object.assign({}, options.headers);
      } catch (_) { return {}; }
    })();
    if (reqBody?.context) {
      _lastBrowseContext = reqBody.context;
      _lastBrowseUrl     = String(url);
      _lastBrowseHeaders = optHeaders;
    }
    if (!reqBody?.continuation || !reqBody?.context) return _nativeFetch(url, options);
    if (!configRead('enablePlaylistBatchCollect'))   return _nativeFetch(url, options);

    // Let the real fetch through immediately.
    const response = await _nativeFetch(url, options);

    let data;
    try {
      const text = await response.clone().text();
      data = _nativeJSONParse(text);
    } catch (_) { return response; }

    const plc = data?.continuationContents?.playlistVideoListContinuation;
    if (!plc || !Array.isArray(plc.contents) || !plc.continuations) return response;

    const startHash = String(window.location?.hash || '');
    window.__ttPrefetchStarted = true;

    ;(async () => {
      let collected = null;
      try {
        collected = await _collectAll(String(url), plc, reqBody.context, optHeaders);
      } catch (err) {
        _log('playlist.batch_collect.error', { err: String(err?.message || err) });
      }
      window.__ttPrefetchStarted = false;
      if (!collected) return;
      if (String(window.location?.hash || '') !== startHash) return;
      window.__ttPrefetchedBatch = { allContents: collected.allContents, continuations: collected.continuations };
      _log('playlist.batch_collect.prefetch_ready', { items: collected.allContents.length, hasMore: !!collected.continuations });
      _triggerReveal('playlist.batch_collect.fetch_reveal');
    })();

    return response;
  };

  _log('playlist.batch_collect.fetch_installed', {});
}
