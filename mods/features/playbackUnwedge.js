import { configRead } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';
import { pickVideo, lastPick } from '../utils/pickVideo.js';

/**
 * playbackUnwedge.js — nudge a player that has stopped with data in hand.
 *
 * There are two different failures that both show YouTube's loading spinner,
 * and conflating them has cost a lot of guessing. Captured on the 5.5 TV, a
 * fortnight apart:
 *
 *   buffer drains to 0.1s, readyState 2, position frozen
 *       nothing is arriving. Nudging a player with no data would do nothing
 *       but make it seek around an empty buffer, so this file leaves it alone.
 *
 *   buffer holds 8.2s, readyState 1, position frozen at 12s for 20+ seconds
 *       the data is there and the player is not advancing through it. This is
 *       the one worth acting on, and until now nothing did: the heartbeat
 *       noticed, said stuck:true twice, and the app had to be restarted by
 *       hand to get playback back.
 *
 * The second is a wedged media pipeline, and the ordinary remedy is to make
 * the player re-examine its own state: ask it to play, and failing that seek a
 * hair forward, which is enough to make MSE re-evaluate the buffer it already
 * holds. Both are what a viewer would do by pressing play or skipping forward,
 * done sooner and without having to restart anything.
 *
 * Deliberately conservative, because acting on a player that is merely slow
 * would be worse than waiting:
 *
 *   - only while something is actually buffered ahead of the playhead
 *   - only when the playhead has not moved across two beats, so roughly twenty
 *     seconds of genuinely stopped rather than one slow moment
 *   - never while paused, seeking, or at rate 0; a stopped player that was
 *     asked to stop is not wedged
 *   - three attempts per video at most, escalating, then it gives up and says
 *     so rather than seeking forever
 */

// How often the state is examined. Matches playbackHealth's beat so the two
// tell the same story about the same moments.
const CHECK_MS = 10000;

// Beats of no movement before anything is done. Two, because the captures show
// the wedge lasting tens of seconds while a single slow beat is common.
const STUCK_BEATS_BEFORE_ACTING = 2;

// Per video. Two now rather than three: a third attempt has never been the one
// that worked, and every attempt costs buffer.
const MAX_ATTEMPTS = 2;

// One jump, and a whole second of it. The first version nudged by 0.1s, which
// was wrong twice over: it lands mid-audio-frame, which drops sound until the
// next sync point, and it cannot cross to the next segment, which is the only
// thing a seek can usefully do about a frame the decoder will not pass.
const SEEK_S = 1;

// Above HAVE_CURRENT_DATA the player has what it needs at the playhead, so a
// seek is not what is missing. See the readyState note in check().
const WEDGED_READY_STATE = 2;

// A buffer that fell by more than this since the last look is draining, which
// is starvation or a recovery in progress rather than a wedge.
const DRAIN_TOLERANCE_S = 1;

let timer = null;
let lastPosition = null;
let lastAhead = null;
let stuckBeats = 0;
let attempts = 0;
let lastVideoId = null;

function enabled() {
    try {
        return configRead('enablePlaybackUnwedge') !== false;
    } catch (_) {
        return true;
    }
}

/** Seconds of data buffered ahead of where the playhead is. */
function bufferedAhead(video) {
    try {
        const at = Number(video.currentTime) || 0;
        const ranges = video.buffered;
        if (!ranges || !ranges.length) return 0;
        for (let i = 0; i < ranges.length; i++) {
            const start = ranges.start(i);
            const end = ranges.end(i);
            if (at >= start - 0.25 && at <= end) return Math.max(0, end - at);
        }
        // The playhead sits in a gap. Anything buffered after it still counts
        // as data in hand — that is exactly the readyState 1 case, where a
        // seek forward is the thing most likely to help.
        for (let i = 0; i < ranges.length; i++) {
            if (ranges.start(i) > at) return Math.max(0, ranges.end(i) - ranges.start(i));
        }
        return 0;
    } catch (_) {
        return 0;
    }
}

/** Where to seek to: into buffered data, never past the end. */
function seekTarget(video, by) {
    const at = Number(video.currentTime) || 0;
    const duration = Number(video.duration);
    let target = at + by;
    try {
        const ranges = video.buffered;
        // Sitting in a gap: go to the start of the next buffered range instead
        // of nudging further into nothing.
        for (let i = 0; i < ranges.length; i++) {
            if (ranges.start(i) > at) {
                target = Math.max(target, ranges.start(i) + 0.05);
                break;
            }
        }
    } catch (_) { }
    if (isFinite(duration) && duration > 0) target = Math.min(target, duration - 0.2);
    return target;
}

function videoKey(video) {
    try {
        return (location.hash || '') + '|' + Math.round(Number(video.duration) || 0);
    } catch (_) {
        return null;
    }
}

// The remaining doubt about the attempt budget, written down rather than
// guessed at: if the app swaps between two elements of the same video, the key
// above does not change, so attempts carry across the swap. That is the
// conservative direction — it cannot act more than twice per video either way
// — and whether the swap happens at all is what the videos count on each line
// is there to answer.


function act(video, attempt, detail) {
    const at = Number(video.currentTime) || 0;
    if (attempt === 1) {
        // The cheapest thing that can work, and the one with no side effect on
        // position if it does.
        try { video.play(); } catch (_) { }
        appendFileOnlyLog('unwedge.play', detail);
        return;
    }
    const target = seekTarget(video, SEEK_S);
    try {
        video.currentTime = target;
        try { video.play(); } catch (_) { }
    } catch (_) { }
    appendFileOnlyLog('unwedge.seek', Object.assign({ from: Math.round(at * 10) / 10, to: Math.round(target * 10) / 10 }, detail));
}

function check() {
    if (!enabled()) return;
    const video = pickVideo();
    if (!video) return;

    // A different video resets everything: attempts are per video, and a
    // position that went backwards because something else loaded is not a
    // wedge.
    const key = videoKey(video);
    if (key !== lastVideoId) {
        lastVideoId = key;
        lastPosition = null;
        lastAhead = null;
        stuckBeats = 0;
        attempts = 0;
    }

    let paused = true;
    let seeking = false;
    let rate = 1;
    let readyState = 0;
    try {
        paused = !!video.paused;
        seeking = !!video.seeking;
        rate = Number(video.playbackRate);
        readyState = Number(video.readyState) || 0;
    } catch (_) { }

    const at = Number(video.currentTime) || 0;
    const moved = lastPosition === null ? null : at - lastPosition;
    lastPosition = at;
    const ahead = bufferedAhead(video);
    const previousAhead = lastAhead;
    lastAhead = ahead;

    // Anything the viewer asked for is not a wedge.
    if (paused || seeking || !(rate > 0)) {
        stuckBeats = 0;
        return;
    }
    if (moved === null || moved > 0.1) {
        stuckBeats = 0;
        return;
    }

    // The playhead went backwards, so something else is driving this player —
    // and it is almost certainly the player recovering on its own. Captured on
    // 19 October: it oscillated 1012 -> 1009 -> 1012 -> 1009 around a frame it
    // could not pass, and because a backwards move satisfies "has not
    // advanced", this file read each swing as a fresh wedge and seeked into
    // the middle of someone else's retry. Standing well back is the only
    // useful thing to do here.
    if (moved < -0.05) {
        stuckBeats = 0;
        // Before concluding the player is retrying, see how many elements
        // there are: a backwards move across two elements is not a move. This
        // branch was written from a capture that is now known to have been
        // exactly that, so the count belongs on the line that justifies it.
        const pick = lastPick();
        // attempts is deliberately NOT cleared here, though it was.
        //
        // The cap is two attempts per video, and clearing it on a backwards
        // move handed that back: a player oscillating around a frame it cannot
        // pass produces a backwards move every few beats, so the counter was
        // reset every few beats and this file could act again, and again, for
        // as long as the loop lasted. The reset was meant to express "a
        // self-recovery is not a wedge", which is what clearing stuckBeats
        // already says. A self-recovery is not a new video either, and only a
        // new video should forgive attempts already spent.
        appendFileOnlyLog('unwedge.selfRecovering', {
            at: Math.round(at * 10) / 10,
            movedSec: Math.round(moved * 10) / 10,
            bufferedAhead: Math.round(ahead * 10) / 10,
            readyState,
            videos: pick.videos,
            videoIndex: pick.videoIndex,
        });
        return;
    }

    if (ahead <= 0.5) {
        // Nothing to play. This is the other failure — the buffer drained —
        // and a seek cannot conjure data. Counted but never acted on, so a
        // capture still shows it was considered.
        stuckBeats = 0;
        appendFileOnlyLog('unwedge.starved', Object.assign({ at: Math.round(at), bufferedAhead: Math.round(ahead * 10) / 10, readyState }, lastPick()));
        return;
    }

    // Draining rather than wedged. In the same capture the buffer went 31.8 ->
    // 8.2 -> 7.8 while the position sat still, and a seek during that took
    // another twenty-three seconds of margin out of a player that was already
    // short of it.
    if (previousAhead !== null && ahead < previousAhead - DRAIN_TOLERANCE_S) {
        stuckBeats = 0;
        appendFileOnlyLog('unwedge.draining', Object.assign({
            at: Math.round(at),
            bufferedAhead: Math.round(ahead * 10) / 10,
            wasAhead: Math.round(previousAhead * 10) / 10,
            readyState,
        }, lastPick()));
        return;
    }

    // The discriminator between the two captures, and the reason this file
    // exists at all:
    //
    //   18 Oct  readyState 1, 8.2s buffered, frozen past twenty seconds, and
    //           only an app restart cleared it. The player did not have data
    //           at the playhead although it held plenty just past it, which is
    //           what a seek is actually for.
    //
    //   19 Oct  readyState 4, buffer healthy, looping over one frame. The
    //           player had everything it needed at that position and still
    //           could not pass it, so the fault is in decoding that frame and
    //           no seek of any size addresses it. Nudging only cost buffer and
    //           dropped the sound.
    //
    // So acting is limited to the first shape.
    if (readyState >= WEDGED_READY_STATE) {
        stuckBeats = 0;
        appendFileOnlyLog('unwedge.hasDataButStuck', Object.assign({
            at: Math.round(at),
            bufferedAhead: Math.round(ahead * 10) / 10,
            readyState,
        }, lastPick()));
        return;
    }

    stuckBeats++;
    if (stuckBeats < STUCK_BEATS_BEFORE_ACTING) return;

    if (attempts >= MAX_ATTEMPTS) {
        if (attempts === MAX_ATTEMPTS) {
            attempts++;
            appendFileOnlyLog('unwedge.gaveUp', {
                at: Math.round(at),
                bufferedAhead: Math.round(ahead * 10) / 10,
                readyState,
                attempts: MAX_ATTEMPTS,
            });
        }
        return;
    }

    attempts++;
    act(video, attempts, Object.assign({
        at: Math.round(at * 10) / 10,
        bufferedAhead: Math.round(ahead * 10) / 10,
        readyState,
        stuckBeats,
        attempt: attempts,
    }, lastPick()));
}

if (!window.__ttPlaybackUnwedgeStarted) {
    window.__ttPlaybackUnwedgeStarted = true;
    try {
        timer = setInterval(check, CHECK_MS);
        if (typeof timer.unref === 'function') timer.unref();
    } catch (_) { }
}

export { bufferedAhead, seekTarget, check };
