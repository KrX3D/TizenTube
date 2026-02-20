export function initPlaylistBatchState() {
  if (typeof window === 'undefined') return;
  window._playlistScrollHelpers = window._playlistScrollHelpers || new Set();
  window._lastHelperVideos = window._lastHelperVideos || [];
  window._playlistRemovedHelpers = window._playlistRemovedHelpers || new Set();
  window._playlistRemovedHelperKeys = window._playlistRemovedHelperKeys || new Set();
}

export function consumePlaylistLastBatchFlag(isPlaylistPage, debugEnabled = false) {
  if (!isPlaylistPage || typeof window === 'undefined') return false;
  if (window._isLastPlaylistBatch !== true) return false;

  if (debugEnabled) {
    console.log('--------------------------------->> Using last batch flag from response');
    console.log('--------------------------------->> This IS the last batch!');
  }

  window._isLastPlaylistBatch = false;
  return true;
}

export function cleanupStoredHelpersBeforeBatch({
  isPlaylistPage,
  arrLength,
  debugEnabled,
  getVideoId,
  trackRemovedPlaylistHelpers,
  trackRemovedPlaylistHelperKeys
}) {
  if (!isPlaylistPage || typeof window === 'undefined') return;
  if (!Array.isArray(window._lastHelperVideos) || window._lastHelperVideos.length === 0 || arrLength <= 0) return;

  if (debugEnabled) {
    console.log('[CLEANUP_TRIGGER] New batch detected! Stored helpers:', window._lastHelperVideos.length, '| new videos:', arrLength);
  }

  const helperIdsToTrack = window._lastHelperVideos.map((video) => getVideoId(video)).filter(Boolean);
  trackRemovedPlaylistHelpers(helperIdsToTrack);
  trackRemovedPlaylistHelperKeys(window._lastHelperVideos, getVideoId);

  window._lastHelperVideos = [];
  window._playlistScrollHelpers.clear();
  if (debugEnabled) console.log('[CLEANUP] Helpers cleared');
}

export function rememberCurrentHelperVideos(helperVideos, getVideoId, trackRemovedPlaylistHelpers, trackRemovedPlaylistHelperKeys) {
  if (typeof window === 'undefined' || !Array.isArray(helperVideos) || helperVideos.length === 0) return;
  window._lastHelperVideos = helperVideos;
  const helperIdsToTrack = helperVideos.map((video) => getVideoId(video)).filter(Boolean);
  trackRemovedPlaylistHelpers(helperIdsToTrack);
  trackRemovedPlaylistHelperKeys(helperVideos, getVideoId);
}

export function setPlaylistFallbackHelper(fallbackHelper, getVideoId) {
  if (!fallbackHelper || typeof window === 'undefined') return null;
  const fallbackId = getVideoId(fallbackHelper) || 'continuation-helper';
  window._lastHelperVideos = [fallbackHelper];
  window._playlistScrollHelpers.clear();
  window._playlistScrollHelpers.add(fallbackId);
  return fallbackId;
}

export function clearPlaylistHelpersState() {
  if (typeof window === 'undefined') return;
  window._lastHelperVideos = [];
  window._playlistScrollHelpers.clear();
}
