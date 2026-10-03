import { configRead, configWrite } from '../config.js';
import { buttonItem, overlayPanelItemListRenderer, showModal } from './ytUI.js';
import { appendFileOnlyLog } from '../features/hideWatched.js';
import { getUserPlaylists, refreshUserPlaylists } from '../utils/innerTubeCalls.js';
import { t } from 'i18next';

/**
 * longPressPlaylistSettings.js — which of your playlists appear in the long
 * press menu, and in what order.
 *
 * Showing all of them was the first cut, and with more than a handful that is a
 * menu nobody wants to scroll. Two screens, the same pair the menu entries
 * themselves have: a list with a checkbox each for which, and a list where
 * selecting one offers Move up / Move down for the order. Which playlists
 * appear and what order they appear in are separate stored lists, so ticking
 * one cannot reshuffle the rest.
 *
 * An empty selection means all of them, so switching the feature on still
 * shows something before anything has been picked.
 */

const WHICH_KEY = 'longPressPlaylistIds';
const ORDER_KEY = 'longPressPlaylistOrder';

/**
 * Drop ids of playlists that no longer exist.
 *
 * Reported: a playlist picked here and then deleted on YouTube leaves its id
 * behind. The menu already ignores it — there is nothing to build an entry
 * from — but the id sits in the setting where the picker cannot show it, so it
 * cannot be unticked either. Pruned when this screen opens, which is the point
 * at which the live list is in hand and a write is expected.
 *
 * Only ever called with a non-empty live list: the fetch caches an empty
 * result as a failure rather than as "you have no playlists", and pruning
 * against nothing would wipe the selection.
 */
function pruneStaleIds(playlists) {
    const live = playlists.map((playlist) => playlist.playlistId);
    for (const key of [WHICH_KEY, ORDER_KEY]) {
        const stored = configRead(key);
        if (!Array.isArray(stored) || !stored.length) continue;
        const kept = stored.filter((id) => live.indexOf(id) !== -1);
        if (kept.length === stored.length) continue;
        appendFileOnlyLog('longPress.playlistsPruned', {
            key,
            before: stored.length,
            after: kept.length,
            removed: stored.filter((id) => live.indexOf(id) === -1),
        });
        // An emptied selection is written back as empty, which is the same as
        // "all of them" — the only sensible reading once every playlist you
        // had picked is gone.
        configWrite(key, kept);
    }
}

/** Ids in their stored order, with anything the order has not seen appended. */
function orderedIds(playlists) {
    const stored = configRead(ORDER_KEY);
    const order = Array.isArray(stored) ? stored.slice() : [];
    const live = playlists.map((playlist) => playlist.playlistId);
    const known = order.filter((id) => live.indexOf(id) !== -1);
    for (const id of live) if (known.indexOf(id) === -1) known.push(id);
    return known;
}

/**
 * The ids the order screen shows.
 *
 * The stored order covers every playlist, so unticking one and ticking it
 * again does not lose its place — but the screen only shows the picked ones,
 * and a move has to swap with the neighbour on screen rather than with
 * whatever happens to sit next in the full order.
 */
function displayedIds(playlists) {
    const stored = configRead(WHICH_KEY);
    const chosen = Array.isArray(stored) && stored.length ? stored : null;
    return orderedIds(playlists).filter((id) => !chosen || chosen.indexOf(id) !== -1);
}

function moveEntry(parameters, playlists) {
    const order = orderedIds(playlists);
    const shown = displayedIds(playlists);
    const id = parameters?.playlistId;
    const at = shown.indexOf(id);
    if (at === -1) return showSetting(ORDER_KEY, true);

    // Playlists that are not shown keep their position, so moving a shown one
    // past them cannot quietly reorder them too.
    const swapWith = parameters.direction === 'up' ? shown[at - 1]
        : parameters.direction === 'down' ? shown[at + 1]
            : null;
    if (swapWith) {
        const a = order.indexOf(id);
        const b = order.indexOf(swapWith);
        if (a !== -1 && b !== -1) [order[a], order[b]] = [order[b], order[a]];
    }
    appendFileOnlyLog('longPress.playlistMove', {
        playlistId: id, direction: parameters.direction, from: at, swapWith: swapWith || null
    });
    configWrite(ORDER_KEY, order);
    return showSetting(ORDER_KEY, true);
}

function showMoveButtons(parameters, playlists) {
    const title = playlists.find((playlist) => playlist.playlistId === parameters?.playlistId)?.title;
    const moveButton = (direction, labelKey, icon) => buttonItem(
        {
            title: t(`settings.options.misc.options.longPressMenu.${labelKey}.title`),
            subtitle: t(`settings.options.misc.options.longPressMenu.${labelKey}.subtitle`)
        },
        { icon },
        [
            { customAction: { action: 'MOVE_LONGPRESS_PLAYLIST', parameters: { playlistId: parameters.playlistId, direction } } },
            { signalAction: { signal: 'POPUP_BACK' } }
        ]
    );

    return showModal(
        title || t('settings.options.misc.options.longPressMenu.playlistOrder.title'),
        overlayPanelItemListRenderer([
            moveButton('up', 'moveUp', 'UP_ARROW'),
            moveButton('down', 'moveDown', 'DOWN_ARROW')
        ]),
        'tt-move-longpress-playlist'
    );
}

function toggleId(parameters, playlists) {
    const id = parameters?.playlistId;
    if (!id) return showSetting(WHICH_KEY, true);
    const all = playlists.map((playlist) => playlist.playlistId);
    const stored = configRead(WHICH_KEY);
    // An empty selection means "all", so the first time one is unticked it has
    // to become an explicit list of the others rather than a list of one.
    const current = Array.isArray(stored) && stored.length ? stored.slice() : all.slice();
    const at = current.indexOf(id);
    if (at === -1) current.push(id); else current.splice(at, 1);
    appendFileOnlyLog('longPress.playlistToggled', { playlistId: id, shown: at === -1, count: current.length });
    configWrite(WHICH_KEY, current);
    return showSetting(WHICH_KEY, true);
}

/**
 * @param {string} settingType 'longPressPlaylistIds' to choose which appear,
 *                             'longPressPlaylistOrder' to reorder,
 *                             or one of the actions above
 * @param {*} parameters       action parameters, or true to update the open modal
 */
function showSetting(settingType, parameters) {
    try {
        const playlists = (getUserPlaylists() || []).filter((playlist) => playlist?.playlistId && playlist?.title);

        if (!playlists.length) {
            // Nothing cached yet. Ask for it, and say so rather than showing an
            // empty list that looks like "you have no playlists".
            refreshUserPlaylists();
            return showModal(
                {
                    title: t('settings.options.misc.options.longPressMenu.playlists.title'),
                    subtitle: t('settings.options.misc.options.longPressMenu.playlists.loading')
                },
                overlayPanelItemListRenderer([
                    buttonItem({ title: t('settings.options.misc.options.longPressMenu.playlists.retry') }, { icon: null }, [
                        { customAction: { action: 'SHOW_LONGPRESS_PLAYLISTS' } }
                    ])
                ]),
                'tt-longpress-playlists',
                parameters === true
            );
        }

        if (settingType === 'TOGGLE_LONGPRESS_PLAYLIST') return toggleId(parameters, playlists);
        if (settingType === 'MOVE_LONGPRESS_PLAYLIST') return moveEntry(parameters, playlists);
        if (settingType === 'SHOW_LONGPRESS_PLAYLIST_MOVE') return showMoveButtons(parameters, playlists);

        pruneStaleIds(playlists);

        const isOrderMode = settingType === ORDER_KEY;
        const stored = configRead(WHICH_KEY);
        const chosen = Array.isArray(stored) && stored.length ? stored : null;
        // The order screen lists what the menu actually shows, in the order it
        // shows it — ordering a playlist that does not appear is busywork.
        const listed = isOrderMode
            ? displayedIds(playlists)
            : playlists.map((playlist) => playlist.playlistId);
        const titleOf = (id) => playlists.find((playlist) => playlist.playlistId === id)?.title || id;

        const buttons = listed.map((id) => buttonItem(
            { title: titleOf(id) },
            {
                icon: null,
                secondaryIcon: isOrderMode
                    ? null
                    : ((!chosen || chosen.indexOf(id) !== -1) ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK')
            },
            [{
                customAction: {
                    action: isOrderMode ? 'SHOW_LONGPRESS_PLAYLIST_MOVE' : 'TOGGLE_LONGPRESS_PLAYLIST',
                    parameters: { playlistId: id }
                }
            }]
        ));

        appendFileOnlyLog('longPress.playlistMenu.open', {
            mode: isOrderMode ? 'order' : 'which',
            playlists: playlists.length,
            chosen: chosen ? chosen.length : 'all',
            count: buttons.length,
        });
        return showModal(
            {
                title: isOrderMode
                    ? t('settings.options.misc.options.longPressMenu.playlistOrder.title')
                    : t('settings.options.misc.options.longPressMenu.playlists.title'),
                subtitle: isOrderMode
                    ? t('settings.options.misc.options.longPressMenu.playlistOrder.subtitle')
                    : t('settings.options.misc.options.longPressMenu.playlists.subtitle')
            },
            overlayPanelItemListRenderer(buttons),
            'tt-longpress-playlists',
            parameters === true
        );
    } catch (err) {
        console.warn('[longPressPlaylistSettings] failed:', err);
    }
}

export default showSetting;
