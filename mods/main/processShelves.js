import { deArrowify } from './features/deArrowify.js';
import { hqify } from './features/hqify.js';
import { addLongPress } from './features/longPress.js';
import { addPreviews } from './features/previews.js';
import { hideWatchedVideos } from './features/hideWatchedVideos.js';
import { hideShorts, removeShortsShelvesByTitle } from './features/hideShorts.js';

function getVideoId(item) {
  return item?.tileRenderer?.contentId ||
    item?.videoRenderer?.videoId ||
    item?.playlistVideoRenderer?.videoId ||
    item?.gridVideoRenderer?.videoId ||
    item?.compactVideoRenderer?.videoId ||
    item?.richItemRenderer?.content?.videoRenderer?.videoId ||
    null;
}

function getVideoTitle(item) {
  return (
    item?.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText ||
    item?.videoRenderer?.title?.runs?.[0]?.text ||
    item?.playlistVideoRenderer?.title?.runs?.[0]?.text ||
    item?.gridVideoRenderer?.title?.runs?.[0]?.text ||
    item?.compactVideoRenderer?.title?.simpleText ||
    item?.richItemRenderer?.content?.videoRenderer?.title?.runs?.[0]?.text ||
    ''
  );
}

function collectVideoIdsFromShelf(shelf) {
  const ids = [];
  const seen = new Set();
  const pushFrom = (arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((item) => {
      const id = getVideoId(item);
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    });
  };

  pushFrom(shelf?.shelfRenderer?.content?.horizontalListRenderer?.items);
  pushFrom(shelf?.shelfRenderer?.content?.gridRenderer?.items);
  pushFrom(shelf?.shelfRenderer?.content?.verticalListRenderer?.items);
  pushFrom(shelf?.richShelfRenderer?.content?.richGridRenderer?.contents);
  pushFrom(shelf?.richSectionRenderer?.content?.richShelfRenderer?.content?.richGridRenderer?.contents);
  pushFrom(shelf?.gridRenderer?.items);

  return ids;
}

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
    debugEnabled = false,
    logShorts = false
  } = options;

  removeShortsShelvesByTitle(shelves, {
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
