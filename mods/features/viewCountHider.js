import { configRead } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';

/**
 * viewCountHider.js — take the view count, and the 4K/8K/dubbed badges, off
 * the tiles.
 *
 * Ported from siriusvoid's fork, with the matching rebuilt. Theirs tests the
 * metadata text against /\bviews?\b/i, which works on an English TV and does
 * nothing at all on a German one, where the same line reads "1,2 Mio.
 * Aufrufe". The same goes for their auto-dubbed badge label.
 *
 * So this matches structure first and words second:
 *
 *  1. The named fields — viewCountText, shortViewCountText, viewCount — which
 *     are the same in every language and are where the count lives on every
 *     renderer that has one of its own.
 *  2. For a tile whose metadata is a plain line of text with no field name,
 *     a word list. 4K and 8K are product names and are never translated, so
 *     those are safe; "views" is not, so the list carries the languages this
 *     fork ships and an unlisted one simply keeps its view count, which is the
 *     safe direction to fail in.
 *
 * Anything that looks like a badge but is not matched is logged once per
 * distinct label, so a word the list is missing can be added from a capture
 * instead of guessed at.
 *
 * Two settings, not one: siriusvoid put both behind a single toggle, and
 * wanting the counts gone is not the same as wanting the quality badges gone.
 */

// Fields that hold a view count, whatever the language.
const COUNT_FIELDS = ['viewCountText', 'shortViewCountText', 'viewCount', 'viewCountEntity'];

// The word for "views" in the languages this fork ships. Lower-cased, and
// matched as a whole word so "vues" does not match inside another word.
const VIEW_WORDS = [
    'view', 'views',
    'aufruf', 'aufrufe',           // de
    'vue', 'vues',                 // fr
    'visualizzazioni',             // it
    'visualizaciones',             // es
    'visualizações',               // pt
    'weergaven',                   // nl
    'visninger',                   // dk
    'katselua', 'katselukertaa',   // fi
    'просмотр', 'просмотра', 'просмотров', // ru
    'перегляд', 'переглядів',      // uk
    'megtekintés',                 // hu
    'wyświetlenia', 'wyświetleń',  // pl
    'zhlédnutí',                   // cs
    'görüntüleme',                 // tr
    'lượt xem',                    // vi
    'visualizări',                 // ro
    'pregleda',                    // bs/hr/sr
    'rādījumi',                    // lv
    'peržiūros',                   // lt
    'προβολές',                    // el
    '次の視聴', '回視聴',            // ja
    '次观看', '次觀看',              // zh
    'مشاهدة',                      // ar
];

// Never translated: these are product names.
const QUALITY_LABELS = /^(4K|8K|HDR|UHD)$/i;
// Dubbed badges are translated, so this is a word list too.
const DUBBED_WORDS = ['dubbed', 'auto-dubbed', 'autodubbed', 'synchronisiert', 'doppiato', 'doblado', 'dublado', 'dublat', 'дубл'];

// Deep enough to cross a tile, which is about nine levels from the tile down
// to the text of a metadata line. NOT deep enough to cross a whole response:
// on Home that same text sits twenty-three levels from the root, and the first
// cut of this walked from there and gave up at ten — so it never reached a
// single tile. Reported as "aufrufe and the badge 4k still are shown".
//
// The fix is not a bigger number. Walking every response that deep means tens
// of thousands of property visits per payload on a TV, which is the cost this
// repo has been bitten by before. The entry points below start at a tile, or
// at a named subtree, so the walk stays short wherever it runs.
const MAX_DEPTH = 12;

function textOf(node) {
    if (!node || typeof node !== 'object') return '';
    const title = node.text || node.title || node;
    if (typeof title === 'string') return title;
    if (title && typeof title === 'object') {
        if (title.simpleText) return String(title.simpleText);
        if (Array.isArray(title.runs)) return title.runs.map((r) => r?.text || '').join('');
    }
    return '';
}

function looksLikeViewCount(text) {
    const lower = String(text || '').toLowerCase();
    if (!lower) return false;
    // A count always has a digit in it; a word on its own is something else.
    if (!/[0-9]/.test(lower)) return false;
    for (const word of VIEW_WORDS) {
        if (lower.indexOf(word) === -1) continue;
        // Whole word for the Latin ones; the CJK and Arabic entries have no
        // word boundaries to speak of, so a substring is all there is.
        if (!/^[a-zà-ÿ\- ]+$/.test(word)) return true;
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, (ch) => '\\' + ch);
        if (new RegExp('(^|[^a-zà-ÿ])' + escaped + '([^a-zà-ÿ]|$)').test(lower)) return true;
    }
    return false;
}

const _loggedBadges = new Set();

function badgeLabel(wrapper) {
    const label = wrapper?.metadataBadgeRenderer?.label
        ?? wrapper?.badgeViewModel?.label
        ?? wrapper?.label;
    return typeof label === 'string' ? label.trim() : '';
}

function isHiddenBadge(wrapper) {
    const label = badgeLabel(wrapper);
    if (!label) return false;
    if (QUALITY_LABELS.test(label)) return true;
    const lower = label.toLowerCase();
    for (const word of DUBBED_WORDS) if (lower.indexOf(word) !== -1) return true;
    // Not matched: recorded so an unlisted wording can be added from a capture
    // rather than guessed at. Once per label, capped.
    if (_loggedBadges.size < 40 && !_loggedBadges.has(lower)) {
        _loggedBadges.add(lower);
        appendFileOnlyLog('tiles.badgeSeen', { label });
    }
    return false;
}

/** A metadata entry that is only a separator, left behind after a removal. */
function isDividerText(text) {
    return /^[\s•·|,]+$/.test(String(text || ''));
}

/** Drop separators that a removal left stranded at either end or doubled up. */
function cleanDividers(items, getText) {
    while (items.length && isDividerText(getText(items[0]))) items.shift();
    while (items.length && isDividerText(getText(items[items.length - 1]))) items.pop();
    for (let i = items.length - 1; i > 0; i--) {
        if (isDividerText(getText(items[i])) && isDividerText(getText(items[i - 1]))) items.splice(i, 1);
    }
    return items;
}

function wantCounts() {
    try { return configRead('hideViewCounts') === true; } catch (e) { return false; }
}

function wantBadges() {
    try { return configRead('hideQualityBadges') === true; } catch (e) { return false; }
}

/**
 * Strip counts and badges from anywhere in a response, in place.
 *
 * Walks rather than naming paths, because the same count appears under
 * tileRenderer metadata lines, lockupViewModel rows and the watch page's own
 * renderers, and those paths have been reshaped more than once. Bounded, and
 * never follows an action's parameters — this fork's long press entries keep a
 * copy of a whole video item there.
 */
export function stripCountsFromItems(items, pageName = null) {
    if (!Array.isArray(items) || !items.length) return items;
    const counts = wantCounts();
    const badges = wantBadges();
    if (!counts && !badges) return items;
    let touched = 0;
    for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        if (walk(item, counts, badges, 0)) touched++;
    }
    if (touched) appendFileOnlyLog('tiles.countsStripped', { page: pageName, items: items.length, touched });
    return items;
}

/**
 * The watch page, which keeps its counts in renderers of its own rather than
 * in a tile array.
 *
 * Named subtrees rather than the whole response, so the walk stays short.
 */
export function hideViewCountsAndBadges(response) {
    const counts = wantCounts();
    const badges = wantBadges();
    if (!counts && !badges) return response;
    const roots = [
        response?.contents?.singleColumnWatchNextResults,
        response?.playerOverlays,
        response?.transportControls,
        response?.engagementPanels,
        response?.videoDetails,
    ];
    for (const root of roots) walk(root, counts, badges, 0);
    return response;
}

/** True when anything was actually removed, so the log can say so. */
function walk(node, counts, badges, depth) {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return false;
    let changed = false;

    if (Array.isArray(node)) {
        for (const child of node) {
            if (walk(child, counts, badges, depth + 1)) changed = true;
        }
        return changed;
    }

    for (const key of Object.keys(node)) {
        if (key === 'parameters') continue;

        if (counts && COUNT_FIELDS.indexOf(key) !== -1) {
            delete node[key];
            changed = true;
            continue;
        }

        if (badges && key === 'badges' && Array.isArray(node[key])) {
            const before = node[key].length;
            node[key] = node[key].filter((badge) => !isHiddenBadge(badge));
            if (node[key].length !== before) changed = true;
            continue;
        }
        if (badges && key === 'badge' && node[key] && isHiddenBadge(node[key])) {
            delete node[key];
            changed = true;
            continue;
        }

        // A metadata line: its items are the parts shown under the title, one
        // of which is the count and one of which may be a badge.
        if (Array.isArray(node[key]) && node[key].length) {
            const before = node[key].length;
            const filtered = node[key].filter((item) => {
                if (!item || typeof item !== 'object') return true;
                const inner = item.lineItemRenderer || item.lineRenderer || item;
                if (counts && looksLikeViewCount(textOf(inner))) return false;
                if (badges && inner.badge && isHiddenBadge(inner.badge)) return false;
                return true;
            });
            if (filtered.length !== before) {
                node[key] = cleanDividers(filtered, (item) => textOf(item?.lineItemRenderer || item?.lineRenderer || item));
                changed = true;
            }
        }

        if (walk(node[key], counts, badges, depth + 1)) changed = true;
    }

    return changed;
}

export const _internals = { looksLikeViewCount, isHiddenBadge, cleanDividers, isDividerText };
