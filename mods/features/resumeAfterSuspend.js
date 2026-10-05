import { configRead } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';
import { waitForNetwork } from './networkReady.js';
import { noteReload } from './reloadCoordinator.js';
import { showToast } from '../ui/ytUI.js';
import { t } from 'i18next';

const SETTLE_MS = 1500;

// Past this, the page is stale whatever the player looks like: continuations,
// tokens and the whole feed were fetched before the TV went to sleep.
//
// Reported: powered the TV off on the home page, powered it on later, and the
// page had not reloaded. The check below asks whether the *player* looks dead,
// which is the right question on a watch page and the wrong one everywhere
// else — the home page has an inline-preview <video> that reads as perfectly
// alive, so nothing reloaded. A long absence now decides on its own.
const STALE_MS = 300000;

// The heartbeat that notices a sleep nothing announced.
//
// visibilitychange is the only signal this had, and it is not guaranteed: when
// the platform freezes the whole process, no event is delivered on the way out
// or on the way back. Timers stop with it though, so a tick that arrives far
// later than it was due is itself the evidence — if more than SUSPEND_GAP_MS
// of wall clock passed between two ticks HEARTBEAT_MS apart, the app was not
// running for that time.
const HEARTBEAT_MS = 10000;
const SUSPEND_GAP_MS = 60000;

// How long to wait for the network after waking before giving up on this
// wake. Reloading into ERR_INTERNET_DISCONNECTED replaces YouTube with the
// webview's error page, which is strictly worse than leaving the current page
// alone — so past this point the reload is deferred to the next 'online'
// event rather than attempted anyway.
const NETWORK_WAIT_MS = 120000;

// A toast is gone after a few seconds and the wait can last two minutes, so
// it is repeated while waiting — often enough that the screen never looks
// frozen, not so often that it nags.
const TOAST_REPEAT_MS = 15000;
const RELOAD_NOTICE_MS = 1200;

let pending = null;

function toast(key, options) {
  try { showToast('TizenTube', t(key, options)); } catch (_) { }
}

// Bumped on every visibility change. A wait started for one wake is abandoned
// as soon as the TV goes back to standby or wakes again, and the newer wake
// runs its own. A "one wait at a time" guard looked tidier but was wrong: a
// quick off-on-off-on cancelled the first wait while the guard turned the
// second wake away, so nothing reloaded at all.
let generation = 0;

function playerLooksDead() {
  const video = document.querySelector('video');
  if (!video) return true;
  if (video.error) return true;
  return video.readyState === 0;
}

async function onVisible(gen, awayMs) {
  // A short absence is the frozen-first-frame case this started as, and only
  // the player needs looking at. A long one means the page itself is stale.
  const stale = awayMs >= STALE_MS;
  if (!stale && !playerLooksDead()) {
    appendFileOnlyLog('resume.player_alive', { awayMs });
    return;
  }
  if (stale) appendFileOnlyLog('resume.page_stale', { awayMs, hasVideo: !!document.querySelector('video') });
  if (window.__ttResumeReloaded) {
    appendFileOnlyLog('resume.already_reloaded', {});
    return;
  }
  // Reported on 6.5: this reload used to fire 1.5s after waking, while the
  // network was still reconnecting, and landed on the webview's own
  // ERR_INTERNET_DISCONNECTED page — which, being the webview's document and
  // not YouTube's, has nothing of ours left in it to recover from. 5.5
  // reconnects faster, which is why it only showed up there. See
  // networkReady.js.
  // Only tell the user once there is actually something to wait for: on a
  // normal wake the network is already up and a toast would just flash past.
  let lastToastAt = 0;
  let toldWaiting = false;
  const net = await waitForNetwork({
    timeoutMs: NETWORK_WAIT_MS,
    shouldContinue: () => gen === generation && document.visibilityState === 'visible',
    onAttemptFailed: ({ waitedMs }) => {
      const now = Date.now();
      if (toldWaiting && now - lastToastAt < TOAST_REPEAT_MS) return;
      toldWaiting = true;
      lastToastAt = now;
      toast('toasts.networkWaiting', { seconds: Math.max(1, Math.round(waitedMs / 1000)) });
    },
  });

  // A later wake took over while this one waited; that one decides.
  if (gen !== generation) {
    appendFileOnlyLog('resume.superseded', net);
    return;
  }

  if (net.cancelled) {
    appendFileOnlyLog('resume.network_wait_cancelled', net);
    return;
  }
  if (!net.online) {
    appendFileOnlyLog('resume.offline_not_reloading', net);
    toast('toasts.networkStillOffline');
    // Try again the moment the link comes back, rather than only on the next
    // wake — a TV left on with the router rebooting would otherwise stay dead.
    try { window.addEventListener('online', () => schedule(), { once: true }); } catch (_) { }
    return;
  }

  // YouTube may have recovered on its own while the network came back; a
  // reload is only worth its cost if the player is still dead. Not for a
  // stale page though: its player looking fine is exactly the case that used
  // to leave a two-hour-old feed on screen.
  if (!stale && !playerLooksDead()) {
    appendFileOnlyLog('resume.recovered_while_waiting', net);
    if (toldWaiting) toast('toasts.networkBack');
    return;
  }
  // Checked again here, not only on entry: the wait is long enough for
  // another path to have reloaded already.
  if (window.__ttResumeReloaded) {
    appendFileOnlyLog('resume.already_reloaded', {});
    return;
  }
  appendFileOnlyLog('resume.player_dead_reloading', Object.assign({
    hasVideo: !!document.querySelector('video'),
    href: String(location.hash || ''),
  }, net));
  window.__ttResumeReloaded = true;
  // So the startup reload that runs once the page comes back does not reload it
  // a second time for the same wake.
  noteReload('resume');
  if (!toldWaiting) {
    location.reload();
    return;
  }
  // After a visible wait, say what is about to happen and give the toast a
  // moment on screen — reloading at once would wipe it before it rendered.
  toast('toasts.networkBackReloading');
  setTimeout(() => location.reload(), RELOAD_NOTICE_MS);
}

function schedule(awayMs) {
  if (pending) {
    clearTimeout(pending);
    pending = null;
  }
  if (document.visibilityState !== 'visible') return;
  const gen = generation;
  const away = Number(awayMs) || 0;
  pending = setTimeout(() => {
    pending = null;
    onVisible(gen, away).catch((err) => {
      appendFileOnlyLog('resume.check_failed', { message: err?.message || String(err) });
    });
  }, SETTLE_MS);
}

// When the page was last hidden, so a wake knows how long the TV was away.
let hiddenAt = 0;

document.addEventListener('visibilitychange', () => {
  if (!configRead('enableReloadOnResume')) return;
  if (document.visibilityState !== 'visible') {
    hiddenAt = Date.now();
    return;
  }
  generation++;
  schedule(hiddenAt ? Date.now() - hiddenAt : 0);
});

// The heartbeat. Runs whatever the setting says, because it is also what tells
// the gap apart from a tick that was merely late; the setting is checked when
// there is something to act on.
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const gap = now - lastTick;
  lastTick = now;
  if (gap < SUSPEND_GAP_MS) return;
  // Nothing fired on the way in or out, so this is the only notice that the
  // app was asleep. Logged either way: a gap with the setting off still
  // explains a stale page.
  appendFileOnlyLog('resume.clock_gap', { gapMs: gap, willReload: configRead('enableReloadOnResume') === true });
  if (configRead('enableReloadOnResume') !== true) return;
  if (document.visibilityState !== 'visible') return;
  generation++;
  schedule(gap);
}, HEARTBEAT_MS);
