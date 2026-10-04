import { configRead } from '../config.js';

/**
 * instantSeek.js — let the seek bar keep moving instead of waiting for OK.
 *
 * Ported from siriusvoid's fork, unchanged in approach because the approach is
 * the good part: the app's seek bar moves a highlighted scrub position on
 * left/right and only commits once OK is pressed, so holding the key down
 * stalls — each step waits on a round trip through the commit handler before
 * the next one registers.
 *
 * This debounces instead. Every left/right press resets a short timer, and a
 * synthetic OK is dispatched once movement actually stops. Seeking itself is
 * deliberately not reimplemented: the app's own handler moves the highlight
 * and commits it, which keeps its bounds checking and its seek logic intact.
 *
 * The delay is a setting, because the right value depends on how fast you
 * press and on how quickly the TV keeps up.
 */

const DEFAULT_DELAY_MS = 500;
const KEY_LEFT = 37;
const KEY_RIGHT = 39;
const KEY_OK = 13;
const KEY_UP = 38;

let pendingTimer = null;
let pendingTarget = null;

function isOnProgressBar() {
    return !!document.activeElement && document.activeElement.tagName === 'YTLR-PROGRESS-BAR';
}

function commitSeek(target) {
    const down = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    const up = new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true });
    // keyCode is deprecated and read-only on a constructed event, so it has to
    // be defined this way to look like a real OK press to the app's handler.
    Object.defineProperty(down, 'keyCode', { get: () => KEY_OK });
    Object.defineProperty(up, 'keyCode', { get: () => KEY_OK });
    target.dispatchEvent(down);
    target.dispatchEvent(up);
}

function cancelPending() {
    if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
    }
    pendingTarget = null;
}

function delayMs() {
    const stored = Number(configRead('instantSeekDelayMs'));
    return stored > 0 ? stored : DEFAULT_DELAY_MS;
}

function scheduleCommit(target) {
    cancelPending();
    pendingTarget = target;
    pendingTimer = setTimeout(() => {
        const settled = pendingTarget;
        pendingTimer = null;
        pendingTarget = null;
        // Focus may have moved on in the meantime; committing into whatever is
        // focused now would press OK on something else entirely.
        if (settled && document.activeElement === settled) commitSeek(settled);
    }, delayMs());
}

function enabled() {
    try {
        return configRead('enableInstantSeek') === true;
    } catch (e) {
        return false;
    }
}

export function handleKey(evt) {
    if (!enabled()) return;
    const code = evt && evt.keyCode;

    if (code === KEY_LEFT || code === KEY_RIGHT) {
        if (!isOnProgressBar()) {
            cancelPending();
            return;
        }
        scheduleCommit(document.activeElement);
        return;
    }

    // A real OK has already committed, and firing one into the chapters strip
    // above would open a chapter nobody asked for.
    if (code === KEY_OK || code === KEY_UP) cancelPending();
}

export function handleFocusOut(evt) {
    if (pendingTarget && evt && evt.target === pendingTarget) cancelPending();
}

document.addEventListener('keydown', handleKey, true);
// So a commit is never left waiting to fire against whatever gets focus next.
document.addEventListener('focusout', handleFocusOut, true);
