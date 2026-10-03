import { configRead } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';
import { lockupTitle } from './lockupViewModel.js';

/**
 * keywordHider.js — hide videos whose title contains a word you don't want.
 *
 * The idea is from krakenkall's fork, where the list is hardcoded in the
 * config and aimed at AI-generated videos ("AI generated", "AI voice", …) and
 * a few Vietnamese drama tropes. Here the list is yours to set rather than
 * baked in, because what counts as noise is not the same for two people.
 *
 * Matched on the title the tile already shows, for the same reason
 * channelHider matches on the channel name: it costs nothing and needs no
 * request. Substring, trimmed, case-insensitive — so "ai voice" catches
 * "AI Voice Narration", and a keyword is a phrase rather than a word, so
 * "3 generations" works as well as "generations".
 *
 * Two honest trade-offs, the same shape as the channel hider's:
 *
 *   - a short keyword catches more than you meant ("ai" is in "said",
 *     "paint" and "Thailand"), so word-boundary matching is used for a
 *     keyword that is a single short word, and plain substring matching for
 *     anything longer or containing a space;
 *   - a title that does not mention the thing is not hidden, because nothing
 *     here looks at the video itself.
 *
 * The keywords live in config rather than in a settings screen: a TV has no
 * free-text entry, so the list is edited the same way the log server's host
 * is — through the config, or the RED-key overlay. The settings menu carries
 * the on/off switch and says how many keywords are in effect.
 */

// A single word this short matched as a substring catches far too much, so it
// is matched on word boundaries instead.
const SHORT_WORD_MAX = 4;

function normalise(text) {
    return String(text || '').trim().toLowerCase();
}

export function keywords() {
    try {
        const stored = configRead('hiddenTitleKeywords');
        if (!Array.isArray(stored)) return [];
        return stored.map(normalise).filter(Boolean);
    } catch (e) {
        return [];
    }
}

/** The title a tile shows, whichever renderer it is. */
export function titleOf(item) {
    try {
        const simple = item?.tileRenderer?.metadata?.tileMetadataRenderer?.title;
        if (simple) {
            if (simple.simpleText) return String(simple.simpleText);
            if (Array.isArray(simple.runs)) return simple.runs.map((r) => r?.text || '').join('');
        }
        const fromLockup = lockupTitle(item);
        if (fromLockup) return String(fromLockup);
    } catch (e) { }
    return '';
}

/**
 * Which keyword hides this title, or null.
 *
 * Exported so the test can state the matching rules directly rather than
 * through a list of tiles.
 */
export function matchingKeyword(title, list) {
    const text = normalise(title);
    if (!text) return null;
    for (const keyword of (list || keywords())) {
        if (!keyword) continue;
        const isShortSingleWord = keyword.length <= SHORT_WORD_MAX && keyword.indexOf(' ') === -1;
        if (isShortSingleWord) {
            // Word boundaries, so "ai" does not match "said" or "Thailand".
            // Built from the keyword's own characters, with everything that
            // means something to a regex escaped, since this is user input.
            const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, (ch) => '\\' + ch);
            if (new RegExp('(^|[^a-z0-9])' + escaped + '([^a-z0-9]|$)').test(text)) return keyword;
            continue;
        }
        if (text.indexOf(keyword) !== -1) return keyword;
    }
    return null;
}

const _logged = new Set();
const MAX_LOGGED = 50;

/**
 * Drop videos whose title matches a keyword.
 *
 * Returns the array unchanged when the feature is off or the list is empty, so
 * the common case costs one config read.
 */
export function filterByKeyword(items, pageName = null) {
    if (!Array.isArray(items) || !items.length) return items;
    try {
        if (configRead('enableKeywordHider') !== true) return items;
    } catch (e) {
        return items;
    }
    const list = keywords();
    if (!list.length) return items;

    const kept = [];
    let removed = 0;
    for (const item of items) {
        const title = titleOf(item);
        const keyword = title ? matchingKeyword(title, list) : null;
        if (!keyword) {
            kept.push(item);
            continue;
        }
        removed++;
        if (_logged.size < MAX_LOGGED) {
            const note = keyword + '|' + title.slice(0, 60);
            if (!_logged.has(note)) {
                _logged.add(note);
                appendFileOnlyLog('filters.keywordHidden', { page: pageName, keyword, title: title.slice(0, 80) });
            }
        }
    }
    if (removed) {
        appendFileOnlyLog('filters.keyword.count', { page: pageName, before: items.length, after: kept.length, removed });
    }
    return kept;
}
