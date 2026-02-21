// ⭐ PLAYLIST COLLECTION MODE: Store unwatched videos, then reload filtered
const PLAYLIST_STORAGE_KEY = 'tizentube_playlist_unwatched';

// ⭐ NO CSS HIDING - Helpers will be visible, but that's OK
// Trying to hide them causes empty space and layout issues
export function trackRemovedPlaylistHelpers(helperIds) {
  if (!window._playlistRemovedHelpers) {
    window._playlistRemovedHelpers = new Set();
  }
  if (!window._playlistRemovedHelperKeys) {
    window._playlistRemovedHelperKeys = new Set();
  }
  if (!window._playlistRemovedHelperQueue) {
    window._playlistRemovedHelperQueue = [];
  }

  helperIds.forEach((helperId) => {
    if (!helperId || helperId === 'unknown') return;
    if (!window._playlistRemovedHelpers.has(helperId)) {
      window._playlistRemovedHelpers.add(helperId);
      window._playlistRemovedHelperQueue.push(helperId);
    }
  });

  const MAX_REMOVED_HELPERS = 25;
  while (window._playlistRemovedHelperQueue.length > MAX_REMOVED_HELPERS) {
    const oldest = window._playlistRemovedHelperQueue.shift();
    window._playlistRemovedHelpers.delete(oldest);
  }
}

export function isLikelyPlaylistHelperItem(item, getVideoId = null, getVideoTitle = null) {
  if (!item || typeof item !== 'object') return false;
  if (item.continuationItemRenderer) return true;
  if (item?.tileRenderer?.onSelectCommand?.continuationCommand) return true;
  if (item?.tileRenderer?.onSelectCommand?.continuationEndpoint) return true;
  if (item?.continuationEndpoint || item?.continuationCommand) return true;

  const safeGetVideoId = typeof getVideoId === 'function'
    ? getVideoId
    : (entry) => entry?.tileRenderer?.contentId
      || entry?.videoRenderer?.videoId
      || entry?.playlistVideoRenderer?.videoId
      || entry?.gridVideoRenderer?.videoId
      || entry?.compactVideoRenderer?.videoId
      || entry?.richItemRenderer?.content?.videoRenderer?.videoId
      || null;

  const safeGetVideoTitle = typeof getVideoTitle === 'function'
    ? getVideoTitle
    : (entry) => entry?.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText
      || entry?.videoRenderer?.title?.runs?.[0]?.text
      || entry?.playlistVideoRenderer?.title?.runs?.[0]?.text
      || entry?.gridVideoRenderer?.title?.runs?.[0]?.text
      || entry?.compactVideoRenderer?.title?.simpleText
      || entry?.richItemRenderer?.content?.videoRenderer?.title?.runs?.[0]?.text
      || '';

  const videoId = safeGetVideoId(item);
  if (videoId) return false;

  const textParts = String(safeGetVideoTitle(item) || '').toLowerCase();
  if (/scroll|weiter|weiteres|mehr|more|helper|continuation|fortsetzen|laden|load/.test(textParts)) return true;

  const serialized = JSON.stringify(item).toLowerCase();
  return /continuation|loadmore|next batch|nextbatch/.test(serialized);
}

export function getVideoKey(item, getVideoId) {
  const id = getVideoId(item);
  const title = item?.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText ||
    item?.videoRenderer?.title?.runs?.[0]?.text ||
    item?.gridVideoRenderer?.title?.runs?.[0]?.text ||
    item?.compactVideoRenderer?.title?.simpleText || '';
  return `${id || 'unknown'}|${title}`;
}

export function trackRemovedPlaylistHelperKeys(helperVideos, getVideoId) {
  window._playlistRemovedHelperKeys = window._playlistRemovedHelperKeys || new Set();
  window._playlistRemovedHelperKeyQueue = window._playlistRemovedHelperKeyQueue || [];

  helperVideos.forEach((video) => {
    const key = getVideoKey(video, getVideoId);
    if (!key || key === 'unknown|') return;
    if (!window._playlistRemovedHelperKeys.has(key)) {
      window._playlistRemovedHelperKeys.add(key);
      window._playlistRemovedHelperKeyQueue.push(key);
    }
  });

  const MAX_KEYS = 40;
  while (window._playlistRemovedHelperKeyQueue.length > MAX_KEYS) {
    const oldest = window._playlistRemovedHelperKeyQueue.shift();
    window._playlistRemovedHelperKeys.delete(oldest);
  }
}

export function isInCollectionMode() {
  const stored = localStorage.getItem(PLAYLIST_STORAGE_KEY);
  if (!stored) return false;

  try {
    const data = JSON.parse(stored);
    // Collection mode expires after 5 minutes
    if (Date.now() - data.timestamp > 5 * 60 * 1000) {
      localStorage.removeItem(PLAYLIST_STORAGE_KEY);
      return false;
    }
    return data.mode === 'collecting';
  } catch {
    return false;
  }
}

export function getFilteredVideoIds() {
  const stored = localStorage.getItem(PLAYLIST_STORAGE_KEY);
  if (!stored) return null;

  try {
    const data = JSON.parse(stored);
    if (data.mode === 'filtering' && Array.isArray(data.videoIds)) {
      if (data.videoIds.length === 0) {
        localStorage.removeItem(PLAYLIST_STORAGE_KEY);
        return null;
      }
      return new Set(data.videoIds);
    }
  } catch {}
  return null;
}

export function startCollectionMode() {
  console.log('🔄🔄🔄 STARTING COLLECTION MODE');
  localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify({
    mode: 'collecting',
    timestamp: Date.now(),
    videoIds: []
  }));
  // Reload page to start fresh
  window.location.reload();
}

export function finishCollectionAndFilter(unwatchedIds) {
  console.log('🔄🔄🔄 COLLECTION COMPLETE - Switching to filter mode');
  console.log('🔄 Total unwatched videos:', unwatchedIds.length);

  localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify({
    mode: 'filtering',
    timestamp: Date.now(),
    videoIds: unwatchedIds
  }));
  // Reload page in filter mode
  window.location.reload();
}

export function exitFilterMode() {
  console.log('🔄🔄🔄 EXITING FILTER MODE');
  localStorage.removeItem(PLAYLIST_STORAGE_KEY);
  window.location.reload();
}