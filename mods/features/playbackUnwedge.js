import { configRead } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';

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

// Per video. Each one is a bigger push than the last, and after the third the
// problem is not one a nudge can fix.
const MAX_ATTEMPTS = 3;

// How far the seeks jump. The first is the smallest move that still counts as
// a seek; the second is far enough to clear a bad segment boundary.
const SMALL_SEEK_S = 0.1;
const LARGER_SEEK_S = 0.5;

let timer = null;
let lastPosition = null;
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

/** The element actually playing, which is not always the first one. */
function pickVideo() {
    try {
        const videos = document.querySelectorAll('video');
        for (let i = 0; i < videos.length; i++) {
            const video = videos[i];
            if (video && !video.paused && isFinite(video.duration) && video.duration > 0) return video;
        }
        return videos[0] || null;
    } catch (_) {
        return null;
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

function act(video, attempt, detail) {
    const at = Number(video.currentTime) || 0;
    if (attempt === 1) {
        // The cheapest thing that can work, and the one with no side effect on
        // position if it does.
        try { video.play(); } catch (_) { }
        appendFileOnlyLog('unwedge.play', detail);
        return;
    }
    const by = attempt === 2 ? SMALL_SEEK_S : LARGER_SEEK_S;
    const target = seekTarget(video, by);
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

    // Anything the viewer asked for is not a wedge.
    if (paused || seeking || !(rate > 0)) {
        stuckBeats = 0;
        return;
    }
    if (moved === null || moved > 0.1) {
        stuckBeats = 0;
        return;
    }

    const ahead = bufferedAhead(video);
    if (ahead <= 0.5) {
        // Nothing to play. This is the other failure — the buffer drained —
        // and a seek cannot conjure data. Counted but never acted on, so a
        // capture still shows it was considered.
        stuckBeats = 0;
        appendFileOnlyLog('unwedge.starved', { at: Math.round(at), bufferedAhead: Math.round(ahead * 10) / 10, readyState });
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
    act(video, attempts, {
        at: Math.round(at * 10) / 10,
        bufferedAhead: Math.round(ahead * 10) / 10,
        readyState,
        stuckBeats,
        attempt: attempts,
    });
}

if (!window.__ttPlaybackUnwedgeStarted) {
    window.__ttPlaybackUnwedgeStarted = true;
    try {
        timer = setInterval(check, CHECK_MS);
        if (typeof timer.unref === 'function') timer.unref();
    } catch (_) { }
}

export { bufferedAhead, seekTarget, check };
