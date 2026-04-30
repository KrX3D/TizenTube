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

// Counts remaining tabs in tvSecondaryNavSectionRenderer.tabs after pruning.
// Returns the tab count (0 = all hidden), or -1 if the nav section is not in this response.
const getRemainingTabCount = (node, depth = 0) => {
  if (!node || typeof node !== 'object' || depth > 15) return -1;
  if (node.tvSecondaryNavSectionRenderer !== undefined) {
    const tabs = node.tvSecondaryNavSectionRenderer?.tabs;
    return Array.isArray(tabs) ? tabs.length : 0;
  }
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (!val || typeof val !== 'object') continue;
    if (Array.isArray(val)) {
      for (const entry of val) {
        if (entry && typeof entry === 'object') {
          const r = getRemainingTabCount(entry, depth + 1);
          if (r !== -1) return r;
        }
      }
    } else {
      const r = getRemainingTabCount(val, depth + 1);
      if (r !== -1) return r;
    }
  }
  return -1;
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

// tt-no-library-tabs is NOT removed when leaving the library page so that it persists
// for the hashchange-triggered observer restart on return (before any XHR fires).
// It is only changed via applyLibraryTabHiding (response check) or updateLibraryTabsClass (DOM fallback).
const noTabs = () => document.body?.classList.contains('tt-no-library-tabs');

function applyShelfSpacing() {
  const nuDen = document.querySelector('ytlr-section-list-renderer > yt-virtual-list > div');
  if (!nuDen) return;

  // When any tab is visible, do not touch layout — let YouTube handle everything.
  if (!noTabs()) return;

  // If YouTube scrolls via nuDen's own transform, reset it.
  if (nuDen.style.transform && !nuDen.style.transform.includes('translateY(0rem)'))
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

  // Past stabilization: re-check — tabs may have become visible during retries.
  if (!noTabs()) return;

  document.body?.classList.add('tt-library-page');
  applyShelfSpacing();

  // Only lock scroll when there is 1 or fewer shelf left — if 2+ shelves exist
  // (e.g. WL or LL not hidden), the user needs to scroll between them.
  const vlEl = nuDen.parentElement;
  if (vlEl && wrappers.length <= 1) {
    _scrollLockEl = vlEl;
    Object.defineProperty(vlEl, 'scrollTop', { get: () => 0, set: () => {}, configurable: true });
    const protoDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
      ?? Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
    _onScroll = () => { if (protoDesc?.set) protoDesc.set.call(vlEl, 0); };
    vlEl.addEventListener('scroll', _onScroll, { passive: true });
  }

  // Use a rAF loop: YouTube's virtual list uses its own rAF layout loop to reposition
  // shelf wrappers, so our corrections must also run every frame.
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
  // tt-no-library-tabs is intentionally kept — it must persist across navigation so that
  // noTabs() is correct when hashchange fires on return to library before any XHR updates it.
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

  if (detectCurrentPage() !== 'library') {
    stopShelfSpacingObserver();
    return;
  }

  if (hiddenIds.size === 0) {
    document.body?.classList.remove('tt-no-library-tabs');
    stopShelfSpacingObserver();
    return;
  }

  pruneLibraryTabs(response, hiddenIds);

  // Check remaining tab count directly in the response — synchronous, no DOM timing issues.
  // remaining === 0  → all tabs hidden → apply treatment
  // remaining  > 0  → some tabs visible → hands off entirely
  // remaining === -1 → nav section not in this response → fall back to DOM check
  const remaining = getRemainingTabCount(response);

  if (remaining === 0) {
    document.body?.classList.add('tt-no-library-tabs');
    startShelfSpacingObserver();
  } else if (remaining > 0) {
    document.body?.classList.remove('tt-no-library-tabs');
    stopShelfSpacingObserver();
  } else {
    // Nav not found in this response (e.g. continuation XHR) — fall back to DOM inspection.
    setTimeout(() => {
      updateLibraryTabsClass();
      if (noTabs()) startShelfSpacingObserver();
      else stopShelfSpacingObserver();
    }, 300);
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    if (detectCurrentPage() !== 'library') {
      stopShelfSpacingObserver();
    } else if (noTabs()) {
      // Safety net for cached-data returns: no XHR fires, so applyLibraryTabHiding won't run.
      // noTabs() is reliable here because tt-no-library-tabs persists across navigation.
      startShelfSpacingObserver();
    }
  });
}
