import { configRead } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';

// Hides the video panel under the player on the watch page (upstream 5bb41af).
//
// Kept in its own file rather than inline in adblock.js, per this fork's
// convention that a new feature gets its own module. Upstream patched the
// watch-next handler directly; here adblock.js just calls in.
//
// Both contents AND continuations are emptied. Clearing contents alone leaves
// the token behind, and the rail refills itself from it as soon as the panel
// is scrolled — the shelf comes back looking like the setting did nothing.
export function hideRelatedVideos(sectionListRenderer) {
  if (!sectionListRenderer || !configRead('hideRelatedVideosPlayer')) return;
  sectionListRenderer.contents = [];
  sectionListRenderer.continuations = [];
}

// An emptied list still leaves the panel itself on screen: on the 5.5 TV,
// moving down from the player showed an empty frame of blank tiles that could
// not be entered. So once the list is empty, the whole panel goes.
//
// Called after the queued-videos shelf has been added: if the user has a
// queue, the panel stays and shows only that shelf.
export function dropEmptyRelatedPanel(watchNextResults) {
  if (!watchNextResults?.pivot || !configRead('hideRelatedVideosPlayer')) return;
  const contents = watchNextResults.pivot.sectionListRenderer?.contents;
  if (contents && contents.length) return;
  delete watchNextResults.pivot;
  appendFileOnlyLog('watchNext.pivotRemoved', {});
}
