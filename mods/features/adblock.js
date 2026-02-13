import { configRead } from '../config.js';
import { PatchSettings } from '../ui/customYTSettings.js';
import { TileRenderer, ShelfRenderer } from '../ui/ytUI.js';
import { registerJsonParseHook } from './jsonParseHooks.js';
import { applyAdCleanup } from './adblock/adCleanup.js';
import { applyPreferredVideoCodec } from './adblock/videoCodecPreference.js';
import { processShelves, processHorizontalItems } from './adblock/processShelves.js';
import { addPreviews } from './adblock/previews.js';
import { applySponsorBlockHighlight, applySponsorBlockTimelyActions } from './adblock/sponsorblock.js';

function buildShelfProcessingOptions() {
  return {
    deArrowEnabled: configRead('enableDeArrow'),
    deArrowThumbnailsEnabled: configRead('enableDeArrowThumbnails'),
    hqThumbnailsEnabled: configRead('enableHqThumbnails'),
    longPressEnabled: configRead('enableLongPress'),
    previewsEnabled: configRead('enablePreviews'),
    hideWatchedPages: configRead('hideWatchedVideosPages'),
    hideWatchedThreshold: configRead('hideWatchedVideosThreshold'),
    shortsEnabled: configRead('enableShorts')
  };
}

registerJsonParseHook((parsedResponse) => {
  const adBlockEnabled = configRead('enableAdBlock');

  applyAdCleanup(parsedResponse, adBlockEnabled);

  if (parsedResponse.paidContentOverlay && !configRead('enablePaidPromotionOverlay')) {
    parsedResponse.paidContentOverlay = null;
  }

  applyPreferredVideoCodec(parsedResponse, configRead('videoPreferredCodec'));

  if (parsedResponse?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents) {
    const shelves = parsedResponse.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents;

    if (adBlockEnabled) {
      parsedResponse.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents =
        shelves.filter((element) => !element.adSlotRenderer);

      for (const shelve of parsedResponse.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents) {
        if (shelve.shelfRenderer) {
          shelve.shelfRenderer.content.horizontalListRenderer.items =
            shelve.shelfRenderer.content.horizontalListRenderer.items.filter((item) => !item.adSlotRenderer);
        }
      }
    }

    processShelves(
      parsedResponse.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents,
      buildShelfProcessingOptions()
    );
  }

  if (parsedResponse.endscreen && configRead('enableHideEndScreenCards')) {
    parsedResponse.endscreen = null;
  }

  if (parsedResponse.messages && Array.isArray(parsedResponse.messages) && !configRead('enableYouThereRenderer')) {
    parsedResponse.messages = parsedResponse.messages.filter((message) => !message?.youThereRenderer);
  }

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
    const options = buildShelfProcessingOptions();
    addPreviews(parsedResponse.continuationContents.horizontalListContinuation.items, options.previewsEnabled);
    parsedResponse.continuationContents.horizontalListContinuation.items = processHorizontalItems(
      parsedResponse.continuationContents.horizontalListContinuation.items,
      options
    );
  }

  if (parsedResponse?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
    for (const section of parsedResponse.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections) {
      for (const tab of section.tvSecondaryNavSectionRenderer.tabs) {
        processShelves(
          tab.tabRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents,
          buildShelfProcessingOptions()
        );
      }
    }
  }

  if (parsedResponse?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer) {
    processShelves(
      parsedResponse.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents,
      { ...buildShelfProcessingOptions(), shouldAddPreviews: false }
    );

    if (window.queuedVideos.videos.length > 0) {
      const queuedVideosClone = window.queuedVideos.videos.slice();
      queuedVideosClone.unshift(
        TileRenderer('Clear Queue', {
          customAction: {
            action: 'CLEAR_QUEUE'
          }
        })
      );

      parsedResponse.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents.unshift(
        ShelfRenderer(
          'Queued Videos',
          queuedVideosClone,
          queuedVideosClone.findIndex((video) => video.contentId === window.queuedVideos.lastVideoId) !== -1
            ? queuedVideosClone.findIndex((video) => video.contentId === window.queuedVideos.lastVideoId)
            : 0
        )
      );
    }
  }

  applySponsorBlockTimelyActions(parsedResponse, configRead('sponsorBlockManualSkips'));
  applySponsorBlockHighlight(parsedResponse, configRead('enableSponsorBlockHighlight'));

  return parsedResponse;
});
