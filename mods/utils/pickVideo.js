/**
 * pickVideo.js — which <video> is the one playing, and say which it was.
 *
 * Two files had their own copy of this and the copies did not agree: one
 * required readyState > 0 and had a fallback chain, the other took the first
 * element that was not paused and otherwise took element zero. So the
 * heartbeat and the stall recovery could be describing different elements
 * while appearing to describe the same player, and neither line said which one
 * it had read.
 *
 * That cost a real diagnosis. From the 20 October capture, after a video was
 * resumed following a long pause:
 *
 *   17:07:26  at 1105, buffered 5.1, readyState 4
 *   17:07:56  at 1107, buffered 7.9, readyState 3
 *   17:08:07  at 1105, buffered 5.1, readyState 4
 *   17:08:19  at 1107, buffered 7.9, readyState 3
 *   17:08:36  at 1105, buffered 4.4, readyState 3
 *
 * which reads as a playhead swinging backwards and forwards over two seconds,
 * and was read that way: playbackUnwedge's selfRecovering branch exists
 * because of an earlier capture of exactly this shape, on the reasoning that
 * the player must be retrying a frame it could not pass. But a single playing
 * element does not return to exactly 7.9 seconds buffered and then exactly 5.1
 * again. Two stalled elements sampled alternately do, and the app had rebuilt
 * its player moments earlier — there is a line in the middle of that run
 * showing an element at position 0 with nothing buffered and readyState 1,
 * which is a third one still being set up.
 *
 * So the alternation was never a playhead moving. It was this function,
 * picking a different element from one beat to the next, in two files that
 * picked differently from each other.
 *
 * One implementation now, and every line it informs can say how many elements
 * there were and which one it read.
 */

let lastCount = 0;
let lastIndex = -1;
let lastHow = null;
let lastTag = 0;

// A number stamped on each element the first time it is picked, so two beats
// can be told apart.
//
// The count and the index were not enough, and a capture from 21 October shows
// why. Alternate beats reported, both with videos:1 and videoIndex:0:
//
//   at 1925, buffered 5.5, readyState 4
//   at 0,    buffered 0,   readyState 0, movedSec -1924.9
//
// One element cannot do that. What the app does is tear the player down and
// build another, so at any instant there is exactly one — and "one element"
// read as "the same element" because nothing distinguished them. A stamp does.
let nextTag = 0;

function tagOf(el) {
    try {
        if (!el.__ttVideoTag) el.__ttVideoTag = ++nextTag;
        return el.__ttVideoTag;
    } catch (_) {
        return 0;
    }
}

/**
 * The element actually playing.
 *
 * Preferences, in order: one that is not paused and has data, one that at
 * least has a duration, then whatever is first. The app rebuilds the player
 * without a hashchange, so a reference captured once goes stale and starts
 * describing an element nothing is playing on — which is worse for a
 * diagnostic than for a readout, because it does not look broken, it looks
 * like evidence.
 */
export function pickVideo() {
    lastCount = 0;
    lastIndex = -1;
    lastHow = null;
    lastTag = 0;
    let fallback = null;
    let fallbackIndex = -1;
    let fallbackHow = null;
    try {
        const all = document.querySelectorAll('video');
        lastCount = all.length;
        for (let i = 0; i < all.length; i++) {
            const el = all[i];
            if (!el) continue;
            const usable = isFinite(el.duration) && el.duration > 0;
            if (usable && !el.paused && el.readyState > 0) {
                lastIndex = i;
                lastHow = 'playing';
                lastTag = tagOf(el);
                return el;
            }
            if (usable && fallbackHow !== 'hasDuration') {
                fallback = el;
                fallbackIndex = i;
                fallbackHow = 'hasDuration';
            } else if (!fallback) {
                fallback = el;
                fallbackIndex = i;
                fallbackHow = 'first';
            }
        }
    } catch (_) { }
    lastIndex = fallbackIndex;
    lastHow = fallbackHow;
    lastTag = fallback ? tagOf(fallback) : 0;
    return fallback;
}

/**
 * How many elements the last pick saw, which one it took, and on what grounds.
 *
 * Goes on every line that reports player state. Two elements where one was
 * expected is the difference between a player that is stuck and a diagnostic
 * that is confused, and until now there was no way to tell those apart after
 * the fact.
 */
export function lastPick() {
    // videoTag is the one that answers "is this the same player as last beat".
    // videos and videoIndex answer "how many are there", which is a different
    // question and the one that misled two readings of this.
    return { videos: lastCount, videoIndex: lastIndex, picked: lastHow, videoTag: lastTag };
}
