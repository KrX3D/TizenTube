import { getGuide } from '../utils/innerTubeCalls.js';
import { configRead, configWrite } from '../config.js';
import { buttonItem, overlayPanelItemListRenderer, showModal, showToast } from './ytUI.js';
import { appendFileOnlyLog } from '../features/hideWatched.js';
import { t } from 'i18next';
import { guideEntryKey, guideEntryHideKeys, guideEntryTitle } from './guideEntryKey.js';

// Sidebar (guide) customisation — upstream 2f2c567 / 79195bb.
//
// Replaces the previous hardcoded list of sidebar entries with one built from
// the live /guide response, so it always matches what the account actually
// has (localised titles included) instead of a fixed set of icon names. Two
// things are configurable from it:
//
//   disabledSidebarContents — which entries are hidden
//   sidebarContentsOrder    — the order they appear in, plus any channels
//                             added from a channel page
//
// Entries in sidebarContentsOrder are either a plain browseId string (a
// built-in guide entry) or a { browseId, title } object (a channel the user
// pinned there; customGuideAction.js synthesises a guideEntryRenderer for it).

/** Order entries are strings or { browseId } objects — normalise to the id. */
function orderBrowseId(orderItem) {
    return (typeof orderItem === 'object' && orderItem !== null) ? orderItem.browseId : orderItem;
}

function moveGuideButton(parameters) {
    const order = configRead('sidebarContentsOrder');
    if (!Array.isArray(order)) return showSetting('', true);

    const browseId = guideEntryKey(parameters?.item);
    const index = order.findIndex(orderItem => orderBrowseId(orderItem) === browseId);
    // Not in the order list yet (a guide entry that appeared after the order
    // was built) — just reopen the list, which re-syncs it.
    if (index === -1) return showSetting('', true);

    if (parameters.direction === 'up' && index > 0) {
        [order[index - 1], order[index]] = [order[index], order[index - 1]];
    } else if (parameters.direction === 'down' && index < order.length - 1) {
        [order[index + 1], order[index]] = [order[index], order[index + 1]];
    }
    appendFileOnlyLog('sidebar.move', { browseId, direction: parameters.direction, from: index });
    configWrite('sidebarContentsOrder', order);

    return showSetting('', true);
}

function showMoveButtons(settingType, parameters) {
    const title = guideEntryTitle(parameters?.item);

    const moveButton = (direction, labelKey, icon) => buttonItem(
        {
            title: t(`settings.options.uiSettings.options.sortSidebarContents.${labelKey}.title`),
            subtitle: t(`settings.options.uiSettings.options.sortSidebarContents.${labelKey}.subtitle`)
        },
        { icon },
        [
            {
                customAction: {
                    action: 'MOVE_GUIDE_BUTTON',
                    parameters: { settingType, direction, item: parameters.item }
                }
            },
            {
                signalAction: {
                    signal: 'POPUP_BACK'
                }
            }
        ]
    );

    return showModal(
        title,
        overlayPanelItemListRenderer([
            moveButton('up', 'moveUp', 'UP_ARROW'),
            moveButton('down', 'moveDown', 'DOWN_ARROW')
        ]),
        'tt-move-guide-button-modal'
    );
}

// Cap on entries named in the menu-open log line, so an account with many
// pinned channels cannot flood the queue.
const MAX_LOGGED_ENTRIES = 20;

// Hide or show one entry.
//
// A dedicated action rather than the generic setClientSettingEndpoint toggle it
// replaces, because showing an entry again may mean removing more than one key:
// its own, and its icon, which this fork's default list uses for Search, Sport,
// News and the rest. That toggle can only flip a single value — and two values
// in one command flip each other back, since every value is applied once per
// value — so an entry hidden by its icon could never be shown again from this
// menu: pressing it only added its page id as well.
function toggleGuideEntry(parameters) {
    const keys = guideEntryHideKeys(parameters?.item);
    if (!keys.length) return showSetting('disabledSidebarContents', true);
    const disabled = (configRead('disabledSidebarContents') || []).slice();
    const wasHidden = keys.some(k => disabled.includes(k));
    const next = wasHidden ? disabled.filter(k => !keys.includes(k)) : disabled.concat([keys[0]]);
    appendFileOnlyLog('sidebar.toggle', { key: keys[0], keys, hidden: !wasHidden });
    configWrite('disabledSidebarContents', next);
    return showSetting('disabledSidebarContents', true);
}

function showSetting(settingType, parameters) {
    try {
        if (settingType === 'TOGGLE_GUIDE_ENTRY') return toggleGuideEntry(parameters);
        if (settingType === 'MOVE_GUIDE_BUTTON') return moveGuideButton(parameters);
        if (settingType === 'SHOW_GUIDE_BUTTONS') return showMoveButtons(settingType, parameters);

        const isDisableMode = settingType === 'disabledSidebarContents';

        getGuide().then(guide => {
            const buttons = [];
            // customGuideAction.js rewrites guideSectionRenderer.items (hiding
            // and reordering), so read originalItems — otherwise entries the
            // user already hid would be missing from the list that lets them
            // unhide them.
            const guideItems = guide?.items?.[0]?.guideSectionRenderer?.originalItems
                || guide?.items?.[0]?.guideSectionRenderer?.items
                || [];

            // Recorded so a capture shows each entry's real shape — Shorts was
            // added to the sidebar for signed-in accounts only, and its exact
            // structure could not be seen from outside.
            const logged = [];
            for (const item of guideItems) {
                const entry = item?.guideEntryRenderer;
                if (!entry) continue;
                const key = guideEntryKey(item);
                if (!key) continue;
                const disabled = configRead('disabledSidebarContents') || [];
                // Hidden by its own key or, for the default list, by its icon —
                // the box used to check only the first, so entries hidden by
                // default showed as visible.
                const hidden = guideEntryHideKeys(item).some(k => disabled.includes(k));
                if (logged.length < MAX_LOGGED_ENTRIES) {
                    const nav = entry.navigationEndpoint || {};
                    logged.push({
                        title: guideEntryTitle(item).slice(0, 30),
                        key,
                        icon: entry.icon?.iconType || null,
                        endpoint: Object.keys(nav).find(k => /(Endpoint|Command)$/.test(k)) || null,
                        hidden
                    });
                }

                buttons.push(
                    buttonItem(
                        { title: guideEntryTitle(item) || key },
                        {
                            icon: entry.icon?.iconType,
                            secondaryIcon: isDisableMode
                                ? (hidden ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK')
                                : null
                        },
                        isDisableMode
                            ? [
                                {
                                    customAction: {
                                        action: 'TOGGLE_GUIDE_ENTRY',
                                        parameters: { settingType, item }
                                    }
                                }
                            ]
                            : [
                                {
                                    customAction: {
                                        action: 'SHOW_GUIDE_BUTTONS',
                                        parameters: { settingType, item }
                                    }
                                }
                            ]
                    )
                );
            }

            appendFileOnlyLog('sidebar.menu.open', { mode: isDisableMode ? 'disable' : 'sort', count: buttons.length, entries: logged });
            showModal(
                {
                    title: isDisableMode
                        ? t('settings.options.uiSettings.options.disableSidebarContents.title')
                        : t('settings.options.uiSettings.options.sortSidebarContents.title'),
                    subtitle: isDisableMode
                        ? t('settings.options.uiSettings.options.disableSidebarContents.subtitle')
                        : t('settings.options.uiSettings.options.sortSidebarContents.subtitle')
                },
                overlayPanelItemListRenderer(buttons),
                'tt-sidebar-settings',
                parameters === true
            );
        }).catch(err => {
            // Without this the menu just silently doesn't open, which is
            // indistinguishable from the entry being broken.
            console.warn('[sidebarModification] guide fetch failed:', err);
            appendFileOnlyLog('sidebar.guide.error', { msg: String(err?.message || err) });
            showToast('TizenTube', t('toasts.sidebarGuideFetchFailed'));
        });
    } catch (err) {
        console.warn('[sidebarModification] showSetting failed:', err);
        showToast('TizenTube', t('toasts.sidebarGuideFetchFailed'));
    }
}

export default showSetting;
