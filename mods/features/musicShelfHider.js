import { configRead } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';

/**
 * musicShelfHider.js — remove the music row YouTube puts on Home.
 *
 * Reported: Home shows a row headed "Noch mal anhören" with a play icon, and a
 * "Mehr Musik" entry below it that opens the music section. It is a promotion
 * for YouTube Music rather than part of the feed.
 *
 * Identified by where it points, not by its title: the title is localised and
 * YouTube changes it ("Noch mal anhören", "Deine Lieblingssongs", ...), while
 * the destination is a music browse id, which is the same in every language.
 * Same reasoning as channelShelfHider, which identifies its shelves by what
 * they contain.
 */

// FEmusic_home, FEmusic_trending and friends, plus the TV app's own music
// section. Matched case-insensitively against any browse id in the shelf.
const MUSIC_BROWSE_ID = /^FE(music|topics_music)/i;

// Bounded: a shelf carries every tile it shows, and this runs per shelf.
const MAX_DEPTH = 8;

function findMusicBrowseId(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findMusicBrowseId(child, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const browseId = node.browseEndpoint?.browseId;
  if (typeof browseId === 'string' && MUSIC_BROWSE_ID.test(browseId)) return browseId;
  for (const key of Object.keys(node)) {
    // Never follow an action's parameters: this fork's long press entries keep
    // a copy of the whole video item there.
    if (key === 'parameters') continue;
    const hit = findMusicBrowseId(node[key], depth + 1);
    if (hit) return hit;
  }
  return null;
}

function shelfTitle(shelve) {
  const base = shelve?.richSectionRenderer?.content || shelve;
  const title = base?.shelfRenderer?.title || base?.shelfRenderer?.headerRenderer?.shelfHeaderRenderer?.title;
  if (!title) return '';
  if (title.simpleText) return String(title.simpleText);
  if (Array.isArray(title.runs)) return title.runs.map(r => r?.text || '').join('');
  return '';
}

export function isMusicShelf(shelve) {
  return findMusicBrowseId(shelve);
}

/**
 * Drop music shelves from a page's shelf list, in place.
 *
 * @param {Array} shelves   the section list
 * @param {string} pageName the detected page
 */
export function filterMusicShelves(shelves, pageName = null) {
  if (!Array.isArray(shelves) || !configRead('hideMusicShelf')) return;
  for (let i = shelves.length - 1; i >= 0; i--) {
    try {
      const browseId = isMusicShelf(shelves[i]);
      if (!browseId) continue;
      appendFileOnlyLog('musicShelf.removed', { title: shelfTitle(shelves[i]).slice(0, 60), browseId, pageName });
      shelves.splice(i, 1);
    } catch (_) { }
  }
}
