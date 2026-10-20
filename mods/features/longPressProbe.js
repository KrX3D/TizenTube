import { appendFileOnlyLog, detectCurrentPage } from './hideWatched.js';
import { isCategoryEnabled } from './logCategories.js';

/**
 * longPressProbe.js — watch the remote instead of the app.
 *
 * Long pressing a playlist tile in the library still does nothing, and five
 * guesses about why have now been wrong. Every one of them was a guess about
 * the app's side: the tile style, the thumbnail, the entry count, the content
 * id. What none of them could tell us is the thing that decides whether any of
 * it matters — whether the TV fires a long press for that tile at all.
 *
 * The app implements long press in JS by timing how long OK is held on the
 * focused item, so the same keydown and keyup it uses are visible from a
 * capture-phase listener on window. That is what this does: it times the hold
 * itself, and for a few seconds afterwards it records which commands the app
 * resolves. One line comes out per long press, and it answers the question
 * outright:
 *
 *   cmds contains showMenuCommand   the gesture fired and the menu opened; any
 *                                   remaining fault is in the drawing
 *   cmds contains browseEndpoint    the TV treated the hold as a plain select
 *                                   and navigated into the playlist
 *   cmds is empty                   nothing is bound to a hold on this tile,
 *                                   and no menu we attach can ever show
 *
 * The line also carries what was focused — tag name, classes and visible text
 * — so there is no doubt about which tile was held. Four of the five wrong
 * guesses would have been skipped by having that.
 *
 * Nothing here runs unless the shelves log category is on, which is also what
 * gates the rest of the long-press diagnostics.
 */

const KEY_OK = 13;
// Space, which the emulator and some remotes send in place of OK.
const KEY_SPACE = 32;

// Deliberately below the app's own threshold. A hold the app ignores as too
// short is itself worth seeing, since "I long pressed it" and "the app agreed
// that was a long press" are different claims and only one of them is ours.
const HOLD_MS = 350;

// How long after the hold to keep watching commands. Long enough for a menu
// that opens slowly, short enough that ordinary navigation afterwards is not
// swept up in it.
const WINDOW_MS = 2500;

// A navigation can resolve a great many commands. The cap is for the pathology
// where the hold is followed by a page load, not for the normal case.
const MAX_WINDOW_COMMANDS = 25;

let downAt = 0;
let downEl = null;
let holdTimer = null;
let pending = null;

/** Tag, classes and visible text of the focused element, all truncated. */
function describe(el) {
    if (!el) return null;
    const cls = [];
    try {
        const list = el.classList;
        for (let i = 0; list && i < list.length && i < 4; i++) cls.push(list[i]);
    } catch (_) { }
    let text = '';
    try {
        text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length > 60) text = text.slice(0, 60);
    } catch (_) { }
    return { tag: el.tagName || null, cls, text };
}

/**
 * The custom-element chain above the focused node.
 *
 * The app's tiles are custom elements, so the chain names the component that
 * owns the gesture — YTLR-TILE against whatever a library playlist shelf
 * builds its tiles from. If those two differ, that difference is the answer.
 */
function ancestry(el) {
    const out = [];
    let node = el;
    try {
        for (let i = 0; node && i < 6; i++) {
            out.push(node.tagName || '?');
            node = node.parentElement;
        }
    } catch (_) { }
    return out;
}

function report(p) {
    appendFileOnlyLog('longPress.probe', {
        heldMs: p.heldMs,
        page: p.page,
        tag: p.focus ? p.focus.tag : null,
        cls: p.focus ? p.focus.cls : null,
        text: p.focus ? p.focus.text : null,
        path: p.path,
        menu: p.window.menu,
        cmds: p.window.cmds,
    });
}

function onHoldReached() {
    holdTimer = null;
    if (!downAt) return;
    // resolveCommand.js reads this off the global rather than importing this
    // module: it is imported by innerTubeCalls.js, which this file's own
    // import of hideWatched.js would eventually close a cycle through.
    const w = { until: Date.now() + WINDOW_MS, left: MAX_WINDOW_COMMANDS, cmds: [], menu: 0 };
    window.__ttLongPressWindow = w;
    const p = {
        focus: describe(downEl),
        path: ancestry(downEl),
        window: w,
        heldMs: null,
        page: (function () { try { return detectCurrentPage(); } catch (_) { return null; } })(),
    };
    pending = p;
    setTimeout(function () { report(p); }, WINDOW_MS);
}

function onDown(evt) {
    if (!evt || (evt.keyCode !== KEY_OK && evt.keyCode !== KEY_SPACE)) return;
    // Auto-repeat while the key is held is the same press, and the guard below
    // covers a platform that does not set the flag.
    if (evt.repeat || downAt) return;
    if (!isCategoryEnabled('longPress.')) return;
    downAt = Date.now();
    // The element is kept, not described: describing it reads textContent, and
    // there is no reason to pay for that on an ordinary OK press that turns
    // out not to be a hold at all.
    downEl = document.activeElement;
    holdTimer = setTimeout(onHoldReached, HOLD_MS);
}

function onUp(evt) {
    if (!evt || (evt.keyCode !== KEY_OK && evt.keyCode !== KEY_SPACE)) return;
    const at = downAt;
    downAt = 0;
    downEl = null;
    if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
    }
    if (at && pending && pending.heldMs === null) pending.heldMs = Date.now() - at;
}

// Capture phase on window, so these run before the app's own handlers and are
// not lost to one that stops propagation.
window.addEventListener('keydown', onDown, true);
window.addEventListener('keyup', onUp, true);
