import resolveCommand from '../../resolveCommand.js';
import { getVideoId } from './shortsCore.js';
import { detectCurrentPage } from '../pageDetection.js';
import { getGlobalDebugEnabled } from './visualConsole.js';
import { configRead } from '../../config.js';
import {
  addPlaylistControlButtons as addPlaylistControlButtonsFeature,
  detectPlaylistButtons as detectPlaylistButtonsFeature,
  initPlaylistButtonMaintenance
} from './playlistButtonInsertion.js';
import { cleanupPlaylistHelperTiles as cleanupPlaylistHelperTilesFeature } from './playlistCleanup.js';

export function getCurrentPage() {
  return detectCurrentPage();
}

export function logChunkedByLines(prefix, text, linesPerChunk = 60) {
  if (!text) return;
  const lines = String(text).split('\n');
  const total = Math.max(1, Math.ceil(lines.length / linesPerChunk));

  for (let partIndex = total; partIndex >= 1; partIndex--) {
    const startLine = (partIndex - 1) * linesPerChunk;
    const part = lines.slice(startLine, startLine + linesPerChunk).join('\n');
    console.log(`${prefix} [${partIndex}/${total}] lines=${Math.min(linesPerChunk, lines.length - startLine)} ${part}`);
  }
}

export function triggerPlaylistContinuationLoad() {
  const page = getCurrentPage();
  if (page !== 'playlist') return;

  const candidates = [
    document.querySelector('yt-virtual-list'),
    document.querySelector('[class*="virtual-list"]'),
    document.querySelector('ytlr-playlist-video-list-renderer'),
    document.scrollingElement,
  ].filter(Boolean);

  for (const node of candidates) {
    try {
      const before = node.scrollTop || 0;
      node.scrollTop = Math.max(node.scrollTop || 0, node.scrollHeight || 0);
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
      if ((node.scrollTop || 0) !== before) {
        break;
      }
    } catch (_) {}
  }

  try {
    window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
  } catch (_) {}
}

function addPlaylistControlButtons(attempt = 1) {
  return addPlaylistControlButtonsFeature(attempt, {
    getCurrentPage,
    debugEnabled: getGlobalDebugEnabled(configRead),
    resolveCommand,
    logChunkedByLines
  });
}

function cleanupPlaylistHelperTiles() {
  return cleanupPlaylistHelperTilesFeature({
    getCurrentPage,
    getVideoId,
    debugEnabled: getGlobalDebugEnabled(configRead),
    triggerPlaylistContinuationLoad
  });
}

function detectPlaylistButtons() {
  return detectPlaylistButtonsFeature({
    getCurrentPage,
    addPlaylistControlButtons
  });
}

export function initPlaylistEnhancements() {
  if (typeof window === 'undefined') return;
  if (window._ttPlaylistEnhancementsInitialized) return;
  window._ttPlaylistEnhancementsInitialized = true;

  // TEMP: disabled for isolation while debugging filtering regressions.
  // detectPlaylistButtons();

  if (!window._ttPlaylistButtonObserver) {
    window._ttPlaylistButtonObserver = new MutationObserver(() => {
      const page = getCurrentPage();
      if (page !== 'playlist') return;
      const hasCustom = !!document.querySelector('[data-tizentube-collection-btn="1"]');
      if (!hasCustom) {
        // TEMP: disabled for isolation while debugging filtering regressions.
        // addPlaylistControlButtons(7);
      }
    });

    const observe = () => {
      const target = document.querySelector('yt-virtual-list') || document.body;
      if (!target) return;
      try {
        window._ttPlaylistButtonObserver.observe(target, { childList: true, subtree: true });
      } catch (_) {}
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', observe, { once: true });
    } else {
      observe();
    }
  }

  // TEMP: disabled for isolation while debugging filtering regressions.
  // initPlaylistButtonMaintenance({
  //   getCurrentPage,
  //   addPlaylistControlButtons,
  //   cleanupPlaylistHelperTiles
  // });
}

initPlaylistEnhancements();


export function startPlaylistAutoLoad() {
  const page = getCurrentPage();
  if (page !== 'playlist') return;

  window._skipUniversalFilter = true;

  let stableCount = 0;
  let lastVideoCount = 0;
  const interval = setInterval(() => {
    const cards = document.querySelectorAll('ytlr-grid-video-renderer, ytlr-rich-item-renderer');
    const currentCount = cards.length;

    try {
      window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
    } catch (_) {}

    if (currentCount === lastVideoCount) {
      stableCount += 1;
      if (stableCount >= 8) {
        clearInterval(interval);
        window._skipUniversalFilter = false;
      }
    } else {
      stableCount = 0;
      lastVideoCount = currentCount;
    }
  }, 500);

  setTimeout(() => {
    if (window._skipUniversalFilter) {
      window._skipUniversalFilter = false;
    }
  }, 25000);
}
