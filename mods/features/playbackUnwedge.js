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

// Above HAVE_CURRENT_DATA the player says it has what it needs at the
// playhead.
//
// It no longer buys a longer wait — see FROZEN_BEATS_BEFORE_ACTING below for
// why that was retired — and is kept because the claim is still worth knowing
// about while waiting: a player frozen while insisting it has the frame is the
// shape this file exists for, and it is the one worth a line of its own.
const WEDGED_READY_STATE = 2;

// Beats of perfect stillness before acting on a player that claims to have
// data at the playhead.
//
// Five was too many, and the 5.5 TV's own log is unambiguous about it. Every
// stuck run it has ever recorded:
//
//   16 runs reached stillForSec 10
//    6 runs reached stillForSec 20
//    0 runs reached 30, 40 or 50
//
// against actsAfterSec 50 on every line. So for this shape the threshold was
// never once reached and this file could not act at all. What ends the runs
// instead is the app replacing the player — six different elements in one
// session, each new one appearing ten to twenty seconds after the last froze,
// which is the reload a viewer sees and reports as the freeze.
//
// Two beats now, the same as a player that admits it has no data, which
// retires the special case rather than retuning it. The case was added on the
// 19 October capture, where a player oscillated around a frame it could not
// decode and a seek cost it buffer and sound — but oscillation means the
// playhead moved, and a backwards move is caught by the self-recovery branch
// above, which has since been seen to fire correctly on a move of 0.9
// seconds. The extra three beats were belt over braces, and the cost of them
// was never acting.
//
// Twenty seconds is also a defensible floor on its own terms: a playing,
// unpaused, rate-1 element with seconds of data buffered advances about ten
// seconds per beat, so two beats of not moving at all is not a state that
// happens for any good reason. And the first attempt is a bare play(), which
// cannot cost a player anything.
const FROZEN_BEATS_BEFORE_ACTING = 2;

// A buffer that fell by more than this since the last look is draining, which
// is starvation or a recovery in progress rather than a wedge.
const DRAIN_TOLERANCE_S = 1;

// Beats between reports while the buffer is empty. A starvation that lasts ten
// minutes should not cost sixty identical lines when the only thing changing
// is how long it has been going.
const STARVED_LOG_EVERY = 6;

// The same rate for the empty element, and for the same reason: the lines are
// byte-for-byte identical, so forty of them say exactly what one says.
const EMPTY_LOG_EVERY = 6;

let timer = null;
let lastPosition = null;
let lastAhead = null;
let stuckBeats = 0;
let starvedBeats = 0;
let emptyBeats = 0;
let lastTagSeen = 0;
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
    // The app replacing the player, which is what the reports call a reload.
    //
    // Logged because it is the thing to measure: the runs above ended this way
    // rather than by recovering, so if acting two beats in prevents a reload,
    // this line is where that shows up — and if it does not, the stuck
    // duration here says how much sooner it would have had to be.
    const pick = lastPick();
    if (pick.videoTag && lastTagSeen && pick.videoTag !== lastTagSeen) {
        appendFileOnlyLog('unwedge.playerReplaced', {
            was: lastTagSeen,
            now: pick.videoTag,
            stuckForSec: stuckBeats * (CHECK_MS / 1000),
            attempts,
            at: Math.round(Number(video.currentTime) || 0),
        });
    }
    if (pick.videoTag) lastTagSeen = pick.videoTag;

    const key = videoKey(video);
    if (key !== lastVideoId) {
        lastVideoId = key;
        lastPosition = null;
        lastAhead = null;
        stuckBeats = 0;
        starvedBeats = 0;
        emptyBeats = 0;
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
    const previousPosition = lastPosition;
    lastPosition = at;
    const ahead = bufferedAhead(video);
    const previousAhead = lastAhead;
    lastAhead = ahead;

    // Data arrived again after a spell with none. Reported here rather than in
    // the starved branch below, because a player that recovers starts moving
    // and a moving player returns before ever reaching it — which is why the
    // first capture of this showed a starvation beginning and never ending.
    if (starvedBeats && ahead > 0.5) {
        appendFileOnlyLog('unwedge.starvedEnded', Object.assign({
            at: Math.round(at),
            bufferedAhead: Math.round(ahead * 10) / 10,
            starvedForSec: starvedBeats * (CHECK_MS / 1000),
            readyState,
        }, lastPick()));
        starvedBeats = 0;
    }

    // An element with nothing in it says nothing, so it is stepped over
    // without touching a single counter.
    //
    // Captured 21 October on the 5.5 TV, alternating with the real player beat
    // by beat:
    //
    //   at 1925, buffered 5.5, readyState 4   the player, stuck
    //   at 0,    buffered 0,   readyState 0   this
    //
    // The second was read as the playhead moving back 1924.9 seconds, which
    // satisfied the self-recovery branch below, which cleared stuckBeats. So
    // the count restarted every other beat and never reached the five needed
    // to act: stillForSec went 10, 10, 10, 20, 10 while the viewer waited, and
    // the app had to be restarted by hand. A recovery disarmed by a phantom is
    // worse than no recovery, because it looks like one.
    //
    // Nothing is reset here deliberately. Clearing stuckBeats is what the old
    // path did wrong; this beat simply did not happen.
    if (readyState === 0 && ahead <= 0.5 && at < 1) {
        emptyBeats++;
        // Once, then once a minute. Sitting on a page with nothing playing is
        // the ordinary state of this element, and the first capture of it ran
        // to forty-three identical lines — same position, same readyState,
        // same tag, nothing changing. One says all of it.
        if (emptyBeats === 1 || emptyBeats % EMPTY_LOG_EVERY === 0) {
            appendFileOnlyLog('unwedge.emptyElement', Object.assign({
                at: Math.round(at),
                movedSec: moved === null ? null : Math.round(moved * 10) / 10,
                readyState,
                stillForSec: stuckBeats * (CHECK_MS / 1000),
                emptyForSec: emptyBeats * (CHECK_MS / 1000),
            }, lastPick()));
        }
        // The position is not recorded either: comparing the real player's
        // next beat against this one is how the phantom move was invented.
        lastPosition = previousPosition;
        lastAhead = previousAhead;
        return;
    }

    // Past the empty-element check, so there is something real here: the next
    // run of empty beats is a new one and counts from the beginning.
    emptyBeats = 0;

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
        // and a seek cannot conjure data, so this file does not act on it.
        //
        // Captured on the 6.5 TV, 21 October: a video that had been playing
        // perfectly with 76 seconds buffered went 76.5 -> 36 -> 0 across two
        // beats and froze at 153 seconds with an empty buffer and readyState
        // 2. Nothing was wrong with the player; the data stopped arriving.
        //
        // What the capture could not say is whether that ever ends. This
        // branch logged an identical line every ten seconds with no duration
        // on it and no closing line, so a starvation that recovered after a
        // minute and one that lasted until the app was killed by hand read
        // exactly the same.
        stuckBeats = 0;
        starvedBeats++;
        if (starvedBeats === 1 || starvedBeats % STARVED_LOG_EVERY === 0) {
            appendFileOnlyLog('unwedge.starved', Object.assign({
                at: Math.round(at),
                bufferedAhead: Math.round(ahead * 10) / 10,
                readyState,
                starvedForSec: starvedBeats * (CHECK_MS / 1000),
            }, lastPick()));
        }
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

    stuckBeats++;

    // How long to wait. Both answers are two beats now, and the pair is kept
    // apart rather than collapsed so each can be moved on its own evidence —
    // the readyState >= 2 one has been moved once already.
    //
    // The history is worth keeping, because the reasoning went wrong twice in
    // opposite directions. Three captures, and the readyState alone does not
    // separate them:
    //
    //   18 Oct  readyState 1, 8.2s buffered, frozen past twenty seconds, and
    //           only an app restart cleared it. The player did not have data
    //           at the playhead although it held plenty just past it, which is
    //           what a seek is actually for.
    //
    //   19 Oct  readyState 4, buffer healthy, oscillating around one frame it
    //           could not pass. Everything needed was at that position, so no
    //           seek addresses it; nudging only cost buffer and dropped sound.
    //
    //   20 Oct  readyState 3, 7s buffered, position identical across thirteen
    //           consecutive beats — over two minutes, ended by hand.
    //
    // The guard written after the second of those stood this file down at
    // readyState >= 2 outright, which meant it could only ever act on the
    // first. The third is the shape it exists for and it logged
    // hasDataButStuck at it, unchanged, every ten seconds for two minutes.
    //
    // What actually separates the second from the third is not readyState but
    // movement: the oscillation moved, including backwards, and a backwards
    // move already stands this file down a few lines above. A wedge does not
    // move at all.
    //
    // So the guard became a longer wait instead of a pass — and a fifty second
    // one, which the 5.5 TV then showed was no better than the pass had been,
    // since no run it ever recorded lasted that long.
    const needed = readyState >= WEDGED_READY_STATE
        ? FROZEN_BEATS_BEFORE_ACTING
        : STUCK_BEATS_BEFORE_ACTING;

    if (stuckBeats < needed) {
        // Only the claiming-data case is worth a line while waiting: the other
        // reaches its threshold in two beats and would say nothing new.
        if (readyState >= WEDGED_READY_STATE) {
            appendFileOnlyLog('unwedge.hasDataButStuck', Object.assign({
                at: Math.round(at),
                bufferedAhead: Math.round(ahead * 10) / 10,
                readyState,
                stillForSec: stuckBeats * (CHECK_MS / 1000),
                actsAfterSec: needed * (CHECK_MS / 1000),
            }, lastPick()));
        }
        return;
    }

    if (attempts >= MAX_ATTEMPTS) {
        if (attempts === MAX_ATTEMPTS) {
            attempts++;
            appendFileOnlyLog('unwedge.gaveUp', Object.assign({
                at: Math.round(at),
                bufferedAhead: Math.round(ahead * 10) / 10,
                readyState,
                attempts: MAX_ATTEMPTS,
                stillForSec: stuckBeats * (CHECK_MS / 1000),
            }, lastPick()));
        }
        return;
    }

    attempts++;
    act(video, attempts, Object.assign({
        at: Math.round(at * 10) / 10,
        bufferedAhead: Math.round(ahead * 10) / 10,
        readyState,
        stuckBeats,
        stillForSec: stuckBeats * (CHECK_MS / 1000),
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
