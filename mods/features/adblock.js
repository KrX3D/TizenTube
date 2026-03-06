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

const origParse = JSON.parse;

function appendFileOnlyLog(label, payload) {
  if (!configRead('enableDebugLogging')) return;
  if (!Array.isArray(window.__ttFileOnlyLogs)) window.__ttFileOnlyLogs = [];

  let serialized = '';
  try { serialized = JSON.stringify(payload); } catch (_) { serialized = String(payload); }
  window.__ttFileOnlyLogs.push(`[${new Date().toISOString()}] [TT_ADBLOCK_FILE] ${label} ${serialized}`);
  if (window.__ttFileOnlyLogs.length > 5000) window.__ttFileOnlyLogs.shift();
}

function detectPageFromResponse(response) {
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

function detectPageFromBrowseId(browseId) {
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

JSON.parse = function () {
  const r = origParse.apply(this, arguments);
  const adBlockEnabled = configRead('enableAdBlock');
  const signinReminderEnabled = configRead('enableSigninReminder');
  const detectedPage = detectPageFromResponse(r);
  if (detectedPage) {
    window.__ttLastDetectedPage = detectedPage;
  }

  try {

  if (r.adPlacements && adBlockEnabled) {
    r.adPlacements = [];
  }

  // Also set playerAds to false, just incase.
  if (r.playerAds && adBlockEnabled) {
    r.playerAds = false;
  }

  // Also set adSlots to an empty array, emptying only the adPlacements won't work.
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

    processShelves(r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents, true, detectedPage);
  }

  if (r.endscreen && configRead('enableHideEndScreenCards')) {
    r.endscreen = null;
  }

  if (r.messages && Array.isArray(r.messages) && !configRead('enableYouThereRenderer')) {
    r.messages = r.messages.filter(
      (msg) => !msg?.youThereRenderer
    );
  }

  // Remove shorts ads
  if (!Array.isArray(r) && r?.entries && adBlockEnabled) {
    r.entries = r.entries?.filter(
      (elm) => !elm?.command?.reelWatchEndpoint?.adClientParams?.isAd
    );
  }

  // Patch settings

  if (r?.title?.runs) {
    PatchSettings(r);
  }

  // DeArrow Implementation. I think this is the best way to do it. (DOM manipulation would be a pain)

  if (r?.contents?.sectionListRenderer?.contents) {
    processShelves(r.contents.sectionListRenderer.contents, true, detectedPage);
  }

  if (r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.gridRenderer?.items) {
    const gridItems = r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.gridRenderer.items;
    r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.gridRenderer.items = hideVideo(gridItems);
  }

  if (r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.gridRenderer?.items) {
    const gridItems = r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.gridRenderer.items;
    r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.gridRenderer.items = hideVideo(gridItems);
  }

  if (r?.continuationContents?.sectionListContinuation?.contents) {
    processShelves(r.continuationContents.sectionListContinuation.contents, true, detectedPage);
  }

  if (r?.continuationContents?.horizontalListContinuation?.items) {
    deArrowify(r.continuationContents.horizontalListContinuation.items);
    hqify(r.continuationContents.horizontalListContinuation.items);
    addLongPress(r.continuationContents.horizontalListContinuation.items);
    r.continuationContents.horizontalListContinuation.items = hideVideo(r.continuationContents.horizontalListContinuation.items, detectedPage);
  }

  if (r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
    for (const section of r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections) {
      for (const tab of section.tvSecondaryNavSectionRenderer.tabs) {
        const tabBrowseId = tab?.tabRenderer?.endpoint?.browseEndpoint?.browseId;
        const tabPage = detectPageFromBrowseId(tabBrowseId);
        if (tabPage) {
          window.__ttLastDetectedPage = tabPage;
        }

        const tabSectionList = tab?.tabRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents;
        if (Array.isArray(tabSectionList)) {
          processShelves(tabSectionList, true, tabPage || detectedPage);
        }

        const tabGridItems = tab?.tabRenderer?.content?.tvSurfaceContentRenderer?.content?.gridRenderer?.items;
        if (Array.isArray(tabGridItems)) {
          tab.tabRenderer.content.tvSurfaceContentRenderer.content.gridRenderer.items = hideVideo(tabGridItems, tabPage || detectedPage);
        }
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
    if (!window.__ttAdblockParseWarned) {
      window.__ttAdblockParseWarned = true;
      console.warn('[TizenTube] adblock parser patch failed', error);
    }
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
  for (let index = shelves.length - 1; index >= 0; index--) {
    const shelve = shelves[index];
    if (shelve.shelfRenderer) {
      deArrowify(shelve.shelfRenderer.content.horizontalListRenderer.items);
      hqify(shelve.shelfRenderer.content.horizontalListRenderer.items);
      addLongPress(shelve.shelfRenderer.content.horizontalListRenderer.items);
      if (shouldAddPreviews) {
        addPreviews(shelve.shelfRenderer.content.horizontalListRenderer.items);
      }
      shelve.shelfRenderer.content.horizontalListRenderer.items = hideVideo(shelve.shelfRenderer.content.horizontalListRenderer.items, pageHint);
      if (!configRead('enableShorts')) {
        if (shelve.shelfRenderer.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS') {
          shelves.splice(index, 1);
          continue;
        }
        shelve.shelfRenderer.content.horizontalListRenderer.items = shelve.shelfRenderer.content.horizontalListRenderer.items.filter(item => item.tileRenderer?.tvhtml5ShelfRendererType !== 'TVHTML5_TILE_RENDERER_TYPE_SHORTS');
      }

      if (!shelve.shelfRenderer.content.horizontalListRenderer.items.length) {
        shelves.splice(index, 1);
      }
    }
  }
}

function getWatchProgress(item) {
  const overlays = item.tileRenderer?.header?.tileHeaderRenderer?.thumbnailOverlays || [];
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

  return null;
}

function getGenericNodeProgress(node, depth = 0, seen = new WeakSet()) {
  if (!node || depth > 7) return null;
  if (typeof node !== 'object') return null;
  if (seen.has(node)) return null;
  seen.add(node);

  const direct = Number(node.watchProgressPercentage ?? node.percentDurationWatched ?? node.watchedPercent);
  if (Number.isFinite(direct)) {
    return direct;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      const childProgress = getGenericNodeProgress(child, depth + 1, seen);
      if (childProgress !== null) return childProgress;
    }
    return null;
  }

  for (const key of Object.keys(node)) {
    const childProgress = getGenericNodeProgress(node[key], depth + 1, seen);
    if (childProgress !== null) return childProgress;
  }

  return null;
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

function processTileArraysDeep(node, pageHint = null, path = 'root', depth = 0) {
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

function hideVideo(items, pageHint = null) {
  return items.filter(item => {
    try {
      const pages = configRead('hideWatchedVideosPages');
      const hashPage = detectCurrentPage();
      const pageName = pageHint || ((hashPage === 'home' || hashPage === 'search')
        ? (window.__ttLastDetectedPage || hashPage)
        : hashPage);
      if (!pages.includes(pageName)) return true;

      let percentWatched = null;

      if (item?.tileRenderer) {
        percentWatched = getWatchProgress(item);
      } else {
        percentWatched = getGenericNodeProgress(item);
      }

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
