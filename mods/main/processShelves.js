import { deArrowify } from './deArrowify.js';
import { hqify } from './hqify.js';
import { addLongPress } from './longPress.js';
import { addPreviews } from './previews.js';
import { hideWatchedVideos } from './hideWatchedVideos.js';
import { hideShorts } from './hideShorts.js';

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
    shortsEnabled
  } = options;

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

  hideShorts(shelves, shortsEnabled);
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
