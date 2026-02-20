import { configRead } from '../../config.js';
import { hideWatchedVideos, findProgressBar, shouldHideWatchedForPage } from './hideWatchedVideos.js';
import { isInCollectionMode, getFilteredVideoIds, trackRemovedPlaylistHelpers, trackRemovedPlaylistHelperKeys, isLikelyPlaylistHelperItem, getVideoKey } from './playlistHelpers.js';
import { getGlobalDebugEnabled, getGlobalLogShorts } from './visualConsole.js';

let DEBUG_ENABLED = getGlobalDebugEnabled(configRead);
let LOG_SHORTS = getGlobalLogShorts(configRead);
let filterCallCounter = 0;

if (typeof window !== 'undefined') {
  setTimeout(() => {
    if (!window.configChangeEmitter) return;
    window.configChangeEmitter.addEventListener('configChange', (event) => {
      if (event.detail?.key === 'enableDebugConsole') {
        DEBUG_ENABLED = getGlobalDebugEnabled(configRead);
        LOG_SHORTS = getGlobalLogShorts(configRead);
      }
    });
  }, 100);
}



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
    item?.reelItemRenderer?.headline?.simpleText ||
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
  if (t === 'shorts' || t === '#shorts' || t === 'short') return true;
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


function getRendererDurationSeconds(renderer) {
  if (!renderer || typeof renderer !== 'object') return null;

  const overlayText = Array.isArray(renderer.thumbnailOverlays)
    ? renderer.thumbnailOverlays.find((o) => o?.thumbnailOverlayTimeStatusRenderer)?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText
    : null;

  const directLength = renderer.lengthText?.simpleText
    || (Array.isArray(renderer.lengthText?.runs) ? renderer.lengthText.runs.map((run) => run.text).join('') : null)
    || renderer.thumbnailOverlayTimeStatusRenderer?.text?.simpleText
    || overlayText
    || null;

  const match = String(directLength || '').trim().match(/^(\d+):(\d{2})$/);
  if (!match) return null;

  const minutes = parseInt(match[1], 10);
  const seconds = parseInt(match[2], 10);
  return minutes * 60 + seconds;
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

  let durationSeconds = getRendererDurationSeconds(item.videoRenderer)
    ?? getRendererDurationSeconds(item.gridVideoRenderer)
    ?? getRendererDurationSeconds(item.compactVideoRenderer);

  if (durationSeconds == null && item.tileRenderer) {
    const tileOverlayText = item.tileRenderer.header?.tileHeaderRenderer?.thumbnailOverlays?.find((o) => o?.thumbnailOverlayTimeStatusRenderer)
      ?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText;

    const tileLineText = item.tileRenderer.metadata?.tileMetadataRenderer?.lines?.[0]?.lineRenderer?.items?.find(
      (i) => i?.lineItemRenderer?.text?.simpleText
    )?.lineItemRenderer?.text?.simpleText;

    const durationMatch = String(tileOverlayText || tileLineText || '').trim().match(/^(\d+):(\d{2})$/);
    if (durationMatch) {
      durationSeconds = parseInt(durationMatch[1], 10) * 60 + parseInt(durationMatch[2], 10);
    }
  }

  if (durationSeconds != null && durationSeconds <= 180) {
    if (debugEnabled && logShorts) {
      console.log('[SHORTS] Detected by duration (≤ 180s):', videoId, '| Duration:', durationSeconds + 's');
    }
    return true;
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
      item?.gridVideoRenderer ||
      item?.compactVideoRenderer ||
      item?.richItemRenderer?.content?.videoRenderer
    );
}

function hasShelvesArray(arr) {
  return arr.some((item) =>
    item?.shelfRenderer ||
    item?.richShelfRenderer ||
    item?.gridRenderer
  );
}

export function directFilterArray(arr, page = 'other') {
  if (!Array.isArray(arr) || arr.length === 0) return arr;

  // ⭐ Check if this is a playlist page
  let isPlaylistPage;

  // ⭐ Check if this is a playlist page
  isPlaylistPage = (page === 'playlist' || page === 'playlists');

  // ⭐ FILTER MODE: Only show videos from our collected list
  const filterIds = getFilteredVideoIds();
  const hideWatchedEnabled = configRead('enableHideWatchedVideos');
  const hideWatchedPages = configRead('hideWatchedVideosPages') || [];
  const watchedThreshold = Number(configRead('hideWatchedVideosThreshold') || 0);
  
  // Check if we should filter watched videos on this page (EXACT match)
  const shouldHideWatched = hideWatchedEnabled && shouldHideWatchedForPage(hideWatchedPages, page);
  // Shorts filtering is INDEPENDENT - always check if shorts are disabled
  const shouldApplyShortsFilter = shouldFilterShorts(getShortsEnabled(configRead), page);

  // ⭐ Initialize scroll helpers tracker

  window._playlistScrollHelpers = window._playlistScrollHelpers || new Set();
  window._lastHelperVideos = window._lastHelperVideos || [];
  window._playlistRemovedHelpers = window._playlistRemovedHelpers || new Set();
  window._playlistRemovedHelperKeys = window._playlistRemovedHelperKeys || new Set();

  
  // ⭐ DIAGNOSTIC: Log what we're checking
  if (isPlaylistPage && DEBUG_ENABLED) {
    console.log('>>>>>> PRE-CLEANUP CHECK <<<<<<');
    console.log('>>>>>> Has helpers:', window._lastHelperVideos?.length || 0);
    console.log('>>>>>> Array length:', arr.length);
    console.log('>>>>>> Last batch flag:', window._isLastPlaylistBatch);
    console.log('>>>>>> Collection mode:', isInCollectionMode());
  }

  // ⭐ NEW: Check if this is the LAST batch (using flag from response level)
  let isLastBatch = false;
  if (isPlaylistPage && window._isLastPlaylistBatch === true) {
    if (DEBUG_ENABLED) {
      console.log('--------------------------------->> Using last batch flag from response');
      console.log('--------------------------------->> This IS the last batch!');
    }
    isLastBatch = true;
    // Clear the flag
    window._isLastPlaylistBatch = false;
  }

  // ⭐ FIXED: Trigger cleanup when we have stored helpers AND this is a new batch with content
  if (isPlaylistPage && window._lastHelperVideos.length > 0 && arr.length > 0) {
    if (DEBUG_ENABLED) {
      console.log('[CLEANUP_TRIGGER] New batch detected! Stored helpers:', window._lastHelperVideos.length, '| new videos:', arr.length);
    }
    
    // Store the helper IDs for filtering
    const helperIdsToTrack = window._lastHelperVideos.map((video) => getVideoId(video)).filter(Boolean);
    trackRemovedPlaylistHelpers(helperIdsToTrack);
    trackRemovedPlaylistHelperKeys(window._lastHelperVideos, getVideoId);
    if (!isLastBatch) {
      window._lastHelperVideos = [];
      window._playlistScrollHelpers.clear();
      if (DEBUG_ENABLED) console.log('[CLEANUP] Helpers cleared');
    }
  }

  // ⭐ DEBUG: Log configuration
  if (DEBUG_ENABLED && (shouldApplyShortsFilter || shouldHideWatched)) {
    console.log('[FILTER_START #' + callId + '] ========================================');
    console.log('[FILTER_START #' + callId + '] Page:', page);
    console.log('[FILTER_START #' + callId + '] Is Playlist:', isPlaylistPage);
    console.log('[FILTER_START #' + callId + '] Total items:', arr.length);
    console.log('[FILTER_CONFIG #' + callId + '] Threshold:', watchedThreshold + '%');
    console.log('[FILTER_CONFIG #' + callId + '] Hide watched:', shouldHideWatched);
    console.log('[FILTER_CONFIG #' + callId + '] Filter shorts:', shouldApplyShortsFilter);
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
      if (LOG_SHORTS && DEBUG_ENABLED) {
        console.log('[SHORTS_SHELF] Removing item by previously removed shorts shelf memory:', videoId);
      }
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

  // If this is an array with video items, filter it
  if (Array.isArray(obj)) {
    if (obj.length === 0) return obj;

    if (hasVideoItemsArray(obj)) {
      if (DEBUG_ENABLED) {
        console.log('[SCAN] Found video array at:', path, '| Length:', obj.length);
      }
      return directFilterArray(obj, page);
    }

    if (hasShelvesArray(obj)) {
      removeShortsShelvesByTitle(obj, {
        page,
        shortsEnabled: getShortsEnabled(configRead),
        collectVideoIdsFromShelf,
        getVideoTitle,
        debugEnabled: DEBUG_ENABLED,
        logShorts: LOG_SHORTS,
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
