import { configRead, configChangeEmitter } from '../config.js';

/**
 * remainingTime.js — what is left of the video, and when it will end.
 *
 * Ported from siriusvoid's fork. That version replaces the total with a
 * countdown; this one appends to the total, so the length of the video is
 * still there, and it can also say the clock time the video will finish at.
 *
 * The layout marks each value rather than bracketing it, because three times
 * in a row with nothing to tell them apart cannot be read — "42:17 / 12:04 /
 * 14:35" says nothing about which is which:
 *
 *   42:17                    nothing switched on: the app's own text, untouched
 *   42:17 · -12:04           time left, marked by the minus every player uses
 *   42:17 · →14:35           when it ends, marked by an arrow reading "until"
 *   42:17 · -12:04 · →14:35  both
 *
 * The separator is the middle dot the app itself puts between the parts of a
 * tile's metadata, so the row looks like it belongs there.
 *
 * The finish time follows the playback rate — at 1.5x, twelve minutes of video
 * is eight minutes of waiting — and uses the 12/24 hour setting the on-screen
 * clock already has, rather than asking the same question twice.
 *
 * Their two hard-won findings are kept, because both were established against
 * a real device and neither is guessable:
 *
 *  1. The app rewrites the same element's text back to the total about once a
 *     second during ordinary playback.
 *  2. Seeking tears the duration element down entirely and recreates it as a
 *     new node holding the plain total.
 *
 * So a guard bound to one captured element survives (1) but not (2). What
 * survives both is observing the progress-bar container — which is not torn
 * down — and re-querying the duration element fresh on every check instead of
 * trusting a reference.
 *
 * Only the player's own duration readout is touched. The visually similar
 * duration on a recommendation tile is a different element entirely (a
 * yt-formatted-string with no idomkey) and is never matched by these
 * selectors.
 */

const DURATION_SELECTOR = '[idomkey="time-label"] [idomkey="duration"]';
// Survives both the periodic text reset and the node replacement on seek,
// unlike time-label or the duration element itself.
const GUARD_SELECTOR = 'ytlr-progress-bar[idomkey="progress-bar"]';
const ATTACH_RETRY_MS = 100;

const SEPARATOR = ' · ';
const MINUS = '-';
const UNTIL = '→';

// Everything this feature appended, so the app's own total can be recovered
// from the text on screen. The second alternative is the bracketed layout this
// replaced, so upgrading does not strand a "(-12:04)" that nothing matches.
const OURS = new RegExp(
    '(\\s*·\\s*[' + MINUS + UNTIL + '][^·]*)+$'
    + '|\\s*\\(' + MINUS + '[^)]*\\)\\s*$'
);

// How far the total on screen may sit from the video's own duration before it
// is treated as a leftover from a previous video rather than a deliberate
// wording. Rounding alone accounts for a second.
const TOTAL_TOLERANCE_S = 2;

let video = null;
let desiredText = null;
let nativeText = null;
let attachRetryTimeout = null;
let guardObserver = null;

function formatTime(totalSeconds) {
    const seconds = Math.max(0, Math.round(totalSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
    const ss = String(rest).padStart(2, '0');
    return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * The seconds in an "m:ss" or "h:mm:ss" readout, or null when the text is not
 * one — "LIVE", a chapter name, anything the app words its own way.
 */
function parseTime(text) {
    // No null guard: the one caller hands this the element's text after a
    // replace and a trim, so it is always a string. CodeQL was right to call
    // that branch unreachable (js/unneeded-defensive-code). The conversion
    // stays, since it is what makes the contract explicit rather than a test
    // that can never fire.
    const parts = String(text).trim().split(':');
    if (parts.length < 2 || parts.length > 3) return null;
    let seconds = 0;
    for (let i = 0; i < parts.length; i++) {
        // The leading field carries the hours and may be a single digit; the
        // rest are always padded, so anything else is not a time.
        const pattern = i === 0 ? /^\d{1,3}$/ : /^\d{2}$/;
        if (!pattern.test(parts[i])) return null;
        seconds = (seconds * 60) + Number(parts[i]);
    }
    return seconds;
}

function findDurationEl() {
    return document.querySelector(DURATION_SELECTOR);
}

function findGuardContainer() {
    return document.querySelector(GUARD_SELECTOR);
}

function wantRemaining() {
    try {
        return configRead('enableRemainingTime') === true;
    } catch (e) {
        return false;
    }
}

function wantFinishTime() {
    try {
        return configRead('enableFinishTime') === true;
    } catch (e) {
        return false;
    }
}

function enabled() {
    return wantRemaining() || wantFinishTime();
}

/**
 * The clock time the video will reach its end, as hh:mm.
 *
 * Rounded to the nearest minute: a readout that says 14:35 while the video
 * ends at 14:35:50 is worse than one that says 14:36.
 */
export function finishTimeText(secondsLeft, now) {
    // At 1.5x the remainder passes half again as fast. A rate of zero means
    // nothing is moving, so there is no wall-clock answer to give.
    const reported = video ? video.playbackRate : undefined;
    const rate = (reported === undefined || reported === null || reported === '') ? 1 : Number(reported);
    if (!(rate > 0)) return null;
    const at = new Date((now === undefined ? Date.now() : now) + Math.round(secondsLeft / rate) * 1000);
    // Round to the nearest minute by looking at the seconds we are dropping.
    const end = new Date(at.getTime() + (at.getSeconds() >= 30 ? 60000 : 0));

    let hours = end.getHours();
    let suffix = '';
    try {
        if (configRead('isClock12HourFormat') === true) {
            suffix = hours >= 12 ? ' PM' : ' AM';
            hours = hours % 12 || 12;
        }
    } catch (e) { }
    return String(hours).padStart(2, '0') + ':' + String(end.getMinutes()).padStart(2, '0') + suffix;
}

/**
 * The text the readout should hold.
 *
 * The total is taken from what the app wrote rather than formatted from
 * video.duration, so a live stream, a chaptered video or any other case where
 * the app shows something other than a plain duration keeps showing it.
 */
function computeDesiredText(el) {
    if (!video || !video.duration || !isFinite(video.duration)) return null;
    const raw = el.textContent || '';
    // Whether what is on screen is this feature's own earlier output.
    const leftover = OURS.test(raw);
    let total = raw.replace(OURS, '').trim();
    if (!total) return null;

    // Reported: with the remaining time on, the length of the video stayed at
    // the first video's 34:18 for every video after it, and switching the
    // setting off showed the right length again.
    //
    // The total is read back from the very element this writes to, and the
    // guard below used to write the cached string back over anything the app
    // put there — so the app's new total for the next video was discarded
    // before it could be read, and the old one was re-derived from our own
    // text forever. Two things stop that: the guard now recomputes from what
    // the app wrote (see attach), and a total that is our own leftover is
    // checked against the video actually playing before it is trusted again.
    //
    // Only a leftover is checked. Text the app has just written is taken as
    // it stands, whatever it says: the duration may not have settled for a
    // video that is still loading, and the app's wording is the authority for
    // a live stream or anything else that is not a plain time.
    if (leftover) {
        const shown = parseTime(total);
        if (shown !== null && Math.abs(shown - video.duration) > TOTAL_TOLERANCE_S) {
            total = formatTime(video.duration);
        }
    }
    nativeText = total;

    const secondsLeft = Math.max(0, video.duration - video.currentTime);
    const parts = [total];
    if (wantRemaining()) parts.push(MINUS + formatTime(secondsLeft));
    if (wantFinishTime()) {
        const finish = finishTimeText(secondsLeft);
        if (finish) parts.push(UNTIL + finish);
    }
    // Nothing of ours to add means nothing to write: leave the app's text be.
    if (parts.length === 1) return null;
    return parts.join(SEPARATOR);
}

function apply() {
    if (!video || !enabled()) return;
    const el = findDurationEl();
    if (!el) return;
    const next = computeDesiredText(el);
    if (next === null) return;
    desiredText = next;
    if (el.textContent !== desiredText) el.textContent = desiredText;
}

/** Put the app's own total back, for when both settings are switched off. */
function restoreNative() {
    desiredText = null;
    const el = findDurationEl();
    if (!el || !nativeText) return;
    const stripped = (el.textContent || '').replace(OURS, '').trim();
    if (stripped && el.textContent !== stripped) el.textContent = stripped;
}

function detach() {
    clearTimeout(attachRetryTimeout);
    attachRetryTimeout = null;
    if (guardObserver) {
        guardObserver.disconnect();
        guardObserver = null;
    }
    if (video) {
        // Removed rather than left behind: attach runs again on every
        // hashchange, and the video element is often the same one, so adding
        // without removing would stack another four listeners per video.
        video.removeEventListener('timeupdate', apply);
        video.removeEventListener('durationchange', apply);
        video.removeEventListener('seeking', apply);
        video.removeEventListener('seeked', apply);
        video.removeEventListener('ratechange', apply);
    }
    video = null;
}

function attach() {
    detach();
    if (!enabled()) return;

    video = document.querySelector('video');
    const container = findGuardContainer();

    if (!video || !container || !findDurationEl()) {
        video = null;
        attachRetryTimeout = setTimeout(attach, ATTACH_RETRY_MS);
        return;
    }

    desiredText = null;
    nativeText = null;

    video.addEventListener('timeupdate', apply);
    video.addEventListener('durationchange', apply);
    video.addEventListener('seeking', apply);
    video.addEventListener('seeked', apply);
    // Changing the speed moves the finish time, and nothing else would notice
    // until the next second ticked.
    video.addEventListener('ratechange', apply);

    guardObserver = new MutationObserver(() => {
        if (desiredText === null) return;
        const el = findDurationEl();
        if (!el || el.textContent === desiredText) return;
        // The app has written its own text back — about once a second during
        // playback, and with a new total when the video changes. Recompute
        // from it rather than forcing the cached string: forcing is what
        // discarded the new total and left the previous video's length on
        // screen for good.
        const next = computeDesiredText(el);
        if (next !== null) {
            desiredText = next;
            if (el.textContent !== desiredText) el.textContent = desiredText;
            return;
        }
        // Nothing computable. Which of the two reasons it is matters:
        //
        //   Infinity  a live stream. There is no remainder to count down and
        //             the app's wording is the authority, so stop holding our
        //             text over it — otherwise going from a normal video to a
        //             live one leaves the old video's readout on screen, which
        //             is the same fault this change is about.
        //   NaN or 0  the duration is not known yet, a moment that happens on
        //             every video while it loads. Hold the line, or the
        //             appended part flickers away and back each second.
        if (video && video.duration === Infinity) {
            desiredText = null;
            return;
        }
        el.textContent = desiredText;
    });
    guardObserver.observe(container, { characterData: true, childList: true, subtree: true });

    apply();
}

// Switching either setting takes effect at once rather than at the next
// restart. What matters is what the pair says afterwards, not which one
// changed: turning one off while the other is on still leaves work to do.
try {
    configChangeEmitter.addEventListener('configChange', (ev) => {
        const key = ev?.detail?.key;
        if (key !== 'enableRemainingTime' && key !== 'enableFinishTime') return;
        if (enabled()) attach();
        else {
            detach();
            restoreNative();
        }
    });
} catch (e) { }

// The player is torn down and recreated across navigation, so this re-attaches
// on the same signal sponsorblock.js uses to notice a new video.
window.addEventListener('hashchange', attach, false);
attach();
