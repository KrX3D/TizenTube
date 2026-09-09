import { configRead } from '../config.js';

// Log category filtering and verbosity (see AGENTS.md "Hard-won lessons").
//
// Every structured log line in this codebase goes through
// hideWatched.js's appendFileOnlyLog, and every label is already namespaced
// by feature ("playlist.batch_collect.fetching", "hideVideo.removed",
// "adblock.stripped", ...). That existing convention is what makes filtering
// possible without touching ~110 call sites: the text before the first dot
// identifies the feature, so one lookup here decides whether a line is kept.
//
// Why this matters beyond tidy output: window.__ttLogQueue is capped at 100
// entries and is JSON.stringify'd in-page, on YouTube's own render thread,
// once per second (see logServer.js). Turning off the categories you aren't
// working on removes that work at the source rather than filtering it on the
// receiving end, which is the difference between "noisy logs" and "the TV
// stutters while navigating".

// Label prefix -> category. Prefixes not listed here fall into 'other', which
// is enabled by default so a newly added label is never silently swallowed.
const PREFIX_CATEGORY = {
  // Navigation and page detection — the "what am I looking at" tier.
  page: 'nav', parse: 'nav', nav: 'nav', home: 'nav',
  watchNext: 'nav', pivot: 'nav', tab: 'nav', tabs: 'nav',

  ads: 'ads', adblock: 'ads',

  shorts: 'shorts',

  hideVideo: 'watched', deep: 'watched',

  playlist: 'playlist', consolidate: 'playlist',

  membersOnly: 'filters', survey: 'filters', channelShelf: 'filters',
  specialPlaylist: 'filters', libraryTab: 'filters', duplicate: 'filters',

  shelf: 'shelves', shelfItem: 'shelves', processShelves: 'shelves',
  tile: 'shelves', addLongPress: 'shelves', sidebar: 'shelves',

  dearrow: 'thumbs', thumbs: 'thumbs',

  resume: 'player', screenOff: 'player', sponsorblock: 'player',
  captionStyle: 'player', player: 'player',
};

export const LOG_CATEGORIES = [
  'nav', 'ads', 'shorts', 'watched', 'playlist',
  'filters', 'shelves', 'thumbs', 'player', 'other',
];

export function categoryForLabel(label) {
  const prefix = String(label || '').split('.')[0];
  return PREFIX_CATEGORY[prefix] || 'other';
}

export function isCategoryEnabled(label) {
  try {
    const enabled = configRead('logCategories');
    // Not an array (corrupted config, or a build predating this key) — let
    // everything through rather than silently going dark.
    if (!Array.isArray(enabled)) return true;
    return enabled.includes(categoryForLabel(label));
  } catch {
    return true;
  }
}

// Fields kept in basic mode. Enough to answer "which page, which video, how
// many items, why" without carrying whole renderer payloads.
const BASIC_KEYS = [
  'page', 'pageName', 'pageHint', 'detectedPage', 'previous', 'next',
  'videoId', 'title', 'reason', 'count', 'items', 'before', 'after',
  'removed', 'batch', 'batches', 'enabled', 'source', 'style', 'msg', 'message',
];

/**
 * Reduce a payload for basic verbosity.
 *
 * Basic is meant to read as a narrative — which page opened, which video
 * started, how many items a filter removed — not as a data dump. Detailed
 * keeps the payload untouched, which is the behaviour this codebase had
 * before categories existed.
 */
export function applyVerbosity(payload) {
  try {
    if (configRead('logVerbosity') !== 'basic') return payload;
    if (!payload || typeof payload !== 'object') return payload;
    if (Array.isArray(payload)) return { count: payload.length };
    const out = {};
    for (const key of BASIC_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
      const value = payload[key];
      if (value === null || value === undefined) continue;
      // Nested objects are what make detailed mode expensive; in basic mode
      // record only that something was there.
      if (typeof value === 'object') {
        out[key] = Array.isArray(value) ? `[${value.length}]` : '{…}';
      } else {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return payload;
  }
}
