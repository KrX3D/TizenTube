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
//
// That default is the right one and it has a cost worth knowing about: a
// prefix nobody mapped still logs, it just logs under a category nobody would
// think to switch off. An audit of one day's capture against this table found
// eleven prefixes in that state, including tiles (43 lines, the loudest thing
// outside 'player'), longPress, reload and badgedVideo, and two of them —
// tiles against tile, longPress against addLongPress — were near misses of a
// prefix that IS here.
//
// So when adding a label, add its prefix here too. The check is cheap: grep
// the codebase for appendFileOnlyLog(' and compare the prefixes against the
// keys below.
const PREFIX_CATEGORY = {
  // Navigation and page detection — the "what am I looking at" tier.
  page: 'nav', parse: 'nav', nav: 'nav', home: 'nav',
  watchNext: 'nav', pivot: 'nav', tab: 'nav', tabs: 'nav',

  ads: 'ads', adblock: 'ads',

  shorts: 'shorts',

  hideVideo: 'watched', deep: 'watched', hideWatched: 'watched',
  // Found by the check below rather than by reading: marking a video watched
  // belongs with the rest of the watched handling, and it was mine, added
  // without a mapping while writing the very audit that caught it.
  markWatched: 'watched',

  playlist: 'playlist', consolidate: 'playlist',

  membersOnly: 'filters', survey: 'filters', channelShelf: 'filters',
  specialPlaylist: 'filters', libraryTab: 'filters', duplicate: 'filters',
  channelHider: 'filters', musicShelf: 'filters', aggregateShelf: 'filters',
  badge: 'filters', badgedVideo: 'filters', filters: 'filters',

  shelf: 'shelves', shelfItem: 'shelves', processShelves: 'shelves',
  tile: 'shelves', addLongPress: 'shelves', sidebar: 'shelves',
  // tiles as well as tile, and longPress as well as addLongPress. Both pairs
  // were a near miss: the singular was mapped, the plural was not, so turning
  // 'shelves' off left the loudest of them running. tiles.countsStripped was
  // 43 lines in one day's capture, more than any other non-player prefix.
  tiles: 'shelves', longPress: 'shelves',

  dearrow: 'thumbs', thumbs: 'thumbs',

  resume: 'player', screenOff: 'player',
  captionStyle: 'player', player: 'player',
  unwedge: 'player', reload: 'player',

  // Its own category rather than folded into 'player', because the volumes
  // are nothing alike. One capture held 7302 SponsorBlock lines against 29942
  // in the whole file, while the player diagnostics the same person was
  // reading came to a few dozen — so switching the noise off used to mean
  // switching off the thing being looked at.
  sponsorblock: 'sponsorblock',

  // Not label prefixes any real line uses: these are the names the two former
  // settings are read under, via isCategoryEnabled('playbackDiag.'). Without
  // them the lookup falls through to 'other', which is on by default, so the
  // costly playback timing would have come back on for everyone.
  playbackDiag: 'playbackDiag',
  subsShelf: 'subsShelf',
};

// playbackDiag and subsShelf were their own on/off settings a level up in the
// menu until they were asked to live here with the rest. They differ from the
// others in one way worth knowing: the categories above FILTER lines that are
// produced anyway, while these two stop the work being done at all — the
// playback one gates the parse timing and the heartbeat, not just their
// output. That makes them stronger than a category, not weaker, so putting
// them in the same list costs nothing and reads better than a separate pair of
// switches.
export const LOG_CATEGORIES = [
  'nav', 'ads', 'shorts', 'watched', 'playlist',
  'filters', 'shelves', 'thumbs', 'player', 'sponsorblock',
  'playbackDiag', 'subsShelf', 'other',
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
