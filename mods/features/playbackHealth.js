import { configRead } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';

/**
 * playbackHealth.js — why the spinner appeared.
 *
 * Reported: a lot of buffering lately, "but the log also doesn't say anything
 * about it". That was exactly right, and it is this file's reason for
 * existing: every response and every tile is logged in detail, and the player
 * itself was never instrumented at all. So a stall left no trace, and there
 * was no way to tell a slow network from this fork's own code getting in the
 * way — which, with every log category switched on, is a fair question.
 *
 * Two things are recorded, because the interesting part is how they line up.
 *
 * The player's own account. `waiting` is the event behind the spinner, and the
 * one that follows it says how long it lasted. Each stall carries how much
 * video was buffered ahead of the playhead, which is the difference between
 * "the network could not keep up" (nothing buffered) and "something else
 * stopped the pipeline" (seconds buffered and still waiting).
 *
 * This fork's own cost. adblock.js's JSON.parse override walks every response
 * this app receives, and several features walk every tile inside it. That work
 * happens on the same thread the player runs on, so if it is heavy enough to
 * matter it will show as milliseconds spent close to a stall. Measured here
 * rather than guessed at.
 *
 * Deliberately event-driven: no polling, no timers, and nothing at all is
 * recorded while the setting is off, so the diagnostic cannot become the
 * problem it is meant to measure.
 */

// Enough to see a pattern; past this the summary is the useful part.
const MAX_STALLS_LOGGED = 25;

// A gap this short is a frame hiccup, not a spinner the user would notice.
const MIN_STALL_MS = 250;

let video = null;
let attachRetry = null;

let stallStartedAt = 0;
let stallPosition = 0;
let stalls = 0;
let stalledMs = 0;
let logged = 0;

// Filled in by adblock.js's parse override, read when a stall is reported.
let parseMs = 0;
let parseCount = 0;
let parseWorstMs = 0;

function enabled() {
    try {
        return configRead('enablePlaybackDiagnostics') === true;
    } catch (e) {
        return false;
    }
}

/**
 * How long this fork spent parsing a response, in milliseconds.
 *
 * Called from adblock.js for every response, so it does nothing but add when
 * the setting is off — the measuring itself happens there, where the work is.
 */
export function noteParseCost(ms) {
    if (!(ms > 0)) return;
    parseMs += ms;
    parseCount++;
    if (ms > parseWorstMs) parseWorstMs = ms;
}

/** True when this fork's parse cost is worth measuring at all. */
export function playbackDiagnosticsEnabled() {
    return enabled();
}

/** Seconds of video sitting ready after the playhead. */
function bufferedAhead(el) {
    try {
        const ranges = el.buffered;
        if (!ranges || !ranges.length) return 0;
        for (let i = 0; i < ranges.length; i++) {
            if (el.currentTime >= ranges.start(i) - 0.5 && el.currentTime <= ranges.end(i)) {
                return Math.max(0, Math.round((ranges.end(i) - el.currentTime) * 10) / 10);
            }
        }
        return 0;
    } catch (e) {
        return -1;
    }
}

function snapshot(el) {
    const out = {
        at: Math.round(el.currentTime || 0),
        bufferedAhead: bufferedAhead(el),
        readyState: el.readyState,
        rate: el.playbackRate,
    };
    // Cobalt exposes decoder counters on some builds; dropped frames are the
    // difference between a network problem and a decode one.
    try {
        if (typeof el.webkitDroppedFrameCount === 'number') out.droppedFrames = el.webkitDroppedFrameCount;
    } catch (e) { }
    try {
        if (el.getVideoPlaybackQuality) {
            const q = el.getVideoPlaybackQuality();
            if (q && typeof q.droppedVideoFrames === 'number') out.droppedFrames = q.droppedVideoFrames;
        }
    } catch (e) { }
    return out;
}

/** What this fork has cost since the last stall, and reset for the next. */
function takeParseCost() {
    const cost = { parseMs: Math.round(parseMs), parses: parseCount, worstParseMs: Math.round(parseWorstMs) };
    parseMs = 0;
    parseCount = 0;
    parseWorstMs = 0;
    return cost;
}

function onWaiting() {
    if (!video || stallStartedAt) return;
    stallStartedAt = Date.now();
    stallPosition = video.currentTime || 0;
}

function onResumed() {
    if (!video || !stallStartedAt) return;
    const lasted = Date.now() - stallStartedAt;
    stallStartedAt = 0;
    if (lasted < MIN_STALL_MS) return;

    stalls++;
    stalledMs += lasted;
    if (logged >= MAX_STALLS_LOGGED) return;
    logged++;
    // The snapshot carries an `at` of its own, taken now; these four are the
    // stall's own account and must survive the merge, so they go last. The
    // other way round, `at` read as the position the stall ENDED at, which is
    // the one thing it must not say.
    appendFileOnlyLog('player.stall', Object.assign(snapshot(video), takeParseCost(), {
        lastedMs: lasted,
        at: Math.round(stallPosition),
        // Whether the playhead moved: a stall that ends somewhere else is a
        // seek, and seeks are not the reported problem.
        resumedAt: Math.round(video.currentTime || 0),
        stall: stalls,
    }));
}

function onStalled() {
    if (!video || !enabled()) return;
    appendFileOnlyLog('player.stalledEvent', Object.assign(snapshot(video), takeParseCost()));
}

function onError() {
    if (!video) return;
    let code = null;
    try { code = video.error && video.error.code; } catch (e) { }
    appendFileOnlyLog('player.mediaError', Object.assign({ code }, snapshot(video)));
}

/** One line per video, which is the one worth reading first. */
function reportSummary(reason) {
    if (!stalls) return;
    appendFileOnlyLog('player.stallSummary', {
        reason,
        stalls,
        stalledMs,
        // The share of watching spent waiting, which is what "a lot of
        // buffering" means in a number.
        watchedSec: video ? Math.round(video.currentTime || 0) : null,
    });
    stalls = 0;
    stalledMs = 0;
    logged = 0;
}

function detach(reason) {
    clearTimeout(attachRetry);
    attachRetry = null;
    if (video) {
        reportSummary(reason || 'left');
        video.removeEventListener('waiting', onWaiting);
        video.removeEventListener('playing', onResumed);
        video.removeEventListener('seeked', onResumed);
        video.removeEventListener('stalled', onStalled);
        video.removeEventListener('error', onError);
        video.removeEventListener('ended', onEnded);
    }
    video = null;
    stallStartedAt = 0;
}

function onEnded() {
    reportSummary('ended');
}

function attach() {
    detach('navigated');
    if (!enabled()) return;

    video = document.querySelector('video');
    if (!video) {
        attachRetry = setTimeout(attach, 500);
        return;
    }

    stalls = 0;
    stalledMs = 0;
    logged = 0;
    takeParseCost();

    video.addEventListener('waiting', onWaiting);
    // Either of these ends a wait. 'seeked' is here because a seek also clears
    // it, and leaving the stall open would charge the next one with this one's
    // time.
    video.addEventListener('playing', onResumed);
    video.addEventListener('seeked', onResumed);
    video.addEventListener('stalled', onStalled);
    video.addEventListener('error', onError);
    video.addEventListener('ended', onEnded);
}

window.addEventListener('hashchange', attach, false);
attach();
