import { configRead } from '../config.js';
import Chapters from '../ui/chapters.js';
import resolveCommand from '../resolveCommand.js';
import { timelyAction, longPressData, MenuServiceItemRenderer, ShelfRenderer, TileRenderer, ButtonRenderer } from '../ui/ytUI.js';
import { PatchSettings } from '../ui/customYTSettings.js';

const PLAYLIST_PAGES = new Set(['playlist', 'playlists']);
const BROWSE_PAGE_RULES = [
  { type: 'includes', value: 'fesubscription', page: 'subscriptions' },
  { type: 'includes', value: 'fesubscriptions', page: 'subscriptions' },
  { type: 'exact', value: 'felibrary', page: 'library' },
  { type: 'exact', value: 'fehistory', page: 'history' },
  { type: 'exact', value: 'femy_youtube', page: 'playlist' },
  { type: 'exact', value: 'feplaylist_aggregation', page: 'playlists' },
  { type: 'prefix', value: 'vlpl', page: 'playlist' },
  { type: 'exact', value: 'vlwl', page: 'playlist' },
  { type: 'exact', value: 'vlll', page: 'playlist' },
  { type: 'includes', value: 'fetopics_music', page: 'music' },
  { type: 'includes', value: 'music', page: 'music' },
  { type: 'includes', value: 'fetopics_gaming', page: 'gaming' },
  { type: 'includes', value: 'gaming', page: 'gaming' },
  { type: 'includes', value: 'fetopics', page: 'home' },
  { type: 'prefix', value: 'uc', page: 'channel', minLength: 11 }
];

function isPlaylistPage(page) {
  return PLAYLIST_PAGES.has(page);
}

function shouldHideWatchedForPage(page) {
  if (!configRead('enableHideWatchedVideos')) return false;
  const pages = configRead('hideWatchedVideosPages') || [];
  if (!Array.isArray(pages) || pages.length === 0) return true;
  return pages.includes(page);
}

function shouldRunUniversalFilter(page) {
  const shortsEnabled = configRead('enableShorts');
  if (!shortsEnabled) return true;
  return shouldHideWatchedForPage(page);
}

function resolveBrowseParamPage(browseParam) {
  if (!browseParam) return null;

  for (const rule of BROWSE_PAGE_RULES) {
    if (rule.type === 'exact' && browseParam === rule.value) return rule.page;
    if (rule.type === 'prefix' && browseParam.startsWith(rule.value) && (!rule.minLength || browseParam.length >= rule.minLength)) return rule.page;
    if (rule.type === 'includes' && browseParam.includes(rule.value)) return rule.page;
  }

  return null;
}

function getShelfTitle(shelf) {
  return (
    shelf?.shelfRenderer?.title?.runs?.[0]?.text ||
    shelf?.shelfRenderer?.title?.simpleText ||
    shelf?.richShelfRenderer?.title?.runs?.[0]?.text ||
    shelf?.richShelfRenderer?.title?.simpleText ||
    shelf?.richSectionRenderer?.content?.richShelfRenderer?.title?.runs?.[0]?.text ||
    shelf?.richSectionRenderer?.content?.richShelfRenderer?.title?.simpleText ||
    ''
  );
}

function hideShorts(shelves, shortsEnabled, onRemoveShelf) {
  if (shortsEnabled || !Array.isArray(shelves)) return;

  for (let i = shelves.length - 1; i >= 0; i--) {
    const shelf = shelves[i];
    if (!shelf) continue;

    const isShortShelf = getShelfTitle(shelf).toLowerCase().includes('short') ||
      shelf?.shelfRenderer?.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS';

    if (isShortShelf) {
      onRemoveShelf?.(shelf);
      shelves.splice(i, 1);
      continue;
    }

    const horizontalItems = shelf?.shelfRenderer?.content?.horizontalListRenderer?.items;
    if (Array.isArray(horizontalItems)) {
      shelf.shelfRenderer.content.horizontalListRenderer.items = horizontalItems.filter(
        (item) => !isShortItem(item)
      );
    }

    const richItems = shelf?.richShelfRenderer?.content?.richGridRenderer?.contents;
    if (Array.isArray(richItems)) {
      shelf.richShelfRenderer.content.richGridRenderer.contents = richItems.filter(
        (item) => !isShortItem(item)
      );
    }
  }
}

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
JSON.parse = function () {
  const r = origParse.apply(this, arguments);
  const adBlockEnabled = configRead('enableAdBlock');
  const signinReminderEnabled = configRead('enableSigninReminder');

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

    processShelves(r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents);
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

  if (r?.contents?.singleColumnBrowseResultsRenderer?.tabs) {
    const page = getCurrentPage();
    scanAndFilterAllArrays(r.contents.singleColumnBrowseResultsRenderer, page);
  }

  // DeArrow Implementation. I think this is the best way to do it. (DOM manipulation would be a pain)

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
  }

  if (r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
    for (const section of r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections) {
      for (const tab of section.tvSecondaryNavSectionRenderer.tabs) {
        processShelves(tab.tabRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents);
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

  const currentPage = getCurrentPage();
  if (shouldRunUniversalFilter(currentPage) && !r.__universalFilterApplied) {
    r.__universalFilterApplied = true;
    scanAndFilterAllArrays(r, currentPage);
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
  hideShorts(shelves, configRead('enableShorts'));
  for (const shelve of shelves) {
    const items = shelve?.shelfRenderer?.content?.horizontalListRenderer?.items;
    if (!Array.isArray(items)) continue;

    deArrowify(items);
    hqify(items);
    addLongPress(items);
    if (shouldAddPreviews) {
      addPreviews(items);
    }
    shelve.shelfRenderer.content.horizontalListRenderer.items = hideVideo(items);
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
  const currentPage = getCurrentPage();
  return directFilterArray(items, currentPage, 'processShelves');
}

function isShortItem(item) {
  if (!item) return false;

  if (item.reelItemRenderer || item.richItemRenderer?.content?.reelItemRenderer) {
    return true;
  }

  const renderer =
    item.tileRenderer ||
    item.videoRenderer ||
    item.playlistVideoRenderer ||
    item.gridVideoRenderer ||
    item.compactVideoRenderer ||
    item.richItemRenderer?.content?.videoRenderer ||
    null;

  if (!renderer) return false;

  if (renderer.tvhtml5ShelfRendererType === 'TVHTML5_TILE_RENDERER_TYPE_SHORTS') {
    return true;
  }

  const overlays =
    renderer.thumbnailOverlays ||
    renderer.header?.tileHeaderRenderer?.thumbnailOverlays ||
    renderer.thumbnail?.thumbnailOverlays ||
    [];

  if (Array.isArray(overlays)) {
    const styleOverlay = overlays.find((overlay) => {
      const style = overlay?.thumbnailOverlayTimeStatusRenderer?.style;
      return style === 'SHORTS' || style === 'SHORTS_TIME_STATUS_STYLE';
    });
    if (styleOverlay) return true;
  }

  let lengthText = null;
  const timeOverlay = Array.isArray(overlays)
    ? overlays.find((overlay) => overlay.thumbnailOverlayTimeStatusRenderer)
    : null;
  if (timeOverlay) {
    lengthText = timeOverlay.thumbnailOverlayTimeStatusRenderer.text?.simpleText;
  }

  if (!lengthText) {
    lengthText = renderer.lengthText?.simpleText || renderer.lengthText?.runs?.[0]?.text || null;
  }

  if (!lengthText) {
    lengthText = renderer.metadata?.tileMetadataRenderer?.lines?.[0]?.lineRenderer?.items?.find(
      (lineItem) => lineItem.lineItemRenderer?.badge || lineItem.lineItemRenderer?.text?.simpleText
    )?.lineItemRenderer?.text?.simpleText;
  }

  if (!lengthText) return false;

  const durationMatch = String(lengthText).trim().match(/^(\d+):(\d+)$/);
  if (!durationMatch) return false;

  const totalSeconds = (parseInt(durationMatch[1], 10) * 60) + parseInt(durationMatch[2], 10);
  return totalSeconds <= 180;
}

function getVideoId(item) {
  return item?.tileRenderer?.contentId ||
    item?.videoRenderer?.videoId ||
    item?.playlistVideoRenderer?.videoId ||
    item?.gridVideoRenderer?.videoId ||
    item?.compactVideoRenderer?.videoId ||
    item?.richItemRenderer?.content?.videoRenderer?.videoId ||
    null;
}

function directFilterArray(arr, page, context = '') {
  if (!Array.isArray(arr) || arr.length === 0) return arr;

  const shortsEnabled = configRead('enableShorts');
  const threshold = Number(configRead('hideWatchedVideosThreshold') || 0);
  const shouldHideWatched = shouldHideWatchedForPage(page);
  const playlistPage = isPlaylistPage(page);

  if (!window._playlistScrollHelpers) {
    window._playlistScrollHelpers = new Set();
  }
  if (!window._lastHelperVideos) {
    window._lastHelperVideos = [];
  }

  let isLastBatch = false;
  if (playlistPage && window._isLastPlaylistBatch === true) {
    isLastBatch = true;
    window._isLastPlaylistBatch = false;
  }

  const filtered = arr.filter(item => {
    if (!item) return true;

    if (!shortsEnabled && isShortItem(item)) {
      return false;
    }

    if (shouldHideWatched) {
      const progressBar = findProgressBar(item);
      const percentWatched = progressBar ? Number(progressBar.percentDurationWatched || 0) : 0;
      if (percentWatched >= threshold) {
        return false;
      }
    }
    return true;
  });

  if (playlistPage && filtered.length === 0 && arr.length > 0 && !isLastBatch) {
    const lastVideo = [...arr].reverse().find((item) => !!getVideoId(item)) || arr[arr.length - 1];
    const lastVideoId = getVideoId(lastVideo) || 'unknown';
    window._lastHelperVideos = [lastVideo];
    window._playlistScrollHelpers.clear();
    window._playlistScrollHelpers.add(lastVideoId);
    return [lastVideo];
  }

  if (isLastBatch && playlistPage) {
    window._lastHelperVideos = [];
    window._playlistScrollHelpers.clear();
  }

  return filtered;
}

function scanAndFilterAllArrays(obj, page, path = 'root') {
  if (!obj || typeof obj !== 'object') return;

  if (Array.isArray(obj) && obj.length > 0) {
    const hasVideoItems = obj.some(item =>
      item?.tileRenderer ||
      item?.videoRenderer ||
      item?.gridVideoRenderer ||
      item?.compactVideoRenderer ||
      item?.richItemRenderer?.content?.videoRenderer
    );

    if (hasVideoItems) {
      return directFilterArray(obj, page, path);
    }

    const hasShelves = obj.some(item =>
      item?.shelfRenderer ||
      item?.richShelfRenderer ||
      item?.gridRenderer
    );

    if (hasShelves) {
      hideShorts(obj, configRead('enableShorts'));

      for (let i = obj.length - 1; i >= 0; i--) {
        const shelf = obj[i];
        if (!shelf) {
          obj.splice(i, 1);
          continue;
        }
        scanAndFilterAllArrays(shelf, page, `${path}[${i}]`);

        const horizontalItems = shelf?.shelfRenderer?.content?.horizontalListRenderer?.items;
        const gridItems = shelf?.shelfRenderer?.content?.gridRenderer?.items;
        const richItems = shelf?.richShelfRenderer?.content?.richGridRenderer?.contents;
        const hasItems =
          (Array.isArray(horizontalItems) && horizontalItems.length > 0) ||
          (Array.isArray(gridItems) && gridItems.length > 0) ||
          (Array.isArray(richItems) && richItems.length > 0);

        if (!hasItems && (shelf?.shelfRenderer || shelf?.richShelfRenderer || shelf?.gridRenderer)) {
          obj.splice(i, 1);
        }
      }
      return;
    }
  }

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = obj[key];

      if (Array.isArray(value)) {
        const filtered = scanAndFilterAllArrays(value, page, `${path}.${key}`);
        if (filtered) {
          obj[key] = filtered;
        }
      } else if (value && typeof value === 'object') {
        scanAndFilterAllArrays(value, page, `${path}.${key}`);
      }
    }
  }
}

function findProgressBar(item) {
  if (!item) return null;

  const checkRenderer = (renderer) => {
    if (!renderer) return null;

    const overlayPaths = [
      renderer.thumbnailOverlays,
      renderer.header?.tileHeaderRenderer?.thumbnailOverlays,
      renderer.thumbnail?.thumbnailOverlays,
      renderer.thumbnailOverlayRenderer,
      renderer.overlay,
      renderer.overlays
    ];

    for (const overlays of overlayPaths) {
      if (!overlays) continue;
      if (Array.isArray(overlays)) {
        const progressOverlay = overlays.find(o => o?.thumbnailOverlayResumePlaybackRenderer);
        if (progressOverlay) {
          return progressOverlay.thumbnailOverlayResumePlaybackRenderer;
        }
      } else if (overlays.thumbnailOverlayResumePlaybackRenderer) {
        return overlays.thumbnailOverlayResumePlaybackRenderer;
      }
    }
    return null;
  };

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

  return null;
}

function getCurrentPage() {
  const hash = location.hash ? location.hash.substring(1) : '';
  const path = location.pathname || '';
  const search = location.search || '';
  const href = location.href || '';

  const cleanHash = hash.split('?additionalDataUrl')[0];

  let browseParam = '';
  const cMatch = hash.match(/[?&]c=([^&]+)/i);
  if (cMatch) {
    browseParam = cMatch[1].toLowerCase();
  }

  const browseIdMatch = hash.match(/\/browse\/([^?&#]+)/i);
  if (browseIdMatch) {
    const browseId = browseIdMatch[1].toLowerCase();
    if (!browseParam) browseParam = browseId;
  }

  const combined = (cleanHash + ' ' + path + ' ' + search + ' ' + href + ' ' + browseParam).toLowerCase();
  let detectedPage = 'other';

  const mappedBrowsePage = resolveBrowseParamPage(browseParam);
  if (mappedBrowsePage) {
    detectedPage = mappedBrowsePage;
  }

  if (detectedPage === 'other' && (cleanHash.includes('/playlist') || combined.includes('list='))) {
    detectedPage = 'playlist';
  }
  else if (detectedPage === 'other' && (cleanHash.includes('/results') || cleanHash.includes('/search'))) {
    detectedPage = 'search';
  }
  else if (detectedPage === 'other' && cleanHash.includes('/watch')) {
    detectedPage = 'watch';
  }
  else if (detectedPage === 'other' && (cleanHash.includes('/@') || cleanHash.includes('/channel/'))) {
    detectedPage = 'channel';
  }
  else if (detectedPage === 'other' && cleanHash.includes('/browse') && !browseParam) {
    detectedPage = 'home';
  }
  else if (detectedPage === 'other' && (cleanHash === '' || cleanHash === '/')) {
    detectedPage = 'home';
  }

  return detectedPage;
}
