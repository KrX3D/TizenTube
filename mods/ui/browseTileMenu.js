import { buttonItem, overlayPanelItemListRenderer, showModal } from './ytUI.js';
import { appendFileOnlyLog } from '../features/hideWatched.js';

/**
 * browseTileMenu.js — draw the playlist and channel tile menu ourselves.
 *
 * The app will not draw it. Eight attempts established that, and the last
 * capture closed off the final one. Two long presses on the same page, both
 * menus built by this fork, both with four entries:
 *
 *   video tile     menuOpened entries=4 ids=[playlists,playlists,channel,markWatched]
 *                  probe      cmds=[clickTrackingParams, openPopupAction]      drew
 *
 *   playlist tile  menuOpened entries=4 ids=[playPlaylist,openPlaylist,
 *                                            sharePlaylist,showWatchedPlaylist]
 *                  probe      cmds=[clickTrackingParams]                       nothing
 *
 * openPopupAction is the app's own command and the thing that puts a dialog on
 * screen. It follows a video tile's menu and never a browse tile's, while
 * resolveCommand returns true for both. Everything a command can carry has
 * been matched to the one that works — the entry count, both renderer types,
 * a resolvable video id as the content id, the thumbnail, the title and
 * subtitle — and the tile's own component, classes and shelf are identical to
 * the video tile seven seconds earlier. The only thing left that differs is
 * which tile the app thinks it is being asked about, and a command cannot
 * reach that.
 *
 * So the drawing moves here. Not as hand-written DOM: the app's own overlay
 * panel is what the settings screens and the QR share already use, which means
 * the remote, the focus ring, the back button and the styling are the app's
 * and not an imitation of them. All this adds is the decision to show it.
 *
 * The entries themselves are not duplicated. longPressMenu.js still builds
 * them, still applies the user's order and hiding, and the menu it produces is
 * converted here — so there is one definition of what a playlist tile offers,
 * and no second list to forget to update.
 */

/** The label and the command out of either kind of menu item. */
function readEntry(item) {
    const nav = item && item.menuNavigationItemRenderer;
    const renderer = nav || (item && item.menuServiceItemRenderer);
    if (!renderer) return null;
    const runs = renderer.text && renderer.text.runs;
    const label = (runs && runs.length && runs[0].text)
        || (renderer.text && renderer.text.simpleText)
        || '';
    const endpoint = nav ? renderer.navigationEndpoint : renderer.serviceEndpoint;
    if (!label || !endpoint) return null;
    return { id: (item && item.__ttMenuId) || null, label, endpoint };
}

/**
 * Icons, by entry id.
 *
 * Every one is a name already used elsewhere in the settings tree. A Material
 * name the TV app does not carry shows nothing at all rather than failing, so
 * guessing one looks like a missing icon and reads as a bug.
 */
const ICONS = {
    playPlaylist: 'PLAY_ARROW',
    share: 'SEND',
    showWatchedPlaylist: 'EYE_OFF',
    channel: 'ACCOUNT_CIRCLE',
    showWatchedChannelPage: 'EYE_OFF',
    showWatchedChannelEverywhere: 'PERSON',
};

/**
 * Entries that take the screen over, and so need the panel gone first.
 *
 * Every row dismisses the panel; the order is what differs. Two reports made
 * that distinction necessary:
 *
 *   sharing a playlist appeared to do nothing — the QR opened and POPUP_BACK,
 *   queued after it, closed the thing that had just appeared
 *
 *   playing a playlist played it and left the panel sitting on top, because
 *   this row had no POPUP_BACK at all on the theory that navigating would
 *   dismiss the panel by itself. It does not.
 *
 * So anything that navigates or opens its own screen closes the panel before
 * acting, and anything that acts in place and returns closes it afterwards —
 * which is the right way round for the watched toggle, whose toast should
 * follow the panel going away rather than precede it.
 */
const CLOSES_PANEL_FIRST = {
    playPlaylist: true,
    share: true,
    channel: true,
};

/**
 * Show the panel for one browse tile.
 *
 * `menu` is the command longPressMenu.js already built, so this reads the
 * header and the rows straight out of it.
 */
export function showBrowseTileMenu(menu) {
    try {
        const command = menu && menu.showMenuCommand;
        if (!command) return false;
        const items = (command.menu && command.menu.menuRenderer && command.menu.menuRenderer.items) || [];
        const rows = [];
        for (let i = 0; i < items.length; i++) {
            const entry = readEntry(items[i]);
            if (!entry) continue;
            const dismiss = { signalAction: { signal: 'POPUP_BACK' } };
            const commands = CLOSES_PANEL_FIRST[entry.id] === true
                ? [dismiss, entry.endpoint]
                : [entry.endpoint, dismiss];
            rows.push(buttonItem(
                { title: entry.label },
                { icon: ICONS[entry.id] || null },
                commands
            ));
        }
        if (!rows.length) {
            appendFileOnlyLog('browseTileMenu.noRows', {
                entries: items.length,
                ids: items.map((item) => (item && item.__ttMenuId) || null),
            });
            return false;
        }

        const title = (command.title && command.title.simpleText) || '';
        const subtitle = (command.subtitle && command.subtitle.simpleText) || '';
        appendFileOnlyLog('browseTileMenu.shown', {
            title: title || null,
            entries: rows.length,
            ids: items.map((item) => (item && item.__ttMenuId) || null),
        });
        showModal({ title, subtitle }, overlayPanelItemListRenderer(rows), 'tt-browse-tile-menu');
        return true;
    } catch (err) {
        appendFileOnlyLog('browseTileMenu.failed', { msg: String((err && err.message) || err) });
        return false;
    }
}

export default showBrowseTileMenu;
