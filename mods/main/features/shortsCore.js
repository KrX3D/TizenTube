import { configRead } from '../../config.js';
import { hideWatchedVideos, findProgressBar, shouldHideWatchedForPage } from './hideWatchedVideos.js';
import { isInCollectionMode, getFilteredVideoIds, trackRemovedPlaylistHelpers, trackRemovedPlaylistHelperKeys, isLikelyPlaylistHelperItem, getVideoKey } from './playlistHelpers.js';



export function getVideoId(item) {
  return item?.tileRenderer?.contentId ||
    item?.videoRenderer?.videoId ||
    item?.playlistVideoRenderer?.videoId ||
    item?.gridVideoRenderer?.videoId ||
    item?.compactVideoRenderer?.videoId ||
    item?.richItemRenderer?.content?.videoRenderer?.videoId ||
    null;
}

export function getVideoTitle(item) {
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

export function collectVideoIdsFromShelf(shelf) {
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

export function initShortsTrackingState() {
  window._shortsVideoIdsFromShelves = window._shortsVideoIdsFromShelves || new Set();
  window._shortsTitlesFromShelves = window._shortsTitlesFromShelves || new Set();
}

export function shouldFilterShorts(shortsEnabled, page) {
  return !shortsEnabled && page !== 'playlist' && page !== 'playlists';
}

export function isShortsShelfTitle(title = '') {
  const t = String(title).trim().toLowerCase();
  // Keep this strict to avoid false positives such as
  // "short film", "short tutorial", etc.
  if (!t) return false;
  if (t === 'shorts' || t === '#shorts') return true;
  return /^shorts\b/.test(t) || /\bshorts$/.test(t);
}

export function rememberShortsFromShelf(shelf, collectVideoIdsFromShelf, getVideoTitle) {
  initShortsTrackingState();
  const ids = collectVideoIdsFromShelf(shelf);
  ids.forEach((id) => window._shortsVideoIdsFromShelves.add(id));

  const stack = [shelf];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      node.forEach((entry) => stack.push(entry));
      continue;
    }
    const title = getVideoTitle(node).trim().toLowerCase();
    if (title) window._shortsTitlesFromShelves.add(title);
    for (const key in node) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        stack.push(node[key]);
      }
    }
  }

  return ids;
}

export function isKnownShortFromShelfMemory(item, getVideoId, getVideoTitle) {
  const id = getVideoId(item);
  if (id !== 'unknown' && window._shortsVideoIdsFromShelves?.has(id)) return true;

  const title = getVideoTitle(item).trim().toLowerCase();
  return !!title && !!window._shortsTitlesFromShelves?.has(title);
}

export function removeShortsShelvesByTitle(shelves, { page, shortsEnabled, collectVideoIdsFromShelf, getVideoTitle, debugEnabled = false, logShorts = false, path = '' } = {}) {
  if (!Array.isArray(shelves) || shortsEnabled) return 0;
  initShortsTrackingState();

  let removed = 0;
  for (let i = shelves.length - 1; i >= 0; i--) {
    const shelf = shelves[i];
    const title = getShelfTitle(shelf);
    if (!isShortsShelfTitle(title)) continue;

    const ids = rememberShortsFromShelf(shelf, collectVideoIdsFromShelf, getVideoTitle);
    if (debugEnabled || logShorts) {
      console.log('[SHORTS_SHELF] removed title=', title, '| ids=', ids.length, '| page=', page, '| path=', path || i);
    }
    shelves.splice(i, 1);
    removed++;
  }

  return removed;
}

export function filterShortItems(items, { page, debugEnabled = false, logShorts = false } = {}) {
  if (!Array.isArray(items)) return { items: [], removed: 0 };
  const filtered = items.filter((item) => !isShortItem(item, { debugEnabled, logShorts, currentPage: page || 'other' }));
  return { items: filtered, removed: items.length - filtered.length };
}

export function isShortItem(item, { debugEnabled = false, logShorts = false, currentPage = '' } = {}) {
  if (!item) return false;

  const videoId = item.tileRenderer?.contentId ||
    item.videoRenderer?.videoId ||
    item.gridVideoRenderer?.videoId ||
    item.compactVideoRenderer?.videoId ||
    'unknown';

  const page = currentPage || 'other';

  if ((page === 'subscriptions' || String(page).includes('channel')) && debugEnabled && logShorts) {
    console.log('[SHORTS_DIAGNOSTIC] checking', videoId);
  }

  if (item.tileRenderer?.contentType === 'TILE_CONTENT_TYPE_SHORT') return true;

  if (item.videoRenderer) {
    const overlays = item.videoRenderer.thumbnailOverlays || [];
    if (overlays.some((overlay) =>
      overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText === 'SHORTS')) return true;

    const navEndpoint = item.videoRenderer.navigationEndpoint;
    if (navEndpoint?.reelWatchEndpoint) return true;
    const url = navEndpoint?.commandMetadata?.webCommandMetadata?.url || '';
    if (url.includes('/shorts/')) return true;
  }

  if (item.gridVideoRenderer) {
    const overlays = item.gridVideoRenderer.thumbnailOverlays || [];
    if (overlays.some((overlay) =>
      overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText === 'SHORTS')) return true;

    const url = item.gridVideoRenderer.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || '';
    if (url.includes('/shorts/')) return true;
  }

  if (item.compactVideoRenderer) {
    const overlays = item.compactVideoRenderer.thumbnailOverlays || [];
    if (overlays.some((overlay) =>
      overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText === 'SHORTS')) return true;

    const url = item.compactVideoRenderer.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || '';
    if (url.includes('/shorts/')) return true;
  }

  if (item.tileRenderer?.onSelectCommand?.reelWatchEndpoint) return true;

  if (item.tileRenderer?.onSelectCommand) {
    const cmdStr = JSON.stringify(item.tileRenderer.onSelectCommand);
    if (cmdStr.includes('reelWatch') || cmdStr.includes('/shorts/')) return true;
  }

  if (item.tileRenderer?.header?.tileHeaderRenderer?.thumbnailOverlays) {
    const hasShortsBadge = item.tileRenderer.header.tileHeaderRenderer.thumbnailOverlays.some((overlay) =>
      overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.runs?.some((run) => run.text === 'SHORTS')
    );
    if (hasShortsBadge) return true;
  }

  const videoTitle = item.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText || '';
  if (videoTitle.toLowerCase().includes('#shorts') || videoTitle.toLowerCase().includes('#short')) return true;

  if (item.tileRenderer) {
    let lengthText = null;
    const thumbnailOverlays = item.tileRenderer.header?.tileHeaderRenderer?.thumbnailOverlays;
    if (thumbnailOverlays && Array.isArray(thumbnailOverlays)) {
      const timeOverlay = thumbnailOverlays.find((o) => o.thumbnailOverlayTimeStatusRenderer);
      if (timeOverlay) {
        lengthText = timeOverlay.thumbnailOverlayTimeStatusRenderer.text?.simpleText;
      }
    }

    if (!lengthText) {
      lengthText = item.tileRenderer.metadata?.tileMetadataRenderer?.lines?.[0]?.lineRenderer?.items?.find(
        (i) => i.lineItemRenderer?.badge || i.lineItemRenderer?.text?.simpleText
      )?.lineItemRenderer?.text?.simpleText;
    }

    if (lengthText) {
      const durationMatch = lengthText.match(/^(\d+):(\d+)$/);
      if (durationMatch) {
        const minutes = parseInt(durationMatch[1], 10);
        const seconds = parseInt(durationMatch[2], 10);
        const totalSeconds = minutes * 60 + seconds;
        if (totalSeconds <= 180) return true;
      }
    }
  }

  if (item.richItemRenderer?.content?.reelItemRenderer) return true;

  if (item.tileRenderer?.header?.tileHeaderRenderer?.thumbnail?.thumbnails) {
    const thumb = item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails[0];
    if (thumb && thumb.height > thumb.width) return true;
  }

  if (debugEnabled && logShorts) {
    console.log('[SHORTS_DIAGNOSTIC] not short', videoId);
  }
  return false;
}



export function filterShelvesShorts(shelves, { page = 'other', shortsEnabled, onRemoveShelf } = {}) {
  if (!Array.isArray(shelves)) return;
  if (!shouldFilterShorts(shortsEnabled, page)) return;

  for (let i = shelves.length - 1; i >= 0; i--) {
    const shelf = shelves[i];
    if (!shelf) {
      shelves.splice(i, 1);
      continue;
    }

    if (!shelf.shelfRenderer?.content?.horizontalListRenderer?.items) continue;

    if (shelf.shelfRenderer.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS') {
      onRemoveShelf?.(shelf);
      shelves.splice(i, 1);
      continue;
    }

    const items = shelf.shelfRenderer.content.horizontalListRenderer.items || [];
    shelf.shelfRenderer.content.horizontalListRenderer.items = items.filter(
      (item) => !isShortItem(item, { currentPage: page })
    );

    if (shelf.shelfRenderer.content.horizontalListRenderer.items.length === 0) {
      onRemoveShelf?.(shelf);
      shelves.splice(i, 1);
    }
  }
}
export function getShelfTitle(shelf) {
  const titleText = (title) => {
    if (!title) return '';
    if (title.simpleText) return title.simpleText;
    if (Array.isArray(title.runs)) return title.runs.map((run) => run.text).join('');
    return '';
  };

  const titlePaths = [
    shelf?.shelfRenderer?.shelfHeaderRenderer?.title,
    shelf?.shelfRenderer?.headerRenderer?.shelfHeaderRenderer?.title,
    shelf?.headerRenderer?.shelfHeaderRenderer?.title,
    shelf?.richShelfRenderer?.title,
    shelf?.richSectionRenderer?.content?.richShelfRenderer?.title,
    shelf?.gridRenderer?.header?.gridHeaderRenderer?.title,
    shelf?.shelfRenderer?.headerRenderer?.shelfHeaderRenderer?.avatarLockup?.avatarLockupRenderer?.title,
    shelf?.headerRenderer?.shelfHeaderRenderer?.avatarLockup?.avatarLockupRenderer?.title,
  ];

  for (const rawTitle of titlePaths) {
    const text = titleText(rawTitle);
    if (text) return text;
  }

  return '';
}


function hasVideoItemsArray(arr) {
  return arr.some((item) =>
    item?.tileRenderer ||
    item?.videoRenderer ||
    item?.playlistVideoRenderer ||
    item?.gridVideoRenderer ||
    item?.compactVideoRenderer ||
    item?.richItemRenderer?.content?.videoRenderer ||
    item?.richItemRenderer?.content?.reelItemRenderer
  );
}

function hasShelvesArray(arr) {
  return arr.some((item) => item?.shelfRenderer || item?.richShelfRenderer || item?.gridRenderer);
}

export function directFilterArray(arr, page = 'other') {
  if (!Array.isArray(arr) || arr.length === 0) return arr;

  const isPlaylistPage = page === 'playlist' || page === 'playlists';
  const filterIds = getFilteredVideoIds();
  const hideWatchedEnabled = configRead('enableHideWatchedVideos');
  const hideWatchedPages = configRead('hideWatchedVideosPages') || [];
  const watchedThreshold = Number(configRead('hideWatchedVideosThreshold') || 0);
  const shouldHideWatched = hideWatchedEnabled && shouldHideWatchedForPage(hideWatchedPages, page);
  const shouldApplyShortsFilter = shouldFilterShorts(configRead('enableShorts'), page);

  window._playlistScrollHelpers = window._playlistScrollHelpers || new Set();
  window._lastHelperVideos = window._lastHelperVideos || [];
  window._playlistRemovedHelpers = window._playlistRemovedHelpers || new Set();
  window._playlistRemovedHelperKeys = window._playlistRemovedHelperKeys || new Set();

  let isLastBatch = false;
  if (isPlaylistPage && window._isLastPlaylistBatch === true) {
    isLastBatch = true;
    window._isLastPlaylistBatch = false;
  }

  // New batch arrived after we inserted helper fallback in previous call.
  if (isPlaylistPage && window._lastHelperVideos.length > 0 && arr.length > 0) {
    const helperIdsToTrack = window._lastHelperVideos.map((video) => getVideoId(video)).filter(Boolean);
    trackRemovedPlaylistHelpers(helperIdsToTrack);
    trackRemovedPlaylistHelperKeys(window._lastHelperVideos, getVideoId);
    if (!isLastBatch) {
      window._lastHelperVideos = [];
      window._playlistScrollHelpers.clear();
    }
  }

  const out = [];
  const helperVideos = [];
  let playlistUnwatchedCount = 0;

  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;

    const videoId = getVideoId(item);
    const videoKey = getVideoKey(item, getVideoId);

    if (isPlaylistPage && (window._playlistRemovedHelpers.has(videoId) || window._playlistRemovedHelperKeys.has(videoKey))) {
      continue;
    }

    if (isPlaylistPage && isLikelyPlaylistHelperItem(item, getVideoId, getVideoTitle)) {
      helperVideos.push(item);
      continue;
    }

    if (isKnownShortFromShelfMemory(item, getVideoId, getVideoTitle)) {
      continue;
    }

    if (shouldApplyShortsFilter && isShortItem(item, { currentPage: page })) {
      continue;
    }

    if (isPlaylistPage && filterIds) {
      if (!videoId || !filterIds.has(videoId)) continue;
    }

    if (shouldHideWatched) {
      const progressBar = findProgressBar(item);
      if (progressBar) {
        const percentWatched = Number(progressBar.percentDurationWatched || 0);
        if (percentWatched >= watchedThreshold) {
          continue;
        }
      } else if (isPlaylistPage && !filterIds) {
        playlistUnwatchedCount += 1;
      }
    }

    out.push(item);
  }

  if (isPlaylistPage) {
    if (helperVideos.length) {
      window._lastHelperVideos = helperVideos;
      const helperIdsToTrack = helperVideos.map((video) => getVideoId(video)).filter(Boolean);
      trackRemovedPlaylistHelpers(helperIdsToTrack);
      trackRemovedPlaylistHelperKeys(helperVideos, getVideoId);
    }

    // Keep one card so TV keeps requesting continuation even when this batch filtered to zero.
    if (out.length === 0 && arr.length > 0 && !isLastBatch && !filterIds && !isInCollectionMode()) {
      const fallbackHelper = helperVideos.find((video) => getVideoId(video))
        || [...arr].reverse().find((item) => !!getVideoId(item))
        || helperVideos[0]
        || arr[arr.length - 1];
      if (fallbackHelper) {
        const fallbackId = getVideoId(fallbackHelper) || 'unknown';
        window._lastHelperVideos = [fallbackHelper];
        window._playlistScrollHelpers.clear();
        window._playlistScrollHelpers.add(fallbackId);
        return [fallbackHelper];
      }
    }

    if (isInCollectionMode()) {
      const noProgress = arr
        .filter((item) => !isLikelyPlaylistHelperItem(item, getVideoId, getVideoTitle))
        .filter((item) => !findProgressBar(item))
        .map((item) => getVideoId(item))
        .filter(Boolean);

      if (noProgress.length > 0) {
        window._collectedUnwatched = window._collectedUnwatched || [];
        const merged = new Set([...(window._collectedUnwatched || []), ...noProgress]);
        window._collectedUnwatched = Array.from(merged);
      }
    }

    if (playlistUnwatchedCount > 0 && window._lastHelperVideos.length > 0) {
      const helperIdsToTrack = window._lastHelperVideos.map((video) => getVideoId(video)).filter(Boolean);
      trackRemovedPlaylistHelpers(helperIdsToTrack);
      trackRemovedPlaylistHelperKeys(window._lastHelperVideos, getVideoId);
      window._lastHelperVideos = [];
      window._playlistScrollHelpers.clear();
    }

    if (isLastBatch) {
      window._lastHelperVideos = [];
      window._playlistScrollHelpers.clear();
    }
  }

  return shouldHideWatched && !isPlaylistPage
    ? hideWatchedVideos(out, hideWatchedPages, watchedThreshold, page)
    : out;
}

export function scanAndFilterAllArrays(obj, page = 'other', path = 'root') {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    if (obj.length === 0) return obj;

    if (hasVideoItemsArray(obj)) {
      return directFilterArray(obj, page);
    }

    if (hasShelvesArray(obj)) {
      removeShortsShelvesByTitle(obj, {
        page,
        shortsEnabled: configRead('enableShorts'),
        collectVideoIdsFromShelf,
        getVideoTitle,
        debugEnabled: configRead('enableDebugConsole'),
        logShorts: configRead('enableDebugConsole'),
        path
      });
    }

    for (let i = 0; i < obj.length; i++) {
      const entry = obj[i];
      if (entry && typeof entry === 'object') {
        const filtered = scanAndFilterAllArrays(entry, page, `${path}[${i}]`);
        if (Array.isArray(filtered)) obj[i] = filtered;
      }
    }

    return obj;
  }

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value && typeof value === 'object') {
      const filtered = scanAndFilterAllArrays(value, page, `${path}.${key}`);
      if (Array.isArray(filtered)) obj[key] = filtered;
    }
  }

  return obj;
}
