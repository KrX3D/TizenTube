import { configRead } from '../config.js';
import Chapters from '../ui/chapters.js';
import resolveCommand from '../resolveCommand.js';
import { timelyAction, longPressData, MenuServiceItemRenderer, ShelfRenderer, TileRenderer, ButtonRenderer } from '../ui/ytUI.js';
import { PatchSettings } from '../ui/customYTSettings.js';

const origParse = JSON.parse;
JSON.parse = function () {
  const r = origParse.apply(this, arguments);
  const adBlockEnabled = configRead('enableAdBlock');

  if (r.adPlacements && adBlockEnabled) {
    console.log('ADBLOCK', 'Removing adPlacements', { count: r.adPlacements.length });
    
    r.adPlacements = [];
  }

  if (r.playerAds && adBlockEnabled) {
    console.log('ADBLOCK', 'Disabling playerAds');
    r.playerAds = false;
  }

  if (r.adSlots && adBlockEnabled) {
    console.log('ADBLOCK', 'Clearing adSlots', { count: r.adSlots.length });
    r.adSlots = [];
  }

  if (r.paidContentOverlay && !configRead('enablePaidPromotionOverlay')) {
    console.log('ADBLOCK', 'Removing paid content overlay');
    r.paidContentOverlay = null;
  }

  if (r?.streamingData?.adaptiveFormats && configRead('videoPreferredCodec') !== 'any') {
    const preferredCodec = configRead('videoPreferredCodec');
    const hasPreferredCodec = r.streamingData.adaptiveFormats.find(format => format.mimeType.includes(preferredCodec));
    if (hasPreferredCodec) {
      const before = r.streamingData.adaptiveFormats.length;
      r.streamingData.adaptiveFormats = r.streamingData.adaptiveFormats.filter(format => {
        if (format.mimeType.startsWith('audio/')) return true;
        return format.mimeType.includes(preferredCodec);
      });
      logger.info('VIDEO_CODEC', `Filtered formats for ${preferredCodec}`, {
        before,
        after: r.streamingData.adaptiveFormats.length
      });
    }
  }

  // Drop "masthead" ad from home screen
  if (r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents) {
    if (adBlockEnabled) {
      const beforeAds = r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents.length;
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
      
      const afterAds = r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents.length;
      if (beforeAds !== afterAds) {
        logger.info('ADBLOCK', 'Removed masthead ads', { removed: beforeAds - afterAds });
      }
    }

    processShelves(r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents);
  }

  if (r.endscreen && configRead('enableHideEndScreenCards')) {
    console.log('UI_FILTER', 'Hiding end screen cards');
    r.endscreen = null;
  }

  if (r.messages && Array.isArray(r.messages) && !configRead('enableYouThereRenderer')) {
    const before = r.messages.length;
    r.messages = r.messages.filter((msg) => !msg?.youThereRenderer);
    if (before !== r.messages.length) {
      console.log('UI_FILTER', 'Removed YouThereRenderer messages', { removed: before - r.messages.length });
    }
  }

  // Remove shorts ads
  if (!Array.isArray(r) && r?.entries && adBlockEnabled) {
    const before = r.entries.length;
    r.entries = r.entries?.filter((elm) => !elm?.command?.reelWatchEndpoint?.adClientParams?.isAd);
    if (before !== r.entries.length) {
      logger.info('ADBLOCK', 'Removed shorts ads', { removed: before - r.entries.length });
    }
  }

  if (r?.title?.runs) {
    PatchSettings(r);
  }

  if (r?.contents?.sectionListRenderer?.contents) {
    console.log('SHELF_ENTRY', 'Processing sectionListRenderer.contents', {
      count: r.contents.sectionListRenderer.contents.length,
      page: getCurrentPage()
    });
    processShelves(r.contents.sectionListRenderer.contents);
  }

  if (r?.continuationContents?.sectionListContinuation?.contents) {
    console.log('SHELF_ENTRY', 'Processing continuation contents', {
      count: r.continuationContents.sectionListContinuation.contents.length,
      page: getCurrentPage()
    });
    processShelves(r.continuationContents.sectionListContinuation.contents);
  }

  if (r?.continuationContents?.horizontalListContinuation?.items) {
    console.log('SHELF_ENTRY', 'Processing horizontal list continuation', {
      count: r.continuationContents.horizontalListContinuation.items.length
    });
    deArrowify(r.continuationContents.horizontalListContinuation.items);
    hqify(r.continuationContents.horizontalListContinuation.items);
    addLongPress(r.continuationContents.horizontalListContinuation.items);
    r.continuationContents.horizontalListContinuation.items = hideVideo(r.continuationContents.horizontalListContinuation.items);
  }

  if (r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
    console.log('SHELF_ENTRY', 'Processing tvSecondaryNavRenderer sections');
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
      queuedVideosClone.unshift(TileRenderer('Clear Queue', { customAction: { action: 'CLEAR_QUEUE' }}));
      r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents.unshift(ShelfRenderer(
        'Queued Videos',
        queuedVideosClone,
        queuedVideosClone.findIndex(v => v.contentId === window.queuedVideos.lastVideoId) !== -1 ?
          queuedVideosClone.findIndex(v => v.contentId === window.queuedVideos.lastVideoId) : 0
      ));
    }
  }

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
      console.log('SPONSORBLOCK', `Added ${timelyActions.length} manual skip actions`);
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
            buttonRenderer: ButtonRenderer(false, 'Skip to highlight', 'SKIP_NEXT', {
              clickTrackingParams: null,
              customAction: { action: 'SKIP', parameters: { time: category.segment[0] }}
            })
          }
        });
        console.log('SPONSORBLOCK', 'Added highlight button');
      }
    }
  }

  return r;
};

window.JSON.parse = JSON.parse;
for (const key in window._yttv) {
  if (window._yttv[key] && window._yttv[key].JSON && window._yttv[key].JSON.parse) {
    window._yttv[key].JSON.parse = JSON.parse;
  }
}

function isShortItem(item) {
  if (!item) return false;

  const detectionReasons = [];

  if (item.reelItemRenderer || item.richItemRenderer?.content?.reelItemRenderer) {
    detectionReasons.push('reelRenderer');
  }

  const videoRenderers = [
    item.videoRenderer,
    item.compactVideoRenderer,
    item.gridVideoRenderer,
    item.richItemRenderer?.content?.videoRenderer,
    item.tileRenderer
  ];

  for (const video of videoRenderers) {
    if (!video) continue;

    if (video.badges) {
      for (const badge of video.badges) {
        if (badge.metadataBadgeRenderer?.label === 'Shorts') {
          detectionReasons.push('badge');
          break;
        }
      }
    }

    if (video.thumbnailOverlays) {
      for (const overlay of video.thumbnailOverlays) {
        if (overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS') {
          detectionReasons.push('overlay');
          break;
        }
      }
    }

    const navEndpoint = video.navigationEndpoint || video.onSelectCommand;
    const url = navEndpoint?.commandMetadata?.webCommandMetadata?.url || navEndpoint?.watchEndpoint?.videoId;
    
    if (url && typeof url === 'string' && url.includes('/shorts/')) {
      detectionReasons.push('url');
    }
  }

  const isShort = detectionReasons.length > 0;
  
  if (isShort) {
    const videoId = item.tileRenderer?.contentId || 
                   item.videoRenderer?.videoId || 
                   item.richItemRenderer?.content?.videoRenderer?.videoId || 
                   'unknown';
    console.log('SHORT_DETECTED', `Short video detected: ${videoId}`, {
      reasons: detectionReasons,
      page: getCurrentPage()
    });
  }

  return isShort;
}

function processShelves(shelves, shouldAddPreviews = true) {
  if (!Array.isArray(shelves)) {
    logger.warn('SHELF_PROCESS', 'processShelves called with non-array', { type: typeof shelves });
    return;
  }
  
  const page = getCurrentPage();
  const shortsEnabled = configRead('enableShorts');
  const hideWatchedEnabled = configRead('enableHideWatchedVideos');
  const configPages = configRead('hideWatchedVideosPages') || [];
  const shouldHideWatched = hideWatchedEnabled && (configPages.length === 0 || configPages.includes(page));
  
  console.log('[SHELF_DEBUG] Page detection:', {
    page: page,
    hash: location.hash,
    pathname: location.pathname,
    search: location.search,
    hideWatchedEnabled: hideWatchedEnabled,
    configPages: configPages,
    pageIncluded: configPages.includes(page),
    shouldHideWatched: shouldHideWatched
  });
  
  logger.info('SHELF_PROCESS_START', `Processing ${shelves.length} shelves on ${page}`, {
    shortsEnabled,
    hideWatchedEnabled,
    shouldHideWatched,
    threshold: configRead('hideWatchedVideosThreshold')
  });
  
  let totalItemsBefore = 0;
  let totalItemsAfter = 0;
  let shelvesRemoved = 0;
  
  for (let i = shelves.length - 1; i >= 0; i--) {
    const shelve = shelves[i];
    if (!shelve) continue;
    
    let shelfType = 'unknown';
    let itemsBefore = 0;
    let itemsAfter = 0;
    
    // Handle shelfRenderer
    if (shelve.shelfRenderer) {
      // horizontalListRenderer
      if (shelve.shelfRenderer.content?.horizontalListRenderer?.items) {
        shelfType = 'horizontalList';
        let items = shelve.shelfRenderer.content.horizontalListRenderer.items;
        itemsBefore = items.length;
        
        deArrowify(items);
        hqify(items);
        addLongPress(items);
        if (shouldAddPreviews) addPreviews(items);
        
        if (!shortsEnabled) {
          if (shelve.shelfRenderer.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS') {
            logger.info('SHELF_REMOVED', 'Removing entire shorts shelf', { type: shelfType, page });
            shelves.splice(i, 1);
            shelvesRemoved++;
            continue;
          }
          
          const beforeShortFilter = items.length;
          items = items.filter(item => !isShortItem(item));
          if (beforeShortFilter !== items.length) {
            logger.info('SHORTS_FILTERED', `Removed ${beforeShortFilter - items.length} shorts from ${shelfType}`, { page });
          }
        }
        
        items = hideVideo(items);
        itemsAfter = items.length;
        
        shelve.shelfRenderer.content.horizontalListRenderer.items = items;
        
        if (items.length === 0) {
          logger.info('SHELF_REMOVED', `Removing empty ${shelfType} shelf`, { page });
          shelves.splice(i, 1);
          shelvesRemoved++;
          continue;
        }
      }
      
      // gridRenderer
      else if (shelve.shelfRenderer.content?.gridRenderer?.items) {
        shelfType = 'grid';
        let items = shelve.shelfRenderer.content.gridRenderer.items;
        itemsBefore = items.length;
        
        deArrowify(items);
        hqify(items);
        addLongPress(items);
        if (shouldAddPreviews) addPreviews(items);
        
        if (!shortsEnabled) {
          const beforeShortFilter = items.length;
          items = items.filter(item => !isShortItem(item));
          if (beforeShortFilter !== items.length) {
            logger.info('SHORTS_FILTERED', `Removed ${beforeShortFilter - items.length} shorts from ${shelfType}`, { page });
          }
        }
        
        items = hideVideo(items);
        itemsAfter = items.length;
        
        shelve.shelfRenderer.content.gridRenderer.items = items;
        
        if (items.length === 0) {
          logger.info('SHELF_REMOVED', `Removing empty ${shelfType} shelf`, { page });
          shelves.splice(i, 1);
          shelvesRemoved++;
          continue;
        }
      }

      // verticalListRenderer
      else if (shelve.shelfRenderer.content?.verticalListRenderer?.items) {
        shelfType = 'verticalList';
        let items = shelve.shelfRenderer.content.verticalListRenderer.items;
        itemsBefore = items.length;
        
        deArrowify(items);
        hqify(items);
        addLongPress(items);
        if (shouldAddPreviews) addPreviews(items);
        
        if (!shortsEnabled) {
          const beforeShortFilter = items.length;
          items = items.filter(item => !isShortItem(item));
          if (beforeShortFilter !== items.length) {
            logger.info('SHORTS_FILTERED', `Removed ${beforeShortFilter - items.length} shorts from ${shelfType}`, { page });
          }
        }
        
        items = hideVideo(items);
        itemsAfter = items.length;
        
        shelve.shelfRenderer.content.verticalListRenderer.items = items;
        
        if (items.length === 0) {
          logger.info('SHELF_REMOVED', `Removing empty ${shelfType} shelf`, { page });
          shelves.splice(i, 1);
          shelvesRemoved++;
          continue;
        }
      }
    }
    
    // Handle richShelfRenderer (subscriptions)
    else if (shelve.richShelfRenderer?.content?.richGridRenderer?.contents) {
      shelfType = 'richGrid';
      let contents = shelve.richShelfRenderer.content.richGridRenderer.contents;
      itemsBefore = contents.length;
      
      deArrowify(contents);
      hqify(contents);
      addLongPress(contents);
      if (shouldAddPreviews) addPreviews(contents);
      
      if (!shortsEnabled) {
        const beforeShortFilter = contents.length;
        contents = contents.filter(item => !isShortItem(item));
        if (beforeShortFilter !== contents.length) {
          logger.info('SHORTS_FILTERED', `Removed ${beforeShortFilter - contents.length} shorts from ${shelfType}`, { page });
        }
      }
      
      contents = hideVideo(contents);
      itemsAfter = contents.length;
      
      shelve.richShelfRenderer.content.richGridRenderer.contents = contents;
      
      if (contents.length === 0) {
        logger.info('SHELF_REMOVED', `Removing empty ${shelfType} shelf`, { page });
        shelves.splice(i, 1);
        shelvesRemoved++;
        continue;
      }
    }

    // Handle richSectionRenderer
    else if (shelve.richSectionRenderer?.content?.richShelfRenderer) {
      shelfType = 'richSection';
      if (!shortsEnabled) {
        const innerShelf = shelve.richSectionRenderer.content.richShelfRenderer;
        const contents = innerShelf?.content?.richGridRenderer?.contents;
        
        if (Array.isArray(contents) && contents.some(item => isShortItem(item))) {
          logger.info('SHELF_REMOVED', 'Removing shorts richSection shelf', { page });
          shelves.splice(i, 1);
          shelvesRemoved++;
          continue;
        }
      }
    }

    // Handle gridRenderer at shelf level
    else if (shelve.gridRenderer?.items) {
      shelfType = 'topLevelGrid';
      let items = shelve.gridRenderer.items;
      itemsBefore = items.length;
      
      deArrowify(items);
      hqify(items);
      addLongPress(items);
      if (shouldAddPreviews) addPreviews(items);
      
      if (!shortsEnabled) {
        const beforeShortFilter = items.length;
        items = items.filter(item => !isShortItem(item));
        if (beforeShortFilter !== items.length) {
          logger.info('SHORTS_FILTERED', `Removed ${beforeShortFilter - items.length} shorts from ${shelfType}`, { page });
        }
      }
      
      items = hideVideo(items);
      itemsAfter = items.length;
      
      shelve.gridRenderer.items = items;
      
      if (items.length === 0) {
        logger.info('SHELF_REMOVED', `Removing empty ${shelfType} shelf`, { page });
        shelves.splice(i, 1);
        shelvesRemoved++;
        continue;
      }
    }
    
    totalItemsBefore += itemsBefore;
    totalItemsAfter += itemsAfter;
    
    if (itemsBefore > 0) {
      console.log('SHELF_PROCESSED', `Processed ${shelfType} shelf`, {
        before: itemsBefore,
        after: itemsAfter,
        filtered: itemsBefore - itemsAfter,
        page
      });
    }
  }
  
  logger.info('SHELF_PROCESS_COMPLETE', `Finished processing shelves on ${page}`, {
    shelvesProcessed: shelves.length,
    shelvesRemoved,
    totalItemsBefore,
    totalItemsAfter,
    totalFiltered: totalItemsBefore - totalItemsAfter
  });
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
  if (!configRead('enableHideWatchedVideos')) {
    return items;
  }
  
  if (!Array.isArray(items)) return items;
  
  const page = getCurrentPage();
  const configPages = configRead('hideWatchedVideosPages') || [];
  const threshold = Number(configRead('hideWatchedVideosThreshold') || 0);
  const shouldHideOnThisPage = configPages.length === 0 || configPages.includes(page);
  
  if (!shouldHideOnThisPage) {
    console.log('WATCHED_SKIP', `Skipping watched video hiding on ${page}`, {
      configPages,
      threshold
    });
    return items;
  }
  
  if (page === 'playlist' && !configRead('enableHideWatchedInPlaylists')) {
    console.log('WATCHED_SKIP', 'Skipping watched video hiding in playlist (disabled)');
    return items;
  }
  
  const beforeCount = items.length;
  let hiddenCount = 0;
  
  const filtered = items.filter(item => {
    if (!item) return false;
    
    const progressBar = findProgressBar(item);
    if (!progressBar) return true;
    
    const percentWatched = Number(progressBar.percentDurationWatched || 0);
    const shouldHide = percentWatched > threshold;
    
    if (shouldHide) {
      hiddenCount++;
      const videoId = item.tileRenderer?.contentId || 
                     item.videoRenderer?.videoId || 
                     item.richItemRenderer?.content?.videoRenderer?.videoId || 
                     'unknown';
      
      console.log('WATCHED_HIDDEN', `Hiding watched video ${videoId}`, {
        percentWatched,
        threshold,
        page
      });
    }
    
    return !shouldHide;
  });
  
  if (hiddenCount > 0) {
    logger.info('WATCHED_FILTERED', `Hidden ${hiddenCount} watched videos on ${page}`, {
      before: beforeCount,
      after: filtered.length,
      threshold
    });
  }
  
  return filtered;
}

function findProgressBar(item) {
  if (!item) return null;
  
  const checkRenderer = (renderer) => {
    if (!renderer) return null;
    
    const overlayPaths = [
      renderer.thumbnailOverlays,
      renderer.header?.tileHeaderRenderer?.thumbnailOverlays,
      renderer.thumbnail?.thumbnailOverlays
    ];
    
    for (const overlays of overlayPaths) {
      if (!Array.isArray(overlays)) continue;
      const progressOverlay = overlays.find(o => o?.thumbnailOverlayResumePlaybackRenderer);
      if (progressOverlay) {
        return progressOverlay.thumbnailOverlayResumePlaybackRenderer;
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

// Track last page to detect changes - MOVED OUTSIDE FUNCTION
let lastDetectedPage = null;
let lastFullUrl = null;

function getCurrentPage() {
  const hash = location.hash ? location.hash.substring(1) : '';
  const path = location.pathname || '';
  const search = location.search || '';
  const href = location.href || '';
  
  // Clean up the hash - remove additionalDataUrl and other query params AFTER first ?
  const cleanHash = hash.split('?')[0];
  
  // Extract browse parameters from hash (Tizen YouTube format: /browse?C=FEsubscriptions)
  let browseParam = '';
  if (hash.includes('?C=')) {
    browseParam = hash.split('?C=')[1]?.split('&')[0] || '';
  }
  
  // Combine for detection
  const combined = (cleanHash + ' ' + path + ' ' + search + ' ' + href + ' ' + browseParam).toLowerCase();
  const fullUrl = `${path}${cleanHash}${search}`;
  
  // Detect page type - check hash first (most reliable for Tizen YouTube app)
  let detectedPage = 'other';
  
  console.log('[PAGE_DEBUG] browseParam:', browseParam);
  console.log('[PAGE_DEBUG] cleanHash:', cleanHash);
  console.log('[PAGE_DEBUG] combined:', combined.substring(0, 150));
  
  // IMPORTANT: Check most specific patterns first, most generic last
  // Check for Tizen YouTube browse parameters (format: /browse?C=FExxxxx)
  if (browseParam.includes('fesubscriptions') || browseParam.includes('subscriptions')) {
    detectedPage = 'subscriptions';
  } else if (browseParam.includes('felibrary') || browseParam.includes('library')) {
    detectedPage = 'library';
  } else if (browseParam.includes('fetrending') || browseParam.includes('trending')) {
    detectedPage = 'trending';
  } else if (browseParam.includes('fetopics_music') || browseParam.includes('music')) {
    detectedPage = 'music';
  } else if (browseParam.includes('fetopics_gaming') || browseParam.includes('gaming')) {
    detectedPage = 'gaming';
  } else if (browseParam.includes('fetopics')) {
    detectedPage = 'home';
  }
  // Check traditional hash patterns (fallback)
  else if (cleanHash.includes('/feed/subscriptions') || cleanHash.includes('/subscriptions')) {
    detectedPage = 'subscriptions';
  } else if (cleanHash.includes('/feed/library') || cleanHash.includes('/library')) {
    detectedPage = 'library';
  } else if (cleanHash.includes('/playlist') || cleanHash.includes('list=') || combined.includes('playlist')) {
    detectedPage = 'playlist';
  } else if (cleanHash.includes('/results') || cleanHash.includes('/search') || combined.includes('search_query=')) {
    detectedPage = 'search';
  } else if (cleanHash.includes('/watch')) {
    detectedPage = 'watch';
  } else if (cleanHash.includes('/@') || cleanHash.includes('/channel/') || cleanHash.includes('/c/') || cleanHash.includes('/user/')) {
    detectedPage = 'channel';
  } else if (cleanHash.includes('/feed/trending') || cleanHash.includes('/trending')) {
    detectedPage = 'trending';
  } else if (cleanHash.includes('/feed/history') || cleanHash.includes('/history')) {
    detectedPage = 'history';
  } else if (cleanHash.includes('/browse')) {
    // Generic browse without specific C parameter
    detectedPage = 'home';
  } else if (cleanHash === '' || cleanHash === '/' || cleanHash.includes('home')) {
    detectedPage = 'home';
  }
  
  // Log page changes with extensive detail - ONLY WHEN ACTUALLY CHANGED
  const currentFullUrl = fullUrl;
  if (detectedPage !== lastDetectedPage || currentFullUrl !== lastFullUrl) {
    console.log('═══════════════════════════════════════════════');
    console.log('[PAGE_CHANGE] Navigation detected');
    console.log('[PAGE_CHANGE] From:', lastDetectedPage || 'initial');
    console.log('[PAGE_CHANGE] To:', detectedPage);
    console.log('[PAGE_CHANGE] URL Details:');
    console.log('[PAGE_CHANGE]   path:', path);
    console.log('[PAGE_CHANGE]   hash:', hash);
    console.log('[PAGE_CHANGE]   cleanHash:', cleanHash);
    console.log('[PAGE_CHANGE]   browseParam:', browseParam);
    console.log('[PAGE_CHANGE]   search:', search);
    console.log('[PAGE_CHANGE]   fullUrl:', fullUrl);
    
    // Check if hide watched is enabled for this page
    const hideWatchedEnabled = configRead('enableHideWatchedVideos');
    const configPages = configRead('hideWatchedVideosPages') || [];
    const shouldHideWatched = hideWatchedEnabled && (configPages.length === 0 || configPages.includes(detectedPage));
    
    console.log('[PAGE_CHANGE] Hide Watched Settings:');
    console.log('[PAGE_CHANGE]   globalEnabled:', hideWatchedEnabled);
    console.log('[PAGE_CHANGE]   configuredPages:', JSON.stringify(configPages));
    console.log('[PAGE_CHANGE]   pageInList:', configPages.includes(detectedPage));
    console.log('[PAGE_CHANGE]   shouldHide:', shouldHideWatched);
    console.log('[PAGE_CHANGE]   threshold:', configRead('hideWatchedVideosThreshold'));
    
    // Additional detection info
    console.log('[PAGE_CHANGE] Detection Logic:');
    console.log('[PAGE_CHANGE]   browseParam includes "fesubscriptions":', browseParam.toLowerCase().includes('fesubscriptions'));
    console.log('[PAGE_CHANGE]   browseParam includes "felibrary":', browseParam.toLowerCase().includes('felibrary'));
    console.log('[PAGE_CHANGE]   cleanHash includes "/feed/subscriptions":', cleanHash.includes('/feed/subscriptions'));
    console.log('[PAGE_CHANGE]   cleanHash includes "/browse":', cleanHash.includes('/browse'));
    
    console.log('═══════════════════════════════════════════════');
    
    // Update tracking variables AFTER logging
    lastDetectedPage = detectedPage;
    lastFullUrl = currentFullUrl;
  }
  
  return detectedPage;
}