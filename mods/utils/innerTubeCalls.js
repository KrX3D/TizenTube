import resolveCommand from '../resolveCommand.js';

// Direct InnerTube calls made through the app's own client, so they carry the
// real identity/auth context instead of an unauthenticated fetch.

/**
 * "Go to Channel" (upstream da8a1ef).
 *
 * A shelf item carries no channel browseId — only the video it points at. So
 * the channel has to be resolved indirectly: request /next for that video and
 * follow the owner's navigation endpoint out of the response.
 *
 * @param {object} params The long-press item (tileRenderer or lockupViewModel).
 */
function requestNextAndNavigateChannel(params) {
    try {
        const mappings = Object.values(window._yttv || {}).find(a => a && a.mappings);
        if (!mappings) return;
        const CurrentIdentityService = mappings.get('CurrentIdentityService');
        const KabukiInnerTubeClient = mappings.get('KabukiInnerTubeClient');
        if (!CurrentIdentityService || !KabukiInnerTubeClient) return;

        // Both item shapes are supported; search results are lockupViewModel.
        const lockupTap = params?.lockupViewModel?.rendererContext?.commandContext?.onTap?.innertubeCommand;
        const videoId = params?.tileRenderer?.contentId || params?.lockupViewModel?.contentId;
        const watchParams = params?.tileRenderer?.onSelectCommand?.watchEndpoint?.params
            || lockupTap?.watchEndpoint?.params;
        if (!videoId) return;

        // Upstream sends a random lactMilliseconds so the request looks like a
        // normal user-initiated /next rather than an obviously synthetic one.
        const randomDelay = Math.floor(Math.random() * 2000);

        CurrentIdentityService.get().then(identity => {
            const request = {
                identity,
                isPrefetch: false,
                path: '/youtubei/v1/next',
                payload: {
                    videoId,
                    params: watchParams,
                    racyCheckOk: true,
                    contentCheckOk: true,
                    playbackContext: {
                        lactMilliseconds: randomDelay,
                        isLyricsMode: false
                    },
                    autonavState: 'STATE_NONE',
                    mdxContext: {
                        mdxReceiverContext: {
                            mdxConnectedDevices: []
                        }
                    }
                },
                clickTracking: {
                    clickTrackingParams: null,
                }
            };

            KabukiInnerTubeClient.fetch(request).subscribe((response) => {
                try {
                    const contents = response?.contents?.singleColumnWatchNextResults?.results?.results?.contents;
                    if (!contents) return;
                    const itemSectionRenderer = contents.find(item => item.itemSectionRenderer);
                    const videoMetadataRenderer = itemSectionRenderer?.itemSectionRenderer?.contents
                        ?.find(item => item.videoMetadataRenderer);
                    const navigation = videoMetadataRenderer?.videoMetadataRenderer?.owner
                        ?.videoOwnerRenderer?.navigationEndpoint;
                    if (navigation) resolveCommand(navigation);
                } catch (err) {
                    console.warn('[innerTubeCalls] go-to-channel response handling failed:', err);
                }
            });
        }).catch(err => console.warn('[innerTubeCalls] identity lookup failed:', err));
    } catch (err) {
        console.warn('[innerTubeCalls] requestNextAndNavigateChannel failed:', err);
    }
}

/**
 * Fetch the sidebar (guide) through the app's own InnerTube client, so it
 * comes back with the user's real entries rather than a signed-out default.
 *
 * Resolves with the raw guide response, or rejects if the client isn't
 * available yet.
 */
function getGuide() {
    return new Promise((resolve, reject) => {
        try {
            const mappings = Object.values(window._yttv || {}).find(a => a && a.mappings);
            const KabukiInnerTubeClient = mappings?.get('KabukiInnerTubeClient');
            if (!KabukiInnerTubeClient) return reject(new Error('KabukiInnerTubeClient unavailable'));
            KabukiInnerTubeClient.fetch({ path: '/youtubei/v1/guide' })
                .subscribe(resolve, reject);
        } catch (err) {
            reject(err);
        }
    });
}

// Find a feedbackToken anywhere inside an innertube command.
//
// The "Not interested" and "Don't recommend channel" panel items carry it
// either directly (onTap.innertubeCommand.feedbackEndpoint) or wrapped in an
// openPopupAction, so the shape cannot be relied on.
function findFeedbackToken(obj, depth = 0) {
    // Bounded: these objects can embed a whole copy of the video item, and an
    // unbounded walk on a TV is not free.
    if (!obj || typeof obj !== 'object' || depth > 12) return null;
    if (typeof obj.feedbackToken === 'string') return obj.feedbackToken;
    for (const value of Object.values(obj)) {
        const token = findFeedbackToken(value, depth + 1);
        if (token) return token;
    }
    return null;
}

// The feedback tokens are no longer in the long press menu. YouTube now sends
// an engagement panel reference (panelId + params) that has to be fetched
// first; the panel's items carry the tokens, in order:
//   [0] "Not interested"   [1] "Don't recommend channel"
function getFeedbackPanelTokens(panelId, params) {
    return new Promise((resolve, reject) => {
        try {
            const mappings = Object.values(window._yttv || {}).find(a => a && a.mappings);
            const KabukiInnerTubeClient = mappings?.get('KabukiInnerTubeClient');
            if (!KabukiInnerTubeClient) return reject(new Error('KabukiInnerTubeClient unavailable'));
            KabukiInnerTubeClient.fetch({ path: '/youtubei/v1/get_panel', payload: { panelId, params } })
                .subscribe((response) => {
                    const listItems = response?.content?.engagementPanelSectionListRenderer?.content?.listViewModel?.listItems;
                    if (!Array.isArray(listItems)) return resolve([]);
                    resolve(listItems.map((item) => findFeedbackToken(item?.listItemViewModel)).filter(Boolean));
                }, reject);
        } catch (err) {
            reject(err);
        }
    });
}

// Send one feedback token. The response may carry a follow-up dialog asking
// why, whose reasons are shown by markFeedback() in resolveCommand.js.
function sendFeedbackToken(feedbackToken) {
    return new Promise((resolve, reject) => {
        try {
            const mappings = Object.values(window._yttv || {}).find(a => a && a.mappings);
            const KabukiInnerTubeClient = mappings?.get('KabukiInnerTubeClient');
            if (!KabukiInnerTubeClient) return reject(new Error('KabukiInnerTubeClient unavailable'));
            KabukiInnerTubeClient.fetch({ path: '/youtubei/v1/feedback', payload: { feedbackTokens: [feedbackToken] } })
                .subscribe(resolve, reject);
        } catch (err) {
            reject(err);
        }
    });
}

// Your own playlists, for the long press menu.
//
// The menu is built while a response is being processed and cannot wait for a
// fetch, so the list is kept warm here instead: whoever asks gets what is
// cached and triggers a refresh if it is stale. A menu built before the first
// fetch returns simply has no playlist entries, and the next one has them.
const PLAYLIST_CACHE_MS = 10 * 60 * 1000;
let _playlists = [];
let _playlistsFetchedAt = 0;
let _playlistsInFlight = false;

/** The cached playlists, refreshing in the background when stale. */
function getUserPlaylists() {
    if (Date.now() - _playlistsFetchedAt > PLAYLIST_CACHE_MS) refreshUserPlaylists();
    return _playlists;
}

function refreshUserPlaylists() {
    if (_playlistsInFlight) return Promise.resolve(_playlists);
    _playlistsInFlight = true;
    return new Promise((resolve) => {
        try {
            const mappings = Object.values(window._yttv || {}).find(a => a && a.mappings);
            const KabukiInnerTubeClient = mappings?.get('KabukiInnerTubeClient');
            if (!KabukiInnerTubeClient) {
                _playlistsInFlight = false;
                return resolve(_playlists);
            }
            KabukiInnerTubeClient.fetch({ path: '/youtubei/v1/browse', payload: { browseId: 'FEplaylist_aggregation' } })
                .subscribe((response) => {
                    _playlistsInFlight = false;
                    _playlistsFetchedAt = Date.now();
                    const found = extractPlaylists(response);
                    // An empty result is not cached as success: a response that
                    // arrived before sign-in would otherwise stick for ten
                    // minutes with no playlists in it.
                    if (found.length) _playlists = found;
                    else _playlistsFetchedAt = 0;
                    resolve(_playlists);
                }, () => {
                    _playlistsInFlight = false;
                    resolve(_playlists);
                });
        } catch (err) {
            _playlistsInFlight = false;
            resolve(_playlists);
        }
    });
}

// A playlist tile navigates to the playlist's own page, whose browseId is the
// playlist id with a VL in front. Collected by walking the response rather than
// by naming a path, since the library page has been reshaped more than once.
//
// The id and the title live on different parts of the same tile — the id under
// its select command, the title under its metadata — so both are read from the
// tile rather than from whichever node happens to carry the id.
const OWN_PLAYLIST = /^(PL|FL)/;

function nodePlaylistId(node) {
    const browseIds = [
        node.browseEndpoint?.browseId,
        node.onSelectCommand?.browseEndpoint?.browseId,
        node.navigationEndpoint?.browseEndpoint?.browseId,
        node.endpoint?.browseEndpoint?.browseId,
    ];
    for (const browseId of browseIds) {
        if (typeof browseId === 'string' && browseId.indexOf('VL') === 0 && OWN_PLAYLIST.test(browseId.slice(2))) {
            return browseId.slice(2);
        }
    }
    // Watch Later has its own entry already, Liked Videos is not a normal
    // target, and a mix (RD) or a channel uploads list (UU) is not yours.
    if (typeof node.playlistId === 'string' && OWN_PLAYLIST.test(node.playlistId)) return node.playlistId;
    return null;
}

function extractPlaylists(node, out = [], seen = new Set(), depth = 0) {
    if (!node || typeof node !== 'object' || depth > 12 || out.length >= 100) return out;
    if (Array.isArray(node)) {
        for (const child of node) extractPlaylists(child, out, seen, depth + 1);
        return out;
    }
    const playlistId = nodePlaylistId(node);
    if (playlistId && !seen.has(playlistId)) {
        const title = playlistTitle(node);
        if (title) {
            seen.add(playlistId);
            out.push({ playlistId, title });
        }
    }
    for (const key of Object.keys(node)) {
        // Never follow an action's parameters: a long press entry keeps a copy
        // of a whole video item there, playlist ids included.
        if (key === 'parameters') continue;
        extractPlaylists(node[key], out, seen, depth + 1);
    }
    return out;
}
function playlistTitle(node) {
    const candidates = [
        node.title,
        node.metadata?.tileMetadataRenderer?.title,
        node.header?.tileHeaderRenderer?.title,
    ];
    for (const candidate of candidates) {
        if (!candidate) continue;
        if (typeof candidate === 'string') return candidate;
        if (candidate.simpleText) return String(candidate.simpleText);
        if (Array.isArray(candidate.runs)) return candidate.runs.map(r => r?.text || '').join('');
    }
    return '';
}

export {
    requestNextAndNavigateChannel,
    getGuide,
    findFeedbackToken,
    getFeedbackPanelTokens,
    sendFeedbackToken,
    getUserPlaylists,
    refreshUserPlaylists
}
