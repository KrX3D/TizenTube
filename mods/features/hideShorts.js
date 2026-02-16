function getShelfTitle(shelve) {
  return (
    shelve?.shelfRenderer?.title?.runs?.[0]?.text ||
    shelve?.shelfRenderer?.title?.simpleText ||
    shelve?.richShelfRenderer?.title?.runs?.[0]?.text ||
    shelve?.richShelfRenderer?.title?.simpleText ||
    shelve?.richSectionRenderer?.content?.richShelfRenderer?.title?.runs?.[0]?.text ||
    shelve?.richSectionRenderer?.content?.richShelfRenderer?.title?.simpleText ||
    ''
  );
}

export function hideShorts(shelves, shortsEnabled, onRemoveShelf) {
  if (shortsEnabled) return;

  for (const shelve of shelves) {
    if (!shelve) continue;

    const title = getShelfTitle(shelve).toLowerCase();
    if (title.includes('short')) {
      onRemoveShelf?.(shelve);
      shelves.splice(shelves.indexOf(shelve), 1);
      continue;
    }

    if (!shelve.shelfRenderer?.content?.horizontalListRenderer?.items) continue;

    if (shelve.shelfRenderer.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS') {
      onRemoveShelf?.(shelve);
      shelves.splice(shelves.indexOf(shelve), 1);
      continue;
    }

    shelve.shelfRenderer.content.horizontalListRenderer.items =
      shelve.shelfRenderer.content.horizontalListRenderer.items.filter(
        (item) => item.tileRenderer?.tvhtml5ShelfRendererType !== 'TVHTML5_TILE_RENDERER_TYPE_SHORTS'
      );
  }
}
