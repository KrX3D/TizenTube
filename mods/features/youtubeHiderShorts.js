import { configRead } from '../config.js';
import { isShortsItem } from './youtubeHiderUtils.js';

export function shouldHideShortsItem(item) {
  return !configRead('enableShorts') && isShortsItem(item);
}
