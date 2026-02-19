export function cleanupPlaylistHelperTiles({ getCurrentPage, getVideoId, debugEnabled = false, triggerPlaylistContinuationLoad }) {
  const page = getCurrentPage();
  if (page !== 'playlist') return;

  const removedIds = window._playlistRemovedHelpers || new Set();
  const removedKeys = window._playlistRemovedHelperKeys || new Set();
  const currentHelperIds = new Set((window._lastHelperVideos || []).map((video) => getVideoId(video)).filter(Boolean));
  const candidates = document.querySelectorAll('ytlr-grid-video-renderer, ytlr-rich-grid-renderer ytlr-grid-video-renderer, ytlr-item-section-renderer ytlr-grid-video-renderer, ytlr-continuation-item-renderer, [class*="continuation"], [data-video-id]');
  let removedCount = 0;

  candidates.forEach((node) => {
    const videoId = node.getAttribute('data-video-id') || node.getAttribute('video-id') || node.dataset?.videoId || '';
    const text = (node.textContent || '').toLowerCase();
    const html = (node.innerHTML || '').toLowerCase();
    const looksLikeHelper = /scroll|weiter|more|continuation|fortsetzen|laden|mehr anzeigen|more videos|load more/.test(text) || /continuation|loadmore|mehr/.test(html);
    const key = `${videoId}:${text.slice(0, 80)}`;

    if ((videoId && (removedIds.has(videoId) || currentHelperIds.has(videoId))) || removedKeys.has(key) || looksLikeHelper) {
      node.remove();
      removedCount += 1;
    }
  });

  if (removedCount > 0) {
    if (debugEnabled) {
      console.log('[HELPER_CLEANUP_DOM] Removed helper tiles from DOM:', removedCount);
    }
    triggerPlaylistContinuationLoad();
  }
}
