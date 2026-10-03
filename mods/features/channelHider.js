import { configRead } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';
import { lockupSubtitle } from './lockupViewModel.js';

/**
 * channelHider.js — hide every video from a channel you don't want to see.
 *
 * By NAME, not by channel id, and that is forced rather than chosen: a shelf
 * item carries no channel id, only the video it points at (see
 * requestNextAndNavigateChannel, which has to ask YouTube for /next just to
 * find the channel behind one video). Resolving an id per tile would mean one
 * request per tile on every page, which is not a thing to do on a TV.
 *
 * The name is what the tile already shows under the title, so matching it costs
 * nothing and needs no request. The trade-offs are honest ones:
 *
 *   - a channel that renames itself starts appearing again, and is hidden again
 *     by hiding it once more
 *   - two channels sharing a name are hidden together
 *
 * Names are compared trimmed and case-insensitively, since the same channel is
 * not always written identically across surfaces.
 */

function normalise(name) {
    return String(name || '').trim().toLowerCase();
}

/** The channel a tile belongs to, as shown on the tile itself. */
export function channelNameOf(item) {
    try {
        const line = item?.tileRenderer?.metadata?.tileMetadataRenderer?.lines?.[0]
            ?.lineRenderer?.items?.[0]?.lineItemRenderer?.text;
        if (line) {
            if (line.simpleText) return String(line.simpleText);
            if (Array.isArray(line.runs)) return line.runs.map(r => r?.text || '').join('');
        }
        const fromLockup = lockupSubtitle(item);
        if (fromLockup) return String(fromLockup);
    } catch (_) { }
    return '';
}

export function hiddenChannels() {
    const stored = configRead('hiddenChannels');
    return Array.isArray(stored) ? stored : [];
}

export function isChannelHidden(name) {
    const wanted = normalise(name);
    if (!wanted) return false;
    return hiddenChannels().some(hidden => normalise(hidden) === wanted);
}

const _logged = new Set();
const MAX_LOGGED = 100;

/**
 * Drop videos from hidden channels.
 *
 * @param {Array} items
 * @param {string} pageName
 */
export function filterHiddenChannels(items, pageName = null) {
    if (!Array.isArray(items) || !items.length) return items;
    if (!hiddenChannels().length) return items;
    return items.filter(item => {
        const name = channelNameOf(item);
        if (!name || !isChannelHidden(name)) return true;
        try {
            const id = item?.tileRenderer?.contentId || '?';
            const key = name + ':' + id;
            if (!_logged.has(key) && _logged.size < MAX_LOGGED) {
                _logged.add(key);
                appendFileOnlyLog('channelHider.removed', { channel: name.slice(0, 60), videoId: id, pageName });
            }
        } catch (_) { }
        return false;
    });
}
