// Deprecated compatibility module.
// The legacy side-effect-driven adblock runtime has been split into dedicated feature files.

export {
  directFilterArray,
  scanAndFilterAllArrays,
  startPlaylistAutoLoad,
  hideVideo,
  findProgressBar,
  getCurrentPage
} from './adblockCompat.js';

export {
  trackRemovedPlaylistHelpers,
  isLikelyPlaylistHelperItem,
  getVideoKey,
  trackRemovedPlaylistHelperKeys,
  isInCollectionMode,
  getFilteredVideoIds,
  startCollectionMode,
  finishCollectionAndFilter,
  exitFilterMode
} from './playlistHelpers.js';

export {
  cleanupPlaylistHelperTiles
} from './playlistCleanup.js';

export {
  addPlaylistControlButtons,
  detectPlaylistButtons,
  initPlaylistButtonMaintenance
} from './playlistButtonInsertion.js';

export {
  triggerPlaylistContinuationLoad,
  logChunkedByLines
} from './playlistEnhancements.js';

export {
  getVideoId,
  getVideoTitle,
  collectVideoIdsFromShelf,
  shouldFilterShorts,
  isShortItem,
  filterShortItems,
  removeShortsShelvesByTitle,
  rememberShortsFromShelf,
  isKnownShortFromShelfMemory,
  initShortsTrackingState
} from './shortsCore.js';

export { shouldHideWatchedForPage } from './hideWatchedVideos.js';
