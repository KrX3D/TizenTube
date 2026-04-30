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
const SHELF_SCALE_Y = 0.97; // must match CSS scaleY value on ytlr-shelf-renderer
let _libraryGeneration = 0;
let _scrollLockEl = null;
let _onScroll = null;

const getTranslateY = (el) =>
  parseFloat(el.style.transform.match(/translateY\(([^r]+)rem\)/)?.[1]) || 0;

const isNavWrapper = (el) => !!el.querySelector('ytlr-tv-secondary-nav-section-renderer');

// noTabs() reflects the last known state from updateLibraryTabsClass.
// tt-no-library-tabs is intentionally NOT removed when leaving the library page so that
// it remains accurate for the hashchange-triggered observer restart on return.
const noTabs = () => document.body?.classList.contains('tt-no-library-tabs');

function applyShelfSpacing() {
  const nuDen = document.querySelector('ytlr-section-list-renderer > yt-virtual-list > div');
  if (!nuDen) return;

  // Only run when all tabs are hidden. If a tab is visible, YouTube handles layout entirely.
  if (!noTabs()) return;

  // If YouTube scrolls via nuDen's own transform, reset it.
  if (nuDen.style.transform && !nuDen.style.transform.includes('translateY(0rem)'))
    nuDen.style.transform = nuDen.style.transform.replace(/translateY\([^)]+\)/, 'translateY(0rem)');

  const allWrappers = Array.from(nuDen.children)
    .filter(el => el.style?.transform?.includes('translateY') && el.childElementCount > 0);

  // Never reposition the secondary nav — let YouTube control it.
  const wrappers = allWrappers
    .filter(el => !isNavWrapper(el))
    .sort((a, b) => getTranslateY(a) - getTranslateY(b));

  if (!wrappers.length) return;

  // All tabs hidden: always pack shelves from top, ignoring nav wrapper height.
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

function startShelfSpacingObserver(retriesLeft = 15, generation, lastPositions) {
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
    if (retriesLeft > 0) setTimeout(() => startShelfSpacingObserver(retriesLeft - 1, generation, undefined), 100);
    return;
  }
  const currentPositions = wrappers.map(el => el.style.transform).join('|');
  if (currentPositions !== lastPositions) {
    if (retriesLeft > 0) setTimeout(() => startShelfSpacingObserver(retriesLeft - 1, generation, currentPositions), 100);
    return;
  }

  // Past stabilization: tabs may have changed since first call, re-check.
  if (!noTabs()) return;

  document.body?.classList.add('tt-library-page');
  applyShelfSpacing();

  // All tabs hidden → always lock scroll (nav wrapper may still be in DOM).
  const vlEl = nuDen.parentElement;
  if (vlEl) {
    _scrollLockEl = vlEl;
    Object.defineProperty(vlEl, 'scrollTop', { get: () => 0, set: () => {}, configurable: true });
    const protoDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
      ?? Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
    _onScroll = () => { if (protoDesc?.set) protoDesc.set.call(vlEl, 0); };
    vlEl.addEventListener('scroll', _onScroll, { passive: true });
  }

  // Use a rAF loop instead of MutationObserver: YouTube's virtual list uses its own rAF
  // layout loop to reposition shelf wrappers, so our corrections must also run every frame
  // (registered after YouTube's, so we fire last and win each frame).
  const rafLoop = () => {
    if (generation !== _libraryGeneration) return;
    if (!noTabs()) { stopShelfSpacingObserver(); return; } // tabs became visible mid-session
    applyShelfSpacing();
    requestAnimationFrame(rafLoop);
  };
  requestAnimationFrame(rafLoop);
}

function stopShelfSpacingObserver() {
  _libraryGeneration++; // causes rafLoop to self-terminate on next tick
  document.body?.classList.remove('tt-library-page');
  // tt-no-library-tabs is intentionally NOT removed here. It persists across page navigation
  // so that noTabs() returns the correct value when the hashchange handler fires on return
  // to the library page (before a new XHR can call updateLibraryTabsClass).
  if (_scrollLockEl) {
    if (_onScroll) _scrollLockEl.removeEventListener('scroll', _onScroll);
    delete _scrollLockEl.scrollTop;
    _scrollLockEl = null;
  }
  _onScroll = null;
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
  if (hiddenIds.size === 0) {
    document.body?.classList.remove('tt-no-library-tabs');
    return;
  }
  if (detectCurrentPage() === 'library') {
    pruneLibraryTabs(response, hiddenIds);
    document.body?.classList.remove('tt-no-library-tabs');
    setTimeout(() => {
      updateLibraryTabsClass();
      if (noTabs()) startShelfSpacingObserver();
    }, 300);
  } else {
    stopShelfSpacingObserver();
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    if (detectCurrentPage() !== 'library') {
      stopShelfSpacingObserver();
    } else if (noTabs()) {
      // Safety net: if YouTube uses cached data and skips XHR on return, restart the rAF loop.
      // noTabs() is reliable here because tt-no-library-tabs persists across navigation
      // (stopShelfSpacingObserver does not remove it).
      startShelfSpacingObserver();
    }
  });
}
