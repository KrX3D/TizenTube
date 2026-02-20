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
import { directFilterArray, scanAndFilterAllArrays, getShelfTitle, isShortsShelfTitle, isShortsShelfObject } from './shortsCore.js';
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

    const isShortsTitle = isShortsShelfTitle(title)
      || String(title).trim().toLowerCase() === 'short'
      || isShortsShelfObject(content, title);
    if (!isShortsTitle) return true;

    if (DEBUG_ENABLED) {
      console.log('[SHORTS_SHELF] removed secondary-nav title=', title, '| page=', currentPage, '| path=secondaryNav.items');
    }
    return false;
  });
}


function resolveEffectivePage(currentPage) {
  if (currentPage && currentPage !== 'other') return currentPage;

  const href = (typeof window !== 'undefined' ? (window.location?.href || '') : '').toLowerCase();
  const hash = (typeof window !== 'undefined' ? (window.location?.hash || '') : '').toLowerCase();
  const combined = `${href} ${hash}`;

  if (combined.includes('fesubscription')) return 'subscriptions';
  if (combined.includes('subscription')) return 'subscriptions';
  if (combined.includes('felibrary')) return 'library';
  if (combined.includes('fehistory')) return 'history';
  if (combined.includes('/playlist') || combined.includes('list=')) return 'playlist';
  if (combined.includes('/channel/') || combined.includes('/@') || /\/browse\/(uc|hc)/.test(combined)) return 'channel';

  return (typeof window !== 'undefined' ? (window._lastDetectedPage || currentPage) : currentPage);
}

function processBrowseTabs(tabs, pageForFiltering, path) {
  if (!Array.isArray(tabs)) return;

  for (const tab of tabs) {
    const tabContent = tab?.tabRenderer?.content;

    const sectionListContents = tabContent?.sectionListRenderer?.contents
      || tabContent?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents
      || null;

    if (Array.isArray(sectionListContents)) {
      if (pageForFiltering === 'playlist' || pageForFiltering === 'playlists') {
        maybeStartPlaylistAutoload(pageForFiltering);
      }

      processShelves(sectionListContents, buildShelfProcessingOptions(pageForFiltering));
      scanAndFilterAllArrays(sectionListContents, pageForFiltering, `${path}.sectionList`);
    }

    const richGridContents = tabContent?.richGridRenderer?.contents
      || tabContent?.tvSurfaceContentRenderer?.content?.richGridRenderer?.contents
      || null;

    if (Array.isArray(richGridContents)) {
      scanAndFilterAllArrays(richGridContents, pageForFiltering, `${path}.richGrid`);
      if (tabContent?.richGridRenderer?.contents) {
        tabContent.richGridRenderer.contents = directFilterArray(richGridContents, pageForFiltering);
      } else if (tabContent?.tvSurfaceContentRenderer?.content?.richGridRenderer?.contents) {
        tabContent.tvSurfaceContentRenderer.content.richGridRenderer.contents = directFilterArray(richGridContents, pageForFiltering);
      }
    }
  }
}



function inferFilteringPage(parsedResponse, effectivePage) {
  if (effectivePage && effectivePage !== 'other') return effectivePage;

  if (parsedResponse?.continuationContents?.playlistVideoListContinuation?.contents) return 'playlist';

  const href = (typeof window !== 'undefined' ? (window.location?.href || '') : '').toLowerCase();
  const hash = (typeof window !== 'undefined' ? (window.location?.hash || '') : '').toLowerCase();
  if ((href.includes('list=') || hash.includes('list=')) && parsedResponse?.contents?.singleColumnBrowseResultsRenderer?.tabs) {
    return 'playlist';
  }

  if (parsedResponse?.metadata?.channelMetadataRenderer || parsedResponse?.header?.c4TabbedHeaderRenderer) {
    return 'channel';
  }

  if (parsedResponse?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
    return 'subscriptions';
  }

  return (typeof window !== 'undefined' ? (window._lastDetectedPage || effectivePage) : effectivePage);
}

function processPlaylistSingleColumnBrowse(parsedResponse, pageForFiltering) {
  if (pageForFiltering !== 'playlist' && pageForFiltering !== 'playlists') return;
  const tabs = parsedResponse?.contents?.singleColumnBrowseResultsRenderer?.tabs;
  if (!Array.isArray(tabs)) return;

  for (const tab of tabs) {
    const contents = tab?.tabRenderer?.content?.sectionListRenderer?.contents;
    if (!Array.isArray(contents)) continue;
    processShelves(contents, buildShelfProcessingOptions(pageForFiltering));
    scanAndFilterAllArrays(contents, pageForFiltering, 'playlist.singleColumnBrowseResultsRenderer.tabs');
  }
}


function processSubscriptionsSecondaryNav(parsedResponse, pageForFiltering) {
  if (pageForFiltering !== 'subscriptions' && pageForFiltering !== 'subscription') return false;
  if (!parsedResponse?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) return false;
  if (parsedResponse.__tizentubeProcessedSubs) return true;

  parsedResponse.__tizentubeProcessedSubs = true;
  const sections = parsedResponse.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections || [];

  sections.forEach((section, sectionIdx) => {
    const items = section?.tvSecondaryNavSectionRenderer?.items;
    if (!Array.isArray(items)) return;

    items.forEach((item, itemIdx) => {
      if (item?.compactLinkRenderer) return;

      const content = item?.tvSecondaryNavItemRenderer?.content;
      if (!content) return;

      if (content?.shelfRenderer) {
        processShelves([content], buildShelfProcessingOptions(pageForFiltering));
        scanAndFilterAllArrays(content, pageForFiltering, `subscriptions.section.${sectionIdx}.item.${itemIdx}.shelf`);
        return;
      }

      if (Array.isArray(content?.richGridRenderer?.contents)) {
        scanAndFilterAllArrays(content.richGridRenderer.contents, pageForFiltering, `subscriptions.section.${sectionIdx}.item.${itemIdx}.richGrid`);
        content.richGridRenderer.contents = directFilterArray(content.richGridRenderer.contents, pageForFiltering);
      }
    });
  });

  return true;
}

function filterContinuationItemContainer(container, page, path) {
  if (!Array.isArray(container)) return container;
  scanAndFilterAllArrays(container, page, path);
  return directFilterArray(container, page);
}

registerJsonParseHook((parsedResponse) => {
  const currentPage = detectCurrentPage();
  const effectivePage = resolveEffectivePage(currentPage);
  const pageForFiltering = inferFilteringPage(parsedResponse, effectivePage);
  const adBlockEnabled = configRead('enableAdBlock');

  applyAdCleanup(parsedResponse, adBlockEnabled);
  applyShortsAdFiltering(parsedResponse, adBlockEnabled);
  applyPaidContentOverlay(parsedResponse, configRead('enablePaidPromotionOverlay'));
  applyPreferredVideoCodec(parsedResponse, configRead('videoPreferredCodec'));
  applyBrowseAdFiltering(parsedResponse, adBlockEnabled);

  if (parsedResponse?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents) {
    if (pageForFiltering === 'playlist' || pageForFiltering === 'playlists') {
      maybeStartPlaylistAutoload(pageForFiltering);
    }
    const browseShelves = parsedResponse.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents;
    processShelves(
      browseShelves,
      buildShelfProcessingOptions(pageForFiltering)
    );
    scanAndFilterAllArrays(browseShelves, pageForFiltering, 'tvBrowse.sectionList');
  }

  applyEndscreen(parsedResponse, configRead('enableHideEndScreenCards'));
  applyYouThereRenderer(parsedResponse, configRead('enableYouThereRenderer'));

  if (parsedResponse?.title?.runs) {
    PatchSettings(parsedResponse);
  }


  if (parsedResponse?.contents?.singleColumnBrowseResultsRenderer) {
    scanAndFilterAllArrays(parsedResponse.contents.singleColumnBrowseResultsRenderer, pageForFiltering, 'singleColumnBrowseResultsRenderer');
  }

  if (parsedResponse?.contents?.twoColumnBrowseResultsRenderer) {
    scanAndFilterAllArrays(parsedResponse.contents.twoColumnBrowseResultsRenderer, pageForFiltering, 'twoColumnBrowseResultsRenderer');
  }

  processPlaylistSingleColumnBrowse(parsedResponse, pageForFiltering);

  if (pageForFiltering !== 'playlist' && pageForFiltering !== 'playlists') {
    processBrowseTabs(
      parsedResponse?.contents?.singleColumnBrowseResultsRenderer?.tabs,
      pageForFiltering,
      'singleColumnBrowseResultsRenderer.tabs'
    );
  }

  processBrowseTabs(
    parsedResponse?.contents?.twoColumnBrowseResultsRenderer?.tabs,
    pageForFiltering,
    'twoColumnBrowseResultsRenderer.tabs'
  );

  if (parsedResponse?.contents?.sectionListRenderer?.contents) {
    processShelves(parsedResponse.contents.sectionListRenderer.contents, buildShelfProcessingOptions(pageForFiltering));
    scanAndFilterAllArrays(parsedResponse.contents.sectionListRenderer.contents, pageForFiltering, 'contents.sectionListRenderer');
  }

  if (parsedResponse?.continuationContents?.sectionListContinuation?.contents) {
    scanAndFilterAllArrays(parsedResponse.continuationContents.sectionListContinuation.contents, pageForFiltering, 'continuation.sectionListContinuation');
    processShelves(parsedResponse.continuationContents.sectionListContinuation.contents, buildShelfProcessingOptions(pageForFiltering));
  }

  if (parsedResponse?.continuationContents?.horizontalListContinuation?.items) {
    parsedResponse.continuationContents.horizontalListContinuation.items = processHorizontalItems(
      parsedResponse.continuationContents.horizontalListContinuation.items,
      buildShelfProcessingOptions(pageForFiltering)
    );
  }

  const handledSubscriptionsSecondaryNav = processSubscriptionsSecondaryNav(parsedResponse, pageForFiltering);

  if (!handledSubscriptionsSecondaryNav && parsedResponse?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
    processSecondaryNav(parsedResponse.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections, pageForFiltering);
  }

  if (parsedResponse?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer) {
    processShelves(
      parsedResponse.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents,
      { ...buildShelfProcessingOptions(pageForFiltering), shouldAddPreviews: false }
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

    maybeStartPlaylistAutoload(pageForFiltering);
  }

  if (parsedResponse?.onResponseReceivedActions) {
    for (const action of parsedResponse.onResponseReceivedActions) {
      const appendItems = action?.appendContinuationItemsAction?.continuationItems;
      if (Array.isArray(appendItems)) {
        action.appendContinuationItemsAction.continuationItems = filterContinuationItemContainer(
          appendItems,
          pageForFiltering,
          'onResponseReceivedActions.append'
        );
      }

      const reloadItems = action?.reloadContinuationItemsCommand?.continuationItems;
      if (Array.isArray(reloadItems)) {
        action.reloadContinuationItemsCommand.continuationItems = filterContinuationItemContainer(
          reloadItems,
          pageForFiltering,
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
          pageForFiltering,
          'onResponseReceivedEndpoints.append'
        );
      }

      const reloadItems = endpoint?.reloadContinuationItemsCommand?.continuationItems;
      if (Array.isArray(reloadItems)) {
        endpoint.reloadContinuationItemsCommand.continuationItems = filterContinuationItemContainer(
          reloadItems,
          pageForFiltering,
          'onResponseReceivedEndpoints.reload'
        );
      }
    }
  }

  const criticalPages = ['subscriptions', 'subscription', 'library', 'history', 'playlist', 'playlists', 'channel', 'channels'];
  const skipUniversalFilter = pageForFiltering === 'watch' || !!window._skipUniversalFilter;
  const alreadyScannedMainPaths = !!(
    parsedResponse?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents
    || parsedResponse?.contents?.singleColumnBrowseResultsRenderer
    || parsedResponse?.contents?.twoColumnBrowseResultsRenderer
    || parsedResponse?.contents?.sectionListRenderer?.contents
    || parsedResponse?.continuationContents?.sectionListContinuation?.contents
  );
  if (criticalPages.includes(pageForFiltering) && !parsedResponse.__universalFilterApplied && !skipUniversalFilter && !alreadyScannedMainPaths) {
    parsedResponse.__universalFilterApplied = true;
    scanAndFilterAllArrays(parsedResponse, pageForFiltering);
  }

  applySponsorBlockTimelyActions(parsedResponse, configRead('sponsorBlockManualSkips'));
  applySponsorBlockHighlight(parsedResponse, configRead('enableSponsorBlockHighlight'));

  return parsedResponse;
});
