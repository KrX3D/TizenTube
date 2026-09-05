import { configRead } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';

// Tizen tears down the media pipeline when the TV is suspended (remote power
// button, standby). Nothing in the page is told: YouTube's player object and
// the whole SPA survive in the DOM, so navigation, shelves and ad-stripping all
// keep working on resume — but no video will ever play again. Watch pages open
// to a frozen first frame and pause/unpause does nothing, until the app is
// hard-closed and relaunched.
//
// The web platform's only signal for this is visibilitychange, which nothing
// here listened for. On becoming visible again we check whether a usable media
// element is present; if it is not, the page is reloaded so YouTube rebuilds
// its player against a live pipeline.
//
// The check is deliberately conservative — a reload costs the exact playback
// position (YouTube restores its own saved position, so not from zero) and we
// only want to pay that when playback is genuinely dead:
//   * no <video> at all, or
//   * a <video> stuck at readyState 0 (HAVE_NOTHING) with no error set, which
//     is what a torn-down decoder looks like from script.
// A short settle delay avoids racing YouTube's own resume handling, which can
// legitimately leave readyState at 0 for a moment right after becoming visible.

const SETTLE_MS = 1500;

let pending = null;

function playerLooksDead() {
  const video = document.querySelector('video');
  if (!video) return true;
  if (video.error) return false;
  return video.readyState === 0;
}

function onVisible() {
  if (!playerLooksDead()) {
    appendFileOnlyLog('resume.player_alive', {});
    return;
  }
  appendFileOnlyLog('resume.player_dead_reloading', {
    hasVideo: !!document.querySelector('video'),
    href: String(location.hash || '')
  });
  location.reload();
}

document.addEventListener('visibilitychange', () => {
  if (!configRead('enableReloadOnResume')) return;

  if (pending) {
    clearTimeout(pending);
    pending = null;
  }
  if (document.visibilityState !== 'visible') return;

  pending = setTimeout(() => {
    pending = null;
    try {
      onVisible();
    } catch (err) {
      appendFileOnlyLog('resume.check_failed', { message: err?.message || String(err) });
    }
  }, SETTLE_MS);
});
