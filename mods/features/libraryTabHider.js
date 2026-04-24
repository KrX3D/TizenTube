import { detectCurrentPage } from './hideWatched.js';

const getHiddenLibraryTabIds = (configured) => {
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

const shouldHideTabItem = (item, hiddenIds) => {
  if (!item || typeof item !== 'object') return false;
  return matchesHiddenId(item?.tileRenderer?.contentId, hiddenIds)
    || matchesHiddenId(item?.tabRenderer?.content?.tvSurfaceContentRenderer?.content?.gridRenderer?.items?.[0]?.tileRenderer?.contentId, hiddenIds)
    || matchesHiddenId(item?.tabRenderer?.endpoint?.browseEndpoint?.browseId, hiddenIds)
    || matchesHiddenId(item?.navigationEndpoint?.browseEndpoint?.browseId, hiddenIds)
    || matchesHiddenId(item?.browseEndpoint?.browseId, hiddenIds);
};

const pruneLibraryTabs = (node, hiddenIds) => {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node?.horizontalListRenderer?.items)) {
    node.horizontalListRenderer.items = node.horizontalListRenderer.items.filter((item) => !shouldHideTabItem(item, hiddenIds));
  }

  if (Array.isArray(node?.continuationContents?.horizontalListContinuation?.items)) {
    node.continuationContents.horizontalListContinuation.items =
      node.continuationContents.horizontalListContinuation.items.filter((item) => !shouldHideTabItem(item, hiddenIds));
  }

  if (Array.isArray(node?.tvSecondaryNavSectionRenderer?.tabs)) {
    node.tvSecondaryNavSectionRenderer.tabs = node.tvSecondaryNavSectionRenderer.tabs.filter((tab) => !shouldHideTabItem(tab, hiddenIds));
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

function updateLibraryTabsClass() {
  const navEl = document.querySelector('ytlr-tv-secondary-nav-section-renderer');
  const hasTabs = !!(navEl && (navEl.querySelector('ytlr-tab-renderer') || navEl.querySelector('[role="tab"]')));
  document.body?.classList.toggle('tt-no-library-tabs', !hasTabs);
}

const SHELF_GAP_REM = 0;
let _libraryGeneration = 0;
let _libraryObserver = null;

function applyShelfSpacing() {
  const nuDen = document.querySelector('ytlr-section-list-renderer > yt-virtual-list > div');
  if (!nuDen) return;
  const wrappers = Array.from(nuDen.children)
    .filter(el => el.style?.transform?.includes('translateY') && el.childElementCount > 0)
    .sort((a, b) => {
      const yA = parseFloat(a.style.transform.match(/translateY\(([^r]+)rem\)/)?.[1]) || 0;
      const yB = parseFloat(b.style.transform.match(/translateY\(([^r]+)rem\)/)?.[1]) || 0;
      return yA - yB;
    });
  if (!wrappers.length) return;
  let cursor = 0;
  for (const wrapper of wrappers) {
    const h = parseFloat(wrapper.style.height);
    if (isNaN(h)) continue;
    const desired = `translateY(${cursor}rem)`;
    if (!wrapper.style.transform.includes(desired))
      wrapper.style.transform = wrapper.style.transform.replace(/translateY\([^)]+\)/, desired);
    cursor += h + SHELF_GAP_REM;
  }
}

function startShelfSpacingObserver(retriesLeft = 15, generation, lastPositions) {
  if (generation === undefined) {
    generation = ++_libraryGeneration;
    if (_libraryObserver) { _libraryObserver.disconnect(); _libraryObserver = null; }
  } else if (generation !== _libraryGeneration) {
    return;
  }
  const nuDen = document.querySelector('ytlr-section-list-renderer > yt-virtual-list > div');
  const wrappers = nuDen
    ? Array.from(nuDen.children).filter(el => el.style?.transform?.includes('translateY') && el.childElementCount > 0)
    : [];
  if (!wrappers.length) {
    if (retriesLeft > 0) setTimeout(() => startShelfSpacingObserver(retriesLeft - 1, generation, undefined), 100);
    return;
  }
  // Wait for positions to stabilize before applying to avoid locking in intermediate order.
  const currentPositions = wrappers.map(el => el.style.transform).join('|');
  if (currentPositions !== lastPositions) {
    if (retriesLeft > 0) setTimeout(() => startShelfSpacingObserver(retriesLeft - 1, generation, currentPositions), 100);
    return;
  }
  document.body?.classList.add('tt-library-page');
  applyShelfSpacing();
  // childList only — avoids feedback loop from YouTube's own translateY writes.
  _libraryObserver = new MutationObserver(applyShelfSpacing);
  _libraryObserver.observe(nuDen, { childList: true });
}

function stopShelfSpacingObserver() {
  _libraryGeneration++;
  document.body?.classList.remove('tt-library-page');
  if (_libraryObserver) { _libraryObserver.disconnect(); _libraryObserver = null; }
}

// Called when tab hiding is not configured — spacing only
export const applyLibraryShelfSpacing = () => {
  if (detectCurrentPage() === 'library') {
    startShelfSpacingObserver();
  } else {
    stopShelfSpacingObserver();
  }
};

// Called when tab hiding is configured — tab pruning + spacing + body class
export const applyLibraryTabHiding = (response, configuredHiddenIds) => {
  const hiddenIds = getHiddenLibraryTabIds(configuredHiddenIds);
  if (hiddenIds.size === 0) {
    document.body?.classList.remove('tt-no-library-tabs');
    return;
  }
  if (detectCurrentPage() === 'library') {
    pruneLibraryTabs(response, hiddenIds);
    setTimeout(updateLibraryTabsClass, 200);
    startShelfSpacingObserver();
  } else {
    document.body?.classList.remove('tt-no-library-tabs');
    stopShelfSpacingObserver();
  }
};

// Supplement the XHR-based trigger: re-apply spacing on SPA navigation
// (handles cases where the library page is served from cache without a new XHR)
if (typeof window !== 'undefined') {
  let _prevWasLibrary = false;
  window.addEventListener('hashchange', () => {
    const isLibrary = detectCurrentPage() === 'library';
    if (isLibrary && !_prevWasLibrary) startShelfSpacingObserver();
    else if (!isLibrary) stopShelfSpacingObserver();
    _prevWasLibrary = isLibrary;
  });
}
