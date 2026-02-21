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
import { findProgressBar } from './hideWatchedVideos.js';


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
          content.richGridRenderer.contents = directFilterArray(richGridItems, currentPage, 'secondaryNav.items.richGrid');
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
  const href = (typeof window !== 'undefined' ? (window.location?.href || '') : '').toLowerCase();
  const hash = (typeof window !== 'undefined' ? (window.location?.hash || '') : '').toLowerCase();
  const combined = `${href} ${hash}`;

  // Playlist URL/hash must win even if currentPage was inferred as library.
  if (combined.includes('/playlist') || combined.includes('list=')) return 'playlist';

  if (currentPage && currentPage !== 'other') return currentPage;

  if (combined.includes('fesubscription')) return 'subscriptions';
  if (combined.includes('subscription')) return 'subscriptions';
  if (combined.includes('felibrary')) return 'library';
  if (combined.includes('fehistory')) return 'history';
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
        tabContent.richGridRenderer.contents = directFilterArray(richGridContents, pageForFiltering, `${path}.richGrid`);
      } else if (tabContent?.tvSurfaceContentRenderer?.content?.richGridRenderer?.contents) {
        tabContent.tvSurfaceContentRenderer.content.richGridRenderer.contents = directFilterArray(richGridContents, pageForFiltering, `${path}.richGrid`);
      }
    }
  }
}



function inferFilteringPage(parsedResponse, effectivePage) {
  const href = (typeof window !== 'undefined' ? (window.location?.href || '') : '').toLowerCase();
  const hash = (typeof window !== 'undefined' ? (window.location?.hash || '') : '').toLowerCase();
  const combined = `${href} ${hash}`;

  if (combined.includes('list=') || combined.includes('/playlist')) {
    return 'playlist';
  }

  if (parsedResponse?.continuationContents?.tvSurfaceContentContinuation) {
    const lastPage = (typeof window !== 'undefined' ? (window._lastDetectedPage || '') : '') || '';
    if (lastPage === 'playlist' || lastPage === 'playlists') {
      return 'playlist';
    }
  }

  if (effectivePage && effectivePage !== 'other') return effectivePage;

  if (parsedResponse?.continuationContents?.playlistVideoListContinuation?.contents) return 'playlist';

  if ((combined.includes('list=') || combined.includes('/playlist')) && parsedResponse?.contents?.singleColumnBrowseResultsRenderer?.tabs) {
    return 'playlist';
  }

  if (
    parsedResponse?.metadata?.channelMetadataRenderer
    || parsedResponse?.header?.c4TabbedHeaderRenderer
    || combined.includes('/channel/')
    || combined.includes('/@')
    || /\/browse\/(uc|hc)/.test(combined)
  ) {
    return 'channel';
  }

  if (
    combined.includes('fesubscription')
    || combined.includes('subscription')
    || parsedResponse?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections
  ) {
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
  if (pageForFiltering !== 'subscriptions' && pageForFiltering !== 'subscription' && pageForFiltering !== 'channel' && pageForFiltering !== 'channels') return false;
  if (!parsedResponse?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) return false;
  const sections = parsedResponse.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections || [];
  if (DEBUG_ENABLED) console.log('[SECONDARY_NAV_TARGETED] page=', pageForFiltering, '| sections=', sections.length);

  sections.forEach((section, sectionIdx) => {
    const items = section?.tvSecondaryNavSectionRenderer?.items;
    if (!Array.isArray(items)) return;

    items.forEach((item, itemIdx) => {
      if (item?.compactLinkRenderer) return;

      const content = item?.tvSecondaryNavItemRenderer?.content;
      if (!content) return;

      if (content?.shelfRenderer) {
        const shelfContainer = [content];
        processShelves(shelfContainer, buildShelfProcessingOptions(pageForFiltering));
        if (shelfContainer.length === 0) {
          if (DEBUG_ENABLED) {
            console.log('[REMOVE_EMPTY_CONTAINER] path=', `subscriptions.section.${sectionIdx}.item.${itemIdx}.shelf`, '| reason=empty-shelf-after-filter');
          }
          items[itemIdx] = null;
          return;
        }
        scanAndFilterAllArrays(shelfContainer[0], pageForFiltering, `subscriptions.section.${sectionIdx}.item.${itemIdx}.shelf`);
        item.tvSecondaryNavItemRenderer.content = shelfContainer[0];
        return;
      }

      if (Array.isArray(content?.richGridRenderer?.contents)) {
        const richGridPath = `subscriptions.section.${sectionIdx}.item.${itemIdx}.richGrid`;
        scanAndFilterAllArrays(content.richGridRenderer.contents, pageForFiltering, richGridPath);
        content.richGridRenderer.contents = directFilterArray(content.richGridRenderer.contents, pageForFiltering, richGridPath);
        if (content.richGridRenderer.contents.length === 0) {
          if (DEBUG_ENABLED) {
            console.log('[REMOVE_EMPTY_CONTAINER] path=', richGridPath, '| reason=empty-rich-grid-after-filter');
          }
          items[itemIdx] = null;
        }
      }
    });

    section.tvSecondaryNavSectionRenderer.items = items.filter(Boolean);
  });

  return true;
}

function filterContinuationItemContainer(container, page, path) {
  if (!Array.isArray(container)) return container;
  scanAndFilterAllArrays(container, page, path);
  return directFilterArray(container, page, path);
}

function processTvSurfaceContinuation(parsedResponse, pageForFiltering) {
  const tvSurface = parsedResponse?.continuationContents?.tvSurfaceContentContinuation?.content;
  if (!tvSurface) return;

  const sectionListContents = tvSurface?.sectionListRenderer?.contents;
  if (Array.isArray(sectionListContents)) {
    // First filter arrays recursively, then compact/remove emptied shelves/rows.
    scanAndFilterAllArrays(sectionListContents, pageForFiltering, 'continuation.tvSurface.sectionList');
    processShelves(sectionListContents, buildShelfProcessingOptions(pageForFiltering));
  }

  const gridItems = tvSurface?.gridRenderer?.items;
  if (Array.isArray(gridItems)) {
    scanAndFilterAllArrays(gridItems, pageForFiltering, 'continuation.tvSurface.grid');
    tvSurface.gridRenderer.items = directFilterArray(gridItems, pageForFiltering, 'continuation.tvSurface.grid');
  }
}

function forceCompactWatchNextShelves(parsedResponse, pageForFiltering) {
  if (pageForFiltering !== 'watch') return;

  const contents = parsedResponse?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer?.contents;
  if (!Array.isArray(contents)) return;

  for (let i = contents.length - 1; i >= 0; i--) {
    const shelf = contents[i];
    const items = shelf?.shelfRenderer?.content?.horizontalListRenderer?.items;
    if (!Array.isArray(items)) continue;

    const filtered = directFilterArray(items, pageForFiltering, `watch.forceCompact[${i}].shelfRenderer.content.horizontalListRenderer.items`);
    shelf.shelfRenderer.content.horizontalListRenderer.items = filtered;

    if (!Array.isArray(filtered) || filtered.length === 0) {
      contents.splice(i, 1);
    }
  }
}

function removePlaylistHelperNodesFromDom() {
  if (typeof document === 'undefined') return;
  const nodes = document.querySelectorAll(
    'ytlr-continuation-item-renderer, [class*="continuation"], [class*="load-more"], [class*="loadmore"]'
  );
  nodes.forEach((node) => node.remove());
}

function removeWatchedNodesFromDomByTitle() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const removedTitles = (window._ttRemovedWatchedTitles || []).map((t) => String(t).trim().toLowerCase()).filter((t) => t.length >= 6);
  if (!removedTitles.length) return;

  const nodes = document.querySelectorAll('ytlr-grid-video-renderer, ytlr-rich-item-renderer, [data-video-id], ytlr-item-section-renderer ytlr-grid-video-renderer');
  nodes.forEach((node) => {
    const text = (node.textContent || '').toLowerCase();
    if (!text) return;
    for (const title of removedTitles) {
      if (text.includes(title)) {
        node.remove();
        break;
      }
    }
  });
}

function stripPlaylistHelpersDeep(node) {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      const item = node[i];
      const isContinuationLike = !!item?.continuationItemRenderer
        || !!item?.continuationEndpoint
        || !!item?.continuationCommand
        || !!item?.tileRenderer?.onSelectCommand?.continuationCommand
        || !!item?.tileRenderer?.onSelectCommand?.continuationEndpoint;
      if (isContinuationLike) {
        node.splice(i, 1);
        continue;
      }
      stripPlaylistHelpersDeep(item);
    }
    return;
  }

  for (const key of Object.keys(node)) {
    stripPlaylistHelpersDeep(node[key]);
  }
}

function forceCompactSectionShelves(contents, pageForFiltering, basePath) {
  if (!Array.isArray(contents)) return;

  for (let i = contents.length - 1; i >= 0; i--) {
    const section = contents[i];
    const shelfItems = section?.shelfRenderer?.content?.horizontalListRenderer?.items;
    if (Array.isArray(shelfItems)) {
      const filteredShelfItems = directFilterArray(
        shelfItems,
        pageForFiltering,
        `${basePath}[${i}].shelfRenderer.content.horizontalListRenderer.items`
      );
      section.shelfRenderer.content.horizontalListRenderer.items = filteredShelfItems;
      if (!filteredShelfItems.length) {
        contents.splice(i, 1);
        continue;
      }
    }

    const richItems = section?.richShelfRenderer?.content?.richGridRenderer?.contents;
    if (Array.isArray(richItems)) {
      const filteredRichItems = directFilterArray(
        richItems,
        pageForFiltering,
        `${basePath}[${i}].richShelfRenderer.content.richGridRenderer.contents`
      );
      section.richShelfRenderer.content.richGridRenderer.contents = filteredRichItems;
      if (!filteredRichItems.length) {
        contents.splice(i, 1);
      }
    }
  }
}

function isVideoLikeNode(item) {
  return !!(
    item?.tileRenderer
    || item?.videoRenderer
    || item?.playlistVideoRenderer
    || item?.gridVideoRenderer
    || item?.compactVideoRenderer
    || item?.richItemRenderer?.content?.videoRenderer
  );
}

function hardPruneWatchedDeep(node, watchedThreshold) {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      const item = node[i];
      if (isVideoLikeNode(item)) {
        const progressBar = findProgressBar(item);
        if (progressBar) {
          const watched = Number(progressBar.percentDurationWatched || 0);
          if (watched >= watchedThreshold) {
            node.splice(i, 1);
            continue;
          }
        }
      }
      hardPruneWatchedDeep(item, watchedThreshold);
    }
    return;
  }

  for (const key of Object.keys(node)) {
    hardPruneWatchedDeep(node[key], watchedThreshold);
  }
}

function stripShortsShelvesDeep(node) {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      const item = node[i];
      const title = getShelfTitle(item);
      const normalizedTitle = String(title || '').trim().toLowerCase();
      const hasShelfShape = !!(item?.shelfRenderer || item?.richShelfRenderer || item?.richSectionRenderer || item?.reelShelfRenderer || item?.gridRenderer);
      if (hasShelfShape && (normalizedTitle === 'shorts' || normalizedTitle === '#shorts' || normalizedTitle === 'short')) {
        node.splice(i, 1);
        continue;
      }
      stripShortsShelvesDeep(item);
    }
    return;
  }

  for (const key of Object.keys(node)) {
    stripShortsShelvesDeep(node[key]);
  }
}

registerJsonParseHook((parsedResponse) => {
  const currentPage = detectCurrentPage();
  const effectivePage = resolveEffectivePage(currentPage);
  const pageForFiltering = inferFilteringPage(parsedResponse, effectivePage);
  const adBlockEnabled = configRead('enableAdBlock');
  const isFinalPlaylistPayload = (pageForFiltering === 'playlist' || pageForFiltering === 'playlists')
    && !!parsedResponse?.continuationContents?.playlistVideoListContinuation?.contents
    && !parsedResponse?.continuationContents?.playlistVideoListContinuation?.continuations;

  if (DEBUG_ENABLED) {
    const marker = `${pageForFiltering}|${currentPage}`;
    if (window._lastFilterPageMarker !== marker) {
      console.log('[FILTER_PAGE] current=', currentPage, '| effective=', effectivePage, '| inferred=', pageForFiltering);
      window._lastFilterPageMarker = marker;
    }
  }


  applyAdCleanup(parsedResponse, adBlockEnabled);
  applyShortsAdFiltering(parsedResponse, adBlockEnabled);
  applyPaidContentOverlay(parsedResponse, configRead('enablePaidPromotionOverlay'));
  applyPreferredVideoCodec(parsedResponse, configRead('videoPreferredCodec'));
  applyBrowseAdFiltering(parsedResponse, adBlockEnabled);

  // Set last-batch flag early so playlist array filtering in this same payload can
  // drop helpers on the final batch instead of waiting for a later response.
  if (parsedResponse?.continuationContents?.playlistVideoListContinuation?.contents) {
    const hasContinuation = !!parsedResponse.continuationContents.playlistVideoListContinuation.continuations;
    window._isLastPlaylistBatch = !hasContinuation;
  }


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



  if ((pageForFiltering === 'subscriptions' || pageForFiltering === 'subscription' || pageForFiltering === 'channel' || pageForFiltering === 'channels' || pageForFiltering === 'playlist' || pageForFiltering === 'playlists')
      && parsedResponse?.continuationContents) {
    scanAndFilterAllArrays(parsedResponse.continuationContents, pageForFiltering, 'continuationContents.root');
  }

  processTvSurfaceContinuation(parsedResponse, pageForFiltering);

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
    forceCompactSectionShelves(parsedResponse.continuationContents.sectionListContinuation.contents, pageForFiltering, 'continuation.sectionListContinuation');
  }

  if (parsedResponse?.continuationContents?.horizontalListContinuation?.items) {
    parsedResponse.continuationContents.horizontalListContinuation.items = processHorizontalItems(
      parsedResponse.continuationContents.horizontalListContinuation.items,
      buildShelfProcessingOptions(pageForFiltering)
    );
  }

  const handledTargetedSecondaryNav = processSubscriptionsSecondaryNav(parsedResponse, pageForFiltering);

  if ((!handledTargetedSecondaryNav || pageForFiltering === 'channel' || pageForFiltering === 'channels')
      && parsedResponse?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
    if (DEBUG_ENABLED) console.log('[SECONDARY_NAV_GENERIC] page=', pageForFiltering);
    processSecondaryNav(parsedResponse.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections, pageForFiltering);
  }

  if (pageForFiltering === 'channel' || pageForFiltering === 'channels' || pageForFiltering === 'subscriptions' || pageForFiltering === 'subscription') {
    scanAndFilterAllArrays(parsedResponse, pageForFiltering, 'critical.forceRoot');
  }

  if (parsedResponse?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer) {
    scanAndFilterAllArrays(
      parsedResponse.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents,
      pageForFiltering,
      'singleColumnWatchNextResults.pivot.sectionListRenderer'
    );
    processShelves(
      parsedResponse.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents,
      { ...buildShelfProcessingOptions(pageForFiltering), shouldAddPreviews: false }
    );

    applyQueueShelf(parsedResponse);
  }

  forceCompactWatchNextShelves(parsedResponse, pageForFiltering);

  if (pageForFiltering === 'watch' && parsedResponse?.contents?.singleColumnWatchNextResults) {
    scanAndFilterAllArrays(
      parsedResponse.contents.singleColumnWatchNextResults,
      pageForFiltering,
      'watch.final.singleColumnWatchNextResults'
    );
    const watchPivotContents = parsedResponse.contents.singleColumnWatchNextResults?.pivot?.sectionListRenderer?.contents;
    if (Array.isArray(watchPivotContents)) {
      processShelves(watchPivotContents, { ...buildShelfProcessingOptions(pageForFiltering), shouldAddPreviews: false });
      forceCompactSectionShelves(watchPivotContents, pageForFiltering, 'watch.final.singleColumnWatchNextResults.pivot.sectionListRenderer');
      forceCompactWatchNextShelves(parsedResponse, pageForFiltering);

      const watchedThreshold = Number(configRead('hideWatchedVideosThreshold') || 0);
      hardPruneWatchedDeep(parsedResponse.contents.singleColumnWatchNextResults, watchedThreshold);
    }
  }

  if (pageForFiltering === 'channel' || pageForFiltering === 'channels' || pageForFiltering === 'subscriptions' || pageForFiltering === 'subscription') {
    if (!configRead('enableShorts')) {
      stripShortsShelvesDeep(parsedResponse);
    }

    if (configRead('enableHideWatchedVideos')) {
      const watchedThreshold = Number(configRead('hideWatchedVideosThreshold') || 0);
      hardPruneWatchedDeep(parsedResponse, watchedThreshold);
    }
  }

  if (parsedResponse?.continuationContents?.playlistVideoListContinuation?.contents) {
    const hasContinuation = !!parsedResponse.continuationContents.playlistVideoListContinuation.continuations;

    if (!hasContinuation && isInCollectionMode()) {
      setTimeout(() => {
        finishCollectionAndFilter(window._collectedUnwatched || []);
      }, 1200);
    }

    maybeStartPlaylistAutoload(pageForFiltering);

    if (!hasContinuation && (pageForFiltering === 'playlist' || pageForFiltering === 'playlists')) {
      stripPlaylistHelpersDeep(parsedResponse.continuationContents.playlistVideoListContinuation.contents);
      stripPlaylistHelpersDeep(parsedResponse);
      setTimeout(removePlaylistHelperNodesFromDom, 0);
      setTimeout(removePlaylistHelperNodesFromDom, 500);
    }
  }

  if (isFinalPlaylistPayload) {
    stripPlaylistHelpersDeep(parsedResponse);
    setTimeout(removePlaylistHelperNodesFromDom, 0);
  }

  if (pageForFiltering === 'watch') {
    setTimeout(removeWatchedNodesFromDomByTitle, 0);
    setTimeout(removeWatchedNodesFromDomByTitle, 400);
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


  if (parsedResponse?.onResponseReceivedCommands) {
    for (const command of parsedResponse.onResponseReceivedCommands) {
      const appendItems = command?.appendContinuationItemsAction?.continuationItems;
      if (Array.isArray(appendItems)) {
        command.appendContinuationItemsAction.continuationItems = filterContinuationItemContainer(
          appendItems,
          pageForFiltering,
          'onResponseReceivedCommands.append'
        );
      }

      const reloadItems = command?.reloadContinuationItemsCommand?.continuationItems;
      if (Array.isArray(reloadItems)) {
        command.reloadContinuationItemsCommand.continuationItems = filterContinuationItemContainer(
          reloadItems,
          pageForFiltering,
          'onResponseReceivedCommands.reload'
        );
      }
    }
  }


  // Final defensive pass after continuation command rewrites, to catch payload variants
  // that re-introduce watched/shorts/helper entries late in the response object.
  if (configRead('enableHideWatchedVideos') && (pageForFiltering === 'watch' || pageForFiltering === 'channel' || pageForFiltering === 'channels' || pageForFiltering === 'subscriptions' || pageForFiltering === 'subscription')) {
    const watchedThreshold = Number(configRead('hideWatchedVideosThreshold') || 0);
    hardPruneWatchedDeep(parsedResponse, watchedThreshold);
  }

  if (!configRead('enableShorts') && (pageForFiltering === 'channel' || pageForFiltering === 'channels' || pageForFiltering === 'subscriptions' || pageForFiltering === 'subscription')) {
    stripShortsShelvesDeep(parsedResponse);
  }

  if (pageForFiltering === 'playlist' || pageForFiltering === 'playlists') {
    stripPlaylistHelpersDeep(parsedResponse);
  }

  const criticalPages = ['subscriptions', 'subscription', 'library', 'history', 'playlist', 'playlists', 'channel', 'channels', 'watch'];
  const skipUniversalFilter = !!window._skipUniversalFilter;
  if (criticalPages.includes(pageForFiltering) && !parsedResponse.__universalFilterApplied && !skipUniversalFilter) {
    parsedResponse.__universalFilterApplied = true;
    scanAndFilterAllArrays(parsedResponse, pageForFiltering, 'universal.root');
  }

  applySponsorBlockTimelyActions(parsedResponse, configRead('sponsorBlockManualSkips'));
  applySponsorBlockHighlight(parsedResponse, configRead('enableSponsorBlockHighlight'));

  return parsedResponse;
});
