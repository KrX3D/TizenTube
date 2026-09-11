import i18n from 'i18next';
import resources from './i18nResources.js';

// yt.config_.HL is YouTube's own UI language, and the only reliable source —
// navigator.language on a TV reports the browser locale, which is routinely
// en-US even when the account and the app are in another language.
//
// The catch is timing. On the standalone CDP path the userscript is injected on
// Runtime.executionContextCreated, which by design happens BEFORE any of
// YouTube's own scripts run, so window.yt does not exist yet and this always
// fell through to navigator.language. That is why the settings menu came up in
// English there while the proxy path — injected later, into a page that had
// already booted — was correct.
//
// So: start with the best guess available right now, then upgrade to HL as soon
// as it appears. The settings tree is rebuilt each time it is opened, so the
// corrected language is picked up without anything else having to react.
const HL_POLL_INTERVAL_MS = 250;
const HL_POLL_TIMEOUT_MS = 20000;

function currentHl() {
  try {
    return window?.yt?.config_?.HL || '';
  } catch (_) {
    return '';
  }
}

function normalise(lng) {
  return String(lng || '').replace(/(-.*)/g, '');
}

InitI18next(normalise(currentHl() || navigator.language));

function InitI18next(lng) {
  i18n
    .init({
      lng,
      fallbackLng: 'en',
      resources,
      debug: false,
      interpolation: {
        escapeValue: false,
      }
    });
}

// Only worth watching when HL was not available at init; if it was, the
// language is already right and nothing needs to change.
if (!currentHl()) {
  const startedAt = Date.now();
  const poll = setInterval(() => {
    try {
      const hl = normalise(currentHl());
      if (hl) {
        clearInterval(poll);
        if (hl !== i18n.language) i18n.changeLanguage(hl);
        return;
      }
      if ((Date.now() - startedAt) > HL_POLL_TIMEOUT_MS) clearInterval(poll);
    } catch (_) {
      clearInterval(poll);
    }
  }, HL_POLL_INTERVAL_MS);
}
export default i18n;