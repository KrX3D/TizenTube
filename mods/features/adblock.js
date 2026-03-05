import { configRead } from '../config.js';
import { PatchSettings } from '../ui/customYTSettings.js';

const DEFAULT_HIDDEN_LIBRARY_TAB_IDS = ['femusic_last_played', 'festorefront', 'fecollection_podcasts', 'femy_videos'];

const getHiddenLibraryTabIds = () => {
  const configured = configRead('hiddenLibraryTabIds');
  const source = Array.isArray(configured) && configured.length ? configured : DEFAULT_HIDDEN_LIBRARY_TAB_IDS;
  return new Set(source.map((id) => String(id || '').toLowerCase()).filter(Boolean));
};

const isLibraryResponse = (response) => {
  const hash = (location.hash || '').toLowerCase();
  if (/[?&]c=felibrary\b/.test(hash)) return true;

  for (const entry of (response?.responseContext?.serviceTrackingParams || [])) {
    for (const param of (entry?.params || [])) {
      if (param?.key === 'browse_id' && String(param?.value || '').toLowerCase() === 'felibrary') {
        return true;
      }
    }
  }

  const targetId = String(response?.contents?.tvBrowseRenderer?.targetId || '').toLowerCase();
  return targetId === 'browse-feedfelibrary';
};

const filterLibraryTabs = (items, hiddenIds) => {
  if (!Array.isArray(items)) return items;
  return items.filter((item) => {
    const id = String(item?.tileRenderer?.contentId || '').toLowerCase();
    if (!id) return true;
    for (const hiddenId of hiddenIds) {
      if (id === hiddenId || id.includes(hiddenId)) return false;
    }
    return true;
  });
};

const pruneLibraryTabs = (node, hiddenIds) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) pruneLibraryTabs(child, hiddenIds);
    return;
  }

  if (Array.isArray(node?.horizontalListRenderer?.items)) {
    node.horizontalListRenderer.items = filterLibraryTabs(node.horizontalListRenderer.items, hiddenIds);
  }
  if (Array.isArray(node?.continuationContents?.horizontalListContinuation?.items)) {
    node.continuationContents.horizontalListContinuation.items = filterLibraryTabs(node.continuationContents.horizontalListContinuation.items, hiddenIds);
  }

  for (const key of Object.keys(node)) pruneLibraryTabs(node[key], hiddenIds);
};

const originalParse = JSON.parse;
JSON.parse = function () {
  const response = originalParse.apply(this, arguments);

  try {
    if (isLibraryResponse(response)) {
      pruneLibraryTabs(response, getHiddenLibraryTabIds());
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
