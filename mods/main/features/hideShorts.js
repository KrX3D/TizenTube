import { filterShelvesShorts, removeShortsShelvesByTitle } from './shortsCore.js';

export function hideShorts(shelves, shortsEnabled, onRemoveShelf, page = 'other') {
  filterShelvesShorts(shelves, {
    page,
    shortsEnabled,
    onRemoveShelf
  });
}

export { removeShortsShelvesByTitle };
