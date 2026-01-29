import { configRead } from '../config.js';
import Chapters from '../ui/chapters.js';
import resolveCommand from '../resolveCommand.js';
import { timelyAction, longPressData, MenuServiceItemRenderer, ShelfRenderer, TileRenderer, ButtonRenderer } from '../ui/ytUI.js';
import { PatchSettings } from '../ui/customYTSettings.js';

function directFilterArray(arr, page, context = '') {
  if (!Array.isArray(arr) || arr.length === 0) return arr;
  
  const debugEnabled = configRead('enableDebugConsole');
  const shortsEnabled = configRead('enableShorts');
  const hideWatchedEnabled = configRead('enableHideWatchedVideos');
  const configPages = configRead('hideWatchedVideosPages') || [];
  const threshold = Number(configRead('hideWatchedVideosThreshold') || 0);
  
  // Check if this page should be filtered
  const shouldHideWatched = hideWatchedEnabled && 
    (configPages.length === 0 || configPages.includes(page) ||
     (page === 'playlist' && configRead('enableHideWatchedInPlaylists')));
  
  const shouldFilterShorts = !shortsEnabled;
  
  // Skip if nothing to do
  if (!shouldHideWatched && !shouldFilterShorts) {
    return arr;
  }
  
  let hiddenCount = 0;
  let shortsCount = 0;
  const originalLength = arr.length;
  
  const filtered = arr.filter(item => {
    if (!item) return true;
    
    // Check if it's a video item (has common video properties)
    const isVideoItem = item.tileRenderer || 
                        item.videoRenderer || 
                        item.gridVideoRenderer ||
                        item.compactVideoRenderer ||
                        item.richItemRenderer?.content?.videoRenderer;
    
    if (!isVideoItem) return true;
    
    // Filter shorts
    if (shouldFilterShorts && isShortItem(item)) {
      shortsCount++;
      if (debugEnabled) {
        const videoId = item.tileRenderer?.contentId || 
                       item.videoRenderer?.videoId || 
                       'unknown';
        console.log('[DIRECT_FILTER] Removing short:', videoId);
      }
      return false;
    }
    
    // Filter watched videos
    if (shouldHideWatched) {
      const progressBar = findProgressBar(item);
      if (progressBar) {
        const percentWatched = Number(progressBar.percentDurationWatched || 0);
        if (percentWatched >= threshold) {
          hiddenCount++;
          if (debugEnabled) {
            const videoId = item.tileRenderer?.contentId || 
                           item.videoRenderer?.videoId || 
                           'unknown';
            console.log('[DIRECT_FILTER] Removing watched:', videoId, '(' + percentWatched + '%)');
          }
          return false;
        }
      }
    }
    
    return true;
  });
  
  // Log results if anything was filtered
  if (hiddenCount > 0 || shortsCount > 0) {
    console.log('[DIRECT_FILTER] ========================================');
    console.log('[DIRECT_FILTER] Page:', page, '| Context:', context);
    console.log('[DIRECT_FILTER] Original:', originalLength, '→ Filtered:', filtered.length);
    console.log('[DIRECT_FILTER] Watched removed:', hiddenCount);
    console.log('[DIRECT_FILTER] Shorts removed:', shortsCount);
    console.log('[DIRECT_FILTER] ========================================');
  }
  
  return filtered;
}

function scanAndFilterAllArrays(obj, page, path = 'root') {
  if (!obj || typeof obj !== 'object') return;
  
  const debugEnabled = configRead('enableDebugConsole');
  
  // If this is an array with video items, filter it
  if (Array.isArray(obj) && obj.length > 0) {
    // Check if it looks like a video items array
    const hasVideoItems = obj.some(item => 
      item?.tileRenderer || 
      item?.videoRenderer || 
      item?.gridVideoRenderer ||
      item?.compactVideoRenderer ||
      item?.richItemRenderer?.content?.videoRenderer
    );
    
    if (hasVideoItems) {
      if (debugEnabled) {
        console.log('[SCAN] Found video array at:', path, '| Length:', obj.length);
      }
      return directFilterArray(obj, page, path);
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
    const currentPage = getCurrentPage();
    
    // ONLY process once per unique response object
    if (!r.__tizentubeProcessedBrowse) {
      r.__tizentubeProcessedBrowse = true;
      console.log('[BROWSE] ==============tvBrowseRenderer============');
      console.log('[BROWSE] Page:', currentPage);
      console.log('[BROWSE] URL:', window.location.href);
      console.log('[BROWSE] Hash:', window.location.hash);
      console.log('[BROWSE] ========================================');
      
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
    } else {
      console.log('[JSON.parse] tvBrowseRenderer already processed, SKIPPING');
    }
  }
  
  // ⭐ FORCE PROCESSING for problem pages
  if (!r.__tizentubeForceProcessed) {
    r.__tizentubeForceProcessed = true;
    const page = getCurrentPage();
    
    // Pages that MUST be processed
    const criticalPages = ['subscriptions', 'library', 'history', 'playlists', 'playlist', 'channel'];
    
    if (criticalPages.includes(page)) {
      const debugEnabled = configRead('enableDebugConsole');
      if (debugEnabled) {
        console.log('[CRITICAL] ========================================');
        console.log('[CRITICAL] Forcing processing for critical page:', page);
        console.log('[CRITICAL] ========================================');
      }
      forceProcessPage(r, page);
    }
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
    if (!r.__tizentubeProcessedSection) {
      r.__tizentubeProcessedSection = true;
      console.log('SHELF_ENTRY', 'Processing sectionListRenderer.contents', {
        count: r.contents.sectionListRenderer.contents.length,
        page: getCurrentPage()
      });
      processShelves(r.contents.sectionListRenderer.contents);
    } else {
      console.log('[JSON.parse] sectionListRenderer already processed, SKIPPING');
    }
  }

  if (r?.continuationContents?.sectionListContinuation?.contents) {
    const page = getCurrentPage();
    console.log('[CONTINUATION]', page, '- Processing', r.continuationContents.sectionListContinuation.contents.length, 'shelves');

    if (window._lastLoggedPage !== page) {
      console.log('[PAGE_DEBUG] ========================================');
      console.log('[PAGE_DEBUG] Page changed to:', page);
      console.log('[PAGE_DEBUG] URL:', window.location.href);
      console.log('[PAGE_DEBUG] Hash:', window.location.hash);
      console.log('[PAGE_DEBUG] ========================================');
      window._lastLoggedPage = page;
    }
    
    // This is where individual channel content loads!
    processShelves(r.continuationContents.sectionListContinuation.contents);
  }
  
  // ⭐ PATCH 5: Handle onResponseReceivedActions (lazy-loaded channel tabs)
  if (r?.onResponseReceivedActions) {
    const page = getCurrentPage();
    const debugEnabled = configRead('enableDebugConsole');
    
    if (debugEnabled) {
      console.log('[CONTINUATION] ========================================');
      console.log('[CONTINUATION] Page:', page);
      console.log('[CONTINUATION] Actions:', r.onResponseReceivedActions.length);
    }
    
    r.onResponseReceivedActions.forEach((action, idx) => {
      if (action.appendContinuationItemsAction?.continuationItems) {
        if (debugEnabled) {
          console.log('[CONTINUATION] Processing action', idx);
        }
        
        // Filter the continuation items directly
        const items = action.appendContinuationItemsAction.continuationItems;
        const filtered = directFilterArray(items, page, 'continuation[' + idx + ']');
        action.appendContinuationItemsAction.continuationItems = filtered;
      }
    });
    
    if (debugEnabled) {
      console.log('[CONTINUATION] ========================================');
    }
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

  
  if (r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer) {
    const page = getCurrentPage();
    
    if (page === 'subscriptions') {
      const debugEnabled = configRead('enableDebugConsole');
      
      if (debugEnabled) {
        console.log('[SUBSCRIPTIONS] ========================================');
        console.log('[SUBSCRIPTIONS] Detected subscriptions page');
        console.log('[SUBSCRIPTIONS] Applying direct filtering...');
      }
      
      // Scan and filter ALL arrays in the secondary nav
      scanAndFilterAllArrays(r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer, page);
      
      if (debugEnabled) {
        console.log('[SUBSCRIPTIONS] Direct filtering complete');
        console.log('[SUBSCRIPTIONS] ========================================');
      }
    }
  }

  // ⭐ NEW: Log library page structure
  if (r?.contents?.tvBrowseRenderer && getCurrentPage() === 'library') {
      console.log('[LIBRARY] ========================================');
      console.log('[LIBRARY] Structure detected');
      console.log('[LIBRARY] URL:', window.location.href);
      
      if (r.contents.tvBrowseRenderer.content?.tvSecondaryNavRenderer) {
        const tabs = r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections;
        console.log('[LIBRARY] Has', tabs?.length || 0, 'tab sections');
      }
      
      if (r.contents.tvBrowseRenderer.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer) {
        const shelves = r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents;
        console.log('[LIBRARY] Main view has', shelves?.length || 0, 'shelves');
      }
      console.log('[LIBRARY] ========================================');
  }

  // ⭐ NEW: Special handling for playlists when entering them
  if (r?.contents?.singleColumnBrowseResultsRenderer && window.location.hash.includes('list=')) {
      console.log('[PLAYLIST] ========================================');
      console.log('[PLAYLIST] Entered playlist');
      console.log('[PLAYLIST] URL:', window.location.href);
      
      const tabs = r.contents.singleColumnBrowseResultsRenderer.tabs;
      if (tabs) {
        tabs.forEach((tab, idx) => {
          if (tab.tabRenderer?.content?.sectionListRenderer?.contents) {
            console.log(`[PLAYLIST] Tab ${idx} - processing shelves`);
            processShelves(tab.tabRenderer.content.sectionListRenderer.contents);
          }
        });
      }
      console.log('[PLAYLIST] ========================================');
  }
  
  // Handle twoColumnBrowseResultsRenderer (playlist pages like WL, LL)
  if (r?.contents?.twoColumnBrowseResultsRenderer?.tabs) {
    const page = getCurrentPage();
    const debugEnabled = configRead('enableDebugConsole');
    
    if (debugEnabled) {
      console.log('[PLAYLIST_PAGE] ========================================');
      console.log('[PLAYLIST_PAGE] Page:', page);
      console.log('[PLAYLIST_PAGE] Applying direct filtering to tabs...');
    }
    
    // Scan and filter ALL arrays in all tabs
    scanAndFilterAllArrays(r.contents.twoColumnBrowseResultsRenderer, page);
    
    if (debugEnabled) {
      console.log('[PLAYLIST_PAGE] Direct filtering complete');
      console.log('[PLAYLIST_PAGE] ========================================');
    }
  }

  // Handle singleColumnBrowseResultsRenderer (alternative playlist format)
  if (r?.contents?.singleColumnBrowseResultsRenderer?.tabs) {
    const page = getCurrentPage();
    const debugEnabled = configRead('enableDebugConsole');
    
    if (debugEnabled) {
      console.log('[SINGLE_COLUMN] ========================================');
      console.log('[SINGLE_COLUMN] Page:', page);
      console.log('[SINGLE_COLUMN] Applying direct filtering...');
    }
    
    // Scan and filter ALL arrays
    scanAndFilterAllArrays(r.contents.singleColumnBrowseResultsRenderer, page);
    
    if (debugEnabled) {
      console.log('[SINGLE_COLUMN] Direct filtering complete');
      console.log('[SINGLE_COLUMN] ========================================');
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
  
  // ⭐ UNIVERSAL FALLBACK - Filter EVERYTHING if we're on a critical page
  const currentPage = getCurrentPage();
  const criticalPages = ['subscriptions', 'library', 'history', 'playlists', 'playlist', 'channel'];
  
  if (criticalPages.includes(currentPage) && !r.__universalFilterApplied) {
    r.__universalFilterApplied = true;
    
    const debugEnabled = configRead('enableDebugConsole');
    
    if (debugEnabled) {
      console.log('[UNIVERSAL] ========================================');
      console.log('[UNIVERSAL] Applying universal filtering to page:', currentPage);
    }
    
    // Scan the ENTIRE response object and filter ALL video arrays
    scanAndFilterAllArrays(r, currentPage);
    
    if (debugEnabled) {
      console.log('[UNIVERSAL] Universal filtering complete');
      console.log('[UNIVERSAL] ========================================');
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
  
  // Method 1: Check tileRenderer contentType
  if (item.tileRenderer?.contentType === 'TILE_CONTENT_TYPE_SHORT') {
    return true;
  }
  
  // Method 2: Check videoRenderer for shorts
  if (item.videoRenderer) {
    // Check thumbnail overlays for shorts badge
    if (item.videoRenderer.thumbnailOverlays) {
      const hasShortsBadge = item.videoRenderer.thumbnailOverlays.some(overlay => 
        overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS' ||
        overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText === 'SHORTS'
      );
      if (hasShortsBadge) return true;
    }
    
    // Check navigation endpoint for shorts
    const navEndpoint = item.videoRenderer.navigationEndpoint;
    if (navEndpoint?.reelWatchEndpoint || 
        navEndpoint?.commandMetadata?.webCommandMetadata?.url?.includes('/shorts/')) {
      return true;
    }
  }
  
  // Method 3: Check richItemRenderer for shorts (newer format)
  if (item.richItemRenderer?.content?.reelItemRenderer) {
    return true;
  }
  
  // Method 4: Check gridVideoRenderer
  if (item.gridVideoRenderer) {
    if (item.gridVideoRenderer.thumbnailOverlays) {
      const hasShortsBadge = item.gridVideoRenderer.thumbnailOverlays.some(overlay =>
        overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS'
      );
      if (hasShortsBadge) return true;
    }
  }
  
  // Method 5: Check compactVideoRenderer
  if (item.compactVideoRenderer) {
    if (item.compactVideoRenderer.thumbnailOverlays) {
      const hasShortsBadge = item.compactVideoRenderer.thumbnailOverlays.some(overlay =>
        overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS'
      );
      if (hasShortsBadge) return true;
    }
  }
  
  return false;
}

function processShelves(shelves, shouldAddPreviews = true) {
  const ENABLE_SHELF_DEBUG = configRead('enableDebugConsole'); // Changed to use config
  
  if (!Array.isArray(shelves)) {
    console.warn('[SHELF_PROCESS] processShelves called with non-array', { type: typeof shelves });
    return;
  }
  
  const page = getCurrentPage();
  const shortsEnabled = configRead('enableShorts');
  const hideWatchedEnabled = configRead('enableHideWatchedVideos');
  const configPages = configRead('hideWatchedVideosPages') || [];
  const shouldHideWatched = hideWatchedEnabled && (configPages.length === 0 || configPages.includes(page));
  
  console.log('[SHELF] Page:', page, '| Shelves:', shelves.length, '| Hide:', shouldHideWatched, '| Shorts:', shortsEnabled);

  if (window._lastLoggedPage !== page) {
    console.log('[PAGE_DEBUG] ========================================');
    console.log('[PAGE_DEBUG] Page changed to:', page);
    console.log('[PAGE_DEBUG] URL:', window.location.href);
    console.log('[PAGE_DEBUG] Hash:', window.location.hash);
    console.log('[PAGE_DEBUG] ========================================');
    window._lastLoggedPage = page;
  }
  
  let totalItemsBefore = 0;
  let totalItemsAfter = 0;
  let shelvesRemoved = 0;
  let totalHidden = 0;
  let totalShortsRemoved = 0;
  
  for (let i = shelves.length - 1; i >= 0; i--) {
    try {
      const shelve = shelves[i];
      if (!shelve) continue;
      
      let shelfType = 'unknown';
      let itemsBefore = 0;
      let itemsAfter = 0;
      
      // Handle shelfRenderer
      if (shelve.shelfRenderer) {
        // horizontalListRenderer
        if (shelve.shelfRenderer.content?.horizontalListRenderer?.items) {
          shelfType = 'hList';
          let items = shelve.shelfRenderer.content.horizontalListRenderer.items;
          itemsBefore = items.length;
          
          if (ENABLE_SHELF_DEBUG) {
            if (items && items.length > 0 && items[0]) {
              console.log('[DEBUG_TIZEN] Shelf type:', shelfType);
              console.log('[DEBUG_TIZEN] Sample item:', JSON.stringify(items[0], null, 2));
              console.log('[DEBUG_TIZEN] Has progressBar:', !!findProgressBar(items[0]));
              console.log('[DEBUG_TIZEN] Is short:', isShortItem(items[0]));
            } else {
              console.log('[DEBUG_TIZEN] Shelf type:', shelfType, '(empty - no items to sample)');
            }
          }
                    
          deArrowify(items);
          hqify(items);
          addLongPress(items);
          if (shouldAddPreviews) addPreviews(items);
          
          if (!shortsEnabled) {
            if (shelve.shelfRenderer.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS') {
              console.log('[SHELF_PROCESS] Removing entire SHORTS shelf');
              shelves.splice(i, 1);
              shelvesRemoved++;
              totalShortsRemoved += itemsBefore;
              totalItemsBefore += itemsBefore;
              continue;
            }
            
            const beforeShortFilter = items.length;
            items = items.filter(item => !isShortItem(item));
            totalShortsRemoved += (beforeShortFilter - items.length);
          }
          
          const beforeHide = items.length;
          items = hideVideo(items);
          totalHidden += (beforeHide - items.length);
          itemsAfter = items.length;
          
          shelve.shelfRenderer.content.horizontalListRenderer.items = items;
          
          if (items.length === 0) {
            console.log('[SHELF_PROCESS] Shelf now empty, removing');
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

          if (ENABLE_SHELF_DEBUG) {
            if (items && items.length > 0 && items[0]) {
              console.log('[DEBUG_TIZEN] Shelf type:', shelfType);
              console.log('[DEBUG_TIZEN] Sample item:', JSON.stringify(items[0], null, 2));
              console.log('[DEBUG_TIZEN] Has progressBar:', !!findProgressBar(items[0]));
              console.log('[DEBUG_TIZEN] Is short:', isShortItem(items[0]));
            } else {
              console.log('[DEBUG_TIZEN] Shelf type:', shelfType, '(empty - no items to sample)');
            }
          }

          deArrowify(items);
          hqify(items);
          addLongPress(items);
          if (shouldAddPreviews) addPreviews(items);
          
          if (!shortsEnabled) {
            const beforeShortFilter = items.length;
            items = items.filter(item => !isShortItem(item));
            totalShortsRemoved += (beforeShortFilter - items.length);
          }
          
          const beforeHide = items.length;
          items = hideVideo(items);
          totalHidden += (beforeHide - items.length);
          itemsAfter = items.length;
          
          shelve.shelfRenderer.content.gridRenderer.items = items;
          
          if (items.length === 0) {
            console.log('[SHELF_PROCESS] Shelf now empty, removing');
            shelves.splice(i, 1);
            shelvesRemoved++;
            continue;
          }
        }

        // verticalListRenderer
        else if (shelve.shelfRenderer.content?.verticalListRenderer?.items) {
          shelfType = 'vList';
          let items = shelve.shelfRenderer.content.verticalListRenderer.items;
          itemsBefore = items.length;

          if (ENABLE_SHELF_DEBUG) {
            if (items && items.length > 0 && items[0]) {
              console.log('[DEBUG_TIZEN] Shelf type:', shelfType);
              console.log('[DEBUG_TIZEN] Sample item:', JSON.stringify(items[0], null, 2));
              console.log('[DEBUG_TIZEN] Has progressBar:', !!findProgressBar(items[0]));
              console.log('[DEBUG_TIZEN] Is short:', isShortItem(items[0]));
            } else {
              console.log('[DEBUG_TIZEN] Shelf type:', shelfType, '(empty - no items to sample)');
            }
          }

          deArrowify(items);
          hqify(items);
          addLongPress(items);
          if (shouldAddPreviews) addPreviews(items);
          
          if (!shortsEnabled) {
            const beforeShortFilter = items.length;
            items = items.filter(item => !isShortItem(item));
            totalShortsRemoved += (beforeShortFilter - items.length);
          }
          
          const beforeHide = items.length;
          items = hideVideo(items);
          totalHidden += (beforeHide - items.length);
          itemsAfter = items.length;
          
          shelve.shelfRenderer.content.verticalListRenderer.items = items;
          
          if (items.length === 0) {
            console.log('[SHELF_PROCESS] Shelf now empty, removing');
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

        if (ENABLE_SHELF_DEBUG) {
          if (contents && contents.length > 0 && contents[0]) {
            console.log('[DEBUG_TIZEN] Shelf type:', shelfType);
            console.log('[DEBUG_TIZEN] Sample item:', JSON.stringify(contents[0], null, 2));
            console.log('[DEBUG_TIZEN] Has progressBar:', !!findProgressBar(contents[0]));
            console.log('[DEBUG_TIZEN] Is short:', isShortItem(contents[0]));
          } else {
            console.log('[DEBUG_TIZEN] Shelf type:', shelfType, '(empty - no items to sample)');
          }
        }

        deArrowify(contents);
        hqify(contents);
        addLongPress(contents);
        if (shouldAddPreviews) addPreviews(contents);
        
        if (!shortsEnabled) {
          const beforeShortFilter = contents.length;
          contents = contents.filter(item => !isShortItem(item));
          totalShortsRemoved += (beforeShortFilter - contents.length);
        }
        
        const beforeHide = contents.length;
        contents = hideVideo(contents);
        totalHidden += (beforeHide - contents.length);
        itemsAfter = contents.length;
        
        shelve.richShelfRenderer.content.richGridRenderer.contents = contents;
        
        if (contents.length === 0) {
          shelves.splice(i, 1);
          shelvesRemoved++;
          continue;
        }
      }

      // Handle richSectionRenderer
      else if (shelve.richSectionRenderer?.content?.richShelfRenderer) {
        shelfType = 'richSec';
        
        if (!shortsEnabled) {
          const innerShelf = shelve.richSectionRenderer.content.richShelfRenderer;
          const contents = innerShelf?.content?.richGridRenderer?.contents;
          
          if (Array.isArray(contents) && contents.some(item => isShortItem(item))) {
            console.log('[SHELF_PROCESS] Removing shorts richSection shelf');
            shelves.splice(i, 1);
            shelvesRemoved++;
            continue;
          }
        }
      }

      // Handle gridRenderer at shelf level
      else if (shelve.gridRenderer?.items) {
        shelfType = 'topGrid';
        let items = shelve.gridRenderer.items;
        itemsBefore = items.length;

        if (ENABLE_SHELF_DEBUG) {
          if (items && items.length > 0 && items[0]) {
            console.log('[DEBUG_TIZEN] Shelf type:', shelfType);
            console.log('[DEBUG_TIZEN] Sample item:', JSON.stringify(items[0], null, 2));
            console.log('[DEBUG_TIZEN] Has progressBar:', !!findProgressBar(items[0]));
            console.log('[DEBUG_TIZEN] Is short:', isShortItem(items[0]));
          } else {
            console.log('[DEBUG_TIZEN] Shelf type:', shelfType, '(empty - no items to sample)');
          }
        }

        deArrowify(items);
        hqify(items);
        addLongPress(items);
        if (shouldAddPreviews) addPreviews(items);
        
        if (!shortsEnabled) {
          const beforeShortFilter = items.length;
          items = items.filter(item => !isShortItem(item));
          totalShortsRemoved += (beforeShortFilter - items.length);
        }
        
        const beforeHide = items.length;
        items = hideVideo(items);
        totalHidden += (beforeHide - items.length);
        itemsAfter = items.length;
        
        shelve.gridRenderer.items = items;
        
        if (items.length === 0) {
          console.log('[SHELF_PROCESS] Shelf now empty, removing');
          shelves.splice(i, 1);
          shelvesRemoved++;
          continue;
        }
      }
      
      totalItemsBefore += itemsBefore;
      totalItemsAfter += itemsAfter;
      
    } catch (error) {
      console.log('[SHELF] ERROR shelf', (shelves.length - i), ':', error.message);
    }
  }
  
  // Single summary line
  console.log('[SHELF] Done:', totalItemsBefore, '→', totalItemsAfter, '| Hidden:', totalHidden, '| Shorts:', totalShortsRemoved, '| Removed:', shelvesRemoved, 'shelves');
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
    //if (item.tileRenderer.style !== 'TILE_STYLE_YTLR_DEFAULT') continue;
    if (configRead('enableHqThumbnails')) {
      if (!item.tileRenderer.onSelectCommand?.watchEndpoint?.videoId) continue;
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
    //if (item.tileRenderer.style !== 'TILE_STYLE_YTLR_DEFAULT') continue;
    // Skip non-video tiles (channels, playlists, etc)
    if (item.tileRenderer.contentType && 
        item.tileRenderer.contentType !== 'TILE_CONTENT_TYPE_VIDEO') {
      continue;
    }
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
  const debugEnabled = configRead('enableDebugConsole');
  
  // ⭐ DIAGNOSTIC: Log entry
  if (debugEnabled) {
    console.log('[HIDE] ========================================');
    console.log('[HIDE] hideVideo() called with', items ? items.length : 0, 'items');
  }
  
  if (!configRead('enableHideWatchedVideos') || !Array.isArray(items)) {
    if (debugEnabled) {
      console.log('[HIDE] SKIPPED - enableHideWatchedVideos:', configRead('enableHideWatchedVideos'));
      console.log('[HIDE] SKIPPED - items is array:', Array.isArray(items));
    }
    return items;
  }
  
  const page = getCurrentPage();
  const configPages = configRead('hideWatchedVideosPages') || [];
  const threshold = Number(configRead('hideWatchedVideosThreshold') || 0);

  // ⭐ DIAGNOSTIC: Log configuration
  if (debugEnabled) {
    console.log('[HIDE] Current page:', page);
    console.log('[HIDE] Configured pages:', configPages);
    console.log('[HIDE] Threshold:', threshold + '%');
  }

  if (window._lastLoggedPage !== page) {
    console.log('[PAGE_DEBUG] ========================================');
    console.log('[PAGE_DEBUG] Page changed to:', page);
    console.log('[PAGE_DEBUG] URL:', window.location.href);
    console.log('[PAGE_DEBUG] Hash:', window.location.hash);
    console.log('[PAGE_DEBUG] ========================================');
    window._lastLoggedPage = page;
  }
  
  // Special handling for playlists
  if (page === 'playlist' || page === 'playlists') {
    if (!configRead('enableHideWatchedInPlaylists')) {
      if (debugEnabled) console.log('[HIDE] Playlist filtering disabled by config');
      return items;
    }
    if (debugEnabled) console.log('[HIDE] Filtering playlist page (config enabled)');
  }
  
  // Check if this page should be filtered
  const shouldHideOnThisPage = configPages.length === 0 || 
                                configPages.includes(page) ||
                                (page === 'playlist' && configRead('enableHideWatchedInPlaylists'));
  
  if (!shouldHideOnThisPage) {
    if (debugEnabled) console.log('[HIDE] Page', page, 'not in filter list');
    return items;
  }
  
  if (debugEnabled) {
    console.log('[HIDE] ✓ Filtering enabled for page:', page);
    console.log('[HIDE] Threshold:', threshold + '%');
  }
  
  let hiddenCount = 0;
  
  const filtered = items.filter(item => {
    if (!item) return false;
    
    // Skip non-video items
    if (item.tileRenderer?.contentType && 
        item.tileRenderer.contentType !== 'TILE_CONTENT_TYPE_VIDEO') {
      return true;
    }
    
    const progressBar = findProgressBar(item);
    if (!progressBar) return true;
    
    const percentWatched = Number(progressBar.percentDurationWatched || 0);
    if (percentWatched >= threshold) {
      hiddenCount++;
      const videoId = item.tileRenderer?.contentId || 
                     item.videoRenderer?.videoId || 
                     'unknown';
      
      if (debugEnabled) {
        console.log('[HIDE] Hiding:', videoId, '(' + percentWatched + '%)');
      }
      return false;
    }
    
    return true;
  });
  
  if (debugEnabled || hiddenCount > 0) {
    console.log('[HIDE] Total hidden:', hiddenCount, 'videos on page:', page);
    console.log('[HIDE] Before:', items.length, '→ After:', filtered.length);
  }
  
  return filtered;
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
  
  // ⭐ PRIORITY 1: Check browse parameters (Tizen TV uses these!)
  
  // Subscriptions
  if (browseParam.includes('fesubscription')) {
    detectedPage = 'subscriptions';
  }
  
  // Library and its sub-pages
  else if (browseParam === 'felibrary') {
    detectedPage = 'library';
  }
  else if (browseParam === 'fehistory') {
    detectedPage = 'history';
  }
  else if (browseParam === 'femy_youtube') {
    detectedPage = 'playlist'; // Watch Later via library tab
  }
  else if (browseParam === 'feplaylist_aggregation') {
    detectedPage = 'playlists';
  }
  
  // Individual playlists (VL prefix = Video List)
  else if (browseParam.startsWith('vlpl')) {
    detectedPage = 'playlist'; // User playlist
  }
  else if (browseParam === 'vlwl') {
    detectedPage = 'playlist'; // Watch Later
  }
  else if (browseParam === 'vlll') {
    detectedPage = 'playlist'; // Liked Videos
  }
  
  // Trending
  else if (browseParam.includes('fetrending')) {
    detectedPage = 'trending';
  }
  
  // Topics (home variations)
  else if (browseParam.includes('fetopics_music') || browseParam.includes('music')) {
    detectedPage = 'music';
  }
  else if (browseParam.includes('fetopics_gaming') || browseParam.includes('gaming')) {
    detectedPage = 'gaming';
  }
  else if (browseParam.includes('fetopics')) {
    detectedPage = 'home';
  }
  
  // Channel pages
  else if (browseParam.startsWith('uc') && browseParam.length > 10) {
    detectedPage = 'channel';
  }
  
  // ⭐ PRIORITY 2: Check /feed/ paths (desktop/mobile browsers)
  else if (cleanHash.includes('/feed/subscriptions') || combined.includes('/feed/subscriptions')) {
    detectedPage = 'subscriptions';
  }
  else if (cleanHash.includes('/feed/history') || combined.includes('/feed/history')) {
    detectedPage = 'history';
  }
  else if (cleanHash.includes('/feed/trending') || combined.includes('/feed/trending')) {
    detectedPage = 'trending';
  }
  else if (cleanHash.includes('/feed/playlists') || combined.includes('/feed/playlists')) {
    detectedPage = 'playlists';
  }
  else if (cleanHash.includes('/feed/library') || cleanHash.includes('/library')) {
    detectedPage = 'library';
  }
  
  // ⭐ PRIORITY 3: Check traditional patterns
  else if (cleanHash.includes('/playlist') || combined.includes('list=')) {
    detectedPage = 'playlist';
  }
  else if (cleanHash.includes('/results') || cleanHash.includes('/search')) {
    detectedPage = 'search';
  }
  else if (cleanHash.includes('/watch')) {
    detectedPage = 'watch';
  }
  else if (cleanHash.includes('/@') || cleanHash.includes('/channel/')) {
    detectedPage = 'channel';
  }
  else if (cleanHash.includes('/browse') && !browseParam) {
    detectedPage = 'home';
  }
  else if (cleanHash === '' || cleanHash === '/') {
    detectedPage = 'home';
  }
  
  // Logging
  const fullUrl = location.href;
  const lastDetectedPage = window._lastDetectedPage;
  const lastFullUrl = window._lastFullUrl;
  
  if (detectedPage !== lastDetectedPage || fullUrl !== lastFullUrl) {
    const debugEnabled = configRead('enableDebugConsole');
    if (debugEnabled) {
      console.log(`[PAGE] ${lastDetectedPage||'initial'} → ${detectedPage}`);
      console.log(`[PAGE] Hash: "${cleanHash}"`);
      if (browseParam) console.log(`[PAGE] Browse param: "${browseParam}"`);
    }
    
    window._lastDetectedPage = detectedPage;
    window._lastFullUrl = fullUrl;
  }
  
  return detectedPage;
}

function forceProcessPage(r, pageType) {
  // This function FORCES processing regardless of flags
  const debugEnabled = configRead('enableDebugConsole');
  
  if (debugEnabled) {
    console.log('[FORCE] ========================================');
    console.log('[FORCE] Forcing processing for page:', pageType);
    console.log('[FORCE] ========================================');
  }
  
  // Try to find ANY shelves in the response
  let shelves = null;
  
  // Method 1: tvBrowseRenderer (most pages)
  if (r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents) {
    shelves = r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents;
    if (debugEnabled) console.log('[FORCE] Found shelves via tvBrowseRenderer:', shelves.length);
  }
  
  // Method 2: sectionListRenderer (some pages)
  else if (r?.contents?.sectionListRenderer?.contents) {
    shelves = r.contents.sectionListRenderer.contents;
    if (debugEnabled) console.log('[FORCE] Found shelves via sectionListRenderer:', shelves.length);
  }
  
  // Method 3: twoColumnBrowseResultsRenderer (playlists)
  else if (r?.contents?.twoColumnBrowseResultsRenderer?.tabs) {
    const tabs = r.contents.twoColumnBrowseResultsRenderer.tabs;
    tabs.forEach((tab, idx) => {
      if (tab.tabRenderer?.content?.sectionListRenderer?.contents) {
        shelves = tab.tabRenderer.content.sectionListRenderer.contents;
        if (debugEnabled) console.log('[FORCE] Found shelves in tab', idx, ':', shelves.length);
      }
    });
  }
  
  // Method 4: tvSecondaryNavRenderer (subscriptions with tabs)
  else if (r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
    const sections = r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections;
    if (debugEnabled) console.log('[FORCE] Found secondary nav with', sections.length, 'sections');
    
    sections.forEach((section, sIdx) => {
      if (section.tvSecondaryNavSectionRenderer?.tabs) {
        section.tvSecondaryNavSectionRenderer.tabs.forEach((tab, tIdx) => {
          const tabShelves = tab.tabRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents;
          if (tabShelves && tabShelves.length > 0) {
            if (debugEnabled) console.log('[FORCE] Processing tab', tIdx, 'with', tabShelves.length, 'shelves');
            processShelves(tabShelves);
          }
        });
      }
    });
  }
  
  // If we found shelves, process them
  if (shelves && Array.isArray(shelves) && shelves.length > 0) {
    if (debugEnabled) console.log('[FORCE] Calling processShelves with', shelves.length, 'items');
    try {
      processShelves(shelves);
      if (debugEnabled) console.log('[FORCE] processShelves completed successfully');
    } catch (error) {
      console.error('[FORCE] ERROR in processShelves:', error.message);
      console.error('[FORCE] Stack:', error.stack);
    }
  } else {
    if (debugEnabled) console.log('[FORCE] ⚠️  NO SHELVES FOUND in response');
  }
}