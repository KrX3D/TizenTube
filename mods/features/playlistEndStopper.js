import { configRead } from '../config.js';
import { appendFileOnlyLog, appendVisibleLog } from './hideWatched.js';
import { t } from 'i18next';

/**
 * playlistEndStopper.js — stop at the end of a playlist instead of wandering
 * off into a recommendation.
 *
 * Ported from siriusvoid's fork. Their investigation notes are the valuable
 * part and are kept here, because every one of them is a thing that was tried
 * and found out rather than reasoned about:
 *
 *  - On the true last video of a playlist, the /next response's
 *    autoplay.autoplay.sets (NORMAL mode) falls back to an unrelated
 *    recommended video. That is what plays something random.
 *  - Those sets drive silent auto-navigation only. They control nothing
 *    visible: a playlist transition in this app is always a silent cut.
 *  - A normal, non-playlist video reaching its end does show a real native
 *    "Up next" overlay, and that comes from a different, server-authored
 *    object: playerOverlays.playerOverlayRenderer.autoplay. At the end of a
 *    playlist the server never sends that key at all — the app was not
 *    designed for "nothing left to play" — so nothing renders and the screen
 *    goes black.
 *  - An earlier attempt of theirs synthesised playerOverlayRenderer.replay
 *    instead. That key has no working component in this app and made the
 *    player exit back to the playlist.
 *
 * So: remove the NORMAL set's autoplayVideoRenderer, which is the actual
 * trigger, and synthesise the overlay shape that is already proven to render,
 * pointed at the current video through replayVideoRenderer.pivotVideoRenderer
 * — which every /next response carries whatever the playlist state.
 *
 * Changed from their version in two ways. It installed its own JSON.parse
 * patch; this fork already has one in adblock.js, and a second patch over the
 * first costs every response twice and makes the order matter. And their
 * overlay strings were hardcoded English, which on this fork means German too.
 */

const COUNTDOWN_SECS = 5;

// Reported: all logging on, all categories on, and a playlist end still
// wrote nothing. This was a single flag for the lifetime of the app, so the
// first /next response of the session spent it and every later stop was
// silent. One line per video instead, capped so a long session cannot grow
// without bound.
const _stopped = new Set();
const _skips = new Set();

/**
 * Say why nothing was done, once per distinct reason.
 *
 * Visible on screen, not just in the log file: this exists to be read after a
 * playlist failed to stop, and a line nobody can see is no use for that.
 */
function noteSkip(reason, detail) {
    const key = reason + JSON.stringify(detail || {});
    if (_skips.has(key) || _skips.size >= 8) return;
    _skips.add(key);
    appendVisibleLog('player.playlistEnd.skipped', Object.assign({ reason }, detail || {}));
}

/** A number out of "12 Videos", "12 videos", "12" or 12. */
function countFrom(value) {
    if (typeof value === 'number' && isFinite(value)) return value;
    const text = value && typeof value === 'object'
        ? (value.simpleText || (Array.isArray(value.runs) ? value.runs.map((r) => r?.text || '').join('') : ''))
        : String(value || '');
    const digits = text.replace(/[^0-9]/g, '');
    return digits ? Number(digits) : null;
}

/**
 * Is this the last video of the playlist, and what was that decided from?
 *
 * The first cut read currentIndex and totalVideos and nothing else, so a build
 * that names either of them differently — or omits the count, which a playlist
 * still loading does — read as "not the last video" and the feature never
 * fired. Every signal the renderer might carry is tried, and which one answered
 * is reported.
 */
export function lastVideoVerdict(playlist) {
    const index = typeof playlist.currentIndex === 'number' ? playlist.currentIndex : null;
    const counts = {
        totalVideos: countFrom(playlist.totalVideos),
        localizedTotalVideos: countFrom(playlist.localizedTotalVideos),
        totalVideosText: countFrom(playlist.totalVideosText),
        contents: Array.isArray(playlist.contents) ? playlist.contents.length : null,
    };

    for (const field of ['totalVideos', 'localizedTotalVideos', 'totalVideosText', 'contents']) {
        const total = counts[field];
        if (index === null || !total) continue;
        return { isLast: index === total - 1, from: field, index, total };
    }

    // No count to compare against, so fall back to the panel itself: the last
    // item being the one marked as playing is the same statement.
    const items = Array.isArray(playlist.contents) ? playlist.contents : null;
    if (items && items.length) {
        const selectedAt = items.findIndex((item) => {
            const r = item?.playlistPanelVideoRenderer || item?.tileRenderer || item;
            return r?.selected === true || r?.isPlaying === true || r?.playing === true;
        });
        if (selectedAt !== -1) {
            return { isLast: selectedAt === items.length - 1, from: 'selectedItem', index: selectedAt, total: items.length };
        }
    }

    return { isLast: false, from: 'nothing', index, counts, keys: Object.keys(playlist).slice(0, 14) };
}

/**
 * Rewrite the end-of-playlist case in a /next response, in place.
 *
 * Does nothing unless the setting is on, the response is a watch response for
 * a playlist, and the video is the last one in it.
 */
export function stopAtPlaylistEnd(response) {
    try {
        if (configRead('enableStopAtPlaylistEnd') !== true) return response;

        const results = response?.contents?.singleColumnWatchNextResults;
        const playlist = results?.playlist?.playlist;
        const sets = results?.autoplay?.autoplay?.sets;
        const pivot = results?.autoplay?.autoplay?.replayVideoRenderer?.pivotVideoRenderer;
        const overlayRenderer = response?.playerOverlays?.playerOverlayRenderer;

        // Not a watch response for a playlist at all: the overwhelming
        // majority of responses, so this is silent.
        if (!playlist) return response;

        if (!Array.isArray(sets) || !pivot?.navigationEndpoint?.watchEndpoint) {
            noteSkip('no autoplay set or nothing to replay', {
                sets: Array.isArray(sets) ? sets.length : typeof sets,
                pivot: !!pivot,
            });
            return response;
        }

        const where = lastVideoVerdict(playlist);
        if (!where.isLast) {
            // Reported: the last video of a playlist still counted down into
            // something unrelated. The count and the position are read from
            // whichever of these the build actually sends, and when none of
            // them answers, the shape is reported rather than silently
            // treated as "not the last video" — which is what happened.
            noteSkip('not the last video', where);
            return response;
        }

        for (const set of sets) {
            if (set && set.mode === 'NORMAL') delete set.autoplayVideoRenderer;
        }

        if (overlayRenderer) {
            const byline = pivot.shortBylineText?.runs?.[0]?.text
                ? { simpleText: pivot.shortBylineText.runs[0].text }
                : pivot.shortBylineText;

            overlayRenderer.autoplay = {
                playerOverlayAutoplayRenderer: {
                    title: { simpleText: t('player.playlistEnd.title') },
                    videoTitle: pivot.title,
                    byline,
                    cancelText: { simpleText: t('player.playlistEnd.cancel') },
                    pauseText: { simpleText: t('player.playlistEnd.paused') },
                    background: pivot.thumbnail,
                    countDownSecs: COUNTDOWN_SECS,
                    nextButton: {
                        buttonRenderer: {
                            isDisabled: false,
                            icon: { iconType: 'PLAYING' },
                            navigationEndpoint: pivot.navigationEndpoint,
                            accessibility: { label: t('player.playlistEnd.replay') },
                            trackingParams: pivot.trackingParams ?? ''
                        }
                    },
                    trackingParams: pivot.trackingParams ?? '',
                    preferImmediateRedirect: false,
                    videoId: pivot.videoId,
                    countDownSecsForFullscreen: COUNTDOWN_SECS
                }
            };
        }

        if (!_stopped.has(pivot.videoId) && _stopped.size < 50) {
            _stopped.add(pivot.videoId);
            appendVisibleLog('player.playlistEndStopped', {
                videoId: pivot.videoId,
                index: where.index,
                items: where.total,
                decidedBy: where.from,
                overlay: !!overlayRenderer,
            });
        }
    } catch (err) {
        appendFileOnlyLog('player.playlistEnd.error', { message: err?.message || String(err) });
    }
    return response;
}
