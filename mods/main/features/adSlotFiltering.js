export function applyBrowseAdFiltering(parsedResponse, adBlockEnabled) {
  if (!parsedResponse?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents) {
    return;
  }

  if (!adBlockEnabled) return;

  const shelves = parsedResponse.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents;

  parsedResponse.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents =
    shelves.filter((element) => !element.adSlotRenderer);

  for (const shelve of parsedResponse.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents) {
    if (!shelve.shelfRenderer) continue;

    shelve.shelfRenderer.content.horizontalListRenderer.items =
      shelve.shelfRenderer.content.horizontalListRenderer.items.filter((item) => !item.adSlotRenderer);
  }
}
