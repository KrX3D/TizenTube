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

function isHiddenLibraryBrowseId(value) {
  const id = String(value || '').toLowerCase();
  if (!id) return false;
  for (const hiddenId of getConfiguredHiddenLibraryTabIds()) {
    if (id === hiddenId || id.includes(hiddenId)) return true;
  }
  return false;
}

function extractBrowseIdsDeep(node, out = new Set(), depth = 0) {
  if (!node || depth > 8) return out;

  if (Array.isArray(node)) {
    for (const child of node) extractBrowseIdsDeep(child, out, depth + 1);
    return out;
  }
  if (typeof node !== 'object') return out;

  const browseId =
    node?.navigationEndpoint?.browseEndpoint?.browseId ||
    node?.browseEndpoint?.browseId ||
    node?.endpoint?.browseEndpoint?.browseId ||
    node?.onSelectCommand?.browseEndpoint?.browseId;

  if (browseId) out.add(String(browseId));

  for (const key of Object.keys(node)) {
    extractBrowseIdsDeep(node[key], out, depth + 1);
  }

  return out;
}

function filterLibraryNavTabs(sections) {
  if (!Array.isArray(sections)) return;
  for (const section of sections) {
    const tabs = section?.tvSecondaryNavSectionRenderer?.tabs;
    if (!Array.isArray(tabs)) continue;

    for (let i = tabs.length - 1; i >= 0; i--) {
      const browseIds = Array.from(extractBrowseIdsDeep(tabs[i])).map((id) => String(id).toLowerCase());
      if (browseIds.some((id) => isHiddenLibraryBrowseId(id))) {
        tabs.splice(i, 1);
      }
    }
  }
}

function filterHiddenLibraryTabs(items) {
  if (!Array.isArray(items)) return items;
  return items.filter((item) => {
    const browseIds = Array.from(extractBrowseIdsDeep(item)).map((v) => String(v).toLowerCase());
    return !browseIds.some((id) => isHiddenLibraryBrowseId(id));
  });
}

function pruneLibraryTabsInResponse(node) {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      const browseIds = Array.from(extractBrowseIdsDeep(node[i])).map((v) => String(v).toLowerCase());
      if (browseIds.some((id) => isHiddenLibraryBrowseId(id))) {
        node.splice(i, 1);
      } else {
        pruneLibraryTabsInResponse(node[i]);
      }
    }
    return;
  }

  if (Array.isArray(node?.horizontalListRenderer?.items)) {
    node.horizontalListRenderer.items = filterHiddenLibraryTabs(node.horizontalListRenderer.items);
  }

  for (const key of Object.keys(node)) {
    pruneLibraryTabsInResponse(node[key]);
  }
}

function isLibraryPageNow() {
  const hash = location.hash || '';
  return hash.includes('c=FElibrary') || hash.includes('/library');
}

function isLibraryResponse(response) {
  const targetId = String(response?.contents?.tvBrowseRenderer?.targetId || '').toLowerCase();
  if (targetId.includes('felibrary')) return true;

  const serviceTracking = response?.responseContext?.serviceTrackingParams;
  if (!Array.isArray(serviceTracking)) return false;

  for (const entry of serviceTracking) {
    const params = entry?.params;
    if (!Array.isArray(params)) continue;
    for (const param of params) {
      if (param?.key === 'browse_id' && String(param?.value || '').toLowerCase().includes('felibrary')) {
        return true;
      }
    }
  }

  return false;
}

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

  const isLibraryContext = isLibraryPageNow() || isLibraryResponse(r);

  if (r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
    const isLibraryPage = isLibraryContext;

    if (isLibraryPage) {
      filterLibraryNavTabs(r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections);
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

  if (isLibraryContext) {
    pruneLibraryTabsInResponse(r);
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
