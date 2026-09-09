import { configRead } from '../config.js';
import { appendFileOnlyLog, getItemVideoId, getItemTitle, detectCurrentPage } from './hideWatched.js';

// Hide videos that already appeared higher up the same page.
//
// YouTube regularly repeats a video across Home shelves — it shows up under
// "Recommended" and then again two shelves down. This keeps the first
// occurrence and drops the later ones.
//
// Pages deliberately NOT deduped:
//   watch    — the related rail repeating something from elsewhere is normal,
//              and the queue depends on those entries existing.
//   playlist — a playlist may legitimately contain the same video twice, and
//              removing entries there collides with the keep-one helper tile
//              logic that playlist continuations depend on (see AGENTS.md:
//              a continuation response that comes back empty stops loading
//              dead).
const SKIPPED_PAGES = ['watch', 'playlist'];

// Cap on how many removed entries are named in one log line, so a badly
// duplicated feed cannot flood the queue (see logServer.js's MAX_QUEUE).
const MAX_LOGGED_ITEMS = 12;

// The content arrays a shelf can hold, in the same shapes processShelves
// already handles.
function shelfItemArrays(shelve) {
  const base = shelve?.richSectionRenderer?.content || shelve;
  return [
    ['shelfRenderer.content.horizontalListRenderer', base?.shelfRenderer?.content?.horizontalListRenderer],
    ['shelfRenderer.content.verticalListRenderer', base?.shelfRenderer?.content?.verticalListRenderer],
    ['shelfRenderer.content.gridRenderer', base?.shelfRenderer?.content?.gridRenderer],
    ['shelfRenderer.content.expandedShelfContentsRenderer', base?.shelfRenderer?.content?.expandedShelfContentsRenderer],
    ['reelShelfRenderer', base?.reelShelfRenderer],
  ].filter(([, holder]) => holder && Array.isArray(holder.items))
   .map(([path, holder]) => [path, holder, 'items'])
   .concat(
     Array.isArray(base?.richShelfRenderer?.content?.richGridRenderer?.contents)
       ? [['richShelfRenderer.content.richGridRenderer', base.richShelfRenderer.content.richGridRenderer, 'contents']]
       : []
   );
}

// Seen ids for the current page visit. Continuations must keep accumulating
// (otherwise a repeat that arrives on the second scroll batch isn't caught),
// but the set has to be dropped when the page changes — a set that outlives
// its page makes shelves come back empty on re-entry, which is exactly how
// the playlist cache broke twice before.
let _seen = new Set();
let _seenKey = null;

function resetSeen(reason, key) {
  if (_seen.size) appendFileOnlyLog('duplicate.reset', { reason, previous: _seenKey, next: key, tracked: _seen.size });
  _seen = new Set();
  _seenKey = key;
}

if (!window.__ttDuplicateHiderNavInit) {
  window.__ttDuplicateHiderNavInit = true;
  // Returning to Home after a video, or a reload, must start counting again
  // rather than treating everything as already-seen.
  const onNav = () => {
    try { resetSeen('nav', detectCurrentPage()); } catch (_) { }
  };
  try {
    window.addEventListener('hashchange', onNav);
    window.addEventListener('popstate', onNav);
  } catch (_) { }
}

/**
 * Drop repeated videos across a page's shelves, and remove any shelf left
 * empty by doing so.
 *
 * Called once at the end of processShelves, so it sees shelves after every
 * other filter has run — deduping before those would let an ad or Shorts
 * tile claim the "first occurrence" slot and hide the real one.
 */
export function dedupeShelves(shelves, pageName) {
  try {
    if (!Array.isArray(shelves) || !shelves.length) return;
    if (!configRead('hideDuplicateVideos')) return;
    const page = pageName || detectCurrentPage();
    if (SKIPPED_PAGES.includes(page)) return;

    if (page !== _seenKey) resetSeen('page_change', page);

    let removedItems = 0;
    let removedShelves = 0;
    // Diagnostics. Counts alone could not distinguish "dedupe never ran" from
    // "ran and matched nothing" from "ran but the ids did not line up", which
    // is exactly the ambiguity hit when duplicates stayed on screen with the
    // feature on. Ids and titles are recorded so the pair can be identified.
    const removedDetail = [];
    let itemsWithId = 0;
    let itemsWithoutId = 0;

    // Forward order matters: the FIRST occurrence of a video is the one kept,
    // so shelves must be visited top-to-bottom. Emptied shelves are collected
    // and spliced afterwards in reverse, since splicing mid-walk would shift
    // the indices of shelves not yet visited.
    const emptied = [];
    for (let i = 0; i < shelves.length; i++) {
      const arrays = shelfItemArrays(shelves[i]);
      if (!arrays.length) continue;

      let shelfHadVideos = false;
      for (const [, holder, key] of arrays) {
        const before = holder[key];
        if (!before.length) continue;
        const kept = [];
        for (const item of before) {
          const videoId = getItemVideoId(item);
          // Anything without an id (channel tiles, buttons, separators) is
          // never a duplicate — pass it through untouched. Counted, because a
          // shelf full of id-less items means the extractor does not
          // understand that renderer rather than the shelf being unique.
          if (!videoId) { itemsWithoutId++; kept.push(item); continue; }
          itemsWithId++;
          shelfHadVideos = true;
          if (_seen.has(videoId)) {
            removedItems++;
            if (removedDetail.length < MAX_LOGGED_ITEMS) {
              removedDetail.push({ videoId, title: getItemTitle(item), shelf: i });
            }
            continue;
          }
          _seen.add(videoId);
          kept.push(item);
        }
        holder[key] = kept;
      }

      // Only collapse a shelf that actually held videos — a shelf of channel
      // tiles legitimately has none and must survive.
      if (shelfHadVideos && shelfItemArrays(shelves[i]).every(([, h, k]) => h[k].length === 0)) {
        emptied.push(i);
      }
    }

    for (let i = emptied.length - 1; i >= 0; i--) {
      shelves.splice(emptied[i], 1);
      removedShelves++;
    }

    // Logged whenever the pass actually saw items, including when it removed
    // nothing: without this, duplicates visible on screen produced no output at
    // all and there was no way to tell whether the pass had even happened.
    // Passes that saw no items are skipped — processShelves runs for many
    // response shapes that carry no tiles, and logging all of them would flood
    // the 100-entry queue that logServer.js drains in-page every second.
    if (itemsWithId || itemsWithoutId) appendFileOnlyLog('duplicate.scan', {
      page,
      shelves: shelves.length,
      withId: itemsWithId,
      noId: itemsWithoutId,
      removed: removedItems,
      tracked: _seen.size,
    });
    if (removedItems || removedShelves) {
      appendFileOnlyLog('duplicate.removed', {
        page,
        removed: removedItems,
        shelves: removedShelves,
        tracked: _seen.size,
        items: removedDetail,
      });
    }
  } catch (err) {
    appendFileOnlyLog('duplicate.error', { msg: String(err?.message || err) });
  }
}
