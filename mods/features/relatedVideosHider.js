import { configRead } from '../config.js';

// Hides the related-videos rail on the watch page (upstream 5bb41af).
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
