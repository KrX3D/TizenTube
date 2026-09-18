import { configRead } from '../config.js';
import { appendFileOnlyLog, detectCurrentPage } from './hideWatched.js';
import { noteProgressChanged } from './watchProgressStore.js';

/**
 * playbackProgress.js — record how far a video was actually watched, from the
 * player itself.
 *
 * Reported again: watch a few videos from a playlist, go back to it (or away to
 * Home or Subscriptions and back in), and the ones just watched are still
 * listed. The watched-video filter only knows what YouTube tells it:
 *
 *   1. the progress overlay on the tile, which the playlist response often
 *      simply does not carry for a video watched minutes ago, and
 *   2. window._ttVideoProgressCache, filled from progress entries YouTube
 *      happens to include in other responses.
 *
 * Neither is a record of what was watched here. If YouTube's history has not
 * caught up — and it lags — the video looks unwatched, however long it was
 * on screen. An earlier capture of this exact report came down to the same
 * thing: the playlist response carried no overlay for those items, and the
 * cache had nothing either.
 *
 * The player knows. So while a video plays on the watch page, its position is
 * written into the same cache the filter already falls back on, and the store
 * persists it across restarts. Values only ever go up: a lagging number from
 * YouTube, or a rewatch starting at 0, must not undo what was watched.
 */

// How often a playing video is sampled. Frequent enough that leaving the watch
// page mid-video loses little; rare enough to cost nothing.
const SAMPLE_EVERY_MS = 5000;

// The URL names the content video even while an ad plays, so a video is only
// credited when the element's length matches the real one from the player
// response. An ad, or anything else in that element, has a different length.
const LENGTH_TOLERANCE_S = 3;

// Bounded; one entry per video opened in this session.
const MAX_LENGTHS = 50;
const _lengths = new Map();

let _lastSampleAt = 0;
// Per video, whether the crossing of the hide threshold has been logged, so a
// capture shows each video once rather than every five seconds.
const _loggedCrossing = new Set();

/**
 * Learn a video's true length from a player response. Called from both of
 * adblock.js's response paths — the object-root and array-root branches have
 * repeatedly diverged, and a feature fed by only one of them works half the
 * time.
 */
export function noteVideoLength(payload) {
  try {
    const details = payload?.videoDetails;
    if (!details?.videoId) return;
    const length = Number(details.lengthSeconds);
    if (!isFinite(length) || length <= 0) return;
    const id = String(details.videoId);
    _lengths.delete(id);
    _lengths.set(id, length);
    if (_lengths.size > MAX_LENGTHS) _lengths.delete(_lengths.keys().next().value);
  } catch (_) { }
}

function watchVideoId() {
  try {
    if (detectCurrentPage() !== 'watch') return null;
    const hash = String(location.hash || '');
    const q = hash.indexOf('?');
    if (q === -1) return null;
    const v = new URLSearchParams(hash.slice(q + 1)).get('v');
    return v && /^[A-Za-z0-9_-]{11}$/.test(v) ? v : null;
  } catch (_) {
    return null;
  }
}

function record(video, reason) {
  if (!configRead('enableHideWatchedVideos')) return;
  const videoId = watchVideoId();
  if (!videoId) return;

  const expected = _lengths.get(videoId);
  const duration = Number(video?.duration);
  // Unknown length means content and ad cannot be told apart, so nothing is
  // recorded rather than risk crediting an ad's end to the video.
  if (!expected || !isFinite(duration) || duration <= 0) return;
  if (Math.abs(duration - expected) > LENGTH_TOLERANCE_S) return;

  let pct = reason === 'ended' ? 100 : Math.floor((Number(video.currentTime) / duration) * 100);
  if (!isFinite(pct)) return;
  pct = Math.max(0, Math.min(100, pct));

  if (!window._ttVideoProgressCache) window._ttVideoProgressCache = {};
  const before = Number(window._ttVideoProgressCache[videoId]);
  if (isFinite(before) && before >= pct) return;
  window._ttVideoProgressCache[videoId] = pct;
  noteProgressChanged(videoId);

  const threshold = Number(configRead('hideWatchedVideosThreshold')) || 0;
  if ((pct >= threshold && !_loggedCrossing.has(videoId)) || reason === 'ended') {
    _loggedCrossing.add(videoId);
    appendFileOnlyLog('hideVideo.progress_played', { videoId, pct, reason, threshold });
  }
}

function onMedia(evt) {
  try {
    const video = evt?.target;
    if (!video || String(video.tagName || '').toUpperCase() !== 'VIDEO') return;
    if (evt.type === 'timeupdate') {
      const now = Date.now();
      if (now - _lastSampleAt < SAMPLE_EVERY_MS) return;
      _lastSampleAt = now;
    }
    record(video, evt.type);
  } catch (_) { }
}

// ── Did the playlist actually re-render? ─────────────────────────────────────
// Recording progress fixes the case where YouTube sends the playlist again but
// without the new progress. It cannot help if YouTube sends nothing at all and
// re-shows the page it already had, which Back from the watch page may well
// do. Rather than guess, say which it was: a few seconds after landing on a
// playlist, log whether a response for it arrived.
const RENDER_CHECK_MS = 4000;
let _playlistEnteredAt = 0;

function onNavigate() {
  try {
    if (detectCurrentPage() !== 'playlist') return;
    const enteredAt = Date.now();
    _playlistEnteredAt = enteredAt;
    setTimeout(() => {
      if (_playlistEnteredAt !== enteredAt) return;
      const rendered = window.__ttPageRenderedAt;
      const responded = !!(rendered && rendered.page === 'playlist' && rendered.at >= enteredAt);
      appendFileOnlyLog('playlist.return', {
        responded,
        recordedThisSession: _loggedCrossing.size,
        hash: String(location.hash || '').slice(0, 80),
      });
    }, RENDER_CHECK_MS);
  } catch (_) { }
}

if (!window.__ttPlaybackProgressInit) {
  window.__ttPlaybackProgressInit = true;
  try {
    // Media events do not bubble, but a capturing listener on the document
    // still receives them, so one listener covers whichever video element the
    // app creates or replaces.
    document.addEventListener('timeupdate', onMedia, true);
    document.addEventListener('pause', onMedia, true);
    document.addEventListener('ended', onMedia, true);
    window.addEventListener('hashchange', onNavigate);
  } catch (_) { }
}
