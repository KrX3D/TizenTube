import { detectCurrentPage } from '../pageDetection.js';

export function hideWatchedVideos(items, pages, watchedThreshold) {
  return items.filter((item) => {
    if (!item.tileRenderer) return true;

    const progressBar = item.tileRenderer.header?.tileHeaderRenderer?.thumbnailOverlays
      ?.find((overlay) => overlay.thumbnailOverlayResumePlaybackRenderer)
      ?.thumbnailOverlayResumePlaybackRenderer;

    if (!progressBar) return true;

    const pageName = detectCurrentPage();
    if (!pages.includes(pageName)) return true;

    const percentWatched = progressBar.percentDurationWatched || 0;
    return percentWatched <= watchedThreshold;
  });
}