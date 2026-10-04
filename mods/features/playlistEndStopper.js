import { configRead } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';
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

let _loggedOnce = false;

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

        if (!playlist || !Array.isArray(sets) || !pivot?.navigationEndpoint?.watchEndpoint) return response;
        // currentIndex is zero-based, so the last video is one less than the
        // count. A playlist still loading reports what it has, and being wrong
        // here only means the stop happens a video early or late, not that
        // anything breaks.
        if (playlist.currentIndex !== playlist.totalVideos - 1) return response;

        for (const set of sets) {
            if (set && set.mode === 'NORMAL') delete set.autoplayVideoRenderer;
        }

        if (overlayRenderer) {
            const byline = pivot.shortBylineText?.runs?.[0]?.text
                ? { simpleText: pivot.shortBylineText.runs[0].text }
                : pivot.shortBylineText;

            overlayRenderer.autoplay = {
                playerOverlayAutoplayRenderer: {
                    title: { simpleText: t('player.upNext.title') },
                    videoTitle: pivot.title,
                    byline,
                    cancelText: { simpleText: t('player.upNext.cancel') },
                    pauseText: { simpleText: t('player.upNext.paused') },
                    background: pivot.thumbnail,
                    countDownSecs: COUNTDOWN_SECS,
                    nextButton: {
                        buttonRenderer: {
                            isDisabled: false,
                            icon: { iconType: 'PLAYING' },
                            navigationEndpoint: pivot.navigationEndpoint,
                            accessibility: { label: t('player.upNext.replay') },
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

        if (!_loggedOnce) {
            _loggedOnce = true;
            appendFileOnlyLog('player.playlistEndStopped', {
                videoId: pivot.videoId,
                items: playlist.totalVideos,
                overlay: !!overlayRenderer,
            });
        }
    } catch (err) {
        appendFileOnlyLog('player.playlistEnd.error', { message: err?.message || String(err) });
    }
    return response;
}
