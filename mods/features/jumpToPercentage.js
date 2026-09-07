import { configRead } from '../config.js';

// Number keys 0-9 seek to that decile of the video: 1 -> 10%, 5 -> 50%,
// 0 -> 0%. Upstream 693ee98.
//
// Kept in its own module with its own listener rather than added to ui.js's
// handler, per this fork's convention. Two deliberate differences from
// upstream:
//
//  - Gated behind a setting. Upstream binds these keys unconditionally, which
//    takes 0-9 away from anything else that might want them (search boxes are
//    handled below, but remotes with a numeric keypad also use them to switch
//    inputs on some sets).
//  - Guarded. Upstream does document.querySelector('video').currentTime = ...
//    with no null check and no duration check, which throws on any page
//    without a video element, and produces NaN while metadata is still
//    loading (duration is NaN until then, and assigning NaN to currentTime
//    throws in some engines).
const KEY_TO_DECILE = {
  48: 0, 49: 1, 50: 2, 51: 3, 52: 4,
  53: 5, 54: 6, 55: 7, 56: 8, 57: 9,
};

function isTypingTarget() {
  const el = document.querySelector(':focus');
  if (!el) return false;
  const tag = String(el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable === true;
}

document.addEventListener('keydown', (evt) => {
  try {
    if (!configRead('enableJumpToPercentage')) return;
    if (!(evt.keyCode in KEY_TO_DECILE)) return;
    // Never hijack digits while a text field has focus — search would break.
    if (isTypingTarget()) return;

    const video = document.querySelector('video');
    if (!video) return;
    const duration = Number(video.duration);
    if (!isFinite(duration) || duration <= 0) return;

    video.currentTime = (KEY_TO_DECILE[evt.keyCode] / 10) * duration;
    evt.preventDefault();
    evt.stopPropagation();
  } catch (_) { }
}, true);
