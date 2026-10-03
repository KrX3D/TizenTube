import { configRead, configWrite } from '../config.js';
import { buttonItem, overlayPanelItemListRenderer, showModal } from './ytUI.js';
import { appendFileOnlyLog } from '../features/hideWatched.js';
import { getUserPlaylists, refreshUserPlaylists } from '../utils/innerTubeCalls.js';
import { t } from 'i18next';

/**
 * longPressPlaylistSettings.js — pick which of your playlists appear in the long
 * press menu.
 *
 * Showing all of them was the first cut, and with more than a handful that is a
 * menu nobody wants to scroll. The stored selection is a list of playlist ids;
 * an empty list means all of them, so switching the feature on still shows
 * something before anything has been picked.
 */

function showSetting(settingType, parameters) {
    try {
        if (settingType === 'TOGGLE_LONGPRESS_PLAYLIST') {
            const id = parameters?.playlistId;
            if (!id) return;
            const all = (getUserPlaylists() || []).map(p => p.playlistId).filter(Boolean);
            const stored = configRead('longPressPlaylistIds');
            // An empty selection means "all", so the first time one is unticked
            // it has to become an explicit list of the others rather than a list
            // of one.
            const current = Array.isArray(stored) && stored.length ? stored.slice() : all.slice();
            const at = current.indexOf(id);
            if (at === -1) current.push(id); else current.splice(at, 1);
            appendFileOnlyLog('longPress.playlistToggled', { playlistId: id, shown: at === -1, count: current.length });
            configWrite('longPressPlaylistIds', current);
            return showSetting('longPressPlaylistIds', true);
        }

        const playlists = getUserPlaylists() || [];
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

        const stored = configRead('longPressPlaylistIds');
        const chosen = Array.isArray(stored) && stored.length ? stored : null;
        const buttons = playlists.map(playlist => buttonItem(
            { title: playlist.title },
            {
                icon: null,
                secondaryIcon: (!chosen || chosen.indexOf(playlist.playlistId) !== -1)
                    ? 'CHECK_BOX'
                    : 'CHECK_BOX_OUTLINE_BLANK'
            },
            [{ customAction: { action: 'TOGGLE_LONGPRESS_PLAYLIST', parameters: { playlistId: playlist.playlistId } } }]
        ));

        appendFileOnlyLog('longPress.playlistMenu.open', { playlists: playlists.length, chosen: chosen ? chosen.length : 'all' });
        return showModal(
            {
                title: t('settings.options.misc.options.longPressMenu.playlists.title'),
                subtitle: t('settings.options.misc.options.longPressMenu.playlists.subtitle')
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
