import { configRead } from '../config.js';
import { getWatchedPercent, shouldApplyOnCurrentPage } from './youtubeHiderUtils.js';

export function shouldHideWatchedVideo(item) {
  if (!configRead('enableHideWatchedVideos')) return false;
  if (!shouldApplyOnCurrentPage('hideWatchedVideosPages')) return false;

  const percentWatched = getWatchedPercent(item);
  if (percentWatched === null) return false;
  return percentWatched > configRead('hideWatchedVideosThreshold');
}
