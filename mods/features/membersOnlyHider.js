import { configRead } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';

// Hides channel-membership-gated videos ("Nur für Kanalmitglieder" / "Members
// only"), which cannot be played without a paid membership.
//
// Detection is deliberately layered, strongest signal first, because the only
// reliable identifier YouTube exposes here is a badge and its label is
// localized:
//
//  1. Badge STYLE. YouTube tags these with a BADGE_STYLE_TYPE_MEMBERS_ONLY
//     style (and has used a SPONSORS_ONLY spelling historically, memberships
//     having been launched as "sponsorships"). Style strings are not
//     translated, so this works in every UI language.
//  2. Badge LABEL text, as a fallback for shapes that carry a label but no
//     recognisable style. Matched against a small multi-language list rather
//     than one hardcoded phrase — the reporting user sees German, but the
//     same build ships to every locale.
//
// Anything matched is logged once per video id so the next on-device log
// shows exactly which signal fired, and whether a shape is slipping through.

const MEMBERS_STYLE_HINTS = ['MEMBERS_ONLY', 'SPONSORS_ONLY'];

// Lowercased substrings. Kept short so they match regardless of surrounding
// wording ("Nur für Mitglieder" vs "Nur für Kanalmitglieder").
const MEMBERS_LABEL_HINTS = [
  'kanalmitglieder',   // de
  'mitglieder',        // de (shorter variant)
  'members only',      // en
  'members-only',      // en
  'solo para miembros',// es
  'membres uniquement',// fr
  'solo per gli iscritti', // it
  'alleen voor leden', // nl
];

function badgeStrings(item) {
  const tile = item?.tileRenderer;
  const badges = []
    .concat(tile?.badges || [])
    .concat(tile?.header?.tileHeaderRenderer?.badges || [])
    .concat(item?.badges || []);
  const out = [];
  for (const b of badges) {
    const r = b?.metadataBadgeRenderer || b?.liveBadgeRenderer || b;
    if (!r || typeof r !== 'object') continue;
    const label = r.label
      || r.text?.simpleText
      || (Array.isArray(r.text?.runs) ? r.text.runs.map(x => x?.text || '').join('') : '')
      || '';
    out.push({ style: String(r.style || ''), label: String(label) });
  }
  return out;
}

export function isMembersOnlyItem(item) {
  for (const { style, label } of badgeStrings(item)) {
    const s = style.toUpperCase();
    if (MEMBERS_STYLE_HINTS.some(h => s.includes(h))) return 'style:' + style;
    const l = label.toLowerCase();
    if (l && MEMBERS_LABEL_HINTS.some(h => l.includes(h))) return 'label:' + label;
  }
  return null;
}

const _logged = new Set();

export function filterMembersOnlyFromItems(items, pageName = null) {
  if (!Array.isArray(items) || !items.length) return items;
  if (!configRead('hideMembersOnlyVideos')) return items;
  return items.filter(item => {
    const reason = isMembersOnlyItem(item);
    if (!reason) return true;
    try {
      const id = item?.tileRenderer?.contentId
        || item?.tileRenderer?.onSelectCommand?.watchEndpoint?.videoId
        || '?';
      if (!_logged.has(id)) {
        _logged.add(id);
        appendFileOnlyLog('membersOnly.removed', { videoId: id, reason, pageName });
      }
    } catch (_) { }
    return false;
  });
}
