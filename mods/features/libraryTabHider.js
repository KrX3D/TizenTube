import { configRead } from '../config.js';

const getHiddenLibraryTabIds = () => {
  const configured = configRead('hiddenLibraryTabIds');
  if (!Array.isArray(configured) || configured.length === 0) return new Set();
  return new Set(configured.map((id) => String(id || '').toLowerCase()).filter(Boolean));
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

export const applyLibraryTabHiding = (response) => {
  const hiddenIds = getHiddenLibraryTabIds();
  if (hiddenIds.size === 0) return;
  if (!isLibraryResponse(response)) return;

  pruneLibraryTabs(response, hiddenIds);
};
