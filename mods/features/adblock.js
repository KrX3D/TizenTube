import { configRead } from '../config.js';
import Chapters from '../ui/chapters.js';
import resolveCommand from '../resolveCommand.js';
import { timelyAction, longPressData, MenuServiceItemRenderer, ShelfRenderer, TileRenderer, ButtonRenderer, showToast } from '../ui/ytUI.js';
import { PatchSettings } from '../ui/customYTSettings.js';

function appendFileOnlyLog(label, payload) {
  if (!configRead('enableDebugLogging')) return;

  const activePage = window.__ttLastDetectedPage || detectCurrentPage();
  const labelStr = String(label || '');
  const isPlaylistPage = activePage === 'playlist' || activePage === 'playlists';
  const isPlaylistLog = labelStr.startsWith('playlist.') || labelStr.startsWith('hideVideo.') || labelStr.startsWith('json.parse.meta') || labelStr.startsWith('page-detect');
  if (!isPlaylistPage && !isPlaylistLog) return;

  if (!Array.isArray(window.__ttFileOnlyLogs)) window.__ttFileOnlyLogs = [];

  const stamp = new Date().toISOString();
  let message = '';
  if (typeof payload === 'string') message = payload;
  else {
    try { message = JSON.stringify(payload); } catch (_) { message = String(payload); }
  }

  window.__ttFileOnlyLogs.push(`[${stamp}] [TT_ADBLOCK_FILE] ${label} ${message}`);
  if (window.__ttFileOnlyLogs.length > 5000) window.__ttFileOnlyLogs.shift();
}

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
  const before = items.length;
  const filtered = items.filter((item) => {
    const contentId = String(item?.tileRenderer?.contentId || '').toLowerCase();
    return !isHiddenLibraryBrowseId(contentId);
  });

  if (before !== filtered.length) {
    appendFileOnlyLog('library.tabs.filter', {
      context,
      before,
      after: filtered.length,
      removed: before - filtered.length
    });
  }

  return filtered;
}

function pruneLibraryTabsInResponse(node, path = 'root') {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    const before = node.length;
    for (let i = node.length - 1; i >= 0; i--) {
      const browseIds = Array.from(extractBrowseIdsDeep(node[i])).map((v) => String(v).toLowerCase());
      if (browseIds.some((id) => isHiddenLibraryBrowseId(id))) {
        appendFileOnlyLog('library.array.pruned', { path, index: i, browseIds });
        node.splice(i, 1);
      }
    }
    if (before !== node.length) {
      appendFileOnlyLog('library.array.pruned.summary', { path, before, after: node.length, removed: before - node.length });
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

function extractNavTabBrowseId(tab) {
  return Array.from(extractBrowseIdsDeep(tab)).join(',');
}

function filterLibraryNavTabs(sections, detectedPage) {
  if (detectedPage !== 'library') return;
  if (!Array.isArray(sections)) return;
  for (const section of sections) {
    const tabs = section?.tvSecondaryNavSectionRenderer?.tabs;
    if (!Array.isArray(tabs)) continue;
    const before = tabs.length;
    for (let i = tabs.length - 1; i >= 0; i--) {
      const browseIds = Array.from(extractBrowseIdsDeep(tabs[i])).map((id) => String(id).toLowerCase());
      appendFileOnlyLog('library.navtab.check', { browseIds, index: i });
      if (browseIds.some((id) => isHiddenLibraryBrowseId(id))) {
        appendFileOnlyLog('library.navtab.removed', { browseIds, index: i });
        tabs.splice(i, 1);
      }
    }
    if (tabs.length !== before)
      appendFileOnlyLog('library.navtabs.result', { before, after: tabs.length });
  }
}

function processResponsePayload(payload, detectedPage) {
  if (!payload || typeof payload !== 'object') return;

  if (detectedPage === 'library') {
    pruneLibraryTabsInResponse(payload, 'arrayPayload');
  }

  processTileArraysDeep(payload, detectedPage, 'arrayPayload');
}

const origParse = JSON.parse;
JSON.parse = function () {
  const r = origParse.apply(this, arguments);
  try {

  const detectedPage = detectPageFromResponse(r) || detectCurrentPage();
  window.__ttLastDetectedPage = detectedPage;
  window.__ttParseSeq = Number(window.__ttParseSeq || 0) + 1;
  const parseSeq = window.__ttParseSeq;
  appendFileOnlyLog('json.parse.meta', {
    hash: location.hash || '',
    path: location.pathname || '',
    search: location.search || '',
    detectedPage,
    parseSeq,
    rootType: Array.isArray(r) ? 'array' : typeof r,
    rootKeys: r && typeof r === 'object' ? Object.keys(r).slice(0, 40) : []
  });
  appendFileOnlyLog('json.parse.full', r);

  if (Array.isArray(r)) {
    appendFileOnlyLog('json.parse.array.root', { detectedPage, length: r.length });
    for (let i = 0; i < r.length; i++) {
      processResponsePayload(r[i], detectedPage);
    }
    return r;
  }

  // Drop "masthead" ad from home screen
  if (
    r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content
      ?.sectionListRenderer?.contents
  ) {
    processShelves(r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents, true, detectedPage);
  }

  // Library tab pruning: must run unconditionally whenever we're on the library page,
  // because the library page sends its nav tabs via tvSecondaryNavRenderer (not tvSurfaceContentRenderer),
  // so gating this inside the tvSurfaceContentRenderer block meant it never fired on library.
  if (detectedPage === 'library') {
    pruneLibraryTabsInResponse(r, 'response');
  }
  // Patch settings

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

  // Last-pass safety net for unknown/new TV response shapes that still carry tileRenderer arrays.
  processTileArraysDeep(r, detectedPage, 'response');

  return r;
  } catch (error) {
    appendFileOnlyLog('json.parse.error', {
      message: error?.message || String(error),
      stack: String(error?.stack || '').substring(0, 600)
    });
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
  appendFileOnlyLog('processShelves.start', {
    page: activePage,
    shelfCount: shelves.length,
    shouldAddPreviews
  });

  for (let i = shelves.length - 1; i >= 0; i--) {
    const shelve = shelves[i];
    appendFileOnlyLog('processShelves.item', {
      page: activePage,
      index: i,
      keys: shelve && typeof shelve === 'object' ? Object.keys(shelve).slice(0, 8) : typeof shelve,
      hasShelfRenderer: !!shelve?.shelfRenderer,
      hasReelShelfRenderer: !!shelve?.reelShelfRenderer
    });

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

function processTileArraysDeep(node, pageHint = null, path = 'root', depth = 0) {
  if (!node || depth > 10) return;
  const pageName = pageHint || getActivePage();

  if (Array.isArray(node)) {
    if (node.some((item) => item?.tileRenderer)) {
      const before = node.length;
      let filtered = hideVideo(node, pageName);
      if (pageName === 'library') {
        filtered = filterHiddenLibraryTabs(filtered, `deep:${path}`);
      }
      node.splice(0, node.length, ...filtered);
      return;
    }

    for (let i = 0; i < node.length; i++) {
      processTileArraysDeep(node[i], pageName, `${path}[${i}]`, depth + 1);
    }
    return;
  }

  if (typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    processTileArraysDeep(node[key], pageName, `${path}.${key}`, depth + 1);
  }
}

function hideVideo(items, pageHint = null) {
  if (!Array.isArray(items)) return [];
  const pages = configRead('hideWatchedVideosPages') || [];
  const pageName = pageHint || getActivePage();
  const threshold = Number(configRead('hideWatchedVideosThreshold') || 0);

  const hideWatchedEnabled = !!configRead('enableHideWatchedVideos');

  appendFileOnlyLog('hideVideo.start', {
    pageName,
    threshold,
    configuredPages: pages,
    inputCount: Array.isArray(items) ? items.length : 0,
    enableHideWatchedVideos: hideWatchedEnabled
  });

  const result = items.filter(item => {
    try {
    const videoId = getItemVideoId(item);
    const title = item?.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText || videoId || 'unknown';

    const contentId = videoId.toLowerCase();

    if (pageName === 'library' && isHiddenLibraryBrowseId(contentId)) {
      appendFileOnlyLog('hideVideo.item', { pageName, title, contentId, hasProgress: !!progressBar, remove: true, reason: 'library_tab_hidden' });
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
