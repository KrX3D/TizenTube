/**
 * Put the pooled Subscriptions videos back into upload order.
 *
 * The page opens with the "Relevanteste" / "Most relevant" row, which is sorted
 * by relevance, not by date. consolidateShelves pools every row in page order,
 * so that row's videos land first and the rebuilt rows read 2 h, 22 h, 3 days,
 * then 2 days, 1 day, 2 days (5.0 TV, 24 November).
 *
 * The tiles carry no timestamp, only the line YouTube shows under the title
 * ("vor 22 Stunden", "3 days ago"). That is parsed for German and English;
 * a tile whose age can't be read takes the age of the tile before it, so it
 * stays next to its neighbours instead of jumping to one end. The sort is
 * stable, so videos with the same shown age keep YouTube's order.
 */

const SECOND = 1;
const UNIT_SECONDS = {
  sekunde: SECOND, second: SECOND,
  minute: 60,
  stunde: 3600, hour: 3600,
  tag: 86400, day: 86400,
  woche: 604800, week: 604800,
  monat: 2592000, month: 2592000,
  jahr: 31536000, year: 31536000,
};
const UNITS = 'sekunde|second|minute|stunde|hour|tag|day|woche|week|monat|month|jahr|year';
const AGE_DE = new RegExp(`\\bvor\\s+(\\d+)\\s+(${UNITS})`, 'i');
const AGE_EN = new RegExp(`(\\d+)\\s+(${UNITS})s?\\s+ago\\b`, 'i');

function lineText(text) {
  if (!text) return '';
  if (text.simpleText) return String(text.simpleText);
  if (Array.isArray(text.runs)) return text.runs.map(r => (r && r.text) || '').join('');
  return '';
}

/** Seconds since upload as shown on the tile, or null if the tile shows none we can read. */
export function tileAgeSeconds(item) {
  const lines = item?.tileRenderer?.metadata?.tileMetadataRenderer?.lines;
  if (!Array.isArray(lines)) return null;
  for (const line of lines) {
    for (const li of (line?.lineRenderer?.items || [])) {
      const text = lineText(li?.lineItemRenderer?.text);
      const m = AGE_DE.exec(text) || AGE_EN.exec(text);
      if (m) return Number(m[1]) * UNIT_SECONDS[m[2].toLowerCase()];
    }
  }
  return null;
}

/** Newest first. Returns a new array and how many tiles had a readable age. */
export function sortByAge(items) {
  let previous = 0;
  let known = 0;
  const keyed = items.map((item, index) => {
    const age = tileAgeSeconds(item);
    if (age !== null) { previous = age; known++; }
    return { item, index, age: age !== null ? age : previous };
  });
  keyed.sort((a, b) => (a.age - b.age) || (a.index - b.index));
  return { items: keyed.map(k => k.item), known };
}
