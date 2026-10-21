import { configRead } from '../config.js';
import { MenuServiceItemRenderer, MenuNavigationItemRenderer } from './ytUI.js';
import { getUserPlaylists, refreshUserPlaylists, innerTubeReady, cachedPlaylistCount } from '../utils/innerTubeCalls.js';
import { appendFileOnlyLog } from '../features/hideWatched.js';
import { channelNameOf } from '../features/channelHider.js';
import { detectCurrentPage } from '../features/hideWatched.js';
import { currentPlaylistEditable } from '../features/playlistOwnership.js';
import {
    currentChannelId,
    isChannelNameExempt,
    isChannelPageExempt,
    isPlaylistExempt,
    normalisePlaylistId,
} from '../features/hideWatchedExemptions.js';
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
export const DEFAULT_ORDER = ['play', 'playPlaylist', 'playNext', 'watchLater', 'playlists', 'savePlaylist', 'removeFromPlaylist', 'queue', 'share', 'channel', 'hideChannel', 'markWatched', 'showWatchedPlaylist', 'showWatchedChannelPage', 'showWatchedChannelEverywhere'];

// Label for each id, for the settings screen. Dynamic entries (one per
// playlist) share the single id 'playlists' and move and hide as one block.
export const ENTRY_LABELS = {
    play: 'videoMenu.play',
    // A playlist tile's own Play, kept separate from the video menu's: playing
    // a playlist and playing a video are different things to want, and
    // somebody who has switched Play off for videos has said nothing about
    // playlists.
    //
    // Share is deliberately NOT separate — it shares the video menu's 'share'
    // id, so one setting covers both. Asked for, and the more obvious reading
    // of a single Share setting. The separation existed because reusing the id
    // let the video menu's hidden list empty this menu below the entry count
    // the app needed to draw it; browseTileMenu.js draws it now, so that
    // reason is gone.
    playPlaylist: 'videoMenu.playPlaylist',
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
    // The three exemption toggles. Their labels in the menu flip to say what
    // the press will do; these are the fixed names the settings screen lists
    // them under, which cannot flip or the list would reword itself depending
    // on which playlist you last looked at.
    markWatched: 'videoMenu.markWatched',
    showWatchedPlaylist: 'videoMenu.showWatchedPlaylist',
    showWatchedChannelPage: 'videoMenu.showWatchedChannelPage',
    showWatchedChannelEverywhere: 'videoMenu.showWatchedChannelEverywhere',
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
/**
 * The playlists the menu should show, in the order it should show them.
 *
 * Exported because the settings screens have to agree with the menu about
 * both questions, and the rules are not obvious enough to state twice.
 */
export function pickedPlaylists(all) {
    const list = Array.isArray(all) ? all.filter(p => p?.playlistId && p?.title) : [];
    const chosen = configRead('longPressPlaylistIds');
    let picked = list;
    if (Array.isArray(chosen) && chosen.length) {
        picked = list.filter(p => chosen.indexOf(p.playlistId) !== -1);
        // Every picked playlist is gone — deleted on YouTube, or the TV is
        // signed into another account. Reported as a worry, and it would
        // otherwise be a dead end: the menu would show no playlists while the
        // picker showed them all unticked, with nothing to untick to recover.
        // An unusable selection is treated as no selection.
        if (!picked.length) picked = list;
    }
    return sortByConfiguredOrder(picked);
}

/** Ordered by the stored order; anything it has not seen keeps YouTube's. */
function sortByConfiguredOrder(playlists) {
    const order = configRead('longPressPlaylistOrder');
    if (!Array.isArray(order) || !order.length) return playlists;
    const rank = (playlist) => {
        const at = order.indexOf(playlist.playlistId);
        return at === -1 ? order.length : at;
    };
    // Decorated with the arrival index and compared on it as a tie-break:
    // Array.prototype.sort is only stable from Chromium 70, and 5.5 ships 69.
    return playlists
        .map((playlist, index) => ({ playlist, index }))
        .sort((a, b) => (rank(a.playlist) - rank(b.playlist)) || (a.index - b.index))
        .map((entry) => entry.playlist);
}

function playlistEntries(data) {
    if (!configRead('longPressShowPlaylists')) return [];
    const playlists = pickedPlaylists(getUserPlaylists() || []);
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
    // Reported: it was offered inside playlists saved from someone else,
    // where the edit is refused. Offered again when the page does not say
    // either way — see playlistOwnership.js for why that way round.
    if (currentPlaylistEditable() === false) return [];
    return [tagMenuItem('removeFromPlaylist', MenuServiceItemRenderer(t('videoMenu.removeFromPlaylist'), {
        clickTrackingParams: null,
        commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/browse/edit_playlist' } },
        playlistEditEndpoint: {
            playlistId,
            actions: [{ removedVideoId: data.videoId, action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID' }]
        }
    }))];
}

// Reported: on a channel page this goes where you already are. The page is
// read as the menu is built rather than stored, since a response for one page
// can be processed while another is open.
function channelEntry(data) {
    try {
        if (detectCurrentPage() === 'channel') return [];
    } catch (_) { }
    return [tagMenuItem('channel', MenuServiceItemRenderer(t('videoMenu.goToChannel'), {
        clickTrackingParams: null,
        playlistEditEndpoint: { customAction: { action: 'GO_TO_CHANNEL', parameters: data.item } }
    }))];
}

/**
 * The exemption toggles: this playlist, this channel's page, this channel
 * everywhere.
 *
 * Each label says what pressing it will do rather than what the state is — the
 * menu has no room for a checkbox, and "Show watched videos" next to a tick
 * would be ambiguous about which way round it reads. Pressing it again on
 * something already exempted is how you put it back, so the label has to flip:
 * the exemption screen in the settings is the second way to reach that, not
 * the only one.
 *
 * Built one entry per function because two menus need them. A video's menu
 * offers whichever the page makes sense of, and a playlist or channel tile's
 * menu offers the ones its own id answers for. Sharing the builders is what
 * stops the two wording or keying the same toggle differently.
 */
function playlistExemptionEntry(playlistId) {
    const id = normalisePlaylistId(playlistId);
    if (!id) return [];
    const exempt = isPlaylistExempt(id);
    return [tagMenuItem('showWatchedPlaylist', MenuServiceItemRenderer(
        exempt ? t('videoMenu.hideWatchedPlaylistAgain') : t('videoMenu.showWatchedPlaylist'),
        {
            clickTrackingParams: null,
            playlistEditEndpoint: {
                customAction: {
                    action: 'TOGGLE_HIDE_WATCHED_PLAYLIST',
                    parameters: { playlistId: id }
                }
            }
        }
    ))];
}

function channelPageExemptionEntry(browseId, title) {
    const id = String(browseId || '').trim();
    if (!id) return [];
    const exempt = isChannelPageExempt(id);
    return [tagMenuItem('showWatchedChannelPage', MenuServiceItemRenderer(
        exempt ? t('videoMenu.hideWatchedChannelPageAgain') : t('videoMenu.showWatchedChannelPage'),
        {
            clickTrackingParams: null,
            playlistEditEndpoint: {
                customAction: {
                    action: 'TOGGLE_HIDE_WATCHED_CHANNEL_PAGE',
                    parameters: { browseId: id, title: title || '' }
                }
            }
        }
    ))];
}

function channelNameExemptionEntry(name) {
    const channel = String(name || '').trim();
    if (!channel) return [];
    const exempt = isChannelNameExempt(channel);
    return [tagMenuItem('showWatchedChannelEverywhere', MenuServiceItemRenderer(
        exempt ? t('videoMenu.hideWatchedChannelEverywhereAgain') : t('videoMenu.showWatchedChannelEverywhere'),
        {
            clickTrackingParams: null,
            playlistEditEndpoint: {
                customAction: {
                    action: 'TOGGLE_HIDE_WATCHED_CHANNEL',
                    parameters: { name: channel }
                }
            }
        }
    ))];
}

/**
 * The exemption toggles for a video's menu.
 *
 * All of them are pointless with hiding switched off, so none appear then. The
 * first two need to know which playlist or channel is being looked at, which
 * only its own page says, so they appear only there; the third reads the
 * channel off the tile like "Hide this channel" does and so can appear
 * anywhere a tile names its channel.
 */
function hideWatchedEntries(data) {
    if (!configRead('enableHideWatchedVideos')) return [];
    const entries = [];
    try {
        const page = detectCurrentPage();

        // Deliberately not offered on a video inside a playlist any more.
        //
        // It was, and it reads as a mistake: the entry is about the whole
        // playlist, not the video the menu belongs to, so finding it on a
        // video suggests it acts on that video. The playlist tile's own menu
        // is where a playlist-wide switch belongs, and now that
        // browseTileMenu.js draws that menu it is somewhere you can actually
        // reach. Asked for directly once that started working.

        if (page === 'channel') {
            for (const entry of channelPageExemptionEntry(currentChannelId(), channelNameOf(data.item))) {
                entries.push(entry);
            }
        }

        for (const entry of channelNameExemptionEntry(channelNameOf(data.item))) entries.push(entry);
    } catch (_) { }
    return entries;
}

/**
 * "Open playlist" / "Go to channel", which is also what makes the menu draw.
 *
 * A capture of every menu the app opened sorts perfectly by one number:
 *
 *   entries=4  ids=["playlists","playlists","channel","markWatched"]   drew
 *   entries=5  ids=[... ,"channel","showWatchedPlaylist"]              drew
 *   entries=1  ids=["showWatchedPlaylist"]                             did not
 *
 * Three times, the same single-entry menu, nothing on screen — while the
 * five-entry menu containing that very same entry drew it fine. So the entry
 * is not the problem and neither is the gesture, the tile style, the thumbnail
 * or the content id: a menu of one item is what does not render.
 *
 * Rather than pad it, the second entry is one worth having — the thing you
 * would most want from a long press on a playlist after the toggle is to open
 * it. It navigates by browse id, which is exactly what selecting the tile
 * does, and it is tagged so it can be reordered or hidden like everything
 * else. Hiding it would put the menu back to one entry, which is a reason to
 * leave it alone rather than a reason not to offer the choice.
 */
function openBrowseEntry(id, label, browseId) {
    const target = String(browseId || '').trim();
    if (!target) return [];
    return [tagMenuItem(id, MenuNavigationItemRenderer(label, {
        clickTrackingParams: null,
        browseEndpoint: { browseId: target }
    }))];
}

/**
 * The menu for a playlist tile or a channel tile — the ones in the library,
 * and in the channel and playlist shelves.
 *
 * This is the whole point of the feature rather than a convenience: a playlist
 * you have watched through has no videos left to long-press once they are
 * hidden, so the only place to say "show them again" is the playlist itself.
 * Reported that way, and it is why the menu on a video inside the playlist is
 * not enough on its own.
 *
 * Deliberately not the video menu. adblock.js refuses to give these tiles that
 * menu, because a playlist opens with a browseEndpoint and has no video id, so
 * every entry built from one would act on the wrong thing — a History page
 * once showed exactly that. This builds a menu of only the entries that make
 * sense for a whole playlist or a whole channel.
 *
 * Returns null when there is nothing to offer, so the caller can leave the tile
 * without a menu rather than attaching one that opens empty.
 */
/**
 * A real video id out of a tile's thumbnail URL, or null.
 *
 * YouTube builds a playlist or channel tile's thumbnail from one of its
 * videos, so the URL carries that video's id: i.ytimg.com/vi/<id>/... . That
 * is the one place a browse tile offers something the app can resolve.
 */
function videoIdFromThumbnails(thumbnails) {
    try {
        for (let i = 0; i < thumbnails.length; i++) {
            const url = String((thumbnails[i] && thumbnails[i].url) || '');
            // vi_webp as well as vi: Cobalt is served the webp variant on
            // some shelves, and a tile whose thumbnail happens to be webp is
            // not a reason to fall back to the browse id.
            const match = /\/vi(?:_webp)?\/([A-Za-z0-9_-]{11})\//.exec(url);
            if (match) return match[1];
        }
    } catch (_) { }
    return null;
}

/**
 * Play, for a playlist tile.
 *
 * A third entry, and the reason it is needed is a number. Every menu in the
 * 16 October capture sorted by entry count — one entry never drew, four and
 * five always did — which is why these tiles were given a second. The 20
 * October capture adds the missing data point: two does not draw either.
 *
 *   entries 1  ids ["showWatchedPlaylist"]                            no
 *   entries 2  ids ["openPlaylist","showWatchedPlaylist"]             no
 *   entries 4  ids ["playlists","playlists","channel","markWatched"]  yes
 *   entries 5  ids [...,"channel","showWatchedPlaylist"]              yes
 *
 * It is also the entry a long press on a playlist most obviously wants, and
 * the thumbnail already gives a video of that playlist to start from — which
 * is what makes a watchEndpoint possible here at all. Reuses the video menu's
 * own 'play' id and label, since it is the same action.
 *
 * Returns nothing when no video id could be read, rather than a Play that
 * plays nothing.
 *
 * Has its own id rather than the video menu's 'play': see ENTRY_LABELS.
 */
function playPlaylistEntry(playlistId, videoId) {
    if (!videoId) return [];
    // A tile's browse id is VL + the playlist id; a watchEndpoint wants the
    // playlist id itself. WL and LL carry no prefix and pass through unchanged.
    const list = String(playlistId || '').replace(/^VL/, '');
    if (!list) return [];
    return [tagMenuItem('playPlaylist', MenuNavigationItemRenderer(t('videoMenu.playPlaylist'), {
        clickTrackingParams: null,
        watchEndpoint: { videoId: videoId, playlistId: list }
    }))];
}

// Entries below which the app has never been seen to draw one of these menus.
// Observed: 1 no, 2 no, 4 yes, 5 yes; 3 unobserved.
const BROWSE_ENTRIES_THAT_DRAW = 4;

/**
 * Share, for a playlist tile: the same QR code the video menu offers.
 *
 * Under the video menu's own 'share' id, so one setting governs both. It had
 * an id of its own for a while, because reusing 'share' meant switching Share
 * off for videos also removed it here, and that took this menu under the entry
 * count the app needed to draw it at all. browseTileMenu.js draws the panel
 * now, so the count does not matter and the reason is gone — and one switch
 * for "share things as a QR code" is what was asked for, which is also the
 * more obvious reading of a single Share setting.
 *
 * The action stays separate: a playlist and a video are shared by different
 * URLs, so SHARE_PLAYLIST carries the playlist id where SHARE_VIDEO carries a
 * video id.
 */
function sharePlaylistEntry(playlistId) {
    const list = String(playlistId || '').replace(/^VL/, '').trim();
    if (!list) return [];
    return [tagMenuItem('share', MenuServiceItemRenderer(t('videoMenu.share'), {
        clickTrackingParams: null,
        playlistEditEndpoint: { customAction: { action: 'SHARE_PLAYLIST', parameters: { playlistId: list } } }
    }))];
}

export function browseTileLongPressData(info) {
    // Every way out of this function now says why. All of them used to return
    // null in silence, so a tile that got no menu and a tile whose menu never
    // opened looked identical in a capture — which is most of why this took
    // five attempts.
    if (!configRead('enableHideWatchedVideos')) {
        appendFileOnlyLog('longPress.browseMenuSkipped', { reason: 'hideWatchedOff', kind: info?.kind || null });
        return null;
    }
    const title = String(info?.title || '').trim();
    // Read once: both the Play entry and the contentId below want it.
    const firstVideoId = videoIdFromThumbnails(info?.thumbnails || []);
    let items = [];
    try {
        if (info?.kind === 'playlist') {
            // Three entries, and the count no longer matters: browseTileMenu.js
            // draws this panel, so the app's refusal to draw a menu of one or
            // two is no longer a constraint on what goes in it. Open Playlist
            // was in here partly to clear that bar and partly because it
            // seemed obvious — but selecting the tile already opens the
            // playlist, so it only spent a row saying so.
            //
            // Each has an id of its own and a label in ENTRY_LABELS, so all
            // three can be reordered or switched off in the long press menu
            // settings like any other entry. The first attempt gave Play and
            // Share the video menu's ids, and anyone who had switched those
            // off for videos — which this fork's own author had — got this
            // menu filtered down to two entries and no menu at all. A menu
            // assembled from another menu's settings is not a menu of its own.
            items = playPlaylistEntry(info.id, firstVideoId)
                .concat(sharePlaylistEntry(info.id))
                .concat(playlistExemptionEntry(info.id));
        } else if (info?.kind === 'channel') {
            // Both scopes, since a channel tile answers for both: its id is
            // exact for its own page, and its title is the channel name the
            // filter matches on everywhere else. Those two are the same string
            // from YouTube — the name under a video tile and the name on the
            // channel's own tile — which is what makes the second one work
            // from here at all.
            items = openBrowseEntry('channel', t('videoMenu.goToChannel'), info.id)
                .concat(channelPageExemptionEntry(info.id, title))
                .concat(channelNameExemptionEntry(title));
        }
    } catch (err) {
        appendFileOnlyLog('longPress.browseMenuSkipped', {
            reason: 'threw', kind: info?.kind || null, id: info?.id || null,
            msg: String(err?.message || err),
        });
        return null;
    }
    if (!items.length) {
        appendFileOnlyLog('longPress.browseMenuSkipped', { reason: 'noEntries', kind: info?.kind || null, id: info?.id || null });
        return null;
    }
    const ordered = applyMenuPreferences(items);
    // Below the count the app has been seen to draw. Not refused — three has
    // never been observed either way, so a menu of three is worth attaching —
    // but said out loud, because the alternative is another round of blaming
    // the tile for a menu the settings emptied.
    if (ordered.length && ordered.length < BROWSE_ENTRIES_THAT_DRAW) {
        appendFileOnlyLog('longPress.browseMenuThin', {
            kind: info?.kind || null,
            id: info?.id || null,
            entries: ordered.length,
            needs: BROWSE_ENTRIES_THAT_DRAW,
            ids: ordered.map((entry) => (entry && entry.__ttMenuId) || null),
        });
    }
    if (!ordered.length) {
        // Every entry hidden by the user's own menu preferences. Worth its own
        // reason: the menu is then correctly empty and correctly shows
        // nothing, which is indistinguishable from the bug being chased.
        appendFileOnlyLog('longPress.browseMenuSkipped', { reason: 'allHidden', kind: info?.kind || null, id: info?.id || null });
        return null;
    }
    return {
        clickTrackingParams: null,
        showMenuCommand: {
            // Drawn by browseTileMenu.js rather than by the app, which has
            // never once put one of these on screen. resolveCommand.js looks
            // for this and takes over; everything below is still what it reads
            // the header and the rows from, so there is one definition of what
            // a playlist tile offers.
            __ttBrowseTileMenu: true,
            // A video id where one can be had, not the browse id.
            //
            // Captured 20 October, a History video tile and a playlist tile on
            // the same library page seven seconds apart. Identical component,
            // identical classes, identical shelf:
            //
            //   video     cmds ["clickTrackingParams","openPopupAction",
            //                   "signalAction","showHintCommand"]
            //   playlist  cmds ["clickTrackingParams"]
            //
            // openPopupAction is what puts the dialog on screen, and it is the
            // app's, not ours. So the gesture fires, our command arrives with
            // our entries in it, the app accepts it — and then declines to
            // display it. The tile cannot be the reason, and neither can the
            // entries: they use the same two renderers and the same endpoint
            // shapes as the video menu that works.
            //
            // That leaves this field, the one structural difference between
            // the two commands: an 11-character video id against VLPL… . A
            // handler that looks the content up to build its popup would find
            // nothing for a playlist browse id and have nothing to open.
            //
            // The thumbnail gives a real id belonging to this playlist, so
            // this is not a placeholder. The header does not depend on it —
            // title, subtitle and thumbnail are all passed explicitly below —
            // and the entries act on info.id regardless of what goes here.
            // Falls back to the browse id, which is where this started.
            contentId: firstVideoId || info.id,
            thumbnail: { thumbnails: info.thumbnails || [] },
            title: { simpleText: title || info.id },
            subtitle: {
                simpleText: info.kind === 'playlist'
                    ? t('videoMenu.playlistMenuSubtitle')
                    : t('videoMenu.channelMenuSubtitle')
            },
            menu: {
                menuRenderer: {
                    items: ordered,
                    trackingParams: null,
                    accessibility: { accessibilityData: { label: 'Options' } }
                }
            }
        }
    };
}

/**
 * "Mark as watched", on the subscriptions page and nowhere else.
 *
 * Asked for there specifically: the subscriptions shelf is where a video you
 * have already seen elsewhere, or decided to skip, otherwise sits forever.
 * Everywhere else there is no need for it, and an entry in every menu on every
 * page is a cost of its own on a list this long. It still has an id, so it can
 * be moved or hidden with the rest.
 *
 * Only offered when hiding watched videos is on, since marking a video watched
 * would otherwise change nothing anyone can see.
 */
function markWatchedEntry(data) {
    try {
        if (!configRead('enableHideWatchedVideos')) return [];
        if (detectCurrentPage() !== 'subscriptions') return [];
        if (!data.videoId) return [];
    } catch (_) {
        return [];
    }
    return [tagMenuItem('markWatched', MenuServiceItemRenderer(t('videoMenu.markWatched'), {
        clickTrackingParams: null,
        playlistEditEndpoint: {
            // The signed params off the tile's own watchEndpoint go with it.
            // Without them the player request comes back UNPLAYABLE with no
            // tracking block, which is what made this fail the first time.
            customAction: {
                action: 'MARK_WATCHED',
                parameters: { videoId: data.videoId, params: data.watchEndpointData?.params || null }
            }
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
        ...channelEntry(data),
        ...markWatchedEntry(data),
        ...hideWatchedEntries(data),
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

// Fetched before the first long press, which needs waiting for the app rather
// than guessing how long it takes.
//
// Reported: on the first start of the app, a long press on the home page
// showed only "Zum Kanal" — no playlists — on every tile and every shelf, and
// going to the subscriptions page and back made them appear. That is this
// prefetch missing its window.
//
// It used to be a single shot at eight seconds. refreshUserPlaylists does
// nothing at all when the app's InnerTube client is not in window._yttv yet,
// and on these TVs eight seconds is often still inside the boot — so the one
// shot was spent on nothing, and nothing retried until the menu itself asked,
// by which time it was being built. Hence: nothing on the first press,
// everything on the next.
//
// So this waits for the client instead. The poll is a property lookup and
// sends nothing; only once there is something to ask does a request go out.
// An empty answer is tried again a few times, because being signed in is its
// own kind of not-ready-yet, and an empty result is deliberately not cached as
// success.
const PLAYLIST_WARM_POLL_MS = 1000;
const PLAYLIST_WARM_MAX_WAIT_MS = 120000;
// After the client appears: the delays at which an empty answer is retried.
const PLAYLIST_WARM_RETRIES_MS = [4000, 12000, 30000];

function warmPlaylists() {
    let waited = 0;
    let retry = 0;

    const askAgain = () => {
        if (cachedPlaylistCount() > 0) {
            logWarm('ready', { playlists: cachedPlaylistCount(), afterMs: waited });
            return;
        }
        if (retry >= PLAYLIST_WARM_RETRIES_MS.length) {
            logWarm('gave_up', { afterMs: waited });
            return;
        }
        const delay = PLAYLIST_WARM_RETRIES_MS[retry];
        retry++;
        setTimeout(() => {
            waited += delay;
            refreshUserPlaylists().then(askAgain, askAgain);
        }, delay);
    };

    const waitForClient = () => {
        if (innerTubeReady()) {
            logWarm('client_ready', { afterMs: waited });
            refreshUserPlaylists().then(askAgain, askAgain);
            return;
        }
        waited += PLAYLIST_WARM_POLL_MS;
        if (waited >= PLAYLIST_WARM_MAX_WAIT_MS) {
            logWarm('client_never_appeared', { afterMs: waited });
            return;
        }
        setTimeout(waitForClient, PLAYLIST_WARM_POLL_MS);
    };

    waitForClient();
}

// Named so it lands in the catch-all log category rather than the playlist
// one: someone looking into "the menu was empty on the first press" has no
// reason to have turned the playlist category on.
function logWarm(what, detail) {
    try { appendFileOnlyLog('longPress.playlistWarm.' + what, detail); } catch (_) { }
}

if (!window.__ttPlaylistPrefetchScheduled) {
    window.__ttPlaylistPrefetchScheduled = true;
    try {
        if (configRead('longPressShowPlaylists')) warmPlaylists();
    } catch (_) { }
}
