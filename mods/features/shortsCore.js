export function initShortsTrackingState() {
  window._shortsVideoIdsFromShelves = window._shortsVideoIdsFromShelves || new Set();
  window._shortsTitlesFromShelves = window._shortsTitlesFromShelves || new Set();
}

export function shouldFilterShorts(shortsEnabled, page) {
  const result = !shortsEnabled && page !== 'playlist' && page !== 'playlists';
  console.log('[DIAGNOSTIC_SHORTS] shouldFilterShorts | shortsEnabled:', shortsEnabled, '| page:', page, '| result:', result);
  return result;
}

export function isShortsShelfTitle(title = '') {
  const t = String(title).toLowerCase();
  return t.includes('shorts') || t.includes('short');
}

export function rememberShortsFromShelf(shelf, collectVideoIdsFromShelf, getVideoTitle) {
  initShortsTrackingState();
  const ids = collectVideoIdsFromShelf(shelf);
  
  // ⭐ CRITICAL: Store in BOTH memory structures
  ids.forEach((id) => {
    if (id && id !== 'unknown') {
      window._shortsVideoIdsFromShelves.add(id);
    }
  });

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

  console.log('[SHORTS_MEMORY] Stored', ids.length, 'IDs from shelf | Total in memory:', window._shortsVideoIdsFromShelves.size);
  return ids;
}

export function isKnownShortFromShelfMemory(item, getVideoId, getVideoTitle) {
  const id = getVideoId(item);
  if (id !== 'unknown' && window._shortsVideoIdsFromShelves?.has(id)) return true;

  const title = getVideoTitle(item).trim().toLowerCase();
  return !!title && !!window._shortsTitlesFromShelves?.has(title);
}

export function removeShortsShelvesByTitle(shelves, { page, shortsEnabled, collectVideoIdsFromShelf, getVideoTitle, debugEnabled = false, logShorts = false, path = '' } = {}) {
  if (!Array.isArray(shelves) || shortsEnabled) return 0;
  initShortsTrackingState();

  let removed = 0;
  for (let i = shelves.length - 1; i >= 0; i--) {
    const shelf = shelves[i];
    const title = getShelfTitle(shelf);
    if (!isShortsShelfTitle(title)) continue;

    const ids = rememberShortsFromShelf(shelf, collectVideoIdsFromShelf, getVideoTitle);
    
    // ⭐ ALSO store in global set
    ids.forEach(id => {
      if (id && id !== 'unknown') {
        window._shortsVideoIdsFromShelves.add(id);
      }
    });
    
    if (debugEnabled || logShorts) {
      console.log('✂️✂️✂️ [SHORTS_SHELF] Removing shelf:', title, '| Videos tagged:', ids.length, '| Path:', path || i);
      console.log('✂️✂️✂️ [SHORTS_SHELF] Global memory now has:', window._shortsVideoIdsFromShelves.size, 'shorts');
    }
    
    shelves.splice(i, 1);
    removed++;
  }

  return removed;
}

export function filterShortItems(items, { page, debugEnabled = false, logShorts = false } = {}) {
  if (!Array.isArray(items)) return { items: [], removed: 0 };
  const filtered = items.filter((item) => !isShortItem(item, { debugEnabled, logShorts, currentPage: page || 'other' }));
  return { items: filtered, removed: items.length - filtered.length };
}

export function isShortItem(item, { debugEnabled = false, logShorts = false, currentPage = '' } = {}) {
  if (!item) return false;

  const videoId = item.tileRenderer?.contentId ||
    item.videoRenderer?.videoId ||
    item.gridVideoRenderer?.videoId ||
    item.compactVideoRenderer?.videoId ||
    'unknown';

  const page = currentPage || 'other';

  // ⭐ CRITICAL: Check global shorts memory FIRST with logging
  if (videoId && videoId !== 'unknown') {
    const inMemory = window._shortsVideoIdsFromShelves?.has(videoId);
    if (debugEnabled || page === 'subscriptions') {
      console.log('[SHORTS_CHECK]', videoId, '| In memory:', inMemory, '| Page:', page, '| Memory size:', window._shortsVideoIdsFromShelves?.size || 0);
    }
    if (inMemory) {
      console.log('✂️✂️✂️ [MEMORY] Found in shelf memory:', videoId);
      return true;
    }
  }

  // ⭐ NEW: Tizen 5.5 specific - check for shorts in any renderer type FIRST
  const allRenderers = [
    item.tileRenderer,
    item.videoRenderer, 
    item.gridVideoRenderer,
    item.compactVideoRenderer,
    item.richItemRenderer?.content?.videoRenderer
  ].filter(Boolean);

  for (const renderer of allRenderers) {
    // Check navigation endpoint for /shorts/ URL
    const navUrl = renderer.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || '';
    if (navUrl.includes('/shorts/')) {
      if (logShorts) console.log('[SHORTS] Detected by URL:', videoId);
      return true;
    }

    // Check for reelWatchEndpoint anywhere in the renderer
    const rendererStr = JSON.stringify(renderer);
    if (rendererStr.includes('reelWatchEndpoint') || rendererStr.includes('reelWatch')) {
      if (logShorts) console.log('[SHORTS] Detected by reelWatch:', videoId);
      return true;
    }
  }

  if ((page === 'subscriptions' || String(page).includes('channel')) && debugEnabled && logShorts) {
    console.log('[SHORTS_DIAGNOSTIC] checking', videoId);
  }

  if (item.tileRenderer?.contentType === 'TILE_CONTENT_TYPE_SHORT') return true;

  if (item.videoRenderer) {
    const overlays = item.videoRenderer.thumbnailOverlays || [];
    if (overlays.some((overlay) =>
      overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText === 'SHORTS')) return true;

    const navEndpoint = item.videoRenderer.navigationEndpoint;
    if (navEndpoint?.reelWatchEndpoint) return true;
    const url = navEndpoint?.commandMetadata?.webCommandMetadata?.url || '';
    if (url.includes('/shorts/')) return true;
  }

  if (item.gridVideoRenderer) {
    const overlays = item.gridVideoRenderer.thumbnailOverlays || [];
    if (overlays.some((overlay) =>
      overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText === 'SHORTS')) return true;

    const url = item.gridVideoRenderer.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || '';
    if (url.includes('/shorts/')) return true;
  }

  if (item.compactVideoRenderer) {
    const overlays = item.compactVideoRenderer.thumbnailOverlays || [];
    if (overlays.some((overlay) =>
      overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText === 'SHORTS')) return true;

    const url = item.compactVideoRenderer.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || '';
    if (url.includes('/shorts/')) return true;
  }

  if (item.tileRenderer?.onSelectCommand?.reelWatchEndpoint) return true;

  if (item.tileRenderer?.onSelectCommand) {
    const cmdStr = JSON.stringify(item.tileRenderer.onSelectCommand);
    if (cmdStr.includes('reelWatch') || cmdStr.includes('/shorts/')) return true;
  }

  if (item.tileRenderer?.header?.tileHeaderRenderer?.thumbnailOverlays) {
    const hasShortsBadge = item.tileRenderer.header.tileHeaderRenderer.thumbnailOverlays.some((overlay) =>
      overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.runs?.some((run) => run.text === 'SHORTS')
    );
    if (hasShortsBadge) return true;
  }

  const videoTitle = item.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText || '';
  if (videoTitle.toLowerCase().includes('#shorts') || videoTitle.toLowerCase().includes('#short')) return true;

  if (item.tileRenderer) {
    let lengthText = null;
    const thumbnailOverlays = item.tileRenderer.header?.tileHeaderRenderer?.thumbnailOverlays;
    if (thumbnailOverlays && Array.isArray(thumbnailOverlays)) {
      const timeOverlay = thumbnailOverlays.find((o) => o.thumbnailOverlayTimeStatusRenderer);
      if (timeOverlay) {
        lengthText = timeOverlay.thumbnailOverlayTimeStatusRenderer.text?.simpleText;
      }
    }

    if (!lengthText) {
      lengthText = item.tileRenderer.metadata?.tileMetadataRenderer?.lines?.[0]?.lineRenderer?.items?.find(
        (i) => i.lineItemRenderer?.badge || i.lineItemRenderer?.text?.simpleText
      )?.lineItemRenderer?.text?.simpleText;
    }

    // In isShortItem() - find this section around line 180-195
    if (lengthText) {
      const durationMatch = lengthText.match(/^(\d+):(\d+)$/);
      if (durationMatch) {
        const minutes = parseInt(durationMatch[1], 10);
        const seconds = parseInt(durationMatch[2], 10);
        const totalSeconds = minutes * 60 + seconds;
        
        // ⭐ CONSERVATIVE: Only flag as short if < 90 seconds
        if (totalSeconds <= 90) {
          if (debugEnabled && logShorts) {
            console.log('[SHORTS] Detected by duration (≤ 90s):', videoId, '| Duration:', totalSeconds + 's');
          }
          return true;
        }
        
        // Extended check for 90-180 seconds with shelf memory
        if (totalSeconds <= 180 && window._shortsVideoIdsFromShelves?.has(videoId)) {
          if (debugEnabled && logShorts) {
            console.log('[SHORTS] Detected by duration + shelf memory:', videoId, '| Duration:', totalSeconds + 's');
          }
          return true;
        }
      }
    }
  }

  if (item.richItemRenderer?.content?.reelItemRenderer) return true;

  if (item.tileRenderer?.header?.tileHeaderRenderer?.thumbnail?.thumbnails) {
    const thumb = item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails[0];
    if (thumb && thumb.height > thumb.width) return true;
  }

  if (debugEnabled && logShorts) {
    console.log('[SHORTS_DIAGNOSTIC] not short', videoId);
  }
  return false;
}

export function getShelfTitle(shelf) {
  const titleText = (title) => {
    if (!title) return '';
    if (title.simpleText) return title.simpleText;
    if (Array.isArray(title.runs)) return title.runs.map((run) => run.text).join('');
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
