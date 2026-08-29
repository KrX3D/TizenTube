/**
 * playlistBatchCollect.js
 *
 * Strategy: let real XHR through immediately, collect all remaining batches
 * in the background, store in window.__ttPrefetchedBatch.  adblock.js injects
 * the result into the next playlist continuation JSON.parse — no XHR delivery,
 * no 614KB re-parse.
 *
 * Two trigger paths feed the same background collector:
 *  - autoStartCollect(): called by adblock.js right after the initial
 *    playlist page's own continuation token is parsed, so collection starts
 *    on page load without needing any scroll at all.
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

import { appendFileOnlyLog } from './hideWatched.js';
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

function _clearState() {
  window.__ttPrefetchedBatch  = null;
  window.__ttPrefetchStarted  = false;
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

// ── Progress overlay ──────────────────────────────────────────────────────────
function _showProgress(msg) {
  if (typeof document === 'undefined') return;
  const id = 'tt-batch-collect-notice';
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    Object.assign(el.style, {
      position: 'fixed', left: '50%', bottom: '4%',
      transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.88)', color: '#fff',
      padding: '12px 22px', borderRadius: '10px',
      zIndex: '999999', fontSize: '16px',
      pointerEvents: 'none',
    });
    document.body?.appendChild(el);
  }
  el.textContent = msg;
}

function _hideProgress() {
  if (typeof document === 'undefined') return;
  document.getElementById('tt-batch-collect-notice')?.remove();
}

// ── AbortController shim for older WebKit ─────────────────────────────────────
function _makeAbort() {
  if (typeof AbortController !== 'undefined') return new AbortController();
  const signal = { aborted: false };
  return { signal, abort() { signal.aborted = true; } };
}

// ── Core: collect all remaining batches ───────────────────────────────────────
// IMPORTANT: uses _nativeJSONParse (not patched JSON.parse) so watched items
// are NOT filtered out during collection — we need the raw batch data.

async function _collectAll(url, plc, context) {
  const MAX = Math.max(1, Math.min(500, Number(configRead('playlistBatchCollectMaxBatches') || 50)));

  if (!context || !_nativeFetch) return null;

  const allContents = Array.isArray(plc.contents) ? [...plc.contents] : [];
  let continuations = plc.continuations;
  let batchesLoaded = 1;
  const abort = _makeAbort();
  const nativeAbort = typeof AbortController !== 'undefined';

  const onNav = () => abort.abort();
  window.addEventListener('hashchange', onNav, { once: true });
  window.addEventListener('popstate',   onNav, { once: true });

  _showProgress(`Playlist: loading batch ${batchesLoaded}…`);

  try {
    while (continuations && batchesLoaded < MAX && !abort.signal.aborted) {
      const token = _getToken(continuations);
      if (!token) {
        _log('playlist.batch_collect.no_token', {
          batch: batchesLoaded,
          continuationsShape: (() => { try { return JSON.stringify(continuations).slice(0, 300); } catch (_) { return null; } })(),
        });
        break;
      }

      const fetchOpts = {
        method:      'POST',
        headers:     { 'content-type': 'application/json' },
        body:        JSON.stringify({ context, continuation: token }),
        credentials: 'include',
        mode:        'cors',
      };
      if (nativeAbort) fetchOpts.signal = abort.signal;

      let nextData;
      try {
        const nextResp = await _nativeFetch(url, fetchOpts);
        // Use _nativeJSONParse — the polyfill's .json() calls the patched
        // JSON.parse which would filter out watched items, corrupting the data.
        const text = await nextResp.text();
        nextData = _nativeJSONParse(text);
      } catch (err) {
        _log('playlist.batch_collect.sub_error', {
          batch: batchesLoaded,
          aborted: abort.signal.aborted,
          err: String(err?.message || err),
        });
        break;
      }

      const nextPlc = nextData?.continuationContents?.playlistVideoListContinuation;
      if (!nextPlc) {
        _log('playlist.batch_collect.no_plc', {
          batch: batchesLoaded,
          responseKeys: nextData && typeof nextData === 'object' ? Object.keys(nextData) : null,
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
      _showProgress(`Playlist: loading batch ${batchesLoaded}…`);
    }
  } finally {
    window.removeEventListener('hashchange', onNav);
    window.removeEventListener('popstate',   onNav);
    _hideProgress();
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
export function autoStartCollect(continuations) {
  if (!configRead('enablePlaylistBatchCollect')) return;
  if (window.__ttPrefetchStarted || window.__ttPrefetchedBatch) return;

  if (!_lastBrowseContext || !_lastBrowseUrl) {
    _log('playlist.batch_collect.auto_skip_no_context', {});
    return;
  }

  const token = _getToken(continuations);
  if (!token) return;

  _log('playlist.batch_collect.auto_triggered', {});

  window.__ttPrefetchStarted = true;
  const startHash = String(window.location?.hash || '');
  const context    = _lastBrowseContext;
  const url        = _lastBrowseUrl;

  ;(async () => {
    let collected = null;
    try {
      collected = await _collectAll(url, { contents: [], continuations }, context);
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

    // Capture context/url from EVERY browse request (continuation or not) —
    // this is what lets autoStartCollect() below fire from the initial
    // playlist page load's own request, without waiting for a scroll.
    const reqBody = _parseBody({ body });
    if (reqBody?.context) {
      _lastBrowseContext = reqBody.context;
      _lastBrowseUrl     = url;
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

    _log('playlist.batch_collect.xhr_seed_triggered', { url: String(url) });

    // CRITICAL: set __ttPrefetchStarted SYNCHRONOUSLY before send(), so that
    // if _collectAll's own sub-fetches (via _nativeFetch's internal XHR) or
    // any of YouTube TV's own retries hit our patched send() while we're
    // reading this response, they fall straight through to _origXHRSend
    // instead of starting a second seed.
    window.__ttPrefetchStarted = true;

    const startHash = String(window.location?.hash || '');
    const seedUrl    = url;
    const context     = reqBody.context;

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
        _log('playlist.batch_collect.xhr_no_plc', {
          hasPlc:            !!plc,
          hasContinuations:  !!(plc?.continuations),
          responseTopKeys:   firstData && typeof firstData === 'object' ? Object.keys(firstData) : null,
          continuationKeys:  firstData?.continuationContents && typeof firstData.continuationContents === 'object' ? Object.keys(firstData.continuationContents) : null,
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
          collected = await _collectAll(seedUrl, plc, context);
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
    if (reqBody?.context) {
      _lastBrowseContext = reqBody.context;
      _lastBrowseUrl     = String(url);
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
        collected = await _collectAll(String(url), plc, reqBody.context);
      } catch (err) {
        _log('playlist.batch_collect.error', { err: String(err?.message || err) });
      }
      window.__ttPrefetchStarted = false;
      if (!collected) return;
      if (String(window.location?.hash || '') !== startHash) return;
      window.__ttPrefetchedBatch = { allContents: collected.allContents, continuations: collected.continuations };
      _log('playlist.batch_collect.prefetch_ready', { items: collected.allContents.length, hasMore: !!collected.continuations });
    })();

    return response;
  };

  _log('playlist.batch_collect.fetch_installed', {});
}
