/**
 * injectorAlive.js — whether the standalone app's injector is still attached
 * to this page.
 *
 * On the CDP path the mod only reaches a page because the service's injector
 * evaluates it into every new execution context over a CDP connection. If
 * that connection is gone, a reload brings back plain YouTube: ads, every
 * shelf, no settings. Seen on the 5.0 TV after a night in standby: the page
 * woke, reloaded on resume, and came back without the mod until the app was
 * reopened.
 *
 * The injector stamps window.__ttInjectorSeenAt on each log poll (every two
 * seconds). A stamp newer than the moment of asking means it is still there.
 * A page whose service is older than the stamp never gets one, and is
 * reported as 'unknown' so callers keep their old behaviour.
 */

const POLL_MS = 250;

function onCdpPath() {
  try {
    return window.__ttStandalone === true && location.hostname !== 'localhost';
  } catch (_) {
    return false;
  }
}

/** Resolves to 'alive', 'gone' or 'unknown'. */
export function checkInjector(timeoutMs) {
  if (!onCdpPath() || typeof window.__ttInjectorSeenAt !== 'number') return Promise.resolve('unknown');
  const since = Date.now();
  const limit = Number(timeoutMs) || 6000;
  return new Promise((resolve) => {
    const tick = () => {
      if (window.__ttInjectorSeenAt >= since) return resolve('alive');
      if (Date.now() - since >= limit) return resolve('gone');
      setTimeout(tick, POLL_MS);
    };
    tick();
  });
}
