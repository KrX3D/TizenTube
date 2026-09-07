import { configRead, configWrite } from '../config.js';
import { showModal, buttonItem, overlayPanelItemListRenderer, showToast } from './ytUI.js';
import resolveCommand from '../resolveCommand.js';
import { t } from 'i18next';

/**
 * numericEditor.js — edit an IP address or port from the TV remote.
 *
 * The settings menu can only render lists of buttons, so a numeric value has
 * historically meant either a hardcoded default or one option per possible
 * value. For an IP address the second is unusable: picking 192 from a flat
 * list means scrolling 192 rows, and splitting it into coarse/fine submenus
 * (0-31, 32-63, ...) trades that for four levels of menu per octet.
 *
 * Instead this shows the value as a single field with a cursor:
 *
 *     192.168.0[5]0.057
 *
 * left/right move the cursor, up/down change the focused digit, and the
 * number keys type directly — remotes without a numeric keypad still work
 * through up/down, remotes with one skip straight to the digit.
 *
 * The focused digit is marked with brackets rather than a caret on a second
 * line, because the TV UI font is not monospace and a caret would drift out
 * of alignment with the digit it points at.
 *
 * Values are zero-padded so digit positions never move while editing, which
 * is what makes a cursor meaningful in the first place.
 */

const MODAL_ID = 'tt-numeric-editor';

const KINDS = {
  // Four octets, three digits each.
  ipv4: {
    slots: 12,
    parse(value) {
      const parts = String(value || '').split('.');
      const digits = [];
      for (let i = 0; i < 4; i++) {
        const octet = Math.max(0, Math.min(255, parseInt(parts[i], 10) || 0));
        for (const ch of String(octet).padStart(3, '0')) digits.push(ch);
      }
      return digits;
    },
    display(digits, cursor) {
      const octets = [];
      for (let i = 0; i < 4; i++) {
        let text = '';
        for (let j = 0; j < 3; j++) {
          const index = (i * 3) + j;
          text += index === cursor ? `[${digits[index]}]` : digits[index];
        }
        octets.push(text);
      }
      return octets.join('.');
    },
    // Each octet is clamped rather than rejected: 999 becomes 255, so an
    // accidental digit can't leave the field in a state that refuses to save.
    serialize(digits) {
      const octets = [];
      for (let i = 0; i < 4; i++) {
        const raw = parseInt(digits.slice(i * 3, (i * 3) + 3).join(''), 10) || 0;
        octets.push(Math.max(0, Math.min(255, raw)));
      }
      return octets.join('.');
    },
  },
  // Ports are 1-65535, so five digits.
  port: {
    slots: 5,
    parse(value) {
      const port = Math.max(0, Math.min(65535, parseInt(value, 10) || 0));
      return String(port).padStart(5, '0').split('');
    },
    display(digits, cursor) {
      return digits.map((d, i) => (i === cursor ? `[${d}]` : d)).join('');
    },
    serialize(digits) {
      const raw = parseInt(digits.join(''), 10) || 0;
      return Math.max(1, Math.min(65535, raw));
    },
  },
};

let _state = null;

function render(isUpdate) {
  const { kind, digits, cursor, title } = _state;
  showModal(
    {
      title,
      subtitle: `${KINDS[kind].display(digits, cursor)}   —   ${t('settings.numericEditor.hint')}`,
    },
    overlayPanelItemListRenderer([
      buttonItem(
        { title: t('settings.numericEditor.save'), subtitle: KINDS[kind].serialize(digits).toString() },
        { icon: 'CHECK_BOX' },
        [{ customAction: { action: 'NUMERIC_EDITOR_SAVE' } }]
      ),
      buttonItem(
        { title: t('settings.numericEditor.cancel') },
        { icon: 'CLEAR_COOKIES' },
        [{ customAction: { action: 'NUMERIC_EDITOR_CANCEL' } }]
      ),
    ], 0),
    MODAL_ID,
    isUpdate
  );
}

function close() {
  _state = null;
  try { resolveCommand({ signalAction: { signal: 'POPUP_BACK' } }); } catch (_) { }
}

export function saveNumericEditor() {
  if (!_state) return;
  const { kind, digits, configKey } = _state;
  const value = KINDS[kind].serialize(digits);
  configWrite(configKey, value);
  close();
  showToast('TizenTube', t('settings.numericEditor.saved', { value }));
}

export function cancelNumericEditor() {
  close();
}

/**
 * Open the editor.
 *
 * @param {object} opts
 * @param {string} opts.configKey config key to read and write
 * @param {'ipv4'|'port'} opts.kind
 * @param {string} opts.title heading shown above the field
 */
export function showNumericEditor(opts) {
  try {
    const kind = KINDS[opts.kind] ? opts.kind : 'ipv4';
    _state = {
      kind,
      configKey: opts.configKey,
      title: opts.title || '',
      digits: KINDS[kind].parse(configRead(opts.configKey)),
      cursor: 0,
    };
    render(false);
  } catch (err) {
    console.warn('[numericEditor] failed to open:', err);
    _state = null;
  }
}

// Key codes. 10009 and 461 are the Tizen remote's Back; 27 is Escape, which
// is what the desktop test setup sends.
const LEFT = 37, UP = 38, RIGHT = 39, DOWN = 40, ENTER = 13;
const BACK_KEYS = [27, 461, 10009];

function digitFor(keyCode) {
  if (keyCode >= 48 && keyCode <= 57) return keyCode - 48;
  if (keyCode >= 96 && keyCode <= 105) return keyCode - 96;   // numeric keypad
  return null;
}

document.addEventListener('keydown', (evt) => {
  if (!_state) return;
  try {
    const { kind } = _state;
    const slots = KINDS[kind].slots;
    const code = evt.keyCode;

    const typed = digitFor(code);
    if (typed !== null) {
      _state.digits[_state.cursor] = String(typed);
      // Auto-advance so an address can be typed straight through without
      // touching the arrows; stop at the last slot rather than wrapping,
      // which would silently overwrite the first digit.
      if (_state.cursor < slots - 1) _state.cursor++;
    } else if (code === LEFT) {
      _state.cursor = (_state.cursor - 1 + slots) % slots;
    } else if (code === RIGHT) {
      _state.cursor = (_state.cursor + 1) % slots;
    } else if (code === UP) {
      _state.digits[_state.cursor] = String((Number(_state.digits[_state.cursor]) + 1) % 10);
    } else if (code === DOWN) {
      _state.digits[_state.cursor] = String((Number(_state.digits[_state.cursor]) + 9) % 10);
    } else if (code === ENTER) {
      // Enter is left to the focused button (Save / Cancel) so the modal
      // behaves like every other one in the app.
      return;
    } else if (BACK_KEYS.indexOf(code) !== -1) {
      _state = null;   // let the modal's own back handling dismiss it
      return;
    } else {
      return;
    }

    evt.preventDefault();
    evt.stopPropagation();
    render(true);
  } catch (err) {
    console.warn('[numericEditor] key handling failed:', err);
    _state = null;
  }
}, true);
