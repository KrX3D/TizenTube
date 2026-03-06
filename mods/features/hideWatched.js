import { configRead } from '../config.js';

function appendFileOnlyLog(label, payload) {
  if (!configRead('enableDebugLogging')) return;
  if (!Array.isArray(window.__ttFileOnlyLogs)) window.__ttFileOnlyLogs = [];

  let serialized = '';
  try { serialized = JSON.stringify(payload); } catch (_) { serialized = String(payload); }
  window.__ttFileOnlyLogs.push(`[${new Date().toISOString()}] [TT_ADBLOCK_FILE] ${label} ${serialized}`);
  if (window.__ttFileOnlyLogs.length > 5000) window.__ttFileOnlyLogs.shift();
}

export function detectPageFromResponse(response) {
  const serviceParams = response?.responseContext?.serviceTrackingParams || [];
  for (const entry of serviceParams) {
    for (const param of (entry?.params || [])) {
      if (param?.key !== 'browse_id') continue;
      const browseId = String(param?.value || '').toLowerCase();
      if (browseId.includes('fesubscription')) return 'subscriptions';
      if (browseId.startsWith('uc')) return 'channel';
      if (browseId === 'fehistory') return 'history';
      if (browseId === 'felibrary') return 'library';
      if (browseId === 'feplaylist_aggregation') return 'playlists';
      if (browseId === 'femy_youtube' || browseId === 'vlwl' || browseId === 'vlll' || browseId.startsWith('vlpl')) return 'playlist';
    }
  }

  const targetId = String(response?.contents?.tvBrowseRenderer?.targetId || '').toLowerCase();
  if (targetId.startsWith('browse-feed')) {
    const browseId = targetId.replace('browse-feed', '');
    if (browseId.includes('fesubscription')) return 'subscriptions';
    if (browseId.startsWith('uc')) return 'channel';
  }

  if (response?.contents?.singleColumnWatchNextResults) return 'watch';

  return null;
}


export function detectAndStorePageFromResponse(response) {
  const detectedPage = detectPageFromResponse(response);
  if (detectedPage) {
    window.__ttLastDetectedPage = detectedPage;
  }
  return detectedPage;
}
export function detectAndStorePageFromBrowseId(browseId) {
  const detectedPage = detectPageFromBrowseId(browseId);
  if (detectedPage) {
    window.__ttLastDetectedPage = detectedPage;
  }
  return detectedPage;
}

export function detectPageFromBrowseId(browseId) {
  const normalizedBrowseId = String(browseId || '').toLowerCase();
  if (!normalizedBrowseId) return null;
  if (normalizedBrowseId.includes('fesubscription')) return 'subscriptions';
  if (normalizedBrowseId.startsWith('uc')) return 'channel';
  if (normalizedBrowseId === 'fehistory') return 'history';
  if (normalizedBrowseId === 'felibrary') return 'library';
  if (normalizedBrowseId === 'feplaylist_aggregation') return 'playlists';
  if (normalizedBrowseId === 'femy_youtube' || normalizedBrowseId === 'vlwl' || normalizedBrowseId === 'vlll' || normalizedBrowseId.startsWith('vlpl')) return 'playlist';
  return null;
}

function extractWatchProgress(node, depth = 0, seen = new WeakSet()) {
  if (!node || depth > 7) return null;
  if (typeof node !== 'object') return null;
  if (seen.has(node)) return null;
  seen.add(node);

  const overlays = node?.tileRenderer?.header?.tileHeaderRenderer?.thumbnailOverlays || [];
  const resumeOverlay = overlays.find(overlay => overlay.thumbnailOverlayResumePlaybackRenderer)?.thumbnailOverlayResumePlaybackRenderer;
  if (resumeOverlay) {
    return Number(resumeOverlay.percentDurationWatched || 0);
  }

  const hasWatchedBadge = overlays.some(overlay =>
    overlay.thumbnailOverlayPlaybackStatusRenderer ||
    overlay.thumbnailOverlayPlayedRenderer
  );
  if (hasWatchedBadge) {
    return 100;
  }

  const direct = Number(node.watchProgressPercentage ?? node.percentDurationWatched ?? node.watchedPercent);
  if (Number.isFinite(direct)) {
    return direct;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      const childProgress = extractWatchProgress(child, depth + 1, seen);
      if (childProgress !== null) return childProgress;
    }
    return null;
  }

  for (const key of Object.keys(node)) {
    const childProgress = extractWatchProgress(node[key], depth + 1, seen);
    if (childProgress !== null) return childProgress;
  }

  return null;
}

function detectCurrentPage() {
  const hash = location.hash ? location.hash.substring(1) : '';
  const params = hash.includes('?') ? new URLSearchParams(hash.split('?')[1]) : new URLSearchParams();
  const cParam = (params.get('c') || '').toLowerCase();

  if (cParam.includes('fesubscription')) return 'subscriptions';
  if (cParam.startsWith('uc')) return 'channel';
  if (cParam === 'felibrary') return 'library';
  if (cParam === 'fehistory') return 'history';
  if (cParam === 'feplaylist_aggregation') return 'playlists';
  if (cParam === 'femy_youtube' || cParam === 'vlwl' || cParam === 'vlll' || cParam.startsWith('vlpl')) return 'playlist';
  if (hash.startsWith('/watch')) return 'watch';

  try {
    return hash === '/'
      ? 'home'
      : hash.startsWith('/search')
        ? 'search'
        : (hash.split('?')[1]?.split('&')[0]?.split('=')[1] || 'home').replace('FE', '').replace('topics_', '');
  } catch {
    return 'home';
  }
}

export function hideVideo(items, pageHint = null) {
  return items.filter(item => {
    try {
      if (!configRead('enableHideWatchedVideos')) return true;

      const pages = configRead('hideWatchedVideosPages');
      const hashPage = detectCurrentPage();
      const pageName = pageHint || ((hashPage === 'home' || hashPage === 'search')
        ? (window.__ttLastDetectedPage || hashPage)
        : hashPage);
      if (!pages.includes(pageName)) {
        return true;
      }

      const percentWatched = extractWatchProgress(item);

      if (percentWatched === null) return true;

      const keep = percentWatched <= configRead('hideWatchedVideosThreshold');
      if (!keep) {
        appendFileOnlyLog('hideVideo.removed', {
          pageName,
          percentWatched,
          videoId: item?.tileRenderer?.contentId || item?.tileRenderer?.onSelectCommand?.watchEndpoint?.videoId || null
        });
      }
      return keep;
    } catch {
      return true;
    }
  });
}

export function processTileArraysDeep(node, pageHint = null, path = 'root', depth = 0) {
  if (!node || depth > 10) return;

  if (Array.isArray(node)) {
    if (node.some((item) => item?.tileRenderer)) {
      const before = node.length;
      const filtered = hideVideo(node, pageHint);
      if (before !== filtered.length) {
        appendFileOnlyLog('deep.tiles.filtered', {
          path,
          pageHint,
          before,
          after: filtered.length,
          removed: before - filtered.length
        });
      }
      node.splice(0, node.length, ...filtered);
      return;
    }

    for (let i = 0; i < node.length; i++) {
      processTileArraysDeep(node[i], pageHint, `${path}[${i}]`, depth + 1);
    }
    return;
  }

  if (typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    processTileArraysDeep(node[key], pageHint, `${path}.${key}`, depth + 1);
  }
}
