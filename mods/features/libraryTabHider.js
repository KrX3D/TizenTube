import { configRead } from '../config.js';

const getHiddenLibraryTabIds = () => {
  const configured = configRead('hiddenLibraryTabIds');
  if (!Array.isArray(configured) || configured.length === 0) return new Set();
  return new Set(configured.map((id) => String(id || '').toLowerCase()).filter(Boolean));
};

const hasHiddenBrowseId = (node, hiddenIds, depth = 0) => {
  if (!node || depth > 8) return false;
  if (Array.isArray(node)) {
    return node.some((child) => hasHiddenBrowseId(child, hiddenIds, depth + 1));
  }
  if (typeof node !== 'object') return false;

  const browseId = String(node?.browseEndpoint?.browseId || node?.watchEndpoint?.playlistId || '').toLowerCase();
  if (browseId) {
    for (const hiddenId of hiddenIds) {
      if (browseId === hiddenId || browseId.includes(hiddenId)) return true;
    }
  }

  const contentId = String(node?.tileRenderer?.contentId || '').toLowerCase();
  if (contentId) {
    for (const hiddenId of hiddenIds) {
      if (contentId === hiddenId || contentId.includes(hiddenId)) return true;
    }
  }

  for (const key of Object.keys(node)) {
    if (hasHiddenBrowseId(node[key], hiddenIds, depth + 1)) return true;
  }

  return false;
};

const pruneLibraryTabs = (node, hiddenIds) => {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      if (hasHiddenBrowseId(node[i], hiddenIds)) {
        node.splice(i, 1);
      } else {
        pruneLibraryTabs(node[i], hiddenIds);
      }
    }
    return;
  }

  for (const key of Object.keys(node)) {
    pruneLibraryTabs(node[key], hiddenIds);
  }
};

export const applyLibraryTabHiding = (response) => {
  const hiddenIds = getHiddenLibraryTabIds();
  if (hiddenIds.size === 0) return;

  pruneLibraryTabs(response, hiddenIds);
};
