export function initShortsTrackingState() {
  window._shortsVideoIdsFromShelves = window._shortsVideoIdsFromShelves || new Set();
  window._shortsTitlesFromShelves = window._shortsTitlesFromShelves || new Set();
}

export function shouldFilterShorts(shortsEnabled, page) {
  return !shortsEnabled && page !== 'playlist' && page !== 'playlists';
}

export function isShortsShelfTitle(title = '') {
  const t = String(title).trim().toLowerCase();
  // Keep this strict to avoid false positives such as
  // "short film", "short tutorial", etc.
  if (!t) return false;
  if (t === 'shorts' || t === '#shorts') return true;
  return /^shorts\b/.test(t) || /\bshorts$/.test(t);
}

export function rememberShortsFromShelf(shelf, collectVideoIdsFromShelf, getVideoTitle) {
  initShortsTrackingState();
  const ids = collectVideoIdsFromShelf(shelf);
  ids.forEach((id) => window._shortsVideoIdsFromShelves.add(id));

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
    if (debugEnabled || logShorts) {
      console.log('[SHORTS_SHELF] removed title=', title, '| ids=', ids.length, '| page=', page, '| path=', path || i);
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

    if (lengthText) {
      const durationMatch = lengthText.match(/^(\d+):(\d+)$/);
      if (durationMatch) {
        const minutes = parseInt(durationMatch[1], 10);
        const seconds = parseInt(durationMatch[2], 10);
        const totalSeconds = minutes * 60 + seconds;
        if (totalSeconds <= 90) return true;
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



export function filterShelvesShorts(shelves, { page = 'other', shortsEnabled, onRemoveShelf } = {}) {
  if (!Array.isArray(shelves)) return;
  if (!shouldFilterShorts(shortsEnabled, page)) return;

  for (let i = shelves.length - 1; i >= 0; i--) {
    const shelf = shelves[i];
    if (!shelf) {
      shelves.splice(i, 1);
      continue;
    }

    if (!shelf.shelfRenderer?.content?.horizontalListRenderer?.items) continue;

    if (shelf.shelfRenderer.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS') {
      onRemoveShelf?.(shelf);
      shelves.splice(i, 1);
      continue;
    }

    const items = shelf.shelfRenderer.content.horizontalListRenderer.items || [];
    shelf.shelfRenderer.content.horizontalListRenderer.items = items.filter(
      (item) => !isShortItem(item, { currentPage: page })
    );

    if (shelf.shelfRenderer.content.horizontalListRenderer.items.length === 0) {
      onRemoveShelf?.(shelf);
      shelves.splice(i, 1);
    }
  }
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
