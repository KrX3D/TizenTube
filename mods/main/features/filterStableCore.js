export function getItemDisplayTitle(item) {
  return item?.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText
    || item?.videoRenderer?.title?.runs?.[0]?.text
    || item?.playlistVideoRenderer?.title?.runs?.[0]?.text
    || item?.gridVideoRenderer?.title?.runs?.[0]?.text
    || item?.compactVideoRenderer?.title?.simpleText
    || item?.richItemRenderer?.content?.videoRenderer?.title?.runs?.[0]?.text
    || item?.tileRenderer?.contentId
    || item?.videoRenderer?.videoId
    || item?.playlistVideoRenderer?.videoId
    || item?.gridVideoRenderer?.videoId
    || item?.compactVideoRenderer?.videoId
    || 'unknown';
}

export function getPathLabel(path, fallback = 'unknown.path') {
  return path || fallback;
}
