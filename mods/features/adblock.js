import { configRead } from '../config.js';
import Chapters from '../ui/chapters.js';
import resolveCommand from '../resolveCommand.js';
import { timelyAction, longPressData, MenuServiceItemRenderer, ShelfRenderer, TileRenderer, ButtonRenderer } from '../ui/ytUI.js';
import { PatchSettings } from '../ui/customYTSettings.js';

/**
 * This is a minimal reimplementation of the following uBlock Origin rule:
 * https://github.com/uBlockOrigin/uAssets/blob/3497eebd440f4871830b9b45af0afc406c6eb593/filters/filters.txt#L116
 *
 * This in turn calls the following snippet:
 * https://github.com/gorhill/uBlock/blob/bfdc81e9e400f7b78b2abc97576c3d7bf3a11a0b/assets/resources/scriptlets.js#L365-L470
 *
 * Seems like for now dropping just the adPlacements is enough for YouTube TV
 */

const HIDDEN_LIBRARY_TAB_IDS = new Set([
  'femusic_last_played',
  'festorefront',
  'fecollection_podcasts',
  'femy_videos'
]);

function getConfiguredHiddenLibraryTabIds() {
  const configured = configRead('hiddenLibraryTabIds');
  if (!Array.isArray(configured) || configured.length === 0) return HIDDEN_LIBRARY_TAB_IDS;
  return new Set(configured.map((id) => String(id || '').toLowerCase()).filter(Boolean));
}

const LIBRARY_PAGE_BROWSE_IDS = new Set([
  'felibrary',
  'femy_youtube',
  'fehistory',
  'feplaylist_aggregation',
  'femusic_last_played',
  'festorefront',
  'fecollection_podcasts',
  'femy_videos'
]);

function logLibraryDebug(label, payload) {
  if (!configRead('enableDebugLogging')) return;
  try {
    console.info(`[LibraryTabs] ${label}`, payload);
  } catch (_) { }
}

function isHiddenLibraryBrowseId(value) {
  const id = String(value || '').toLowerCase();
  if (!id) return false;
  for (const hiddenId of getConfiguredHiddenLibraryTabIds()) {
    if (id === hiddenId || id.includes(hiddenId)) return true;
  }
  return false;
}

const LIBRARY_TAB_TITLE_BY_BROWSE_ID = {
  fehistory: ['history'],
  femy_youtube: ['watch later'],
  feplaylist_aggregation: ['playlists'],
  femusic_last_played: ['music'],
  festorefront: ['movies', 'shows', 'tv'],
  fecollection_podcasts: ['podcasts'],
  femy_videos: ['my videos', 'your videos']
};

function collectTextDeep(node, out = [], depth = 0) {
  if (!node || depth > 6) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) {
    for (const child of node) collectTextDeep(child, out, depth + 1);
    return out;
  }
  if (typeof node !== 'object') return out;
  if (typeof node.simpleText === 'string') out.push(node.simpleText);
  if (Array.isArray(node.runs)) {
    for (const run of node.runs) {
      if (typeof run?.text === 'string') out.push(run.text);
    }
  }
  for (const key of Object.keys(node)) {
    if (key === 'runs' || key === 'simpleText') continue;
    collectTextDeep(node[key], out, depth + 1);
  }
  return out;
}

function isHiddenLibraryTabByTitle(tab) {
  const configured = getConfiguredHiddenLibraryTabIds();
  if (!configured.size) return false;
  const title = collectTextDeep(tab?.tabRenderer?.title).join(' ').toLowerCase().trim();
  if (!title) return false;
  for (const hiddenId of configured) {
    const titleTokens = LIBRARY_TAB_TITLE_BY_BROWSE_ID[hiddenId] || [];
    if (titleTokens.some((token) => title.includes(token))) return true;
  }
  return false;
}

function extractBrowseIdsDeep(node, out = new Set(), depth = 0) {
  if (!node || depth > 10) return out;
  if (Array.isArray(node)) {
    for (const child of node) extractBrowseIdsDeep(child, out, depth + 1);
    return out;
  }
  if (typeof node !== 'object') return out;

  const directCandidates = [
    node?.navigationEndpoint?.browseEndpoint?.browseId,
    node?.browseEndpoint?.browseId,
    node?.endpoint?.browseEndpoint?.browseId,
    node?.onSelectCommand?.browseEndpoint?.browseId,
    node?.browseId,
    node?.tabIdentifier,
    node?.tabRenderer?.tabIdentifier,
    node?.targetId,
    node?.url,
    node?.canonicalBaseUrl,
    node?.webCommandMetadata?.url,
    node?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate !== 'string' || !candidate) continue;
    out.add(candidate);

    const feMatches = candidate.match(/fe[a-z0-9_]+/gi) || [];
    for (const match of feMatches) out.add(match);

    const vlMatches = candidate.match(/vl[a-z0-9_]+/gi) || [];
    for (const match of vlMatches) out.add(match);
  }

  for (const key of Object.keys(node)) {
    extractBrowseIdsDeep(node[key], out, depth + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Core library filtering logic — shared between JSON.parse and XHR patches
// ---------------------------------------------------------------------------

function filterLibraryNavTabs(sections, detectedPage) {
  if (detectedPage !== 'library') return;
  if (!Array.isArray(sections)) return;
  for (const section of sections) {
    const tabs = section?.tvSecondaryNavSectionRenderer?.tabs;
    if (!Array.isArray(tabs)) continue;
    const before = tabs.length;
    for (let i = tabs.length - 1; i >= 0; i--) {
      const browseIds = Array.from(extractBrowseIdsDeep(tabs[i])).map((id) => String(id).toLowerCase());
      const hideByBrowseId = browseIds.some((id) => isHiddenLibraryBrowseId(id));
      const hideByTitle = isHiddenLibraryTabByTitle(tabs[i]);
      logLibraryDebug('filterLibraryNavTabs.tab', { index: i, browseIds, hideByBrowseId, hideByTitle });
      if (hideByBrowseId || hideByTitle) tabs.splice(i, 1);
    }
    logLibraryDebug('filterLibraryNavTabs.result', { before, after: tabs.length });
  }
}

function filterLibrarySectionListContents(contents, detectedPage) {
  if (detectedPage !== 'library') return;
  if (!Array.isArray(contents)) return;
  const before = contents.length;
  for (let i = contents.length - 1; i >= 0; i--) {
    const item = contents[i];
    const browseIds = Array.from(extractBrowseIdsDeep(item)).map((id) => String(id).toLowerCase());
    const hideByBrowseId = browseIds.some((id) => isHiddenLibraryBrowseId(id));
    const hideByTitle = isHiddenLibraryTabByTitle(item);
    const shelfTitle = collectTextDeep(item?.shelfRenderer?.title).join(' ').toLowerCase();
    const hideByShelfTitle = [...getConfiguredHiddenLibraryTabIds()].some((hiddenId) => {
      const tokens = LIBRARY_TAB_TITLE_BY_BROWSE_ID[hiddenId] || [];
      return tokens.some((token) => shelfTitle.includes(token));
    });
    if (hideByBrowseId || hideByTitle || hideByShelfTitle) {
      contents.splice(i, 1);
    }
  }
  if (before !== contents.length) {
    logLibraryDebug('filterLibrarySectionListContents.done', { before, after: contents.length });
  }
}

function filterHiddenLibraryTabs(items, context = '') {
  if (!Array.isArray(items)) return items;
  const before = items.length;
  const filtered = items.filter((item) => {
    const browseIds = Array.from(extractBrowseIdsDeep(item)).map((v) => String(v).toLowerCase());
    if (browseIds.some((id) => isHiddenLibraryBrowseId(id))) return false;
    const contentId = String(item?.tileRenderer?.contentId || '').toLowerCase();
    if (isHiddenLibraryBrowseId(contentId)) return false;
    return !isHiddenLibraryTabByTitle(item);
  });
  if (before !== filtered.length) {
    logLibraryDebug('filterHiddenLibraryTabs', { context, before, after: filtered.length });
  }
  return filtered;
}

function pruneLibraryTabsInResponse(node, path = 'root') {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    const before = node.length;
    for (let i = node.length - 1; i >= 0; i--) {
      const browseIds = Array.from(extractBrowseIdsDeep(node[i])).map((v) => String(v).toLowerCase());
      const hideByBrowseId = browseIds.some((id) => isHiddenLibraryBrowseId(id));
      const hideByTitle = isHiddenLibraryTabByTitle(node[i]);
      if (hideByBrowseId || hideByTitle) node.splice(i, 1);
    }
    if (before !== node.length) {
      logLibraryDebug('pruneLibraryTabsInResponse.array', { path, before, after: node.length });
    }
    for (let i = 0; i < node.length; i++) {
      pruneLibraryTabsInResponse(node[i], `${path}[${i}]`);
    }
    return;
  }
  if (Array.isArray(node?.horizontalListRenderer?.items)) {
    node.horizontalListRenderer.items = filterHiddenLibraryTabs(
      node.horizontalListRenderer.items, `${path}.horizontalListRenderer.items`
    );
  }
  for (const key of Object.keys(node)) {
    pruneLibraryTabsInResponse(node[key], `${path}.${key}`);
  }
}

function processTileArraysDeep(node, path = 'root', depth = 0) {
  if (!node || depth > 10) return;
  if (Array.isArray(node)) {
    if (node.some((item) => item?.tileRenderer)) {
      const before = node.length;
      const filtered = filterHiddenLibraryTabs(node, `deep:${path}`);
      if (before !== filtered.length) {
        node.splice(0, node.length, ...filtered);
        logLibraryDebug('processTileArraysDeep.filtered', { path, before, after: node.length });
      }
      return;
    }
    for (let i = 0; i < node.length; i++) processTileArraysDeep(node[i], `${path}[${i}]`, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  for (const key of Object.keys(node)) processTileArraysDeep(node[key], `${path}.${key}`, depth + 1);
}

// ---------------------------------------------------------------------------
// Apply all library filtering to a parsed response object
// ---------------------------------------------------------------------------
function applyLibraryFiltering(r, detectedPage) {
  if (detectedPage !== 'library') return;

  // tvSecondaryNavRenderer path (main branch TVs)
  if (r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
    filterLibraryNavTabs(r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections, detectedPage);
  }

  // tvSurfaceContentRenderer → sectionListRenderer path (this TV)
  if (r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents) {
    filterLibrarySectionListContents(
      r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents,
      detectedPage
    );
  }

  // continuation items
  if (Array.isArray(r?.continuationContents?.horizontalListContinuation?.items)) {
    r.continuationContents.horizontalListContinuation.items = filterHiddenLibraryTabs(
      r.continuationContents.horizontalListContinuation.items, 'continuation.horizontal'
    );
  }

  // deep prune + tile scan
  pruneLibraryTabsInResponse(r, 'response');
  processTileArraysDeep(r, 'response');
}

// ---------------------------------------------------------------------------
// XHR interception — patch at the network level so the framework NEVER sees
// the unfiltered library response, even if it bypasses our JSON.parse patch.
// ---------------------------------------------------------------------------
function isBrowseLibraryUrl(url) {
  if (!url) return false;
  const s = String(url);
  return s.includes('/youtubei/') && s.includes('browse') && (
    s.includes('FElibrary') || s.includes('felibrary')
  );
}

function isLibraryResponseData(data) {
  if (!data) return false;
  // Quick string check before parsing
  return String(data).includes('FElibrary') || String(data).includes('felibrary');
}

function patchResponseText(text) {
  if (!isLibraryResponseData(text)) return text;
  try {
    const parsed = JSON.parse(text);
    applyLibraryFiltering(parsed, 'library');
    const result = JSON.stringify(parsed);
    logLibraryDebug('xhr.patch.done', { originalLen: text.length, newLen: result.length });
    return result;
  } catch (e) {
    logLibraryDebug('xhr.patch.error', { message: String(e?.message || e) });
    return text;
  }
}

// Patch XHR
(function patchXHR() {
  const OrigXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new OrigXHR(...arguments);
    let _responseText = undefined;
    let _response = undefined;
    let patched = false;

    function tryPatch() {
      if (patched) return;
      patched = true;
      try {
        const raw = OrigXHR.prototype.responseText
          ? Object.getOwnPropertyDescriptor(OrigXHR.prototype, 'responseText')?.get?.call(xhr)
          : xhr.responseText;
        if (typeof raw === 'string' && raw.length > 0) {
          _responseText = patchResponseText(raw);
          _response = _responseText;
        }
      } catch (_) { }
    }

    xhr.addEventListener('readystatechange', function () {
      if (xhr.readyState === 4) tryPatch();
    });

    xhr.addEventListener('load', function () {
      tryPatch();
    });

    return new Proxy(xhr, {
      get(target, prop) {
        if (prop === 'responseText' && _responseText !== undefined) return _responseText;
        if (prop === 'response' && _response !== undefined) return _response;
        const val = target[prop];
        return typeof val === 'function' ? val.bind(target) : val;
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      }
    });
  }
  PatchedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;
  logLibraryDebug('xhr.patch.installed', {});
})();

// Patch fetch
(function patchFetch() {
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      // Clone and check if it's a browse/library response
      const clone = response.clone();
      const text = await clone.text();
      if (!isLibraryResponseData(text)) return response;

      const patched = patchResponseText(text);
      logLibraryDebug('fetch.patch.applied', { url: String(url).substring(0, 80) });

      // Return a new Response with the patched body
      return new Response(patched, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    } catch (e) {
      logLibraryDebug('fetch.patch.error', { message: String(e?.message || e) });
      return response;
    }
  };
  logLibraryDebug('fetch.patch.installed', {});
})();


// ---------------------------------------------------------------------------
// Page detection
// ---------------------------------------------------------------------------

function isLibraryPageNow() {
  const hash = location.hash || '';
  if (hash.includes('/library')) return true;
  const cParam = (hash.match(/[?&]c=([^&]+)/i)?.[1] || '').toLowerCase();
  return LIBRARY_PAGE_BROWSE_IDS.has(cParam);
}

function detectPageFromResponse(response) {
  const targetId = String(response?.contents?.tvBrowseRenderer?.targetId || '').toLowerCase();
  if ([...LIBRARY_PAGE_BROWSE_IDS].some((id) => targetId.includes(id))) return 'library';
  const serviceTracking = response?.responseContext?.serviceTrackingParams;
  if (!Array.isArray(serviceTracking)) return null;
  for (const entry of serviceTracking) {
    const params = entry?.params;
    if (!Array.isArray(params)) continue;
    for (const param of params) {
      if (param?.key === 'browse_id') {
        const browseId = String(param?.value || '').toLowerCase();
        if (LIBRARY_PAGE_BROWSE_IDS.has(browseId)) return 'library';
      }
    }
  }
  return null;
}

function processBrowseResponseArrayPayload(payload, detectedPage) {
  if (!payload || typeof payload !== 'object') return;
  if (detectedPage === 'library') applyLibraryFiltering(payload, detectedPage);
}

// ---------------------------------------------------------------------------
// JSON.parse patch (kept as a second line of defence)
// ---------------------------------------------------------------------------

const origParse = JSON.parse;
JSON.parse = function () {
  const r = origParse.apply(this, arguments);
  const adBlockEnabled = configRead('enableAdBlock');
  const signinReminderEnabled = configRead('enableSigninReminder');

  const detectedPage = detectPageFromResponse(r) || (isLibraryPageNow() ? 'library' : '');
  window.__ttLastDetectedPage = detectedPage || window.__ttLastDetectedPage;

  if (Array.isArray(r)) {
    for (const payload of r) {
      processBrowseResponseArrayPayload(payload, detectedPage);
    }
    return r;
  }

  if (r.adPlacements && adBlockEnabled) {
    r.adPlacements = [];
  }

  if (r.playerAds && adBlockEnabled) {
    r.playerAds = false;
  }

  if (r.adSlots && adBlockEnabled) {
    r.adSlots = [];
  }

  if (r.paidContentOverlay && !configRead('enablePaidPromotionOverlay')) {
    r.paidContentOverlay = null;
  }

  if (r?.streamingData?.adaptiveFormats && configRead('videoPreferredCodec') !== 'any') {
    const preferredCodec = configRead('videoPreferredCodec');
    const hasPreferredCodec = r.streamingData.adaptiveFormats.find(format => format.mimeType.includes(preferredCodec));
    if (hasPreferredCodec) {
      r.streamingData.adaptiveFormats = r.streamingData.adaptiveFormats.filter(format => {
        if (format.mimeType.startsWith('audio/')) return true;
        return format.mimeType.includes(preferredCodec);
      });
    }
  }

  // Drop "masthead" ad from home screen
  if (
    r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content
      ?.sectionListRenderer?.contents
  ) {
    if (!signinReminderEnabled) {
      r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents =
        r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents.filter(
          (elm) => !elm.feedNudgeRenderer
        );
    }

    if (adBlockEnabled) {
      r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents =
        r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents.filter(
          (elm) => !elm.adSlotRenderer
        );

      for (const shelve of r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents) {
        if (shelve.shelfRenderer) {
          shelve.shelfRenderer.content.horizontalListRenderer.items =
            shelve.shelfRenderer.content.horizontalListRenderer.items.filter(
              (item) => !item.adSlotRenderer
            );
        }
      }
    }

    filterLibrarySectionListContents(
      r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents,
      detectedPage
    );

    processShelves(r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents);
  }

  if (detectedPage === 'library') {
    applyLibraryFiltering(r, detectedPage);
  }

  if (r.endscreen && configRead('enableHideEndScreenCards')) {
    r.endscreen = null;
  }

  if (r.messages && Array.isArray(r.messages) && !configRead('enableYouThereRenderer')) {
    r.messages = r.messages.filter(
      (msg) => !msg?.youThereRenderer
    );
  }

  if (!Array.isArray(r) && r?.entries && adBlockEnabled) {
    r.entries = r.entries?.filter(
      (elm) => !elm?.command?.reelWatchEndpoint?.adClientParams?.isAd
    );
  }

  if (r?.title?.runs) {
    PatchSettings(r);
  }

  if (r?.contents?.sectionListRenderer?.contents) {
    processShelves(r.contents.sectionListRenderer.contents);
  }

  if (r?.continuationContents?.sectionListContinuation?.contents) {
    processShelves(r.continuationContents.sectionListContinuation.contents);
  }

  if (r?.continuationContents?.horizontalListContinuation?.items) {
    deArrowify(r.continuationContents.horizontalListContinuation.items);
    hqify(r.continuationContents.horizontalListContinuation.items);
    addLongPress(r.continuationContents.horizontalListContinuation.items);
    r.continuationContents.horizontalListContinuation.items = hideVideo(r.continuationContents.horizontalListContinuation.items);
    if (detectedPage === 'library') {
      r.continuationContents.horizontalListContinuation.items = filterHiddenLibraryTabs(
        r.continuationContents.horizontalListContinuation.items,
        'continuationContents.horizontalListContinuation'
      );
    }
  }

  if (r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
    if (detectedPage === 'library') {
      filterLibraryNavTabs(r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections, detectedPage);
    }

    for (const section of r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections) {
      const tabs = section?.tvSecondaryNavSectionRenderer?.tabs;
      if (!Array.isArray(tabs)) continue;
      for (const tab of tabs) {
        const contents = tab?.tabRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents;
        if (Array.isArray(contents)) processShelves(contents);
      }
    }
  }

  if (r?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer) {
    if (!signinReminderEnabled) {
      r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents =
        r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents.filter(
          (elm) => !elm.alertWithActionsRenderer
        );
    }
    processShelves(r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents, false);
    if (window.queuedVideos.videos.length > 0) {
      const queuedVideosClone = window.queuedVideos.videos.slice();
      queuedVideosClone.unshift(TileRenderer(
        'Clear Queue',
        { customAction: { action: 'CLEAR_QUEUE' } }
      ));
      r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents.unshift(ShelfRenderer(
        'Queued Videos',
        queuedVideosClone,
        queuedVideosClone.findIndex(v => v.contentId === window.queuedVideos.lastVideoId) !== -1 ?
          queuedVideosClone.findIndex(v => v.contentId === window.queuedVideos.lastVideoId) : 0
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
        "visibleOnLoadKeys": [chapterData.entityKey],
        "entityKeys": [chapterData.entityKey]
      }
    });
  }*/

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
                  parameters: { time: segment.segment[1] }
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
                  parameters: { time: category.segment[0] }
                }
              })
          }
        });
      }
    }
  }

  return r;
};

// Patch JSON.parse to use the custom one
window.JSON.parse = JSON.parse;
for (const key in window._yttv) {
  if (window._yttv[key] && window._yttv[key].JSON && window._yttv[key].JSON.parse) {
    window._yttv[key].JSON.parse = JSON.parse;
  }
}


function processShelves(shelves, shouldAddPreviews = true) {
  for (const shelve of shelves) {
    if (shelve.shelfRenderer) {
      deArrowify(shelve.shelfRenderer.content.horizontalListRenderer.items);
      hqify(shelve.shelfRenderer.content.horizontalListRenderer.items);
      addLongPress(shelve.shelfRenderer.content.horizontalListRenderer.items);
      if (shouldAddPreviews) {
        addPreviews(shelve.shelfRenderer.content.horizontalListRenderer.items);
      }
      shelve.shelfRenderer.content.horizontalListRenderer.items = hideVideo(shelve.shelfRenderer.content.horizontalListRenderer.items);
      if (!configRead('enableShorts')) {
        if (shelve.shelfRenderer.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS') {
          shelves.splice(shelves.indexOf(shelve), 1);
          continue;
        }
        shelve.shelfRenderer.content.horizontalListRenderer.items = shelve.shelfRenderer.content.horizontalListRenderer.items.filter(item => item.tileRenderer?.tvhtml5ShelfRendererType !== 'TVHTML5_TILE_RENDERER_TYPE_SHORTS');
      }
    }
  }
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

function deArrowify(items) {
  for (const item of items) {
    if (item.adSlotRenderer) {
      const index = items.indexOf(item);
      items.splice(index, 1);
      continue;
    }
    if (!item.tileRenderer) continue;
    if (configRead('enableDeArrow')) {
      const videoID = item.tileRenderer.contentId;
      fetch(`https://sponsor.ajay.app/api/branding?videoID=${videoID}`).then(res => res.json()).then(data => {
        if (data.titles.length > 0) {
          const mostVoted = data.titles.reduce((max, title) => max.votes > title.votes ? max : title);
          item.tileRenderer.metadata.tileMetadataRenderer.title.simpleText = mostVoted.title;
        }
        if (data.thumbnails.length > 0 && configRead('enableDeArrowThumbnails')) {
          const mostVotedThumbnail = data.thumbnails.reduce((max, thumbnail) => max.votes > thumbnail.votes ? max : thumbnail);
          if (mostVotedThumbnail.timestamp) {
            item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails = [
              {
                url: `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${videoID}&time=${mostVotedThumbnail.timestamp}`,
                width: 1280,
                height: 640
              }
            ]
          }
        }
      }).catch(() => { });
    }
  }
}

function hqify(items) {
  for (const item of items) {
    if (!item.tileRenderer) continue;
    if (item.tileRenderer.style !== 'TILE_STYLE_YTLR_DEFAULT') continue;
    if (configRead('enableHqThumbnails')) {
      const videoID = item.tileRenderer.onSelectCommand.watchEndpoint.videoId;
      const queryArgs = item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails[0].url.split('?')[1];
      item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails = [
        {
          url: `https://i.ytimg.com/vi/${videoID}/sddefault.jpg${queryArgs ? `?${queryArgs}` : ''}`,
          width: 640,
          height: 480
        }
      ];
    }
  }
}

function addLongPress(items) {
  for (const item of items) {
    if (!item.tileRenderer) continue;
    if (item.tileRenderer.style !== 'TILE_STYLE_YTLR_DEFAULT') continue;
    if (item.tileRenderer.onLongPressCommand) {
      item.tileRenderer.onLongPressCommand.showMenuCommand.menu.menuRenderer.items.push(MenuServiceItemRenderer('Add to Queue', {
        clickTrackingParams: null,
        playlistEditEndpoint: {
          customAction: {
            action: 'ADD_TO_QUEUE',
            parameters: item
          }
        }
      }));
      continue;
    }
    if (!configRead('enableLongPress')) continue;
    const subtitle = item.tileRenderer.metadata.tileMetadataRenderer.lines[0].lineRenderer.items[0].lineItemRenderer.text;
    const data = longPressData({
      videoId: item.tileRenderer.contentId,
      thumbnails: item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails,
      title: item.tileRenderer.metadata.tileMetadataRenderer.title.simpleText,
      subtitle: subtitle.runs ? subtitle.runs[0].text : subtitle.simpleText,
      watchEndpointData: item.tileRenderer.onSelectCommand.watchEndpoint,
      item
    });
    item.tileRenderer.onLongPressCommand = data;
  }
}

function hideVideo(items) {
  return items.filter(item => {
    if (!item.tileRenderer) return true;

    const hash = location.hash.substring(1);
    const pageName =
      hash === '/' ? 'home'
      : hash.startsWith('/search') ? 'search'
      : (hash.includes('?') && hash.includes('c=')
          ? (hash.split('?')[1].split('&').find(p => p.startsWith('c=')) || 'c=').split('=')[1].replace('FE', '').replace('topics_', '')
          : '');

    const contentId = String(item?.tileRenderer?.contentId || '').toLowerCase();
    if (pageName === 'library' && isHiddenLibraryBrowseId(contentId)) return false;

    const progressBar = item.tileRenderer.header?.tileHeaderRenderer?.thumbnailOverlays
      ?.find(overlay => overlay.thumbnailOverlayResumePlaybackRenderer)
      ?.thumbnailOverlayResumePlaybackRenderer;
    if (!progressBar) return true;

    const pages = configRead('hideWatchedVideosPages');
    if (!pages.includes(pageName)) return true;

    const percentWatched = (progressBar.percentDurationWatched || 0);
    return percentWatched <= configRead('hideWatchedVideosThreshold');
  });
}
