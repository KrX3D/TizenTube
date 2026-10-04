import { configRead, configWrite, configAll, configDefault, configKnownKeys, NON_TRANSFERABLE_KEYS } from '../config.js';
import { builtSettingsTree } from '../ui/settings.js';
import { appendFileOnlyLog } from './hideWatched.js';
import { t } from 'i18next';

/**
 * settingsTransfer.js — copy settings from one TV to another.
 *
 * Both TVs hold their whole configuration in one localStorage key, so the
 * payload is simply that object. What makes this usable rather than a blind
 * overwrite is that the *receiving* TV decides what it means: it is the only
 * side that knows its own values, so it compares key by key and shows you only
 * what would actually change, with each row something you can leave out.
 *
 * Three rules shape what is offered:
 *
 *  - Only keys this build knows travel. A payload from a newer TV cannot
 *    introduce a key this one has never heard of, and a payload from an older
 *    one cannot blank a key it has never had.
 *  - Keys on NON_TRANSFERABLE_KEYS never travel: device-bound settings like
 *    spoofViewport, the log receiver's address, and state that only means
 *    something on the TV that wrote it.
 *  - A key with no row in the settings tree is not offered either. That is a
 *    deliberate safety property rather than a shortcut: if a value cannot be
 *    named and shown on screen, it is not something to copy between TVs.
 *
 * The payload carries only what differs from this build's defaults, so it stays
 * small and a default that changed in a later version is not frozen into it.
 */

// Bumped only for a change the other side could not otherwise understand.
export const PAYLOAD_VERSION = 1;

const UNDO_KEY = 'ytaf-settings-undo';

/** Every config key that is allowed to move between TVs. */
export function transferableKeys() {
    const labels = settingsLabelMap();
    return configKnownKeys()
        .filter((key) => NON_TRANSFERABLE_KEYS.indexOf(key) === -1)
        .filter((key) => !!labels[key]);
}

function sameValue(a, b) {
    if (a === b) return true;
    // Arrays and the few object-valued keys: compared as stored, since that is
    // what would be written.
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch (e) {
        return false;
    }
}

/**
 * What this TV would hand to another one.
 *
 * Only keys that differ from the defaults: everything else the other TV will
 * already have, and sending it would turn "nothing to import" into a list of
 * rows that change nothing.
 */
export function buildPayload() {
    const stored = configAll();
    const settings = {};
    for (const key of transferableKeys()) {
        const value = Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : configDefault(key);
        if (sameValue(value, configDefault(key))) continue;
        settings[key] = value;
    }
    return { version: PAYLOAD_VERSION, settings };
}

// ---- naming things ----

let _labelCache = null;

/**
 * config key → { label, section, values }, read off the settings tree.
 *
 * `values` is only present for a key offered as a list of choices, and maps the
 * stored value to the name shown for it, so a row can say "VP9 → AV1" rather
 * than printing the raw value.
 */
export function settingsLabelMap() {
    if (_labelCache) return _labelCache;
    const map = {};
    try {
        const walk = (node, section) => {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) {
                for (const child of node) walk(child, section);
                return;
            }
            const name = typeof node.name === 'string' ? node.name : null;

            // A row offering one of several values for one key: { name, key, value }.
            if (name && typeof node.key === 'string' && node.value !== undefined && node.value !== null) {
                const entry = map[node.key] || (map[node.key] = { label: node.key, section, values: {} });
                entry.values = entry.values || {};
                entry.values[String(node.value)] = name;
            } else if (name && typeof node.value === 'string') {
                // A row that is the setting itself: value is the config key.
                const existing = map[node.value];
                map[node.value] = { label: name, section, values: existing?.values };
            }

            const nextSection = name && (node.value === null || node.value === undefined) ? name : section;
            for (const key of Object.keys(node)) {
                if (key === 'name' || key === 'icon' || key === 'action') continue;
                walk(node[key], nextSection);
            }
        };
        walk(builtSettingsTree(), null);

        // A key offered only as a list of choices has no row of its own, so it
        // has collected value names but no label. Name it after its section.
        for (const key of Object.keys(map)) {
            const entry = map[key];
            if (entry.label === key && entry.section) entry.label = entry.section;
        }
        // Not cached while the tree is still empty: the menu may not have
        // drawn yet, and an empty map kept forever would label every row with
        // its config key for the rest of the session.
        if (Object.keys(map).length) _labelCache = map;
    } catch (err) {
        appendFileOnlyLog('settingsTransfer.labels.error', { message: err?.message || String(err) });
        return map;
    }
    return _labelCache || map;
}

/** How a stored value should read on screen. */
export function describeValue(key, value, labels) {
    const entry = (labels || settingsLabelMap())[key];
    try {
        if (entry?.values && entry.values[String(value)]) return entry.values[String(value)];
        if (value === true) return t('settingsTransfer.on');
        if (value === false) return t('settingsTransfer.off');
        if (value === null || value === undefined) return t('settingsTransfer.off');
        if (Array.isArray(value)) return t('settingsTransfer.itemCount', { count: value.length });
        if (typeof value === 'object') return t('settingsTransfer.itemCount', { count: Object.keys(value).length });
        return String(value);
    } catch (e) {
        return String(value);
    }
}

// ---- the diff ----

/**
 * What applying this payload would change on this TV, one row per key.
 *
 * Keys whose value already matches are left out entirely, which is the whole
 * point: an import between two TVs that already agree has nothing to show.
 */
export function diffAgainstLocal(payload) {
    const result = { rows: [], skipped: 0, version: payload?.version ?? null };
    if (!payload || typeof payload !== 'object' || !payload.settings || typeof payload.settings !== 'object') {
        result.error = 'malformed';
        return result;
    }

    const labels = settingsLabelMap();
    const allowed = transferableKeys();
    const defaults = {};
    for (const key of allowed) defaults[key] = configDefault(key);

    // A key missing from the payload is at the sender's default, which is this
    // build's default too — the payload only carries what differs. So the
    // comparison covers every transferable key, not just the ones sent.
    for (const key of allowed) {
        const incoming = Object.prototype.hasOwnProperty.call(payload.settings, key)
            ? payload.settings[key]
            : defaults[key];
        const current = configRead(key);
        if (sameValue(current, incoming)) continue;
        result.rows.push({
            key,
            label: labels[key]?.label || key,
            section: labels[key]?.section || null,
            from: current,
            to: incoming,
            fromText: describeValue(key, current, labels),
            toText: describeValue(key, incoming, labels),
        });
    }

    // Anything the sender had that this build cannot use. Counted, not listed:
    // there is nothing to decide about it.
    for (const key of Object.keys(payload.settings)) {
        if (allowed.indexOf(key) === -1) result.skipped++;
    }

    result.rows.sort((a, b) => String(a.section).localeCompare(String(b.section))
        || String(a.label).localeCompare(String(b.label)));
    return result;
}

/**
 * Write the rows whose keys are in `keys`, and keep what they were.
 *
 * The snapshot is what makes this safe to try: a TV where every setting
 * changed at once and something now misbehaves is otherwise a long evening.
 */
export function applyRows(rows, keys) {
    const wanted = Array.isArray(keys) ? keys : rows.map((row) => row.key);
    const undo = {};
    let applied = 0;
    for (const row of rows) {
        if (wanted.indexOf(row.key) === -1) continue;
        undo[row.key] = row.from;
        configWrite(row.key, row.to);
        applied++;
    }
    if (applied) {
        try {
            window.localStorage[UNDO_KEY] = JSON.stringify({ at: Date.now(), settings: undo });
        } catch (e) {
            // Losing the undo is not a reason to lose the import.
        }
    }
    appendFileOnlyLog('settingsTransfer.applied', { count: applied, keys: Object.keys(undo) });
    return applied;
}

/** True when there is something to undo. */
export function hasUndo() {
    try {
        const raw = window.localStorage[UNDO_KEY];
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return !!parsed && !!parsed.settings && Object.keys(parsed.settings).length > 0;
    } catch (e) {
        return false;
    }
}

/** Put back whatever the last import changed. */
export function undoImport() {
    try {
        const parsed = JSON.parse(window.localStorage[UNDO_KEY]);
        const settings = parsed?.settings || {};
        let restored = 0;
        for (const key of Object.keys(settings)) {
            configWrite(key, settings[key]);
            restored++;
        }
        delete window.localStorage[UNDO_KEY];
        appendFileOnlyLog('settingsTransfer.undone', { count: restored });
        return restored;
    } catch (err) {
        appendFileOnlyLog('settingsTransfer.undo.error', { message: err?.message || String(err) });
        return 0;
    }
}
