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

function getTabIdFromItem(item) {
  return String(
    item?.tabRenderer?.endpoint?.browseEndpoint?.browseId
    || item?.tileRenderer?.contentId
    || item?.navigationEndpoint?.browseEndpoint?.browseId
    || item?.browseEndpoint?.browseId
    || ''
  ).toLowerCase();
}

// Returns ordered array of tab IDs from the XHR response, or null if not found.
function extractResponseTabIds(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 10) return null;
  if (Array.isArray(node?.tvSecondaryNavSectionRenderer?.tabs)) {
    return node.tvSecondaryNavSectionRenderer.tabs.map(getTabIdFromItem);
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = extractResponseTabIds(item, depth + 1);
      if (r) return r;
    }
    return null;
  }
  for (const key of Object.keys(node)) {
    const r = extractResponseTabIds(node[key], depth + 1);
    if (r) return r;
  }
  return null;
}

// Hides tabs by matching response-order IDs to DOM-order elements positionally.
function hideTabsInDom(hiddenIds, responseTabIds) {
  const navEl = document.querySelector('ytlr-tv-secondary-nav-section-renderer');
  if (!navEl) return false;
  const tabs = navEl.querySelectorAll('ytlr-tab-renderer, [role="tab"]');
  if (!tabs.length) return false;
  for (let i = 0; i < tabs.length; i++) {
    const tabId = i < responseTabIds.length ? responseTabIds[i] : '';
    tabs[i].style.display = matchesHiddenId(tabId, hiddenIds) ? 'none' : '';
  }
  return true;
}

function updateLibraryTabsClass() {
  const navEl = document.querySelector('ytlr-tv-secondary-nav-section-renderer');
  const tabs = navEl ? Array.from(navEl.querySelectorAll('ytlr-tab-renderer, [role="tab"]')) : [];
  const hasTabs = tabs.some(t => t.style.display !== 'none');
  document.body?.classList.toggle('tt-no-library-tabs', !hasTabs);
}

const SHELF_GAP_REM = 0;
let _libraryGeneration = 0;
let _libraryObserver = null;
let _prevPage = null;

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
  const firstY = parseFloat(wrappers[0].style.transform.match(/translateY\(([^r]+)rem\)/)?.[1]) || 0;
  let cursor = document.body?.classList.contains('tt-no-library-tabs') ? 0 : firstY;
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

const noTabs = () => document.body?.classList.contains('tt-no-library-tabs');

function applyTabHidingInDom(hiddenIds, responseTabIds, retriesLeft = 15) {
  if (detectCurrentPage() !== 'library') return;
  if (!hideTabsInDom(hiddenIds, responseTabIds)) {
    if (retriesLeft > 0) setTimeout(() => applyTabHidingInDom(hiddenIds, responseTabIds, retriesLeft - 1), 200);
    return;
  }
  updateLibraryTabsClass();
  if (noTabs() && _prevPage !== 'playlist') startShelfSpacingObserver();
}

// Called when tab hiding is not configured — spacing only
export const applyLibraryShelfSpacing = () => {
  if (detectCurrentPage() === 'library') {
    if (noTabs() && _prevPage !== 'playlist') startShelfSpacingObserver();
  } else {
    stopShelfSpacingObserver();
  }
};

// Called when tab hiding is configured — DOM-based tab hiding + spacing
export const applyLibraryTabHiding = (response, configuredHiddenIds) => {
  const hiddenIds = getHiddenLibraryTabIds(configuredHiddenIds);
  if (hiddenIds.size === 0) {
    document.body?.classList.remove('tt-no-library-tabs');
    return;
  }
  if (detectCurrentPage() === 'library') {
    const responseTabIds = extractResponseTabIds(response);
    if (responseTabIds) {
      document.body?.classList.remove('tt-no-library-tabs');
      applyTabHidingInDom(hiddenIds, responseTabIds);
    }
    // Continuation responses have no tab list — existing DOM hiding stays in place.
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
