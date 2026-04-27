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
  if (!navEl) return; // Not rendered yet — don't change the class based on a missing element
  const hasTabs = !!(navEl.querySelector('ytlr-tab-renderer') || navEl.querySelector('[role="tab"]'));
  document.body?.classList.toggle('tt-no-library-tabs', !hasTabs);
}

const SHELF_GAP_REM = 0;
let _libraryGeneration = 0;
let _libraryObserver = null;
let _prevPage = null;

const getTranslateY = (el) =>
  parseFloat(el.style.transform.match(/translateY\(([^r]+)rem\)/)?.[1]) || 0;

const isNavWrapper = (el) => !!el.querySelector('ytlr-tv-secondary-nav-section-renderer');

function applyShelfSpacing() {
  const nuDen = document.querySelector('ytlr-section-list-renderer > yt-virtual-list > div');
  if (!nuDen) return;

  const allWrappers = Array.from(nuDen.children)
    .filter(el => el.style?.transform?.includes('translateY') && el.childElementCount > 0);

  // Never reposition the secondary nav — let YouTube control it.
  const navWrapper = allWrappers.find(isNavWrapper);
  const wrappers = allWrappers
    .filter(el => el !== navWrapper)
    .sort((a, b) => getTranslateY(a) - getTranslateY(b));

  if (!wrappers.length) return;

  let cursor;
  if (document.body?.classList.contains('tt-no-library-tabs')) {
    cursor = 0;
  } else if (navWrapper) {
    cursor = getTranslateY(navWrapper) + (parseFloat(navWrapper.style.height) || 0);
  } else {
    cursor = getTranslateY(wrappers[0]);
  }

  for (const wrapper of wrappers) {
    const h = parseFloat(wrapper.style.height);
    if (isNaN(h)) continue;
    const desired = `translateY(${cursor}rem)`;
    if (!wrapper.style.transform.includes(desired))
      wrapper.style.transform = wrapper.style.transform.replace(/translateY\([^)]+\)/, desired);
    cursor += h + SHELF_GAP_REM;
  }
  nuDen.style.height = cursor + 'rem';
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
    ? Array.from(nuDen.children).filter(el => el.style?.transform?.includes('translateY') && el.childElementCount > 0 && !isNavWrapper(el))
    : [];
  if (!wrappers.length) {
    if (retriesLeft > 0) setTimeout(() => startShelfSpacingObserver(retriesLeft - 1, generation, undefined), 100);
    return;
  }
  const currentPositions = wrappers.map(el => el.style.transform).join('|');
  if (currentPositions !== lastPositions) {
    if (retriesLeft > 0) setTimeout(() => startShelfSpacingObserver(retriesLeft - 1, generation, currentPositions), 100);
    return;
  }
  document.body?.classList.add('tt-library-page');
  applyShelfSpacing();
  _libraryObserver = new MutationObserver(applyShelfSpacing);
  _libraryObserver.observe(nuDen, { childList: true });
}

function stopShelfSpacingObserver() {
  _libraryGeneration++;
  document.body?.classList.remove('tt-library-page');
  if (_libraryObserver) { _libraryObserver.disconnect(); _libraryObserver = null; }
}

const noTabs = () => document.body?.classList.contains('tt-no-library-tabs');

// Called when tab hiding is not configured — spacing only
export const applyLibraryShelfSpacing = () => {
  if (detectCurrentPage() === 'library') {
    if (noTabs() && _prevPage !== 'playlist') startShelfSpacingObserver();
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
    document.body?.classList.remove('tt-no-library-tabs');
    setTimeout(() => {
      updateLibraryTabsClass();
      if (_prevPage !== 'playlist') startShelfSpacingObserver();
    }, 300);
  } else {
    document.body?.classList.remove('tt-no-library-tabs');
    stopShelfSpacingObserver();
  }
};

if (typeof window !== 'undefined') {
  let _prevWasLibrary = false;
  window.addEventListener('hashchange', () => {
    const isLibrary = detectCurrentPage() === 'library';
    if (!isLibrary) _prevPage = detectCurrentPage();
    if (!isLibrary) stopShelfSpacingObserver();
    _prevWasLibrary = isLibrary;
  });
}
