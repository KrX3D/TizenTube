import { configRead } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';

/**
 * playerButtonHider.js — drop buttons from the action row under the player.
 *
 * Requested: "Mitglied werden", "Abonnieren/Abonniert", "Daumen hoch",
 * "Daumen runter" and "Speichern" are of no use on a TV you watch with and
 * take up the row you move along to reach the ones that are.
 *
 * Matched on the button's type, not its label, which is localised. The type
 * constants are not published anywhere, so each button is matched on the start
 * of the name rather than on an exact string — SUBSCRIBE also catches
 * SUBSCRIBE_BUTTON and a SUBSCRIBED variant — and the button's icon name is
 * tried as a second signal, since the two are named alike. Whatever the row
 * actually held is logged once per shape under `player.buttonTypes`, so a
 * button that survives can be named from a capture instead of guessed at
 * again.
 */

// Every button in the row is a TRANSPORT_CONTROLS_BUTTON_TYPE_<something>.
const TYPE_PREFIX = 'TRANSPORT_CONTROLS_BUTTON_TYPE_';

const BUTTONS = [
    // Membership. SPONSORSHIPS and SPONSOR_… only: SPONSORBLOCK_HIGHLIGHT is
    // this fork's own button and must never match (also guarded below).
    { key: 'hidePlayerJoinButton', name: 'join', match: /^(SPONSORSHIPS?$|SPONSOR_|MEMBERSHIP|JOIN)/ },
    { key: 'hidePlayerSubscribeButton', name: 'subscribe', match: /^SUBSCRIBE/ },
    { key: 'hidePlayerLikeButton', name: 'like', match: /^LIKE/ },
    { key: 'hidePlayerDislikeButton', name: 'dislike', match: /^DISLIKE/ },
    { key: 'hidePlayerSaveButton', name: 'save', match: /^(ADD_TO_PLAYLIST|SAVE)/ },
];

function typeSuffix(item) {
    const type = item && typeof item === 'object' ? item.type : null;
    if (typeof type !== 'string' || type.indexOf(TYPE_PREFIX) !== 0) return null;
    return type.slice(TYPE_PREFIX.length);
}

function iconName(item) {
    const icon = item?.button?.buttonRenderer?.icon?.iconType;
    return typeof icon === 'string' ? icon : null;
}

function enabled(key) {
    try {
        return configRead(key) === true;
    } catch (e) {
        return false;
    }
}

/**
 * True when the name covers thumbs up and thumbs down together.
 *
 * DISLIKE contains LIKE, so the two cannot simply both be looked for: the
 * dislikes are taken out of the name first, and a LIKE left over after that is
 * a second, separate button in the same name.
 */
function isCombinedLike(name) {
    if (!name || name.indexOf('DISLIKE') === -1) return false;
    return name.split('DISLIKE').join('').indexOf('LIKE') !== -1;
}

/** Which setting hides this button, or null to keep it. */
function hiddenReason(item) {
    const suffix = typeSuffix(item);
    const icon = iconName(item);
    if (!suffix && !icon) return null;

    // Ours, and it starts with the same letters as the membership button.
    if (suffix && suffix.indexOf('SPONSORBLOCK') === 0) return null;

    // Some builds send one segmented button for both thumbs. Removing it on
    // "hide thumbs up" alone would take the thumbs down with it, which is not
    // what was asked for, so it goes only when both are hidden.
    if (isCombinedLike(suffix) || isCombinedLike(icon)) {
        return enabled('hidePlayerLikeButton') && enabled('hidePlayerDislikeButton') ? 'likeDislike' : null;
    }

    for (const button of BUTTONS) {
        if (!enabled(button.key)) continue;
        if ((suffix && button.match.test(suffix)) || (icon && button.match.test(icon))) return button.name;
    }
    return null;
}

/** True when at least one of the five is hidden, so nothing is wrapped for nothing. */
export function anyPlayerButtonHidden() {
    for (const button of BUTTONS) if (enabled(button.key)) return true;
    return false;
}

const seenShapes = [];

function noteShape(items) {
    const shape = items.map((item) => typeSuffix(item) || iconName(item) || '?').join(',');
    if (!shape || seenShapes.indexOf(shape) !== -1) return;
    seenShapes.push(shape);
    appendFileOnlyLog('player.buttonTypes', { items: shape });
}

/**
 * Filter one group of player buttons.
 *
 * Returns a new array rather than splicing, the way the other filters in
 * customUI.js do, and returns the input untouched for anything that is not a
 * list of buttons — the groups are found by reading minified source, so one of
 * them returning something else entirely is a normal outcome.
 */
export function filterPlayerButtons(items, group) {
    if (!Array.isArray(items)) return items;
    noteShape(items);
    if (!anyPlayerButtonHidden()) return items;

    const kept = [];
    const removed = [];
    for (const item of items) {
        const reason = hiddenReason(item);
        if (reason) removed.push(reason);
        else kept.push(item);
    }
    if (removed.length) {
        appendFileOnlyLog('player.buttonsHidden', {
            group,
            removed: removed.join(','),
            before: items.length,
            after: kept.length,
        });
    }
    return kept;
}
