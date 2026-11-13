import { appendFileOnlyLog, detectCurrentPage } from './hideWatched.js';

/**
 * missedFirstResponse.js — refresh a page whose first response got past the
 * filters.
 *
 * Reported on the 6.5 TV: woken up on the library page, the resume path
 * reloaded the app, and the library came back with every tab and shelf the
 * mod normally hides. Leaving the page and coming back fixed it.
 *
 * The capture showed why. The library's own response, the one carrying the
 * tab row and the shelves, never went through the JSON.parse hook: its
 * per-session one-off lines (the round "Mehr" tile rejected, its unknown
 * style) were missing, and so was its slowParse line, all of which the
 * visit a few seconds later produced. Only the tab contents that arrived
 * afterwards (playlists, history) were filtered. On that reload the injection
 * took three seconds to finish, and the app fetched and parsed its page in
 * that gap.
 *
 * A normal launch has the same gap and never shows it, because "Reload Home
 * on Startup" refetches the page once the mod is in place. A wake reload
 * skips that refetch on purpose (reloadCoordinator.js: one reload, not
 * three), and that is what left the unfiltered page on screen.
 *
 * So the refetch comes back, but only when it is needed: the parse hook
 * notes which pages its responses named, and if the page on screen is not
 * among them a moment after startup, it is refreshed in place.
 *
 * Only for pages a response can name (detectPageFromResponse). Home's
 * response does not say it is home, so it cannot be checked, and a refresh
 * on every wake to Home is exactly the extra reload the coordinator removed.
 */

const CHECKABLE_PAGES = new Set(['subscriptions', 'channel', 'history', 'library', 'playlists', 'playlist']);
// Long enough for a response still in flight when startup runs to land.
const SETTLE_MS = 3000;

const _seenPages = new Set();

/** Called from the parse hook with the page the response itself names. */
export function noteResponsePage(page) {
  if (page) _seenPages.add(page);
}

/**
 * After SETTLE_MS, run `refresh` if the page on screen never had its own
 * response through the parse hook.
 *
 * @param {() => void} refresh
 */
export function refreshIfFirstResponseMissed(refresh) {
  const page = detectCurrentPage();
  if (!CHECKABLE_PAGES.has(page)) return;
  const hash = String(location.hash || '');
  setTimeout(() => {
    try {
      // The user moved on; the page they went to came through the hook.
      if (String(location.hash || '') !== hash) return;
      const seen = [..._seenPages];
      if (_seenPages.has(page)) {
        appendFileOnlyLog('reload.firstResponseSeen', { page });
        return;
      }
      appendFileOnlyLog('reload.firstResponseMissed', { page, seen });
      refresh();
    } catch (err) {
      appendFileOnlyLog('reload.firstResponseCheckFailed', { msg: String(err?.message || err) });
    }
  }, SETTLE_MS);
}
