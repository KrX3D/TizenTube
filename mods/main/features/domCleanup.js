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
    .filter((t) => t.length >= 12);  // increased from 6 to avoid false positives
  if (!removedTitles.length) return;

  const cards = document.querySelectorAll(
    'ytlr-grid-video-renderer, ytlr-rich-item-renderer, ytlr-item-section-renderer ytlr-grid-video-renderer'
  );
  cards.forEach((node) => {
    const text = (node.textContent || '').toLowerCase();
    if (!text || text.length < 12) return;
    for (const title of removedTitles) {
      if (text.includes(title)) {
        node.remove();
        break;
      }
    }
  });
}

function removeWatchedCardsByVideoId() {
  const removedIds = window._ttRemovedWatchedVideoIds;
  if (!removedIds || removedIds.size === 0) return;

  document.querySelectorAll(
    'ytlr-grid-video-renderer, ytlr-rich-item-renderer, ytlr-compact-video-renderer'
  ).forEach((node) => {
    const id = node.getAttribute('data-video-id')
      || node.getAttribute('video-id')
      || node.querySelector('[data-video-id]')?.getAttribute('data-video-id');
    if (id && removedIds.has(id)) {
      node.remove();
    }
  });
}

function removeWatchedCardsByProgressBar() {
  const threshold = typeof window._ttWatchedThreshold === 'number'
    ? window._ttWatchedThreshold
    : 10;

  const progressNodes = document.querySelectorAll(
    '[style*="--ytlr-watch-progress"], [class*="resume" i]'
  );
  progressNodes.forEach((progress) => {
    const card = progress.closest(
      'ytlr-grid-video-renderer, ytlr-rich-item-renderer, ytlr-compact-video-renderer'
    );
    if (!card) return;

    const style = String(progress.getAttribute('style') || '').toLowerCase();
    const aria = String(progress.getAttribute('aria-label') || '').toLowerCase();

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
    removeWatchedCardsByVideoId();
    removeWatchedCardsByProgressBar();
  }

  if (page === 'channel' || page === 'channels') {
    removeWatchedByRemovedTitleState();
    removeWatchedCardsByVideoId();
    removeWatchedCardsByProgressBar();
  }

  if (page === 'subscriptions' || page === 'subscription' || page === 'channel' || page === 'channels') {
    removeWatchedByRemovedTitleState();
    removeWatchedCardsByVideoId();
    removeWatchedCardsByProgressBar();
    removeEmptySubscriptionPlaceholders();
  }
}

// --- Playlist helper observer ---

let _playlistHelperObserver = null;

function startPlaylistHelperObserver() {
  if (_playlistHelperObserver) return;
  _playlistHelperObserver = new MutationObserver(() => {
    const page = detectCurrentPage();
    if (page !== 'playlist' && page !== 'playlists') return;
    const removedIds = window._playlistRemovedHelpers;
    if (!removedIds || removedIds.size === 0) return;

    document.querySelectorAll(
      'ytlr-grid-video-renderer, ytlr-rich-item-renderer, [data-video-id]'
    ).forEach((node) => {
      if (node.getAttribute('data-tt-helper-hidden')) return;
      const id = node.getAttribute('data-video-id')
        || node.getAttribute('video-id')
        || node.querySelector('[data-video-id]')?.getAttribute('data-video-id');
      if (id && removedIds.has(id)) {
        node.setAttribute('data-tt-helper-hidden', '1');
        // Use visibility:hidden to preserve layout slot (prevents black gap)
        // while still being invisible. Remove after a tick.
        node.style.visibility = 'hidden';
        node.style.pointerEvents = 'none';
        setTimeout(() => { try { node.remove(); } catch(_) {} }, 800);
      }
    });
  });

  const target = document.querySelector('yt-virtual-list') || document.body;
  _playlistHelperObserver.observe(target, { childList: true, subtree: true });
}

// --- Watch page watched-video observer ---

let _watchWatchedObserver = null;

function checkAndRemoveIfWatched(node) {
  if (!node || node.nodeType !== 1) return;
  const threshold = typeof window._ttWatchedThreshold === 'number'
    ? window._ttWatchedThreshold
    : 10;

  // Method 1: match by tracked video ID (most reliable, set by hardPruneWatchedDeep)
  const id = node.getAttribute('data-video-id')
    || node.querySelector?.('[data-video-id]')?.getAttribute('data-video-id');
  if (id && window._ttRemovedWatchedVideoIds?.has(id)) {
    node.style.display = 'none';
    return;
  }

  // Method 2: match by title text (set by directFilterArray and hardPruneWatchedDeep)
  const removedTitles = (window._ttRemovedWatchedTitles || [])
    .map((t) => String(t).trim().toLowerCase())
    .filter((t) => t.length >= 6);
  if (removedTitles.length > 0) {
    const text = (node.textContent || '').toLowerCase();
    if (text) {
      for (const title of removedTitles) {
        if (text.includes(title)) {
          node.style.display = 'none';
          return;
        }
      }
    }
  }

  // Method 3: check for CSS progress variable (may not be present yet on first insert)
  const progress = node.querySelector?.('[style*="--ytlr-watch-progress"], [class*="resume" i]');
  if (progress) {
    const style = progress.getAttribute('style') || '';
    const cssMatch = style.match(/--ytlr-watch-progress:\s*([\d.]+)/);
    const percent = cssMatch ? parseFloat(cssMatch[1]) * 100 : 0;
    const isWatched = percent >= threshold || /100%|watched/.test(style.toLowerCase());
    if (isWatched) {
      const card = node.closest(
        'ytlr-grid-video-renderer, ytlr-rich-item-renderer, ytlr-compact-video-renderer, [data-video-id]'
      ) || node;
      card.style.display = 'none';
      return;
    }
  }

  // Method 4: schedule a delayed re-check for when CSS variables are applied asynchronously
  setTimeout(() => {
    if (node.style.display === 'none') return; // already hidden
    const p = node.querySelector?.('[style*="--ytlr-watch-progress"]');
    if (!p) return;
    const style = p.getAttribute('style') || '';
    const cssMatch = style.match(/--ytlr-watch-progress:\s*([\d.]+)/);
    const percent = cssMatch ? parseFloat(cssMatch[1]) * 100 : 0;
    if (percent >= threshold) {
      const card = node.closest(
        'ytlr-grid-video-renderer, ytlr-rich-item-renderer, ytlr-compact-video-renderer, [data-video-id]'
      ) || node;
      card.style.display = 'none';
    }
  }, 300);
}

function startWatchPageWatchedObserver() {
  if (_watchWatchedObserver) return;
  _watchWatchedObserver = new MutationObserver((mutations) => {
    const page = detectCurrentPage();
    // Run on watch, channel, and subscriptions pages
    if (page !== 'watch' && page !== 'channel' && page !== 'channels'
        && page !== 'subscriptions' && page !== 'subscription') return;

    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (added.nodeType !== 1) continue;

        // Check the node itself if it's a video card
        const tagName = added.tagName?.toLowerCase() || '';
        if (tagName === 'ytlr-grid-video-renderer'
            || tagName === 'ytlr-rich-item-renderer'
            || tagName === 'ytlr-compact-video-renderer'
            || added.hasAttribute?.('data-video-id')) {
          checkAndRemoveIfWatched(added);
        }

        // Check descendants
        if (added.querySelectorAll) {
          added.querySelectorAll(
            'ytlr-grid-video-renderer, ytlr-rich-item-renderer, ytlr-compact-video-renderer, [data-video-id]'
          ).forEach(checkAndRemoveIfWatched);
        }
      }
    }
  });
  _watchWatchedObserver.observe(document.body, { childList: true, subtree: true });
}

export function startDomCleanupLoop() {
  if (typeof window === 'undefined') return;
  if (window._ttDomCleanupInterval) return;

  const run = () => runDomCleanupPass();
  run();
  window._ttDomCleanupInterval = setInterval(run, 400);

  window.addEventListener('hashchange', () => {
    run();
    if (_playlistHelperObserver) {
      _playlistHelperObserver.disconnect();
      _playlistHelperObserver = null;
    }
    if (detectCurrentPage() === 'playlist' || detectCurrentPage() === 'playlists') {
      startPlaylistHelperObserver();
    }
  });

  startPlaylistHelperObserver();
  startWatchPageWatchedObserver();
}

// Auto-start when this module is imported
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startDomCleanupLoop, { once: true });
  } else {
    startDomCleanupLoop();
  }
}