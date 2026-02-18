import { configRead } from '../../config.js';
import { detectCurrentPage } from '../pageDetection.js';
import { hideWatchedVideos } from './hideWatchedVideos.js';
import { filterShortItems, removeShortsShelvesByTitle, getVideoTitle, collectVideoIdsFromShelf } from './shortsCore.js';

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
  return arr.some((item) => item?.shelfRenderer || item?.richShelfRenderer || item?.gridRenderer);
}

export function findProgressBar(item) {
  if (!item) return null;
  const renderer = item.tileRenderer || item.playlistVideoRenderer || item.compactVideoRenderer || item.gridVideoRenderer || item.videoRenderer;
  const overlays = renderer?.header?.tileHeaderRenderer?.thumbnailOverlays || renderer?.thumbnailOverlays || [];
  if (!Array.isArray(overlays)) return null;
  return overlays.find((o) => o?.thumbnailOverlayResumePlaybackRenderer)?.thumbnailOverlayResumePlaybackRenderer || null;
}

export function getCurrentPage() {
  return detectCurrentPage();
}

export function directFilterArray(arr, page = detectCurrentPage()) {
  if (!Array.isArray(arr) || arr.length === 0) return arr;

  let out = arr;

  if (!configRead('enableShorts')) {
    out = filterShortItems(out, { page }).items;
  }

  if (configRead('enableHideWatchedVideos')) {
    out = hideWatchedVideos(
      out,
      configRead('hideWatchedVideosPages') || [],
      configRead('hideWatchedVideosThreshold')
    );
  }

  return out;
}

export function hideVideo(items) {
  return directFilterArray(items, detectCurrentPage());
}

export function scanAndFilterAllArrays(obj, page = detectCurrentPage(), path = 'root') {
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

export function startPlaylistAutoLoad() {
  const page = detectCurrentPage();
  if (page !== 'playlist') return;

  let stableCount = 0;
  let lastVideoCount = 0;
  const interval = setInterval(() => {
    const cards = document.querySelectorAll('ytlr-grid-video-renderer, ytlr-rich-item-renderer');
    const currentCount = cards.length;

    try {
      window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
    } catch (_) {}

    if (currentCount === lastVideoCount) {
      stableCount += 1;
      if (stableCount >= 8) {
        clearInterval(interval);
      }
    } else {
      stableCount = 0;
      lastVideoCount = currentCount;
    }
  }, 500);
}
