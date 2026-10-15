import { configRead, configWrite } from '../config.js';
import { appendFileOnlyLog, setHideWatchedExemption } from './hideWatched.js';
import { channelNameOf } from './channelHider.js';

/**
 * hideWatchedExemptions.js — playlists and channels that keep their watched
 * videos.
 *
 * "Hide watched videos" is configured per kind of page: hideWatchedVideosPages
 * is a list like ['home', 'subscriptions', 'channel', 'playlist'], and it
 * ships with both 'channel' and 'playlist' switched on. That leaves no way to
 * say "all of them except this one" — and the exceptions are the whole point
 * for a playlist you rewatch, or a channel whose back catalogue you work
 * through twice.
 *
 * Three lists, because the two kinds cannot be identified the same way:
 *
 *   hideWatchedExemptPlaylists      a playlist, by its id. Only ever consulted
 *                                   on that playlist's own page, because that
 *                                   is the only place a video is "in" it: a
 *                                   tile on home carries no playlist.
 *
 *   hideWatchedExemptChannelPages   a channel, by its UC id, and only on its
 *                                   own page. The id is exact, so two channels
 *                                   sharing a name stay separate.
 *
 *   hideWatchedExemptChannelNames   a channel, by name, everywhere — home,
 *                                   subscriptions, search. By name because a
 *                                   shelf tile carries no channel id at all;
 *                                   channelHider.js has the long version of
 *                                   why, and this reuses its reader so the two
 *                                   always read a tile the same way.
 *
 * Both channel lists exist because both were asked for and they answer
 * different questions. The page one is "let me browse this channel properly";
 * the name one is "never hide this channel from me anywhere". Setting the
 * second makes the first redundant, which is harmless.
 */

// ── Identity ──────────────────────────────────────────────────────────────────

/**
 * The browse id of the page being looked at, or ''.
 *
 * YouTube TV keeps it in a `c=` parameter, which is also where
 * detectCurrentPage reads it from to decide what kind of page this is. The two
 * have to agree about the value or one would exempt a playlist the other is
 * still filtering, so this deliberately reads the same two places in the same
 * order rather than tracking the page itself.
 */
export function currentBrowseId() {
    try {
        const hash = location.hash ? location.hash.substring(1) : '';
        const fromHash = hash.match(/(?:^|[?&])c=([^&]+)/i);
        if (fromHash) return decodeURIComponent(fromHash[1]);
        const fromSearch = location.search.match(/(?:^|[?&])c=([^&]+)/i);
        if (fromSearch) return decodeURIComponent(fromSearch[1]);
    } catch (_) { }
    return '';
}

/**
 * A playlist id without the browse prefix.
 *
 * A playlist's browse id is its playlist id with VL in front — VLPL…, VLWL for
 * Watch Later, VLLL for liked videos. The id without it is what a tile's
 * watchEndpoint carries, and the menu entry is built from a tile while the
 * filter runs off the page, so both are normalised to the shorter form or a
 * playlist exempted from the menu would not be recognised by the filter.
 */
export function normalisePlaylistId(value) {
    const id = String(value === undefined || value === null ? '' : value).trim();
    return /^VL/i.test(id) ? id.slice(2) : id;
}

/**
 * The playlist whose page is open, or ''.
 *
 * Only a browse id that really names one playlist counts, which is narrower
 * than "the page is of kind playlist". detectCurrentPage also answers
 * 'playlist' for FEmy_youtube, and that is not a playlist id — taking it as
 * one offered to exempt a thing called FEmy_youtube, which would have stored
 * an entry that could never match anything and shown the toggle on a page it
 * does not belong on. Caught by the tile test, which runs on that page.
 *
 * Same rule as adblock.js's browseTileInfo applies to a tile: VL-prefixed, or
 * Watch Later and Liked, which appear bare.
 */
export function currentPlaylistId() {
    const raw = currentBrowseId().trim();
    const upper = raw.toUpperCase();
    if (/^VL./.test(upper)) return normalisePlaylistId(raw);
    if (upper === 'WL' || upper === 'LL') return upper;
    return '';
}

/** The channel whose page is open, or ''. */
export function currentChannelId() {
    const id = currentBrowseId().trim();
    return /^UC[\w-]{10,}$/.test(id) ? id : '';
}

function normaliseName(name) {
    return String(name === undefined || name === null ? '' : name).trim().toLowerCase();
}

// ── The lists ─────────────────────────────────────────────────────────────────

const PLAYLISTS = 'hideWatchedExemptPlaylists';
const CHANNEL_PAGES = 'hideWatchedExemptChannelPages';
const CHANNEL_NAMES = 'hideWatchedExemptChannelNames';

function readList(key) {
    const stored = configRead(key);
    return Array.isArray(stored) ? stored : [];
}

// Entries are {id, title} objects so the settings screen can name them, but an
// older build — or a hand-edited config — may hold plain strings. Read either,
// write objects, exactly as sidebarContentsOrder already does.
function entryKey(entry) {
    if (entry && typeof entry === 'object') return String(entry.id || entry.browseId || '');
    return String(entry === undefined || entry === null ? '' : entry);
}

function entryTitle(entry) {
    if (entry && typeof entry === 'object' && entry.title) return String(entry.title);
    return '';
}

export function isPlaylistExempt(playlistId) {
    const wanted = normalisePlaylistId(playlistId);
    if (!wanted) return false;
    return readList(PLAYLISTS).some(entry => normalisePlaylistId(entryKey(entry)) === wanted);
}

export function isChannelPageExempt(browseId) {
    const wanted = String(browseId || '').trim();
    if (!wanted) return false;
    return readList(CHANNEL_PAGES).some(entry => entryKey(entry).trim() === wanted);
}

export function isChannelNameExempt(name) {
    const wanted = normaliseName(name);
    if (!wanted) return false;
    return readList(CHANNEL_NAMES).some(entry => normaliseName(entryKey(entry)) === wanted);
}

// ── Toggling ──────────────────────────────────────────────────────────────────

/**
 * Add or remove one entry, and say which it did.
 *
 * Returns true when the thing is now exempt, which is what the caller needs to
 * word its toast: the menu entry is a toggle and the same press has to be able
 * to report either outcome.
 */
function toggle(key, id, title, same) {
    const list = readList(key);
    const at = list.findIndex(entry => same(entryKey(entry), id));
    if (at !== -1) {
        const next = list.slice();
        next.splice(at, 1);
        configWrite(key, next);
        return false;
    }
    configWrite(key, list.concat([title ? { id, title } : { id }]));
    return true;
}

export function togglePlaylistExemption(playlistId, title) {
    const id = normalisePlaylistId(playlistId);
    if (!id) return null;
    const now = toggle(PLAYLISTS, id, title, (a, b) => normalisePlaylistId(a) === b);
    appendFileOnlyLog('hideWatched.exempt.playlist', { playlistId: id, exempt: now });
    return now;
}

export function toggleChannelPageExemption(browseId, title) {
    const id = String(browseId || '').trim();
    if (!id) return null;
    const now = toggle(CHANNEL_PAGES, id, title, (a, b) => a.trim() === b);
    appendFileOnlyLog('hideWatched.exempt.channelPage', { browseId: id, exempt: now });
    return now;
}

export function toggleChannelNameExemption(name) {
    const id = String(name || '').trim();
    if (!id) return null;
    const now = toggle(CHANNEL_NAMES, id, id, (a, b) => normaliseName(a) === normaliseName(b));
    appendFileOnlyLog('hideWatched.exempt.channelName', { channel: id.slice(0, 60), exempt: now });
    return now;
}

// ── For the settings screen ───────────────────────────────────────────────────

export const PLAYLIST_KIND = 'playlist';
export const CHANNEL_PAGE_KIND = 'channelPage';
export const CHANNEL_NAME_KIND = 'channelName';

const KEY_FOR_KIND = {};
KEY_FOR_KIND[PLAYLIST_KIND] = PLAYLISTS;
KEY_FOR_KIND[CHANNEL_PAGE_KIND] = CHANNEL_PAGES;
KEY_FOR_KIND[CHANNEL_NAME_KIND] = CHANNEL_NAMES;

/** Every exemption, flattened, for a screen that lists them all together. */
export function allExemptions() {
    const out = [];
    for (const kind of [PLAYLIST_KIND, CHANNEL_PAGE_KIND, CHANNEL_NAME_KIND]) {
        for (const entry of readList(KEY_FOR_KIND[kind])) {
            const id = entryKey(entry);
            if (!id) continue;
            out.push({ kind, id, title: entryTitle(entry) || id });
        }
    }
    return out;
}

export function removeExemption(kind, id) {
    const key = KEY_FOR_KIND[kind];
    if (!key) return false;
    const wanted = kind === PLAYLIST_KIND ? normalisePlaylistId(id)
        : kind === CHANNEL_NAME_KIND ? normaliseName(id)
            : String(id || '').trim();
    const list = readList(key);
    const next = list.filter(entry => {
        const have = kind === PLAYLIST_KIND ? normalisePlaylistId(entryKey(entry))
            : kind === CHANNEL_NAME_KIND ? normaliseName(entryKey(entry))
                : entryKey(entry).trim();
        return have !== wanted;
    });
    if (next.length === list.length) return false;
    configWrite(key, next);
    appendFileOnlyLog('hideWatched.exempt.removed', { kind, id: String(id).slice(0, 60) });
    return true;
}

// ── What the filter asks ──────────────────────────────────────────────────────

const _loggedItems = new Set();
const MAX_LOGGED_ITEMS = 60;

/**
 * Is the whole page exempt? Returns a reason for the log, or null.
 *
 * Only playlist and channel pages can be, since they are the only ones that
 * are a single playlist or a single channel.
 */
function pageExemption(pageName) {
    try {
        if (pageName === 'playlist') {
            const id = currentPlaylistId();
            if (id && isPlaylistExempt(id)) return 'playlist:' + id;
            return null;
        }
        if (pageName === 'channel') {
            const id = currentChannelId();
            if (id && isChannelPageExempt(id)) return 'channelPage:' + id;
            return null;
        }
    } catch (_) { }
    return null;
}

/**
 * Is this one tile exempt wherever it appears? Returns a reason, or null.
 *
 * This is the by-name list, and it is checked per tile precisely because it has
 * to work on pages that mix channels together.
 *
 * It deliberately stops at the channel's own page, which is not where it
 * started: it used to apply there too, so setting it made the channel page
 * exemption redundant. Asked for the other way round, and it is the better
 * way round — the two lists now answer two separate questions and neither
 * overrules the other. The channel's own page is governed by
 * hideWatchedExemptChannelPages and nothing else, so showing a channel's
 * watched videos truly everywhere means setting both. One consequence worth
 * knowing: with only this one set, a channel's videos reappear on home and in
 * search but are still hidden when you open the channel.
 */
function itemExemption(item, pageName) {
    try {
        if (pageName === 'channel') return null;
        // Cheapest possible early out: with no names on the list this runs for
        // every tile of every response and must cost nothing.
        if (!readList(CHANNEL_NAMES).length) return null;
        const name = channelNameOf(item);
        if (!name || !isChannelNameExempt(name)) return null;
        const key = normaliseName(name);
        if (!_loggedItems.has(key) && _loggedItems.size < MAX_LOGGED_ITEMS) {
            _loggedItems.add(key);
            appendFileOnlyLog('hideWatched.exempt.kept', { channel: name.slice(0, 60) });
        }
        return 'channelName:' + name;
    } catch (_) { }
    return null;
}

// Registered rather than imported by hideWatched.js, and that is deliberate.
// appendFileOnlyLog lives there and some thirty-five modules import it, which
// makes that file the hub of the graph: anything it imports which imports it
// back is a cycle rollup would warn about on every build. The service does the
// same thing for the same reason (injector.setSyslogRelay), so the shape is not
// new. userScript.js imports this file to make sure the registration happens.
setHideWatchedExemption({ page: pageExemption, item: itemExemption });
