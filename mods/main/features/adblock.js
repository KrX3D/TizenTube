import { configRead } from '../../config.js';
import { PatchSettings } from '../../ui/customYTSettings.js';
import { applyAdCleanup, applyBrowseAdFiltering, applyShortsAdFiltering } from './adCleanup.js';
import { applyPreferredVideoCodec } from './videoCodecPreference.js';
import { applyPaidContentOverlay } from './paidContentOverlay.js';
import { applyEndscreen } from './endscreen.js';
import { applyYouThereRenderer } from './youThereRenderer.js';

/**
 * Legacy compatibility wrapper.
 *
 * This module used to be a very large, side-effect-driven JSON.parse patch.
 * The project now uses smaller feature modules and centralized hooks
 * (see responsePatches.js). Keep this as an opt-in utility so callers can
 * run the same core transforms explicitly.
 */
export function applyAdblockFeatureSet(parsedResponse) {
  const adBlockEnabled = configRead('enableAdBlock');

  applyAdCleanup(parsedResponse, adBlockEnabled);
  applyBrowseAdFiltering(parsedResponse, adBlockEnabled);
  applyShortsAdFiltering(parsedResponse, adBlockEnabled);

  applyPaidContentOverlay(parsedResponse, configRead('enablePaidPromotionOverlay'));
  applyPreferredVideoCodec(parsedResponse, configRead('videoPreferredCodec'));
  applyEndscreen(parsedResponse, configRead('enableHideEndScreenCards'));
  applyYouThereRenderer(parsedResponse, configRead('enableYouThereRenderer'));

  if (parsedResponse?.title?.runs) {
    PatchSettings(parsedResponse);
  }

  return parsedResponse;
}

export {
  applyAdCleanup,
  applyBrowseAdFiltering,
  applyShortsAdFiltering
};
