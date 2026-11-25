import { configRead } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';

// Hides YouTube Premium upsell shelves on Home, e.g. "Mit YouTube Premium noch
// mehr LISA-Content ansehen" with the subtitle "Exklusiver Zugriff auf den
// neuen Film von LISA" and Premium-only videos as tiles.
//
// Read from the live Home page on the Tizen 5.5 TV (2026-11-25): it is an
// ordinary shelfRenderer with normal video tiles, so nothing at the entry level
// sets it apart. The header does: an avatarLockupRenderer (not the usual
// title) whose title names YouTube Premium and whose badge has the style
// BADGE_STYLE_TYPE_YPC_TRANSPARENT ("Von YouTube empfohlen"; YPC = YouTube
// paid content).
//
// "YouTube Premium" is a brand name and stays the same in every language, so
// it is matched on its own. The YPC badge is only accepted together with
// "premium" in the title, because paid films may use YPC badges as well.

function text(t) {
  if (!t) return '';
  if (t.simpleText) return String(t.simpleText);
  if (Array.isArray(t.runs)) return t.runs.map(r => r?.text || '').join('');
  return '';
}

function headerLockup(shelve) {
  return shelve?.shelfRenderer?.headerRenderer?.shelfHeaderRenderer?.avatarLockup?.avatarLockupRenderer || null;
}

export function shelfHeaderTitle(shelve) {
  const sr = shelve?.shelfRenderer;
  return text(headerLockup(shelve)?.title)
    || text(sr?.headerRenderer?.shelfHeaderRenderer?.title)
    || text(sr?.title);
}

export function isPremiumShelf(shelve) {
  if (!shelve?.shelfRenderer) return false;
  const title = shelfHeaderTitle(shelve).toLowerCase();
  if (!title.includes('premium')) return false;
  if (title.includes('youtube premium')) return true;
  const badges = headerLockup(shelve)?.badges;
  return Array.isArray(badges)
    && badges.some(b => String(b?.metadataBadgeRenderer?.style || '').includes('YPC'));
}

export function filterPremiumShelves(shelves, pageName = null) {
  if (!Array.isArray(shelves) || !configRead('hidePremiumShelves')) return;
  for (let i = shelves.length - 1; i >= 0; i--) {
    try {
      if (!isPremiumShelf(shelves[i])) continue;
      appendFileOnlyLog('premiumShelf.removed', { title: shelfHeaderTitle(shelves[i]).slice(0, 80), pageName });
      shelves.splice(i, 1);
    } catch (_) { }
  }
}
