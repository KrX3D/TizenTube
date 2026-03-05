import { configRead } from '../config.js';
import { PatchSettings } from '../ui/customYTSettings.js';

function detectCurrentPage() {
  const hash = location.hash ? location.hash.substring(1) : '';
  const cParam = (hash.match(/[?&]c=([^&]+)/i)?.[1] || '').toLowerCase();
  return cParam === 'felibrary' ? 'library' : 'other';
}

function normalizeBrowseIdToPage(rawBrowseId = '') {
  const browseId = String(rawBrowseId || '').toLowerCase();
  if (!browseId) return null;
  if (browseId === 'felibrary') return 'library';
  return null;
}

function detectPageFromResponse(response) {
  const serviceParams = response?.responseContext?.serviceTrackingParams || [];
  for (const entry of serviceParams) {
    for (const param of (entry?.params || [])) {
      if (param?.key === 'browse_id') {
        const detected = normalizeBrowseIdToPage(param?.value);
        if (detected) return detected;
      }
    }
  }

  const targetId = String(response?.contents?.tvBrowseRenderer?.targetId || '');
  if (targetId.startsWith('browse-feed')) {
    const detected = normalizeBrowseIdToPage(targetId.replace('browse-feed', ''));
    if (detected) return detected;
  }

  return null;
}

const DEFAULT_HIDDEN_LIBRARY_TAB_IDS = new Set(['femusic_last_played', 'festorefront', 'fecollection_podcasts', 'femy_videos']);

function getConfiguredHiddenLibraryTabIds() {
  const configured = configRead('hiddenLibraryTabIds');
  if (!Array.isArray(configured) || configured.length === 0) return DEFAULT_HIDDEN_LIBRARY_TAB_IDS;
  return new Set(configured.map((id) => String(id || '').toLowerCase()).filter(Boolean));
}

function isHiddenLibraryBrowseId(value) {
  const id = String(value || '').toLowerCase();
  if (!id) return false;

  for (const hiddenId of getConfiguredHiddenLibraryTabIds()) {
    if (id === hiddenId || id.includes(hiddenId)) return true;
  }

  return false;
}

function filterHiddenLibraryTabs(items) {
  if (!Array.isArray(items)) return items;
  return items.filter((item) => {
    const contentId = String(item?.tileRenderer?.contentId || '').toLowerCase();
    return !isHiddenLibraryBrowseId(contentId);
  });
}

function pruneLibraryTabsInResponse(node) {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const child of node) {
      pruneLibraryTabsInResponse(child);
    }
    return;
  }

  if (Array.isArray(node?.horizontalListRenderer?.items)) {
    node.horizontalListRenderer.items = filterHiddenLibraryTabs(node.horizontalListRenderer.items);
  }

  if (Array.isArray(node?.continuationContents?.horizontalListContinuation?.items)) {
    node.continuationContents.horizontalListContinuation.items = filterHiddenLibraryTabs(node.continuationContents.horizontalListContinuation.items);
  }

  for (const key of Object.keys(node)) {
    pruneLibraryTabsInResponse(node[key]);
  }
}

const originalParse = JSON.parse;
JSON.parse = function () {
  const response = originalParse.apply(this, arguments);

  try {
    const detectedPage = detectPageFromResponse(response) || detectCurrentPage();
    if (detectedPage === 'library') {
      pruneLibraryTabsInResponse(response);
    }

    if (response?.title?.runs) {
      PatchSettings(response);
    }
  } catch (_) {
    // Keep response unchanged if parsing hook hits an edge-case.
  }

  return response;
};

window.JSON.parse = JSON.parse;
for (const key in window._yttv) {
  if (window._yttv[key] && window._yttv[key].JSON && window._yttv[key].JSON.parse) {
    window._yttv[key].JSON.parse = JSON.parse;
  }
}
