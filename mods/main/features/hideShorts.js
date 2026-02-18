import { isShortItem } from './shortsCore.js';

export function hideShorts(shelves, shortsEnabled, onRemoveShelf) {
  if (shortsEnabled || !Array.isArray(shelves)) return;

  for (let i = shelves.length - 1; i >= 0; i--) {
    const shelf = shelves[i];
    if (!shelf) {
      shelves.splice(i, 1);
      continue;
    }

    if (!shelf.shelfRenderer?.content?.horizontalListRenderer?.items) continue;

    if (shelf.shelfRenderer.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS') {
      onRemoveShelf?.(shelf);
      shelves.splice(i, 1);
      continue;
    }

    const items = shelf.shelfRenderer.content.horizontalListRenderer.items || [];
    shelf.shelfRenderer.content.horizontalListRenderer.items = items.filter(
      (item) => !isShortItem(item)
    );

    if (shelf.shelfRenderer.content.horizontalListRenderer.items.length === 0) {
      onRemoveShelf?.(shelf);
      shelves.splice(i, 1);
    }
  }
}

export { removeShortsShelvesByTitle } from './shortsCore.js';
