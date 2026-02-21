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
  const progressNodes = document.querySelectorAll('[style*="--ytlr-watch-progress"], [class*="resume" i], [class*="progress" i]');
  progressNodes.forEach((progress) => {
    const card = progress.closest('ytlr-grid-video-renderer, ytlr-rich-item-renderer, ytlr-compact-video-renderer, [data-video-id]');
    if (!card) return;

    const style = String(progress.getAttribute('style') || '').toLowerCase();
    const aria = String(progress.getAttribute('aria-label') || '').toLowerCase();
    const isWatched = /100%|watched|gesehen/.test(style) || /watched|gesehen/.test(aria);
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

  if (page === 'subscriptions' || page === 'subscription' || page === 'channel' || page === 'channels') {
    removeWatchedByRemovedTitleState();
    removeWatchedCardsByProgressBar();
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
