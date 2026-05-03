import { detectCurrentPage } from './hideWatched.js';
import { LIBRARY_TAB_IDS } from '../ui/settings.js';

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

// Used to identify tile-based tab bar items (new YouTube TV style where tabs are
// rendered as tileRenderer tiles in a shelf). Sourced from the settings options.
const KNOWN_LIBRARY_TAB_IDS = new Set(LIBRARY_TAB_IDS);

const isKnownLibraryTab = (item) => {
  const contentId = String(item?.tileRenderer?.contentId || '').toLowerCase();
  const browseId = String(
    item?.tabRenderer?.endpoint?.browseEndpoint?.browseId ||
    item?.navigationEndpoint?.browseEndpoint?.browseId ||
    item?.browseEndpoint?.browseId || ''
  ).toLowerCase();
  return KNOWN_LIBRARY_TAB_IDS.has(contentId) || KNOWN_LIBRARY_TAB_IDS.has(browseId);
};

// Prunes hidden tabs from the response in-place and returns the remaining library tab count.
// Returns -1 if no library tab structure was found in this response (e.g. continuation XHR).
// Handles both old-style (tvSecondaryNavSectionRenderer.tabs) and new-style
// (horizontalListRenderer.items with tileRenderer library tab tiles).
const pruneLibraryTabs = (node, hiddenIds, _state) => {
  if (!node || typeof node !== 'object') return;

  const isRoot = _state === undefined;
  if (isRoot) _state = { found: false, remaining: 0 };

  if (Array.isArray(node?.horizontalListRenderer?.items)) {
    const before = node.horizontalListRenderer.items;
    const beforeTabCount = before.filter(isKnownLibraryTab).length;
    node.horizontalListRenderer.items = before.filter((item) => !shouldHideTabItem(item, hiddenIds));
    if (beforeTabCount > 0) {
      // This horizontalListRenderer contained library tab tiles — it's the tab bar.
      const afterTabCount = node.horizontalListRenderer.items.filter(isKnownLibraryTab).length;
      _state.found = true;
      _state.remaining = Math.max(_state.remaining, afterTabCount);
    }
  }

  if (Array.isArray(node?.continuationContents?.horizontalListContinuation?.items)) {
    node.continuationContents.horizontalListContinuation.items =
      node.continuationContents.horizontalListContinuation.items.filter((item) => !shouldHideTabItem(item, hiddenIds));
  }

  if (Array.isArray(node?.tvSecondaryNavSectionRenderer?.tabs)) {
    const before = node.tvSecondaryNavSectionRenderer.tabs;
    node.tvSecondaryNavSectionRenderer.tabs = before.filter((tab) => !shouldHideTabItem(tab, hiddenIds));
    _state.found = true;
    _state.remaining = Math.max(_state.remaining, node.tvSecondaryNavSectionRenderer.tabs.length);
  }

  for (const key of Object.keys(node)) {
    const value = node[key];
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (entry && typeof entry === 'object') pruneLibraryTabs(entry, hiddenIds, _state);
        }
      } else {
        pruneLibraryTabs(value, hiddenIds, _state);
      }
    }
  }

  if (isRoot) return _state.found ? _state.remaining : -1;
};


const SHELF_GAP_REM = 0;
const SHELF_SCALE_Y = 0.97; // must match CSS scaleY value on ytlr-shelf-renderer
let _libraryGeneration = 0;
let _scrollLockEl = null;
let _onScroll = null;
let _protoScrollSet = null; // cached prototype scrollTop setter

const getTranslateY = (el) =>
  parseFloat(el.style.transform.match(/translateY\(([^r]+)rem\)/)?.[1]) || 0;

// Detects nav/tab bar wrappers to exclude from shelf repositioning.
// Handles three cases:
//   1. Old-style: ytlr-tv-secondary-nav-section-renderer
//   2. New-style with tiles: ytlr-tile-renderer[role="button"] tiles present
//   3. New-style empty: all tiles pruned → shelf exists but has no ytlr-shelf-header
//      (content shelves always have a ytlr-shelf-header; the tab bar shelf never does)
const isNavWrapper = (el) =>
  !!el.querySelector('ytlr-tv-secondary-nav-section-renderer') ||
  !!el.querySelector('ytlr-tile-renderer[role="button"]') ||
  (!!el.querySelector('ytlr-shelf-renderer') && !el.querySelector('ytlr-shelf-header'));

const noTabs = () => document.body?.classList.contains('tt-no-library-tabs');

function applyShelfSpacing() {
  const nuDen = document.querySelector('ytlr-section-list-renderer > yt-virtual-list > div');
  if (!nuDen) return;

  // When any tab is visible, do not touch layout at all.
  if (!noTabs()) return;

  // Only reset nuDen's scroll-offset transform when scroll is locked (single shelf).
  // With multiple shelves the user needs to scroll, so YouTube must control this transform.
  if (_scrollLockEl && nuDen.style.transform && !nuDen.style.transform.includes('translateY(0rem)'))
    nuDen.style.transform = nuDen.style.transform.replace(/translateY\([^)]+\)/, 'translateY(0rem)');

  const allWrappers = Array.from(nuDen.children)
    .filter(el => el.style?.transform?.includes('translateY') && el.childElementCount > 0);

  const wrappers = allWrappers
    .filter(el => !isNavWrapper(el))
    .sort((a, b) => getTranslateY(a) - getTranslateY(b));

  if (!wrappers.length) return;

  let cursor = 0;

  for (const wrapper of wrappers) {
    const h = parseFloat(wrapper.style.height);
    if (isNaN(h)) continue;
    const desired = `translateY(${cursor}rem)`;
    if (!wrapper.style.transform.includes(desired))
      wrapper.style.transform = wrapper.style.transform.replace(/translateY\([^)]+\)/, desired);
    cursor += h * SHELF_SCALE_Y + SHELF_GAP_REM;
  }
  const targetH = cursor + 'rem';
  if (nuDen.style.height !== targetH) nuDen.style.height = targetH;
}

// Waits for shelf wrappers to appear, then starts the rAF correction loop immediately.
// No stabilization wait needed: our rAF runs after YouTube's each frame so we always win.
function startShelfSpacingObserver(retriesLeft = 30, generation) {
  if (!noTabs()) return; // bail fast if tabs appeared between scheduling and execution

  if (generation === undefined) {
    generation = ++_libraryGeneration;
  } else if (generation !== _libraryGeneration) {
    return;
  }

  const nuDen = document.querySelector('ytlr-section-list-renderer > yt-virtual-list > div');
  const wrappers = nuDen
    ? Array.from(nuDen.children).filter(el => el.style?.transform?.includes('translateY') && el.childElementCount > 0 && !isNavWrapper(el))
    : [];

  if (!wrappers.length) {
    if (retriesLeft > 0) setTimeout(() => startShelfSpacingObserver(retriesLeft - 1, generation), 100);
    return;
  }

  if (!noTabs()) return;

  document.body?.classList.add('tt-library-page');
  applyShelfSpacing();

  // Lock scroll when 2 or fewer content shelves remain (all tabs + WL + LL hidden).
  // With 3+ shelves (WL or LL visible) the user must be able to scroll between them.
  const vlEl = nuDen.parentElement;
  if (vlEl && wrappers.length <= 2) {
    _scrollLockEl = vlEl;
    _protoScrollSet = (
      Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop') ??
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop')
    )?.set ?? null;
    // Reset any existing scroll position before locking.
    if (_protoScrollSet) _protoScrollSet.call(vlEl, 0);
    Object.defineProperty(vlEl, 'scrollTop', { get: () => 0, set: () => {}, configurable: true });
    _onScroll = () => { if (_protoScrollSet) _protoScrollSet.call(vlEl, 0); };
    vlEl.addEventListener('scroll', _onScroll, { passive: true });
  }

  // rAF loop: runs after YouTube's own rAF each frame, so our positions always win.
  const rafLoop = () => {
    if (generation !== _libraryGeneration) return;
    if (!noTabs()) { stopShelfSpacingObserver(); return; }
    applyShelfSpacing();
    requestAnimationFrame(rafLoop);
  };
  requestAnimationFrame(rafLoop);
}

function stopShelfSpacingObserver() {
  _libraryGeneration++;
  document.body?.classList.remove('tt-library-page');
  document.body?.classList.remove('tt-no-library-tabs');
  if (_scrollLockEl) {
    if (_onScroll) _scrollLockEl.removeEventListener('scroll', _onScroll);
    delete _scrollLockEl.scrollTop;
    _scrollLockEl = null;
  }
  _onScroll = null;
  _protoScrollSet = null;
}

// Called when tab hiding is not configured — spacing only
export const applyLibraryShelfSpacing = () => {
  if (detectCurrentPage() === 'library') {
    if (noTabs()) startShelfSpacingObserver();
  } else {
    stopShelfSpacingObserver();
  }
};

// Called when tab hiding is configured — tab pruning + spacing + body class
export const applyLibraryTabHiding = (response, configuredHiddenIds) => {
  const hiddenIds = getHiddenLibraryTabIds(configuredHiddenIds);

  if (detectCurrentPage() !== 'library') {
    stopShelfSpacingObserver();
    return;
  }

  if (hiddenIds.size === 0) {
    document.body?.classList.remove('tt-no-library-tabs');
    stopShelfSpacingObserver();
    return;
  }

  // pruneLibraryTabs modifies the response in-place and returns the remaining tab count:
  // -1 = no tab structure in this response (continuation XHR) → leave state unchanged
  //  0 = all library tabs hidden → apply spacing treatment
  // >0 = some tabs still visible → hands off entirely
  const remaining = pruneLibraryTabs(response, hiddenIds);

  if (remaining === 0) {
    // All tabs hidden — apply treatment.
    document.body?.classList.add('tt-no-library-tabs');
    startShelfSpacingObserver();
  } else if (remaining > 0) {
    // Some tabs still visible — hands off entirely.
    document.body?.classList.remove('tt-no-library-tabs');
    stopShelfSpacingObserver();
  }
  // remaining === -1: continuation XHR with no tab structure — leave current state unchanged.
};

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    if (detectCurrentPage() !== 'library') {
      stopShelfSpacingObserver();
    }
  });
}
