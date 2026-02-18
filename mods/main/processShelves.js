import { deArrowify } from './features/deArrowify.js';
import { hqify } from './features/hqify.js';
import { addLongPress } from './features/longPress.js';
import { addPreviews } from './features/previews.js';
import { hideWatchedVideos } from './features/hideWatchedVideos.js';
import { hideShorts } from './features/hideShorts.js';
import { removeShortsShelvesByTitle, collectVideoIdsFromShelf, getVideoTitle } from './features/shortsCore.js';
import { detectCurrentPage } from './pageDetection.js';

export function processShelves(shelves, options) {
  const {
    shouldAddPreviews = true,
    deArrowEnabled,
    deArrowThumbnailsEnabled,
    hqThumbnailsEnabled,
    longPressEnabled,
    previewsEnabled,
    hideWatchedPages,
    hideWatchedThreshold,
    shortsEnabled,
    page = detectCurrentPage(),
    debugEnabled = false,
    logShorts = false
  } = options;

  removeShortsShelvesByTitle(shelves, {
    page,
    shortsEnabled,
    collectVideoIdsFromShelf,
    getVideoTitle,
    debugEnabled,
    logShorts,
    path: 'processShelves'
  });

  for (const shelve of shelves) {
    if (!shelve.shelfRenderer) continue;

    const items = shelve.shelfRenderer.content.horizontalListRenderer.items;
    deArrowify(items, deArrowEnabled, deArrowThumbnailsEnabled);
    hqify(items, hqThumbnailsEnabled);
    addLongPress(items, longPressEnabled);

    if (shouldAddPreviews) {
      addPreviews(items, previewsEnabled);
    }

    shelve.shelfRenderer.content.horizontalListRenderer.items = hideWatchedVideos(
      shelve.shelfRenderer.content.horizontalListRenderer.items,
      hideWatchedPages,
      hideWatchedThreshold
    );
  }

  hideShorts(shelves, shortsEnabled, undefined, page);
}

export function processHorizontalItems(items, options) {
  const {
    deArrowEnabled,
    deArrowThumbnailsEnabled,
    hqThumbnailsEnabled,
    longPressEnabled,
    hideWatchedPages,
    hideWatchedThreshold
  } = options;

  deArrowify(items, deArrowEnabled, deArrowThumbnailsEnabled);
  hqify(items, hqThumbnailsEnabled);
  addLongPress(items, longPressEnabled);

  return hideWatchedVideos(items, hideWatchedPages, hideWatchedThreshold);
}
