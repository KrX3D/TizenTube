import { appendFileOnlyLog } from './hideWatched.js';

/**
 * videoBadges.js — read the badges on a video item, whatever renderer it is in.
 *
 * Members-only videos were already filtered, but only by looking at three fixed
 * places on a tileRenderer. Reported: members-only ("Nur für Kanalmitglieder")
 * and paid ("Kostenpflichtig") videos still show up on Home and in the list
 * below the player. Two reasons for that:
 *
 *   - the badge is not always where the old code looked. Lockup items, rich
 *     items and the compact renderers used beside the player all nest their
 *     badges differently, and the newer view-model shapes use thumbnailBadge
 *     view models instead of metadataBadgeRenderer.
 *   - paid videos were never looked for at all.
 *
 * So rather than naming paths, this walks the item and collects anything under
 * a key that mentions a badge. That is the same approach adblock.js already
 * uses for Shorts (collectAllText), and it survives YouTube moving things
 * around, which it does regularly.
 *
 * The walk stays inside badge containers on purpose. Matching badge text is
 * necessary because the only language-independent signal, the badge STYLE,
 * exists for members-only but not for the paid and free ones — and a free text
 * search over the whole item would match a title that happens to say
 * "kostenlos".
 */

// Bounds for the walk: an item can embed a copy of a whole menu, and this runs
// per item on a TV.
//
// Two budgets, not one. Finding the badge container is a walk through the item,
// and reading the text is a walk inside that container — a lockup nests its
// badge text six levels below the item, which a single shared budget cut off
// before reaching it.
const MAX_DEPTH = 10;
const MAX_TAKE_DEPTH = 6;
const MAX_BADGES = 12;

const BADGE_KEY = /badge/i;

// Style strings are not translated, so they are the strongest signal. YouTube
// launched memberships as "sponsorships" and the old spelling still appears.
const STYLE_HINTS = {
  members: ['MEMBERS_ONLY', 'SPONSORS_ONLY'],
  paid: ['PAID_CONTENT', 'BADGE_STYLE_TYPE_PAID'],
};

// Lowercased substrings, matched against badge text only. Kept short so they
// match regardless of the surrounding wording.
const LABEL_HINTS = {
  members: [
    'kanalmitglieder',        // de
    'mitglieder',             // de, shorter variant
    'members only', 'members-only', // en
    'solo para miembros',     // es
    'membres uniquement',     // fr
    'solo per gli iscritti',  // it
    'alleen voor leden',      // nl
  ],
  paid: [
    'kostenpflichtig',        // de
    'bezahlinhalt',           // de
    'paid',                   // en, covers "Paid" and "Paid content"
    'purchased',              // en
    'de pago',                // es
    'payant',                 // fr
    'a pagamento',            // it
    'betaald',                // nl
  ],
  free: [
    'kostenlos',              // de, "Kostenlos mit Werbung"
    'gratis',                 // de/es/nl
    'free with ads', 'free to watch', 'watch free', // en
    'gratuit',                // fr
    'gratuito',               // it/es/pt
  ],
};

/** Every (style, label) pair found under a badge-ish key. */
export function badgeSignals(item) {
  const out = [];
  const seen = new Set();

  const take = (node, depth) => {
    if (!node || typeof node !== 'object' || out.length >= MAX_BADGES || depth > MAX_TAKE_DEPTH) return;
    if (Array.isArray(node)) {
      for (const child of node) take(child, depth + 1);
      return;
    }
    // Unwrap one renderer/view-model level at a time; the text can sit on this
    // node or on the one inside it.
    const style = typeof node.style === 'string' ? node.style : '';
    const label = typeof node.label === 'string' ? node.label
      : node.text?.simpleText
      || (typeof node.text === 'string' ? node.text : '')
      || node.text?.content
      || (Array.isArray(node.text?.runs) ? node.text.runs.map(r => r?.text || '').join('') : '')
      || '';
    if (style || label) {
      const key = style + '\u0000' + label;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ style: String(style), label: String(label) });
      }
    }
    for (const value of Object.values(node)) take(value, depth + 1);
  };

  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH || out.length >= MAX_BADGES) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    for (const key of Object.keys(node)) {
      // Never follow an action's parameters: this fork's own long-press entries
      // embed a copy of the whole video item there, badges included, which
      // would make every item look like every other one.
      if (key === 'parameters') continue;
      if (BADGE_KEY.test(key)) take(node[key], 0);
      else walk(node[key], depth + 1);
    }
  };

  walk(item, 0);
  return out;
}

/**
 * Which category this item's badges put it in, with the signal that decided it,
 * or null for an ordinary video.
 */
export function classifyBadges(item) {
  for (const { style, label } of badgeSignals(item)) {
    const s = style.toUpperCase();
    for (const category of ['members', 'paid']) {
      if ((STYLE_HINTS[category] || []).some(h => s.includes(h))) {
        return { category, reason: 'style:' + style };
      }
    }
    const l = label.toLowerCase();
    if (!l) continue;
    for (const category of ['members', 'paid', 'free']) {
      if (LABEL_HINTS[category].some(h => l.includes(h))) {
        return { category, reason: 'label:' + label };
      }
    }
  }
  return null;
}

// One line per distinct badge seen, so a capture shows the real text YouTube
// uses — the paid and free ones have no style to match on, and the wording is
// what a filter has to recognise.
const _loggedBadges = new Set();
const MAX_LOGGED_BADGES = 40;

export function noteBadges(item, pageName) {
  try {
    for (const { style, label } of badgeSignals(item)) {
      if (!style && !label) continue;
      const key = style + '|' + label;
      if (_loggedBadges.has(key) || _loggedBadges.size >= MAX_LOGGED_BADGES) continue;
      _loggedBadges.add(key);
      appendFileOnlyLog('badge.seen', { style, label, pageName, matched: classifyBadges(item)?.category || null });
    }
  } catch (_) { }
}
