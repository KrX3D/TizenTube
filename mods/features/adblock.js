import { configRead } from '../config.js';
import Chapters from '../ui/chapters.js';
import resolveCommand from '../resolveCommand.js';
import { timelyAction, longPressData, MenuServiceItemRenderer, ShelfRenderer, TileRenderer, ButtonRenderer, showToast } from '../ui/ytUI.js';
import { PatchSettings } from '../ui/customYTSettings.js';

function detectCurrentPage() {
  const hash = location.hash ? location.hash.substring(1) : '';
  const cParam = (hash.match(/[?&]c=([^&]+)/i)?.[1] || '').toLowerCase();
  let pageName = 'home';

  if (hash.startsWith('/watch')) pageName = 'watch';
  else if (cParam.includes('fesubscription')) pageName = 'subscriptions';
  else if (cParam === 'fehistory') pageName = 'history';
  else if (cParam === 'felibrary') pageName = 'library';
  else if (cParam === 'feplaylist_aggregation') pageName = 'playlists';
  else if (cParam === 'femy_youtube' || cParam === 'vlwl' || cParam === 'vlll' || cParam.startsWith('vlpl')) pageName = 'playlist';
  else {
    try {
      pageName = hash === '/'
        ? 'home'
        : hash.startsWith('/search')
          ? 'search'
          : (hash.split('?')[1]?.split('&')[0]?.split('=')[1] || 'home').replace('FE', '').replace('topics_', '');
    } catch (_) {
      pageName = 'home';
    }
  }

  return pageName;
}

function normalizeBrowseIdToPage(rawBrowseId = '') {
  const browseId = String(rawBrowseId || '').toLowerCase();
  if (!browseId) return null;
  if (browseId.includes('fesubscription')) return 'subscriptions';
  if (browseId.startsWith('uc')) return 'channel';
  if (browseId === 'fehistory') return 'history';
  if (browseId === 'felibrary') return 'library';
  if (browseId === 'feplaylist_aggregation') return 'playlists';
  if (browseId === 'femy_youtube' || browseId === 'vlwl' || browseId === 'vlll' || browseId.startsWith('vlpl')) return 'playlist';
  return null;
}

function detectPageFromResponse(response) {
  const serviceParams = response?.responseContext?.serviceTrackingParams || [];
  for (const entry of serviceParams) {
    for (const param of (entry?.params || [])) {
      if (param?.key === 'browse_id') {
        const detected = normalizeBrowseIdToPage(param?.value);
        if (detected) return detected;
      }
    }
  }

  const targetId = String(response?.contents?.tvBrowseRenderer?.targetId || '');
  if (targetId.startsWith('browse-feed')) {
    const detected = normalizeBrowseIdToPage(targetId.replace('browse-feed', ''));
    if (detected) return detected;
  }

  return null;
}

function getActivePage() {
  return window.__ttLastDetectedPage || detectCurrentPage();
}

const HIDDEN_LIBRARY_TAB_IDS = new Set(['femusic_last_played', 'festorefront', 'fecollection_podcasts', 'femy_videos']);

function getConfiguredHiddenLibraryTabIds() {
  const configured = configRead('hiddenLibraryTabIds');
  if (!Array.isArray(configured) || configured.length === 0) return HIDDEN_LIBRARY_TAB_IDS;
  return new Set(configured.map((id) => String(id || '').toLowerCase()).filter(Boolean));
}

function isHiddenLibraryBrowseId(value) {
  const id = String(value || '').toLowerCase();
  if (!id) return false;

  for (const hiddenId of getConfiguredHiddenLibraryTabIds()) {
    if (id === hiddenId || id.includes(hiddenId)) return true;
  }
  return false;
}

function filterHiddenLibraryTabs(items, context = '') {
  if (!Array.isArray(items)) return items;
  const filtered = items.filter((item) => {
    const contentId = String(item?.tileRenderer?.contentId || '').toLowerCase();
    return !isHiddenLibraryBrowseId(contentId);
  });

  return filtered;
}

function pruneLibraryTabsInResponse(node, path = 'root') {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      const browseIds = Array.from(extractBrowseIdsDeep(node[i])).map((v) => String(v).toLowerCase());
      if (browseIds.some((id) => isHiddenLibraryBrowseId(id))) {
        node.splice(i, 1);
      }
    }
    for (let i = 0; i < node.length; i++) {
      pruneLibraryTabsInResponse(node[i], `${path}[${i}]`);
    }
    return;
  }

  if (Array.isArray(node?.horizontalListRenderer?.items)) {
    node.horizontalListRenderer.items = filterHiddenLibraryTabs(node.horizontalListRenderer.items, `${path}.horizontalListRenderer.items`);
  }

  for (const key of Object.keys(node)) {
    pruneLibraryTabsInResponse(node[key], `${path}.${key}`);
  }
}

// FIX (Bug 4): Broaden browseId extraction to cover all known TV nav tab endpoint paths,
// including navigationEndpoint which YouTube TV uses most commonly.
function extractBrowseIdsDeep(node, out = new Set(), depth = 0) {
  if (!node || depth > 8) return out;
  if (Array.isArray(node)) {
    for (const child of node) extractBrowseIdsDeep(child, out, depth + 1);
    return out;
  }
  if (typeof node !== 'object') return out;

  const browseId = node?.browseEndpoint?.browseId;
  if (typeof browseId === 'string' && browseId) out.add(browseId);

  for (const key of Object.keys(node)) {
    extractBrowseIdsDeep(node[key], out, depth + 1);
  }
  return out;
}

const origParse = JSON.parse;
JSON.parse = function () {
  const r = origParse.apply(this, arguments);
  try {

  const detectedPage = detectPageFromResponse(r) || detectCurrentPage();
  window.__ttLastDetectedPage = detectedPage;

  // Drop "masthead" ad from home screen
  if (
    r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content
      ?.sectionListRenderer?.contents
  ) {
    processShelves(r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents, true, detectedPage);
  }

  if (detectedPage === 'library') {
    pruneLibraryTabsInResponse(r, 'response');
  }
  
  if (r?.title?.runs) {
    PatchSettings(r);
  }

  if (r?.continuationContents?.horizontalListContinuation?.items) {
    const continuation = r.continuationContents.horizontalListContinuation;
    if (detectedPage === 'library') {
      r.continuationContents.horizontalListContinuation.items = filterHiddenLibraryTabs(r.continuationContents.horizontalListContinuation.items, 'continuation.horizontalListContinuation.items');
      pruneLibraryTabsInResponse(r.continuationContents, 'response.continuationContents');
    }
  }

  return r;
  } catch (error) {
    return r;
  }
};

// Patch JSON.parse to use the custom one
window.JSON.parse = JSON.parse;
for (const key in window._yttv) {
  if (window._yttv[key] && window._yttv[key].JSON && window._yttv[key].JSON.parse) {
    window._yttv[key].JSON.parse = JSON.parse;
  }
}

function processShelves(shelves, shouldAddPreviews = true, pageHint = null) {
  if (!Array.isArray(shelves)) return;
  const activePage = pageHint || getActivePage();

  for (let i = shelves.length - 1; i >= 0; i--) {
    const shelve = shelves[i];

    if (!shelve.shelfRenderer) continue;
    if (activePage === 'library') {
      shelve.shelfRenderer.content.horizontalListRenderer.items = filterHiddenLibraryTabs(shelve.shelfRenderer.content.horizontalListRenderer.items, 'processShelves.shelfRenderer.horizontalListRenderer.items');
    }
  }
}

function getItemVideoId(item) {
  return String(
    item?.tileRenderer?.contentId ||
    item?.tileRenderer?.onSelectCommand?.watchEndpoint?.videoId ||
    item?.tileRenderer?.onSelectCommand?.watchEndpoint?.playlistId ||
    item?.tileRenderer?.onSelectCommand?.reelWatchEndpoint?.videoId ||
    ''
  );
}

function hideVideo(items, pageHint = null) {
  if (!Array.isArray(items)) return [];
  const pageName = pageHint || getActivePage();
  const threshold = Number(configRead('hideWatchedVideosThreshold') || 0);

  const result = items.filter(item => {
    try {
    const videoId = getItemVideoId(item);
    const title = item?.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText || videoId || 'unknown';

    const contentId = videoId.toLowerCase();

    if (pageName === 'library' && isHiddenLibraryBrowseId(contentId)) {
      return false;
    }

    const percentWatched = Number(progressBar.percentDurationWatched || 0);
    const remove = percentWatched > threshold;

    return !remove;
    } catch (error) {
      return true;
    }
  });
  return result;
}
