import { configRead } from '../config.js';
import { getTileText, isLiveTile, isMixTile, isPlaylistTile, shouldApplyOnCurrentPage } from './youtubeHiderUtils.js';

export function shouldHideByContentType(item) {
  const texts = getTileText(item);

  if (configRead('enableHideMixes') && shouldApplyOnCurrentPage('hideMixesPages') && isMixTile(item, texts)) {
    return true;
  }

  if (configRead('enableHidePlaylists') && shouldApplyOnCurrentPage('hidePlaylistsPages') && isPlaylistTile(item, texts)) {
    return true;
  }

  if (configRead('enableHideLives') && shouldApplyOnCurrentPage('hideLivesPages') && isLiveTile(texts)) {
    return true;
  }

  return false;
}
