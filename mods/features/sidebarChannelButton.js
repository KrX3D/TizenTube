import { configRead } from '../config.js';
import { ButtonRenderer } from '../ui/ytUI.js';
import { t } from 'i18next';

// "Add Channel to Sidebar" button on channel pages (upstream 79195bb).
//
// Lives in its own module because the channel header arrives through two
// different response shapes in this fork (the object-root JSON.parse patch and
// the array-root processResponsePayload), and past features that were inlined
// into only one of them silently did nothing on the other path.

/** Pull the channel's own browseId out of the response's tracking params. */
function channelBrowseId(payload) {
  for (const service of payload?.responseContext?.serviceTrackingParams || []) {
    for (const param of service?.params || []) {
      if (param?.key === 'browse_id') return param.value;
    }
  }
  return null;
}

export function addChannelSidebarButton(payload) {
  try {
    const header = payload?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer
      ?.header?.channelHeaderRenderer;
    if (!header || !Array.isArray(header.buttons)) return;
    // Re-entrancy guard: the same payload can pass through both response
    // paths, which would otherwise stack two identical buttons.
    if (header.__ttSidebarButtonAdded) return;

    const browseId = channelBrowseId(payload);
    if (!browseId) return;
    const title = header.title?.simpleText;
    if (!title) return;

    const inSidebar = (configRead('sidebarContentsOrder') || []).some(entry =>
      (typeof entry === 'object' && entry !== null ? entry.browseId : entry) === browseId);

    header.buttons.push({
      buttonRenderer: ButtonRenderer(
        false,
        inSidebar
          ? t('settings.options.uiSettings.options.sortSidebarContents.removeFromSidebar')
          : t('settings.options.uiSettings.options.sortSidebarContents.addToSidebar'),
        inSidebar ? 'REMOVE' : 'ADD',
        {
          customAction: {
            action: 'ADD_OR_REMOVE_CHANNEL_TO_SIDEBAR',
            parameters: { browseId, title }
          }
        }
      )
    });
    header.__ttSidebarButtonAdded = true;
  } catch (err) {
    console.warn('[sidebarChannelButton] failed to add sidebar button:', err);
  }
}
