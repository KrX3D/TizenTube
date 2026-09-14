import { configRead } from '../config.js';
import { appendFileOnlyLog, getItemVideoId } from './hideWatched.js';
import { shelfItemArrays } from './duplicateVideoHider.js';

/**
 * Remove the aggregated row the Subscriptions page puts above the real ones.
 *
 * Reported twice from the device: Subscriptions opens with one long row
 * ("Relevanteste" / "Most relevant") holding a dozen videos, and the rows below
 * it hold those same videos again. The duplicate hider then does exactly what
 * it is told — it keeps the FIRST copy — so the aggregate row wins every tie,
 * the rows below empty out, and the emptied-shelf cleanup deletes them. The
 * page collapses into that single long row.
 *
 * The capture shows it plainly: six shelves, twenty videos, seven removed as
 * duplicates, and four entire shelves dropped because everything in them was
 * already in the first two.
 *
 * Matching the title is not an option. It is localized, which is the same
 * reason channelShelfHider identifies its shelves by what they contain, and the
 * capture showed the title is not even in the payload where the shelf
 * diagnostic looks for it.
 *
 * The overlap identifies it without any language. An aggregate row is built
 * from videos that also live in several OTHER rows of the same response, while
 * a per-channel row shares its videos with the aggregate and nothing else. In
 * the capture the first shelf had ten videos, seven of which appeared again
 * across four separate shelves, and each of those shelves overlapped only that
 * one row.
 */

// Only Subscriptions. Home's shelves overlap each other for ordinary reasons,
// and removing a row there would take real recommendations with it.
const PAGE = 'subscriptions';

// A short row is not an aggregate of anything. The capture's per-channel rows
// held one to three videos each; the aggregate held ten.
const MIN_VIDEOS = 4;

// How much of the row has to be repeated elsewhere. Not all of it: the
// aggregate also carries videos from channels whose own row has not loaded yet
// (7 of 10 in the capture).
const MIN_SHARED_RATIO = 0.6;

// And it has to be spread, not merely overlapping one neighbour — two rows
// sharing videos says nothing about which is the aggregate.
const MIN_OTHER_SHELVES = 2;

function shelfVideoIds(shelve) {
  const ids = [];
  try {
    for (const [, holder, key] of shelfItemArrays(shelve)) {
      for (const item of holder[key]) {
        const id = getItemVideoId(item);
        if (id) ids.push(id);
      }
    }
  } catch (_) { }
  return ids;
}

/**
 * Drop the aggregate shelf, if this response has one.
 *
 * Must run BEFORE dedupeShelves: that removes the very repetitions this looks
 * for, so afterwards the evidence is gone.
 *
 * @param {Array} shelves   the section list, mutated in place
 * @param {string} pageName the detected page
 */
export function filterAggregateShelves(shelves, pageName) {
  try {
    if (!Array.isArray(shelves)) return;
    if (!configRead('hideAggregateShelf')) return;
    if (pageName !== PAGE) return;
    // Nothing to compare against, so nothing can be shown to be an aggregate.
    if (shelves.length < MIN_OTHER_SHELVES + 1) return;

    const perShelf = shelves.map(shelfVideoIds);

    // videoId -> the shelves holding it.
    const owners = new Map();
    for (let i = 0; i < perShelf.length; i++) {
      for (const id of perShelf[i]) {
        if (!owners.has(id)) owners.set(id, new Set());
        owners.get(id).add(i);
      }
    }

    const candidates = [];
    for (let i = 0; i < perShelf.length; i++) {
      const ids = perShelf[i];
      if (ids.length < MIN_VIDEOS) continue;
      const others = new Set();
      let shared = 0;
      for (const id of ids) {
        let sharedHere = false;
        for (const j of owners.get(id)) {
          if (j !== i) { others.add(j); sharedHere = true; }
        }
        if (sharedHere) shared++;
      }
      const ratio = shared / ids.length;
      if (ratio >= MIN_SHARED_RATIO && others.size >= MIN_OTHER_SHELVES) {
        candidates.push({ index: i, videos: ids.length, shared, spread: others.size, ratio: Math.round(ratio * 100) / 100 });
      }
    }

    if (!candidates.length) {
      // Logged even when it removes nothing, because "the row is still there"
      // and "the pass never ran" looked identical in the last capture, and the
      // numbers here are what a threshold would have to be tuned against.
      appendFileOnlyLog('aggregateShelf.kept', {
        page: pageName,
        shelves: shelves.length,
        sizes: perShelf.map(ids => ids.length),
      });
      return;
    }

    // At most one per response. An aggregate row is singular by nature, and
    // removing several on a heuristic is how a page ends up blank. Widest
    // spread wins, then the most repeated, then the longest.
    candidates.sort((a, b) => (b.spread - a.spread) || (b.ratio - a.ratio) || (b.videos - a.videos));
    const chosen = candidates[0];

    shelves.splice(chosen.index, 1);
    appendFileOnlyLog('aggregateShelf.removed', {
      page: pageName,
      index: chosen.index,
      videos: chosen.videos,
      shared: chosen.shared,
      spread: chosen.spread,
      ratio: chosen.ratio,
      remaining: shelves.length,
      alsoMatched: candidates.length - 1,
    });
  } catch (err) {
    appendFileOnlyLog('aggregateShelf.error', { msg: String(err?.message || err) });
  }
}
