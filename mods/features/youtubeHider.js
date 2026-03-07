import { shouldHideWatchedVideo } from './youtubeHiderWatched.js';
import { shouldHideByContentType } from './youtubeHiderContentTypes.js';
import { shouldHideByMinimumViews } from './youtubeHiderViews.js';
import { shouldHideByUploadDate } from './youtubeHiderUploadDate.js';

export function shouldHideTile(item) {
  if (!item?.tileRenderer) return false;

  return shouldHideWatchedVideo(item)
    || shouldHideByContentType(item)
    || shouldHideByMinimumViews(item)
    || shouldHideByUploadDate(item);
}
