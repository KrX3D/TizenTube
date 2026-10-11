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

// The furthest the playhead was seen to reach.
//
// The summary read video.currentTime at teardown and reported watchedSec 0 on
// video after video, including one where the heartbeat had said 6519 seconds a
// moment earlier: by the time the page navigates, the element has been reset.
// A diagnostic that reports zero for a video somebody watched for an hour is
// not a small blemish — every figure beside it becomes suspect.
let furthestPosition = 0;

// Reported: a video took far longer than usual to start, showed black, and
// then played at 360p until it was changed by hand. Neither the delay nor the
// resolution was anywhere in the log, so neither could be confirmed, let alone
// explained. Both are recorded now.
let startedWatchingAt = 0;
let firstPlayingMs = 0;
let qualities = [];

// The hang, and why nothing was recorded during it.
//
// Captured: a video wedged for eleven minutes with not one line logged, then a
// summary the instant the page was navigated away from — three stalls, 29s
// stalled, and currentTime back at 0 after having reached 13s. So the player
// emitted nothing at all for those eleven minutes: a player that is buffering
// fires waiting and stalled, one that is wedged fires neither. No parses
// either, so nothing was arriving to parse.
//
// What that cannot say is whether the page's own code was alive and idle or
// had stopped running, and those are different faults with different fixes.
// Silence answers neither. A beat does: if it keeps arriving through a hang,
// the page is alive and the media pipeline is stuck, and each beat says what
// the player was doing; if the beats stop too, the page or the CDP drain that
// carries them died.
//
// One line a minute while a video is playing normally, and one every beat
// while the playhead is not moving — which is the case worth watching.
const BEAT_MS = 10000;
const QUIET_BEATS = 6;
let beatTimer = null;
let lastBeatPosition = 0;
let beatsSinceLine = 0;
let stalls = 0;
let stalledMs = 0;
let logged = 0;

// Filled in by adblock.js's parse override, read when a stall is reported.
let parseMs = 0;
let parseCount = 0;
let parseWorstMs = 0;

// A second set for the heartbeat. One set read by both would have the beat
// empty the figures a stall was about to report, and the other way round —
// each reader resets what it reads, so each needs its own.
let beatParseMs = 0;
let beatParses = 0;

// A single response taking this long is worth a line of its own.
//
// A capture showed one at 484ms, inside a 3.6s stall: half a second of the
// thread the player runs on, spent in one response. The aggregate said that
// much but could not say WHICH response, so there was nothing to act on. This
// is the missing half.
const SLOW_PARSE_MS = 120;
const MAX_SLOW_PARSE_LINES = 20;
let slowParseLines = 0;

// What the filters did during the parse being measured, so a slow one can be
// attributed rather than guessed at.
const work = {};

/** Counted by whichever filter did the walking; reset per parse. */
export function noteFilterWork(name, howMany) {
    if (!enabled()) return;
    work[name] = (work[name] || 0) + (howMany > 0 ? howMany : 1);
}

function takeWork() {
    const out = {};
    for (const name of Object.keys(work)) {
        out[name] = work[name];
        delete work[name];
    }
    return out;
}

/**
 * One response that cost more than it should have.
 *
 * The page it was for and its top-level keys are enough to recognise it, and
 * the filter counts say which of this fork's walkers was in it. No values: a
 * response carries a person's own feed.
 */
export function noteParseShape(ms, detectedPage, response) {
    if (!enabled()) {
        takeWork();
        return;
    }
    if (ms < SLOW_PARSE_MS) {
        takeWork();
        return;
    }
    if (slowParseLines >= MAX_SLOW_PARSE_LINES) {
        takeWork();
        return;
    }
    slowParseLines++;
    let keys = [];
    let items = null;
    try {
        if (Array.isArray(response)) {
            keys = ['[' + response.length + ']'];
        } else if (response && typeof response === 'object') {
            keys = Object.keys(response).slice(0, 12);
        }
    } catch (e) { }
    try {
        // The number of things the walkers had to walk, which is the figure
        // that explains a slow parse more often than anything else.
        items = work.tiles || null;
    } catch (e) { }
    // player., not parse.: the prefix picks the log category, parse.* belongs
    // to nav, and this is read next to the stalls. Named parse.slow it would
    // be filtered out by the very narrowing that was done to watch playback.
    appendFileOnlyLog('player.slowParse', Object.assign({
        ms: Math.round(ms),
        page: detectedPage || null,
        keys,
        items,
    }, takeWork()));
}

/**
 * The element that is playing, which is not always the one bound at attach.
 *
 * The same fault the remaining-time readout had: the app rebuilds the player
 * without a hashchange, and a captured reference then reports on an element
 * nothing is playing on. For a diagnostic that is worse than for a readout —
 * it does not look broken, it looks like evidence.
 *
 * Also prefers the element that is actually playing when a page carries more
 * than one, since a watch page can have an inline-preview video besides the
 * player.
 */
function pickVideo() {
    let fallback = null;
    try {
        const all = document.querySelectorAll('video');
        for (let i = 0; i < all.length; i++) {
            const el = all[i];
            if (!el) continue;
            const usable = isFinite(el.duration) && el.duration > 0;
            if (usable && !el.paused && el.readyState > 0) return el;
            if (usable && !fallback) fallback = el;
            if (!fallback) fallback = el;
        }
    } catch (e) { }
    if (fallback) return fallback;
    try { return document.querySelector('video'); } catch (e) { return null; }
}

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
    beatParseMs += ms;
    beatParses++;
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
    const now = el.currentTime || 0;
    if (now > furthestPosition) furthestPosition = now;
    const out = {
        at: Math.round(now),
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
    if (video.currentTime > furthestPosition) furthestPosition = video.currentTime;
    stallStartedAt = Date.now();
    stallPosition = video.currentTime || 0;
}

/** The frame size the player settled on, as it changes. */
function onQuality() {
    if (!video || !enabled()) return;
    const height = video.videoHeight || 0;
    const width = video.videoWidth || 0;
    if (!height) return;
    const label = width + 'x' + height;
    if (qualities.length && qualities[qualities.length - 1] === label) return;
    qualities.push(label);
    appendFileOnlyLog('player.quality', {
        size: label,
        // Which change this is: the first is what the player chose on its own,
        // and that is the one worth knowing when it chose badly.
        change: qualities.length,
        at: Math.round(video.currentTime || 0),
        sinceStartMs: startedWatchingAt ? Date.now() - startedWatchingAt : null,
    });
}

function onPlaying() {
    if (video && enabled() && !firstPlayingMs && startedWatchingAt) {
        firstPlayingMs = Date.now() - startedWatchingAt;
        appendFileOnlyLog('player.firstFrame', {
            // "Took longer than normal", as a number.
            tookMs: firstPlayingMs,
            size: (video.videoWidth || 0) + 'x' + (video.videoHeight || 0),
            bufferedAhead: bufferedAhead(video),
        });
    }
    onResumed();
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
        // Everything about this video in one line: how long it took to start,
        // and every frame size it went through.
        firstFrameMs: firstPlayingMs || null,
        sizes: qualities.join(' -> ') || null,
        // The share of watching spent waiting, which is what "a lot of
        // buffering" means in a number. Taken from the furthest the playhead
        // was seen to reach, not from the element, which by now has been
        // reset.
        watchedSec: Math.round(furthestPosition) || null,
    });
    stalls = 0;
    stalledMs = 0;
    logged = 0;
}

function beat() {
    if (!enabled()) return;
    // The app may have swapped the player since the last beat; beating on the
    // element it replaced is how a diagnostic comes to describe nothing.
    const found = pickVideo();
    if (found && found !== video) {
        unlisten(video);
        video = found;
        listen(video);
        lastBeatPosition = video.currentTime || 0;
    }
    if (!video) return;
    const at = video.currentTime || 0;
    const moved = Math.round((at - lastBeatPosition) * 10) / 10;
    lastBeatPosition = at;
    let paused = false;
    try { paused = !!video.paused; } catch (e) { }
    // Not moving while not paused is the shape of the hang; anything else is
    // ordinary and does not need a line every ten seconds.
    const stuck = moved <= 0 && !paused;
    beatsSinceLine++;
    if (!stuck && beatsSinceLine < QUIET_BEATS) return;
    beatsSinceLine = 0;
    appendFileOnlyLog('player.heartbeat', Object.assign(snapshot(video), {
        movedSec: moved,
        stuck,
        paused,
        parseMsSinceBeat: Math.round(beatParseMs),
        parsesSinceBeat: beatParses,
    }));
    beatParseMs = 0;
    beatParses = 0;
}

const VIDEO_EVENTS = [
    ['waiting', () => onWaiting],
    ['playing', () => onPlaying],
    ['seeked', () => onResumed],
    ['stalled', () => onStalled],
    ['error', () => onError],
    ['ended', () => onEnded],
    ['loadedmetadata', () => onQuality],
    ['resize', () => onQuality],
];

function listen(el) {
    if (!el) return;
    for (const pair of VIDEO_EVENTS) el.addEventListener(pair[0], pair[1]());
}

function unlisten(el) {
    if (!el) return;
    for (const pair of VIDEO_EVENTS) el.removeEventListener(pair[0], pair[1]());
}

function detach(reason) {
    clearTimeout(attachRetry);
    attachRetry = null;
    if (beatTimer) {
        clearInterval(beatTimer);
        beatTimer = null;
    }
    if (video) {
        reportSummary(reason || 'left');
        unlisten(video);
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

    video = pickVideo();
    if (!video) {
        attachRetry = setTimeout(attach, 500);
        return;
    }

    stalls = 0;
    stalledMs = 0;
    logged = 0;
    furthestPosition = 0;
    slowParseLines = 0;
    startedWatchingAt = Date.now();
    firstPlayingMs = 0;
    qualities = [];
    takeParseCost();

    // 'playing' and 'seeked' both end a wait: a seek clears it too, and
    // leaving the stall open would charge the next one with this one's time.
    listen(video);

    lastBeatPosition = video.currentTime || 0;
    beatsSinceLine = 0;
    beatParseMs = 0;
    beatParses = 0;
    beatTimer = setInterval(beat, BEAT_MS);
}

window.addEventListener('hashchange', attach, false);
attach();
