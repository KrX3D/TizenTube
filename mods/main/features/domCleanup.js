import { detectCurrentPage } from '../pageDetection.js';

function removePlaylistHelpersFromDOM() {
  const nodes = document.querySelectorAll(
    'ytlr-continuation-item-renderer, [class*="continuation"], [class*="load-more"], [class*="loadmore"]'
  );
  nodes.forEach((node) => node.remove());
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
  }

  if (page === 'subscriptions' || page === 'subscription' || page === 'channel' || page === 'channels') {
    removeEmptySubscriptionPlaceholders();
  }
}

export function startDomCleanupLoop() {
  if (typeof window === 'undefined') return;
  if (window._ttDomCleanupInterval) return;

  const run = () => runDomCleanupPass();
  run();
  window._ttDomCleanupInterval = setInterval(run, 1200);
  window.addEventListener('hashchange', run);
}
