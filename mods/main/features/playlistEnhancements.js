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
