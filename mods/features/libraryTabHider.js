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

// Short-circuits as soon as tvSecondaryNavSectionRenderer is found
const detectLibraryPage = (node) => {
  if (!node || typeof node !== 'object' || _hadSecondaryNav) return;
  if (node.tvSecondaryNavSectionRenderer) { _hadSecondaryNav = true; return; }
  for (const value of Object.values(node)) {
    if (_hadSecondaryNav) return;
    if (value && typeof value === 'object') detectLibraryPage(value);
  }
};

function updateLibraryTabsClass() {
  const navEl = document.querySelector('ytlr-tv-secondary-nav-section-renderer');
  const hasTabs = !!(navEl && (navEl.querySelector('ytlr-tab-renderer') || navEl.querySelector('[role="tab"]')));
  document.body?.classList.toggle('tt-no-library-tabs', !hasTabs);
}

const SHELF_TOP_REM = 2.7;
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
    cursor += h;
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

// Called when tab hiding is not configured — spacing only
export const applyLibraryShelfSpacing = (response) => {
  _hadSecondaryNav = false;
  detectLibraryPage(response);
  if (_hadSecondaryNav) {
    setTimeout(startShelfSpacingObserver, 200);
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
