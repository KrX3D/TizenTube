import { appendFileOnlyLog } from './hideWatched.js';

/**
 * resumeOutOfVideo.js — wake reloads leave the video page before reloading
 * and reopen the video afterwards.
 *
 * Reported on 6.5: the TV was powered off during a video. Powered on again,
 * the wake reload brought the app back on that video, but the profile picker
 * came first and then a survey. Only after both were closed did the video
 * continue.
 *
 * Every wake reload on the 6.5 TV that landed on a video page was followed
 * within seconds by a profile pick (identity-changed in whosWatching.actions):
 * Nov 9 08:46, 09:08 and 10:11, Nov 11 09:15 and Nov 13 11:18. Reloads that
 * landed on Home, Library or Subscriptions never were. Starting the app
 * straight into a /watch URL looks like a deep-link launch to YouTube, and it
 * asks who is watching. It happens before the mod has finished loading, so
 * nothing on the page can stop it. The three recurring "who's watching"
 * actions disableWhosWatching.js pushes into the future did not fire.
 *
 * So the reload goes to Home instead, with the video noted in sessionStorage,
 * and the reopen below plays it again once the app can take a command.
 * sessionStorage, because the note has to survive this reload and nothing
 * else; it carries a timestamp so a stale one is ignored.
 */

const KEY = 'ytaf-resume-video';
// A note older than this belongs to some other reload.
const MAX_AGE_MS = 120000;
// How long to keep trying to reach YouTube's command resolver after startup.
const RESOLVER_WAIT_MS = 20000;
const RESOLVER_POLL_MS = 250;

// Only the three values this needs, each read by a fixed pattern. A generic
// parser that copies every key from the URL onto an object is what code
// scanning flagged (a key such as __proto__ would write to the prototype).
function hashParam(name) {
  const query = String(location.hash || '').split('?')[1] || '';
  const match = query.match(new RegExp('(?:^|&)' + name + '=([^&]*)'));
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch (_) { return match[1]; }
}

/**
 * Reload, but out of a video page if that is where the app is.
 *
 * Returns false when not on a video page and nothing was done, so the caller
 * reloads the usual way.
 */
export function reloadOutOfVideo() {
  try {
    const hash = String(location.hash || '');
    if (!hash.startsWith('#/watch')) return false;
    const videoId = hashParam('v');
    if (!videoId) return false;
    const video = document.querySelector('video');
    const time = video && isFinite(video.currentTime) ? Math.floor(video.currentTime) : 0;
    const note = { videoId, at: Date.now(), time };
    const list = hashParam('list');
    if (list) note.playlistId = list;
    const index = hashParam('index');
    if (/^\d+$/.test(index)) note.index = Number(index);
    sessionStorage.setItem(KEY, JSON.stringify(note));
    // replaceState rather than assigning the hash: a hash change is handled by
    // YouTube's router as a navigation, and the reload must not race it.
    history.replaceState(history.state, '', location.href.split('#')[0] + '#/');
    appendFileOnlyLog('resume.leftVideo', { videoId, time, playlist: !!note.playlistId });
    location.reload();
    return true;
  } catch (err) {
    appendFileOnlyLog('resume.leaveVideoFailed', { msg: String(err?.message || err) });
    return false;
  }
}

function resolverReady() {
  try {
    for (const key in window._yttv) {
      if (window._yttv[key] && window._yttv[key].instance && window._yttv[key].instance.resolveCommand) return true;
    }
  } catch (_) { }
  return false;
}

/**
 * At startup: play the video a wake reload left, if there is one.
 *
 * @param {(cmd: object) => void} resolveCommand
 * @returns {boolean} whether a video is being reopened
 */
export function reopenVideoAfterReload(resolveCommand) {
  let note = null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return false;
    sessionStorage.removeItem(KEY);
    note = JSON.parse(raw);
  } catch (_) {
    return false;
  }
  const ageMs = Date.now() - Number(note?.at || 0);
  if (!note?.videoId || !isFinite(ageMs) || ageMs < 0 || ageMs > MAX_AGE_MS) {
    appendFileOnlyLog('resume.reopenSkipped', { reason: 'stale', ageMs });
    return false;
  }
  const endpoint = { videoId: note.videoId };
  if (note.playlistId) endpoint.playlistId = note.playlistId;
  if (typeof note.index === 'number') endpoint.index = note.index;
  if (note.time > 0) endpoint.startTimeSeconds = note.time;

  const startedAt = Date.now();
  const attempt = () => {
    // The user already went somewhere else; do not pull them back.
    const hash = String(location.hash || '');
    if (hash && hash !== '#/' && hash !== '#') {
      appendFileOnlyLog('resume.reopenSkipped', { reason: 'navigated', hash: hash.slice(0, 40) });
      return;
    }
    if (!resolverReady()) {
      if (Date.now() - startedAt < RESOLVER_WAIT_MS) { setTimeout(attempt, RESOLVER_POLL_MS); return; }
      appendFileOnlyLog('resume.reopenSkipped', { reason: 'noResolver' });
      return;
    }
    try {
      resolveCommand({ clickTrackingParams: null, watchEndpoint: endpoint });
      appendFileOnlyLog('resume.reopenedVideo', { videoId: note.videoId, time: endpoint.startTimeSeconds || 0, afterMs: Date.now() - startedAt });
    } catch (err) {
      appendFileOnlyLog('resume.reopenFailed', { msg: String(err?.message || err) });
    }
  };
  attempt();
  return true;
}
