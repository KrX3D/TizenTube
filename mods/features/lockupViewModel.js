// lockupViewModel support (upstream ca60382).
//
// YouTube is migrating shelf/search items away from `tileRenderer` to a newer
// `lockupViewModel` shape. As of now the fork only sees it on the search page,
// but every per-item helper in the codebase (DeArrow, HQ thumbnails, long
// press, hide-watched, the video queue) checks `item.tileRenderer` and bails
// out otherwise — so those items silently get none of the mods applied.
//
// Rather than sprinkling `item.tileRenderer ? … : item.lockupViewModel …`
// ternaries through every call site (which is what upstream did, and which is
// where its three bugs came from — see below), this module is the single place
// that knows the lockup shape. Call sites ask for a value; if the item is a
// tileRenderer they keep their existing path, if it's a lockup they go through
// here.
//
// Upstream bugs deliberately NOT reproduced:
//   1. deArrowify: `if (!item.tileRenderer && item.lockupViewModel) continue;`
//      skips exactly the lockup-only items it is meant to add support for.
//   2. deArrowify: `if (!item?.lockupViewModel?.contentType !== 'LOCKUP_…')`
//      — the `!` binds to the property access, so the comparison is
//      `boolean !== string`, which is always true. That `continue` fires for
//      EVERY item, disabling DeArrow completely.
//   3. hideVideo: the lockup progress-bar branch sits after an
//      `if (!item.tileRenderer) return true;` early return, so it is dead code.

export const LOCKUP_VIDEO = 'LOCKUP_CONTENT_TYPE_VIDEO';
export const LOCKUP_SHORT = 'LOCKUP_CONTENT_TYPE_SHORT';

/** The lockupViewModel of an item, or null when the item is not one. */
export function getLockup(item) {
  const lockup = item?.lockupViewModel;
  return (lockup && typeof lockup === 'object') ? lockup : null;
}

/** True for lockup items that represent a normal (non-Shorts) video. */
export function isLockupVideo(item) {
  const lockup = getLockup(item);
  return !!lockup && lockup.contentType === LOCKUP_VIDEO;
}

/** True for lockup items that represent a Short. */
export function isLockupShort(item) {
  const lockup = getLockup(item);
  return !!lockup && lockup.contentType === LOCKUP_SHORT;
}

export function lockupVideoId(item) {
  return getLockup(item)?.contentId || null;
}

/** The watchEndpoint a lockup navigates to when selected. */
export function lockupWatchEndpoint(item) {
  return getLockup(item)?.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint || null;
}

/** The full onTap command — the lockup equivalent of tileRenderer.onSelectCommand. */
export function lockupSelectCommand(item) {
  return getLockup(item)?.rendererContext?.commandContext?.onTap?.innertubeCommand || null;
}

export function lockupTitle(item) {
  return getLockup(item)?.metadata?.lockupMetadataViewModel?.title?.content || null;
}

export function setLockupTitle(item, text) {
  const title = getLockup(item)?.metadata?.lockupMetadataViewModel?.title;
  if (!title) return false;
  title.content = text;
  return true;
}

/**
 * The lockup's image source list — the shape that stands in for
 * tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails. Returned by
 * reference so callers can mutate it in place the way they do for tiles.
 */
export function lockupThumbnails(item) {
  const sources = getLockup(item)?.contentImage?.thumbnailViewModel?.image?.sources;
  return Array.isArray(sources) ? sources : null;
}

export function setLockupThumbnails(item, thumbnails) {
  const image = getLockup(item)?.contentImage?.thumbnailViewModel?.image;
  if (!image) return false;
  image.sources = thumbnails;
  return true;
}

/** First metadata row of a lockup — used as the tile "subtitle" (channel name). */
export function lockupSubtitle(item) {
  const rows = getLockup(item)?.metadata?.lockupMetadataViewModel?.metadata
    ?.contentMetadataViewModel?.metadataRows;
  return rows?.[0]?.metadataParts?.[0]?.text?.content || null;
}

/** Existing long-press menu items, when YouTube already supplied a menu. */
export function lockupLongPressMenuItems(item) {
  return getLockup(item)?.rendererContext?.commandContext?.onLongPress
    ?.innertubeCommand?.showMenuCommand?.menu?.menuRenderer?.items || null;
}

/** Install a TizenTube-built long-press menu on a lockup item. */
export function setLockupLongPress(item, data) {
  const commandContext = getLockup(item)?.rendererContext?.commandContext;
  if (!commandContext) return false;
  commandContext.onLongPress = { innertubeCommand: data };
  return true;
}

/**
 * Watch progress as a percentage, or null when the lockup carries none.
 *
 * Lockups express progress two different ways depending on the surface: a
 * bottom-overlay progress bar (`startPercent`) or a flat `progressPercentage`
 * on the lockup itself. Both are checked.
 */
export function lockupWatchPercent(item) {
  const lockup = getLockup(item);
  if (!lockup) return null;
  const overlays = lockup.contentImage?.thumbnailViewModel?.overlays;
  if (Array.isArray(overlays)) {
    for (const overlay of overlays) {
      const bar = overlay?.thumbnailBottomOverlayViewModel?.progressBar
        ?.thumbnailOverlayProgressBarViewModel;
      if (!bar) continue;
      const pct = bar.startPercent ?? bar.percentDurationWatched;
      if (pct !== null && pct !== undefined) return Number(pct);
    }
  }
  const flat = lockup.progressPercentage;
  return (flat !== null && flat !== undefined) ? Number(flat) : null;
}
