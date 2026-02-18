import { configRead } from '../../config.js';
import { PatchSettings } from '../../ui/customYTSettings.js';
import { registerJsonParseHook } from '../jsonParseHooks.js';
import { applyAdCleanup, applyBrowseAdFiltering } from './adCleanup.js';
import { applyPreferredVideoCodec } from './videoCodecPreference.js';
import { processShelves, processHorizontalItems } from '../processShelves.js';
import { applySponsorBlockHighlight, applySponsorBlockTimelyActions } from './sponsorblock.js';
import { applyPaidContentOverlay } from './paidContentOverlay.js';
import { applyEndscreen } from './endscreen.js';
import { applyYouThereRenderer } from './youThereRenderer.js';
import { applyQueueShelf } from './queueShelf.js';
import { detectCurrentPage } from '../pageDetection.js';
import { directFilterArray, scanAndFilterAllArrays } from './shortsCore.js';
import { startPlaylistAutoLoad } from './playlistEnhancements.js';
import { isInCollectionMode, finishCollectionAndFilter } from './playlistHelpers.js';


let DEBUG_ENABLED = configRead('enableDebugConsole');
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
          DEBUG_ENABLED = !!event.detail.value;
        }
      });
    }
  }, 100);
}

function buildShelfProcessingOptions() {
  return {
    deArrowEnabled: configRead('enableDeArrow'),
    deArrowThumbnailsEnabled: configRead('enableDeArrowThumbnails'),
    hqThumbnailsEnabled: configRead('enableHqThumbnails'),
    longPressEnabled: configRead('enableLongPress'),
    previewsEnabled: configRead('enablePreviews'),
    hideWatchedPages: configRead('hideWatchedVideosPages'),
    hideWatchedThreshold: configRead('hideWatchedVideosThreshold'),
    shortsEnabled: configRead('enableShorts'),
    page: detectCurrentPage(),
    debugEnabled: DEBUG_ENABLED,
    logShorts: DEBUG_ENABLED
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

    if (Array.isArray(sectionRenderer.tabs)) {
      for (const tab of sectionRenderer.tabs) {
        const tabShelves = tab?.tabRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents;
        if (Array.isArray(tabShelves)) {
          processShelves(tabShelves, buildShelfProcessingOptions());
        }
      }
    }

    if (Array.isArray(sectionRenderer.items)) {
      for (const item of sectionRenderer.items) {
        const content = item?.tvSecondaryNavItemRenderer?.content;
        if (!content) continue;

        const shelf = content?.shelfRenderer;
        if (shelf) {
          processShelves([content], buildShelfProcessingOptions());
          continue;
        }

        const richGridItems = content?.richGridRenderer?.contents;
        if (Array.isArray(richGridItems)) {
          content.richGridRenderer.contents = directFilterArray(richGridItems, currentPage);
        }

        const contentShelves = content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents;
        if (Array.isArray(contentShelves)) {
          processShelves(contentShelves, buildShelfProcessingOptions());
        }
      }
    }
  }
}

if (typeof window !== 'undefined') {
  window._collectedUnwatched = window._collectedUnwatched || [];
}

registerJsonParseHook((parsedResponse) => {
  const currentPage = detectCurrentPage();
  const adBlockEnabled = configRead('enableAdBlock');

  applyAdCleanup(parsedResponse, adBlockEnabled);
  applyPaidContentOverlay(parsedResponse, configRead('enablePaidPromotionOverlay'));
  applyPreferredVideoCodec(parsedResponse, configRead('videoPreferredCodec'));
  applyBrowseAdFiltering(parsedResponse, adBlockEnabled);

  if (parsedResponse?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents) {
    processShelves(
      parsedResponse.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents,
      buildShelfProcessingOptions()
    );
  }

  applyEndscreen(parsedResponse, configRead('enableHideEndScreenCards'));
  applyYouThereRenderer(parsedResponse, configRead('enableYouThereRenderer'));

  if (parsedResponse?.title?.runs) {
    PatchSettings(parsedResponse);
  }

  if (parsedResponse?.contents?.sectionListRenderer?.contents) {
    processShelves(parsedResponse.contents.sectionListRenderer.contents, buildShelfProcessingOptions());
  }

  if (parsedResponse?.continuationContents?.sectionListContinuation?.contents) {
    processShelves(parsedResponse.continuationContents.sectionListContinuation.contents, buildShelfProcessingOptions());
  }

  if (parsedResponse?.continuationContents?.horizontalListContinuation?.items) {
    parsedResponse.continuationContents.horizontalListContinuation.items = processHorizontalItems(
      parsedResponse.continuationContents.horizontalListContinuation.items,
      buildShelfProcessingOptions()
    );
  }

  if (parsedResponse?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
    processSecondaryNav(parsedResponse.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections, currentPage);
  }

  if (parsedResponse?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer) {
    processShelves(
      parsedResponse.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents,
      { ...buildShelfProcessingOptions(), shouldAddPreviews: false }
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

    maybeStartPlaylistAutoload(currentPage);
  }

  if (parsedResponse?.onResponseReceivedActions) {
    for (const action of parsedResponse.onResponseReceivedActions) {
      const items = action?.appendContinuationItemsAction?.continuationItems;
      if (Array.isArray(items)) {
        scanAndFilterAllArrays(items, currentPage, 'onResponseReceivedActions');
        action.appendContinuationItemsAction.continuationItems = directFilterArray(items, currentPage);
      }
    }
  }

  const criticalPages = ['subscriptions', 'library', 'history', 'playlist', 'channel'];
  const skipUniversalFilter = currentPage === 'watch';
  if (criticalPages.includes(currentPage) && !parsedResponse.__universalFilterApplied && !skipUniversalFilter) {
    parsedResponse.__universalFilterApplied = true;
    scanAndFilterAllArrays(parsedResponse, currentPage);
  }

  applySponsorBlockTimelyActions(parsedResponse, configRead('sponsorBlockManualSkips'));
  applySponsorBlockHighlight(parsedResponse, configRead('enableSponsorBlockHighlight'));

  return parsedResponse;
});
