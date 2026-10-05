import { configRead } from '../config.js';
import { appendFileOnlyLog, appendVisibleLog } from './hideWatched.js';

/**
 * playerButtonHider.js — drop buttons from the action row under the player.
 *
 * Requested: "Mitglied werden", "Abonnieren/Abonniert", "Daumen hoch",
 * "Daumen runter" and "Speichern" are of no use on a TV you watch with and
 * take up the row you move along to reach the ones that are.
 *
 * Reported not working when this only filtered the player component: the row
 * is built from the watch response, which carries it as
 * `transportControls.transportControlsRenderer` — the same renderer
 * adblock.js already pushes the SponsorBlock highlight button into. So the
 * response is the place to do this, and the component filter stays as a second
 * pass for anything the component adds on its own.
 *
 * Buttons are identified by structure, never by label, which is localised:
 *
 *  1. the button type (`TRANSPORT_CONTROLS_BUTTON_TYPE_<name>`), matched on
 *     the start of the name so SUBSCRIBE also catches SUBSCRIBE_BUTTON and a
 *     SUBSCRIBED variant;
 *  2. the icon name, which is named alike;
 *  3. the endpoint the button runs, which is the strongest signal of the three
 *     and the only one that works for a button sitting in a generic slot such
 *     as FEATURED_ACTION — a membership button is whatever runs a
 *     sponsorships endpoint, whatever its type says.
 *
 * Thumbs up and thumbs down are the same `likeEndpoint` with a different
 * `status`, so that endpoint is only ever recorded with its status attached;
 * recording the bare key would make either thumb match the other's setting.
 *
 * Whatever the row actually held is logged once per shape under
 * `player.buttonTypes`, with all three signals, so a button that survives can
 * be named from a capture instead of guessed at again.
 */

const TYPE_PREFIX = 'TRANSPORT_CONTROLS_BUTTON_TYPE_';

// An endpoint whose meaning depends on a field inside it: recorded as
// "<key>:<status>" only, never bare.
const STATUS_ENDPOINTS = ['likeEndpoint'];

const BUTTONS = [
    {
        key: 'hidePlayerJoinButton', name: 'join',
        // SPONSORSHIPS and SPONSOR_… only: SPONSORBLOCK_HIGHLIGHT is this
        // fork's own button and must never match (also guarded below).
        match: [/^SPONSORSHIPS?$/i, /^SPONSOR_/i, /MEMBERSHIP/i, /^JOIN/i, /^ypcGetMembershipOffer/i, /^sponsorships?Endpoint$/i],
    },
    {
        key: 'hidePlayerSubscribeButton', name: 'subscribe',
        match: [/^SUBSCRIBE/i, /^UNSUBSCRIBE/i, /^subscribeCommand$/i],
    },
    {
        // Both thumbs, under one setting. Tested on Tizen 5.5 and 6.5: the
        // renderer's own hideDislikeButton flag is ignored by the app, so the
        // thumbs down half cannot be hidden on its own either, and there is
        // nothing left to offer but both or neither. Every thumbs shape a
        // build might send is matched here, so one setting covers all of them.
        key: 'hidePlayerThumbsButtons', name: 'thumbs',
        // The two keys this setting replaced. A TV upgraded from a build that
        // had them keeps hiding the thumbs without being re-toggled.
        alsoKeys: ['hidePlayerLikeButton', 'hidePlayerDislikeButton'],
        match: [/^LIKE$/, /^LIKE_/, /^DISLIKE/, /^likeEndpoint:/],
    },
    {
        key: 'hidePlayerSaveButton', name: 'save',
        match: [/^ADD_TO_PLAYLIST/i, /^SAVE/i, /^addToPlaylistEndpoint$/i],
    },
    {
        key: 'hidePlayerCommentsButton', name: 'comments',
        match: [/^COMMENTS?$/i, /^COMMENTS?_/i, /^commentsEndpoint$/i, /^showEngagementPanelEndpoint:comments/i],
    },
    {
        // ABOUT_BUTTON is what the app calls it internally, but on screen it
        // reads "Beschreibung" — reported after #777 shipped calling it Info.
        // There is one button here, not two: the panel it opens is
        // video-description-ep-identifier, which is why the separate
        // description option this once had was the same button twice.
        key: 'hidePlayerAboutButton', name: 'about',
        match: [/^ABOUT/i, /^DESCRIPTION/i, /^panel:video-description/i, /^descriptionEndpoint$/i],
    },
    {
        key: 'hidePlayerPreviousButton', name: 'previous',
        match: [/^SKIP_PREVIOUS/i, /^PREVIOUS/i, /^skipPreviousButton$/i],
    },
    {
        key: 'hidePlayerNextButton', name: 'next',
        match: [/^SKIP_NEXT/i, /^NEXT$/i, /^NEXT_/i, /^skipNextButton$/i],
    },
];

// Previous and next are not entries in a button list at all: the app keeps
// them in their own named slots, which is why they need removing by name as
// well as matching by signal.
const SLOT_FIELDS = {
    hidePlayerPreviousButton: 'skipPreviousButton',
    hidePlayerNextButton: 'skipNextButton',
};

// The renderers a button can be wrapped in, and the endpoint fields each can
// carry. Read rather than searched: a deep walk here would reach the video
// item some endpoints embed.
const BUTTON_RENDERERS = ['buttonRenderer', 'toggleButtonRenderer', 'buttonViewModel', 'toggleButtonViewModel'];
const ENDPOINT_FIELDS = [
    'serviceEndpoint', 'navigationEndpoint', 'command', 'onTap', 'endpoint',
    'defaultServiceEndpoint', 'toggledServiceEndpoint', 'defaultNavigationEndpoint',
];
const ICON_FIELDS = ['icon', 'defaultIcon', 'toggledIcon'];

function typeSuffix(item) {
    const type = item && typeof item === 'object' ? item.type : null;
    if (typeof type !== 'string' || type.indexOf(TYPE_PREFIX) !== 0) return null;
    return type.slice(TYPE_PREFIX.length);
}

/** Every structural name this button goes by, for matching and for the log. */
function signalsOf(item) {
    const signals = [];
    const suffix = typeSuffix(item);
    if (suffix) signals.push(suffix);
    if (!item || typeof item !== 'object') return signals;

    for (const rendererKey of BUTTON_RENDERERS) {
        const renderer = item.button?.[rendererKey] || item[rendererKey];
        if (!renderer || typeof renderer !== 'object') continue;

        for (const iconKey of ICON_FIELDS) {
            const iconType = renderer[iconKey]?.iconType;
            if (typeof iconType === 'string') signals.push(iconType);
        }

        for (const field of ENDPOINT_FIELDS) {
            const endpoint = renderer[field];
            if (!endpoint || typeof endpoint !== 'object') continue;
            for (const key of Object.keys(endpoint)) {
                if (key === 'clickTrackingParams' || key === 'commandMetadata') continue;
                const status = endpoint[key] && typeof endpoint[key] === 'object' ? endpoint[key].status : null;
                if (STATUS_ENDPOINTS.indexOf(key) !== -1) {
                    // Ambiguous on its own — only useful with the status.
                    if (typeof status === 'string') signals.push(key + ':' + status);
                    continue;
                }
                signals.push(key);
                if (typeof status === 'string') signals.push(key + ':' + status);
                // An engagement panel endpoint says which panel it opens, and
                // that identifier is not localised. It is the only way to tell
                // the description button from any other panel button.
                const panel = endpoint[key] && typeof endpoint[key] === 'object'
                    ? (endpoint[key].panelIdentifier || endpoint[key].identifier?.tag)
                    : null;
                if (typeof panel === 'string') signals.push('panel:' + panel);
            }
        }
    }
    return signals;
}

function enabled(key) {
    try {
        return configRead(key) === true;
    } catch (e) {
        return false;
    }
}

/** Which setting hides this button, or null to keep it. */
function hiddenReason(item) {
    const signals = signalsOf(item);
    if (!signals.length) return null;

    // Ours, and it starts with the same letters as the membership button.
    for (const signal of signals) if (signal.indexOf('SPONSORBLOCK') === 0) return null;

    for (const button of BUTTONS) {
        if (!buttonEnabled(button)) continue;
        for (const pattern of button.match) {
            for (const signal of signals) if (pattern.test(signal)) return button.name;
        }
    }
    return null;
}

/** True when at least one button is hidden, so nothing is wrapped for nothing. */
export function anyPlayerButtonHidden() {
    for (const button of BUTTONS) if (buttonEnabled(button)) return true;
    return false;
}

const seenShapes = [];
/** True when this button is to be hidden, by its own key or a retired one. */
function buttonEnabled(button) {
    if (enabled(button.key)) return true;
    for (const key of button.alsoKeys || []) if (enabled(key)) return true;
    return false;
}

const seenHolders = [];

/**
 * Where the player's button row actually is, on this build.
 *
 * Added when it looked like the row was not being found at all. A capture
 * showed the opposite — transportControls holds skipPreviousButton,
 * skipNextButton and the three starred lists promotedActions[4],
 * engagementActions[4] and settingActions[11], all of which this filters — so
 * it stays as the one line that tells a missing row apart from a button that
 * was found and kept, and it has to be written unconditionally to do that.
 *
 * Key names only, one level, plus which keys held something that looked like a
 * list of buttons. Recorded once per distinct shape.
 */
function noteHolders(response, holders) {
    try {
        // Only for a response that carries a player at all, or this would fire
        // for every browse payload.
        if (!response || typeof response !== 'object') return;
        if (!response.transportControls && !response.playerOverlays) return;

        const seen = {};
        for (const [name, holder] of holders) {
            if (!holder || typeof holder !== 'object') {
                seen[name] = holder === undefined ? 'absent' : typeof holder;
                continue;
            }
            const lists = [];
            const keys = [];
            for (const key of Object.keys(holder)) {
                keys.push(key);
                if (Array.isArray(holder[key])) {
                    lists.push(key + '[' + holder[key].length + ']' + (looksLikeButtonList(holder[key]) ? '*' : ''));
                }
            }
            seen[name] = { keys: keys.slice(0, 24), lists };
        }
        const shape = JSON.stringify(seen);
        if (seenHolders.indexOf(shape) !== -1 || seenHolders.length >= 4) return;
        seenHolders.push(shape);
        // A starred list is one this code would filter; no star means the
        // buttons are somewhere this does not look.
        appendVisibleLog('player.rowShape', { seen });
    } catch (e) { }
}

function noteShape(items, group) {
    const shape = items.map((item) => signalsOf(item).join('+') || '?').join(' | ');
    if (!shape || seenShapes.indexOf(shape) !== -1) return;
    seenShapes.push(shape);
    appendVisibleLog('player.buttonTypes', { source: group, items: shape });
}

/**
 * True for an array that holds player buttons, rather than some other array
 * that happens to sit next to them.
 */
function looksLikeButtonList(value) {
    if (!Array.isArray(value) || !value.length) return false;
    for (const item of value) {
        if (!item || typeof item !== 'object') return false;
        if (typeof item.type === 'string' && item.type.indexOf(TYPE_PREFIX) === 0) return true;
        for (const rendererKey of BUTTON_RENDERERS) if (item.button?.[rendererKey]) return true;
    }
    return false;
}

/**
 * Filter one group of player buttons.
 *
 * Returns a new array rather than splicing, the way the other filters in
 * customUI.js do, and returns the input untouched for anything that is not a
 * list of buttons — the component's groups are found by reading minified
 * source, so one of them returning something else entirely is a normal
 * outcome.
 */
export function filterPlayerButtons(items, group) {
    if (!Array.isArray(items)) return items;
    noteShape(items, group || 'component');
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
            group: group || 'component',
            removed: removed.join(','),
            before: items.length,
            after: kept.length,
        });
    }
    return kept;
}

/**
 * Filter the row out of the watch response, which is where it comes from.
 *
 * Only the two renderers that hold it are looked at, and only their own
 * arrays — not a deep walk, which would reach the whole video item that some
 * endpoints embed. Called before adblock.js pushes the SponsorBlock highlight
 * button in, so that button is never even a candidate.
 */
export function filterPlayerButtonsInResponse(response) {
    try {
        const holders = [
            ['transportControls', response?.transportControls?.transportControlsRenderer],
            ['playerOverlay', response?.playerOverlays?.playerOverlayRenderer],
        ];
        noteHolders(response, holders);
        for (const [name, holder] of holders) {
            if (!holder || typeof holder !== 'object') continue;
            for (const key of Object.keys(holder)) {
                if (!looksLikeButtonList(holder[key])) continue;
                holder[key] = filterPlayerButtons(holder[key], name + '.' + key);
            }
            // The two that live in a slot of their own rather than in a list.
            for (const setting of Object.keys(SLOT_FIELDS)) {
                const field = SLOT_FIELDS[setting];
                if (holder[field] === undefined || !enabled(setting)) continue;
                delete holder[field];
                appendFileOnlyLog('player.buttonsHidden', { group: name, removed: field, before: 1, after: 0 });
            }
        }
    } catch (err) {
        appendFileOnlyLog('player.buttonFilter.error', { message: err?.message || String(err) });
    }
    return response;
}
