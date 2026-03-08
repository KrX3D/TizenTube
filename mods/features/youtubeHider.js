import { shouldHideWatchedVideo } from './youtubeHiderWatched.js';
import { shouldHideByContentType } from './youtubeHiderContentTypes.js';
import { shouldHideByMinimumViews } from './youtubeHiderViews.js';
import { shouldHideByUploadDate } from './youtubeHiderUploadDate.js';
import { shouldHideShortsItem } from './youtubeHiderShorts.js';

export function shouldHideTile(item) {
  if (!item?.tileRenderer) return false;

  return shouldHideShortsItem(item)
    || shouldHideWatchedVideo(item)
    || shouldHideByContentType(item)
    || shouldHideByMinimumViews(item)
    || shouldHideByUploadDate(item);
}
