import { detectCurrentPage } from '../pageDetection.js';

export function shouldHideWatchedForPage(configPages, page) {
  if (!Array.isArray(configPages) || configPages.length === 0) return true;
  const normalizedPage = String(page || '').toLowerCase();
  const normalizedConfigPages = configPages.map((entry) => String(entry || '').toLowerCase());

  if (normalizedConfigPages.includes(normalizedPage)) return true;

  // Allow singular/plural aliases used by older configs.
  if (normalizedPage === 'channel' && normalizedConfigPages.includes('channels')) return true;
  if (normalizedPage === 'channels' && normalizedConfigPages.includes('channel')) return true;
  if (normalizedPage === 'subscriptions' && normalizedConfigPages.includes('subscription')) return true;
  if (normalizedPage === 'subscription' && normalizedConfigPages.includes('subscriptions')) return true;
  if ((normalizedPage === 'channel' || normalizedPage === 'channels') && normalizedConfigPages.length > 0) {
    // Channel filtering should remain active for legacy configs that missed the key.
    return true;
  }
  if ((normalizedPage === 'subscriptions' || normalizedPage === 'playlist' || normalizedPage === 'playlists') && normalizedConfigPages.length > 0) {
    // Keep watched filtering active on key browse pages for TV builds.
    return true;
  }

  // Library playlist overview / watch-next should follow library watched-filter setting.
  if (normalizedConfigPages.includes('library') && (normalizedPage === 'playlist' || normalizedPage === 'watch')) {
    return true;
  }

  return false;
}

export function hideWatchedVideos(items, pages, watchedThreshold, resolvedPage, sourcePath = '') {
  const pageName = resolvedPage || detectCurrentPage();
  const shouldApply = shouldHideWatchedForPage(pages, pageName);
  if (!shouldApply) return items;

  const filtered = items.filter((item) => {
    const progressBar = findProgressBar(item);
    if (!progressBar) return true;

    const percentWatched = Number(progressBar.percentDurationWatched || 0);
    const keep = percentWatched <= watchedThreshold;
    if (!keep && typeof window !== 'undefined') {
      const title = item?.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText
        || item?.videoRenderer?.title?.runs?.[0]?.text
        || item?.playlistVideoRenderer?.title?.runs?.[0]?.text
        || item?.gridVideoRenderer?.title?.runs?.[0]?.text
        || item?.compactVideoRenderer?.title?.simpleText
        || item?.richItemRenderer?.content?.videoRenderer?.title?.runs?.[0]?.text
        || item?.tileRenderer?.contentId
        || item?.videoRenderer?.videoId
        || item?.playlistVideoRenderer?.videoId
        || item?.gridVideoRenderer?.videoId
        || item?.compactVideoRenderer?.videoId
        || 'unknown';
      console.log('[REMOVE_WATCHED] via=hideWatchedVideos.filter', '| path=', sourcePath || `hideWatchedVideos.${pageName || 'unknown'}`, '| title=', title, '| watched=', percentWatched);
    }
    return keep;
  });

  return filtered;
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

  // Fallback: recursively search for any object carrying percentDurationWatched.
  const stack = [item];
  const seen = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);

    if (typeof node.percentDurationWatched === 'number') {
      return node;
    }

    const parsedPercent = Number(node.percentDurationWatched);
    if (Number.isFinite(parsedPercent) && parsedPercent >= 0) {
      return { percentDurationWatched: parsedPercent };
    }

    if (Array.isArray(node)) {
      for (const entry of node) stack.push(entry);
      continue;
    }

    for (const key of Object.keys(node)) {
      stack.push(node[key]);
    }
  }

  return null;
}

export function hideVideo(items, pages, watchedThreshold, page) {
  return hideWatchedVideos(items, pages, watchedThreshold, page);
}
