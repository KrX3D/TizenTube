import { configRead } from '../config.js';
import Chapters from '../ui/chapters.js';
import resolveCommand from '../resolveCommand.js';
import { timelyAction, longPressData, MenuServiceItemRenderer, ShelfRenderer, TileRenderer, ButtonRenderer } from '../ui/ytUI.js';
import { PatchSettings } from '../ui/customYTSettings.js';

const PLAYLIST_PAGES = new Set(['playlist', 'playlists']);
const BROWSE_PAGE_RULES = [
  { type: 'includes', value: 'fesubscription', page: 'subscriptions' },
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

function debugFilterLog(...args) {
  if (!configRead('enableDebugConsole')) return;
  console.log('[TT_FILTER]', ...args);
}

function isPlaylistPage(page) {
  return PLAYLIST_PAGES.has(page);
}

function shouldHideWatchedForPage(page) {
  if (!configRead('enableHideWatchedVideos')) return false;
  const pages = configRead('hideWatchedVideosPages') || [];
  if (!Array.isArray(pages) || pages.length === 0) return true;

  const normalizedPage = String(page || '').toLowerCase();
  const normalizedPages = pages.map((entry) => String(entry || '').toLowerCase());
  if (normalizedPages.includes(normalizedPage)) return true;

  if (normalizedPage === 'channel' && normalizedPages.includes('channels')) return true;
  if (normalizedPage === 'channels' && normalizedPages.includes('channel')) return true;
  if (normalizedPage === 'subscriptions' && normalizedPages.includes('subscription')) return true;
  if (normalizedPage === 'subscription' && normalizedPages.includes('subscriptions')) return true;

  // Keep channel/subscriptions watched filtering active for legacy configs.
  if (normalizedPage === 'channel' || normalizedPage === 'subscriptions') return true;

  return false;
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
  const candidates = [
    shelf?.shelfRenderer?.title?.runs?.[0]?.text,
    shelf?.shelfRenderer?.title?.simpleText,
    shelf?.richShelfRenderer?.title?.runs?.[0]?.text,
    shelf?.richShelfRenderer?.title?.simpleText,
    shelf?.richSectionRenderer?.content?.richShelfRenderer?.title?.runs?.[0]?.text,
    shelf?.richSectionRenderer?.content?.richShelfRenderer?.title?.simpleText,
    shelf?.tvSecondaryNavItemRenderer?.title?.runs?.[0]?.text,
    shelf?.tvSecondaryNavItemRenderer?.title?.simpleText,
    shelf?.title?.runs?.[0]?.text,
    shelf?.title?.simpleText
  ];

  for (const raw of candidates) {
    const title = String(raw || '').trim();
    if (!title || title === ':') continue;
    return title;
  }

  return '';
}

function normalizeShelfTitle(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isShortsShelfTitle(title) {
  const t = normalizeShelfTitle(title);
  if (!t) return false;
  return t === 'shorts' || t === 'short' || t === 'shorts videos' || /^shorts\b/.test(t) || /\bshorts$/.test(t);
}

function getItemTitle(item) {
  return item?.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText ||
    item?.videoRenderer?.title?.runs?.[0]?.text ||
    item?.videoRenderer?.title?.simpleText ||
    item?.playlistVideoRenderer?.title?.runs?.[0]?.text ||
    item?.playlistVideoRenderer?.title?.simpleText ||
    item?.gridVideoRenderer?.title?.runs?.[0]?.text ||
    item?.gridVideoRenderer?.title?.simpleText ||
    item?.compactVideoRenderer?.title?.runs?.[0]?.text ||
    item?.compactVideoRenderer?.title?.simpleText ||
    item?.richItemRenderer?.content?.videoRenderer?.title?.runs?.[0]?.text ||
    item?.richItemRenderer?.content?.videoRenderer?.title?.simpleText ||
    'unknown';
}

function parseDurationToSeconds(lengthText) {
  const parts = String(lengthText).trim().split(':').map((p) => Number(p));
  if (parts.some((p) => Number.isNaN(p))) return null;
  if (parts.length === 2) return (parts[0] * 60) + parts[1];
  if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  return null;
}

function hideShorts(shelves, shortsEnabled, onRemoveShelf) {
  if (shortsEnabled || !Array.isArray(shelves)) return;

  for (let i = shelves.length - 1; i >= 0; i--) {
    const shelf = shelves[i];
    if (!shelf) continue;

    const shelfTitle = getShelfTitle(shelf);
    const normalizedShelfTitle = normalizeShelfTitle(shelfTitle);

    const horizontalItems = shelf?.shelfRenderer?.content?.horizontalListRenderer?.items;
    const gridItems = shelf?.shelfRenderer?.content?.gridRenderer?.items;
    const richItems = shelf?.richShelfRenderer?.content?.richGridRenderer?.contents;
    const previewItems = horizontalItems || gridItems || richItems || [];
    let shortLikeCount = 0;
    if (Array.isArray(previewItems) && previewItems.length > 0) {
      shortLikeCount = previewItems.slice(0, 12).filter((item) => getShortInfo(item, { currentPage: getCurrentPage() }).isShort).length;
    }

    const isShortShelf = isShortsShelfTitle(shelfTitle) ||
      shelf?.shelfRenderer?.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS' ||
      (Array.isArray(previewItems) && previewItems.length > 0 && shortLikeCount >= Math.max(1, Math.floor(previewItems.length * 0.8)));

    if (isShortShelf) {
      debugFilterLog('hideShorts remove shelf', {
        page: getCurrentPage(),
        title: shelfTitle,
        normalizedShelfTitle,
        shortLikeCount,
        type: shelf?.shelfRenderer?.tvhtml5ShelfRendererType || shelf?.richShelfRenderer?.tvhtml5ShelfRendererType || 'unknown'
      });
      onRemoveShelf?.(shelf);
      shelves.splice(i, 1);
      continue;
    }

    const filterList = (items) => {
      if (!Array.isArray(items)) return items;
      const before = items.length;
      const removedTitles = [];
      const filtered = items.filter((item) => {
        const shortInfo = getShortInfo(item, { currentPage: getCurrentPage() });
        if (shortInfo.isShort) {
          if (removedTitles.length < 6) removedTitles.push(getItemTitle(item));
          return false;
        }
        return true;
      });
      if (before !== filtered.length) {
        debugFilterLog('hideShorts shelf summary', { page: getCurrentPage(), shelfTitle, before, after: filtered.length, removed: before - filtered.length, sampleTitles: removedTitles });
      }
      items.splice(0, items.length, ...filtered);
      return items;
    };

    if (Array.isArray(horizontalItems)) {
      shelf.shelfRenderer.content.horizontalListRenderer.items = filterList(horizontalItems);
    }

    if (Array.isArray(gridItems)) {
      shelf.shelfRenderer.content.gridRenderer.items = filterList(gridItems);
    }

    if (Array.isArray(richItems)) {
      shelf.richShelfRenderer.content.richGridRenderer.contents = filterList(richItems);
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

  // Handle singleColumnBrowseResultsRenderer (alternative playlist format)
  if (r?.contents?.singleColumnBrowseResultsRenderer?.tabs) {
    const page = getCurrentPage();
    
    // Scan and filter ALL arrays
    scanAndFilterAllArrays(r.contents.singleColumnBrowseResultsRenderer, page);
  }

  // UNIVERSAL FALLBACK - use configured watched-pages (and shorts when disabled)
  const currentPage = getCurrentPage();

  if (shouldRunUniversalFilter(currentPage) && !r.__universalFilterApplied) {
    r.__universalFilterApplied = true;

    // Scan the ENTIRE response object and filter ALL video arrays
    scanAndFilterAllArrays(r, currentPage);
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
    const lists = [
      {
        items: shelve?.shelfRenderer?.content?.horizontalListRenderer?.items,
        apply: (filtered) => {
          shelve.shelfRenderer.content.horizontalListRenderer.items = filtered;
        }
      },
      {
        items: shelve?.shelfRenderer?.content?.gridRenderer?.items,
        apply: (filtered) => {
          shelve.shelfRenderer.content.gridRenderer.items = filtered;
        }
      },
      {
        items: shelve?.richShelfRenderer?.content?.richGridRenderer?.contents,
        apply: (filtered) => {
          shelve.richShelfRenderer.content.richGridRenderer.contents = filtered;
        }
      }
    ];

    for (const list of lists) {
      const items = list.items;
      if (!Array.isArray(items)) continue;

      deArrowify(items);
      hqify(items);
      addLongPress(items);
      if (shouldAddPreviews) {
        addPreviews(items);
      }
      list.apply(hideVideo(items));
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

function getShortInfo(item, { currentPage = '' } = {}) {
  const title = getItemTitle(item);
  if (!item) return { isShort: false, reason: 'no_item', title: 'unknown' };

  const renderer = item.tileRenderer ||
    item.videoRenderer ||
    item.playlistVideoRenderer ||
    item.playlistPanelVideoRenderer ||
    item.gridVideoRenderer ||
    item.compactVideoRenderer ||
    item.richItemRenderer?.content?.videoRenderer ||
    item.richItemRenderer?.content?.playlistVideoRenderer;

  if (!renderer) {
    if (item.reelItemRenderer || item.richItemRenderer?.content?.reelItemRenderer) {
      return { isShort: true, reason: 'reel', title };
    }
    return { isShort: false, reason: 'no_renderer', title };
  }

  if (renderer.tvhtml5ShelfRendererType === 'TVHTML5_TILE_RENDERER_TYPE_SHORTS') {
    return { isShort: true, reason: 'renderer_type', title };
  }

  let lengthText = null;
  const thumbnailOverlays = renderer.header?.tileHeaderRenderer?.thumbnailOverlays || renderer.thumbnailOverlays;
  if (thumbnailOverlays && Array.isArray(thumbnailOverlays)) {
    const shortsStyleOverlay = thumbnailOverlays.find((overlay) => {
      const style = overlay?.thumbnailOverlayTimeStatusRenderer?.style;
      return style === 'SHORTS' || style === 'SHORTS_TIME_STATUS_STYLE';
    });
    if (shortsStyleOverlay) {
      return { isShort: true, reason: 'overlay_style', title };
    }

    const timeOverlay = thumbnailOverlays.find((overlay) => overlay.thumbnailOverlayTimeStatusRenderer);
    if (timeOverlay) {
      lengthText = timeOverlay.thumbnailOverlayTimeStatusRenderer.text?.simpleText;
    }
  }

  if (!lengthText) {
    lengthText = renderer.lengthText?.simpleText || renderer.lengthText?.runs?.[0]?.text;
  }

  if (!lengthText) {
    lengthText = renderer.metadata?.tileMetadataRenderer?.lines?.[0]?.lineRenderer?.items?.find(
      (lineItem) => lineItem.lineItemRenderer?.badge || lineItem.lineItemRenderer?.text?.simpleText
    )?.lineItemRenderer?.text?.simpleText;
  }

  if (!lengthText) {
    return { isShort: false, reason: 'no_length', title };
  }

  const totalSeconds = parseDurationToSeconds(lengthText);
  if (totalSeconds === null) {
    return { isShort: false, reason: 'length_format_miss', title, lengthText };
  }
  const isShort = totalSeconds <= 180;
  return { isShort, reason: isShort ? 'duration' : 'long_duration', title, lengthText, totalSeconds };
}

function isShortItem(item, { currentPage = '' } = {}) {
  const info = getShortInfo(item, { currentPage });
  return info.isShort;
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

function getItemKey(item) {
  const id = getVideoId(item);
  const title = getItemTitle(item);
  return `${id || 'noid'}|${title || 'notitle'}`;
}

function directFilterArray(arr, page, context = '') {
  if (!Array.isArray(arr) || arr.length === 0) return arr;

  const shortsEnabled = configRead('enableShorts');
  const threshold = Number(configRead('hideWatchedVideosThreshold') || 0);
  const shouldHideWatched = shouldHideWatchedForPage(page);
  const playlistPage = isPlaylistPage(page);

  // ⭐ Initialize scroll helpers tracker
  if (!window._playlistScrollHelpers) {
    window._playlistScrollHelpers = new Set();
  }
  if (!window._lastHelperVideos) {
    window._lastHelperVideos = [];
  }

  // ⭐ NEW: Check if this is the LAST batch (using flag from response level)
  let isLastBatch = false;
  if (playlistPage && window._isLastPlaylistBatch === true) {
    isLastBatch = true;
    // Clear the flag
    window._isLastPlaylistBatch = false;
  }

  let removedShorts = 0;
  let removedWatched = 0;
  const removedShortTitles = [];
  const removedWatchedTitles = [];
  if (!window._ttRemovedItemKeysByPage) window._ttRemovedItemKeysByPage = {};
  if (!window._ttRemovedItemKeysByPage[page]) window._ttRemovedItemKeysByPage[page] = new Set();
  const removedKeys = window._ttRemovedItemKeysByPage[page];
  if (!window._ttRemovedVideoIdsByPage) window._ttRemovedVideoIdsByPage = {};
  if (!window._ttRemovedVideoIdsByPage[page]) window._ttRemovedVideoIdsByPage[page] = new Set();
  const removedVideoIds = window._ttRemovedVideoIdsByPage[page];
  let watchedChecked = 0;
  let watchedWithProgress = 0;
  const watchedNoProgressTitles = [];
  const filtered = arr.filter(item => {
    try {
      if (!item) return true;

      const key = getItemKey(item);
      const videoId = getVideoId(item);
      if (removedKeys.has(key)) {
        return false;
      }
      if (videoId && removedVideoIds.has(videoId)) {
        return false;
      }

      const shortInfo = getShortInfo(item, { currentPage: page || getCurrentPage() });

      if (!shortsEnabled && shortInfo.isShort) {
        removedShorts++;
        removedKeys.add(key);
        if (videoId) removedVideoIds.add(videoId);
        if (removedShortTitles.length < 8) removedShortTitles.push(shortInfo.title);
        return false;
      }

      // ⭐ Removed watched on channels, subscriptions and watch page
      if (shouldHideWatched) {
        watchedChecked++;
        const progressBar = findProgressBar(item);
        if (progressBar) watchedWithProgress++;
        else if (watchedNoProgressTitles.length < 6) watchedNoProgressTitles.push(getItemTitle(item));

        // Calculate progress percentage
        const percentWatched = progressBar ? Number(progressBar.percentDurationWatched || 0) : 0;

        // Hide if watched above threshold
        if (percentWatched >= threshold) {
          removedWatched++;
          removedKeys.add(key);
          if (videoId) removedVideoIds.add(videoId);
          if (removedWatchedTitles.length < 8) removedWatchedTitles.push(getItemTitle(item));
          return false;
        }
      }
      return true;
    } catch (err) {
      debugFilterLog('directFilterArray item error', { page, context, error: String(err) });
      return true;
    }
  });

  if ((page === 'subscriptions' || page === 'channel') && (removedShorts > 0 || removedWatched > 0 || (page === 'channel' && shouldHideWatched))) {
    debugFilterLog('directFilterArray', {
      page,
      context,
      input: arr.length,
      output: filtered.length,
      removedShorts,
      removedWatched,
      sampleRemovedShortTitles: removedShortTitles,
      sampleRemovedWatchedTitles: removedWatchedTitles,
      watchedChecked,
      watchedWithProgress,
      sampleWatchedNoProgressTitles: watchedNoProgressTitles,
      shouldHideWatched,
      threshold,
      shortsEnabled
    });
  }


  // PLAYLIST SAFEGUARD: keep one helper tile so TV can request next batch.
  if (playlistPage && filtered.length === 0 && arr.length > 0 && !isLastBatch) {
    
    const lastVideo = [...arr].reverse().find((item) => !!getVideoId(item)) || arr[arr.length - 1];
    const lastVideoId = getVideoId(lastVideo) || 'unknown';
    window._lastHelperVideos = [lastVideo];
    window._playlistScrollHelpers.clear();
    window._playlistScrollHelpers.add(lastVideoId);
    arr.splice(0, arr.length, lastVideo);
    return arr;
  }

  // ⭐ Clean up after filtering if last batch
  if (isLastBatch && playlistPage) {
    window._lastHelperVideos = [];
    window._playlistScrollHelpers.clear();
  }

  arr.splice(0, arr.length, ...filtered);
  return arr;
}

function scanAndFilterAllArrays(obj, page, path = 'root') {
  if (!obj || typeof obj !== 'object') return;
  
  // If this is an array with video items, filter it
  if (Array.isArray(obj) && obj.length > 0) {
    // Check if it looks like a video items array
    const hasVideoItems = obj.some(item => 
      item?.tileRenderer || 
      item?.videoRenderer || 
      item?.playlistVideoRenderer ||
      item?.playlistPanelVideoRenderer ||
      item?.gridVideoRenderer ||
      item?.compactVideoRenderer ||
      item?.richItemRenderer?.content?.videoRenderer ||
      item?.richItemRenderer?.content?.playlistVideoRenderer ||
      item?.reelItemRenderer ||
      item?.richItemRenderer?.content?.reelItemRenderer
    );
    
    if (hasVideoItems) {
      return directFilterArray(obj, page, path);
    }
    
    // Check if this is a shelves array - remove empty shelves after filtering
    const hasShelves = obj.some(item =>
      item?.shelfRenderer ||
      item?.richShelfRenderer ||
      item?.gridRenderer
    );
    
    if (hasShelves) {
      hideShorts(obj, configRead('enableShorts'));

      // Filter shelves recursively
      for (let i = obj.length - 1; i >= 0; i--) {
        const shelf = obj[i];
        if (!shelf) {
          obj.splice(i, 1);
          continue;
        }
        scanAndFilterAllArrays(shelf, page, path + '[' + i + ']');

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
      return; // Don't return the array, we modified it in place
    }
  }

  // Recursively scan object properties
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = obj[key];
      
      if (Array.isArray(value)) {
        // Filter this array
        const filtered = scanAndFilterAllArrays(value, page, path + '.' + key);
        if (filtered) {
          obj[key] = filtered;
        }
      } else if (value && typeof value === 'object') {
        // Recurse into objects
        scanAndFilterAllArrays(value, page, path + '.' + key);
      }
    }
  }
}

function findProgressBar(item) {
  if (!item) return null;
  
  const checkRenderer = (renderer) => {
    if (!renderer) return null;
    
    // Comprehensive overlay paths
    const overlayPaths = [
      // Standard paths (Tizen 6.5)
      renderer.thumbnailOverlays,
      renderer.header?.tileHeaderRenderer?.thumbnailOverlays,
      renderer.thumbnail?.thumbnailOverlays,
      
      // Alternative paths (Tizen 5.0)
      renderer.thumbnailOverlayRenderer,
      renderer.overlay,
      renderer.overlays
    ];
    
    for (const overlays of overlayPaths) {
      if (!overlays) continue;
      
      // Handle array
      if (Array.isArray(overlays)) {
        const progressOverlay = overlays.find(o => 
          o?.thumbnailOverlayResumePlaybackRenderer
        );
        if (progressOverlay) {
          return progressOverlay.thumbnailOverlayResumePlaybackRenderer;
        }
      } 
      // Handle direct object
      else if (overlays.thumbnailOverlayResumePlaybackRenderer) {
        return overlays.thumbnailOverlayResumePlaybackRenderer;
      }
    }
    return null;
  };
  
  // Check all renderer types
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

  // Fallback: recursively search for any object carrying percentDurationWatched.
  const stack = [item];
  const seen = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);

    if (typeof node.percentDurationWatched === 'number') {
      return node;
    }

    const parsedPercent = Number(node.percentDurationWatched);
    if (Number.isFinite(parsedPercent) && parsedPercent >= 0) {
      return { percentDurationWatched: parsedPercent };
    }

    if (Array.isArray(node)) {
      for (const entry of node) stack.push(entry);
      continue;
    }

    for (const key of Object.keys(node)) {
      stack.push(node[key]);
    }
  }
  
  return null;
}

function getCurrentPage() {
  const hash = location.hash ? location.hash.substring(1) : '';
  const path = location.pathname || '';
  const search = location.search || '';
  const href = location.href || '';
  
  const cleanHash = hash.split('?additionalDataUrl')[0];
  
  // Extract browse parameters
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
  
  // PRIORITY 1: Check browse parameters (Tizen TV uses these!)
  const mappedBrowsePage = resolveBrowseParamPage(browseParam);
  if (mappedBrowsePage) {
    detectedPage = mappedBrowsePage;
  }
  
  // PRIORITY 2: Check traditional patterns
  if (detectedPage === 'other' && (cleanHash.includes('/subscriptions') || combined.includes('subscription'))) {
    detectedPage = 'subscriptions';
  }
  else if (detectedPage === 'other' && cleanHash.includes('/playlist')) {
    detectedPage = 'playlist';
  }
  else if (detectedPage === 'other' && (cleanHash.includes('/results') || cleanHash.includes('/search'))) {
    detectedPage = 'search';
  }
  else if (detectedPage === 'other' && cleanHash.includes('/watch')) {
    detectedPage = 'watch';
  }
  else if (detectedPage === 'other' && (cleanHash.includes('/@') || cleanHash.includes('/channel/') || combined.includes('/channel/'))) {
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
