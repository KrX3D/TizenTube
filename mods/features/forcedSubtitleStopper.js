import { configRead } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';

/**
 * forcedSubtitleStopper.js — stop YouTube turning captions on by itself.
 *
 * Ported from siriusvoid's fork. Some videos arrive with captions already
 * decided for you: the player response marks an audio track as the default and
 * carries an initial caption state, and the app obeys it. Auto-dubbed videos
 * are the common case — the dub is the default track and its captions come on
 * with it.
 *
 * Not the same thing as remembering your caption choice, which this fork
 * already does: that restores captions you switched ON and never turns them
 * off, so it cannot counteract a video that forces them on. This removes the
 * instruction instead, which is the only place the decision is made.
 *
 * Two fields carry it, both on the audio tracks:
 *
 *   captionsInitialState  the state the app should start in
 *   hasDefaultTrack       whether this track is the one to pick
 *
 * Removing the first and clearing the second leaves the tracks themselves
 * untouched, so every subtitle is still there to switch on by hand.
 */

const STATE_FIELD = 'captionsInitialState';

let _loggedOnce = false;

/**
 * Strip the forced-caption instruction from a watch response, in place.
 *
 * Called from both response paths in adblock.js. Does nothing when the setting
 * is off, and nothing when the response has no caption tracklist — most
 * responses do not.
 */
export function stopForcedSubtitles(response) {
    try {
        if (configRead('enableStopForcedSubtitles') !== true) return response;
        const tracks = response?.captions?.playerCaptionsTracklistRenderer?.audioTracks;
        if (!Array.isArray(tracks) || !tracks.length) return response;

        let changed = 0;
        for (const track of tracks) {
            if (!track || typeof track !== 'object') continue;
            const had = track[STATE_FIELD] !== undefined || track.hasDefaultTrack === true;
            if (track[STATE_FIELD] !== undefined) delete track[STATE_FIELD];
            // Set rather than deleted: the app reads this as a boolean, and an
            // absent field and a false one are not always the same to it.
            if (track.hasDefaultTrack === true) track.hasDefaultTrack = false;
            if (had) changed++;
        }

        // Once per session: this runs on every watch response, and a video
        // that forces captions is not rare enough to log each time.
        if (changed && !_loggedOnce) {
            _loggedOnce = true;
            appendFileOnlyLog('player.forcedSubtitlesStopped', { tracks: tracks.length, changed });
        }
    } catch (err) {
        appendFileOnlyLog('player.forcedSubtitles.error', { message: err?.message || String(err) });
    }
    return response;
}
