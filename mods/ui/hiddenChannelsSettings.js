import { configRead, configWrite } from '../config.js';
import { buttonItem, overlayPanelItemListRenderer, showModal, showToast } from './ytUI.js';
import { appendFileOnlyLog } from '../features/hideWatched.js';
import { t } from 'i18next';

/**
 * hiddenChannelsSettings.js — review the channels hidden from the long press
 * menu, and bring any of them back.
 *
 * Without this, hiding a channel would be one-way: the menu entry that hides it
 * is on a tile from that channel, and once hidden there are no such tiles left
 * to long-press.
 */

function showSetting(settingType, parameters) {
    try {
        if (settingType === 'UNHIDE_CHANNEL') {
            const name = parameters?.name;
            const channels = (configRead('hiddenChannels') || []).filter(c => c !== name);
            appendFileOnlyLog('channelHider.unhidden', { channel: String(name).slice(0, 60) });
            configWrite('hiddenChannels', channels);
            showToast('TizenTube', t('toasts.channelShownAgain', { name }));
            return showSetting('hiddenChannels', true);
        }

        const channels = configRead('hiddenChannels') || [];
        const buttons = channels.length
            ? channels.map(name => buttonItem(
                { title: name, subtitle: t('settings.options.uiSettings.options.hiddenChannels.unhide') },
                { icon: 'PERSON' },
                [{ customAction: { action: 'UNHIDE_CHANNEL', parameters: { name } } }]
            ))
            // A modal with no rows reads as broken rather than as empty.
            : [buttonItem({ title: t('settings.options.uiSettings.options.hiddenChannels.empty') }, { icon: null }, [
                { signalAction: { signal: 'POPUP_BACK' } }
            ])];

        appendFileOnlyLog('channelHider.menu.open', { count: channels.length });
        return showModal(
            {
                title: t('settings.options.uiSettings.options.hiddenChannels.title'),
                subtitle: t('settings.options.uiSettings.options.hiddenChannels.subtitle')
            },
            overlayPanelItemListRenderer(buttons),
            'tt-hidden-channels',
            parameters === true
        );
    } catch (err) {
        console.warn('[hiddenChannelsSettings] failed:', err);
    }
}

export default showSetting;
