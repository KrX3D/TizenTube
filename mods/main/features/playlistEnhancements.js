import resolveCommand from '../../resolveCommand.js';
import { getVideoId } from './shortsCore.js';
import { detectCurrentPage } from '../pageDetection.js';
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

  const metrics = window?._ttConsoleMetrics || null;
  const charsPerLine = Math.max(24, Number(metrics?.charsPerLine) || 0);
  const effectiveLinesPerChunk = Math.max(1, Number(metrics?.visibleLines) ? (metrics.visibleLines - 2) : linesPerChunk);

  const rawLines = String(text).split('\n');
  const lines = [];

  for (const line of rawLines) {
    if (!charsPerLine || line.length <= charsPerLine) {
      lines.push(line);
      continue;
    }
    for (let i = 0; i < line.length; i += charsPerLine) {
      lines.push(line.slice(i, i + charsPerLine));
    }
  }

  const total = Math.max(1, Math.ceil(lines.length / effectiveLinesPerChunk));
  for (let partIndex = total; partIndex >= 1; partIndex--) {
    const startLine = (partIndex - 1) * effectiveLinesPerChunk;
    const part = lines.slice(startLine, startLine + effectiveLinesPerChunk).join('\n');
    console.log(`${prefix} [${partIndex}/${total}] lines=${Math.min(effectiveLinesPerChunk, lines.length - startLine)} ${part}`);
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
    debugEnabled: false,
    resolveCommand,
    logChunkedByLines
  });
}

function cleanupPlaylistHelperTiles() {
  return cleanupPlaylistHelperTilesFeature({
    getCurrentPage,
    getVideoId,
    debugEnabled: false,
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

  detectPlaylistButtons();

  if (!window._ttPlaylistButtonObserver) {
    window._ttPlaylistButtonObserver = new MutationObserver(() => {
      const page = getCurrentPage();
      if (page !== 'playlist') return;
      const hasCustom = !!document.querySelector('[data-tizentube-collection-btn="1"]');
      if (!hasCustom) {
        addPlaylistControlButtons(7);
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

  initPlaylistButtonMaintenance({
    getCurrentPage,
    addPlaylistControlButtons,
    cleanupPlaylistHelperTiles
  });
}

initPlaylistEnhancements();


export function startPlaylistAutoLoad() {
  const page = getCurrentPage();
  if (page !== 'playlist') return;

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
      }
    } else {
      stableCount = 0;
      lastVideoCount = currentCount;
    }
  }, 500);
}
