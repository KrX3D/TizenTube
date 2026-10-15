import { buttonItem, overlayPanelItemListRenderer, showModal, showToast } from './ytUI.js';
import {
    CHANNEL_NAME_KIND,
    CHANNEL_PAGE_KIND,
    PLAYLIST_KIND,
    allExemptions,
    removeExemption,
} from '../features/hideWatchedExemptions.js';
import { t } from 'i18next';

/**
 * hideWatchedExemptionsSettings.js — review what has been exempted from hiding
 * watched videos, and put any of it back.
 *
 * The same reason hiddenChannelsSettings.js exists: the menu entry that sets an
 * exemption is on a tile, and the exemptions are reachable from one page each.
 * Without a list in the settings there would be no way to see what has been set
 * without visiting every playlist and channel to check, and a playlist exempted
 * by accident would stay that way unnoticed.
 *
 * All three kinds in one screen rather than three screens, with a line saying
 * which kind each row is. Three screens of mostly one row each would be worse
 * to use than one screen of three.
 */

// Verified against the icon names already used elsewhere in the settings tree;
// a Material name that the TV app does not carry silently shows no icon.
const ICON_FOR_KIND = {};
ICON_FOR_KIND[PLAYLIST_KIND] = 'PLAYLIST_PLAY';
ICON_FOR_KIND[CHANNEL_PAGE_KIND] = 'ACCOUNT_CIRCLE';
ICON_FOR_KIND[CHANNEL_NAME_KIND] = 'PERSON';

const LABEL_FOR_KIND = {};
LABEL_FOR_KIND[PLAYLIST_KIND] = 'settings.options.uiSettings.options.hideWatchedVideos.options.exemptions.kinds.playlist';
LABEL_FOR_KIND[CHANNEL_PAGE_KIND] = 'settings.options.uiSettings.options.hideWatchedVideos.options.exemptions.kinds.channelPage';
LABEL_FOR_KIND[CHANNEL_NAME_KIND] = 'settings.options.uiSettings.options.hideWatchedVideos.options.exemptions.kinds.channelName';

function showSetting(settingType, parameters) {
    try {
        if (settingType === 'REMOVE_HIDE_WATCHED_EXEMPTION') {
            const kind = parameters?.kind;
            const id = parameters?.id;
            const title = parameters?.title || id;
            if (removeExemption(kind, id)) {
                showToast('TizenTube', t('toasts.hideWatchedExemptionRemoved', { name: title }));
            }
            return showSetting('hideWatchedExemptions', true);
        }

        const exemptions = allExemptions();
        const buttons = exemptions.length
            ? exemptions.map(entry => buttonItem(
                {
                    title: entry.title,
                    subtitle: t(LABEL_FOR_KIND[entry.kind] || LABEL_FOR_KIND[PLAYLIST_KIND])
                },
                { icon: ICON_FOR_KIND[entry.kind] || null },
                [{
                    customAction: {
                        action: 'REMOVE_HIDE_WATCHED_EXEMPTION',
                        parameters: { kind: entry.kind, id: entry.id, title: entry.title }
                    }
                }]
            ))
            // A modal with no rows reads as broken rather than as empty.
            : [buttonItem(
                { title: t('settings.options.uiSettings.options.hideWatchedVideos.options.exemptions.empty') },
                { icon: null },
                [{ signalAction: { signal: 'POPUP_BACK' } }]
            )];

        return showModal(
            {
                title: t('settings.options.uiSettings.options.hideWatchedVideos.options.exemptions.title'),
                subtitle: t('settings.options.uiSettings.options.hideWatchedVideos.options.exemptions.subtitle')
            },
            overlayPanelItemListRenderer(buttons),
            'tt-hide-watched-exemptions',
            parameters === true
        );
    } catch (err) {
        console.warn('[hideWatchedExemptionsSettings] failed:', err);
    }
}

export default showSetting;
