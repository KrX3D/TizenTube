import { configRead } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';
import { classifyBadges, noteBadges } from './videoBadges.js';

/**
 * badgedVideoHider.js — drop videos you cannot simply watch.
 *
 * Three kinds, each with its own setting, because they are not the same thing:
 *
 *   members  "Nur für Kanalmitglieder" — needs a paid channel membership
 *   paid     "Kostenpflichtig" — has to be rented or bought
 *   free     "Kostenlos mit Werbung" — free films, watchable, but they are
 *            films rather than videos and clutter the rows they appear in
 *
 * Was membersOnlyHider.js, which looked at three fixed places on a tile. The
 * badges are now read by videoBadges.js, which finds them wherever they sit —
 * reported: members-only and paid videos still appearing on Home and under the
 * player, where the items are not plain tiles.
 */

const SETTING_FOR = {
  members: 'hideMembersOnlyVideos',
  paid: 'hidePaidVideos',
  free: 'hideFreeWithAdsVideos',
};

// One log line per video, not per pass.
const _logged = new Set();
const MAX_LOGGED = 200;

export function filterBadgedVideos(items, pageName = null) {
  if (!Array.isArray(items) || !items.length) return items;

  const wanted = Object.keys(SETTING_FOR).filter(category => {
    try { return !!configRead(SETTING_FOR[category]); } catch (_) { return false; }
  });
  // Badge logging is worth having even with every setting off: it is what shows
  // which wording YouTube uses, and the paid and free badges carry no style to
  // match on. Gated on the same diagnostic switch as the rest of the logging.
  let diagnose = false;
  try { diagnose = !!configRead('enableDebugLogging'); } catch (_) { }
  if (!wanted.length && !diagnose) return items;

  return items.filter(item => {
    if (diagnose) noteBadges(item, pageName);
    const hit = classifyBadges(item);
    if (!hit || wanted.indexOf(hit.category) === -1) return true;
    try {
      const id = item?.tileRenderer?.contentId
        || item?.tileRenderer?.onSelectCommand?.watchEndpoint?.videoId
        || '?';
      const key = hit.category + ':' + id;
      if (!_logged.has(key) && _logged.size < MAX_LOGGED) {
        _logged.add(key);
        appendFileOnlyLog('badgedVideo.removed', { videoId: id, category: hit.category, reason: hit.reason, pageName });
      }
    } catch (_) { }
    return false;
  });
}
