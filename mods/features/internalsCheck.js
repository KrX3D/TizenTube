// Startup check for names YouTube renamed out from under TizenTube.
//
// TizenTube finds most of what it patches by name: icon names in the settings
// menu and player buttons, and app internals found by a string their source
// contains. When YouTube renames one (SLOW_MOTION_VIDEO became SPEEDOMETER,
// upstream reisxd/TizenTube#697) nothing throws: the icon renders blank or the
// feature quietly stops. This looks every name up once after boot and shows a
// toast listing the ones that are gone, so the breakage is visible the day a
// new app build arrives rather than when somebody notices a missing feature.
//
// Silent when everything is found. Every result also goes to the log
// (prefix "internals.") with the full list, which the toast may shorten.

import { configRead } from '../config.js';
import { showToast } from '../ui/ytUI.js';
import { t } from 'i18next';
import { appendFileOnlyLog } from './hideWatched.js';
import { extractAssignedFunctions } from '../utils/ASTParser.js';

// Every icon name TizenTube hands to the app. Keep this in step with new
// icon: '...' / iconType values in mods/ — a name missing here is simply not
// checked. Names compared against at runtime only (resolveCommand.js matching
// both SLOW_MOTION_VIDEO and SPEEDOMETER) are listed too: if both vanish,
// that match is dead.
const ICONS = [
    'ACCOUNT_CIRCLE', 'ADD', 'ARTICLE', 'BOOKMARK_BORDER', 'BROADCAST',
    'BUG_REPORT', 'CHECK_BOX', 'CHEVRON_DOWN', 'CLAPPERBOARD', 'CLEAR_COOKIES',
    'DOLLAR_SIGN', 'DOWN_ARROW', 'EYE_OFF', 'GAMING', 'HELP', 'LENS_BLUE',
    'LIVE', 'LOCATION_POINT', 'MENU', 'MICROPHONE_ON', 'MONEY_HAND',
    'MONEY_HEART', 'NEWS', 'OPEN_IN_NEW', 'PERSON', 'PLAYING', 'PLAYLIST_PLAY',
    'PLAY_ARROW', 'PLAY_CIRCLE', 'PRIVACY_UNLISTED', 'REMOVE', 'SEARCH',
    'SEARCH_HISTORY', 'SEND', 'SETTINGS', 'SKIP_NEXT', 'SKIP_PREVIOUS',
    'SLOW_MOTION_VIDEO', 'SPEEDOMETER', 'STAR', 'SUBSCRIPTIONS',
    'SYSTEM_UPDATE', 'TAB_LIBRARY', 'TAB_MORE', 'TIMER', 'TRANSLATE', 'TROPHY',
    'TV', 'VIDEO_QUALITY', 'VIDEO_YOUTUBE', 'VISIBILITY_OFF', 'WHAT_TO_WATCH',
    'WIFI', 'YOUTUBE_MUSIC', 'YOUTUBE_SHORTS_FILL_24'
];

// How long the app gets after resolveCommand shows up before the boot checks
// run, so modules still loading are not reported as missing.
const BOOT_SETTLE_MS = 10000;
// No resolveCommand by then means there is no way to show a toast either.
const BOOT_GIVE_UP_MS = 60000;
// The player's internals load with the player. They are retried this long
// after the first <video> appears before counting as missing.
const PLAYER_RETRY_MS = 30000;
const POLL_MS = 2000;
// Names shown in the toast before the rest are counted as "+N".
const TOAST_MAX_NAMES = 6;

function yttvValues() {
    try {
        return window._yttv ? Object.values(window._yttv) : [];
    } catch (_) {
        return [];
    }
}

function source(fn) {
    try {
        return Function.prototype.toString.call(fn);
    } catch (_) {
        return '';
    }
}

function hasResolveCommand(values) {
    return values.some(o => o && o.instance && typeof o.instance.resolveCommand === 'function');
}

// The icon registry is a Map of icon name -> glyph class name. Found by shape
// rather than by one key (pictureInPicture.js uses has('CLEAR_COOKIES')), so a
// rename of that one key does not hide every other result. A second Map keyed
// by icon names holds numbers, which the string check rules out.
function findIconMap(values) {
    let best = null;
    for (const o of values) {
        if (!(o instanceof Map) || o.size < 100) continue;
        const first = o.entries().next().value;
        if (!first || typeof first[0] !== 'string' || typeof first[1] !== 'string') continue;
        if (!/^[A-Z0-9_]+$/.test(first[0])) continue;
        if (!best || o.size > best.size) best = o;
    }
    return best;
}

// Internals other modules find by a string in the app's code or a property
// shape. `who` is the TizenTube code that depends on it, for the log.
const BOOT_INTERNALS = [
    {
        name: 'resolveCommand',
        who: 'resolveCommand.js',
        found: hasResolveCommand
    },
    {
        name: 'InnerTube mappings',
        who: 'innerTubeCalls.js',
        found: values => values.some(o => o && o.mappings)
    },
    {
        name: '_yttv JSON.parse',
        who: 'adblock.js',
        found: values => values.some(o => o && o.JSON && typeof o.JSON.parse === 'function')
    },
    {
        name: 'ENABLE_PREVIEWS_WITH_SOUND',
        who: 'enableFeatures.js',
        found: values => values.some(o => o instanceof Map && o.has('ENABLE_PREVIEWS_WITH_SOUND'))
    },
    {
        name: 'this.actionName',
        who: 'customCommandExecution.js',
        found: values => values.some(o => typeof o === 'function' && source(o).indexOf('this.actionName') !== -1)
    }
];

// customUI.js finds the player's button container by one string, then the
// groups inside it by more.
const PLAYER_CONTAINER = 'TRANSPORT_CONTROLS_BUTTON_TYPE_FEATURED_ACTION';
const PLAYER_GROUPS = [
    'TRANSPORT_CONTROLS_BUTTON_TYPE_PLAYBACK_SETTINGS',
    'skipNextButton',
    'skipPreviousButton',
    'props.data.engagementActions'
];

function checkBoot() {
    const values = yttvValues();
    const missing = [];

    const iconMap = findIconMap(values);
    if (!iconMap) {
        missing.push('icon map');
    } else {
        for (const icon of ICONS) {
            if (!iconMap.has(icon)) missing.push(icon);
        }
    }

    for (const check of BOOT_INTERNALS) {
        let ok = false;
        try { ok = check.found(values); } catch (_) { /* counts as missing */ }
        if (!ok) missing.push(check.name);
    }

    return { missing, iconCount: iconMap ? iconMap.size : 0 };
}

function checkPlayer() {
    const container = yttvValues().find(o => typeof o === 'function' && source(o).indexOf(PLAYER_CONTAINER) !== -1);
    if (!container) return [PLAYER_CONTAINER];

    let functions;
    try {
        functions = extractAssignedFunctions(source(container));
    } catch (_) {
        return [PLAYER_CONTAINER + ' (parse)'];
    }
    return PLAYER_GROUPS.filter(name => !functions.some(func => func.rhs && func.rhs.indexOf(name) !== -1));
}

function report(phase, missing, extra) {
    appendFileOnlyLog('internals.' + phase, Object.assign({ missing }, extra));
    if (!missing.length) return;
    console.warn('[TizenTube] Not found in this YouTube build (' + phase + '):', missing.join(', '));

    const shown = missing.slice(0, TOAST_MAX_NAMES).join(', ');
    const rest = missing.length - TOAST_MAX_NAMES;
    showToast(
        t('settings.options.misc.options.internalsCheck.toastTitle'),
        t('settings.options.misc.options.internalsCheck.toast', {
            names: rest > 0 ? shown + ' ' + t('settings.options.misc.options.internalsCheck.more', { n: rest }) : shown
        })
    );
}

function startBootCheck() {
    const startedAt = Date.now();
    const poll = () => {
        if (hasResolveCommand(yttvValues())) {
            setTimeout(() => {
                const result = checkBoot();
                report('boot', result.missing, { icons: ICONS.length, iconMapSize: result.iconCount });
            }, BOOT_SETTLE_MS);
            return;
        }
        if (Date.now() - startedAt > BOOT_GIVE_UP_MS) {
            // No toast possible without resolveCommand; the log is all there is.
            console.warn('[TizenTube] Not found in this YouTube build (boot): resolveCommand');
            appendFileOnlyLog('internals.boot', { missing: ['resolveCommand'] });
            return;
        }
        setTimeout(poll, POLL_MS);
    };
    poll();
}

function startPlayerCheck() {
    let videoSeenAt = 0;
    const poll = () => {
        if (!videoSeenAt) {
            if (document.querySelector('video')) videoSeenAt = Date.now();
            setTimeout(poll, POLL_MS);
            return;
        }
        const missing = checkPlayer();
        if (!missing.length) {
            report('player', missing);
            return;
        }
        if (Date.now() - videoSeenAt < PLAYER_RETRY_MS) {
            setTimeout(poll, POLL_MS);
            return;
        }
        report('player', missing);
    };
    poll();
}

function start() {
    if (!configRead('enableInternalsCheck')) return;
    try {
        startBootCheck();
        startPlayerCheck();
    } catch (err) {
        console.warn('[TizenTube] internals check failed:', err);
    }
}

if (document.readyState === 'complete') {
    start();
} else {
    window.addEventListener('load', start);
}
