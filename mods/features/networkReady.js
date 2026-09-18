/**
 * networkReady.js — wait until the network can actually reach YouTube.
 *
 * Reported on Tizen 6.5: power the TV off and on, and instead of reloading the
 * page the app sometimes shows the webview's own error page —
 * "Die angeforderte Seite kann nicht gefunden werden", ERR_INTERNET_DISCONNECTED.
 * The same steps on 5.5 reload cleanly.
 *
 * ERR_INTERNET_DISCONNECTED is not a timeout or a server failure. Chromium
 * returns it when it believes the device is offline — the same state
 * navigator.onLine reports — so a navigation was issued while the network was
 * still coming back from standby. 6.5 evidently takes longer to reconnect than
 * the 1.5 seconds resumeAfterSuspend gave it. Once that error page is up the
 * document is the webview's, not YouTube's, so nothing of ours is left running
 * to recover it; the only fix is not to navigate until the network is there.
 *
 * Two signals, because each alone is too weak:
 *
 *   navigator.onLine   exactly the flag behind this error, but it only says a
 *                      link exists, not that DNS or a route works yet
 *   a probe request    to generate_204, which answers with an empty 204 and is
 *                      what YouTube's own player uses to check reachability
 *
 * The probe uses no-cors, so it works from every origin this runs on — real
 * youtube.com on the injection path, localhost on the proxy path — and the
 * opaque response is fine: only whether it arrived matters.
 */

const PROBE_URL = 'https://www.youtube.com/generate_204';
const PROBE_TIMEOUT_MS = 4000;
const FIRST_DELAY_MS = 1000;
const MAX_DELAY_MS = 5000;

export function isBrowserOffline() {
  try { return navigator.onLine === false; } catch (_) { return false; }
}

function probeOnce() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => { if (!settled) { settled = true; resolve(ok); } };
    const timer = setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
    try {
      // The query string and no-store both stop a cached 204 from answering
      // for a network that is not actually there.
      fetch(PROBE_URL + '?_=' + Date.now(), { mode: 'no-cors', cache: 'no-store', credentials: 'omit' })
        .then(() => { clearTimeout(timer); finish(true); })
        .catch(() => { clearTimeout(timer); finish(false); });
    } catch (_) {
      clearTimeout(timer);
      finish(false);
    }
  });
}

// A delay that ends early when the browser reports the link is back, so a
// reconnect is acted on at once rather than at the next poll.
function pause(ms) {
  return new Promise((resolve) => {
    let timer = null;
    const done = () => {
      clearTimeout(timer);
      try { window.removeEventListener('online', done); } catch (_) { }
      resolve();
    };
    timer = setTimeout(done, ms);
    try { window.addEventListener('online', done); } catch (_) { }
  });
}

/**
 * Resolve once YouTube is reachable, or when the wait is abandoned.
 *
 * @param {object}   opts
 * @param {number}   opts.timeoutMs      give up after this long
 * @param {Function} opts.shouldContinue polled between attempts; returning
 *                                       false cancels, e.g. when the TV goes
 *                                       back to standby mid-wait
 * @param {Function} opts.onAttemptFailed called after each attempt that found
 *                                       no network, with { attempts, waitedMs,
 *                                       offline } — how the caller tells the
 *                                       user something is happening
 * @returns {Promise<{online:boolean, cancelled?:boolean, timedOut?:boolean,
 *                    attempts:number, waitedMs:number, offlineAtStart:boolean}>}
 */
export async function waitForNetwork({ timeoutMs = 120000, shouldContinue = () => true, onAttemptFailed = null } = {}) {
  const started = Date.now();
  const offlineAtStart = isBrowserOffline();
  let attempts = 0;
  let delay = FIRST_DELAY_MS;
  const result = (extra) => Object.assign({ attempts, waitedMs: Date.now() - started, offlineAtStart }, extra);

  while (Date.now() - started < timeoutMs) {
    if (!shouldContinue()) return result({ online: false, cancelled: true });
    attempts++;
    // Only probe once the browser itself thinks there is a link — probing
    // while it reports offline would just fail the same way the reload did.
    const offline = isBrowserOffline();
    if (!offline && await probeOnce()) return result({ online: true });
    // A throwing callback must not end the wait: the wait is what prevents the
    // error page, the callback only reports on it.
    if (typeof onAttemptFailed === 'function') {
      try { onAttemptFailed({ attempts, waitedMs: Date.now() - started, offline }); } catch (_) { }
    }
    await pause(delay);
    delay = Math.min(Math.round(delay * 1.5), MAX_DELAY_MS);
  }
  return result({ online: false, timedOut: true });
}
