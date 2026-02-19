import { detectCurrentPage } from '../pageDetection.js';

export function shouldHideWatchedForPage(configPages, page) {
  if (!Array.isArray(configPages) || configPages.length === 0) return true;
  const normalizedPage = String(page || '').toLowerCase();
  const normalizedConfigPages = configPages.map((entry) => String(entry || '').toLowerCase());

  if (normalizedConfigPages.includes(normalizedPage)) return true;

  // Allow singular/plural aliases used by older configs.
  if (normalizedPage === 'channel' && normalizedConfigPages.includes('channels')) return true;
  if (normalizedPage === 'channels' && normalizedConfigPages.includes('channel')) return true;

  // Library playlist overview / watch-next should follow library watched-filter setting.
  if (normalizedConfigPages.includes('library') && (normalizedPage === 'playlist' || normalizedPage === 'watch')) {
    return true;
  }

  return false;
}

export function hideWatchedVideos(items, pages, watchedThreshold, resolvedPage) {
  const pageName = resolvedPage || detectCurrentPage();
  if (!shouldHideWatchedForPage(pages, pageName)) return items;

  return items.filter((item) => {
    const progressBar = findProgressBar(item);
    if (!progressBar) return true;

    const percentWatched = progressBar.percentDurationWatched || 0;
    return percentWatched <= watchedThreshold;
  });
}

export function findProgressBar(item) {
  if (!item) return null;

  const checkRenderer = (renderer) => {
    if (!renderer) return null;

    // Comprehensive overlay paths
    const overlayPaths = [
      // Standard paths (Tizen 6.5)
      renderer.thumbnailOverlays,
      renderer.header?.tileHeaderRenderer?.thumbnailOverlays,
      renderer.thumbnail?.thumbnailOverlays,
      
      // Alternative paths (Tizen 5.0)
      renderer.thumbnailOverlayRenderer,
      renderer.overlay,
      renderer.overlays
    ];

    for (const overlays of overlayPaths) {
      if (!overlays) continue;

      // Handle array
      if (Array.isArray(overlays)) {
        const progressOverlay = overlays.find((o) => o?.thumbnailOverlayResumePlaybackRenderer);
        if (progressOverlay) {
          return progressOverlay.thumbnailOverlayResumePlaybackRenderer;
        }
      }
      // Handle direct object
      else if (overlays.thumbnailOverlayResumePlaybackRenderer) {
        return overlays.thumbnailOverlayResumePlaybackRenderer;
      }
    }
    return null;
  };

  // Check all renderer types
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

export function hideVideo(items, pages, watchedThreshold, page) {
  return hideWatchedVideos(items, pages, watchedThreshold, page);
}
