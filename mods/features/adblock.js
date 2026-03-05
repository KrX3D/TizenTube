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

function appendFileOnlyLogOnce(key, payload) {
  if (!configRead('enableDebugLogging')) return;
  if (!window._ttFileDebugOnce) window._ttFileDebugOnce = new Map();

  let serialized = '';
  try { serialized = JSON.stringify(payload); } catch (_) { serialized = String(payload); }

  if (window._ttFileDebugOnce.get(key) === serialized) return;
  window._ttFileDebugOnce.set(key, serialized);
  appendFileOnlyLog(key, serialized);
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

  appendFileOnlyLogOnce(`page-detect:${pageName}`, {
    hash,
    cParam,
    pathname: location.pathname || '',
    search: location.search || '',
    pageName
  });

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
  if (response?.contents?.singleColumnWatchNextResults || response?.playerOverlays || response?.videoDetails) {
    return 'watch';
  }

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

function collectWatchProgressEntries(node, out = [], depth = 0, seen = new WeakSet()) {
  if (!node || depth > 10) return out;
  if (Array.isArray(node)) {
    for (const child of node) collectWatchProgressEntries(child, out, depth + 1, seen);
    return out;
  }
  if (typeof node !== 'object') return out;
  if (seen.has(node)) return out;
  seen.add(node);

  const id = node.videoId || node.externalVideoId || node.contentId || null;
  const pctRaw = node.watchProgressPercentage ?? node.percentDurationWatched ?? node.watchedPercent ?? null;
  const pct = Number(pctRaw);
  if (id && Number.isFinite(pct)) {
    out.push({ id: String(id), percent: pct, source: 'deep_scan' });
  }

  for (const key of Object.keys(node)) {
    collectWatchProgressEntries(node[key], out, depth + 1, seen);
  }
  return out;
}

function collectAllText(node, out = [], seen = new WeakSet(), depth = 0) {
  if (depth > 12) return out;
  if (!node) return out;
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectAllText(child, out, seen, depth + 1);
    return out;
  }
  if (typeof node === 'object') {
    if (seen.has(node)) return out;
    seen.add(node);
    if (typeof node.simpleText === 'string') out.push(node.simpleText);
    if (Array.isArray(node.runs)) {
      for (const run of node.runs) if (typeof run?.text === 'string') out.push(run.text);
    }
    for (const key of Object.keys(node)) {
      if (key === 'runs' || key === 'simpleText') continue;
      collectAllText(node[key], out, seen, depth + 1);
    }
  }
  return out;
}

function parseDurationToSeconds(text) {
  if (!text) return null;
  const m = String(text).match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
  if (!m) return null;
  const parts = m[1].split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}


function getItemTitle(item) {
  return item?.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText
    || item?.tileRenderer?.contentId
    || 'unknown';
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

function isShortsShelf(shelve) {
  const shelfRenderer = shelve?.shelfRenderer;
  if (!shelfRenderer) return !!shelve?.reelShelfRenderer;

  const titleText = [
    String(shelfRenderer?.title?.simpleText || ''),
    collectAllText(shelfRenderer?.header).join(' '),
    collectAllText(shelfRenderer?.headerRenderer).join(' ')
  ].join(' ').toLowerCase();

  const browseIds = Array.from(extractBrowseIdsDeep(shelfRenderer)).map((id) => String(id).toLowerCase());
  const hasShortsBrowseId = browseIds.some((id) => id.includes('short') || id.includes('reel'));

  return (
    shelfRenderer.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS' ||
    titleText.includes('short') ||
    titleText.includes('kurz') ||
    hasShortsBrowseId
  );
}

function getShelfItems(shelve) {
  return shelve?.shelfRenderer?.content?.horizontalListRenderer?.items || null;
}

function normalizeHorizontalListRenderer(horizontalListRenderer, context = '') {
  if (!horizontalListRenderer || !Array.isArray(horizontalListRenderer.items)) return;
  const count = horizontalListRenderer.items.length;

  const before = {
    visibleItemCount: horizontalListRenderer.visibleItemCount,
    collapsedItemCount: horizontalListRenderer.collapsedItemCount,
    totalItemCount: horizontalListRenderer.totalItemCount
  };

  if (typeof horizontalListRenderer.visibleItemCount === 'number') {
    horizontalListRenderer.visibleItemCount = count;
  }
  if (typeof horizontalListRenderer.collapsedItemCount === 'number') {
    horizontalListRenderer.collapsedItemCount = count;
  }
  if (typeof horizontalListRenderer.totalItemCount === 'number') {
    horizontalListRenderer.totalItemCount = count;
  }

  const after = {
    visibleItemCount: horizontalListRenderer.visibleItemCount,
    collapsedItemCount: horizontalListRenderer.collapsedItemCount,
    totalItemCount: horizontalListRenderer.totalItemCount,
    selectedIndex: horizontalListRenderer.selectedIndex,
    focusIndex: horizontalListRenderer.focusIndex,
    currentIndex: horizontalListRenderer.currentIndex
  };

  const clamp = (value) => {
    if (typeof value !== 'number') return value;
    if (count <= 0) return 0;
    return Math.max(0, Math.min(count - 1, value));
  };

  if (typeof horizontalListRenderer.selectedIndex === 'number') {
    horizontalListRenderer.selectedIndex = clamp(horizontalListRenderer.selectedIndex);
  }
  if (typeof horizontalListRenderer.focusIndex === 'number') {
    horizontalListRenderer.focusIndex = clamp(horizontalListRenderer.focusIndex);
  }
  if (typeof horizontalListRenderer.currentIndex === 'number') {
    horizontalListRenderer.currentIndex = clamp(horizontalListRenderer.currentIndex);
  }

  appendFileOnlyLogOnce(`list.normalize.${context}`.substring(0, 48), {
    context,
    count,
    before,
    after
  });
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
  const adBlockEnabled = configRead('enableAdBlock');

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


  if (r?.contents?.sectionListRenderer?.contents) {
    processShelves(r.contents.sectionListRenderer.contents, true, detectedPage);
  }

  if (r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.gridRenderer?.items) {
    const gridItems = r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.gridRenderer.items;
    r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.gridRenderer.items = hideVideo(gridItems, detectedPage);
  }

  if (r?.continuationContents?.sectionListContinuation?.contents) {
    processShelves(r.continuationContents.sectionListContinuation.contents, true, detectedPage);
  }

  if (r?.continuationContents?.horizontalListContinuation?.items) {
    const continuation = r.continuationContents.horizontalListContinuation;
    normalizeHorizontalListRenderer(r.continuationContents.horizontalListContinuation, 'continuation.horizontal');
    if (detectedPage === 'library') {
      r.continuationContents.horizontalListContinuation.items = filterHiddenLibraryTabs(r.continuationContents.horizontalListContinuation.items, 'continuation.horizontalListContinuation.items');
      pruneLibraryTabsInResponse(r.continuationContents, 'response.continuationContents');
    }
  }

  if (r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
    filterLibraryNavTabs(r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections, detectedPage);

    for (const section of r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections) {
      if (!Array.isArray(section?.tvSecondaryNavSectionRenderer?.tabs)) continue;

      // Remove the "Shorts" tab from the channel nav bar when shorts are disabled.
      // Previously only the tab's content was filtered; the tab button itself stayed visible.
      if (!configRead('enableShorts')) {
        const tabs = section.tvSecondaryNavSectionRenderer.tabs;
        for (let i = tabs.length - 1; i >= 0; i--) {
          const tab = tabs[i];
          const tabTitle = String(
            tab?.tabRenderer?.title?.simpleText ||
            collectAllText(tab?.tabRenderer?.title).join(' ')
          ).toLowerCase();
          // Also catch via the endpoint browseId (Shorts tabs often point to a shorts browseId)
          const tabBrowseId = String(extractNavTabBrowseId(tab)).toLowerCase();
          if (tabTitle.includes('short') || tabBrowseId.includes('short')) {
            appendFileOnlyLog('shorts.navtab.removed', { tabTitle, tabBrowseId, index: i });
            tabs.splice(i, 1);
            continue;
          }
        }
      }

      for (const tab of section.tvSecondaryNavSectionRenderer.tabs) {
        const tabBrowseId = String(extractNavTabBrowseId(tab)).toLowerCase();
        const tabPage = normalizeBrowseIdToPage(tabBrowseId) || detectedPage;
        const contents = tab?.tabRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents;
        if (Array.isArray(contents)) {
          processShelves(contents, true, tabPage);
        }

        const gridItems = tab?.tabRenderer?.content?.tvSurfaceContentRenderer?.content?.gridRenderer?.items;
        if (Array.isArray(gridItems)) {
          tab.tabRenderer.content.tvSurfaceContentRenderer.content.gridRenderer.items = hideVideo(gridItems, tabPage);
        }
      }
    }
  }

  // Last-pass safety net for unknown/new TV response shapes that still carry tileRenderer arrays.
  processTileArraysDeep(r, detectedPage, 'response');

  if (r?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer) {

    processShelves(r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents, false, detectedPage);
    if (window.queuedVideos.videos.length > 0) {
      const queuedVideosClone = window.queuedVideos.videos.slice();
      queuedVideosClone.unshift(TileRenderer(
        'Clear Queue',
        {
          customAction: {
            action: 'CLEAR_QUEUE'
          }
        }));
      r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents.unshift(ShelfRenderer(
        'Queued Videos',
        queuedVideosClone,
        queuedVideosClone.findIndex(v => v.contentId === window.queuedVideos.lastVideoId) !== -1 ?
          queuedVideosClone.findIndex(v => v.contentId === window.queuedVideos.lastVideoId)
          : 0
      ));
    }
  }
  /*
 
  Chapters are disabled due to the API removing description data which was used to generate chapters
 
  if (r?.contents?.singleColumnWatchNextResults?.results?.results?.contents && configRead('enableChapters')) {
    const chapterData = Chapters(r);
    r.frameworkUpdates.entityBatchUpdate.mutations.push(chapterData);
    resolveCommand({
      "clickTrackingParams": "null",
      "loadMarkersCommand": {
        "visibleOnLoadKeys": [
          chapterData.entityKey
        ],
        "entityKeys": [
          chapterData.entityKey
        ]
      }
    });
  }*/

  // Manual SponsorBlock Skips

  if (configRead('sponsorBlockManualSkips').length > 0 && r?.playerOverlays?.playerOverlayRenderer) {
    const manualSkippedSegments = configRead('sponsorBlockManualSkips');
    let timelyActions = [];
    if (window?.sponsorblock?.segments) {
      for (const segment of window.sponsorblock.segments) {
        if (manualSkippedSegments.includes(segment.category)) {
          const timelyActionData = timelyAction(
            `Skip ${segment.category}`,
            'SKIP_NEXT',
            {
              clickTrackingParams: null,
              showEngagementPanelEndpoint: {
                customAction: {
                  action: 'SKIP',
                  parameters: {
                    time: segment.segment[1]
                  }
                }
              }
            },
            segment.segment[0] * 1000,
            segment.segment[1] * 1000 - segment.segment[0] * 1000
          );
          timelyActions.push(timelyActionData);
        }
      }
      r.playerOverlays.playerOverlayRenderer.timelyActionRenderers = timelyActions;
    }
  } else if (r?.playerOverlays?.playerOverlayRenderer) {
    r.playerOverlays.playerOverlayRenderer.timelyActionRenderers = [];
  }

  if (r?.transportControls?.transportControlsRenderer?.promotedActions && configRead('enableSponsorBlockHighlight')) {
    if (window?.sponsorblock?.segments) {
      const category = window.sponsorblock.segments.find(seg => seg.category === 'poi_highlight');
      if (category) {
        r.transportControls.transportControlsRenderer.promotedActions.push({
          type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPONSORBLOCK_HIGHLIGHT',
          button: {
            buttonRenderer: ButtonRenderer(
              false,
              'Skip to highlight',
              'SKIP_NEXT',
              {
                clickTrackingParams: null,
                customAction: {
                  action: 'SKIP',
                  parameters: {
                    time: category.segment[0]
                  }
                }
              })
          }
        });
      }
    }
  }

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


// FIX (Bug 1): Replaced for...of + splice with a reverse for-loop.
// The old for...of loop mutated the array while iterating — when an item was spliced out at
// index i, the item that was at i+1 shifted to i, but the iterator advanced to i+1, silently
// skipping it. This caused the Shorts shelf (and any shelf immediately after a removed one)
// to be missed. Iterating in reverse avoids all index-shift problems.
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
    const shelfAllText = collectAllText(shelve).join(' ').toLowerCase();
    appendFileOnlyLog('processShelves.item', {
      page: activePage,
      index: i,
      keys: shelve && typeof shelve === 'object' ? Object.keys(shelve).slice(0, 8) : typeof shelve,
      hasShelfRenderer: !!shelve?.shelfRenderer,
      hasReelShelfRenderer: !!shelve?.reelShelfRenderer,
      textPreview: shelfAllText.substring(0, 80)
    });

    if (!configRead('enableShorts') && isShortsShelf(shelve)) {
      appendFileOnlyLog('shorts.reelShelf.remove', {
        page: activePage,
        reason: 'is_shorts_shelf'
      });
      shelves.splice(i, 1);
      continue;
    }

    // Some channel surfaces include "Shorts" shelf-like rows under non-shelf renderers.
    if (!configRead('enableShorts') && !shelve?.shelfRenderer && /\bshorts?\b/i.test(shelfAllText)) {
      appendFileOnlyLog('shorts.genericShelf.remove', {
        page: activePage,
        index: i,
        keys: shelve && typeof shelve === 'object' ? Object.keys(shelve).slice(0, 8) : typeof shelve,
        textPreview: shelfAllText.substring(0, 120)
      });
      shelves.splice(i, 1);
      continue;
    }

    if (!shelve.shelfRenderer) continue;

    const shelfItems = getShelfItems(shelve);
    if (!Array.isArray(shelfItems)) continue;

    shelve.shelfRenderer.content.horizontalListRenderer.items = hideVideo(shelfItems, activePage);
    normalizeHorizontalListRenderer(shelve.shelfRenderer.content.horizontalListRenderer, `shelf:${activePage}:${i}`);
    if (activePage === 'library') {
      shelve.shelfRenderer.content.horizontalListRenderer.items = filterHiddenLibraryTabs(shelve.shelfRenderer.content.horizontalListRenderer.items, 'processShelves.shelfRenderer.horizontalListRenderer.items');
      normalizeHorizontalListRenderer(shelve.shelfRenderer.content.horizontalListRenderer, `shelf:${activePage}:${i}:library`);
    }
    if (!configRead('enableShorts')) {
      const shelfTitleDirect = String(shelve?.shelfRenderer?.title?.simpleText || '').toLowerCase();
      const shelfTitleFromHeader = collectAllText(shelve?.shelfRenderer?.header).join(' ').toLowerCase();
      const shelfTitle = shelfTitleDirect || shelfTitleFromHeader;
      appendFileOnlyLogOnce('shelf.title.' + shelfTitle.substring(0, 24), {
        page: activePage,
        rendererType: shelve?.shelfRenderer?.tvhtml5ShelfRendererType || '',
        direct: shelfTitleDirect, fromHeader: shelfTitleFromHeader.substring(0, 60)
      });
      if (isShortsShelf(shelve)) {
        appendFileOnlyLog('shorts.shelf.remove', {
          page: activePage,
          reason: 'is_shorts_shelf',
          shelfTitle: shelve?.shelfRenderer?.title || ''
        });
        // Safe to splice because we are iterating in reverse
        shelves.splice(i, 1);
        continue;
      }
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

function getGenericNodeProgress(item) {
  const entries = collectWatchProgressEntries(item);
  if (!entries.length) return null;
  const best = entries.reduce((max, entry) => Number(entry.percent) > Number(max.percent) ? entry : max, entries[0]);
  return { percentDurationWatched: Number(best.percent || 0), source: best.source || 'deep_scan' };
}


function addPreviews(items) {
  if (!configRead('enablePreviews')) return;
  for (const item of items) {
    if (item.tileRenderer) {
      const watchEndpoint = item.tileRenderer.onSelectCommand;
      if (item.tileRenderer?.onFocusCommand?.playbackEndpoint) continue;
      item.tileRenderer.onFocusCommand = {
        startInlinePlaybackCommand: {
          blockAdoption: true,
          caption: false,
          delayMs: 3000,
          durationMs: 40000,
          muted: false,
          restartPlaybackBeforeSeconds: 10,
          resumeVideo: true,
          playbackEndpoint: watchEndpoint
        }
      };
    }
  }
}

function getTileWatchProgress(item) {
  const overlays = item?.tileRenderer?.header?.tileHeaderRenderer?.thumbnailOverlays || [];
  const resumeOverlay = overlays.find((o) => o.thumbnailOverlayResumePlaybackRenderer)?.thumbnailOverlayResumePlaybackRenderer;
  if (resumeOverlay?.percentDurationWatched !== undefined) {
    return { percentDurationWatched: Number(resumeOverlay.percentDurationWatched || 0), source: 'tile_overlay_resume' };
  }

  const progressOverlay = overlays.find((o) => o.thumbnailOverlayPlaybackProgressRenderer)?.thumbnailOverlayPlaybackProgressRenderer;
  if (progressOverlay?.percentDurationWatched !== undefined) {
    return { percentDurationWatched: Number(progressOverlay.percentDurationWatched || 0), source: 'tile_overlay_playback_progress' };
  }

  const playedOverlay = overlays.find((o) => o.thumbnailOverlayPlaybackStatusRenderer)?.thumbnailOverlayPlaybackStatusRenderer;
  if (playedOverlay?.status === 'PLAYBACK_STATUS_PLAYED' || playedOverlay?.status === 'WATCHED') {
    return { percentDurationWatched: 100, source: 'tile_overlay_played_status' };
  }

  return null;
}

function isWatchedByTextSignals(item) {
  const text = collectAllText(item?.tileRenderer || item).join(' ').toLowerCase();
  if (!text) return false;
  return (
    text.includes('watched') ||
    text.includes('already watched') ||
    text.includes('gesehen') ||
    text.includes('bereits angesehen')
  );
}

function isLikelyPlaceholderItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.continuationItemRenderer || item.adSlotRenderer) return true;

  const keys = Object.keys(item);
  return keys.some((key) => /placeholder|skeleton/i.test(key));
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
  const shortsEnabled = !!configRead('enableShorts');

  appendFileOnlyLog('hideVideo.start', {
    pageName,
    threshold,
    configuredPages: pages,
    inputCount: Array.isArray(items) ? items.length : 0,
    enableHideWatchedVideos: hideWatchedEnabled,
    enableShorts: shortsEnabled
  });

  let removedShorts = 0;
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
      appendFileOnlyLog('hideVideo.item.error', {
        pageName,
        message: error?.message || String(error),
        stack: String(error?.stack || '').substring(0, 500),
        itemKeys: item && typeof item === 'object' ? Object.keys(item).slice(0, 10) : typeof item
      });
      return true;
    }
  });


  return result;
}
