import { detectCurrentPage } from '../pageDetection.js';

function removePlaylistHelpersFromDOM() {
  const nodes = document.querySelectorAll(
    'ytlr-continuation-item-renderer, [class*="continuation"], [class*="load-more"], [class*="loadmore"], [aria-label*="more" i], [aria-label*="continuation" i]'
  );

  nodes.forEach((node) => {
    const text = String(node.textContent || '').toLowerCase();
    const html = String(node.innerHTML || '').toLowerCase();
    const looksLikeHelper = /scroll|weiter|more|continuation|fortsetzen|load more|mehr anzeigen|laden/.test(text)
      || /continuation|loadmore/.test(html);
    if (looksLikeHelper || node.tagName.toLowerCase() === 'ytlr-continuation-item-renderer') {
      node.remove();
    }
  });
}

function removeWatchedByRemovedTitleState() {
  const removedTitles = (window._ttRemovedWatchedTitles || [])
    .map((t) => String(t).trim().toLowerCase())
    .filter((t) => t.length >= 6);
  if (!removedTitles.length) return;

  const cards = document.querySelectorAll('ytlr-grid-video-renderer, ytlr-rich-item-renderer, [data-video-id], ytlr-item-section-renderer ytlr-grid-video-renderer');
  cards.forEach((node) => {
    const text = (node.textContent || '').toLowerCase();
    if (!text) return;
    for (const title of removedTitles) {
      if (text.includes(title)) {
        node.remove();
        break;
      }
    }
  });
}

function removeWatchedCardsByProgressBar() {
  // Read threshold from window var set during JSON filtering
  const threshold = typeof window._ttWatchedThreshold === 'number'
    ? window._ttWatchedThreshold
    : 10;

  const progressNodes = document.querySelectorAll(
    '[style*="--ytlr-watch-progress"], [class*="resume" i], [class*="progress" i]'
  );
  progressNodes.forEach((progress) => {
    const card = progress.closest(
      'ytlr-grid-video-renderer, ytlr-rich-item-renderer, ytlr-compact-video-renderer, [data-video-id]'
    );
    if (!card) return;

    const style = String(progress.getAttribute('style') || '').toLowerCase();
    const aria  = String(progress.getAttribute('aria-label') || '').toLowerCase();

    // Check CSS variable (value is 0.0–1.0 float)
    const cssMatch = style.match(/--ytlr-watch-progress:\s*([\d.]+)/);
    const cssPercent = cssMatch ? parseFloat(cssMatch[1]) * 100 : 0;

    const isWatched =
      cssPercent >= threshold ||
      /100%|watched|gesehen/.test(style) ||
      /watched|gesehen/.test(aria);

    if (isWatched) card.remove();
  });
}

function removeEmptySubscriptionPlaceholders() {
  const cards = document.querySelectorAll('ytlr-grid-video-renderer, ytlr-rich-item-renderer');
  cards.forEach((node) => {
    const text = (node.textContent || '').trim();
    const hasThumb = !!node.querySelector('img, [style*="background-image"], [class*="thumbnail"], [class*="poster"]');
    const hasLink = !!node.querySelector('a[href*="watch"], [data-video-id], [video-id]');
    const isSkeleton = !!node.querySelector('[class*="skeleton"], [class*="placeholder"], [class*="shimmer"]');

    if (!hasLink && (!text || isSkeleton) && !hasThumb) {
      node.remove();
    }
  });
}

export function runDomCleanupPass() {
  if (typeof document === 'undefined') return;
  const page = detectCurrentPage();

  if (page === 'playlist' || page === 'playlists' || location.hash.includes('list=')) {
    removePlaylistHelpersFromDOM();
  }

  if (page === 'watch') {
    removeWatchedByRemovedTitleState();
    removeWatchedCardsByProgressBar();
  }

  // ← ADD: channel pages need the same treatment
  if (page === 'channel' || page === 'channels') {
    removeWatchedByRemovedTitleState();
    removeWatchedCardsByProgressBar();
  }

  if (page === 'subscriptions' || page === 'subscription' || page === 'channel' || page === 'channels') {
    removeWatchedByRemovedTitleState();
    removeWatchedCardsByProgressBar();
    removeEmptySubscriptionPlaceholders();
  }
}

let _playlistHelperObserver = null;

function startPlaylistHelperObserver() {
  if (_playlistHelperObserver) return;
  _playlistHelperObserver = new MutationObserver(() => {
    const page = detectCurrentPage();
    if (page !== 'playlist' && page !== 'playlists') return;
    const removedIds = window._playlistRemovedHelpers;
    if (!removedIds || removedIds.size === 0) return;

    document.querySelectorAll(
      '[data-video-id]:not([data-tt-helper-hidden]), ytlr-grid-video-renderer:not([data-tt-helper-hidden])'
    ).forEach((node) => {
      const id =
        node.getAttribute('data-video-id') ||
        node.querySelector('[data-video-id]')?.getAttribute('data-video-id');
      if (id && removedIds.has(id)) {
        node.style.display = 'none';
        node.setAttribute('data-tt-helper-hidden', '1');
      }
    });
  });

  const target = document.querySelector('yt-virtual-list') || document.body;
  _playlistHelperObserver.observe(target, { childList: true, subtree: true });
}

export function startDomCleanupLoop() {
  if (typeof window === 'undefined') return;
  if (window._ttDomCleanupInterval) return;

  const run = () => runDomCleanupPass();
  run();
  window._ttDomCleanupInterval = setInterval(run, 400);
  window.addEventListener('hashchange', () => {
    run();
    // Reset observer when page changes so it re-attaches to correct container
    if (_playlistHelperObserver) {
      _playlistHelperObserver.disconnect();
      _playlistHelperObserver = null;
    }
    if (detectCurrentPage() === 'playlist') startPlaylistHelperObserver();
  });
  startPlaylistHelperObserver();
  startWatchPageWatchedObserver();
}

let _watchWatchedObserver = null;

function checkAndRemoveIfWatched(node) {
  if (!node || node.nodeType !== 1) return;
  const threshold = typeof window._ttWatchedThreshold === 'number'
    ? window._ttWatchedThreshold
    : 10;

  const progress = node.querySelector
    ? node.querySelector('[style*="--ytlr-watch-progress"], [class*="resume" i]')
    : null;
  if (!progress) return;

  const style = progress.getAttribute('style') || '';
  const cssMatch = style.match(/--ytlr-watch-progress:\s*([\d.]+)/);
  const percent = cssMatch ? parseFloat(cssMatch[1]) * 100 : 0;
  const isWatched = percent >= threshold || /100%|watched/.test(style.toLowerCase());

  if (isWatched) {
    const card = node.closest(
      'ytlr-grid-video-renderer, ytlr-rich-item-renderer, ytlr-compact-video-renderer, [data-video-id]'
    ) || node;
    card.style.display = 'none';
  }
}

function startWatchPageWatchedObserver() {
  if (_watchWatchedObserver) return;
  _watchWatchedObserver = new MutationObserver((mutations) => {
    if (detectCurrentPage() !== 'watch') return;
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (added.nodeType !== 1) continue;
        checkAndRemoveIfWatched(added);
        if (added.querySelectorAll) {
          added.querySelectorAll(
            'ytlr-grid-video-renderer, ytlr-rich-item-renderer, ytlr-compact-video-renderer'
          ).forEach(checkAndRemoveIfWatched);
        }
      }
    }
  });
  _watchWatchedObserver.observe(document.body, { childList: true, subtree: true });
}