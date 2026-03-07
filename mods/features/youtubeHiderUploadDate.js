import { configRead } from '../config.js';
import { getTileText, parseAgeInDays, shouldApplyOnCurrentPage } from './youtubeHiderUtils.js';

export function shouldHideByUploadDate(item) {
  if (!configRead('enableUploadDateFilter')) return false;
  if (!shouldApplyOnCurrentPage('uploadDateFilterPages')) return false;

  const ageInDays = parseAgeInDays(getTileText(item));
  if (ageInDays === null) return false;

  const hideNewerThan = configRead('hideVideosNewerThanDays');
  const hideOlderThan = configRead('hideVideosOlderThanDays');

  if (typeof hideNewerThan === 'number' && ageInDays < hideNewerThan) return true;
  if (typeof hideOlderThan === 'number' && ageInDays > hideOlderThan) return true;

  return false;
}
