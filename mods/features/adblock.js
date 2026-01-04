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
JSON.parse = function () {
  const r = origParse.apply(this, arguments);
  const adBlockEnabled = configRead('enableAdBlock');

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

  if (r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
    for (const section of r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections) {
      for (const tab of section.tvSecondaryNavSectionRenderer.tabs) {
        processShelves(tab.tabRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents);
      }
    }
  }

  if (r?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer) {
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
    // the common shelfRenderer path (existing behavior)
    if (shelve.shelfRenderer) {
      // try to operate on horizontal list items and also on grid renderer items (some pages use grid)
      const hor = shelve.shelfRenderer.content?.horizontalListRenderer?.items;
      const grid = shelve.shelfRenderer.content?.gridRenderer?.items;
      const richGrid = shelve.richShelfRenderer?.content?.richGridRenderer?.contents;

      if (hor && hor.length) {
        deArrowify(hor);
        hqify(hor);
        addLongPress(hor);
        if (shouldAddPreviews) addPreviews(hor);
        shelve.shelfRenderer.content.horizontalListRenderer.items = hideVideo(hor);
      }

      if (grid && grid.length) {
        deArrowify(grid);
        hqify(grid);
        addLongPress(grid);
        if (shouldAddPreviews) addPreviews(grid);
        shelve.shelfRenderer.content.gridRenderer.items = hideVideo(grid);
      }

      if (richGrid && richGrid.length) {
        // richGridRenderer contents may contain tile-like objects; normalize and hide as well
        deArrowify(richGrid);
        hqify(richGrid);
        addLongPress(richGrid);
        if (shouldAddPreviews) addPreviews(richGrid);
        shelve.richShelfRenderer = shelve.richShelfRenderer || {};
        shelve.richShelfRenderer.content = shelve.richShelfRenderer.content || {};
        shelve.richShelfRenderer.content.richGridRenderer = shelve.richShelfRenderer.content.richGridRenderer || {};
        shelve.richShelfRenderer.content.richGridRenderer.contents = hideVideo(richGrid);
      }

      // keep the old shorts handling
      if (!configRead('enableShorts')) {
        if (shelve.shelfRenderer.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS') {
          shelves.splice(shelves.indexOf(shelve), 1);
          continue;
        }
        shelve.shelfRenderer.content.horizontalListRenderer.items =
          shelve.shelfRenderer.content.horizontalListRenderer.items.filter(item => item.tileRenderer?.tvhtml5ShelfRendererType !== 'TVHTML5_TILE_RENDERER_TYPE_SHORTS');
      }
    } else {
      // Some shelves may come in different shapes — attempt to detect and sanitize common sublists
      // (This gives defensive coverage for subscription / special pages.)
      try {
        const maybeLists = [];
        if (shelve?.richShelfRenderer?.content?.richGridRenderer?.contents) {
          maybeLists.push(shelve.richShelfRenderer.content.richGridRenderer.contents);
        }
        if (shelve?.sectionListRenderer?.contents) {
          // dive into deeper contents if present
          for (const c of shelve.sectionListRenderer.contents) {
            if (c?.shelfRenderer?.content?.horizontalListRenderer?.items) {
              maybeLists.push(c.shelfRenderer.content.horizontalListRenderer.items);
            }
            if (c?.shelfRenderer?.content?.gridRenderer?.items) {
              maybeLists.push(c.shelfRenderer.content.gridRenderer.items);
            }
          }
        }
        for (const list of maybeLists) {
          if (!list || !Array.isArray(list)) continue;
          deArrowify(list);
          hqify(list);
          addLongPress(list);
          if (shouldAddPreviews) addPreviews(list);
          // apply hiding in-place (if it's an array reference in the JSON, the caller already references it)
          const filtered = hideVideo(list);
          // mutate original array: clear and push filtered back to the original reference
          list.splice(0, list.length, ...filtered);
        }
      } catch (e) {
        // ignore defensive attempts
        console.warn('processShelves: defensive handling failed', e);
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
  // returns filtered items (keeps items that should be shown)
  if (!Array.isArray(items)) return items;

  // helper: attempt to detect resume/progress object in multiple renderer shapes
  function findProgressBar(item) {
    // common shapes where resume progress exists
    const tryPaths = [
      item?.tileRenderer?.header?.tileHeaderRenderer?.thumbnailOverlays,
      item?.playlistVideoRenderer?.thumbnailOverlays,
      item?.compactVideoRenderer?.thumbnailOverlays,
      item?.gridVideoRenderer?.thumbnailOverlays,
      item?.videoRenderer?.thumbnailOverlays
    ];
    for (const arr of tryPaths) {
      if (!Array.isArray(arr)) continue;
      const found = arr.find(o => o && o.thumbnailOverlayResumePlaybackRenderer);
      if (found && found.thumbnailOverlayResumePlaybackRenderer) return found.thumbnailOverlayResumePlaybackRenderer;
    }
    // as a last resort, search any thumbnailOverlays property anywhere on the object
    for (const key of Object.keys(item)) {
      const val = item[key];
      if (val && typeof val === 'object') {
        if (Array.isArray(val.thumbnailOverlays)) {
          const found = val.thumbnailOverlays.find(o => o && o.thumbnailOverlayResumePlaybackRenderer);
          if (found && found.thumbnailOverlayResumePlaybackRenderer) return found.thumbnailOverlayResumePlaybackRenderer;
        }
      }
    }
    return null;
  }

  // helper: more tolerant page detection (match tokens)
  function currentPageTokens() {
    const tokens = [];
    const hash = location.hash ? location.hash.substring(1) : '';
    const path = location.pathname || '';

    const combined = (hash + ' ' + path + ' ' + location.search).toLowerCase();

    // add specific known token matches
    if (combined.includes('/feed/subscriptions') || combined.includes('subscriptions') || combined.includes('abos')) tokens.push('subscriptions');
    if (combined.includes('/feed/library') || combined.includes('library') || combined.includes('mediathek')) tokens.push('library');
    if (combined.includes('/playlist') || combined.includes('list=')) tokens.push('playlist');
    if (combined.includes('/results') || combined.includes('/search') || combined.includes('search')) tokens.push('search');
    if (combined === '' || combined.includes('/home') || combined.includes('browse') || combined.includes('/')) tokens.push('home');
    // fallback: split hash on / and add tokens
    (hash || '').split(/[\/?&=#]/).filter(Boolean).forEach(t => tokens.push(t));
    return tokens;
  }

  const pages = configRead('hideWatchedVideosPages') || [];
  const pageTokens = currentPageTokens();

  // if pages array is empty -> do not hide anywhere (preserve current default behaviour)
  const pageFilterEnabled = Array.isArray(pages) && pages.length > 0;

  return items.filter(item => {
    if (!item) return false; // drop empties

    // if there is no renderer-like shape let it pass
    if (!item.tileRenderer && !item.playlistVideoRenderer && !item.compactVideoRenderer && !item.gridVideoRenderer && !item.videoRenderer) {
      return true;
    }

    // If page-level filtering is enabled, check that current page matches any requested token
    if (pageFilterEnabled) {
      const lowerPages = pages.map(p => String(p).toLowerCase());
      const anyMatch = lowerPages.some(p => pageTokens.some(t => t.includes(p) || p.includes(t)));
      if (!anyMatch) {
        // this page is not in the configured hide pages -> keep the item
        return true;
      }
    }

    // find a progress/resume overlay in many renderer shapes
    const progressBar = findProgressBar(item);
    if (!progressBar) {
      // if we cannot detect progress info, keep the tile (safer)
      return true;
    }

    // percent field used by the client code
    const percentWatched = Number(progressBar.percentDurationWatched || 0);

    // if the playlist specific config exists and we are on a playlist, use that toggle
    const isPlaylistPage = pageTokens.includes('playlist') || pageTokens.includes('playlists') || pageTokens.includes('mediathek');
    if (isPlaylistPage && !configRead('enableHideWatchedInPlaylists')) {
      // the user disabled hiding for playlists
      return true;
    }

    // finally compare threshold
    const threshold = Number(configRead('hideWatchedVideosThreshold') || 0);
    return percentWatched <= threshold;
  });
}