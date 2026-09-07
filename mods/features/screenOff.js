import { appendFileOnlyLog } from './hideWatched.js';

// "Screen off" — blanks the picture while audio keeps playing, for listening
// to music/podcasts without the panel lit. Upstream 8977e23.
//
// Implemented by hiding every direct child of <body> rather than by dimming,
// so the panel really does go black instead of showing a dark grey frame.
// <script> and <svg> children are left alone: hiding a script element is
// pointless, and YouTube TV keeps a top-level <svg> sprite sheet that other
// elements reference — hiding it breaks icons once the screen comes back.
//
// Any keypress restores it. The grace period matters: the same keypress that
// triggers the action would otherwise be seen by the restore handler in the
// same tick and undo it immediately.
const RESTORE_GRACE_MS = 1000;

function eachRestorableChild(fn) {
  for (const child of document.body.children) {
    const tag = String(child.tagName || '').toLowerCase();
    if (tag === 'script' || tag === 'svg') continue;
    fn(child);
  }
}

export function screenOff() {
  try {
    eachRestorableChild(child => child.style.setProperty('display', 'none', 'important'));
    window.__ttScreenOffAt = Date.now();
    appendFileOnlyLog('screenOff.on', {});
  } catch (err) {
    appendFileOnlyLog('screenOff.error', { message: String(err?.message || err) });
  }
}

function restoreIfNeeded() {
  if (!window.__ttScreenOffAt) return;
  if (Date.now() - window.__ttScreenOffAt <= RESTORE_GRACE_MS) return;
  try {
    // Cleared rather than set to 'block'. Upstream forces display:block on
    // every child, which overrides whatever each element's stylesheet
    // actually wants — several of YouTube TV's top-level containers are flex
    // or grid, and forcing block on those leaves the UI subtly mislaid after
    // the first screen-off. Removing the inline property restores the
    // original cascade instead.
    eachRestorableChild(child => child.style.removeProperty('display'));
    window.__ttScreenOffAt = null;
    appendFileOnlyLog('screenOff.restored', {});
  } catch (err) {
    appendFileOnlyLog('screenOff.error', { message: String(err?.message || err) });
  }
}

document.addEventListener('keydown', restoreIfNeeded, true);
