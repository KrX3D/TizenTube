import { configRead } from '../config.js';

const checkId = (id) => {
  const l = String(id || '').toLowerCase();
  if (l === 'vlll') return 'LL';
  if (l === 'vlwl' || l === 'femy_youtube') return 'WL';
  const u = l.toUpperCase();
  if (u === 'LL' || u === 'WL') return u;
  return null;
};

const getShelfSpecialPlaylistId = (shelve) =>
  checkId(shelve?.shelfRenderer?.endpoint?.browseEndpoint?.browseId)
  || checkId(shelve?.shelfRenderer?.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId)
  || checkId(shelve?.shelfRenderer?.content?.horizontalListRenderer?.items?.[0]?.tileRenderer?.onSelectCommand?.watchEndpoint?.playlistId)
  || null;

const getSpecialPlaylistIdFromTile = (item) =>
  checkId(item?.tileRenderer?.contentId)
  || checkId(item?.tileRenderer?.onSelectCommand?.browseEndpoint?.browseId)
  || checkId(item?.tileRenderer?.onSelectCommand?.watchEndpoint?.playlistId)
  || null;

export function filterHiddenSpecialPlaylistTiles(items) {
  const hidden = configRead('hiddenSpecialPlaylists');
  if (!Array.isArray(hidden) || hidden.length === 0) return items;
  return items.filter(item => {
    const id = getSpecialPlaylistIdFromTile(item);
    return !id || !hidden.includes(id);
  });
}

export function filterHiddenSpecialPlaylistShelves(shelves) {
  const hidden = configRead('hiddenSpecialPlaylists');
  if (!Array.isArray(hidden) || hidden.length === 0) return;
  for (let i = shelves.length - 1; i >= 0; i--) {
    const id = getShelfSpecialPlaylistId(shelves[i]);
    if (id && hidden.includes(id)) shelves.splice(i, 1);
  }
}
