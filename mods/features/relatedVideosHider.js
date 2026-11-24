import { configRead, configChangeEmitter } from '../config.js';

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

// An empty list still shows a row of blank tiles under the player. That row is
// YouTube's own loading placeholder: ytlr-pivot always renders, and draws a
// ytlr-ghost-surface whenever its list has no contents. Deleting `pivot` from
// the response does not help — the watch page then passes `{}` and the
// placeholder stays (tried in 1.31.800). So the placeholder is hidden by CSS
// while the setting is on. The app already refuses focus to an empty pivot,
// so there is nothing left to move down to. With a queue the list is not
// empty, no placeholder is drawn and the queue shelf shows as before.
const STYLE_ID = 'tt-hide-pivot-ghost';

function applyGhostStyle() {
  if (typeof document === 'undefined') return;
  let style = document.getElementById(STYLE_ID);
  if (!configRead('hideRelatedVideosPlayer')) {
    if (style) style.textContent = '';
    return;
  }
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    (document.head || document.documentElement).appendChild(style);
  }
  style.textContent = 'ytlr-pivot ytlr-ghost-surface { display: none !important; }';
}

applyGhostStyle();

try {
  configChangeEmitter.addEventListener('configChange', (ev) => {
    if (ev?.detail?.key === 'hideRelatedVideosPlayer') applyGhostStyle();
  });
} catch (_) { }
