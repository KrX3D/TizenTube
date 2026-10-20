import { appendFileOnlyLog } from './hideWatched.js';
import { pickVideo, lastPick } from '../utils/pickVideo.js';
import { isCategoryEnabled } from './logCategories.js';

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

// Beats before an unfinished stall is reported rather than waited on. Two, so
// roughly twenty seconds: long enough that an ordinary rebuffer has ended by
// then, short enough to be in the log well before anyone reaches for the
// remote.
const OPEN_STALL_BEATS = 2;

// A gap this short is a frame hiccup, not a spinner the user would notice.
const MIN_STALL_MS = 250;

let video = null;
let attachRetry = null;

let stallStartedAt = 0;
let stallPosition = 0;
// Beats during which the current stall has been open, so one that never ends
// is still reported. Everything about a stall used to be recorded on the way
// out of it, in onResumed, which means a stall with no end was invisible to
// all of it.
let openStallBeats = 0;
let openStallLogged = false;

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

// Media seconds advanced per second of wall clock, below which a beat is
// stuttering rather than playing.
//
// Reported on 20 October: a video paused for twenty minutes then resumed
// played a couple of seconds, stopped for several, played two more, and looped.
// Nothing in this file called that a problem. "stuck" means the playhead did
// not move at all, and a playhead that advances two seconds in a ten second
// beat has moved, so the beat read as ordinary and said nothing for a minute
// at a time. The individual stalls are still caught by the waiting/playing
// pair, but a loop of them is only visible by counting lines, and the one
// number that names it outright was not being recorded.
//
// Six tenths rather than something tighter: a beat can legitimately come in
// short when the timer is late under load, and the timer being late is itself
// measured below rather than mistaken for a stutter.
const STUTTER_RATIO = 0.6;
let beatTimer = null;
let lastBeatPosition = 0;
let lastBeatAt = 0;
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

// Milliseconds per named filter within the parse being measured.
const spent = {};

/**
 * Run one of this fork's filters and remember what it cost.
 *
 * The slow-parse line said a /watch response took 511ms and that 30 tiles
 * went through it, which was enough to know the cost is real and not enough
 * to know whose it is: a dozen filters run over that response, one of them
 * walking the whole tree. Guessing which from the outside was the obvious
 * temptation and the wrong move — a benchmark written against the likeliest
 * suspect measured 0.1ms, because that function only walks named subtrees and
 * the cost is somewhere else entirely.
 *
 * So each heavy filter is timed where it is called, and the slow-parse line
 * carries the breakdown. Off, this is one branch and a call.
 */
export function timeFilter(name, run) {
    if (!enabled()) return run();
    const startedAt = Date.now();
    try {
        return run();
    } finally {
        spent[name] = (spent[name] || 0) + (Date.now() - startedAt);
    }
}

function takeSpent() {
    const out = {};
    for (const name of Object.keys(spent)) {
        // Only what is worth reading: a filter that cost nothing measurable
        // would bury the one that did.
        if (spent[name] > 0) out[name + 'Ms'] = spent[name];
        delete spent[name];
    }
    return out;
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
function trimmedMarks(marks) {
    const out = {};
    for (const key of Object.keys(marks)) {
        const value = Math.round(marks[key]);
        if (value > 0) out[key] = value;
    }
    return out;
}

export function noteParseShape(ms, detectedPage, response, nativeMs, marks) {
    if (!enabled()) {
        takeWork();
        return;
    }
    if (ms < SLOW_PARSE_MS) {
        takeWork();
        takeSpent();
        return;
    }
    if (slowParseLines >= MAX_SLOW_PARSE_LINES) {
        takeWork();
        takeSpent();
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
        // How much of the time above was JSON.parse itself rather than this
        // fork's work on the result. Previously unmeasurable: the clock
        // started after the native parse, so a slow line could not say which
        // side of it was slow, and two investigations went the wrong way.
        nativeMs: isFinite(nativeMs) ? Math.round(nativeMs) : null,
        page: detectedPage || null,
        keys,
        items,
        // Only the checkpoints that cost something, so the line stays
        // readable: a region at zero says nothing worth the characters.
    }, marks ? trimmedMarks(marks) : null, takeWork(), takeSpent()));
}

function enabled() {
    try {
        // A log category now rather than a setting of its own, so it sits with
        // the others in the menu. isCategoryEnabled takes a label, and the
        // prefix is what it reads.
        return isCategoryEnabled('playbackDiag.');
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
// Exported for the same reason playbackUnwedge.js exports check: the beat is
// where the judgement lives, and a judgement that has never been run against a
// known input is a guess.
export { beat };

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
    // Which element this describes. A capture where these numbers swing
    // between two sets of values is two elements being sampled, not a playhead
    // moving, and that was indistinguishable until this went on the line.
    const pick = lastPick();
    out.videos = pick.videos;
    if (pick.videos > 1) {
        out.videoIndex = pick.videoIndex;
        out.picked = pick.picked;
    }
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
    openStallBeats = 0;
    openStallLogged = false;
}

/**
 * A stall that has not ended, reported once while it is still going.
 *
 * From the 20 October capture: a player frozen for nearly four minutes, ended
 * only by navigating away, and the summary for that video said
 * `stalls: 1, stalledMs: 5322` — five seconds, for a session containing a
 * four-minute freeze. Both numbers come from onResumed, so a stall that never
 * resumes is counted as never having happened; the 5322 was an earlier,
 * ordinary rebuffer that did end.
 *
 * Reported from the beat rather than from an event, because the absence of the
 * event is the whole problem.
 */
function reportOpenStall() {
    if (!stallStartedAt || openStallLogged) return;
    openStallBeats++;
    if (openStallBeats < OPEN_STALL_BEATS) return;
    openStallLogged = true;
    // Counted here as well as logged, so the summary cannot report a session
    // of frozen playback as a clean one. onResumed adds its real duration if
    // it ever does end.
    stalls++;
    appendFileOnlyLog('player.stallOpen', Object.assign(snapshot(video), takeParseCost(), {
        openForMs: Date.now() - stallStartedAt,
        at: Math.round(stallPosition),
        stall: stalls,
    }));
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

    // Already counted by reportOpenStall if it ran long enough to be reported
    // while open; its duration is only known now.
    if (!openStallLogged) stalls++;
    openStallLogged = false;
    openStallBeats = 0;
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
    if (!stalls && !stallStartedAt) return;
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
        // A stall still open as the video is left: its duration never reached
        // stalledMs, so without this the summary understates the session by
        // however long the freeze lasted. Today's capture understated it by a
        // factor of forty-five.
        endedStalled: stallStartedAt ? Date.now() - stallStartedAt : null,
    });
    stalls = 0;
    stalledMs = 0;
    logged = 0;
    openStallBeats = 0;
    openStallLogged = false;
    // Cleared here, not only in detach(). onEnded() calls this and nothing
    // else, so a video that ended while a stall was open left stallStartedAt
    // set: the next video's waiting event was then ignored by onWaiting's own
    // guard, and its first playing event reported a stall measured from the
    // previous video. A test of the ordinary two-second rebuffer caught it
    // reporting ninety-two seconds.
    stallStartedAt = 0;
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
        lastBeatAt = 0;
    }
    if (!video) return;
    const at = video.currentTime || 0;
    const moved = Math.round((at - lastBeatPosition) * 10) / 10;
    lastBeatPosition = at;
    // Real time between beats, not the interval it was asked for. A beat that
    // arrives late says the page itself was busy, and dividing by the nominal
    // interval would hide that in the ratio instead of showing it.
    const now = Date.now();
    const elapsedMs = lastBeatAt ? now - lastBeatAt : 0;
    lastBeatAt = now;
    let paused = false;
    try { paused = !!video.paused; } catch (e) { }
    // Not moving while not paused is the shape of the hang; anything else is
    // ordinary and does not need a line every ten seconds.
    const stuck = moved <= 0 && !paused;
    // How much of real time reached the screen. Null when there is nothing to
    // compare against, and deliberately not computed across a seek: a jump
    // forward would read as a ratio above one and a jump back as a negative,
    // and neither is a statement about playback.
    const ratio = (!paused && elapsedMs > 1000 && moved >= 0 && moved <= elapsedMs / 1000 + 1)
        ? Math.round((moved / (elapsedMs / 1000)) * 100) / 100
        : null;
    const stuttering = ratio !== null && ratio < STUTTER_RATIO && !stuck;
    reportOpenStall();
    beatsSinceLine++;
    if (!stuck && !stuttering && beatsSinceLine < QUIET_BEATS) return;
    beatsSinceLine = 0;
    appendFileOnlyLog('player.heartbeat', Object.assign(snapshot(video), {
        movedSec: moved,
        elapsedMs,
        // The number that names a stutter loop in one line: 0.2 is two seconds
        // of video reaching the screen in ten seconds of sitting there.
        ratio,
        stuttering,
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
    lastBeatAt = 0;
    beatsSinceLine = 0;
    beatParseMs = 0;
    beatParses = 0;
    beatTimer = setInterval(beat, BEAT_MS);
}

window.addEventListener('hashchange', attach, false);
attach();
