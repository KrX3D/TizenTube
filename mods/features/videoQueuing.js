window.queuedVideos = {
    videos: [],
    lastVideoId: null
};

import resolveCommand from '../resolveCommand.js';
import { lockupVideoId, lockupSelectCommand } from './lockupViewModel.js';

// Queued items can be either shape: tileRenderer (most surfaces) or
// lockupViewModel (search results, upstream ca60382).
const queuedVideoId = (v) => v?.tileRenderer?.contentId || lockupVideoId(v);
const queuedSelectCommand = (v) => v?.tileRenderer ? v.tileRenderer.onSelectCommand : lockupSelectCommand(v);

function addListener() {
    const videoPlayer = document.querySelector('.html5-video-player');
    if (!videoPlayer) return setTimeout(addListener, 250);

    videoPlayer.addEventListener('onStateChange', () => {
        try {
            const playerStateObject = videoPlayer.getPlayerStateObject();
            const videoData = videoPlayer.getVideoData();
            if (window.queuedVideos.videos.length === 0) return;

            if (playerStateObject.isEnded) {
                try {
                    const index = window.queuedVideos.videos.findIndex(v => queuedVideoId(v) === videoData.video_id);
                    if (index !== -1) {
                        if (index + 1 >= window.queuedVideos.videos.length) {
                            resolveCommand({ customAction: { action: 'CLEAR_QUEUE' } });
                            return;
                        }
                        const videoWatchEndpoint = queuedSelectCommand(window.queuedVideos.videos[index + 1]);
                        setTimeout(() => {
                            try { resolveCommand(videoWatchEndpoint); } catch (e) { console.warn('[videoQueuing] resolveCommand failed (index):', e); }
                        }, 500);
                    } else if (window.queuedVideos.lastVideoId) {
                        const lastIndex = window.queuedVideos.videos.findIndex(v => queuedVideoId(v) === window.queuedVideos.lastVideoId);
                        if (lastIndex !== -1 && lastIndex + 1 < window.queuedVideos.videos.length) {
                            const videoWatchEndpoint = queuedSelectCommand(window.queuedVideos.videos[lastIndex + 1]);
                            setTimeout(() => {
                                try { resolveCommand(videoWatchEndpoint); } catch (e) { console.warn('[videoQueuing] resolveCommand failed (lastIndex):', e); }
                            }, 500);
                        } else {
                            resolveCommand({ customAction: { action: 'CLEAR_QUEUE' } });
                            return;
                        }
                    } else {
                        const videoWatchEndpoint = queuedSelectCommand(window.queuedVideos.videos[0]);
                        setTimeout(() => {
                            try { resolveCommand(videoWatchEndpoint); } catch (e) { console.warn('[videoQueuing] resolveCommand failed (first):', e); }
                        }, 500);
                    }
                } catch (endedErr) {
                    console.warn('[videoQueuing] Error handling isEnded state:', endedErr);
                }
            } else if (playerStateObject.isPlaying) {
                try {
                    const container = document.getElementById('container');
                    if (container) container.style.setProperty('opacity', '1', 'important');
                    if (window.queuedVideos.videos.find(v => queuedVideoId(v) === videoData.video_id)) {
                        window.queuedVideos.lastVideoId = videoData.video_id;
                    }
                } catch (playingErr) {
                    console.warn('[videoQueuing] Error handling isPlaying state:', playingErr);
                }
            }
        } catch (err) {
            console.warn('[videoQueuing] onStateChange error:', err);
        }
    });
}

addListener();