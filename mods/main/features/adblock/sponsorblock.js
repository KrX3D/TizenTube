import { timelyAction, ButtonRenderer } from '../../../ui/ytUI.js';

export function applySponsorBlockTimelyActions(parsedResponse, manualSkippedSegments) {
  if (!parsedResponse?.playerOverlays?.playerOverlayRenderer) return;

  if (manualSkippedSegments.length === 0) {
    parsedResponse.playerOverlays.playerOverlayRenderer.timelyActionRenderers = [];
    return;
  }

  const timelyActions = [];

  if (window?.sponsorblock?.segments) {
    for (const segment of window.sponsorblock.segments) {
      if (!manualSkippedSegments.includes(segment.category)) continue;

      const timelyActionData = timelyAction(
        `Skip ${segment.category}`,
        'SKIP_NEXT',
        {
          clickTrackingParams: null,
          showEngagementPanelEndpoint: {
            customAction: {
              action: 'SKIP',
              parameters: {
                time: segment.segment[1]
              }
            }
          }
        },
        segment.segment[0] * 1000,
        segment.segment[1] * 1000 - segment.segment[0] * 1000
      );

      timelyActions.push(timelyActionData);
    }

    parsedResponse.playerOverlays.playerOverlayRenderer.timelyActionRenderers = timelyActions;
  }
}

export function applySponsorBlockHighlight(parsedResponse, sponsorBlockHighlightEnabled) {
  if (!sponsorBlockHighlightEnabled) return;
  if (!parsedResponse?.transportControls?.transportControlsRenderer?.promotedActions) return;
  if (!window?.sponsorblock?.segments) return;

  const category = window.sponsorblock.segments.find((segment) => segment.category === 'poi_highlight');
  if (!category) return;

  parsedResponse.transportControls.transportControlsRenderer.promotedActions.push({
    type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPONSORBLOCK_HIGHLIGHT',
    button: {
      buttonRenderer: ButtonRenderer(false, 'Skip to highlight', 'SKIP_NEXT', {
        clickTrackingParams: null,
        customAction: {
          action: 'SKIP',
          parameters: {
            time: category.segment[0]
          }
        }
      })
    }
  });
}
