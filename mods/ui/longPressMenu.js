import { configRead } from '../config.js';
import { MenuServiceItemRenderer, MenuNavigationItemRenderer } from './ytUI.js';
import { getUserPlaylists, refreshUserPlaylists } from '../utils/innerTubeCalls.js';
import { channelNameOf } from '../features/channelHider.js';
import { t } from 'i18next';

/**
 * longPressMenu.js — the menu shown when a tile is long-pressed.
 *
 * Was a fixed list inside ytUI.js. Every entry now has an id, which is what
 * makes the two requested settings possible: the order is a list of ids, and
 * hiding is a list of ids. An entry with no id — anything YouTube itself put in
 * the menu — is left exactly where it is and never hidden, since this fork did
 * not put it there and has no business reordering it.
 *
 * Entries are tagged on the renderer itself rather than tracked alongside it,
 * because the menu is handed to YouTube's UI and comes back to us only as that
 * array. YouTube ignores fields it does not know, which this file already
 * relies on elsewhere.
 */

const ID_FIELD = '__ttMenuId';

// The order entries appear in when nothing has been configured, which is also
// the order the settings screen lists them in the first time it is opened.
export const DEFAULT_ORDER = ['play', 'playNext', 'watchLater', 'playlists', 'savePlaylist', 'removeFromPlaylist', 'queue', 'share', 'channel', 'hideChannel'];

// Label for each id, for the settings screen. Dynamic entries (one per
// playlist) share the single id 'playlists' and move and hide as one block.
export const ENTRY_LABELS = {
    play: 'videoMenu.play',
    watchLater: 'videoMenu.watchLater',
    playlists: 'videoMenu.yourPlaylists',
    savePlaylist: 'videoMenu.savePlaylist',
    removeFromPlaylist: 'videoMenu.removeFromPlaylist',
    playNext: 'videoMenu.playNext',
    queue: 'videoMenu.addToQueue',
    channel: 'videoMenu.goToChannel',
    share: 'videoMenu.share',
    hideChannel: 'videoMenu.hideChannel',
    notInterested: 'videoMenu.notInterested',
    dontRecommendChannel: 'videoMenu.dontRecommendChannel',
};

// A long press menu is a list on a TV screen; past a point it is faster to open
// the playlist picker than to scroll. Playlists beyond this are left to it.
const MAX_PLAYLIST_ENTRIES = 15;

/** Tag a renderer with the id its settings entry uses. */
export function tagMenuItem(id, renderer) {
    try { renderer[ID_FIELD] = id; } catch (_) { }
    return renderer;
}

export function menuItemId(renderer) {
    return renderer && typeof renderer === 'object' ? renderer[ID_FIELD] || null : null;
}

function configuredOrder() {
    const stored = configRead('longPressMenuOrder');
    const order = Array.isArray(stored) && stored.length ? stored.slice() : DEFAULT_ORDER.slice();
    // Anything the stored order has never seen still has to appear, or a new
    // entry would be invisible until the order was reset — the same mistake the
    // sidebar ordering made before it was fixed.
    for (const id of DEFAULT_ORDER) if (order.indexOf(id) === -1) order.push(id);
    return order;
}

export function isEntryHidden(id) {
    if (!id) return false;
    try {
        const hidden = configRead('longPressMenuHidden');
        return Array.isArray(hidden) && hidden.indexOf(id) !== -1;
    } catch (_) {
        return false;
    }
}

/**
 * Apply the user's order and hiding to a finished menu.
 *
 * Untagged entries keep their position: they are measured from the start of the
 * list, and put back at the same index afterwards, so a menu YouTube built with
 * our entries appended does not get shuffled around them.
 */
export function applyMenuPreferences(items) {
    if (!Array.isArray(items)) return items;
    const order = configuredOrder();
    const rank = (item) => {
        const id = menuItemId(item);
        if (!id) return -1;
        const at = order.indexOf(id);
        return at === -1 ? order.length : at;
    };

    const kept = items.filter((item) => !isEntryHidden(menuItemId(item)));
    // Only ours are sorted; the rest stay in the order they arrived.
    const theirs = kept.filter((item) => !menuItemId(item));
    // Decorated with the original index and compared on it as a tie-break, so
    // entries of equal rank — every playlist shares one id — keep their order.
    // Array.prototype.sort is only guaranteed stable from Chromium 70, and 5.5
    // ships 69.
    const ours = kept.filter((item) => menuItemId(item)).map((item, index) => ({ item, index }));
    ours.sort((a, b) => (rank(a.item) - rank(b.item)) || (a.index - b.index));

    items.length = 0;
    for (const item of theirs) items.push(item);
    for (const entry of ours) items.push(entry.item);
    return items;
}

function watchLaterEntry(data) {
    const isWatchLaterItem = data.watchEndpointData?.playlistId === 'WL';
    const action = isWatchLaterItem
        ? { removedVideoId: data.videoId, action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID' }
        : { addedVideoId: data.videoId, action: 'ACTION_ADD_VIDEO' };
    return tagMenuItem('watchLater', MenuServiceItemRenderer(
        isWatchLaterItem ? t('videoMenu.removeFromWatchLater') : t('videoMenu.watchLater'),
        {
            clickTrackingParams: null,
            commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/browse/edit_playlist' } },
            playlistEditEndpoint: { playlistId: 'WL', actions: [action] }
        }
    ));
}

// One entry per playlist of yours, so a video can go straight into it instead
// of through YouTube's picker. Built from the list innerTubeCalls keeps warm;
// the menu is assembled while a response is being processed and cannot wait for
// a fetch, so a playlist list that is not ready yet simply adds no entries and
// the next menu has them.
function playlistEntries(data) {
    if (!configRead('longPressShowPlaylists')) return [];
    const all = getUserPlaylists() || [];
    // An empty selection means all of them, so switching the feature on shows
    // something before anything has been picked.
    const chosen = configRead('longPressPlaylistIds');
    const playlists = Array.isArray(chosen) && chosen.length
        ? all.filter(p => chosen.indexOf(p?.playlistId) !== -1)
        : all;
    const entries = [];
    for (const playlist of playlists.slice(0, MAX_PLAYLIST_ENTRIES)) {
        if (!playlist?.playlistId || !playlist?.title) continue;
        entries.push(tagMenuItem('playlists', MenuServiceItemRenderer(
            t('videoMenu.addToNamedPlaylist', { name: playlist.title }),
            {
                clickTrackingParams: null,
                // Our own action rather than a playlistEditEndpoint: YouTube's
                // confirmation for one of those says “Watch Later” whichever
                // playlist was written to, which is what was reported.
                playlistEditEndpoint: {
                    customAction: {
                        action: 'ADD_TO_PLAYLIST',
                        parameters: { playlistId: playlist.playlistId, videoId: data.videoId, name: playlist.title }
                    }
                }
            }
        )));
    }
    return entries;
}

// Removing a video from the playlist you are looking at. Shown only there, and
// never on Watch Later, whose own entry already removes.
//
// The playlist is the one the tile belongs to, which it carries on the endpoint
// that opens it — the same field the Watch Later entry reads. Only a playlist
// of yours can be edited; YouTube refuses the rest, which is why the entry says
// "your playlist".
function removeFromPlaylistEntry(data) {
    const playlistId = data.watchEndpointData?.playlistId;
    if (!playlistId || playlistId === 'WL') return [];
    return [tagMenuItem('removeFromPlaylist', MenuServiceItemRenderer(t('videoMenu.removeFromPlaylist'), {
        clickTrackingParams: null,
        commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/browse/edit_playlist' } },
        playlistEditEndpoint: {
            playlistId,
            actions: [{ removedVideoId: data.videoId, action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID' }]
        }
    }))];
}

/** Every entry this fork adds, before the user's order and hiding are applied. */
function baseEntries(data) {
    return [
        tagMenuItem('play', MenuNavigationItemRenderer(t('videoMenu.play'), {
            clickTrackingParams: null,
            watchEndpoint: data.watchEndpointData
        })),
        watchLaterEntry(data),
        ...playlistEntries(data),
        tagMenuItem('savePlaylist', MenuNavigationItemRenderer(t('videoMenu.savePlaylist'), {
            clickTrackingParams: null,
            addToPlaylistEndpoint: { videoId: data.videoId }
        })),
        tagMenuItem('playNext', MenuServiceItemRenderer(t('videoMenu.playNext'), {
            clickTrackingParams: null,
            playlistEditEndpoint: { customAction: { action: 'PLAY_NEXT', parameters: data.item } }
        })),
        ...removeFromPlaylistEntry(data),
        tagMenuItem('queue', MenuServiceItemRenderer(t('videoMenu.addToQueue'), {
            clickTrackingParams: null,
            playlistEditEndpoint: { customAction: { action: 'ADD_TO_QUEUE', parameters: data.item } }
        })),
        // The player can already do this; from a tile it is the only way to get
        // a link off a TV, which has no clipboard and no address bar.
        tagMenuItem('share', MenuServiceItemRenderer(t('videoMenu.share'), {
            clickTrackingParams: null,
            playlistEditEndpoint: { customAction: { action: 'SHARE_VIDEO', parameters: { videoId: data.videoId } } }
        })),
        // The name rather than the item: the filter that acts on it reads the
        // same name off a tile, and hiding has to key on exactly what that sees.
        tagMenuItem('hideChannel', MenuServiceItemRenderer(t('videoMenu.hideChannel'), {
            clickTrackingParams: null,
            playlistEditEndpoint: { customAction: { action: 'HIDE_CHANNEL', parameters: { name: channelNameOf(data.item) } } }
        })),
        tagMenuItem('channel', MenuServiceItemRenderer(t('videoMenu.goToChannel'), {
            clickTrackingParams: null,
            playlistEditEndpoint: { customAction: { action: 'GO_TO_CHANNEL', parameters: data.item } }
        })),
    ];
}

export function longPressData(data) {
    return {
        clickTrackingParams: null,
        showMenuCommand: {
            contentId: data.videoId,
            thumbnail: { thumbnails: data.thumbnails },
            title: { simpleText: data.title },
            subtitle: { simpleText: data.subtitle },
            menu: {
                menuRenderer: {
                    items: applyMenuPreferences(baseEntries(data)),
                    trackingParams: null,
                    accessibility: { accessibilityData: { label: 'Video options' } }
                }
            }
        }
    };
}

// Fetched once shortly after startup, so the FIRST long press already has the
// playlist entries rather than the one after it. Deferred rather than
// immediate: the page is still assembling itself at load, and this is the
// least urgent request the app makes.
if (!window.__ttPlaylistPrefetchScheduled) {
    window.__ttPlaylistPrefetchScheduled = true;
    try {
        setTimeout(() => {
            try { if (configRead('longPressShowPlaylists')) refreshUserPlaylists(); } catch (_) { }
        }, 8000);
    } catch (_) { }
}
