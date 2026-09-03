import { configRead } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';

// Hides YouTube's in-feed feedback surveys — the "Hilf uns, YouTube noch
// besser zu machen" / "Help us improve YouTube" card that appears partway
// down Home with a video to rate.
//
// Matched on the entry's own top-level KEY, by substring rather than an exact
// renderer name. YouTube has shipped these under several names over time
// (surveyRenderer, feedbackSurveyRenderer, questionnaireRenderer, and TV-
// specific variants), and guessing a fixed list is how a filter ends up
// silently matching nothing. A section-list entry whose sole key contains
// "survey" or "questionnaire" is unambiguously one of these — normal content
// entries are shelfRenderer / richSectionRenderer / gridRenderer / tileRenderer
// and never carry those words.
//
// "feedback" is deliberately NOT in the key list: feedback-ish keys do appear
// on legitimate content (menu entries, endpoints), so it is only accepted
// together with survey-like title text below.
const SURVEY_KEY_HINTS = ['survey', 'questionnaire'];

// Title fallback, for a survey delivered inside an ordinary shelfRenderer
// where the key alone gives nothing away. Lowercased substrings, kept short
// so wording variations still match.
const SURVEY_TITLE_HINTS = [
  'noch besser zu machen',   // de - "Hilf uns, YouTube noch besser zu machen"
  'hilf uns',                // de
  'help us improve',         // en
  'help us make youtube',    // en
  'ayúdanos a mejorar',      // es
  'aidez-nous à améliorer',  // fr
  'aiutaci a migliorare',    // it
  'help ons youtube',        // nl
];

function entryTitle(entry) {
  const t = entry?.shelfRenderer?.title
    || entry?.shelfRenderer?.headerRenderer?.shelfHeaderRenderer?.title
    || null;
  if (!t) return '';
  if (t.simpleText) return String(t.simpleText);
  if (Array.isArray(t.runs)) return t.runs.map(r => r?.text || '').join('');
  return '';
}

export function getSurveyReason(entry) {
  if (!entry || typeof entry !== 'object') return null;

  for (const key of Object.keys(entry)) {
    const k = key.toLowerCase();
    if (SURVEY_KEY_HINTS.some(h => k.includes(h))) return 'key:' + key;
  }

  const title = entryTitle(entry).toLowerCase();
  if (title && SURVEY_TITLE_HINTS.some(h => title.includes(h))) return 'title:' + entryTitle(entry).slice(0, 60);

  return null;
}

export function filterSurveyShelves(shelves, pageName = null) {
  if (!Array.isArray(shelves) || !configRead('hideSurveys')) return;
  for (let i = shelves.length - 1; i >= 0; i--) {
    try {
      const reason = getSurveyReason(shelves[i]);
      if (!reason) continue;
      appendFileOnlyLog('survey.removed', { reason, pageName });
      shelves.splice(i, 1);
    } catch (_) { }
  }
}
