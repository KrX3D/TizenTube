import { deArrowify } from './features/deArrowify.js';
import { hqify } from './features/hqify.js';
import { addLongPress } from './features/longPress.js';
import { addPreviews } from './features/previews.js';
import { hideWatchedVideos, shouldHideWatchedForPage } from './features/hideWatchedVideos.js';
import { removeShortsShelvesByTitle, collectVideoIdsFromShelf, getVideoTitle, filterShortItems } from './features/shortsCore.js';
import { detectCurrentPage } from './pageDetection.js';

function getShelfItemsRef(shelf) {
  if (!shelf || typeof shelf !== 'object') return null;

  const refs = [
    ['shelfRenderer', 'content', 'horizontalListRenderer', 'items'],
    ['shelfRenderer', 'content', 'gridRenderer', 'items'],
    ['shelfRenderer', 'content', 'verticalListRenderer', 'items'],
    ['richShelfRenderer', 'content', 'richGridRenderer', 'contents'],
    ['richSectionRenderer', 'content', 'richShelfRenderer', 'content', 'richGridRenderer', 'contents'],
    ['gridRenderer', 'items']
  ];

  for (const path of refs) {
    let parent = shelf;
    for (let i = 0; i < path.length - 1; i++) {
      parent = parent?.[path[i]];
      if (!parent) break;
    }
    const key = path[path.length - 1];
    if (parent && Array.isArray(parent[key])) {
      return { parent, key, items: parent[key] };
    }
  }

  return null;
}

function applyItemEnhancements(items, { deArrowEnabled, deArrowThumbnailsEnabled, hqThumbnailsEnabled, longPressEnabled, previewsEnabled, shouldAddPreviews }) {
  deArrowify(items, deArrowEnabled, deArrowThumbnailsEnabled);
  hqify(items, hqThumbnailsEnabled);
  addLongPress(items, longPressEnabled);
  if (shouldAddPreviews) {
    addPreviews(items, previewsEnabled);
  }
}

export function processShelves(shelves, options = {}) {
  if (!Array.isArray(shelves) || shelves.length === 0) return;

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

  const shouldHideWatched = shouldHideWatchedForPage(hideWatchedPages, page);

  removeShortsShelvesByTitle(shelves, {
    page,
    shortsEnabled,
    collectVideoIdsFromShelf,
    getVideoTitle,
    debugEnabled,
    logShorts,
    path: 'processShelves'
  });

  for (let i = shelves.length - 1; i >= 0; i--) {
    const shelf = shelves[i];
    const ref = getShelfItemsRef(shelf);
    if (!ref) continue;

    let items = Array.isArray(ref.items) ? ref.items : [];
    if (items.length === 0) {
      shelves.splice(i, 1);
      continue;
    }

    const originalItems = items.slice();

    applyItemEnhancements(items, {
      deArrowEnabled,
      deArrowThumbnailsEnabled,
      hqThumbnailsEnabled,
      longPressEnabled,
      previewsEnabled,
      shouldAddPreviews
    });

    if (!shortsEnabled) {
      items = filterShortItems(items, { page, debugEnabled, logShorts }).items;
    }

    if (shouldHideWatched) {
      const watchedFiltered = hideWatchedVideos(items, hideWatchedPages, hideWatchedThreshold, page);
      if (watchedFiltered.length === 0 && originalItems.length > 0) {
        // Playlist pages need at least one tile for continuation; other pages can remove empty shelves.
        const keepShelfForContinuation = page === 'playlist' || page === 'playlists';
        items = keepShelfForContinuation ? originalItems : [];
      } else {
        items = watchedFiltered;
      }
    }

    ref.parent[ref.key] = items;

    if (!Array.isArray(items) || items.length === 0) {
      shelves.splice(i, 1);
    }
  }
}

export function processHorizontalItems(items, options = {}) {
  const {
    deArrowEnabled,
    deArrowThumbnailsEnabled,
    hqThumbnailsEnabled,
    longPressEnabled,
    hideWatchedPages,
    hideWatchedThreshold,
    page = detectCurrentPage()
  } = options;

  deArrowify(items, deArrowEnabled, deArrowThumbnailsEnabled);
  hqify(items, hqThumbnailsEnabled);
  addLongPress(items, longPressEnabled);

  return hideWatchedVideos(items, hideWatchedPages, hideWatchedThreshold, page);
}
