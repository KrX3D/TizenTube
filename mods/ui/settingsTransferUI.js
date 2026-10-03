import { buttonItem, overlayPanelItemListRenderer, showModal, showToast } from './ytUI.js';
import { appendFileOnlyLog } from '../features/hideWatched.js';
import {
    buildPayload, diffAgainstLocal, applyRows, hasUndo, undoImport
} from '../features/settingsTransfer.js';
import {
    channelKind, channelAvailable, startSharing, stopSharing, findPeers, fetchPeerSettings
} from '../features/settingsChannel.js';
import { t } from 'i18next';

/**
 * settingsTransferUI.js — the two screens for copying settings between TVs.
 *
 * Export is one screen: it hands this TV's settings to the local service,
 * which serves them to the other TV while the screen is open.
 *
 * Import is three: the TVs found on the network, then the list of what would
 * actually change — only the settings that differ, each one something you can
 * leave out — and then the result, with an undo.
 *
 * The change list is computed here, on the receiving TV, because this is the
 * only side that knows its own values. Nothing is written until Apply.
 */

const PREFIX = 'settingsTransfer.';

// The last diff, kept between opening the list and pressing Apply: the rows
// carry the values to write, and recomputing them on Apply would mean asking
// the other TV a second time.
let _pending = null;
let _deselected = [];

function tx(key, opts) {
    return t(PREFIX + key, opts);
}

function note(message) {
    showToast('TizenTube', message);
}

function unavailableScreen(update) {
    // TizenBrew's HTTPS Cobalt context: the page cannot reach any local
    // server, and TizenBrew's own CDP poll only carries log lines one way, so
    // there is nothing to carry an answer back on. Said plainly rather than
    // leaving a screen that never finishes loading.
    return showModal(
        { title: tx('title'), subtitle: tx('unavailable') },
        overlayPanelItemListRenderer([
            buttonItem({ title: tx('close') }, { icon: null }, [{ signalAction: { signal: 'POPUP_BACK' } }])
        ]),
        'tt-settings-transfer',
        update === true
    );
}

// ---- export ----

export function showExport(update) {
    if (!channelAvailable()) return unavailableScreen(update);

    const payload = buildPayload();
    const count = Object.keys(payload.settings).length;

    startSharing(payload).then((result) => {
        appendFileOnlyLog('settingsTransfer.sharing', { ok: !!(result && result.ok), settings: count, channel: channelKind() });
        if (!result || !result.ok) note(tx('shareFailed'));
    }).catch((err) => {
        appendFileOnlyLog('settingsTransfer.share.error', { message: err?.message || String(err) });
        note(tx('shareFailed'));
    });

    return showModal(
        { title: tx('export.title'), subtitle: tx('export.subtitle', { count }) },
        overlayPanelItemListRenderer([
            buttonItem(
                { title: tx('export.stop'), subtitle: tx('export.stopSubtitle') },
                { icon: null },
                [
                    { customAction: { action: 'TT_SETTINGS_SHARE_STOP' } },
                    { signalAction: { signal: 'POPUP_BACK' } }
                ]
            )
        ]),
        'tt-settings-export',
        update === true
    );
}

export function stopExport() {
    stopSharing().then(() => note(tx('export.stopped')));
}

// ---- import ----

export function showImport(update) {
    if (!channelAvailable()) return unavailableScreen(update);

    findPeers().then((result) => {
        const peers = (result && result.peers) || [];
        appendFileOnlyLog('settingsTransfer.peers', { count: peers.length, channel: channelKind() });
        const buttons = peers.map((peer) => buttonItem(
            {
                title: peer.name && peer.name !== peer.host ? peer.name + ' (' + peer.host + ')' : peer.host,
                subtitle: peer.sharing ? tx('import.peerSharing') : tx('import.peerNotSharing')
            },
            { icon: null },
            [{ customAction: { action: 'TT_SETTINGS_IMPORT_FROM', parameters: { host: peer.host } } }]
        ));
        if (!buttons.length) {
            buttons.push(buttonItem(
                { title: tx('import.noneFound'), subtitle: tx('import.noneFoundSubtitle') },
                { icon: null },
                [{ customAction: { action: 'TT_SETTINGS_IMPORT' } }]
            ));
        }
        showModal(
            { title: tx('import.title'), subtitle: tx('import.subtitle') },
            overlayPanelItemListRenderer(buttons),
            'tt-settings-import',
            true
        );
    }).catch((err) => {
        appendFileOnlyLog('settingsTransfer.peers.error', { message: err?.message || String(err) });
        note(tx('import.searchFailed'));
    });

    // Shown while the search runs; the list replaces it.
    return showModal(
        { title: tx('import.title'), subtitle: tx('import.searching') },
        overlayPanelItemListRenderer([
            buttonItem({ title: tx('import.searching') }, { icon: null }, [{ signalAction: { signal: 'POPUP_BACK' } }])
        ]),
        'tt-settings-import',
        update === true
    );
}

/** Ask one TV what it has, and show what it would change here. */
export function showChanges(parameters, update) {
    const host = parameters?.host;
    if (!host) return;

    fetchPeerSettings(host).then((result) => {
        if (!result || !result.ok || !result.payload) {
            note(tx('import.fetchFailed'));
            return;
        }
        const diff = diffAgainstLocal(result.payload);
        if (diff.error) {
            note(tx('import.fetchFailed'));
            return;
        }
        _pending = { host, name: result.name || host, diff };
        _deselected = [];
        appendFileOnlyLog('settingsTransfer.diff', {
            host, count: diff.rows.length, skipped: diff.skipped,
            keys: diff.rows.map((row) => row.key),
        });
        renderChanges(true);
    }).catch((err) => {
        appendFileOnlyLog('settingsTransfer.fetch.error', { message: err?.message || String(err) });
        note(tx('import.fetchFailed'));
    });

    return showModal(
        { title: tx('import.title'), subtitle: tx('import.reading') },
        overlayPanelItemListRenderer([
            buttonItem({ title: tx('import.reading') }, { icon: null }, [{ signalAction: { signal: 'POPUP_BACK' } }])
        ]),
        'tt-settings-changes',
        update === true
    );
}

function renderChanges(update) {
    if (!_pending) return;
    const { diff, name } = _pending;

    // Nothing differing is a real answer, not an empty screen.
    if (!diff.rows.length) {
        return showModal(
            { title: tx('changes.title'), subtitle: tx('changes.identical', { name }) },
            overlayPanelItemListRenderer([
                buttonItem({ title: tx('close') }, { icon: null }, [{ signalAction: { signal: 'POPUP_BACK' } }])
            ]),
            'tt-settings-changes',
            update === true
        );
    }

    const buttons = [];
    let section = null;
    for (const row of diff.rows) {
        // Grouped under the menu each setting lives in, so a long list reads
        // as sections rather than as one scroll.
        if (row.section && row.section !== section) {
            section = row.section;
            buttons.push(buttonItem(
                { title: section },
                { icon: null },
                [{ signalAction: { signal: 'NONE' } }]
            ));
        }
        const chosen = _deselected.indexOf(row.key) === -1;
        buttons.push(buttonItem(
            {
                title: row.label,
                subtitle: row.fromText + '  →  ' + row.toText
            },
            { icon: null, secondaryIcon: chosen ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK' },
            [{ customAction: { action: 'TT_SETTINGS_TOGGLE_ROW', parameters: { key: row.key } } }]
        ));
    }

    const selected = diff.rows.filter((row) => _deselected.indexOf(row.key) === -1).length;
    buttons.push(buttonItem(
        { title: tx('changes.apply', { count: selected }) },
        { icon: null },
        [
            { customAction: { action: 'TT_SETTINGS_APPLY' } },
            { signalAction: { signal: 'POPUP_BACK' } }
        ]
    ));
    buttons.push(buttonItem(
        { title: selected ? tx('changes.selectNone') : tx('changes.selectAll') },
        { icon: null },
        [{ customAction: { action: 'TT_SETTINGS_SELECT', parameters: { all: selected === 0 } } }]
    ));

    return showModal(
        {
            title: tx('changes.title'),
            subtitle: diff.skipped
                ? tx('changes.subtitleSkipped', { count: diff.rows.length, skipped: diff.skipped, name })
                : tx('changes.subtitle', { count: diff.rows.length, name })
        },
        overlayPanelItemListRenderer(buttons),
        'tt-settings-changes',
        update === true
    );
}

export function toggleRow(parameters) {
    const key = parameters?.key;
    if (!key || !_pending) return;
    const at = _deselected.indexOf(key);
    if (at === -1) _deselected.push(key); else _deselected.splice(at, 1);
    return renderChanges(true);
}

export function selectRows(parameters) {
    if (!_pending) return;
    _deselected = parameters?.all ? [] : _pending.diff.rows.map((row) => row.key);
    return renderChanges(true);
}

export function applyChanges() {
    if (!_pending) return;
    const keys = _pending.diff.rows
        .map((row) => row.key)
        .filter((key) => _deselected.indexOf(key) === -1);
    const applied = applyRows(_pending.diff.rows, keys);
    _pending = null;
    _deselected = [];
    note(applied ? tx('applied', { count: applied }) : tx('appliedNone'));
}

export function showUndo(update) {
    if (!hasUndo()) {
        note(tx('undo.nothing'));
        return;
    }
    return showModal(
        { title: tx('undo.title'), subtitle: tx('undo.subtitle') },
        overlayPanelItemListRenderer([
            buttonItem({ title: tx('undo.confirm') }, { icon: null }, [
                { customAction: { action: 'TT_SETTINGS_UNDO_APPLY' } },
                { signalAction: { signal: 'POPUP_BACK' } }
            ]),
            buttonItem({ title: tx('close') }, { icon: null }, [{ signalAction: { signal: 'POPUP_BACK' } }])
        ]),
        'tt-settings-undo',
        update === true
    );
}

export function applyUndo() {
    const restored = undoImport();
    note(restored ? tx('undo.done', { count: restored }) : tx('undo.nothing'));
}
