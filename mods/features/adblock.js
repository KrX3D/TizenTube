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
          if (shelf?.shelfRenderer || shelf?.richShelfRenderer || shelf?.gridRenderer) {
            const shelfTitle = getShelfTitle(shelf);
            if (shelfTitle && shelfTitle.trim().toLowerCase() === 'shorts') {
              if (LOG_SHORTS && DEBUG_ENABLED) {
                console.log('[SCAN] Removing Shorts shelf by title:', shelfTitle, 'at:', path);
              }
              obj.splice(i, 1);
            }
            shelves.splice(i, 1);
            shelvesRemoved++;
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
    //console.log('ADBLOCK', 'Removing adPlacements', { count: r.adPlacements.length });
    
    r.adPlacements = [];
  }

  if (r.playerAds && adBlockEnabled) {
    //console.log('ADBLOCK', 'Disabling playerAds');
    r.playerAds = false;
  }

  if (r.adSlots && adBlockEnabled) {
    //console.log('ADBLOCK', 'Clearing adSlots', { count: r.adSlots.length });
    r.adSlots = [];
  }

  if (r.paidContentOverlay && !configRead('enablePaidPromotionOverlay')) {
    //console.log('ADBLOCK', 'Removing paid content overlay');
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
      
      // ⭐ CHECK IF THIS IS A PLAYLIST PAGE
      if (currentPage === 'playlist' || currentPage === 'playlists') {
        r.__universalFilterApplied = true;  // Prevent universal filter
        
        if (DEBUG_ENABLED) {
          console.log('[TVBROWSE_PLAYLIST] ========================================');
          console.log('[TVBROWSE_PLAYLIST] Playlist detected in tvBrowseRenderer!');
          console.log('[TVBROWSE_PLAYLIST] Page:', currentPage);
          console.log('[TVBROWSE_PLAYLIST] Starting auto-load process...');
          console.log('[TVBROWSE_PLAYLIST] ========================================');
        }
        
        // Start auto-loader
        setTimeout(() => {
          console.log('[DEBUG_TVBROWSE] setTimeout fired! Starting auto-load...');
          startPlaylistAutoLoad();
        }, 1000);
        
        // Skip all processing for playlists - auto-loader handles it
        return r;
      }
      
      // ⭐ NON-PLAYLIST PAGES: Normal processing
      if (DEBUG_ENABLED) {
          console.log('[BROWSE] ==============tvBrowseRenderer============');
          console.log('[BROWSE] Page:', currentPage);
          console.log('[BROWSE] URL:', window.location.href);
          console.log('[BROWSE] Hash:', window.location.hash);
          console.log('[BROWSE] ========================================');
      }
      
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
      if (DEBUG_ENABLED) {
        console.log('[JSON.parse] tvBrowseRenderer already processed, SKIPPING');
      }
    }
  }

  if (r.endscreen && configRead('enableHideEndScreenCards')) {
    //console.log('UI_FILTER', 'Hiding end screen cards');
    r.endscreen = null;
  }

  if (r.messages && Array.isArray(r.messages) && !configRead('enableYouThereRenderer')) {
    const before = r.messages.length;
    r.messages = r.messages.filter((msg) => !msg?.youThereRenderer);
    if (before !== r.messages.length) {
      //console.log('UI_FILTER', 'Removed YouThereRenderer messages', { removed: before - r.messages.length });
    }
  }

  // Remove shorts ads
  if (!Array.isArray(r) && r?.entries && adBlockEnabled) {
    const before = r.entries.length;
    r.entries = r.entries?.filter((elm) => !elm?.command?.reelWatchEndpoint?.adClientParams?.isAd);
    if (before !== r.entries.length) {
      //logger.info('ADBLOCK', 'Removed shorts ads', { removed: before - r.entries.length });
    }
  }

  if (r?.title?.runs) {
    PatchSettings(r);
  }

  if (r?.contents?.sectionListRenderer?.contents) {
    if (!r.__tizentubeProcessedSection) {
      r.__tizentubeProcessedSection = true;
      if (DEBUG_ENABLED) {
        console.log('SHELF_ENTRY', 'Processing sectionListRenderer.contents', {
          count: r.contents.sectionListRenderer.contents.length,
          page: getCurrentPage()
        });
      }
      processShelves(r.contents.sectionListRenderer.contents);
    } else {
      if (DEBUG_ENABLED) {
        console.log('[JSON.parse] sectionListRenderer already processed, SKIPPING');
      }
    }
  }

  if (r?.continuationContents?.sectionListContinuation?.contents) {
    const page = getCurrentPage();
    if (DEBUG_ENABLED) {
      console.log('[CONTINUATION]', page, '- Processing', r.continuationContents.sectionListContinuation.contents.length, 'shelves');
    }

    if (window._lastLoggedPage !== page) {
      if (DEBUG_ENABLED) {
        console.log('[PAGE_DEBUG] ========================================');
        console.log('[PAGE_DEBUG] Page changed to:', page);
        console.log('[PAGE_DEBUG] URL:', window.location.href);
        console.log('[PAGE_DEBUG] Hash:', window.location.hash);
        console.log('[PAGE_DEBUG] ========================================');
      }
      window._lastLoggedPage = page;
    }
    
    // This is where individual channel content loads!
    processShelves(r.continuationContents.sectionListContinuation.contents);
  }

  // Handle PLAYLIST continuations (different from section continuations!)
  if (r?.continuationContents?.playlistVideoListContinuation?.contents) {
    const page = getCurrentPage();
    
    // ⭐ CHECK FOR LAST PAGE HERE (where we have full response)
    const hasContinuation = !!r.continuationContents.playlistVideoListContinuation.continuations;
    
    console.log('═══════════════════════════════════════════════════════');
    console.log('═══ PLAYLIST CONTINUATION DETECTED');
    console.log('═══ Page:', page);
    console.log('═══ Has continuation token:', hasContinuation);
    console.log('═══ Continuations object:', r.continuationContents.playlistVideoListContinuation.continuations);
    console.log('═══ Videos in batch:', r.continuationContents.playlistVideoListContinuation.contents.length);
    
    if (!hasContinuation) {
      console.log('═══ ⭐⭐⭐ THIS IS THE LAST BATCH! ⭐⭐⭐');
      // Set flag for directFilterArray to read
      window._isLastPlaylistBatch = true;

      // ⭐ CHECK: Are we in collection mode?
      if (isInCollectionMode()) {
        console.log('═══ 🔄 COLLECTION MODE: Last batch reached!');
        console.log('═══ 🔄 Total unwatched videos collected:', window._collectedUnwatched.length);
        
        // Switch to filter mode after a delay (let current batch render)
        setTimeout(() => {
          finishCollectionAndFilter(window._collectedUnwatched);
        }, 2000);
      }
  
      setTimeout(() => {
        detectPlaylistButtons();
      }, 2000);
      
      // ⭐ Wait even longer for buttons to inject (buttons load slowly)
      setTimeout(() => {
        addPlaylistControlButtons();
      }, 4000);
    } else {
      console.log('═══ More batches to come...');
      window._isLastPlaylistBatch = false;
    }
    console.log('═══════════════════════════════════════════════════════');
  
    // ⭐ Trigger button detection
    setTimeout(() => {
      detectPlaylistButtons();
    }, 2000);
    
    // Continue with normal processing via universal filter
  }
  
  // Handle onResponseReceivedActions (lazy-loaded channel tabs AND PLAYLIST SCROLLING)
  if (r?.onResponseReceivedActions) {
    const page = getCurrentPage();
    
    if (DEBUG_ENABLED) {
      console.log('[ON_RESPONSE] ========================================');
      console.log('[ON_RESPONSE] Page:', page);
      console.log('[ON_RESPONSE] Actions:', r.onResponseReceivedActions.length);
    }
  
    // ⭐ NEW: Log playlist structure with MARKER
    if (page === 'playlist' || page === 'playlists') {
      console.log('#####################>>> PLAYLIST STRUCTURE DETECTED <<<#####################');
      console.log('#####################>>> Response keys:', Object.keys(r));
      console.log('#####################>>> Has contents:', !!r.contents);
      console.log('#####################>>> Has continuationContents:', !!r.continuationContents);
      console.log('#####################>>> Has onResponseReceivedActions:', !!r.onResponseReceivedActions);
      if (r.contents) {
        console.log('#####################>>> contents keys:', Object.keys(r.contents));
      }
      console.log('#####################>>> END PLAYLIST STRUCTURE <<<#####################');
    }
    
    r.onResponseReceivedActions.forEach((action, idx) => {
      // Handle appendContinuationItemsAction (playlist/channel/subscription continuations)
      if (action.appendContinuationItemsAction?.continuationItems) {
        let items = action.appendContinuationItemsAction.continuationItems;
        
        if (DEBUG_ENABLED) {
          console.log(`[ON_RESPONSE] Action ${idx}: appendContinuationItemsAction`);
          console.log(`[ON_RESPONSE] Items:`, items.length);
          if (items[0]) {
            console.log(`[ON_RESPONSE] First item keys:`, Object.keys(items[0]));
          }
        }

        // First scan recursively so shelf-like continuation payloads on Tizen 5.5/6.5 also get filtered.
        scanAndFilterAllArrays(items, page, `onResponse-${idx}`);

        // Then direct-filter top-level arrays with videos.
        const filtered = directFilterArray(items, page, `continuation-${idx}`);
        action.appendContinuationItemsAction.continuationItems = filtered;
      }
    });
    
    if (DEBUG_ENABLED) {
      console.log('[ON_RESPONSE] ========================================');
    }
  }


  if (r?.continuationContents?.horizontalListContinuation?.items) {
    if (DEBUG_ENABLED) {
      console.log('SHELF_ENTRY', 'Processing horizontal list continuation', {
        count: r.continuationContents.horizontalListContinuation.items.length
      });
    }
    deArrowify(r.continuationContents.horizontalListContinuation.items);
    hqify(r.continuationContents.horizontalListContinuation.items);
    addLongPress(r.continuationContents.horizontalListContinuation.items);
    r.continuationContents.horizontalListContinuation.items = hideVideo(r.continuationContents.horizontalListContinuation.items);
  }

  if (r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer) {
    const page = getCurrentPage();
    
    if (page === 'subscriptions' && !r.__tizentubeProcessedSubs) {
      r.__tizentubeProcessedSubs = true;
      
      if (LOG_WATCHED && DEBUG_ENABLED) {
        console.log('[SUBSCRIPTIONS] ========================================');
        console.log('[SUBSCRIPTIONS] Processing subscriptions page');
      }
      
      const sections = r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections || [];
      
      if (LOG_WATCHED && DEBUG_ENABLED) {
        console.log('[SUBSCRIPTIONS] Sections found:', sections.length);
      }
      
      sections.forEach((section, idx) => {
        if (!section.tvSecondaryNavSectionRenderer?.items) return;
        
        const items = section.tvSecondaryNavSectionRenderer.items;
        
        items.forEach((item, itemIdx) => {
          // Skip navigation links (compactLinkRenderer)
          if (item.compactLinkRenderer) {
            if (LOG_WATCHED && DEBUG_ENABLED) {
              console.log(`[SUBSCRIPTIONS] Section ${idx}, Item ${itemIdx}: NAV LINK (skipping)`);
            }
            return;
          }
          
          const content = item.tvSecondaryNavItemRenderer?.content;
          
          // Process shelf content
          if (content?.shelfRenderer) {
            if (LOG_WATCHED && DEBUG_ENABLED) {
              console.log(`[SUBSCRIPTIONS] Section ${idx}, Item ${itemIdx}: SHELF`);
            }
            processShelves([content], false);
          }
          // Process rich grid content
          else if (content?.richGridRenderer?.contents) {
            if (LOG_WATCHED && DEBUG_ENABLED) {
              console.log(`[SUBSCRIPTIONS] Section ${idx}, Item ${itemIdx}: RICH GRID (${content.richGridRenderer.contents.length} items)`);
            }
            const filtered = directFilterArray(
              content.richGridRenderer.contents,
              page,
              `subscriptions-section-${idx}-item-${itemIdx}`
            );
            content.richGridRenderer.contents = filtered;
          }
        });
      });
      
      if (LOG_WATCHED && DEBUG_ENABLED) {
        console.log('[SUBSCRIPTIONS] Processing complete');
        console.log('[SUBSCRIPTIONS] ========================================');
      }
    }
  }

  // Log library page structure
  if (r?.contents?.tvBrowseRenderer && getCurrentPage() === 'library') {
      if (LOG_WATCHED && DEBUG_ENABLED) {    
        console.log('[LIBRARY] ========================================');
        console.log('[LIBRARY] Structure detected');
        console.log('[LIBRARY] URL:', window.location.href);
      }
      
      if (r.contents.tvBrowseRenderer.content?.tvSecondaryNavRenderer) {
        const tabs = r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections;
        if (LOG_WATCHED && DEBUG_ENABLED) {    
          console.log('[LIBRARY] Has', tabs?.length || 0, 'tab sections');
        }
      }
      
      if (r.contents.tvBrowseRenderer.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer) {
        const shelves = r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents;
        if (LOG_WATCHED && DEBUG_ENABLED) {    
          console.log('[LIBRARY] Main view has', shelves?.length || 0, 'shelves');
        }
      }
      if (LOG_WATCHED && DEBUG_ENABLED) {    
        console.log('[LIBRARY] ========================================');
      }
  }

  // ⭐ FIXED: Removed redundant window.location.hash.includes('list=') check
  // We already know the page type from getCurrentPage()
  //if (r?.contents?.singleColumnBrowseResultsRenderer && window.location.hash.includes('list=')) {
  if (r?.contents?.singleColumnBrowseResultsRenderer) {
    const page = getCurrentPage();
    
    // Only process if it's actually a playlist page
    if (page === 'playlist') {
      if (LOG_WATCHED && DEBUG_ENABLED) {    
        console.log('[PLAYLIST] ========================================');
        console.log('[PLAYLIST] Entered playlist');
        console.log('[PLAYLIST] Page:', page);
      }
      
      const tabs = r.contents.singleColumnBrowseResultsRenderer.tabs;
      if (tabs) {
        tabs.forEach((tab, idx) => {
          if (tab.tabRenderer?.content?.sectionListRenderer?.contents) {
            if (LOG_WATCHED && DEBUG_ENABLED) {    
              console.log(`[PLAYLIST] Tab ${idx} - processing shelves`);
            }
            processShelves(tab.tabRenderer.content.sectionListRenderer.contents);
          }
        });
      }
      if (LOG_WATCHED && DEBUG_ENABLED) {    
        console.log('[PLAYLIST] ========================================');
      }
    }
  }
  
  // Handle twoColumnBrowseResultsRenderer (playlist pages like WL, LL)
  if (r?.contents?.twoColumnBrowseResultsRenderer?.tabs) {
    const page = getCurrentPage();
    
    if (!r.__tizentubeProcessedPlaylist) {
      r.__tizentubeProcessedPlaylist = true;
      r.__universalFilterApplied = true;  // ⭐ ADD THIS LINE - prevents universal filter from running
      
      if (DEBUG_ENABLED) {
        console.log('[PLAYLIST_PAGE] ========================================');
        console.log('[PLAYLIST_PAGE] Initial playlist load detected');
        console.log('[PLAYLIST_PAGE] Page:', page);
        console.log('[PLAYLIST_PAGE] Starting auto-load process...');
        console.log('[PLAYLIST_PAGE] ========================================');
      }
      
      // ⭐ SKIP FILTERING - Let initial videos through
      // Auto-loader will handle filtering after all videos load
      
      // ⭐ Trigger auto-load after a short delay (let UI render first)
      setTimeout(() => {
        console.log('[DEBUG] setTimeout fired! page:', page);  // ⭐ DEBUG
        console.log('[DEBUG] getCurrentPage():', getCurrentPage());  // ⭐ DEBUG
        if (page === 'playlist' || page === 'playlists') {
          console.log('[DEBUG] About to call startPlaylistAutoLoad()');  // ⭐ DEBUG
          startPlaylistAutoLoad();
          console.log('[DEBUG] startPlaylistAutoLoad() called');  // ⭐ DEBUG
        } else {
          console.log('[DEBUG] NOT calling startPlaylistAutoLoad, page is:', page);  // ⭐ DEBUG
        }
      }, 1000);
    }
  }

  // Handle singleColumnBrowseResultsRenderer (alternative playlist format)
  if (r?.contents?.singleColumnBrowseResultsRenderer?.tabs) {
    const page = getCurrentPage();
    
    if (LOG_WATCHED && DEBUG_ENABLED) {
      console.log('[SINGLE_COLUMN] ========================================');
      console.log('[SINGLE_COLUMN] Page:', page);
      console.log('[SINGLE_COLUMN] Applying direct filtering...');
    }
    
    // Scan and filter ALL arrays
    scanAndFilterAllArrays(r.contents.singleColumnBrowseResultsRenderer, page);
    
    if (LOG_WATCHED && DEBUG_ENABLED) {
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
      //console.log('SPONSORBLOCK', `Added ${timelyActions.length} manual skip actions`);
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
        //console.log('SPONSORBLOCK', 'Added highlight button');
      }
    }
  }
  
  // UNIVERSAL FALLBACK - Filter EVERYTHING if we're on a critical page
  const currentPage = getCurrentPage();
  const criticalPages = ['subscriptions', 'library', 'history', 'playlist', 'channel'];
  //const criticalPages = ['subscriptions', 'library', 'history', 'channel'];

  if (criticalPages.includes(currentPage) && !r.__universalFilterApplied && !skipUniversalFilter) {
    r.__universalFilterApplied = true;
    
    //if (DEBUG_ENABLED) {
      //console.log('[UNIVERSAL] ========================================');
      //console.log('[UNIVERSAL] Applying universal filtering to page:', currentPage);
    //}
    
    // Scan the ENTIRE response object and filter ALL video arrays
    scanAndFilterAllArrays(r, currentPage);
    
    //if (DEBUG_ENABLED) {
      //console.log('[UNIVERSAL] Universal filtering complete');
      //console.log('[UNIVERSAL] ========================================');
    //}
  }

  // ⭐ DIAGNOSTIC: Log ALL response structures for playlists
  if ((currentPage === 'playlist' || currentPage === 'playlists') && DEBUG_ENABLED) {
    //console.log('[PLAYLIST_DIAGNOSTIC] ========================================');
    //console.log('[PLAYLIST_DIAGNOSTIC] Response structure:');
    
    // Check all possible continuation structures
    if (r.continuationContents) {
      console.log('[PLAYLIST_DIAGNOSTIC] ✓ Has continuationContents');
      console.log('[PLAYLIST_DIAGNOSTIC] continuationContents keys:', Object.keys(r.continuationContents));
    }
    
    if (r.onResponseReceivedActions) {
      console.log('[PLAYLIST_DIAGNOSTIC] ✓ Has onResponseReceivedActions');
      console.log('[PLAYLIST_DIAGNOSTIC] Actions count:', r.onResponseReceivedActions.length);
      r.onResponseReceivedActions.forEach((action, idx) => {
        console.log(`[PLAYLIST_DIAGNOSTIC] Action ${idx} keys:`, Object.keys(action));
      });
    }
    
    if (r.onResponseReceivedEndpoints) {
      console.log('[PLAYLIST_DIAGNOSTIC] ✓ Has onResponseReceivedEndpoints');
      console.log('[PLAYLIST_DIAGNOSTIC] Endpoints:', r.onResponseReceivedEndpoints.length);
    }
    
    if (r.contents) {
      console.log('[PLAYLIST_DIAGNOSTIC] ✓ Has contents');
      console.log('[PLAYLIST_DIAGNOSTIC] contents keys:', Object.keys(r.contents));
    }
    
    // Log if this is marked as processed
    if (r.__tizentubeProcessedPlaylist) {
      console.log('[PLAYLIST_DIAGNOSTIC] ⚠ Already marked as processed');
    }
    if (r.__universalFilterApplied) {
      //console.log('[PLAYLIST_DIAGNOSTIC] ⚠ Universal filter already applied');
    }
    
    //console.log('[PLAYLIST_DIAGNOSTIC] ========================================');
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

  // ⭐ ONLY log videos OVER 90 seconds on subscriptions/channels (to find long shorts)
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
    
    // ⭐ ONLY log videos OVER 90 seconds (to find long shorts that aren't being filtered)
    if (durationSeconds && durationSeconds > 90) {
      console.log('🔬 VIDEO >90s:', videoId, '| Duration:', durationSeconds, 'sec');
      console.log('🔬 ⚠️ Is this a SHORT or REGULAR? (you tell me)');
      
      // Check for shorts keywords in the entire item JSON
      const itemJson = JSON.stringify(item);
      console.log('🔬 Contains "/shorts/":', itemJson.includes('/shorts/'));
      console.log('🔬 Contains "reel":', itemJson.toLowerCase().includes('reel'));
      console.log('🔬 Contains "short" (lowercase):', itemJson.toLowerCase().includes('"short'));
      
      // Log title so you can identify it
      if (item.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText) {
        console.log('🔬 Title:', item.tileRenderer.metadata.tileMetadataRenderer.title.simpleText);
      }
      
      console.log('🔬 ---');
    }
  }
  
  if (DEBUG_ENABLED && LOG_SHORTS) {
    console.log('[SHORTS_DIAGNOSTIC] ========================================');
    console.log('[SHORTS_DIAGNOSTIC] Checking video:', videoId);
    console.log('[SHORTS_DIAGNOSTIC] Has tileRenderer:', !!item.tileRenderer);
    console.log('[SHORTS_DIAGNOSTIC] Has videoRenderer:', !!item.videoRenderer);
    console.log('[SHORTS_DIAGNOSTIC] Has gridVideoRenderer:', !!item.gridVideoRenderer);
    
    // Log the FULL structure for Tizen 5.5 debugging
    if (item.tileRenderer) {
      console.log('[SHORTS_DIAGNOSTIC] tileRenderer.contentType:', item.tileRenderer.contentType);
      console.log('[SHORTS_DIAGNOSTIC] tileRenderer.onSelectCommand exists:', !!item.tileRenderer.onSelectCommand);
      
      if (item.tileRenderer.onSelectCommand) {
        console.log('[SHORTS_DIAGNOSTIC] onSelectCommand keys:', Object.keys(item.tileRenderer.onSelectCommand));
        console.log('[SHORTS_DIAGNOSTIC] onSelectCommand has reelWatchEndpoint:', !!item.tileRenderer.onSelectCommand.reelWatchEndpoint);
        
        // Check if ANY property contains 'reel' or 'shorts'
        const cmdStr = JSON.stringify(item.tileRenderer.onSelectCommand);
        console.log('[SHORTS_DIAGNOSTIC] Command contains "reelWatch":', cmdStr.includes('reelWatch'));
        console.log('[SHORTS_DIAGNOSTIC] Command contains "/shorts/":', cmdStr.includes('/shorts/'));
        console.log('[SHORTS_DIAGNOSTIC] Command (first 500 chars):', cmdStr.substring(0, 500));
      }
      
      if (item.tileRenderer.header?.tileHeaderRenderer) {
        console.log('[SHORTS_DIAGNOSTIC] Has header:', true);
        console.log('[SHORTS_DIAGNOSTIC] Header keys:', Object.keys(item.tileRenderer.header));
        console.log('[SHORTS_DIAGNOSTIC] tileHeaderRenderer keys:', Object.keys(item.tileRenderer.header.tileHeaderRenderer || {}));
      }
    }
  }
  
  // Method 1: Check tileRenderer contentType
  if (item.tileRenderer?.contentType === 'TILE_CONTENT_TYPE_SHORT') {
    if (DEBUG_ENABLED && LOG_SHORTS) {
      console.log('[SHORTS_DIAGNOSTIC] ✂️ IS SHORT - Method 1 (contentType)');
      console.log('[SHORTS_DIAGNOSTIC] ========================================');
    }
    return true;
  }
  // Method 12: Check canonical URL (Tizen 5.5 - long shorts appear as regular videos)
  // Check if the video data contains a shorts URL anywhere
  const itemStr = JSON.stringify(item);
  if (itemStr.includes('/shorts/') || itemStr.includes('"isShortsEligible":true')) {
    if (DEBUG_ENABLED && LOG_SHORTS) {
      console.log('[SHORTS_DIAGNOSTIC] ✂️ IS SHORT - Method 12 (canonical URL contains /shorts/)');
      console.log('[SHORTS_DIAGNOSTIC] ========================================');
    }
    return true;
  }
  
  // Method 2: Check videoRenderer
  if (item.videoRenderer) {
    if (item.videoRenderer.thumbnailOverlays) {
      const hasShortsBadge = item.videoRenderer.thumbnailOverlays.some(overlay => 
        overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS' ||
        overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText === 'SHORTS'
      );
      
      if (hasShortsBadge) {
        if (DEBUG_ENABLED && LOG_SHORTS) {
          console.log('[SHORTS_DIAGNOSTIC] ✂️ IS SHORT - Method 2 (videoRenderer overlay)');
          console.log('[SHORTS_DIAGNOSTIC] ========================================');
        }
        return true;
      }
    }
    
    const navEndpoint = item.videoRenderer.navigationEndpoint;
    if (navEndpoint?.reelWatchEndpoint) {
      if (DEBUG_ENABLED && LOG_SHORTS) {
        console.log('[SHORTS_DIAGNOSTIC] ✂️ IS SHORT - Method 2 (reelWatchEndpoint)');
        console.log('[SHORTS_DIAGNOSTIC] ========================================');
      }
      return true;
    }
    
    if (navEndpoint?.commandMetadata?.webCommandMetadata?.url) {
      const url = navEndpoint.commandMetadata.webCommandMetadata.url;
      if (url.includes('/shorts/')) {
        if (DEBUG_ENABLED && LOG_SHORTS) {
          console.log('[SHORTS_DIAGNOSTIC] ✂️ IS SHORT - Method 2 (URL contains /shorts/)');
          console.log('[SHORTS_DIAGNOSTIC] ========================================');
        }
        return true;
      }
    }
  }
  
  // Method 3: Check richItemRenderer
  if (item.richItemRenderer?.content?.reelItemRenderer) {
    if (DEBUG_ENABLED && LOG_SHORTS) {
      console.log('[SHORTS_DIAGNOSTIC] ✂️ IS SHORT - Method 3 (richItemRenderer)');
      console.log('[SHORTS_DIAGNOSTIC] ========================================');
    }
    return true;
  }
  
  // Method 4: Check gridVideoRenderer
  if (item.gridVideoRenderer?.thumbnailOverlays) {
    const hasShortsBadge = item.gridVideoRenderer.thumbnailOverlays.some(overlay =>
      overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.runs?.some(run => run.text === 'SHORTS')
    );
    if (hasShortsBadge) {
      if (DEBUG_ENABLED && LOG_SHORTS) {
        console.log('[SHORTS_DIAGNOSTIC] ✂️ IS SHORT - Method 4 (gridVideoRenderer)');
        console.log('[SHORTS_DIAGNOSTIC] ========================================');
      }
      return true;
    }
  }

  if (item.gridVideoRenderer?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url) {
    const url = item.gridVideoRenderer.navigationEndpoint.commandMetadata.webCommandMetadata.url;
    if (url.includes('/shorts/')) {
      if (DEBUG_ENABLED && LOG_SHORTS) {
        console.log('[SHORTS_DIAGNOSTIC] ✂️ IS SHORT - Method 4b (gridVideoRenderer URL)');
        console.log('[SHORTS_DIAGNOSTIC] ========================================');
      }
      return true;
    }
  }
  
  // Method 5: Check compactVideoRenderer
  if (item.compactVideoRenderer?.thumbnailOverlays) {
    const hasShortsBadge = item.compactVideoRenderer.thumbnailOverlays.some(overlay =>
      overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.runs?.some(run => run.text === 'SHORTS')
    );
    if (hasShortsBadge) {
      if (DEBUG_ENABLED && LOG_SHORTS) {
        console.log('[SHORTS_DIAGNOSTIC] ✂️ IS SHORT - Method 5 (compactVideoRenderer)');
        console.log('[SHORTS_DIAGNOSTIC] ========================================');
      }
      return true;
    }
  }

  if (item.compactVideoRenderer?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url) {
    const url = item.compactVideoRenderer.navigationEndpoint.commandMetadata.webCommandMetadata.url;
    if (url.includes('/shorts/')) {
      if (DEBUG_ENABLED && LOG_SHORTS) {
        console.log('[SHORTS_DIAGNOSTIC] ✂️ IS SHORT - Method 5b (compactVideoRenderer URL)');
        console.log('[SHORTS_DIAGNOSTIC] ========================================');
      }
      return true;
    }
  }
  
  // Method 6: Check tileRenderer reelWatchEndpoint
  if (item.tileRenderer?.onSelectCommand?.reelWatchEndpoint) {
    if (DEBUG_ENABLED && LOG_SHORTS) {
      console.log('[SHORTS_DIAGNOSTIC] ✂️ IS SHORT - Method 6 (tileRenderer reelWatchEndpoint)');
      console.log('[SHORTS_DIAGNOSTIC] ========================================');
    }
    return true;
  }
  
  // Method 6b: Check command string for reelWatch/shorts (Tizen 5.5)
  if (item.tileRenderer?.onSelectCommand) {
    const cmdStr = JSON.stringify(item.tileRenderer.onSelectCommand);
    if (cmdStr.includes('reelWatch') || cmdStr.includes('/shorts/')) {
      if (DEBUG_ENABLED && LOG_SHORTS) {
        console.log('[SHORTS_DIAGNOSTIC] ✂️ IS SHORT - Method 6b (command contains reelWatch or /shorts/)');
        console.log('[SHORTS_DIAGNOSTIC] ========================================');
      }
      return true;
    }
  }
  
  // Method 6c: Check tileRenderer overlay
  if (item.tileRenderer?.header?.tileHeaderRenderer?.thumbnailOverlays) {
    const hasShortsBadge = item.tileRenderer.header.tileHeaderRenderer.thumbnailOverlays.some(overlay =>
      overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.runs?.some(run => run.text === 'SHORTS')
    );
    if (hasShortsBadge) {
      if (DEBUG_ENABLED && LOG_SHORTS) {
        console.log('[SHORTS_DIAGNOSTIC] ✂️ IS SHORT - Method 6c (tileRenderer overlay)');
        console.log('[SHORTS_DIAGNOSTIC] ========================================');
      }
      return true;
    }
  }
  
  // Method 7: Check title for #shorts
  const videoTitle = item.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText || '';
  if (videoTitle.toLowerCase().includes('#shorts') || videoTitle.toLowerCase().includes('#short')) {
    if (DEBUG_ENABLED && LOG_SHORTS) {
      console.log('[SHORTS_DIAGNOSTIC] ✂️ IS SHORT - Method 7 (title contains #shorts)');
      console.log('[SHORTS_DIAGNOSTIC] Title:', videoTitle);
      console.log('[SHORTS_DIAGNOSTIC] ========================================');
    }
    return true;
  }
  
  // Method 8: Check duration
  if (item.tileRenderer) {
    let lengthText = null;
    
    const thumbnailOverlays = item.tileRenderer.header?.tileHeaderRenderer?.thumbnailOverlays;
    if (thumbnailOverlays && Array.isArray(thumbnailOverlays)) {
      const timeOverlay = thumbnailOverlays.find(o => o.thumbnailOverlayTimeStatusRenderer);
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
        const totalSeconds = minutes * 60 + seconds;
        
        if (totalSeconds <= 90) {
          if (DEBUG_ENABLED && LOG_SHORTS) {
            console.log('[SHORTS_DIAGNOSTIC] ✂️ IS SHORT - Method 8 (duration ≤90s)');
            console.log('[SHORTS_DIAGNOSTIC] Duration:', totalSeconds, 'seconds');
            console.log('[SHORTS_DIAGNOSTIC] ========================================');
          }
          return true;
        }
      }
    }
  }

  // Method 9: Check if URL path contains reelItemRenderer or shorts patterns
  if (item.richItemRenderer?.content?.reelItemRenderer) {
    if (DEBUG_ENABLED) {
      console.log('[SHORTS_DIAGNOSTIC] ✂️ IS SHORT - Method 9 (reelItemRenderer)');
    }
    return true;
  }

  // Method 10: Check thumbnail aspect ratio (shorts are vertical ~9:16)
  if (item.tileRenderer?.header?.tileHeaderRenderer?.thumbnail?.thumbnails) {
    const thumb = item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails[0];
    if (thumb && thumb.height > thumb.width) {
      if (DEBUG_ENABLED) {
        console.log('[SHORTS_DIAGNOSTIC] ✂️ IS SHORT - Method 10 (vertical thumbnail)');
        console.log('[SHORTS_DIAGNOSTIC] Dimensions:', thumb.width, 'x', thumb.height);
      }
      return true;
    }
  }

  // NOT A SHORT
  if (DEBUG_ENABLED && LOG_SHORTS) {
    console.log('[SHORTS_DIAGNOSTIC] ❌ NOT A SHORT:', videoId);
    console.log('[SHORTS_DIAGNOSTIC] ========================================');
  }
  return false;
}

function getShelfTitle(shelf) {
  const shelfRendererTitle = shelf?.shelfRenderer?.shelfHeaderRenderer?.title;
  const headerRendererTitle = shelf?.shelfRenderer?.headerRenderer?.shelfHeaderRenderer?.title;
  const topHeaderRendererTitle = shelf?.headerRenderer?.shelfHeaderRenderer?.title;
  const richShelfTitle = shelf?.richShelfRenderer?.title;
  const richSectionTitle = shelf?.richSectionRenderer?.content?.richShelfRenderer?.title;
  const gridHeaderTitle = shelf?.gridRenderer?.header?.gridHeaderRenderer?.title;
  // Tizen 5.5 channels/subscriptions path shown in your logs/screenshots.
  const avatarLockupTitle = shelf?.shelfRenderer?.headerRenderer?.shelfHeaderRenderer?.avatarLockup?.avatarLockupRenderer?.title;
  const topAvatarLockupTitle = shelf?.headerRenderer?.shelfHeaderRenderer?.avatarLockup?.avatarLockupRenderer?.title;

  const titleText = (title) => {
    if (!title) return '';
    if (title.simpleText) return title.simpleText;
    if (Array.isArray(title.runs)) return title.runs.map(run => run.text).join('');
    return '';
  };

  const direct = (
    titleText(shelfRendererTitle) ||
    titleText(headerRendererTitle) ||
    titleText(topHeaderRendererTitle) ||
    titleText(richShelfTitle) ||
    titleText(richSectionTitle) ||
    titleText(gridHeaderTitle) ||
    titleText(avatarLockupTitle) ||
    titleText(topAvatarLockupTitle)
  );

  if (direct) return direct;

  // Fallback: read "...title.runs[0].text" from nested header JSON if shape is odd.
  const shelfJson = JSON.stringify(shelf);
  const match = shelfJson.match(/"avatarLockupRenderer":\{[\s\S]*?"title":\{[\s\S]*?"runs":\[\{"text":"([^"]+)"\}/);
  if (match?.[1]) {
    if (DEBUG_ENABLED) {
      console.log('[SHELF_TITLE] avatarLockup fallback title:', match[1]);
    }
    return match[1];
  }

  return '';
}


function processShelves(shelves, shouldAddPreviews = true) {  
  if (!Array.isArray(shelves)) {
    console.warn('[SHELF_PROCESS] processShelves called with non-array', { type: typeof shelves });
    return;
  }
  
  const page = getCurrentPage();
  const shortsEnabled = configRead('enableShorts');
  const hideWatchedEnabled = configRead('enableHideWatchedVideos');
  const configPages = configRead('hideWatchedVideosPages') || [];
  const shouldHideWatched = hideWatchedEnabled && (configPages.length === 0 || configPages.includes(page));
  
  if (DEBUG_ENABLED) {
    console.log('[SHELF] Page:', page, '| Shelves:', shelves.length, '| Hide watched:', shouldHideWatched, '| Shorts:', shortsEnabled);
  }

  if (window._lastLoggedPage !== page) {
    if (DEBUG_ENABLED) {
      console.log('[PAGE_DEBUG] ========================================');
      console.log('[PAGE_DEBUG] Page changed to:', page);
      console.log('[PAGE_DEBUG] URL:', window.location.href);
      console.log('[PAGE_DEBUG] Hash:', window.location.hash);
      console.log('$$$$$$$$$$$ Shorts enabled:', shortsEnabled);
      console.log('$$$$$$$$$$$ Total shelves:', shelves.length);
      console.log('[PAGE_DEBUG] ========================================');
    }
    window._lastLoggedPage = page;
  }

  // ⭐ ENHANCED DIAGNOSTIC LOGGING for shelf titles
  if (DEBUG_ENABLED && (page === 'subscriptions' || page.includes('channel'))) {
    console.log('$$$$$$$$$$$ SHELF PROCESSING START $$$$$$$$$$$');
    console.log('$$$$$$$$$$$ Page:', page);
    console.log('$$$$$$$$$$$ Shorts enabled:', shortsEnabled);
    console.log('$$$$$$$$$$$ Total shelves:', shelves.length);
    
    console.log('📚📚📚 ALL SHELF TITLES:');
    shelves.forEach((shelf, idx) => {
      console.log(`📚 === Shelf ${idx} ===`);
      console.log('📚 Top-level keys:', Object.keys(shelf));
      
      // ⭐ LOG FULL STRUCTURE for shelf 1 (the shorts shelf)
      if (idx === 1) {
        console.log('📚 🔍 FULL SHELF 1 STRUCTURE (shorts shelf):');
        const fullJson = JSON.stringify(shelf, null, 2);
        console.log('📚 Total JSON length:', fullJson.length, 'chars');
        
        // Split into 2200-char chunks
        const chunkSize = 2200;
        const chunks = Math.ceil(fullJson.length / chunkSize);
        
        for (let i = 0; i < chunks; i++) {
          const start = i * chunkSize;
          const end = Math.min(start + chunkSize, fullJson.length);
          console.log(`📚 JSON Part ${i + 1}/${chunks}:`);
          console.log(fullJson.substring(start, end));
        }
      }
      
      // Check each renderer type
      if (shelf.shelfRenderer) {
        console.log('📚 shelfRenderer keys:', Object.keys(shelf.shelfRenderer));
        if (shelf.shelfRenderer.headerRenderer) {
          console.log('📚   headerRenderer keys:', Object.keys(shelf.shelfRenderer.headerRenderer));
        }
        if (shelf.shelfRenderer.content) {
          console.log('📚   content keys:', Object.keys(shelf.shelfRenderer.content));
        }
      }
      
      if (shelf.richShelfRenderer) {
        console.log('📚 richShelfRenderer keys:', Object.keys(shelf.richShelfRenderer));
        console.log('📚   title:', shelf.richShelfRenderer.title);
      }
      
      if (shelf.gridRenderer) {
        console.log('📚 gridRenderer keys:', Object.keys(shelf.gridRenderer));
        if (shelf.gridRenderer.header) {
          console.log('📚   header keys:', Object.keys(shelf.gridRenderer.header));
        }
      }
      
      if (shelf.richSectionRenderer) {
        console.log('📚 richSectionRenderer keys:', Object.keys(shelf.richSectionRenderer));
      }
      
      // Use getShelfTitle function
      const extractedTitle = getShelfTitle(shelf);
      console.log('📚 Final extracted title:', extractedTitle || '(none)');
      console.log('📚 ---');
    });
    console.log('📚📚📚 END SHELF TITLES');
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
      
      // ⭐ NEW: Check if this is a Shorts shelf by title (Tizen 5.5 detection)
      if (!shortsEnabled) {
        const shelfTitle = getShelfTitle(shelve);
        if (shelfTitle && shelfTitle.trim().toLowerCase() === 'shorts') {
          if (DEBUG_ENABLED) {
            console.log('[SHELF_PROCESS] Removing Shorts shelf by title:', shelfTitle);
          }
          shelves.splice(i, 1);
          shelvesRemoved++;
          continue; // Skip to next shelf
        }

        // ⭐ Also log when we DON'T remove (for debugging)
        if (shelfTitle && shelfTitle.toLowerCase().includes('short')) {
          console.log('🔍 NOT removing shelf (contains "short" but not exact match):', shelfTitle);
        }
      }
      
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
                  
          deArrowify(items);
          hqify(items);
          addLongPress(items);
          if (shouldAddPreviews) addPreviews(items);
          
          // ⭐ SHORTS FILTERING
          if (!shortsEnabled) {
            // Check if this is a shorts shelf by type
            if (shelve.shelfRenderer.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS') {
              if (DEBUG_ENABLED) {
                console.log('[SHELF_PROCESS] Removing entire SHORTS shelf (by type)');
              }
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
          
          // ⭐ WATCHED FILTERING (always runs, independent of shorts)
          const beforeHide = items.length;
          items = hideVideo(items);
          totalHidden += (beforeHide - items.length);
          itemsAfter = items.length;
          
          shelve.shelfRenderer.content.horizontalListRenderer.items = items;
          
          if (items.length === 0) {
            if (DEBUG_ENABLED) {
              console.log('[SHELF_PROCESS] Shelf empty after filtering, removing');
            }
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
            totalShortsRemoved += (beforeShortFilter - items.length);
          }
          
          const beforeHide = items.length;
          items = hideVideo(items);
          totalHidden += (beforeHide - items.length);
          itemsAfter = items.length;
          
          shelve.shelfRenderer.content.gridRenderer.items = items;
          
          if (items.length === 0) {
            if (DEBUG_ENABLED) {
              console.log('[SHELF_PROCESS] Shelf empty after filtering, removing');
            }
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
            if (DEBUG_ENABLED) {
              console.log('[SHELF_PROCESS] Shelf empty after filtering, removing');
            }
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
          totalShortsRemoved += (beforeShortFilter - contents.length);
        }
        
        const beforeHide = contents.length;
        contents = hideVideo(contents);
        totalHidden += (beforeHide - contents.length);
        itemsAfter = contents.length;
        
        shelve.richShelfRenderer.content.richGridRenderer.contents = contents;
        
        if (contents.length === 0) {
          if (DEBUG_ENABLED) {
            console.log('[SHELF_PROCESS] Shelf empty after filtering, removing');
          }
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
            if (LOG_SHORTS && DEBUG_ENABLED) {
              console.log('[SHELF_PROCESS] Removing shorts richSection shelf');
            }
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
          if (DEBUG_ENABLED) {
            console.log('[SHELF_PROCESS] Shelf empty after filtering, removing');
          }
          shelves.splice(i, 1);
          shelvesRemoved++;
          continue;
        }
      }
      
      totalItemsBefore += itemsBefore;
      totalItemsAfter += itemsAfter;
      
    } catch (error) {
      if (DEBUG_ENABLED) {
        console.log('[SHELF] ERROR shelf', (shelves.length - i), ':', error.message);
      }
    }
  }
  
  // FINAL CLEANUP: Remove any remaining empty shelves
  for (let i = shelves.length - 1; i >= 0; i--) {
    const shelve = shelves[i];
    if (!shelve) {
      shelves.splice(i, 1);
      continue;
    }
    
    let isEmpty = false;
    
    if (shelve.shelfRenderer?.content?.horizontalListRenderer?.items) {
      isEmpty = shelve.shelfRenderer.content.horizontalListRenderer.items.length === 0;
    } else if (shelve.shelfRenderer?.content?.gridRenderer?.items) {
      isEmpty = shelve.shelfRenderer.content.gridRenderer.items.length === 0;
    } else if (shelve.shelfRenderer?.content?.verticalListRenderer?.items) {
      isEmpty = shelve.shelfRenderer.content.verticalListRenderer.items.length === 0;
    } else if (shelve.richShelfRenderer?.content?.richGridRenderer?.contents) {
      isEmpty = shelve.richShelfRenderer.content.richGridRenderer.contents.length === 0;
    } else if (shelve.gridRenderer?.items) {
      isEmpty = shelve.gridRenderer.items.length === 0;
    }
    
    if (isEmpty) {
      if (DEBUG_ENABLED) {
        console.log('[SHELF_CLEANUP] Removing empty shelf');
      }
      shelves.splice(i, 1);
    }
  }
  
  // Summary
  if (DEBUG_ENABLED) {
    console.log('[SHELF] Done:', totalItemsBefore, '→', totalItemsAfter, '| Hidden:', totalHidden, '| Shorts:', totalShortsRemoved, '| Removed:', shelvesRemoved, 'shelves');
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
  // Simply delegate to directFilterArray - no code duplication!
  const page = getCurrentPage();
  return directFilterArray(items, page, 'hideVideo');
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

// Track last page to detect changes
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
  
  // PRIORITY 1: Check browse parameters (Tizen TV uses these!)
  
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
  
  // PRIORITY 2: Check traditional patterns
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
    if (DEBUG_ENABLED) {
      console.log(`[PAGE] ${lastDetectedPage||'initial'} → ${detectedPage}`);
      console.log(`[PAGE] Hash: "${cleanHash}"`);
      if (browseParam) console.log(`[PAGE] Browse param: "${browseParam}"`);
    }
    
    window._lastDetectedPage = detectedPage;
    window._lastFullUrl = fullUrl;
  }
  
  return detectedPage;
}


function addPlaylistControlButtons(attempt = 1) {
  const page = getCurrentPage();
  if (page !== 'playlist') return;

  const baseContainer = document.querySelector('.TXB27d.RuKowd.fitbrf.B3hoEd') || document.querySelector('[class*="TXB27d"]');
  if (!baseContainer) {
    if (DEBUG_ENABLED && attempt === 1) {
      console.log('[PLAYLIST_BUTTON] No button container found');
    }
    if (attempt < 6) setTimeout(() => addPlaylistControlButtons(attempt + 1), 1200);
    return;
  }

  const parentContainer = baseContainer.parentElement;
  const baseButtons = Array.from(baseContainer.querySelectorAll('ytlr-button-renderer'));
  const parentButtons = parentContainer ? Array.from(parentContainer.querySelectorAll('ytlr-button-renderer')) : [];

  const useParent = parentButtons.length > baseButtons.length;
  const container = useParent ? parentContainer : baseContainer;
  const existingButtons = useParent ? parentButtons : baseButtons;

  if (DEBUG_ENABLED) {
    console.log('[PLAYLIST_BUTTON] Container selected:', useParent ? 'parent' : 'base', '| buttons:', existingButtons.length);
  }

  if (existingButtons.length === 0) {
    if (attempt < 6) setTimeout(() => addPlaylistControlButtons(attempt + 1), 1200);
    return;
  }

  const existingCustom = container.querySelector('#tizentube-collection-btn');
  if (existingCustom) existingCustom.remove();

  const templateBtn = existingButtons[existingButtons.length - 1];
  const customBtn = templateBtn.cloneNode(true);
  customBtn.id = 'tizentube-collection-btn';

  Array.from(templateBtn.attributes).forEach((attr) => {
    if (attr.name.startsWith('data-') || attr.name === 'tabindex' || attr.name === 'role') {
      customBtn.setAttribute(attr.name, attr.value);
    }
  });

  const label = customBtn.querySelector('yt-formatted-string');
  if (label) {
    label.textContent = '🔄 Refresh Filters';
  }

  customBtn.style.cssText = templateBtn.style.cssText;
  customBtn.style.position = 'relative';
  customBtn.style.top = 'auto';
  customBtn.style.left = 'auto';
  customBtn.style.transform = 'none';
  customBtn.style.display = 'block';
  customBtn.style.visibility = 'visible';
  customBtn.style.opacity = '1';
  customBtn.style.pointerEvents = 'auto';
  customBtn.style.marginTop = '24px';

  const templateHeight = templateBtn.getBoundingClientRect().height || 72;
  const minHeightNeeded = container.scrollHeight + templateHeight + 40;
  container.style.minHeight = `${Math.max(minHeightNeeded, container.clientHeight + templateHeight + 24)}px`;
  container.style.overflow = 'visible';

  customBtn.addEventListener('click', (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    resolveCommand({
      signalAction: {
        signal: 'SOFT_RELOAD_PAGE'
      }
    });
  });

  container.appendChild(customBtn);

  if (DEBUG_ENABLED) {
    const rect = customBtn.getBoundingClientRect();
    console.log('[PLAYLIST_BUTTON] Injected button at y=', Math.round(rect.top), 'h=', Math.round(rect.height));
  }
}


if (typeof window !== 'undefined') {
  setTimeout(() => addPlaylistControlButtons(1), 2500);
  let lastPlaylistButtonHref = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastPlaylistButtonHref) {
      lastPlaylistButtonHref = window.location.href;
      setTimeout(() => addPlaylistControlButtons(1), 1800);
    }
  }, 1200);
}
