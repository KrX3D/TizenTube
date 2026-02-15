import { configRead } from '../config.js';
import Chapters from '../ui/chapters.js';
import resolveCommand from '../resolveCommand.js';
import { ShelfRenderer, TileRenderer } from '../ui/ytUI.js';
import { addLongPress } from './longPress.js';
import { addPreviews } from './previews.js';
import { hideShorts } from './hideShorts.js';
import { applyPreferredVideoCodec } from './videoCodecPreference.js';
import { applySponsorBlockTimelyActions, applySponsorBlockHighlight } from './sponsorblock.js';
import { deArrowify } from './deArrowify.js';
import { hqify } from './hqify.js';
import { applyAdCleanup } from './adCleanup.js';
import { PatchSettings } from '../ui/customYTSettings.js';

// ⭐ CONFIGURATION: Set these to control logging output
const LOG_SHORTS = false;   // Set false to disable shorts logging  
const LOG_WATCHED = true;  // Set true to enable verbose watched-video logging

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
  if (!window._playlistRemovedHelperKeys) {
    window._playlistRemovedHelperKeys = new Set();
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


function getVideoId(item) {
  return item?.tileRenderer?.contentId ||
    item?.videoRenderer?.videoId ||
    item?.playlistVideoRenderer?.videoId ||
    item?.gridVideoRenderer?.videoId ||
    item?.compactVideoRenderer?.videoId ||
    item?.richItemRenderer?.content?.videoRenderer?.videoId ||
    null;
}

function getVideoTitle(item) {
  return (
    item?.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText ||
    item?.videoRenderer?.title?.runs?.[0]?.text ||
    item?.playlistVideoRenderer?.title?.runs?.[0]?.text ||
    item?.gridVideoRenderer?.title?.runs?.[0]?.text ||
    item?.compactVideoRenderer?.title?.simpleText ||
    item?.richItemRenderer?.content?.videoRenderer?.title?.runs?.[0]?.text ||
    ''
  );
}

function collectVideoIdsFromShelf(shelf) {
  const ids = [];
  const seen = new Set();
  const pushFrom = (arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((item) => {
      const id = getVideoId(item);
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    });
  };

  pushFrom(shelf?.shelfRenderer?.content?.horizontalListRenderer?.items);
  pushFrom(shelf?.shelfRenderer?.content?.gridRenderer?.items);
  pushFrom(shelf?.shelfRenderer?.content?.verticalListRenderer?.items);
  pushFrom(shelf?.richShelfRenderer?.content?.richGridRenderer?.contents);
  pushFrom(shelf?.gridRenderer?.items);

  // Fallback: recurse through shelf object to catch Tizen 5.5 variants where
  // Shorts shelf videos are rendered in non-standard branches.
  const stack = [shelf];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (const entry of node) stack.push(entry);
      continue;
    }

    const id = getVideoId(node);
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }

    for (const key in node) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        stack.push(node[key]);
      }
    }
  }

  return ids;
}

function isLikelyPlaylistHelperItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.continuationItemRenderer) return true;
  if (item?.tileRenderer?.onSelectCommand?.continuationCommand) return true;
  if (item?.tileRenderer?.onSelectCommand?.continuationEndpoint) return true;
  if (item?.continuationEndpoint || item?.continuationCommand) return true;

  const videoId = getVideoId(item);
  if (videoId) return false;

  const textParts = getVideoTitle(item).toLowerCase();

  return /scroll|weiter|weiteres|mehr|more|helper|continuation|fortsetzen|laden/.test(textParts);
}


function getVideoKey(item) {
  const id = getVideoId(item);
  const title = item?.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText ||
    item?.videoRenderer?.title?.runs?.[0]?.text ||
    item?.gridVideoRenderer?.title?.runs?.[0]?.text ||
    item?.compactVideoRenderer?.title?.simpleText || '';
  return `${id || 'unknown'}|${title}`;
}

function trackRemovedPlaylistHelperKeys(helperVideos) {
  window._playlistRemovedHelperKeys = window._playlistRemovedHelperKeys || new Set();
  window._playlistRemovedHelperKeyQueue = window._playlistRemovedHelperKeyQueue || [];

  helperVideos.forEach((video) => {
    const key = getVideoKey(video);
    if (!key || key === 'unknown|') return;
    if (!window._playlistRemovedHelperKeys.has(key)) {
      window._playlistRemovedHelperKeys.add(key);
      window._playlistRemovedHelperKeyQueue.push(key);
    }
  });

  const MAX_KEYS = 40;
  while (window._playlistRemovedHelperKeyQueue.length > MAX_KEYS) {
    const oldest = window._playlistRemovedHelperKeyQueue.shift();
    window._playlistRemovedHelperKeys.delete(oldest);
  }
}

function isPageConfigured(configPages, page) {
  if (!Array.isArray(configPages) || configPages.length === 0) return true;
  const normalized = configPages.map(p => String(p).toLowerCase());
  const aliases = {
    playlist: ['playlist'],
    playlists: ['playlists'],
    channel: ['channel', 'channels'],
    channels: ['channel', 'channels'],
    subscriptions: ['subscriptions', 'subscription']
  };
  const candidates = aliases[page] || [page];
  return candidates.some(candidate => normalized.includes(candidate));
}

function shouldHideWatchedForPage(configPages, page) {
  if (!Array.isArray(configPages) || configPages.length === 0) return true;
  if (configPages.includes(page)) return true;

  // Library playlist overview / watch-next should follow library watched-filter setting.
  if (configPages.includes('library') && (page === 'playlist' || page === 'watch')) {
    return true;
  }

  return false;
}

function directFilterArray(arr, page, context = '') {
  if (!Array.isArray(arr) || arr.length === 0) return arr;
  
  // ⭐ Check if this is a playlist page
  let isPlaylistPage;

  // ⭐ Check if this is a playlist page
  isPlaylistPage = (page === 'playlist' || page === 'playlists');
  
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
  const shouldHideWatched = hideWatchedEnabled && shouldHideWatchedForPage(configPages, page);
  
  // Shorts filtering is INDEPENDENT - always check if shorts are disabled
  const shouldFilterShorts = !shortsEnabled && page !== 'playlist' && page !== 'playlists';
  
  // Skip if nothing to do
  if (!shouldFilterShorts && !shouldHideWatched) {
    return arr;
  }
  
  // Generate unique call ID for debugging
  const callId = Math.random().toString(36).substr(2, 6);
  
  // ⭐ Check if this is a playlist page
  isPlaylistPage = (page === 'playlist' || page === 'playlists');
  
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
  if (!window._playlistRemovedHelperKeys) {
    window._playlistRemovedHelperKeys = new Set();
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
    trackRemovedPlaylistHelperKeys(window._lastHelperVideos);
    
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
    
    if (!isVideoItem) {
      if (isPlaylistPage && isLikelyPlaylistHelperItem(item)) {
        return false;
      }
      return true;
    }
    
    const videoId = item.tileRenderer?.contentId || 
                   item.videoRenderer?.videoId || 
                   item.playlistVideoRenderer?.videoId ||
                   item.gridVideoRenderer?.videoId ||
                   item.compactVideoRenderer?.videoId ||
                   'unknown';

    if (videoId !== 'unknown' && window._shortsVideoIdsFromShelves?.has(videoId)) {
      if (LOG_SHORTS && DEBUG_ENABLED) {
        console.log('[SHORTS_SHELF] Removing item by previously removed shorts shelf ID:', videoId);
      }
      return false;
    }

    const videoTitle = getVideoTitle(item).trim().toLowerCase();
    if (videoTitle && window._shortsTitlesFromShelves?.has(videoTitle)) {
      if (LOG_SHORTS && DEBUG_ENABLED) {
        console.log('[SHORTS_SHELF] Removing item by previously removed shorts shelf TITLE:', videoTitle);
      }
      return false;
    }

    const videoKey = getVideoKey(item);
    if (isPlaylistPage && isLikelyPlaylistHelperItem(item)) {
      return false;
    }
    if (isPlaylistPage && (window._playlistRemovedHelpers.has(videoId) || window._playlistRemovedHelperKeys?.has(videoKey))) {
      if (DEBUG_ENABLED) {
        console.log('[HELPER_CLEANUP] Removing stale helper from data:', videoId, '| key=', videoKey);
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
  
  // ⭐ PLAYLIST SAFEGUARD: keep one helper tile so TV can request next batch.
  if (isPlaylistPage && filtered.length === 0 && arr.length > 0 && !isLastBatch) {
    
    // ⭐ CHECK: Are we in filter mode? If so, NO helpers needed!
    if (filterIds) {
      console.log('[FILTER_MODE] 🔄 All filtered in this batch - no helpers needed (filter mode active)');
      return [];  // Return empty - we're showing only specific videos
    }
    
    const lastVideo = [...arr].reverse().find((item) => !!getVideoId(item)) || arr[arr.length - 1];
    const lastVideoId = getVideoId(lastVideo) || 'unknown';
    if (DEBUG_ENABLED) {
      console.log('[HELPER] ALL FILTERED - keeping 1 helper for continuation trigger:', lastVideoId);
    }
    window._lastHelperVideos = [lastVideo];
    window._playlistScrollHelpers.clear();
    window._playlistScrollHelpers.add(lastVideoId);
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
      const helperIdsToTrack = window._lastHelperVideos.map((video) => getVideoId(video)).filter(Boolean);
      trackRemovedPlaylistHelpers(helperIdsToTrack);
      trackRemovedPlaylistHelperKeys(window._lastHelperVideos);
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
    console.log('--------------------------------->> All helpers cleared!');
  }
  
  return filtered;
}

function scanAndFilterAllArrays(obj, page, path = 'root') {
  if (!obj || typeof obj !== 'object') return;
  window._shortsVideoIdsFromShelves = window._shortsVideoIdsFromShelves || new Set();
  window._shortsTitlesFromShelves = window._shortsTitlesFromShelves || new Set();
  
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

      if (page === 'subscriptions') {
        for (let i = 0; i < obj.length; i++) {
          const shelf = obj[i];
          const shelfTitle = getShelfTitle(shelf);
          if (shelfTitle && shelfTitle.toLowerCase().includes('short')) {
            console.log('[SUBS_SHORTS_SHELF] seen title=', shelfTitle, '| path=', path + '[' + i + ']', '| shortsEnabled=', shortsEnabled);
          }
        }
      }
      
      // ⭐ FIRST: Remove Shorts shelves by title (before recursive filtering)
      if (!shortsEnabled) {
        for (let i = obj.length - 1; i >= 0; i--) {
          const shelf = obj[i];
          const shelfTitle = getShelfTitle(shelf);
          if (shelfTitle && (shelfTitle.toLowerCase().includes('shorts') || shelfTitle.toLowerCase().includes('short'))) {
            if (LOG_SHORTS && DEBUG_ENABLED) {
              console.log('[SCAN] Removing Shorts shelf by title:', shelfTitle, 'at:', path);
            }
            const ids = collectVideoIdsFromShelf(shelf);
            ids.forEach((id) => window._shortsVideoIdsFromShelves.add(id));
            console.log('[SUBS_SHORTS_SHELF] removed title=', shelfTitle, '| ids=', ids.length, '| path=', path, '| page=', page);
            const stack = [shelf];
            while (stack.length) {
              const node = stack.pop();
              if (!node || typeof node !== 'object') continue;
              if (Array.isArray(node)) {
                node.forEach((entry) => stack.push(entry));
                continue;
              }
              const title = getVideoTitle(node).trim().toLowerCase();
              if (title) window._shortsTitlesFromShelves.add(title);
              for (const key in node) {
                if (Object.prototype.hasOwnProperty.call(node, key)) {
                  stack.push(node[key]);
                }
              }
            }
            obj.splice(i, 1);
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
    if (data.mode === 'filtering' && Array.isArray(data.videoIds)) {
      if (data.videoIds.length === 0) {
        localStorage.removeItem(PLAYLIST_STORAGE_KEY);
        return null;
      }
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

  applyAdCleanup(r, adBlockEnabled);

  if (r.paidContentOverlay && !configRead('enablePaidPromotionOverlay')) {
    //console.log('ADBLOCK', 'Removing paid content overlay');
    r.paidContentOverlay = null;
  }

  applyPreferredVideoCodec(r, configRead('videoPreferredCodec'));

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
    const effectivePage = page === 'other' ? (window._lastDetectedPage || page) : page;
    if (DEBUG_ENABLED) {
      console.log('[CONTINUATION]', page, '(effective:', effectivePage + ') - Processing', r.continuationContents.sectionListContinuation.contents.length, 'shelves');
    }

    if (window._lastLoggedPage !== effectivePage) {
      if (DEBUG_ENABLED) {
        console.log('[PAGE_DEBUG] ========================================');
        console.log('[PAGE_DEBUG] Page changed to:', effectivePage);
        console.log('[PAGE_DEBUG] URL:', window.location.href);
        console.log('[PAGE_DEBUG] Hash:', window.location.hash);
        console.log('[PAGE_DEBUG] ========================================');
      }
      window._lastLoggedPage = effectivePage;
    }

    scanAndFilterAllArrays(r.continuationContents.sectionListContinuation.contents, effectivePage, 'sectionListContinuation');
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
  
    
    // Continue with normal processing via universal filter
  }
  
  // Handle onResponseReceivedActions (lazy-loaded channel tabs AND PLAYLIST SCROLLING)
  if (r?.onResponseReceivedActions) {
    const page = getCurrentPage();
    const effectivePage = page === 'other' ? (window._lastDetectedPage || page) : page;
    
    if (DEBUG_ENABLED) {
      console.log('[ON_RESPONSE] ========================================');
      console.log('[ON_RESPONSE] Page:', page, '| effective:', effectivePage);
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
    deArrowify(r.continuationContents.horizontalListContinuation.items, configRead('enableDeArrow'), configRead('enableDeArrowThumbnails'));
    hqify(r.continuationContents.horizontalListContinuation.items, configRead('enableHqThumbnails'));
    addLongPress(r.continuationContents.horizontalListContinuation.items, configRead('enableLongPress'));
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

  applySponsorBlockTimelyActions(r, configRead('sponsorBlockManualSkips'));
  applySponsorBlockHighlight(r, configRead('enableSponsorBlockHighlight'));
  
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
    
    // keep diagnostics lightweight: only emit detailed logs when <= 90s method triggers
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
          console.log('[SHORTS_DIAGNOSTIC] ✂️ IS SHORT - Method 8 (duration ≤90s) | id=', videoId, '| duration=', totalSeconds);
          return true;
        }
      }
    }
  }

  // Method 9: Check if URL path contains reelItemRenderer or shorts patterns
  if (item.richItemRenderer?.content?.reelItemRenderer) {
    if (DEBUG_ENABLED && LOG_SHORTS) {
      console.log('[SHORTS_DIAGNOSTIC] ✂️ IS SHORT - Method 9 (reelItemRenderer)');
    }
    return true;
  }

  // Method 10: Check thumbnail aspect ratio (shorts are vertical ~9:16)
  if (item.tileRenderer?.header?.tileHeaderRenderer?.thumbnail?.thumbnails) {
    const thumb = item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails[0];
    if (thumb && thumb.height > thumb.width) {
      if (DEBUG_ENABLED && LOG_SHORTS) {
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
  const titleText = (title) => {
    if (!title) return '';
    if (title.simpleText) return title.simpleText;
    if (Array.isArray(title.runs)) return title.runs.map(run => run.text).join('');
    return '';
  };

  const titlePaths = [
    shelf?.shelfRenderer?.shelfHeaderRenderer?.title,
    shelf?.shelfRenderer?.headerRenderer?.shelfHeaderRenderer?.title,
    shelf?.headerRenderer?.shelfHeaderRenderer?.title,
    shelf?.richShelfRenderer?.title,
    shelf?.richSectionRenderer?.content?.richShelfRenderer?.title,
    shelf?.gridRenderer?.header?.gridHeaderRenderer?.title,
    shelf?.shelfRenderer?.headerRenderer?.shelfHeaderRenderer?.avatarLockup?.avatarLockupRenderer?.title,
    shelf?.headerRenderer?.shelfHeaderRenderer?.avatarLockup?.avatarLockupRenderer?.title,
  ];

  for (const rawTitle of titlePaths) {
    const text = titleText(rawTitle);
    if (text) return text;
  }

  return '';
}


function processShelves(shelves, shouldAddPreviews = true) {  
  if (!Array.isArray(shelves)) {
    console.warn('[SHELF_PROCESS] processShelves called with non-array', { type: typeof shelves });
    return;
  }

  window._shortsVideoIdsFromShelves = window._shortsVideoIdsFromShelves || new Set();
  
  const page = getCurrentPage();
  const shortsEnabled = configRead('enableShorts');
  const horizontalShelves = shelves.filter((shelve) => shelve?.shelfRenderer?.content?.horizontalListRenderer?.items);
  hideShorts(horizontalShelves, shortsEnabled, (removedShelf) => {
    collectVideoIdsFromShelf(removedShelf).forEach((id) => window._shortsVideoIdsFromShelves.add(id));
  });
  const hideWatchedEnabled = configRead('enableHideWatchedVideos');
  const configPages = configRead('hideWatchedVideosPages') || [];
  const shouldHideWatched = hideWatchedEnabled && shouldHideWatchedForPage(configPages, page);
  
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

  // Lightweight diagnostics only (full per-shelf dumps are too slow on TV)
  if (DEBUG_ENABLED && (page === 'subscriptions' || page.includes('channel'))) {
    console.log('[SHELF_PROCESS] page=', page, '| shelves=', shelves.length, '| shortsEnabled=', shortsEnabled);
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
        if (page === 'subscriptions' && shelfTitle && shelfTitle.toLowerCase().includes('short')) {
          console.log('[SUBS_SHORTS_SHELF] processShelves seen title=', shelfTitle, '| index=', i, '| shortsEnabled=', shortsEnabled);
        }
        if (shelfTitle && (shelfTitle.toLowerCase().includes('shorts') || shelfTitle.toLowerCase().includes('short'))) {
          if (DEBUG_ENABLED || LOG_SHORTS) {
            console.log('[SHELF_PROCESS] Removing Shorts shelf by title:', shelfTitle);
          }
          const ids = collectVideoIdsFromShelf(shelve);
          ids.forEach((id) => window._shortsVideoIdsFromShelves.add(id));
          console.log('[SUBS_SHORTS_SHELF] processShelves removed title=', shelfTitle, '| ids=', ids.length, '| page=', page);
          shelves.splice(i, 1);
          shelvesRemoved++;
          continue; // Skip to next shelf
        }

        // ⭐ Also log when we DON'T remove (for debugging)
        if (shelfTitle && shelfTitle.toLowerCase().includes('short')) {
          console.log('🔍 NOT removing shelf (contains "short" but not exact match):', shelfTitle);
        }
        if (DEBUG_ENABLED && shelfTitle && shelfTitle.toLowerCase().includes('short')) {
          console.log('[SHELF_PROCESS] Keeping non-exact short shelf title:', shelfTitle);
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
          const originalItems = Array.isArray(items) ? items.slice() : [];
          itemsBefore = items.length;
                  
          deArrowify(items, configRead('enableDeArrow'), configRead('enableDeArrowThumbnails'));
          hqify(items, configRead('enableHqThumbnails'));
          addLongPress(items, configRead('enableLongPress'));
          addPreviews(items, shouldAddPreviews);
          
          // ⭐ SHORTS FILTERING
          if (!shortsEnabled) {
            const beforeShortFilter = items.length;
            items = items.filter(item => !isShortItem(item));
            totalShortsRemoved += (beforeShortFilter - items.length);
          }
          
          // ⭐ WATCHED FILTERING (always runs, independent of shorts)
          const beforeHide = items.length;
          if (shouldHideWatched) {
            items = hideVideo(items);
            totalHidden += (beforeHide - items.length);
          }
          if (shouldHideWatched && items.length === 0 && originalItems.length > 0) {
            if (DEBUG_ENABLED) console.log('[SHELF_PROCESS] Watched filter would empty shelf; keeping original items to avoid black screen');
            items = originalItems;
          }
          itemsAfter = items.length;
          
          shelve.shelfRenderer.content.horizontalListRenderer.items = items;
          
          if (items.length === 0) {
            if (DEBUG_ENABLED) {
              console.log('[SHELF_PROCESS] Shelf empty after filtering, removing');
            }
            collectVideoIdsFromShelf(shelve).forEach((id) => window._shortsVideoIdsFromShelves.add(id));
            shelves.splice(i, 1);
            shelvesRemoved++;
            continue;
          }
        }
        
        // gridRenderer
        else if (shelve.shelfRenderer.content?.gridRenderer?.items) {
          shelfType = 'grid';
          let items = shelve.shelfRenderer.content.gridRenderer.items;
          const originalItems = Array.isArray(items) ? items.slice() : [];
          itemsBefore = items.length;

          deArrowify(items, configRead('enableDeArrow'), configRead('enableDeArrowThumbnails'));
          hqify(items, configRead('enableHqThumbnails'));
          addLongPress(items, configRead('enableLongPress'));
          addPreviews(items, shouldAddPreviews);
          
          if (!shortsEnabled) {
            const beforeShortFilter = items.length;
            items = items.filter(item => !isShortItem(item));
            totalShortsRemoved += (beforeShortFilter - items.length);
          }
          
          const beforeHide = items.length;
          if (shouldHideWatched) {
            items = hideVideo(items);
            totalHidden += (beforeHide - items.length);
          }
          if (shouldHideWatched && items.length === 0 && originalItems.length > 0) {
            if (DEBUG_ENABLED) console.log('[SHELF_PROCESS] Watched filter would empty shelf; keeping original items to avoid black screen');
            items = originalItems;
          }
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
          const originalItems = Array.isArray(items) ? items.slice() : [];
          itemsBefore = items.length;

          deArrowify(items, configRead('enableDeArrow'), configRead('enableDeArrowThumbnails'));
          hqify(items, configRead('enableHqThumbnails'));
          addLongPress(items, configRead('enableLongPress'));
          addPreviews(items, shouldAddPreviews);
          
          if (!shortsEnabled) {
            const beforeShortFilter = items.length;
            items = items.filter(item => !isShortItem(item));
            totalShortsRemoved += (beforeShortFilter - items.length);
          }
          
          const beforeHide = items.length;
          if (shouldHideWatched) {
            items = hideVideo(items);
            totalHidden += (beforeHide - items.length);
          }
          if (shouldHideWatched && items.length === 0 && originalItems.length > 0) {
            if (DEBUG_ENABLED) console.log('[SHELF_PROCESS] Watched filter would empty shelf; keeping original items to avoid black screen');
            items = originalItems;
          }
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
        const originalContents = Array.isArray(contents) ? contents.slice() : [];
        itemsBefore = contents.length;

        deArrowify(contents, configRead('enableDeArrow'), configRead('enableDeArrowThumbnails'));
        hqify(contents, configRead('enableHqThumbnails'));
        addLongPress(contents, configRead('enableLongPress'));
        addPreviews(contents, shouldAddPreviews);
        
        if (!shortsEnabled) {
          const beforeShortFilter = contents.length;
          contents = contents.filter(item => !isShortItem(item));
          totalShortsRemoved += (beforeShortFilter - contents.length);
        }
        
        const beforeHide = contents.length;
        if (shouldHideWatched) {
          contents = hideVideo(contents);
          totalHidden += (beforeHide - contents.length);
        }
        if (shouldHideWatched && contents.length === 0 && originalContents.length > 0) {
          if (DEBUG_ENABLED) console.log('[SHELF_PROCESS] Watched filter would empty shelf; keeping original items to avoid black screen');
          contents = originalContents;
        }
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
        const originalItems = Array.isArray(items) ? items.slice() : [];
        itemsBefore = items.length;

        deArrowify(items, configRead('enableDeArrow'), configRead('enableDeArrowThumbnails'));
        hqify(items, configRead('enableHqThumbnails'));
        addLongPress(items, configRead('enableLongPress'));
        addPreviews(items, shouldAddPreviews);
        
        if (!shortsEnabled) {
          const beforeShortFilter = items.length;
          items = items.filter(item => !isShortItem(item));
          totalShortsRemoved += (beforeShortFilter - items.length);
        }
        
        const beforeHide = items.length;
        if (shouldHideWatched) {
          items = hideVideo(items);
          totalHidden += (beforeHide - items.length);
        }
        if (shouldHideWatched && items.length === 0 && originalItems.length > 0) {
          if (DEBUG_ENABLED) console.log('[SHELF_PROCESS] Watched filter would empty shelf; keeping original items to avoid black screen');
          items = originalItems;
        }
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


function logChunked(prefix, text, chunkSize = 20000) {
  if (!text) return;
  const total = Math.ceil(text.length / chunkSize);
  // Visual console shows newest logs first; emit chunks in reverse so users
  // can read [1/total] ... [total/total] top-to-bottom.
  for (let partIndex = total; partIndex >= 1; partIndex--) {
    const i = (partIndex - 1) * chunkSize;
    const part = text.slice(i, i + chunkSize);
    // Keep metadata + chunk in one log line so each entry shows context and payload together.
    console.log(`${prefix} [${partIndex}/${total}] len=${part.length} ${part}`);
  }
}




function cleanupPlaylistHelperTiles() {
  const page = getCurrentPage();
  if (page !== 'playlist') return;

  const removedIds = window._playlistRemovedHelpers || new Set();
  const removedKeys = window._playlistRemovedHelperKeys || new Set();
  const currentHelperIds = new Set((window._lastHelperVideos || []).map((video) => getVideoId(video)).filter(Boolean));
  const candidates = document.querySelectorAll('ytlr-grid-video-renderer, ytlr-rich-grid-renderer ytlr-grid-video-renderer, ytlr-item-section-renderer ytlr-grid-video-renderer, ytlr-continuation-item-renderer, [class*="continuation"], [data-video-id]');
  let removedCount = 0;

  candidates.forEach((node) => {
    const videoId = node.getAttribute('data-video-id') || node.getAttribute('video-id') || node.dataset?.videoId || '';
    const text = (node.textContent || '').toLowerCase();
    const html = (node.innerHTML || '').toLowerCase();
    const looksLikeHelper = /scroll|weiter|more|continuation|fortsetzen|laden/.test(text) || /continuation/.test(html);
    const key = `${videoId}:${text.slice(0, 80)}`;

    if ((videoId && (removedIds.has(videoId) || currentHelperIds.has(videoId))) || removedKeys.has(key) || looksLikeHelper) {
      node.remove();
      removedCount += 1;
    }
  });

  if (removedCount > 0 && DEBUG_ENABLED) {
    console.log('[HELPER_CLEANUP_DOM] Removed helper tiles from DOM:', removedCount);
  }
}

function detectPlaylistButtons() {
  if (getCurrentPage() !== 'playlist') return;
  addPlaylistControlButtons(1);
}


function addPlaylistControlButtons(attempt = 1) {
  const page = getCurrentPage();
  if (page !== 'playlist') return;

  const baseContainer = document.querySelector('.TXB27d.RuKowd.fitbrf.B3hoEd') || document.querySelector('[class*="TXB27d"]');
  if (!baseContainer) {
    console.log('[PLAYLIST_BUTTON] No button container found (attempt ' + attempt + ')');
    if (attempt < 6) setTimeout(() => addPlaylistControlButtons(attempt + 1), 1200);
    return;
  }

  const parentContainer = baseContainer.parentElement;
  const baseButtons = Array.from(baseContainer.querySelectorAll('ytlr-button-renderer'));
  const parentButtons = parentContainer ? Array.from(parentContainer.querySelectorAll('ytlr-button-renderer')) : [];

  if (attempt === 1 && DEBUG_ENABLED) {
    console.log('[PLAYLIST_BUTTON] base buttons:', baseButtons.length, '| parent buttons:', parentButtons.length);
  }

  const useParent = parentButtons.length > baseButtons.length;
  const container = useParent ? parentContainer : baseContainer;
  const existingButtons = useParent ? parentButtons : baseButtons;
  const currentUrl = window.location.href;

  console.log('[PLAYLIST_BUTTON] Container=', useParent ? 'parent' : 'base', '| buttons=', existingButtons.length, '| attempt=', attempt);

  if (existingButtons.length === 0) {
    console.log('[PLAYLIST_BUTTON] No native buttons in container (attempt ' + attempt + ')');
    if (attempt < 6) setTimeout(() => addPlaylistControlButtons(attempt + 1), 1200);
    return;
  }

  if (attempt <= 6) {
    window._playlistButtonDumpUrl = currentUrl;
    try {
      const targetHostForDump = (parentContainer || container);
      const existingCustomBtn = document.querySelector('#tizentube-collection-btn');
      const dump = {
        page,
        baseButtonsBefore: baseButtons.length,
        parentButtonsBefore: parentButtons.length,
        baseTag: baseContainer.tagName,
        baseClass: baseContainer.className,
        baseOuterHTML: baseContainer.outerHTML,
        parentTag: parentContainer?.tagName,
        parentClass: parentContainer?.className,
        parentOuterHTML: parentContainer?.outerHTML,
        targetTag: targetHostForDump.tagName,
        targetClass: targetHostForDump.className,
        targetOuterHTML: targetHostForDump.outerHTML,
        targetParentTag: targetHostForDump.parentElement?.tagName,
        targetParentClass: targetHostForDump.parentElement?.className,
        targetParentOuterHTML: targetHostForDump.parentElement?.outerHTML,
        buttonOuterHTML: existingButtons.map((btn) => btn.outerHTML),
        existingCustomButtonOuterHTML: existingCustomBtn?.outerHTML || null,
      };
      console.log('[PLAYLIST_BUTTON_JSON] Dumping button/container snapshot attempt=', attempt);
      logChunked('[PLAYLIST_BUTTON_JSON]', JSON.stringify(dump), 20000);
    } catch (e) {
      console.log('[PLAYLIST_BUTTON_JSON] Failed to stringify button container', e?.message || e);
    }
  }

  if (window._playlistButtonInjectedUrl === currentUrl && document.querySelector('#tizentube-collection-btn')) {
    if (attempt === 1) {
      console.log('[PLAYLIST_BUTTON] Custom button already injected for URL; skip');
    }
    return;
  }

  const existingCustom = document.querySelector('#tizentube-collection-btn');
  if (existingCustom) {
    console.log('[PLAYLIST_BUTTON] Existing custom button found; replacing (attempt ' + attempt + ')');
    existingCustom.remove();
  }

  const templateBtn = existingButtons[existingButtons.length - 1];
  const customBtn = templateBtn.cloneNode(true);
  customBtn.id = 'tizentube-collection-btn';
  // Keep native classes/structure for TV focus behavior, but remove inline positioning
  // that can pin the clone over native buttons.
  customBtn.removeAttribute('style');
  customBtn.querySelectorAll('[style]').forEach((el) => el.removeAttribute('style'));
  customBtn.removeAttribute('aria-hidden');
  customBtn.setAttribute('tabindex', '0');
  customBtn.style.pointerEvents = 'auto';
  customBtn.style.setProperty('position', 'static', 'important');
  customBtn.style.setProperty('top', 'auto', 'important');
  customBtn.style.setProperty('left', 'auto', 'important');
  customBtn.style.setProperty('transform', 'none', 'important');
  customBtn.style.setProperty('display', 'inline-flex', 'important');
  customBtn.removeAttribute('disablehybridnavinsubtree');
  customBtn.querySelectorAll('[disablehybridnavinsubtree]').forEach((el) => el.removeAttribute('disablehybridnavinsubtree'));
  customBtn.querySelectorAll('[aria-hidden]').forEach((el) => el.setAttribute('aria-hidden', 'false'));

  const labelNode = customBtn.querySelector('yt-formatted-string');
  if (labelNode) {
    labelNode.textContent = 'Refresh Filters';
  }

  const runRefresh = (evt) => {
    evt?.preventDefault?.();
    evt?.stopPropagation?.();
    resolveCommand({
      signalAction: {
        signal: 'SOFT_RELOAD_PAGE'
      }
    });
  };

  customBtn.style.zIndex = '1';
  customBtn.style.pointerEvents = 'auto';
  customBtn.addEventListener('click', runRefresh);
  customBtn.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter' || evt.key === ' ') {
      runRefresh(evt);
    }
  });

  const innerButton = customBtn.querySelector('button');
  if (innerButton) {
    innerButton.style.pointerEvents = 'auto';
    innerButton.style.position = 'static';
    innerButton.style.transform = 'none';
    innerButton.removeAttribute('disabled');
    innerButton.setAttribute('tabindex', '0');
    innerButton.addEventListener('click', runRefresh);
  }

  const nativeButtonRects = existingButtons.map((btn, idx) => {
    const r = btn.getBoundingClientRect();
    return { idx, y: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), id: btn.id || null };
  });
  console.log('[PLAYLIST_BUTTON] Native button rects:', JSON.stringify(nativeButtonRects));

  // Keep button row visible but avoid inflating height on every reinjection attempt.
  container.style.overflow = 'visible';
  const rowMinHeight = Math.max(container.scrollHeight, container.clientHeight, 90);
  container.style.minHeight = `${rowMinHeight}px`;
  if (container.parentElement) {
    container.parentElement.style.overflow = 'visible';
    const parentMinHeight = Math.max(container.parentElement.scrollHeight, container.parentElement.clientHeight, rowMinHeight + 8);
    container.parentElement.style.minHeight = `${parentMinHeight}px`;
  }

  // Insert after the last native button to keep row order and avoid overlaying first button.
  templateBtn.insertAdjacentElement('afterend', customBtn);

  const templateRect = templateBtn.getBoundingClientRect();
  const crect = container.getBoundingClientRect();
  container.style.position = 'relative';
  customBtn.style.position = 'absolute';
  customBtn.style.left = `${Math.max(0, Math.round(templateRect.left - crect.left))}px`;
  customBtn.style.top = `${Math.max(0, Math.round(templateRect.top - crect.top + templateRect.height))}px`;
  customBtn.style.width = `${Math.round(templateRect.width)}px`;
  customBtn.style.height = `${Math.round(templateRect.height)}px`;
  customBtn.style.transform = 'none';
  customBtn.style.zIndex = '2';

  const requiredHeight = Math.max(container.clientHeight, Math.round((templateRect.top - crect.top) + templateRect.height * 2 + 8));
  container.style.minHeight = `${requiredHeight}px`;

  window._playlistButtonInjectedUrl = currentUrl;

  const rect = customBtn.getBoundingClientRect();
  console.log('[PLAYLIST_BUTTON] Injected button at y=', Math.round(rect.top), 'h=', Math.round(rect.height), '| container y=', Math.round(crect.top), 'h=', Math.round(crect.height));

  try {
    const postButtons = Array.from(container.querySelectorAll('ytlr-button-renderer'));
    const postButtonRects = postButtons.map((btn, idx) => {
      const r = btn.getBoundingClientRect();
      return { idx, y: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), id: btn.id || null };
    });

    const afterDump = {
      page,
      attempt,
      clonedCustomButtonOuterHTML: customBtn.outerHTML,
      clonedCustomButtonRect: { y: Math.round(rect.top), h: Math.round(rect.height), w: Math.round(rect.width) },
      containerRect: { y: Math.round(crect.top), h: Math.round(crect.height), w: Math.round(crect.width) },
      nativeButtonRectsBefore: nativeButtonRects,
      parentButtonsAfter: postButtons.length,
      nativeButtonRectsAfter: postButtonRects,
      baseOuterHTMLAfter: baseContainer.outerHTML,
      parentOuterHTMLAfter: parentContainer?.outerHTML || null,
    };
    logChunked('[PLAYLIST_BUTTON_JSON_AFTER]', JSON.stringify(afterDump, null, 2), 20000);
  } catch (e) {
    console.log('[PLAYLIST_BUTTON_JSON_AFTER] Failed to stringify injected button', e?.message || e);
  }
}


if (typeof window !== 'undefined') {
  setTimeout(() => { addPlaylistControlButtons(1); cleanupPlaylistHelperTiles(); }, 2500);
  let lastPlaylistButtonHref = window.location.href;
  setInterval(() => {
    const page = getCurrentPage();
    if (page === 'playlist' || page === 'playlists') {
      cleanupPlaylistHelperTiles();
    }
    if (window.location.href !== lastPlaylistButtonHref) {
      lastPlaylistButtonHref = window.location.href;
      if (page === 'playlist') {
        setTimeout(() => { addPlaylistControlButtons(1); cleanupPlaylistHelperTiles(); }, 1800);
      }
    }
  }, 3000);
}
