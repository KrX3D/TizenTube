import { configRead } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';

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
