import { configRead } from '../config.js';
import { appendFileOnlyLog, getItemVideoId, consolidationApplies } from './hideWatched.js';
import { shelfItemArrays } from './duplicateVideoHider.js';

/**
 * Remove the aggregated row the Subscriptions page puts above the real ones.
 *
 * Mostly of historical interest now. consolidateShelves does this better: it
 * pools the videos out of every shelf, drops the duplicates and rebuilds the
 * page as normal rows, so the aggregated row stops existing without anything
 * being thrown away. This file deletes the row and everything in it that lives
 * nowhere else, which on the 29 October capture would have been five of
 * fifteen videos.
 *
 * Worse, it runs first -- processShelves is called immediately before
 * consolidateShelves on the same contents -- so those videos are gone before
 * consolidation can pool them. Deleting a row to fix its width, when the next
 * pass is about to rebuild every row anyway, is all cost.
 *
 * So it stands down whenever consolidation is going to run, which on
 * Subscriptions is whenever hiding watched videos is on. It still does its
 * original job when consolidation is switched off: without it the duplicate
 * hider keeps the aggregated row's copy of each video, empties the per-channel
 * rows, and the emptied-shelf cleanup then deletes them, collapsing the page
 * into the one long row. That is what this was written for and it is still the
 * only thing standing between that page and that outcome.
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

// How much of the overlap that COULD exist has to exist.
//
// This used to be measured against the aggregate row's own length, and that
// was backwards: it penalised the row for being long, which is the whole
// complaint. From the 29 October capture, with the row still on screen:
//
//   sizes [10, 3, 1, 1]
//
// Ten videos in the aggregate and five in every other row put together. Even
// if all five were repeats of it — the worst case there is — that is 5/10 =
// 0.50, and the threshold is 0.60. No arrangement of those four rows could
// have reached it, so the pass could not fire however it was configured. The
// same shape appears twice more in the log, both kept: [8,1,2,1,2,1] and
// [6,2,1,1,1].
//
// The denominator is now what could possibly overlap: min(this row, every
// other row combined). An aggregate row whose channels have only loaded a
// video or two each then reads as fully overlapping, which is what it is,
// instead of as barely overlapping because it is long.
//
// The ratio is kept as a sanity check rather than as the real test. What
// actually identifies an aggregate is MIN_OTHER_SHELVES below: a per-channel
// row shares its videos with the aggregate and nothing else, so only the
// aggregate is spread across two or more others. That part needs no tuning.
const MIN_SHARED_RATIO = 0.6;

// And it has to be spread, not merely overlapping one neighbour — two rows
// sharing videos says nothing about which is the aggregate.
const MIN_OTHER_SHELVES = 2;

// Which page this last stood down for, so the line above is logged on a change
// of answer instead of on every response.
let _lastStandDown = null;

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
    // Consolidation is about to pool every shelf's videos and repack them, so
    // removing a row here would only delete the ones it alone holds. Said once
    // per change of answer rather than once per response.
    if (consolidationApplies(pageName)) {
      if (_lastStandDown !== pageName) {
        _lastStandDown = pageName;
        appendFileOnlyLog('aggregateShelf.standDown', {
          page: pageName,
          reason: 'consolidateShelves rebuilds these rows and keeps every video',
        });
      }
      return;
    }
    _lastStandDown = null;
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
    // Every row long enough to be an aggregate, whether or not it qualified.
    // The old kept-line recorded only row sizes, so a run that left the row on
    // screen could not be told from one where the numbers were nearly right,
    // and there was nothing to tune against. These are those numbers.
    const nearMisses = [];
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
      // The most that could overlap: this row cannot share more videos than
      // the other rows hold between them.
      let otherTotal = 0;
      for (let j = 0; j < perShelf.length; j++) {
        if (j !== i) otherTotal += perShelf[j].length;
      }
      const available = Math.min(ids.length, otherTotal);
      const ratio = available > 0 ? shared / available : 0;
      const entry = {
        index: i, videos: ids.length, shared, spread: others.size,
        available, ratio: Math.round(ratio * 100) / 100,
      };
      if (ratio >= MIN_SHARED_RATIO && others.size >= MIN_OTHER_SHELVES) {
        candidates.push(entry);
      } else {
        nearMisses.push(entry);
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
        // Empty means no row was even long enough to consider, which is the
        // ordinary Subscriptions page and not a failure. Entries mean a row
        // was considered and rejected, and say by how much.
        nearMiss: nearMisses,
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
