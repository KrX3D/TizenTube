import { configRead } from '../config.js';
import { getTileText, parseViewsFromText, shouldApplyOnCurrentPage } from './youtubeHiderUtils.js';

export function shouldHideByMinimumViews(item) {
  if (!configRead('enableMinimumViewsFilter')) return false;
  if (!shouldApplyOnCurrentPage('minimumViewsFilterPages')) return false;

  const views = parseViewsFromText(getTileText(item));
  if (views === null) return false;

  return views < configRead('minimumViewsThreshold');
}
