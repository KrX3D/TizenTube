import { detectCurrentPage } from '../pageDetection.js';

export function shouldHideWatchedForPage(configPages, page) {
  if (!Array.isArray(configPages) || configPages.length === 0) return true;
  if (configPages.includes(page)) return true;

  if (configPages.includes('library') && (page === 'playlist' || page === 'watch')) {
    return true;
  }

  return false;
}

export function hideWatchedVideos(items, pages, watchedThreshold) {
  return items.filter((item) => {
    if (!item.tileRenderer) return true;

    const progressBar = item.tileRenderer.header?.tileHeaderRenderer?.thumbnailOverlays
      ?.find((overlay) => overlay.thumbnailOverlayResumePlaybackRenderer)
      ?.thumbnailOverlayResumePlaybackRenderer;

    if (!progressBar) return true;

    const pageName = detectCurrentPage();
    if (!shouldHideWatchedForPage(pages, pageName)) return true;

    const percentWatched = progressBar.percentDurationWatched || 0;
    return percentWatched <= watchedThreshold;
  });
}