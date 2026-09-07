import { configRead } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';

// Diagnostics for the Subscriptions page shelf layout.
//
// Reported on Tizen 6.5: the first row on Subscriptions holds far more videos
// than a normal shelf, so you have to scroll right through it instead of it
// laying out like the shelves below. Before rewriting that container we need
// to know what it actually is on-device — the renderer type, its item and
// visible/collapsed counts, its style block, and how it differs from the
// shelves under it.
//
// Deliberately verbose, so it sits behind its own switch rather than the
// general log categories: it dumps shelf shape, not events, and is only
// useful while this specific problem is being worked on.
//
// Reads only. Nothing here modifies the response.

const MAX_SHELVES = 12;
const MAX_KEYS = 30;

// Every content container a shelf is known to use, so the log says which one
// Subscriptions actually picked instead of assuming horizontalListRenderer.
function describeContainers(shelve) {
  const base = shelve?.richSectionRenderer?.content || shelve;
  const candidates = {
    horizontalListRenderer: base?.shelfRenderer?.content?.horizontalListRenderer,
    verticalListRenderer: base?.shelfRenderer?.content?.verticalListRenderer,
    gridRenderer: base?.shelfRenderer?.content?.gridRenderer,
    expandedShelfContentsRenderer: base?.shelfRenderer?.content?.expandedShelfContentsRenderer,
    richGridRenderer: base?.richShelfRenderer?.content?.richGridRenderer,
    reelShelfRenderer: base?.reelShelfRenderer,
  };
  const out = {};
  for (const name of Object.keys(candidates)) {
    const holder = candidates[name];
    if (!holder) continue;
    const items = Array.isArray(holder.items) ? holder.items : holder.contents;
    out[name] = {
      items: Array.isArray(items) ? items.length : null,
      // These three drive how many tiles a row shows before it starts
      // scrolling sideways — the most likely lever for the reported layout.
      visibleItemCount: holder.visibleItemCount ?? null,
      collapsedItemCount: holder.collapsedItemCount ?? null,
      totalItemCount: holder.totalItemCount ?? null,
      hasContinuations: !!holder.continuations,
      keys: Object.keys(holder).slice(0, MAX_KEYS),
    };
  }
  return out;
}

// Tile style decides row height and width on TV, so a row built from an
// unusual style is a strong hint about why it lays out differently.
function describeTileStyles(shelve) {
  const base = shelve?.richSectionRenderer?.content || shelve;
  const items = base?.shelfRenderer?.content?.horizontalListRenderer?.items
    || base?.shelfRenderer?.content?.gridRenderer?.items
    || [];
  const styles = {};
  for (const item of items) {
    const style = item?.tileRenderer?.style
      || (item?.lockupViewModel ? 'lockupViewModel' : null)
      || Object.keys(item || {})[0]
      || 'unknown';
    styles[style] = (styles[style] || 0) + 1;
  }
  return styles;
}

function shelfTitle(shelve) {
  const base = shelve?.richSectionRenderer?.content || shelve;
  return base?.shelfRenderer?.title?.simpleText
    || base?.shelfRenderer?.title?.runs?.[0]?.text
    || base?.shelfRenderer?.headerRenderer?.shelfHeaderRenderer?.title?.simpleText
    || null;
}

/**
 * Dump the shelf layout of the Subscriptions page.
 *
 * @param {Array} shelves   the section list, after filtering
 * @param {string} pageName the detected page
 */
export function logSubscriptionsShelfShape(shelves, pageName) {
  try {
    if (pageName !== 'subscriptions') return;
    if (!configRead('diagSubscriptionsShelf')) return;
    if (!Array.isArray(shelves) || !shelves.length) return;

    // The reported behaviour is 6.5-specific, so a capture is only useful if
    // it says which platform produced it.
    appendFileOnlyLog('shelf.subscriptions.page', {
      shelves: shelves.length,
      userAgent: String(navigator.userAgent || '').slice(0, 160),
    });

    shelves.slice(0, MAX_SHELVES).forEach((shelve, index) => {
      appendFileOnlyLog('shelf.subscriptions.shelf', {
        index,
        title: shelfTitle(shelve),
        topLevelKeys: Object.keys(shelve || {}),
        // tvhtml5Style.effects is what the enlarge/shrink options already
        // drive; worth seeing whether the wide row carries a different one.
        tvhtml5Style: shelve?.shelfRenderer?.tvhtml5Style || null,
        shelfStyle: shelve?.shelfRenderer?.style || null,
        containers: describeContainers(shelve),
        tileStyles: describeTileStyles(shelve),
      });
    });

    if (shelves.length > MAX_SHELVES) {
      appendFileOnlyLog('shelf.subscriptions.truncated', { total: shelves.length, logged: MAX_SHELVES });
    }
  } catch (err) {
    appendFileOnlyLog('shelf.subscriptions.error', { msg: String(err?.message || err) });
  }
}
