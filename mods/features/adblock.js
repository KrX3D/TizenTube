import { configRead } from '../config.js';
import Chapters from '../ui/chapters.js';
import resolveCommand from '../resolveCommand.js';
import { timelyAction, longPressData, MenuServiceItemRenderer, ShelfRenderer, TileRenderer, ButtonRenderer } from '../ui/ytUI.js';
import { PatchSettings } from '../ui/customYTSettings.js';

// ⭐ CONFIGURATION: Set these to control logging output
const LOG_SHORTS = false;   // Set false to disable shorts logging  
const LOG_WATCHED = true;  // Set false to disable watched video logging

// ⭐ PERFORMANCE: Read debug setting ONCE and cache it globally
// Updated automatically via config change events
let DEBUG_ENABLED = configRead('enableDebugConsole');

// ⭐ EXPOSE: Allow external code to update the cache
window.adblock = window.adblock || {};
window.adblock.setDebugEnabled = function(value) {
    DEBUG_ENABLED = value;
    console.log('[CONFIG] Debug console ' + (DEBUG_ENABLED ? 'ENABLED' : 'DISABLED'));
};

// Listen for config changes to update DEBUG_ENABLED cache
if (typeof window !== 'undefined') {
  setTimeout(() => {
    if (window.configChangeEmitter) {
      window.configChangeEmitter.addEventListener('configChange', (e) => {
        if (e.detail?.key === 'enableDebugConsole') {
          DEBUG_ENABLED = e.detail.value;
          console.log('[CONFIG] Debug console ' + (DEBUG_ENABLED ? 'ENABLED' : 'DISABLED'));
        }
      });
    }
  }, 100);
}

// ⭐ NO CSS HIDING - Helpers will be visible, but that's OK
// Trying to hide them causes empty space and layout issues
function trackRemovedPlaylistHelpers(helperIds) {
  if (!window._playlistRemovedHelpers) {
    window._playlistRemovedHelpers = new Set();
  }
  if (!window._playlistRemovedHelperQueue) {
    window._playlistRemovedHelperQueue = [];
  }

  helperIds.forEach((helperId) => {
    if (!helperId || helperId === 'unknown') return;
    if (!window._playlistRemovedHelpers.has(helperId)) {
      window._playlistRemovedHelpers.add(helperId);
      window._playlistRemovedHelperQueue.push(helperId);
    }
  });

  const MAX_REMOVED_HELPERS = 25;
  while (window._playlistRemovedHelperQueue.length > MAX_REMOVED_HELPERS) {
    const oldest = window._playlistRemovedHelperQueue.shift();
    window._playlistRemovedHelpers.delete(oldest);
  }
}

function directFilterArray(arr, page, context = '') {
  if (!Array.isArray(arr) || arr.length === 0) return arr;
  
  // ⭐ Check if this is a playlist page
  const isPlaylistPage = (page === 'playlist');
  
  // ⭐ FILTER MODE: Only show videos from our collected list
  const filterIds = getFilteredVideoIds();
  
  if (isPlaylistPage && filterIds) {
    console.log('[FILTER_MODE] 🔄 Active - filtering to', filterIds.size, 'unwatched videos');
    
    const filtered = arr.filter(item => {
      const videoId = item.tileRenderer?.contentId || 
                     item.videoRenderer?.videoId || 
                     item.playlistVideoRenderer?.videoId ||
                     item.gridVideoRenderer?.videoId ||
                     item.compactVideoRenderer?.videoId;
      
      const keep = filterIds.has(videoId);
      if (!keep && videoId) {
        console.log('[FILTER_MODE] 🔄 Hiding (not in unwatched list):', videoId);
      }
      return keep;
    });
    
    console.log('[FILTER_MODE] 🔄 Kept', filtered.length, 'of', arr.length, 'videos');
    return filtered;
  }
  
  const shortsEnabled = configRead('enableShorts');
  const hideWatchedEnabled = configRead('enableHideWatchedVideos');
  const configPages = configRead('hideWatchedVideosPages') || [];
  const threshold = Number(configRead('hideWatchedVideosThreshold') || 0);
  
  // Check if we should filter watched videos on this page (EXACT match)
  const shouldHideWatched = hideWatchedEnabled && (configPages.length === 0 || configPages.includes(page));
  
  // Shorts filtering is INDEPENDENT - always check if shorts are disabled
  const shouldFilterShorts = !shortsEnabled;
  
  // Skip if nothing to do
  if (!shouldFilterShorts && !shouldHideWatched) {
    return arr;
  }
  
  // Generate unique call ID for debugging
  const callId = Math.random().toString(36).substr(2, 6);
  
  // ⭐ Initialize scroll helpers tracker
  if (!window._playlistScrollHelpers) {
    window._playlistScrollHelpers = new Set();
  }
  if (!window._lastHelperVideos) {
    window._lastHelperVideos = [];
  }
  if (!window._playlistRemovedHelpers) {
    window._playlistRemovedHelpers = new Set();
  }
  
  // ⭐ DIAGNOSTIC: Log what we're checking
  if (isPlaylistPage && DEBUG_ENABLED) {
    console.log('>>>>>> PRE-CLEANUP CHECK <<<<<<');
    console.log('>>>>>> Has helpers:', window._lastHelperVideos?.length || 0);
    console.log('>>>>>> Array length:', arr.length);
    console.log('>>>>>> Context:', context);
    console.log('>>>>>> Last batch flag:', window._isLastPlaylistBatch);
    console.log('>>>>>> Collection mode:', isInCollectionMode());
  }

  // ⭐ NEW: Check if this is the LAST batch (using flag from response level)
  let isLastBatch = false;
  if (isPlaylistPage && window._isLastPlaylistBatch === true) {
    console.log('--------------------------------->> Using last batch flag from response');
    console.log('--------------------------------->> This IS the last batch!');
    isLastBatch = true;
    // Clear the flag
    window._isLastPlaylistBatch = false;
  }

  // ⭐ FIXED: Trigger cleanup when we have stored helpers AND this is a new batch with content
  if (isPlaylistPage && window._lastHelperVideos.length > 0 && arr.length > 0) {
    console.log('[CLEANUP_TRIGGER] New batch detected! Stored helpers:', window._lastHelperVideos.length, '| new videos:', arr.length);
    
    // Store the helper IDs for filtering
    const helperIdsToRemove = window._lastHelperVideos.map(video => 
      video.tileRenderer?.contentId || 
      video.videoRenderer?.videoId || 
      video.playlistVideoRenderer?.videoId ||
      video.gridVideoRenderer?.videoId ||
      video.compactVideoRenderer?.videoId ||
      'unknown'
    );
    
    console.log('[CLEANUP] Helper IDs to remove:', helperIdsToRemove);
    
    // ⭐ DON'T insert helpers into new batch - they're already rendered!
    // Just track them for removal if they appear
    trackRemovedPlaylistHelpers(helperIdsToRemove);
    
    // Clear helpers immediately (don't wait for last batch)
    if (!isLastBatch) {
      window._lastHelperVideos = [];
      window._playlistScrollHelpers.clear();
      console.log('[CLEANUP] Helpers cleared');
    }
  }
  
  // ⭐ DEBUG: Log configuration
  if (DEBUG_ENABLED && (shouldFilterShorts || shouldHideWatched)) {
    console.log('[FILTER_START #' + callId + '] ========================================');
    console.log('[FILTER_START #' + callId + '] Context:', context);
    console.log('[FILTER_START #' + callId + '] Page:', page);
    console.log('[FILTER_START #' + callId + '] Is Playlist:', isPlaylistPage);
    console.log('[FILTER_START #' + callId + '] Total items:', arr.length);
    console.log('[FILTER_CONFIG #' + callId + '] Threshold:', threshold + '%');
    console.log('[FILTER_CONFIG #' + callId + '] Hide watched:', shouldHideWatched);
    console.log('[FILTER_CONFIG #' + callId + '] Filter shorts:', shouldFilterShorts);
  }
  
  let hiddenCount = 0;
  let shortsCount = 0;
  let noProgressBarCount = 0;
  const originalLength = arr.length;
  
  const filtered = arr.filter(item => {
    if (!item) return true;
    
    // Check if it's a video item
    const isVideoItem = item.tileRenderer || 
                        item.videoRenderer || 
                        item.gridVideoRenderer ||
                        item.compactVideoRenderer ||
                        item.playlistVideoRenderer ||
                        item.richItemRenderer?.content?.videoRenderer;
    
    if (!isVideoItem) return true;
    
    const videoId = item.tileRenderer?.contentId || 
                   item.videoRenderer?.videoId || 
                   item.playlistVideoRenderer?.videoId ||
                   item.gridVideoRenderer?.videoId ||
                   item.compactVideoRenderer?.videoId ||
                   'unknown';

    if (isPlaylistPage && window._playlistRemovedHelpers.has(videoId)) {
      if (DEBUG_ENABLED) {
        console.log('[HELPER_CLEANUP] Removing stale helper from data:', videoId);
      }
      return false;
    }
    
    // ⭐ STEP 1: Filter shorts FIRST (before checking progress bars)
    if (shouldFilterShorts && isShortItem(item)) {
      shortsCount++;
      
      // ⭐ ADD VISUAL MARKER
      console.log('✂️✂️✂️ SHORT REMOVED:', videoId, '| Page:', page);

      if (LOG_SHORTS && DEBUG_ENABLED) {
        console.log('[FILTER #' + callId + '] REMOVED SHORT:', videoId);
      }
      return false;
    }
    
    // ⭐ STEP 2: Filter watched videos (only if enabled for this page)
    if (shouldHideWatched) {
      const progressBar = findProgressBar(item);
      
      // ⭐ PLAYLIST SPECIAL HANDLING: Only filter if progress bar EXISTS
      if (isPlaylistPage) {
        if (!progressBar) {
          // No progress bar = unwatched = KEEP IT
          noProgressBarCount++;
          
          if (LOG_WATCHED && DEBUG_ENABLED) {
            console.log('[FILTER #' + callId + '] ✓ KEEPING (playlist, no progress):', videoId);
          }
          return true;
        }
      }
      
      // Calculate progress percentage
      const percentWatched = progressBar ? Number(progressBar.percentDurationWatched || 0) : 0;
      
      // ⭐ DEBUG: Log each decision
      if (LOG_WATCHED && DEBUG_ENABLED) {
        const hasProgressBar = !!progressBar;
        const decision = percentWatched >= threshold ? '❌ HIDING' : '✓ KEEPING';
        console.log('[FILTER #' + callId + '] ' + decision + ':', videoId, '| Progress:', percentWatched + '%', '| Threshold:', threshold + '%');
      }
      
      // Hide if watched above threshold
      if (percentWatched >= threshold) {
        hiddenCount++;
        return false;
      }
    }
    
    return true;
  });
  
  // ⭐ Enhanced summary logging
  if (DEBUG_ENABLED) {
    console.log('[FILTER_END #' + callId + '] ========================================');
    console.log('[FILTER_END #' + callId + '] Original count:', originalLength);
    console.log('[FILTER_END #' + callId + '] Final count:', filtered.length);
    console.log('[FILTER_END #' + callId + '] Removed total:', (originalLength - filtered.length));
    console.log('[FILTER_END #' + callId + '] ├─ Watched removed:', hiddenCount);
    console.log('[FILTER_END #' + callId + '] ├─ Shorts removed:', shortsCount);
    if (shortsCount > 0) {
      console.log('✂️✂️✂️ TOTAL SHORTS FILTERED THIS BATCH:', shortsCount);
    }
    if (isPlaylistPage) {
      console.log('[FILTER_END #' + callId + '] └─ Unwatched kept (no progress):', noProgressBarCount);
    }
    console.log('[FILTER_END #' + callId + '] ========================================');
  }
  
  // ⭐ PLAYLIST SAFEGUARD: Keep 1 video if ALL were filtered (to enable scrolling)
  if (isPlaylistPage && filtered.length === 0 && arr.length > 0 && !isLastBatch) {
    
    // ⭐ CHECK: Are we in filter mode? If so, NO helpers needed!
    if (filterIds) {
      console.log('[FILTER_MODE] 🔄 All filtered in this batch - no helpers needed (filter mode active)');
      return [];  // Return empty - we're showing only specific videos
    }
    
    // ⭐ NORMAL MODE: Keep helper for scrolling
    const lastVideo = arr[arr.length - 1];
    const lastVideoId = lastVideo.tileRenderer?.contentId || 
                      lastVideo.videoRenderer?.videoId || 
                      lastVideo.playlistVideoRenderer?.videoId ||
                      lastVideo.gridVideoRenderer?.videoId ||
                      lastVideo.compactVideoRenderer?.videoId ||
                      'unknown';
    
    console.log('[HELPER] ALL FILTERED - Keeping 1 helper:', lastVideoId);
    
    // ⭐ MARK the helper with a special title so we can identify it visually
    if (lastVideo.tileRenderer?.metadata?.tileMetadataRenderer?.title) {
      const originalTitle = lastVideo.tileRenderer.metadata.tileMetadataRenderer.title.simpleText;
      lastVideo.tileRenderer.metadata.tileMetadataRenderer.title.simpleText = '⏩ SCROLL HELPER - ' + originalTitle;
    }
    
    // Store it
    window._lastHelperVideos = [lastVideo];
    window._playlistScrollHelpers.clear();
    window._playlistScrollHelpers.add(lastVideoId);
    
    console.log('[HELPER] Stored NEW helper (replaced old). Helper ID:', lastVideoId);
    
    return [lastVideo];
  }
  
  // ⭐ COLLECTION MODE: Track unwatched videos
  if (isPlaylistPage && isInCollectionMode()) {
    // Collect all unwatched video IDs from this batch
    filtered.forEach(item => {
      const videoId = item.tileRenderer?.contentId || 
                     item.videoRenderer?.videoId || 
                     item.playlistVideoRenderer?.videoId ||
                     item.gridVideoRenderer?.videoId ||
                     item.compactVideoRenderer?.videoId;
      
      if (videoId && !window._collectedUnwatched.includes(videoId)) {
        window._collectedUnwatched.push(videoId);
      }
    });
    
    console.log('[COLLECTION] 🔄 Batch complete. Total unwatched collected:', window._collectedUnwatched.length);
  }
  
  // ⭐ If we found unwatched videos, clear stored helpers (we don't need them anymore)
  if (isPlaylistPage && filtered.length > 0 && noProgressBarCount > 0) {
    if (window._lastHelperVideos && window._lastHelperVideos.length > 0) {
      if (DEBUG_ENABLED) {
        console.log('[CLEANUP] Found', noProgressBarCount, 'unwatched - clearing', window._lastHelperVideos.length, 'stored helper(s)');
      }
      window._lastHelperVideos = [];
      window._playlistScrollHelpers.clear();
    }
  }
  
  // ⭐ Clean up after filtering if last batch
  if (isLastBatch && isPlaylistPage) {
    console.log('--------------------------------->> FINAL CLEANUP (last batch detected)');
    console.log('--------------------------------->> Clearing all helpers and trackers');
    window._lastHelperVideos = [];
    window._playlistScrollHelpers.clear();
    if (window._playlistRemovedHelpers) {
      window._playlistRemovedHelpers.clear();
    }
    if (window._playlistRemovedHelperQueue) {
      window._playlistRemovedHelperQueue = [];
    }
    console.log('--------------------------------->> All helpers cleared!');
  }
  
  return filtered;
}

function scanAndFilterAllArrays(obj, page, path = 'root') {
  if (!obj || typeof obj !== 'object') return;
  
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
      if (DEBUG_ENABLED) {
        console.log('[SCAN] Found video array at:', path, '| Length:', obj.length);
      }
      return directFilterArray(obj, page, path);
    }
    
    // Check if this is a shelves array - remove empty shelves after filtering
    const hasShelves = obj.some(item =>
      item?.shelfRenderer ||
      item?.richShelfRenderer ||
      item?.gridRenderer
    );
    
    if (hasShelves) {
      const shortsEnabled = configRead('enableShorts');
      
      // ⭐ FIRST: Remove Shorts shelves by title (before recursive filtering)
      if (!shortsEnabled) {
        for (let i = obj.length - 1; i >= 0; i--) {
          const shelf = obj[i];
          const shelfTitle = getShelfTitle(shelf);

          // ⭐ EXACT MATCH: Only remove if title is EXACTLY "Shorts" (not "Daily Shorts" etc.)
          if (shelfTitle && shelfTitle.trim().toLowerCase() === 'shorts') {
            console.log('✂️✂️✂️ REMOVING SHELF WITH EXACT TITLE "SHORTS":', shelfTitle);
            if (DEBUG_ENABLED) {
              console.log('[SHELF_PROCESS] Removing Shorts shelf by exact title match');
            }
            obj.splice(i, 1);
            continue;
          }

          // ⭐ Also log when we DON'T remove (for debugging)
          if (shelfTitle && shelfTitle.toLowerCase().includes('short')) {
            console.log('🔍 NOT removing shelf (contains "short" but not exact match):', shelfTitle);
          }
        }
      }
      
      // Filter shelves recursively
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          const value = obj[key];
          if (value && typeof value === 'object') {
            scanAndFilterAllArrays(value, page, path + '[' + key + ']');
          }
        }
      }
      
      // Then remove empty shelves
      for (let i = obj.length - 1; i >= 0; i--) {
        const shelf = obj[i];
        if (!shelf) {
          obj.splice(i, 1);
          continue;
        }
        
        let isEmpty = false;
        
        if (shelf.shelfRenderer?.content?.horizontalListRenderer?.items) {
          isEmpty = shelf.shelfRenderer.content.horizontalListRenderer.items.length === 0;
        } else if (shelf.shelfRenderer?.content?.gridRenderer?.items) {
          isEmpty = shelf.shelfRenderer.content.gridRenderer.items.length === 0;
        } else if (shelf.shelfRenderer?.content?.verticalListRenderer?.items) {
          isEmpty = shelf.shelfRenderer.content.verticalListRenderer.items.length === 0;
        } else if (shelf.richShelfRenderer?.content?.richGridRenderer?.contents) {
          isEmpty = shelf.richShelfRenderer.content.richGridRenderer.contents.length === 0;
        } else if (shelf.gridRenderer?.items) {
          isEmpty = shelf.gridRenderer.items.length === 0;
        }
        
        if (isEmpty) {
          if (DEBUG_ENABLED) {
            console.log('[SCAN_CLEANUP] Removing empty shelf at:', path + '[' + i + ']');
          }
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

// ⭐ AUTO-LOAD STATE: Must be outside JSON.parse to persist across responses
let autoLoadInProgress = false;
let autoLoadAttempts = 0;
const MAX_AUTO_LOAD_ATTEMPTS = 100;
let skipUniversalFilter = false;  // ⭐ NEW: Global flag to skip filtering during auto-load

// ⭐ AUTO-LOADER FUNCTION: Must be in global scope so setTimeout can access it
function startPlaylistAutoLoad() {
  console.log('▶▶▶▶▶▶▶▶▶▶ AUTO-LOAD CALLED ◀◀◀◀◀◀◀◀◀◀');
  console.log('▶▶▶ Current page:', getCurrentPage());
  console.log('▶▶▶ autoLoadInProgress:', autoLoadInProgress);
  
  if (autoLoadInProgress) {
    if (DEBUG_ENABLED) {
      console.log('[PLAYLIST_AUTOLOAD] Already in progress, skipping');
    }
    return;
  }
  
  autoLoadInProgress = true;
  autoLoadAttempts = 0;
  skipUniversalFilter = true;  // ⭐ ADD THIS - prevents filtering during auto-load
  
  if (DEBUG_ENABLED) {
    console.log('[PLAYLIST_AUTOLOAD] ========================================');
    console.log('[PLAYLIST_AUTOLOAD] Starting auto-load process');
    console.log('[PLAYLIST_AUTOLOAD] ========================================');
  }
  
  let lastVideoCount = 0;
  let stableCount = 0;
  
  const autoLoadInterval = setInterval(() => {
    autoLoadAttempts++;
    
    // Safety: Stop after too many attempts
    if (autoLoadAttempts > MAX_AUTO_LOAD_ATTEMPTS) {
      if (DEBUG_ENABLED) {
        console.log('[PLAYLIST_AUTOLOAD] Max attempts reached, stopping');
      }
      clearInterval(autoLoadInterval);
      autoLoadInProgress = false;
      return;
    }
    
    // Count current videos
    const videoElements = document.querySelectorAll('ytlr-tile-renderer');
    const currentCount = videoElements.length;
    
    if (DEBUG_ENABLED && autoLoadAttempts % 5 === 0) {
      console.log(`[PLAYLIST_AUTOLOAD] Attempt ${autoLoadAttempts}: ${currentCount} videos loaded`);
    }
    
    // Scroll to bottom to trigger loading
    window.scrollTo(0, document.body.scrollHeight);
    
    // Check if video count has stabilized (no new videos loading)
    if (currentCount === lastVideoCount) {
      stableCount++;
      
      // If count stable for 3 checks, we're done
      if (stableCount >= 3) {
        if (DEBUG_ENABLED) {
          console.log('[PLAYLIST_AUTOLOAD] ========================================');
          console.log('[PLAYLIST_AUTOLOAD] All videos loaded!');
          console.log('[PLAYLIST_AUTOLOAD] Total videos:', currentCount);
          console.log('[PLAYLIST_AUTOLOAD] Now applying filters...');
          console.log('[PLAYLIST_AUTOLOAD] ========================================');
        }
        
        clearInterval(autoLoadInterval);
        autoLoadInProgress = false;
        skipUniversalFilter = false;  // ⭐ ADD THIS - re-enable filtering
        
        // Scroll back to top
        window.scrollTo(0, 0);
        
        // Force a page refresh to apply filters
        setTimeout(() => {
          const page = getCurrentPage();
          scanAndFilterAllArrays(document, page);
          
          if (DEBUG_ENABLED) {
            console.log('[PLAYLIST_AUTOLOAD] Filtering complete!');
          }
        }, 500);
      }
    } else {
      stableCount = 0;
      lastVideoCount = currentCount;
    }
  }, 500);
}

// ⭐ PLAYLIST COLLECTION MODE: Store unwatched videos, then reload filtered
const PLAYLIST_STORAGE_KEY = 'tizentube_playlist_unwatched';

function isInCollectionMode() {
  const stored = localStorage.getItem(PLAYLIST_STORAGE_KEY);
  if (!stored) return false;
  
  try {
    const data = JSON.parse(stored);
    // Collection mode expires after 5 minutes
    if (Date.now() - data.timestamp > 5 * 60 * 1000) {
      localStorage.removeItem(PLAYLIST_STORAGE_KEY);
      return false;
    }
    return data.mode === 'collecting';
  } catch {
    return false;
  }
}

function getFilteredVideoIds() {
  const stored = localStorage.getItem(PLAYLIST_STORAGE_KEY);
  if (!stored) return null;
  
  try {
    const data = JSON.parse(stored);
    if (data.mode === 'filtering' && data.videoIds) {
      return new Set(data.videoIds);
    }
  } catch {}
  return null;
}

function startCollectionMode() {
  console.log('🔄🔄🔄 STARTING COLLECTION MODE');
  localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify({
    mode: 'collecting',
    timestamp: Date.now(),
    videoIds: []
  }));
  
  // Reload page to start fresh
  window.location.reload();
}

function finishCollectionAndFilter(unwatchedIds) {
  console.log('🔄🔄🔄 COLLECTION COMPLETE - Switching to filter mode');
  console.log('🔄 Total unwatched videos:', unwatchedIds.length);
  
  localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify({
    mode: 'filtering',
    timestamp: Date.now(),
    videoIds: unwatchedIds
  }));
  
  // Reload page in filter mode
  window.location.reload();
}

function exitFilterMode() {
  console.log('🔄🔄🔄 EXITING FILTER MODE');
  localStorage.removeItem(PLAYLIST_STORAGE_KEY);
  window.location.reload();
}

// ⭐ Track collected unwatched videos during collection mode
window._collectedUnwatched = window._collectedUnwatched || [];

const origParse = JSON.parse;
JSON.parse = function () {
  const r = origParse.apply(this, arguments);
  const adBlockEnabled = configRead('enableAdBlock');

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

  if (r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents) {
    const currentPage = getCurrentPage();
    if (!r.__tizentubeProcessedBrowse) {
      r.__tizentubeProcessedBrowse = true;
      if (currentPage === 'playlist' || currentPage === 'playlists') {
        r.__universalFilterApplied = true;
        setTimeout(() => {
          startPlaylistAutoLoad();
        }, 1000);
        return r;
      }
      processShelves(r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents);
    }
  }

  if (r.endscreen && configRead('enableHideEndScreenCards')) {
    r.endscreen = null;
  }

  if (r.messages && Array.isArray(r.messages) && !configRead('enableYouThereRenderer')) {
    r.messages = r.messages.filter((msg) => !msg?.youThereRenderer);
  }

  if (!Array.isArray(r) && r?.entries && adBlockEnabled) {
    r.entries = r.entries?.filter((elm) => !elm?.command?.reelWatchEndpoint?.adClientParams?.isAd);
  }

  if (r?.title?.runs) {
    PatchSettings(r);
  }

  if (r?.contents?.sectionListRenderer?.contents && !r.__tizentubeProcessedSection) {
    r.__tizentubeProcessedSection = true;
    processShelves(r.contents.sectionListRenderer.contents);
  }

  if (r?.continuationContents?.sectionListContinuation?.contents) {
    processShelves(r.continuationContents.sectionListContinuation.contents);
  }

  if (r?.continuationContents?.playlistVideoListContinuation?.contents) {
    const hasContinuation = !!r.continuationContents.playlistVideoListContinuation.continuations;
    if (!hasContinuation) {
      window._isLastPlaylistBatch = true;
      if (isInCollectionMode()) {
        setTimeout(() => {
          finishCollectionAndFilter(window._collectedUnwatched);
        }, 2000);
      }
      setTimeout(() => {
        detectPlaylistButtons();
      }, 2000);
      setTimeout(() => {
        addPlaylistControlButtons();
      }, 4000);
    } else {
      window._isLastPlaylistBatch = false;
    }
    setTimeout(() => {
      detectPlaylistButtons();
    }, 2000);
  }

  if (r?.onResponseReceivedActions) {
    const page = getCurrentPage();
    r.onResponseReceivedActions.forEach((action, idx) => {
      if (action.appendContinuationItemsAction?.continuationItems) {
        const items = action.appendContinuationItemsAction.continuationItems;
        const hasPlaylistVideos = items.some(item => item.playlistVideoRenderer);
        if (hasPlaylistVideos && (page === 'playlist' || page === 'playlists')) {
          const filtered = directFilterArray(items, page, `playlist-scroll-${idx}`);
          action.appendContinuationItemsAction.continuationItems = filtered;
        } else {
          const filtered = directFilterArray(items, page, `continuation-${idx}`);
          action.appendContinuationItemsAction.continuationItems = filtered;
        }
      }
    });
  }

  if (r?.continuationContents?.horizontalListContinuation?.items) {
    deArrowify(r.continuationContents.horizontalListContinuation.items);
    hqify(r.continuationContents.horizontalListContinuation.items);
    addLongPress(r.continuationContents.horizontalListContinuation.items);
    r.continuationContents.horizontalListContinuation.items = hideVideo(r.continuationContents.horizontalListContinuation.items);
  }

  const currentPage = getCurrentPage();
  const criticalPages = ['subscriptions', 'library', 'history', 'playlist', 'channel'];
  if (criticalPages.includes(currentPage) && !r.__universalFilterApplied && !skipUniversalFilter) {
    r.__universalFilterApplied = true;
    scanAndFilterAllArrays(r, currentPage);
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
  
  const videoId = item.tileRenderer?.contentId || 
                 item.videoRenderer?.videoId || 
                 item.gridVideoRenderer?.videoId ||
                 item.compactVideoRenderer?.videoId ||
                 'unknown';

  const page = getCurrentPage();

  if ((page === 'subscriptions' || page.includes('channel'))) {
    let durationSeconds = null;
    if (item.tileRenderer) {
      let lengthText = null;
      const thumbnailOverlays = item.tileRenderer.header?.tileHeaderRenderer?.thumbnailOverlays;
      if (thumbnailOverlays && Array.isArray(thumbnailOverlays)) {
        const timeOverlay = thumbnailOverlays.find(o => o?.thumbnailOverlayTimeStatusRenderer);
        if (timeOverlay) {
          lengthText = timeOverlay.thumbnailOverlayTimeStatusRenderer.text?.simpleText;
        }
      }
      if (!lengthText) {
        lengthText = item.tileRenderer.metadata?.tileMetadataRenderer?.lines?.[0]?.lineRenderer?.items?.find(
          i => i.lineItemRenderer?.badge || i.lineItemRenderer?.text?.simpleText
        )?.lineItemRenderer?.text?.simpleText;
      }
      if (lengthText) {
        const durationMatch = lengthText.match(/^(\d+):(\d+)$/);
        if (durationMatch) {
          const minutes = parseInt(durationMatch[1], 10);
          const seconds = parseInt(durationMatch[2], 10);
          durationSeconds = minutes * 60 + seconds;
        }
      }
    }
    if (durationSeconds && durationSeconds > 90) {
      console.log('🔬 VIDEO >90s:', videoId, '| Duration:', durationSeconds, 'sec');
    }
  }

  if (item.tileRenderer?.contentType === 'TILE_CONTENT_TYPE_SHORT') {
    return true;
  }

  const itemStr = JSON.stringify(item);
  if (itemStr.includes('/shorts/') || itemStr.includes('"isShortsEligible":true')) {
    return true;
  }

  if (item.videoRenderer?.thumbnailOverlays) {
    const hasShortsBadge = item.videoRenderer.thumbnailOverlays.some(overlay => 
      overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText === 'SHORTS'
    );
    if (hasShortsBadge) return true;
  }
  if (item.videoRenderer?.navigationEndpoint?.reelWatchEndpoint) return true;
  if (item.videoRenderer?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url?.includes('/shorts/')) return true;
  if (item.richItemRenderer?.content?.reelItemRenderer) return true;

  if (item.gridVideoRenderer?.thumbnailOverlays) {
    const hasShortsBadge = item.gridVideoRenderer.thumbnailOverlays.some(overlay =>
      overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.runs?.some(run => run.text === 'SHORTS')
    );
    if (hasShortsBadge) return true;
  }
  if (item.gridVideoRenderer?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url?.includes('/shorts/')) return true;

  if (item.compactVideoRenderer?.thumbnailOverlays) {
    const hasShortsBadge = item.compactVideoRenderer.thumbnailOverlays.some(overlay =>
      overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.runs?.some(run => run.text === 'SHORTS')
    );
    if (hasShortsBadge) return true;
  }
  if (item.compactVideoRenderer?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url?.includes('/shorts/')) return true;
  if (item.tileRenderer?.onSelectCommand?.reelWatchEndpoint) return true;
  if (item.tileRenderer?.onSelectCommand && JSON.stringify(item.tileRenderer.onSelectCommand).includes('/shorts/')) return true;

  const videoTitle = item.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText || '';
  if (videoTitle.toLowerCase().includes('#shorts') || videoTitle.toLowerCase().includes('#short')) return true;

  if (item.tileRenderer?.header?.tileHeaderRenderer?.thumbnail?.thumbnails) {
    const thumb = item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails[0];
    if (thumb && thumb.height > thumb.width) return true;
  }

  return false;
}

function getShelfTitle(shelf) {
  const shelfRendererTitle = shelf?.shelfRenderer?.shelfHeaderRenderer?.title;
  const richShelfTitle = shelf?.richShelfRenderer?.title;
  const richSectionTitle = shelf?.richSectionRenderer?.content?.richShelfRenderer?.title;
  const gridHeaderTitle = shelf?.gridRenderer?.header?.gridHeaderRenderer?.title;
  const avatarLockupTitle = shelf?.shelfRenderer?.headerRenderer?.shelfHeaderRenderer?.avatarLockup?.avatarLockupRenderer?.title;

  const titleText = (title) => {
    if (!title) return '';
    if (title.simpleText) return title.simpleText;
    if (Array.isArray(title.runs)) return title.runs.map(run => run.text).join('');
    return '';
  };

  let flexibleTitle = '';
  if (!titleText(shelfRendererTitle) && !titleText(richShelfTitle) && !titleText(richSectionTitle) && !titleText(gridHeaderTitle) && !titleText(avatarLockupTitle)) {
    const shelfJson = JSON.stringify(shelf);
    if (shelfJson.includes('avatarLockupRenderer')) {
      const match = shelfJson.match(/"avatarLockupRenderer":\{[^}]*"title":\{[^}]*"runs":\[\{"text":"([^"]+)"/);
      if (match && match[1]) {
        flexibleTitle = match[1];
      }
    }
  }

  return (
    titleText(shelfRendererTitle) ||
    titleText(richShelfTitle) ||
    titleText(richSectionTitle) ||
    titleText(gridHeaderTitle) ||
    titleText(avatarLockupTitle) ||
    flexibleTitle
  );
}

function applyFiltersToItems(items, shortsEnabled, shouldAddPreviews = true) {
  if (!Array.isArray(items)) return [];

  deArrowify(items);
  hqify(items);
  addLongPress(items);
  if (shouldAddPreviews) addPreviews(items);

  let filteredItems = items;
  if (!shortsEnabled) {
    filteredItems = filteredItems.filter(item => !isShortItem(item));
  }

  filteredItems = hideVideo(filteredItems);
  return filteredItems;
}

function processShelves(shelves, shouldAddPreviews = true) {
  if (!Array.isArray(shelves)) return;

  const shortsEnabled = configRead('enableShorts');

  for (let i = shelves.length - 1; i >= 0; i--) {
    const shelve = shelves[i];
    if (!shelve) continue;

    if (!shortsEnabled) {
      const shelfTitle = getShelfTitle(shelve);
      if (shelfTitle && shelfTitle.trim().toLowerCase() === 'shorts') {
        if (DEBUG_ENABLED) {
          console.log('[SHELF_PROCESS] Removing exact Shorts shelf by title');
        }
        shelves.splice(i, 1);
        continue;
      }
    }

    // shelfRenderer variants
    if (shelve.shelfRenderer?.content?.horizontalListRenderer?.items) {
      const items = applyFiltersToItems(
        shelve.shelfRenderer.content.horizontalListRenderer.items,
        shortsEnabled,
        shouldAddPreviews
      );
      shelve.shelfRenderer.content.horizontalListRenderer.items = items;
      if (items.length === 0) shelves.splice(i, 1);
      continue;
    }

    if (shelve.shelfRenderer?.content?.gridRenderer?.items) {
      const items = applyFiltersToItems(
        shelve.shelfRenderer.content.gridRenderer.items,
        shortsEnabled,
        shouldAddPreviews
      );
      shelve.shelfRenderer.content.gridRenderer.items = items;
      if (items.length === 0) shelves.splice(i, 1);
      continue;
    }

    if (shelve.shelfRenderer?.content?.verticalListRenderer?.items) {
      const items = applyFiltersToItems(
        shelve.shelfRenderer.content.verticalListRenderer.items,
        shortsEnabled,
        shouldAddPreviews
      );
      shelve.shelfRenderer.content.verticalListRenderer.items = items;
      if (items.length === 0) shelves.splice(i, 1);
      continue;
    }

    // richShelfRenderer
    if (shelve.richShelfRenderer?.content?.richGridRenderer?.contents) {
      const contents = applyFiltersToItems(
        shelve.richShelfRenderer.content.richGridRenderer.contents,
        shortsEnabled,
        shouldAddPreviews
      );
      shelve.richShelfRenderer.content.richGridRenderer.contents = contents;
      if (contents.length === 0) shelves.splice(i, 1);
      continue;
    }

    // top-level gridRenderer
    if (shelve.gridRenderer?.items) {
      const items = applyFiltersToItems(
        shelve.gridRenderer.items,
        shortsEnabled,
        shouldAddPreviews
      );
      shelve.gridRenderer.items = items;
      if (items.length === 0) shelves.splice(i, 1);
      continue;
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
  }
}

function hqify(items) {
  for (const item of items) {
    if (!item.tileRenderer) continue;
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
  }
}

function hideVideo(items) {
  const page = getCurrentPage();
  return directFilterArray(items, page, 'hideVideo');
}

function findProgressBar(item) {
  if (!item) return null;
  const checkRenderer = (renderer) => {
    if (!renderer) return null;
    const overlayPaths = [renderer.thumbnailOverlays, renderer.header?.tileHeaderRenderer?.thumbnailOverlays, renderer.thumbnail?.thumbnailOverlays, renderer.thumbnailOverlayRenderer, renderer.overlay, renderer.overlays];
    for (const overlays of overlayPaths) {
      if (!overlays) continue;
      if (Array.isArray(overlays)) {
        const progressOverlay = overlays.find(o => o?.thumbnailOverlayResumePlaybackRenderer);
        if (progressOverlay) return progressOverlay.thumbnailOverlayResumePlaybackRenderer;
      } else if (overlays.thumbnailOverlayResumePlaybackRenderer) {
        return overlays.thumbnailOverlayResumePlaybackRenderer;
      }
    }
    return null;
  };
  const rendererTypes = [item.tileRenderer, item.playlistVideoRenderer, item.compactVideoRenderer, item.gridVideoRenderer, item.videoRenderer, item.richItemRenderer?.content?.videoRenderer, item.richItemRenderer?.content?.reelItemRenderer];
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
  if (cMatch) browseParam = cMatch[1].toLowerCase();
  const browseIdMatch = hash.match(/\/browse\/([^?&#]+)/i);
  if (browseIdMatch && !browseParam) browseParam = browseIdMatch[1].toLowerCase();
  const combined = (cleanHash + ' ' + path + ' ' + search + ' ' + href + ' ' + browseParam).toLowerCase();
  let detectedPage = 'other';
  if (browseParam.includes('fesubscription')) detectedPage = 'subscriptions';
  else if (browseParam === 'felibrary') detectedPage = 'library';
  else if (browseParam === 'fehistory') detectedPage = 'history';
  else if (browseParam === 'femy_youtube') detectedPage = 'playlist';
  else if (browseParam === 'feplaylist_aggregation') detectedPage = 'playlists';
  else if (browseParam.startsWith('vlpl') || browseParam === 'vlwl' || browseParam === 'vlll') detectedPage = 'playlist';
  else if (browseParam.includes('fetopics_music') || browseParam.includes('music')) detectedPage = 'music';
  else if (browseParam.includes('fetopics_gaming') || browseParam.includes('gaming')) detectedPage = 'gaming';
  else if (browseParam.includes('fetopics')) detectedPage = 'home';
  else if (browseParam.startsWith('uc') && browseParam.length > 10) detectedPage = 'channel';
  else if (cleanHash.includes('/playlist') || combined.includes('list=')) detectedPage = 'playlist';
  else if (cleanHash.includes('/results') || cleanHash.includes('/search')) detectedPage = 'search';
  else if (cleanHash.includes('/watch')) detectedPage = 'watch';
  else if (cleanHash.includes('/@') || cleanHash.includes('/channel/')) detectedPage = 'channel';
  else if (cleanHash.includes('/browse') && !browseParam) detectedPage = 'home';
  else if (cleanHash === '' || cleanHash === '/') detectedPage = 'home';
  return detectedPage;
}

function detectPlaylistButtons() {
  const page = getCurrentPage();
  if (page !== 'playlist' && page !== 'playlists') return;
  if (!window._isLastPlaylistBatch && window._playlistButtonsDetected) return;
  window._playlistButtonsDetected = true;
}

function addPlaylistControlButtons(attempt = 1) {
  const page = getCurrentPage();
  if (page !== 'playlist') return;

  const container = document.querySelector('.TXB27d.RuKowd.fitbrf.B3hoEd') || document.querySelector('[class*="TXB27d"]');
  if (!container) {
    if (attempt < 5) {
      setTimeout(() => addPlaylistControlButtons(attempt + 1), 1500);
    }
    return;
  }

  const existingButtons = Array.from(container.querySelectorAll('ytlr-button-renderer'));
  if (existingButtons.length === 0) {
    if (attempt < 5) {
      setTimeout(() => addPlaylistControlButtons(attempt + 1), 1500);
    }
    return;
  }

  const oldBtn = container.querySelector('#tizentube-collection-btn');
  if (oldBtn) oldBtn.remove();

  const templateBtn = existingButtons[existingButtons.length - 1];
  const collectionBtn = templateBtn.cloneNode(true);
  collectionBtn.id = 'tizentube-collection-btn';

  // Keep YouTube focus/navigation attributes.
  Array.from(templateBtn.attributes).forEach((attr) => {
    if (attr.name.startsWith('data-') || attr.name === 'tabindex' || attr.name === 'role') {
      collectionBtn.setAttribute(attr.name, attr.value);
    }
  });

  const textElement = collectionBtn.querySelector('yt-formatted-string');
  const inCollection = isInCollectionMode();
  const filterIds = getFilteredVideoIds();

  if (textElement) {
    textElement.textContent = inCollection ? '🔄 Collecting...' : (filterIds ? '✅ Exit Filter' : '🔄 Collect Unwatched');
  }

  collectionBtn.style.marginTop = '24px';
  collectionBtn.style.display = '';
  collectionBtn.style.visibility = '';
  collectionBtn.style.opacity = '';
  collectionBtn.style.pointerEvents = 'auto';
  collectionBtn.style.position = 'relative';

  // Make room for one extra row so it is below the last native button.
  const templateHeight = templateBtn.getBoundingClientRect().height || 72;
  const minExtra = Math.round(templateHeight + 40);
  const existingMinHeight = parseInt(container.style.minHeight || '0', 10);
  if (Number.isFinite(existingMinHeight)) {
    container.style.minHeight = `${Math.max(existingMinHeight, container.clientHeight + minExtra)}px`;
  } else {
    container.style.minHeight = `${container.clientHeight + minExtra}px`;
  }
  container.style.overflow = 'visible';

  if (!inCollection) {
    collectionBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (filterIds) {
        exitFilterMode();
      } else {
        startCollectionMode();
      }
    });
  }

  container.appendChild(collectionBtn);
}

function addCollectionModeButton() {
  addPlaylistControlButtons();
}

function playNextUnwatchedVideo() {
  const tiles = document.querySelectorAll('ytlr-tile-renderer');
  if (tiles.length === 0) return;
  const firstTile = tiles[0];
  if (firstTile.click) {
    firstTile.click();
  } else if (firstTile.querySelector('a')) {
    firstTile.querySelector('a').click();
  } else {
    const event = new KeyboardEvent('keydown', { keyCode: 13, which: 13 });
    firstTile.dispatchEvent(event);
  }
}

if (typeof window !== 'undefined') {
  const tryInject = () => {
    setTimeout(() => addPlaylistControlButtons(), 2000);
    setTimeout(() => addPlaylistControlButtons(), 4000);
    setTimeout(() => addPlaylistControlButtons(), 6000);
  };
  tryInject();
  let lastHref = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastHref) {
      lastHref = window.location.href;
      const oldButton = document.getElementById('tizentube-collection-btn');
      if (oldButton) oldButton.remove();
      tryInject();
    }
  }, 1000);
}

if (typeof window !== 'undefined') {
  setTimeout(() => {
    addCollectionModeButton();
  }, 3000);
  let lastHref = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastHref) {
      lastHref = window.location.href;
      setTimeout(() => {
        addCollectionModeButton();
      }, 2000);
    }
  }, 1000);
}
