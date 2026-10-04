import { configRead, configChangeEmitter } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';

/**
 * bixbyMicFix.js — stop Bixby stepping on YouTube's own voice search.
 *
 * From JensorX's fork. Pressing the microphone button on a Samsung remote
 * starts Bixby and YouTube's own SpeechRecognition at the same time. Bixby
 * then says it did not understand, and that dismisses the YouTube result you
 * were actually after.
 *
 * The fix is to register the microphone key through Tizen's input device API
 * and swallow the event, so Bixby's handler never runs. YouTube's recognition
 * is unaffected: the same key press has already started it by the time the
 * event is suppressed.
 *
 * Only while a search context is on screen, so the mic button keeps working
 * as a mic button everywhere else.
 *
 * Changed from their version: theirs runs unconditionally. This one has a
 * setting, which also means the key registration happens when you switch it on
 * rather than needing a restart.
 */

// The microphone key's usual code, plus whatever the TV reports for it.
const MIC_KEY_CODES = new Set([65376]);
const MIC_KEY_NAME = /(mic|microphone|voice|bixby)/i;

const SEARCH_SELECTOR = 'ytlr-search-box, ytlr-search-text-box, input[type="search"], input[role="searchbox"], [role="search"]';

// Shared with the voice search guard, if that is also enabled: both need to
// know when the mic key was last pressed.
const voiceState = window.__ttVoiceSearchState || (window.__ttVoiceSearchState = {
    lastMicKeyAt: 0,
    lastMicKeyCode: null,
});

let registered = false;

function enabled() {
    try {
        return configRead('enableBixbyMicFix') === true;
    } catch (e) {
        return false;
    }
}

function hasSearchContext() {
    const active = document.activeElement;
    if (active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
        return true;
    }
    return !!document.querySelector(SEARCH_SELECTOR);
}

export function suppressBixby(event) {
    if (!enabled()) return;
    if (!event || !MIC_KEY_CODES.has(event.keyCode) || !hasSearchContext()) return;

    voiceState.lastMicKeyAt = Date.now();
    voiceState.lastMicKeyCode = event.keyCode;

    // Only the keyup is cancelled: cancelling the keydown as well has been
    // seen to stop the recognition this is meant to protect.
    if (event.type === 'keyup' && typeof event.preventDefault === 'function') event.preventDefault();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
}

/**
 * Claim the microphone key, so its events reach this page at all.
 *
 * The code differs between TV models, so every key whose name looks like a
 * microphone is registered and its code added. Idempotent.
 */
export function registerMicKeys() {
    if (registered) return;
    try {
        if (!window.tizen || !window.tizen.tvinputdevice) return;
        const keys = window.tizen.tvinputdevice.getSupportedKeys() || [];
        const claimed = [];
        for (const key of keys) {
            if (!key || !MIC_KEY_NAME.test(String(key.name || ''))) continue;
            MIC_KEY_CODES.add(key.code);
            try {
                window.tizen.tvinputdevice.registerKey(key.name);
                claimed.push(key.name + ':' + key.code);
            } catch (e) { }
        }
        registered = true;
        appendFileOnlyLog('player.bixbyMicKeys', { claimed });
    } catch (err) {
        appendFileOnlyLog('player.bixbyMic.error', { message: err?.message || String(err) });
    }
}

if (enabled()) registerMicKeys();

// Switching it on claims the key there and then, rather than at the next start.
try {
    configChangeEmitter.addEventListener('configChange', (ev) => {
        if (ev?.detail?.key === 'enableBixbyMicFix' && ev.detail.value) registerMicKeys();
    });
} catch (e) { }

// Capture phase, so this runs before the app's own handlers.
window.addEventListener('keydown', suppressBixby, true);
window.addEventListener('keyup', suppressBixby, true);
