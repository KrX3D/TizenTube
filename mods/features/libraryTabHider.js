import { configRead } from '../config.js';

const getHiddenLibraryTabIds = () => {
  const configured = configRead('hiddenLibraryTabIds');
  if (!Array.isArray(configured) || configured.length === 0) return new Set();
  return new Set(configured.map((id) => String(id || '').toLowerCase()).filter(Boolean));
};

const matchesHiddenId = (value, hiddenIds) => {
  const id = String(value || '').toLowerCase();
  if (!id) return false;

  for (const hiddenId of hiddenIds) {
    if (id === hiddenId || id.includes(hiddenId)) return true;
  }

  return false;
};

const extractItemIdsDeep = (node, out = new Set(), depth = 0) => {
  if (!node || depth > 8) return out;
  if (Array.isArray(node)) {
    for (const child of node) extractItemIdsDeep(child, out, depth + 1);
    return out;
  }
  if (typeof node !== 'object') return out;

  const browseId = node?.browseEndpoint?.browseId;
  if (typeof browseId === 'string' && browseId) out.add(browseId);

  const contentId = node?.tileRenderer?.contentId;
  if (typeof contentId === 'string' && contentId) out.add(contentId);

  const playlistId = node?.watchEndpoint?.playlistId;
  if (typeof playlistId === 'string' && playlistId) out.add(playlistId);

  for (const key of Object.keys(node)) extractItemIdsDeep(node[key], out, depth + 1);
  return out;
};

const shouldHideTabItem = (item, hiddenIds) => {
  if (!item || typeof item !== 'object') return false;

  const ids = extractItemIdsDeep(item);
  for (const id of ids) {
    if (matchesHiddenId(id, hiddenIds)) return true;
  }

  return false;
};

const filterTabArray = (items, hiddenIds) => {
  if (!Array.isArray(items)) return items;
  return items.filter((item) => !shouldHideTabItem(item, hiddenIds));
};

const pruneLibraryTabs = (node, hiddenIds) => {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node?.horizontalListRenderer?.items)) {
    node.horizontalListRenderer.items = filterTabArray(node.horizontalListRenderer.items, hiddenIds);
  }

  if (Array.isArray(node?.continuationContents?.horizontalListContinuation?.items)) {
    node.continuationContents.horizontalListContinuation.items =
      filterTabArray(node.continuationContents.horizontalListContinuation.items, hiddenIds);
  }

  if (Array.isArray(node?.tvSecondaryNavSectionRenderer?.tabs)) {
    node.tvSecondaryNavSectionRenderer.tabs = filterTabArray(node.tvSecondaryNavSectionRenderer.tabs, hiddenIds);
  }

  for (const key of Object.keys(node)) {
    const value = node[key];
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (entry && typeof entry === 'object') pruneLibraryTabs(entry, hiddenIds);
        }
      } else {
        pruneLibraryTabs(value, hiddenIds);
      }
    }
  }
};

export const applyLibraryTabHiding = (response) => {
  const hiddenIds = getHiddenLibraryTabIds();
  if (hiddenIds.size === 0) return;

  pruneLibraryTabs(response, hiddenIds);
};
