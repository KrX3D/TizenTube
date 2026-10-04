import { configRead } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';
import { t } from 'i18next';

/**
 * returnYoutubeDislike.js — put the dislike count back.
 *
 * Ported from JensorX's fork. The count comes from returnyoutubedislike.com's
 * public API, which is a third-party service: enabling this sends the id of
 * every video you open to it. Off by default for that reason, and named in the
 * setting, the same way SponsorBlock and DeArrow are.
 *
 * Rebuilt in two places.
 *
 * Theirs installs its own JSON.parse patch, re-installs it over
 * window._yttv's copies, and then re-runs that installation on a one-second
 * interval forever. This fork already patches JSON.parse once in adblock.js,
 * and the repo has paid for extra per-response work before, so this is called
 * from that existing path instead and costs nothing between videos.
 *
 * Theirs also keeps up to eight whole response objects per video so it can go
 * back and mutate them once the fetch returns. Holding a response graph alive
 * on a TV is not something to do, and mutating an object the app has already
 * read may or may not land. This keeps only the numbers — videoId to vote
 * counts — and injects into whichever responses come past afterwards. The
 * watch page makes several requests, so the count is normally in place by the
 * time the buttons arrive; when it is not, it appears on the next response
 * rather than being forced into an old one.
 */

const API = 'https://returnyoutubedislikeapi.com/Votes?videoId=';
const DESCRIPTION_PANEL = 'video-description-ep-identifier';
// Numbers only, so this costs nothing to keep. Bounded anyway: a session that
// opens hundreds of videos should not grow a map forever.
const MAX_CACHED = 200;

const votesByVideo = new Map();
const inFlight = new Set();
let _loggedOnce = false;

function enabled() {
    try {
        return configRead('enableReturnYoutubeDislike') === true;
    } catch (e) {
        return false;
    }
}

/**
 * A compact count, with the suffixes translated.
 *
 * Intl's compact notation would do this properly but arrived in Chromium 77,
 * and 5.5 ships 69 — so the thresholds are spelled out and the suffix comes
 * from the translations, which is how German gets Tsd./Mio./Mrd.
 */
export function formatCount(value) {
    const number = Number(value);
    if (!isFinite(number) || number < 0) return '0';
    const units = [
        { at: 1e9, key: 'billion' },
        { at: 1e6, key: 'million' },
        { at: 1e3, key: 'thousand' },
    ];
    for (const unit of units) {
        if (number < unit.at) continue;
        const compact = Math.round((number / unit.at) * 10) / 10;
        return compact + t('general.countSuffix.' + unit.key);
    }
    return String(Math.round(number));
}

/** The video a response is about, wherever it says so. */
export function findVideoId(response) {
    return response?.videoDetails?.videoId
        || response?.playerResponse?.videoDetails?.videoId
        || response?.currentVideoEndpoint?.watchEndpoint?.videoId
        || null;
}

/**
 * Write the count into a response, in place.
 *
 * Two places show it: the description panel's factoid row, and the like
 * button's own dislike fields. Both are left alone if they are not there.
 */
export function injectDislikes(response, votes, label) {
    if (!response || !votes || votes.dislikes === undefined || votes.dislikes === null) return response;
    const text = formatCount(votes.dislikes);
    let wrote = 0;

    try {
        const panel = (response.engagementPanels || []).find(
            (p) => p?.engagementPanelSectionListRenderer?.panelIdentifier === DESCRIPTION_PANEL
        );
        const items = panel?.engagementPanelSectionListRenderer?.content
            ?.structuredDescriptionContentRenderer?.items || [];
        const header = items.find((item) => item?.videoDescriptionHeaderRenderer)?.videoDescriptionHeaderRenderer;
        if (Array.isArray(header?.factoid)) {
            const already = header.factoid.some((f) => f?.factoidRenderer?.label?.simpleText === label);
            if (!already) {
                header.factoid.push({
                    factoidRenderer: { value: { simpleText: text }, label: { simpleText: label } }
                });
                wrote++;
            }
        }
    } catch (e) { }

    try {
        const controls = response.transportControls?.transportControlsRenderer;
        const actions = controls?.buttons || controls?.engagementActions || [];
        const likeAction = (actions || []).find((action) =>
            action?.type === 'TRANSPORT_CONTROLS_BUTTON_TYPE_LIKE_BUTTON' || action?.button?.likeButtonRenderer
        );
        const renderer = likeAction?.button?.likeButtonRenderer;
        if (renderer) {
            renderer.dislikeCountText = { simpleText: text };
            renderer.dislikeCountWithDislikeText = { simpleText: text };
            renderer.dislikeCountWithUndislikeText = { simpleText: text };
            wrote++;
        }
    } catch (e) { }

    if (wrote && !_loggedOnce) {
        _loggedOnce = true;
        appendFileOnlyLog('player.dislikesShown', { dislikes: votes.dislikes, text, places: wrote });
    }
    return response;
}

function remember(videoId, votes) {
    if (votesByVideo.size >= MAX_CACHED) {
        // Oldest first: a Map keeps insertion order, so the first key is it.
        const oldest = votesByVideo.keys().next().value;
        votesByVideo.delete(oldest);
    }
    votesByVideo.set(videoId, votes);
}

function fetchVotes(videoId) {
    if (!videoId || votesByVideo.has(videoId) || inFlight.has(videoId)) return;
    inFlight.add(videoId);
    try {
        fetch(API + encodeURIComponent(videoId))
            .then((res) => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then((data) => {
                remember(videoId, data);
            })
            .catch((err) => {
                appendFileOnlyLog('player.dislikes.error', { videoId, message: err?.message || String(err) });
            })
            .then(() => {
                inFlight.delete(videoId);
            });
    } catch (err) {
        inFlight.delete(videoId);
    }
}

/**
 * Called for every response: asks the service about a video the first time it
 * is seen, and writes in the count once it is known.
 */
export function addDislikes(response) {
    try {
        if (!enabled()) return response;
        const videoId = findVideoId(response);
        if (!videoId) return response;
        fetchVotes(videoId);
        const votes = votesByVideo.get(videoId);
        if (votes) injectDislikes(response, votes, t('general.dislikes'));
    } catch (err) {
        appendFileOnlyLog('player.dislikes.error', { message: err?.message || String(err) });
    }
    return response;
}

export const _internals = { votesByVideo, inFlight };
