import { configRead } from '../config.js';
import { shouldApplyOnCurrentPage } from './youtubeHiderUtils.js';

export function shouldHideWatchedVideo(item) {
  if (!configRead('enableHideWatchedVideos')) return false;
  if (!shouldApplyOnCurrentPage('hideWatchedVideosPages')) return false;

  const progressBar = item?.tileRenderer?.header?.tileHeaderRenderer?.thumbnailOverlays
    ?.find(overlay => overlay.thumbnailOverlayResumePlaybackRenderer)
    ?.thumbnailOverlayResumePlaybackRenderer;

  if (!progressBar) return false;
  const percentWatched = progressBar.percentDurationWatched || 0;
  return percentWatched > configRead('hideWatchedVideosThreshold');
}
