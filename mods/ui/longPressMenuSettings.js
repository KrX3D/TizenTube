import { configRead, configWrite } from '../config.js';
import { buttonItem, overlayPanelItemListRenderer, showModal } from './ytUI.js';
import { appendFileOnlyLog } from '../features/hideWatched.js';
import { DEFAULT_ORDER, ENTRY_LABELS } from './longPressMenu.js';
import { t } from 'i18next';

/**
 * longPressMenuSettings.js — choose what the long press menu shows, and in what
 * order.
 *
 * Deliberately the same two screens as the sidebar has, since they do the same
 * job: a list with a checkbox per entry for hiding, and a list where selecting
 * an entry offers Move up / Move down. Learning one teaches the other.
 *
 * The catalogue comes from longPressMenu.js rather than being repeated here, so
 * an entry added there shows up in both screens without being registered twice.
 */

/** Ids in their configured order, with anything new appended. */
function orderedIds() {
    const stored = configRead('longPressMenuOrder');
    const order = Array.isArray(stored) && stored.length ? stored.slice() : DEFAULT_ORDER.slice();
    for (const id of Object.keys(ENTRY_LABELS)) if (order.indexOf(id) === -1) order.push(id);
    // An id left over from an older build would otherwise sit in the list with
    // no label and no way to remove it.
    return order.filter(id => ENTRY_LABELS[id]);
}

function moveEntry(parameters) {
    const order = orderedIds();
    const index = order.indexOf(parameters?.id);
    if (index === -1) return showSetting('longPressMenuHidden', true);

    if (parameters.direction === 'up' && index > 0) {
        [order[index - 1], order[index]] = [order[index], order[index - 1]];
    } else if (parameters.direction === 'down' && index < order.length - 1) {
        [order[index + 1], order[index]] = [order[index], order[index + 1]];
    }
    appendFileOnlyLog('longPress.move', { id: parameters.id, direction: parameters.direction, from: index });
    configWrite('longPressMenuOrder', order);
    return showSetting('longPressMenuOrder', true);
}

function showMoveButtons(parameters) {
    const moveButton = (direction, labelKey, icon) => buttonItem(
        {
            title: t(`settings.options.misc.options.longPressMenu.${labelKey}.title`),
            subtitle: t(`settings.options.misc.options.longPressMenu.${labelKey}.subtitle`)
        },
        { icon },
        [
            { customAction: { action: 'MOVE_LONGPRESS_ENTRY', parameters: { id: parameters.id, direction } } },
            { signalAction: { signal: 'POPUP_BACK' } }
        ]
    );

    return showModal(
        t(ENTRY_LABELS[parameters.id] || 'videoMenu.play'),
        overlayPanelItemListRenderer([
            // First argument is the DIRECTION, second the label. Passing the
            // label as both is what stopped every move: moveEntry compares it
            // against 'up' and 'down', so nothing ever matched and it wrote the
            // list back unchanged.
            moveButton('up', 'moveUp', 'UP_ARROW'),
            moveButton('down', 'moveDown', 'DOWN_ARROW')
        ]),
        'tt-move-longpress-entry'
    );
}

function toggleEntry(parameters) {
    const id = parameters?.id;
    if (!id) return showSetting('longPressMenuHidden', true);
    const hidden = (configRead('longPressMenuHidden') || []).slice();
    const at = hidden.indexOf(id);
    if (at === -1) hidden.push(id); else hidden.splice(at, 1);
    appendFileOnlyLog('longPress.toggle', { id, hidden: at === -1 });
    configWrite('longPressMenuHidden', hidden);
    return showSetting('longPressMenuHidden', true);
}

/**
 * @param {string} settingType 'longPressMenuHidden' to choose what is shown,
 *                             'longPressMenuOrder' to reorder,
 *                             or one of the two actions above
 * @param {*} parameters       action parameters, or true to update the open modal
 */
function showSetting(settingType, parameters) {
    try {
        if (settingType === 'MOVE_LONGPRESS_ENTRY') return moveEntry(parameters);
        if (settingType === 'SHOW_LONGPRESS_MOVE') return showMoveButtons(parameters);
        if (settingType === 'TOGGLE_LONGPRESS_ENTRY') return toggleEntry(parameters);

        const isHideMode = settingType === 'longPressMenuHidden';
        const hidden = configRead('longPressMenuHidden') || [];
        const buttons = orderedIds().map(id => buttonItem(
            { title: t(ENTRY_LABELS[id]) },
            {
                icon: null,
                secondaryIcon: isHideMode
                    ? (hidden.indexOf(id) === -1 ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK')
                    : null
            },
            [
                {
                    customAction: {
                        action: isHideMode ? 'TOGGLE_LONGPRESS_ENTRY' : 'SHOW_LONGPRESS_MOVE',
                        parameters: { id }
                    }
                }
            ]
        ));

        appendFileOnlyLog('longPress.menu.open', { mode: isHideMode ? 'hide' : 'sort', count: buttons.length });
        return showModal(
            {
                title: isHideMode
                    ? t('settings.options.misc.options.longPressMenu.visible.title')
                    : t('settings.options.misc.options.longPressMenu.sort.title'),
                subtitle: isHideMode
                    ? t('settings.options.misc.options.longPressMenu.visible.subtitle')
                    : t('settings.options.misc.options.longPressMenu.sort.subtitle')
            },
            overlayPanelItemListRenderer(buttons),
            'tt-longpress-menu-settings',
            parameters === true
        );
    } catch (err) {
        console.warn('[longPressMenuSettings] failed:', err);
    }
}

export default showSetting;
