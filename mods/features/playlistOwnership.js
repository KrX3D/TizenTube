import { appendFileOnlyLog } from './hideWatched.js';

/**
 * playlistOwnership.js — is the playlist on screen one you can edit?
 *
 * Reported: inside a playlist, "Remove From This Playlist" should only be
 * offered for playlists of your own. A playlist you saved from someone else
 * cannot be edited — YouTube refuses the call — so offering it there is a
 * button that does nothing.
 *
 * The id alone cannot answer this: a playlist you created and one you saved
 * both start with `PL`. What can answer it is the playlist page's own
 * renderer, which says whether the list is editable. The field name YouTube
 * uses on the TV surface is not documented and we have no capture of one yet,
 * so every plausible spelling is read, and when none of them is present the
 * renderer's key list is logged once per playlist (`playlist.editable`) so a
 * capture can name it instead of this guessing again.
 *
 * Until then the unknown case keeps the entry: a playlist of your own that
 * wrongly loses its remove entry is a feature that disappeared, while a
 * foreign playlist that wrongly keeps it is a button YouTube declines, which
 * is what already happens today.
 */

// Spellings seen across YouTube's surfaces for the same idea.
const EDITABLE_FIELDS = ['isEditable', 'editable', 'canEdit', 'isOwnerViewing', 'canReorder'];

// Keyed by the page's own hash, the same key the playlist cache uses, so
// moving between playlists cannot carry an answer across.
let currentKey = null;
let currentEditable = null;
const logged = [];

function pageKey() {
    try {
        return String(window.location?.hash || '');
    } catch (e) {
        return '';
    }
}

/**
 * Record what the playlist page says about itself.
 *
 * Called from both response paths with the playlistVideoListRenderer.
 */
export function notePlaylistPage(renderer) {
    try {
        if (!renderer || typeof renderer !== 'object') return;
        const key = pageKey();
        let editable = null;
        for (const field of EDITABLE_FIELDS) {
            if (typeof renderer[field] === 'boolean') {
                editable = renderer[field];
                break;
            }
        }
        currentKey = key;
        currentEditable = editable;

        // One line per playlist, and only while we still cannot read the
        // answer — once a field is found there is nothing to learn.
        if (editable === null && logged.indexOf(key) === -1 && logged.length < 20) {
            logged.push(key);
            appendFileOnlyLog('playlist.editable', {
                reason: 'no editable field found',
                keys: Object.keys(renderer).filter((k) => k !== 'contents'),
            });
        }
    } catch (err) {
        appendFileOnlyLog('playlist.editable.error', { message: err?.message || String(err) });
    }
}

/**
 * true / false when the page said so, null when it did not.
 *
 * Answers only for the playlist currently on screen: a stored answer from a
 * different page is no answer at all.
 */
export function currentPlaylistEditable() {
    try {
        if (currentKey === null) return null;
        return currentKey === pageKey() ? currentEditable : null;
    } catch (e) {
        return null;
    }
}

/**
 * Diagnostic for the other half of the same question: which of the playlists
 * in your library are yours, rather than ones you saved.
 *
 * The long press menu offers them all, which was also reported. The
 * aggregation response is the only place that could distinguish them and we
 * have no capture of it either, so this records what each playlist tile
 * carries — capped, and once per session — rather than shipping a guess that
 * would silently hide the wrong ones.
 */
export function notePlaylistTileShape(node, playlistId) {
    try {
        if (!node || typeof node !== 'object' || !playlistId) return;
        if (logged.indexOf('tile:' + playlistId) !== -1 || logged.length >= 40) return;
        logged.push('tile:' + playlistId);
        const interesting = {};
        for (const key of Object.keys(node)) {
            if (!/privacy|owner|editab|badge|author|channel|byline|subtitle|metadata/i.test(key)) continue;
            const value = node[key];
            interesting[key] = value && typeof value === 'object' ? Object.keys(value) : value;
        }
        appendFileOnlyLog('playlist.tileShape', {
            playlistId,
            keys: Object.keys(node),
            interesting,
        });
    } catch (e) {
        // A diagnostic must never be the reason a playlist list fails.
    }
}
