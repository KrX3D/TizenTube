import { configRead } from '../../config.js';
import { PatchSettings } from '../../ui/customYTSettings.js';
import { registerJsonParseHook } from '../jsonParseHooks.js';
import { applyAdCleanup, applyBrowseAdFiltering, applyShortsAdFiltering } from './adCleanup.js';
import { applyPreferredVideoCodec } from './videoCodecPreference.js';
import { processShelves, processHorizontalItems } from '../processShelves.js';
import { applySponsorBlockHighlight, applySponsorBlockTimelyActions } from './sponsorblock.js';
import { applyPaidContentOverlay } from './paidContentOverlay.js';
import { applyEndscreen } from './endscreen.js';
import { applyYouThereRenderer } from './youThereRenderer.js';
import { applyQueueShelf } from './queueShelf.js';
import { detectCurrentPage } from '../pageDetection.js';
import { directFilterArray, scanAndFilterAllArrays, getShelfTitle, isShortsShelfTitle } from './shortsCore.js';
import { startPlaylistAutoLoad } from './playlistEnhancements.js';
import { isInCollectionMode, finishCollectionAndFilter } from './playlistHelpers.js';
import { getGlobalDebugEnabled, getGlobalLogShorts } from './visualConsole.js';


let DEBUG_ENABLED = getGlobalDebugEnabled(configRead);
window.adblock = window.adblock || {};
window.adblock.setDebugEnabled = function(value) {
  DEBUG_ENABLED = !!value;
  console.log('[CONFIG] Debug console ' + (DEBUG_ENABLED ? 'ENABLED' : 'DISABLED'));
};

if (typeof window !== 'undefined') {
  setTimeout(() => {
    if (window.configChangeEmitter) {
      window.configChangeEmitter.addEventListener('configChange', (event) => {
        if (event.detail?.key === 'enableDebugConsole') {
          DEBUG_ENABLED = getGlobalDebugEnabled(configRead);
        }
      });
    }
  }, 100);
}

function buildShelfProcessingOptions(pageOverride) {
  return {
    deArrowEnabled: configRead('enableDeArrow'),
    deArrowThumbnailsEnabled: configRead('enableDeArrowThumbnails'),
    hqThumbnailsEnabled: configRead('enableHqThumbnails'),
    longPressEnabled: configRead('enableLongPress'),
    previewsEnabled: configRead('enablePreviews'),
    hideWatchedPages: configRead('hideWatchedVideosPages'),
    hideWatchedThreshold: configRead('hideWatchedVideosThreshold'),
    shortsEnabled: getShortsEnabled(configRead),
    page: pageOverride || detectCurrentPage(),
    debugEnabled: DEBUG_ENABLED,
    logShorts: getGlobalLogShorts(configRead)
  };
}

function maybeStartPlaylistAutoload(page) {
  if (page !== 'playlist' && page !== 'playlists') return;
  if (window._ttPlaylistAutoLoadStartedAt && Date.now() - window._ttPlaylistAutoLoadStartedAt < 1500) return;
  window._ttPlaylistAutoLoadStartedAt = Date.now();
  startPlaylistAutoLoad();
}

function processSecondaryNav(sections, currentPage) {
  if (!Array.isArray(sections)) return;

  for (const section of sections) {
    const sectionRenderer = section?.tvSecondaryNavSectionRenderer;
    if (!sectionRenderer) continue;

    pruneShortsSecondaryNavItems(sectionRenderer, currentPage);

    if (Array.isArray(sectionRenderer.tabs)) {
      for (const tab of sectionRenderer.tabs) {
        const tabShelves = tab?.tabRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents;
        if (Array.isArray(tabShelves)) {
          scanAndFilterAllArrays(tabShelves, currentPage, 'secondaryNav.tabs');
          processShelves(tabShelves, buildShelfProcessingOptions(currentPage));
        }
      }
    }

    if (Array.isArray(sectionRenderer.items)) {
      for (const item of sectionRenderer.items) {
        const content = item?.tvSecondaryNavItemRenderer?.content;
        if (!content) continue;

        const shelf = content?.shelfRenderer;
        if (shelf) {
          scanAndFilterAllArrays(content, currentPage, 'secondaryNav.items.shelf');
          processShelves([content], buildShelfProcessingOptions(currentPage));
          continue;
        }

        const richGridItems = content?.richGridRenderer?.contents;
        if (Array.isArray(richGridItems)) {
          scanAndFilterAllArrays(richGridItems, currentPage, 'secondaryNav.items.richGrid');
          content.richGridRenderer.contents = directFilterArray(richGridItems, currentPage);
        }

        const contentShelves = content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents;
        if (Array.isArray(contentShelves)) {
          scanAndFilterAllArrays(contentShelves, currentPage, 'secondaryNav.items.contentShelves');
          processShelves(contentShelves, buildShelfProcessingOptions(currentPage));
        }
      }
    }
  }
}

function pruneShortsShelvesByTitle(shelves, currentPage, path = 'secondaryNav') {
  if (!Array.isArray(shelves) || configRead('enableShorts')) return;

  for (let i = shelves.length - 1; i >= 0; i--) {
    const shelf = shelves[i];
    const title = getShelfTitle(shelf);
    if (!isShortsShelfTitle(title)) continue;

    if (DEBUG_ENABLED) {
      console.log('[SHORTS_SHELF] removed shelf title=', title, '| page=', currentPage, '| path=', path);
    }
    shelves.splice(i, 1);
  }
}

if (typeof window !== 'undefined') {
  window._collectedUnwatched = window._collectedUnwatched || [];
}

function pruneShortsSecondaryNavItems(sectionRenderer, currentPage) {
  if (!Array.isArray(sectionRenderer?.items) || getShortsEnabled(configRead)) return;

  sectionRenderer.items = sectionRenderer.items.filter((item) => {
    const content = item?.tvSecondaryNavItemRenderer?.content;
    if (!content) return true;

    const title = getShelfTitle(content)
      || item?.tvSecondaryNavItemRenderer?.title?.simpleText
      || item?.tvSecondaryNavItemRenderer?.title?.runs?.map((run) => run.text).join('')
      || '';

    const isShortsTitle = isShortsShelfTitle(title) || String(title).trim().toLowerCase() === 'short';
    if (!isShortsTitle) return true;

    if (DEBUG_ENABLED) {
      console.log('[SHORTS_SHELF] removed secondary-nav title=', title, '| page=', currentPage, '| path=secondaryNav.items');
    }
    return false;
  });
}

function filterContinuationItemContainer(container, page, path) {
  if (!Array.isArray(container)) return container;
  scanAndFilterAllArrays(container, page, path);
  return directFilterArray(container, page);
}

registerJsonParseHook((parsedResponse) => {
  const currentPage = detectCurrentPage();
  const effectivePage = currentPage === 'other' ? (window._lastDetectedPage || currentPage) : currentPage;
  const adBlockEnabled = configRead('enableAdBlock');

  applyAdCleanup(parsedResponse, adBlockEnabled);
  applyShortsAdFiltering(parsedResponse, adBlockEnabled);
  applyPaidContentOverlay(parsedResponse, configRead('enablePaidPromotionOverlay'));
  applyPreferredVideoCodec(parsedResponse, configRead('videoPreferredCodec'));
  applyBrowseAdFiltering(parsedResponse, adBlockEnabled);

  if (parsedResponse?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents) {
    if (effectivePage === 'playlist' || effectivePage === 'playlists') {
      maybeStartPlaylistAutoload(effectivePage);
    }
    processShelves(
      parsedResponse.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents,
      buildShelfProcessingOptions(effectivePage)
    );
  }

  applyEndscreen(parsedResponse, configRead('enableHideEndScreenCards'));
  applyYouThereRenderer(parsedResponse, configRead('enableYouThereRenderer'));

  if (parsedResponse?.title?.runs) {
    PatchSettings(parsedResponse);
  }

  if (parsedResponse?.contents?.sectionListRenderer?.contents) {
    processShelves(parsedResponse.contents.sectionListRenderer.contents, buildShelfProcessingOptions(effectivePage));
  }

  if (parsedResponse?.continuationContents?.sectionListContinuation?.contents) {
    processShelves(parsedResponse.continuationContents.sectionListContinuation.contents, buildShelfProcessingOptions(effectivePage));
  }

  if (parsedResponse?.continuationContents?.horizontalListContinuation?.items) {
    parsedResponse.continuationContents.horizontalListContinuation.items = processHorizontalItems(
      parsedResponse.continuationContents.horizontalListContinuation.items,
      buildShelfProcessingOptions(effectivePage)
    );
  }

  if (parsedResponse?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
    processSecondaryNav(parsedResponse.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections, effectivePage);
  }

  if (parsedResponse?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer) {
    processShelves(
      parsedResponse.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents,
      { ...buildShelfProcessingOptions(effectivePage), shouldAddPreviews: false }
    );

    applyQueueShelf(parsedResponse);
  }

  if (parsedResponse?.continuationContents?.playlistVideoListContinuation?.contents) {
    const hasContinuation = !!parsedResponse.continuationContents.playlistVideoListContinuation.continuations;
    window._isLastPlaylistBatch = !hasContinuation;

    if (!hasContinuation && isInCollectionMode()) {
      setTimeout(() => {
        finishCollectionAndFilter(window._collectedUnwatched || []);
      }, 1200);
    }

    maybeStartPlaylistAutoload(effectivePage);
  }

  if (parsedResponse?.onResponseReceivedActions) {
    for (const action of parsedResponse.onResponseReceivedActions) {
      const appendItems = action?.appendContinuationItemsAction?.continuationItems;
      if (Array.isArray(appendItems)) {
        action.appendContinuationItemsAction.continuationItems = filterContinuationItemContainer(
          appendItems,
          effectivePage,
          'onResponseReceivedActions.append'
        );
      }

      const reloadItems = action?.reloadContinuationItemsCommand?.continuationItems;
      if (Array.isArray(reloadItems)) {
        action.reloadContinuationItemsCommand.continuationItems = filterContinuationItemContainer(
          reloadItems,
          effectivePage,
          'onResponseReceivedActions.reload'
        );
      }
    }
  }

  if (parsedResponse?.onResponseReceivedEndpoints) {
    for (const endpoint of parsedResponse.onResponseReceivedEndpoints) {
      const appendItems = endpoint?.appendContinuationItemsAction?.continuationItems;
      if (Array.isArray(appendItems)) {
        endpoint.appendContinuationItemsAction.continuationItems = filterContinuationItemContainer(
          appendItems,
          effectivePage,
          'onResponseReceivedEndpoints.append'
        );
      }

      const reloadItems = endpoint?.reloadContinuationItemsCommand?.continuationItems;
      if (Array.isArray(reloadItems)) {
        endpoint.reloadContinuationItemsCommand.continuationItems = filterContinuationItemContainer(
          reloadItems,
          effectivePage,
          'onResponseReceivedEndpoints.reload'
        );
      }
    }
  }

  const criticalPages = ['subscriptions', 'library', 'history', 'playlist', 'channel'];
  const skipUniversalFilter = effectivePage === 'watch';
  if (criticalPages.includes(effectivePage) && !parsedResponse.__universalFilterApplied && !skipUniversalFilter) {
    parsedResponse.__universalFilterApplied = true;
    scanAndFilterAllArrays(parsedResponse, effectivePage);
  }

  applySponsorBlockTimelyActions(parsedResponse, configRead('sponsorBlockManualSkips'));
  applySponsorBlockHighlight(parsedResponse, configRead('enableSponsorBlockHighlight'));

  return parsedResponse;
});
