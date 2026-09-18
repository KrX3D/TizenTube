/**
 * guideEntryKey.js — one stable key for a sidebar (guide) entry, shared by the
 * code that hides entries, the code that orders them, and the settings menus
 * that let the user choose both.
 *
 * Entries used to be keyed by the page they open (browseEndpoint.browseId),
 * with a special case for search. Anything that opens something other than a
 * page had no key at all, and both menus skipped it outright — so it could
 * neither be hidden nor moved. Shorts, which YouTube started putting in the TV
 * sidebar, plays a reel rather than opening a page, and is exactly that case.
 *
 * Deliberately no imports: customGuideAction.js loads early to wrap JSON.parse,
 * and pulling other modules in from here could change that order.
 */

/** The key for a guide entry, or null if it is not a guide entry at all. */
export function guideEntryKey(item) {
  const entry = item?.guideEntryRenderer;
  if (!entry) return null;
  const nav = entry.navigationEndpoint || {};
  if (nav.browseEndpoint?.browseId) return String(nav.browseEndpoint.browseId);
  if (nav.searchEndpoint) return 'search';
  // No page to key on. The icon is the next most stable thing: it is not
  // localised (the title is) and each built-in entry has its own. It is also
  // what the oldest configs already used as keys, so the hiding code matches
  // it either way.
  const icon = entry.icon?.iconType;
  if (icon) return String(icon);
  // Last resort, so that even an entry with neither still shows up somewhere
  // it can be dealt with rather than silently vanishing from both menus.
  const endpoint = Object.keys(nav).find((k) => /(Endpoint|Command)$/.test(k));
  return endpoint ? 'endpoint:' + endpoint : null;
}

/**
 * Every key that can hide this entry: its own, plus its icon, which older
 * configs — including this fork's default list — use instead.
 */
export function guideEntryHideKeys(item) {
  const keys = [];
  const key = guideEntryKey(item);
  if (key) keys.push(key);
  const icon = item?.guideEntryRenderer?.icon?.iconType;
  if (icon && keys.indexOf(String(icon)) === -1) keys.push(String(icon));
  return keys;
}

/** The entry's display title, whichever form YouTube sent it in. */
export function guideEntryTitle(item) {
  const title = item?.guideEntryRenderer?.formattedTitle;
  if (!title) return '';
  if (title.simpleText) return String(title.simpleText);
  if (Array.isArray(title.runs)) return title.runs.map((r) => r?.text || '').join('');
  return '';
}
