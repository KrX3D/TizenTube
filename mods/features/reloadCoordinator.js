import { appendFileOnlyLog } from './hideWatched.js';

/**
 * reloadCoordinator.js — one reload, not three.
 *
 * Reported: power the TV off on the Home page, power it on, and the app reloads
 * three times. Each reload is a different feature doing its own reasonable
 * thing, none of them aware of the others:
 *
 *   1. the wake handler reloads, because the page has been asleep
 *   2. "Reload Home on Startup" reloads, because the mod has just started
 *   3. the user-agent spoofing reloads, because it has just applied one
 *
 * Nothing here decides who is right. It only lets a reload leave a note that
 * one just happened, so the next feature in line can see there is nothing left
 * to refresh.
 *
 * The note lives in sessionStorage because it has to survive the reload itself
 * and must NOT survive the app being closed and opened again, which is exactly
 * what a session is. It carries a timestamp as well, so a session that somehow
 * outlives the app cannot suppress a reload minutes later.
 */

const KEY = 'ytaf-last-reload';

/** Record that a reload is about to happen, and why. */
export function noteReload(reason) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ reason, at: Date.now() }));
  } catch (_) {
    // Private mode, quota, storage disabled. Without the note every feature
    // behaves exactly as it did before, which is the old behaviour rather than
    // a broken one.
  }
  appendFileOnlyLog('reload.trigger', { reason });
}

/**
 * Whether a reload happened in the last `withinMs`.
 *
 * @param {number} withinMs
 * @returns {null|{reason: string, agoMs: number}}
 */
export function recentReload(withinMs = 60000) {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const note = JSON.parse(raw);
    const agoMs = Date.now() - Number(note?.at || 0);
    if (!isFinite(agoMs) || agoMs < 0 || agoMs > withinMs) return null;
    return { reason: String(note.reason || 'unknown'), agoMs };
  } catch (_) {
    return null;
  }
}

/** Forget the note, so a later reload in the same session is not suppressed. */
export function clearReloadNote() {
  try { sessionStorage.removeItem(KEY); } catch (_) { }
}
