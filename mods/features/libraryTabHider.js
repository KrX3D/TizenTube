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

let _hadSecondaryNav = false;

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
    _hadSecondaryNav = true;
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
  if (!navEl) {
    document.body?.classList.remove('tt-no-library-tabs');
    return;
  }
  const hasTabs = !!(navEl.querySelector('ytlr-tab-renderer') || navEl.querySelector('[role="tab"]'));
  document.body?.classList.toggle('tt-no-library-tabs', !hasTabs);
}

const SHELF_TOP_REM = 0.5;
const SHELF_GAP_REM = 0.5;
let _spacingObserver = null;

function applyShelfSpacing() {
  const nuDen = document.querySelector('ytlr-section-list-renderer > yt-virtual-list > div');
  if (!nuDen) return;
  const wrappers = Array.from(nuDen.children).filter(
    (el) => el.style?.transform?.includes('translateY')
  );
  if (!wrappers.length) return;
  let cursor = SHELF_TOP_REM;
  for (const wrapper of wrappers) {
    const h = parseFloat(wrapper.style.height);
    if (isNaN(h)) continue;
    const desired = `translateY(${cursor}rem)`;
    if (!wrapper.style.transform.includes(desired)) {
      wrapper.style.transform = wrapper.style.transform.replace(/translateY\([^)]+\)/, desired);
    }
    cursor += h + SHELF_GAP_REM;
  }
}

function startShelfSpacingObserver() {
  if (_spacingObserver) { _spacingObserver.disconnect(); _spacingObserver = null; }
  const nuDen = document.querySelector('ytlr-section-list-renderer > yt-virtual-list > div');
  if (!nuDen) return;
  applyShelfSpacing();
  _spacingObserver = new MutationObserver(applyShelfSpacing);
  _spacingObserver.observe(nuDen, { childList: true });
  Array.from(nuDen.children).forEach((el) => {
    _spacingObserver.observe(el, { attributes: true, attributeFilter: ['style'] });
  });
}

function stopShelfSpacingObserver() {
  if (_spacingObserver) { _spacingObserver.disconnect(); _spacingObserver = null; }
}

export const applyLibraryTabHiding = (response, configuredHiddenIds) => {
  const hiddenIds = getHiddenLibraryTabIds(configuredHiddenIds);
  _hadSecondaryNav = false;
  pruneLibraryTabs(response, hiddenIds);
  if (_hadSecondaryNav) {
    setTimeout(() => {
      updateLibraryTabsClass();
      startShelfSpacingObserver();
    }, 200);
  } else {
    document.body?.classList.remove('tt-no-library-tabs');
    stopShelfSpacingObserver();
  }
};
