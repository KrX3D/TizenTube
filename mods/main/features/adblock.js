export { getCurrentPage } from '../pageDetection.js';
// Deprecated compatibility module.
// The legacy side-effect-driven adblock runtime has been split into dedicated feature files.

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
  logChunkedByLines,
  startPlaylistAutoLoad
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
  initShortsTrackingState,
  directFilterArray,
  scanAndFilterAllArrays
} from './shortsCore.js';

export { shouldHideWatchedForPage, hideVideo, findProgressBar } from './hideWatchedVideos.js';
