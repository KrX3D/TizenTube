import { TileRenderer, ShelfRenderer } from '../ui/ytUI.js';

export function applyQueueShelf(parsedResponse) {
  if (!parsedResponse?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer) return;
  if (!window?.queuedVideos?.videos || window.queuedVideos.videos.length === 0) return;

  const queuedVideosClone = window.queuedVideos.videos.slice();
  queuedVideosClone.unshift(
    TileRenderer('Clear Queue', {
      customAction: {
        action: 'CLEAR_QUEUE'
      }
    })
  );

  const focusIndex = queuedVideosClone.findIndex((video) => video.contentId === window.queuedVideos.lastVideoId);

  parsedResponse.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents.unshift(
    ShelfRenderer('Queued Videos', queuedVideosClone, focusIndex !== -1 ? focusIndex : 0)
  );
}
