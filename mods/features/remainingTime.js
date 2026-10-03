import { configRead, configChangeEmitter } from '../config.js';

/**
 * remainingTime.js — show how much of the video is left, beside the total.
 *
 * Ported from siriusvoid's fork, with the behaviour changed as requested: that
 * version replaces the total with a countdown, this one appends the countdown
 * to it, so the player reads `42:17 (-12:04)` and you can still see how long
 * the video is.
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

function findDurationEl() {
    return document.querySelector(DURATION_SELECTOR);
}

function findGuardContainer() {
    return document.querySelector(GUARD_SELECTOR);
}

function enabled() {
    try {
        return configRead('enableRemainingTime') === true;
    } catch (e) {
        return false;
    }
}

/**
 * The text the readout should hold: the app's own total with the countdown
 * after it.
 *
 * The total is taken from what the app wrote rather than formatted from
 * video.duration, so a live stream, a chaptered video or any other case where
 * the app shows something other than a plain duration keeps showing it.
 */
function computeDesiredText(el) {
    if (!video || !video.duration || !isFinite(video.duration)) return null;
    const total = (el.textContent || '').replace(/\s*\(-[^)]*\)\s*$/, '').trim();
    if (!total) return null;
    nativeText = total;
    return `${total} (-${formatTime(video.duration - video.currentTime)})`;
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

/** Put the app's own total back, for when the setting is switched off. */
function restoreNative() {
    desiredText = null;
    const el = findDurationEl();
    if (!el || !nativeText) return;
    const stripped = (el.textContent || '').replace(/\s*\(-[^)]*\)\s*$/, '').trim();
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

    guardObserver = new MutationObserver(() => {
        if (desiredText === null) return;
        const el = findDurationEl();
        if (el && el.textContent !== desiredText) el.textContent = desiredText;
    });
    guardObserver.observe(container, { characterData: true, childList: true, subtree: true });

    apply();
}

// Switching the setting takes effect at once rather than at the next restart:
// off tears the observer down and puts the app's own text back, on attaches.
try {
    configChangeEmitter.addEventListener('configChange', (ev) => {
        if (ev?.detail?.key !== 'enableRemainingTime') return;
        if (ev.detail.value) attach();
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
