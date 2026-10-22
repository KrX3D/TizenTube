import { configChangeEmitter, configRead } from '../config.js';
import { appendFileOnlyLog } from '../features/hideWatched.js';

configChangeEmitter.addEventListener('configChange', (event) => {
    const { key, value } = event.detail;
    if (key === 'enableWhoIsWatchingMenu') {
        disableWhosWatching(value);
    }
});

let interval;

// Beyond which the screens have either appeared or not. Long enough to cover a
// slow launch, short enough that a viewer who gives up and closes the app has
// probably not done so yet.
const FIRING_WINDOW_MS = 30000;
let firingTimer = null;

// The keys this file writes, and therefore the ones whose movement says
// nothing about YouTube.
const OURS = [
    'startup-screen-account-selector-with-guest',
    'whos_watching_fullscreen_zero_accounts',
    'startup-screen-signed-out-welcome-back',
];

/** Seconds since each action last fired, by name. */
function ageOf(data, names) {
    const out = {};
    const now = Date.now();
    for (let i = 0; i < names.length; i++) {
        const fired = data[names[i]] && data[names[i]].lastFired;
        out[names[i]] = (typeof fired === 'number' && isFinite(fired))
            ? Math.round((now - fired) / 1000)
            : null;
    }
    return out;
}

/**
 * Which actions fire while the app is starting.
 *
 * The map is re-read rather than watched: there is no event for it, and a
 * second reading answers the question a listener would.
 */
function watchForFiring(dataAtStartup) {
    if (firingTimer) return;
    const before = {};
    const names = Object.keys(dataAtStartup);
    // The three keys this file writes are left out of the comparison
    // altogether.
    //
    // The first capture of this reported all three as having "fired", seven
    // days into the future:
    //
    //   fired [{"action":"whos_watching_fullscreen_zero_accounts","atSec":608400},
    //          {"action":"startup-screen-signed-out-welcome-back","atSec":608400},
    //          {"action":"startup-screen-account-selector-with-guest","atSec":608400}]
    //
    // That is this file's own doing, seen from the outside: the snapshot was
    // taken before the pushes and the pushes then changed exactly those three.
    // The call now happens after them, which fixes the ordering — and these
    // three are skipped as well, because the permanent-enable path rewrites
    // them once a minute and no comparison can tell that from a real firing.
    // Their suppression is visible in agoSec being negative; it does not need
    // to be visible here too.
    for (let i = 0; i < names.length; i++) {
        const fired = dataAtStartup[names[i]] && dataAtStartup[names[i]].lastFired;
        before[names[i]] = typeof fired === 'number' ? fired : null;
    }
    const startedAt = Date.now();

    firingTimer = setTimeout(function () {
        firingTimer = null;
        try {
            const raw = localStorage['yt.leanback.default::recurring_actions'];
            if (!raw) return;
            const after = (JSON.parse(raw).data || {}).data || {};
            const fired = [];
            const appeared = [];
            Object.keys(after).forEach(function (name) {
                const now = after[name] && after[name].lastFired;
                if (typeof now !== 'number') return;
                if (!(name in before)) {
                    appeared.push(name);
                    return;
                }
                if (OURS.indexOf(name) !== -1) return;
                if (before[name] !== now) {
                    // When it fired, relative to this launch, which is the
                    // number that lines it up against the screen appearing.
                    fired.push({ action: name, atSec: Math.round((now - startedAt) / 1000) });
                }
            });
            appendFileOnlyLog('whosWatching.fired', {
                withinSec: Math.round(FIRING_WINDOW_MS / 1000),
                // Empty means nothing fired in the window, which is itself the
                // answer on a launch that did not ask for a profile.
                fired: fired,
                // An action this TV had never recorded before, which a first
                // sighting of the failing path could well produce.
                newActions: appeared,
            });
        } catch (err) { }
    }, FIRING_WINDOW_MS);
    try { if (typeof firingTimer.unref === 'function') firingTimer.unref(); } catch (e) { }
}

function disableWhosWatching(value) {
    // FIX: Wrap the entire function body — localStorage may be missing or corrupt
    // (e.g. first boot, reset, or storage quota hit) and JSON.parse can throw.
    let LeanbackRecurringActions;
    try {
        const raw = localStorage['yt.leanback.default::recurring_actions'];
        if (!raw) {
            console.warn('[disableWhosWatching] recurring_actions not found in localStorage — skipping');
            return;
        }
        LeanbackRecurringActions = JSON.parse(raw);
    } catch (err) {
        console.warn('[disableWhosWatching] Failed to read/parse recurring_actions:', err);
        return;
    }

    const shouldPermanentlyEnable = configRead('permanentlyEnableWhoIsWatchingMenu');
    const date = new Date();

    // Which startup screens this TV actually has, and which of them this code
    // knows about.
    //
    // Reported: powering the TV off on a page and starting it again goes
    // straight back in, but powering it off during a video asks for the
    // profile first. Three keys are pushed forward below and evidently none of
    // them governs that second path — but they are pushed with `&&`, so a key
    // that is not there is skipped in silence and a key that is there under
    // another name is never touched at all. Either way the result is the same
    // screen and no explanation.
    //
    // Names only. These are the identifiers of YouTube's own startup
    // promotions; the values are timestamps and say nothing useful here.
    try {
        const known = [
            'startup-screen-account-selector-with-guest',
            'whos_watching_fullscreen_zero_accounts',
            'startup-screen-signed-out-welcome-back',
        ];
        const data = (LeanbackRecurringActions.data && LeanbackRecurringActions.data.data) || {};
        const present = Object.keys(data);
        appendFileOnlyLog('whosWatching.actions', {
            enabling: !!value,
            actions: present,
            // The ones this file reaches for and did not find, which is the
            // list to compare against anything new in `actions`.
            missing: known.filter(function (key) { return present.indexOf(key) === -1; }),
            // How long ago each one fired, so the list is not just names.
            // Relative seconds rather than the stored timestamps: an absolute
            // one is a precise record of when this TV gets used, and the
            // question only needs the gap. Negative means a time in the
            // future, which is this file's own doing.
            agoSec: ageOf(data, present),
        });

    } catch (err) { }

    if (!value) {
        try {
            // Setting it after 7 days should be enough, as it'll get executed every time the app launches.
            date.setDate(date.getDate() + 7);
            LeanbackRecurringActions.data.data["startup-screen-account-selector-with-guest"] &&
                (LeanbackRecurringActions.data.data["startup-screen-account-selector-with-guest"].lastFired = date.getTime());
            LeanbackRecurringActions.data.data.whos_watching_fullscreen_zero_accounts.lastFired = date.getTime();
            LeanbackRecurringActions.data.data["startup-screen-signed-out-welcome-back"] &&
                (LeanbackRecurringActions.data.data["startup-screen-signed-out-welcome-back"].lastFired = date.getTime());
            localStorage['yt.leanback.default::recurring_actions'] = JSON.stringify(LeanbackRecurringActions);
        } catch (err) {
            console.warn('[disableWhosWatching] Failed to disable who\'s watching menu:', err);
        }
    } else {
        try {
            // Do nothing if the last fired action is less than 2 hours ago.
            if (
                date.getTime() - LeanbackRecurringActions.data.data["startup-screen-account-selector-with-guest"]?.lastFired > 0 &&
                date.getTime() - LeanbackRecurringActions.data.data["startup-screen-account-selector-with-guest"]?.lastFired < 2 * 60 * 60 * 1000 &&
                !shouldPermanentlyEnable
            ) {
                return;
            }

            function setActions() {
                try {
                    LeanbackRecurringActions.data.data["startup-screen-account-selector-with-guest"] &&
                        (LeanbackRecurringActions.data.data["startup-screen-account-selector-with-guest"].lastFired = date.getTime());
                    LeanbackRecurringActions.data.data.whos_watching_fullscreen_zero_accounts.lastFired = date.getTime();
                    LeanbackRecurringActions.data.data["startup-screen-signed-out-welcome-back"] &&
                        (LeanbackRecurringActions.data.data["startup-screen-signed-out-welcome-back"].lastFired = date.getTime());
                    localStorage['yt.leanback.default::recurring_actions'] = JSON.stringify(LeanbackRecurringActions);
                } catch (err) {
                    console.warn('[disableWhosWatching] setActions failed:', err);
                }
            }

            setActions();
            if (shouldPermanentlyEnable) {
                date.setDate(date.getDate() - 7);
                setActions();
                interval = setInterval(setActions, 60 * 1000);
            } else if (interval) {
                clearInterval(interval);
            }
        } catch (err) {
            console.warn('[disableWhosWatching] Failed to enable who\'s watching menu:', err);
        }
    }
}

/**
 * Watch for a firing after whatever this file was going to write.
 *
 * Separate from disableWhosWatching so the snapshot is taken once the pushes
 * are done, which is the whole correction: a snapshot from before them sees
 * them as YouTube firing three screens at once, seven days in the future.
 */
function watchAfterSettling() {
    try {
        const raw = localStorage['yt.leanback.default::recurring_actions'];
        if (!raw) return;
        const data = (JSON.parse(raw).data || {}).data || {};
        // This function runs at module load, before the startup screens fire,
        // so what is read here describes the state they will fire from. The
        // one that produces the screen fires during startup, and the reading
        // thirty seconds later names it.
        //
        // Reported: powering off on a page resumes cleanly, powering off
        // during a video asks for the profile — and powering off during a
        // video and back on a few seconds later also resumes cleanly. So
        // whatever fires is time-dependent, which is what makes a before and
        // after worth having rather than a longer list of names.
        watchForFiring(data);
    } catch (err) { }
}

disableWhosWatching(configRead('enableWhoIsWatchingMenu'));
watchAfterSettling();