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

export function findProgressBar(item) {
  if (!item) return null;

  const checkRenderer = (renderer) => {
    if (!renderer) return null;
    const overlays = renderer?.header?.tileHeaderRenderer?.thumbnailOverlays || renderer?.thumbnailOverlays || [];
    if (!Array.isArray(overlays)) return null;
    return overlays.find((o) => o?.thumbnailOverlayResumePlaybackRenderer)?.thumbnailOverlayResumePlaybackRenderer || null;
  };

  const rendererTypes = [
    item.tileRenderer,
    item.playlistVideoRenderer,
    item.compactVideoRenderer,
    item.gridVideoRenderer,
    item.videoRenderer,
    item.richItemRenderer?.content?.videoRenderer,
    item.richItemRenderer?.content?.reelItemRenderer
  ];

  for (const renderer of rendererTypes) {
    const result = checkRenderer(renderer);
    if (result) return result;
  }

  return null;
}

export function hideVideo(items, pages, watchedThreshold) {
  return hideWatchedVideos(items, pages, watchedThreshold);
}
