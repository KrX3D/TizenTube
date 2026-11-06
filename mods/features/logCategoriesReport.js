import { appendFileOnlyLog } from './hideWatched.js';
import { categoryState } from './logCategories.js';

/**
 * logCategoriesReport.js — say which log categories are off, once, at startup.
 *
 * Every capture has a silence in it somewhere, and a silence has two readings:
 * the feature did not run, or its category is switched off and it ran unseen.
 * Nothing in the log distinguished them, and twice in one session that cost a
 * wrong conclusion.
 *
 * On 29 October, aggregateShelf logged nothing while the aggregated row was on
 * screen. That was read as the feature being disabled. It was not: aggregateShelf
 * belongs to the `filters` category, and every one of that category's thirteen
 * prefixes had gone silent on the same day while `shelves` kept logging. One
 * switch, not thirteen features — but establishing that took comparing label
 * counts per day across the whole file.
 *
 * On 6 November the same thing nearly happened with markWatched, which logged
 * nothing on the TV in question. That one really had not run, and the only way
 * to know was to find a different label from the same category — hideVideo,
 * 1147 of them — and reason from its presence.
 *
 * This removes the guesswork. One line at startup names what is on and, more
 * usefully, what is off, so a missing label can be attributed in a second
 * rather than reconstructed from counts.
 *
 * It is exempt from category filtering, which is the point: a line reporting
 * that categories are off must not be silenced by a category being off, or it
 * answers only when the answer is not needed. It is exempt from basic-mode
 * verbosity for the same reason — the list of disabled categories IS the
 * payload, and basic mode would reduce it to "[4]".
 *
 * Nothing is reported when no sink is enabled, because appendFileOnlyLog
 * returns before this can be recorded, and with no log there is no silence to
 * explain.
 */

try {
    const state = categoryState();
    appendFileOnlyLog('logCategories.active', {
        // Named rather than counted: "off: [filters, playlist]" is the whole
        // answer to "why is there no aggregateShelf line".
        off: state.off,
        on: state.on,
        // False means the stored list was missing or unreadable and nothing is
        // being filtered at all, which is a different situation from
        // everything happening to be enabled.
        filtering: state.filtering,
    });
} catch (_) {
    // A diagnostic that throws during startup would be worse than one that is
    // absent.
}
