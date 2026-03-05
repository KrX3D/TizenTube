import { PatchSettings } from '../ui/customYTSettings.js';
import { applyLibraryTabHiding } from './libraryTabHider.js';

const originalParse = JSON.parse;
JSON.parse = function () {
  const response = originalParse.apply(this, arguments);

  try {
    applyLibraryTabHiding(response);

    if (response?.title?.runs) {
      PatchSettings(response);
    }
  } catch (_) {
    // Keep response unchanged if parsing hook hits an edge-case.
  }

  return response;
};

window.JSON.parse = JSON.parse;
for (const key in window._yttv) {
  if (window._yttv[key] && window._yttv[key].JSON && window._yttv[key].JSON.parse) {
    window._yttv[key].JSON.parse = JSON.parse;
  }
}
