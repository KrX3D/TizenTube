import { configRead } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';

// Hides channel-listing shelves on Home, e.g. "Deine Top-Kanäle" /
// "Your top channels".
//
// Identified by what the shelf CONTAINS rather than by its title, because the
// title is localized and matching it would only work for one language. A
// channel shelf is one whose tiles are channels: they navigate to a channel
// browseEndpoint (browseId starting with UC) and/or use the round avatar tile
// style. Both are language-independent.
//
// Requiring a clear majority rather than a single match keeps a normal video
// shelf that happens to include one channel tile from being removed wholesale.

const CHANNEL_TILE_STYLES = ['TILE_STYLE_YTLR_ROUND'];

function isChannelTile(item) {
  const tile = item?.tileRenderer;
  if (!tile) return false;

  const browseId = tile.onSelectCommand?.browseEndpoint?.browseId
    || tile.onSelectCommand?.commandExecutorCommand?.commands
      ?.map(c => c?.browseEndpoint?.browseId).find(Boolean)
    || '';
  if (/^UC[\w-]{20,}$/.test(String(browseId))) return true;

  // Channel avatars render as round tiles. Checked second because a round tile
  // is a weaker signal on its own than an actual channel navigation target.
  if (CHANNEL_TILE_STYLES.includes(String(tile.style || ''))) return true;

  return false;
}

export function isChannelShelf(shelve) {
  const items = shelve?.shelfRenderer?.content?.horizontalListRenderer?.items;
  if (!Array.isArray(items) || items.length === 0) return false;
  const tiles = items.filter(i => i?.tileRenderer);
  if (tiles.length === 0) return false;
  const channels = tiles.filter(isChannelTile).length;
  // Majority, not all: these shelves often end with a trailing "More" tile
  // that is not itself a channel link.
  return channels >= Math.ceil(tiles.length * 0.6);
}

function shelfTitle(shelve) {
  const t = shelve?.shelfRenderer?.title;
  if (!t) return '';
  if (t.simpleText) return String(t.simpleText);
  if (Array.isArray(t.runs)) return t.runs.map(r => r?.text || '').join('');
  return '';
}

export function filterChannelShelves(shelves, pageName = null) {
  if (!Array.isArray(shelves) || !configRead('hideChannelShelves')) return;
  for (let i = shelves.length - 1; i >= 0; i--) {
    try {
      if (!isChannelShelf(shelves[i])) continue;
      appendFileOnlyLog('channelShelf.removed', { title: shelfTitle(shelves[i]).slice(0, 60), pageName });
      shelves.splice(i, 1);
    } catch (_) { }
  }
}
