import { buttonItem, overlayPanelItemListRenderer, showModal, showToast } from './ytUI.js';
import { innerTubeClient, browse } from '../features/homeBarPreview.js';
import { extractNavTabBrowseId } from '../features/shorts.js';
import { isHiddenOnSubscriptions, subscriptionHiddenChannels, toggleSubscriptionChannel } from '../features/subscriptionChannelFilter.js';
import { appendFileOnlyLog } from '../features/hideWatched.js';
import { t } from 'i18next';

/**
 * subscriptionChannelsSettings.js — the list of subscribed channels, each one
 * switchable between shown and hidden on the Subscriptions page. See
 * subscriptionChannelFilter.js.
 *
 * The list is the Subscriptions page's own channel tabs, fetched when the
 * screen opens. Channels hidden earlier that are no longer subscribed stay in
 * the list, so they can still be shown again.
 */

const KEY = 'settings.options.uiSettings.options.subscriptionChannelFilter';
const MAX_DEPTH = 12;

let _channels = null;

function tabTitle(tab) {
  const title = tab?.tabRenderer?.title;
  if (typeof title === 'string') return title;
  if (title?.simpleText) return String(title.simpleText);
  if (Array.isArray(title?.runs)) return title.runs.map(r => r?.text || '').join('');
  return '';
}

/** Channel tabs (browse id UC…) anywhere in the Subscriptions response. */
function collectChannelNames(node, out, depth) {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return out;
  if (Array.isArray(node)) {
    for (const child of node) collectChannelNames(child, out, depth + 1);
    return out;
  }
  if (node.tabRenderer) {
    const ids = String(extractNavTabBrowseId(node)).split(',');
    const name = tabTitle(node).trim();
    if (name && ids.some(id => /^UC[A-Za-z0-9_-]{10,}$/.test(id)) && out.indexOf(name) === -1) out.push(name);
    return out;
  }
  for (const key of Object.keys(node)) collectChannelNames(node[key], out, depth + 1);
  return out;
}

async function loadChannels() {
  const client = innerTubeClient();
  const response = client ? await browse(client, 'FEsubscriptions') : null;
  const names = response ? collectChannelNames(response, [], 0) : [];
  for (const hidden of subscriptionHiddenChannels()) {
    if (!names.some(n => n.toLowerCase() === String(hidden).trim().toLowerCase())) names.push(hidden);
  }
  names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  appendFileOnlyLog('channelHider.subscriptions.list', { channels: names.length, hasClient: !!client, fetched: !!response });
  return names;
}

function render(update, selectedIndex) {
  const channels = _channels || [];
  const buttons = channels.length
    ? channels.map((name, index) => {
      const hidden = isHiddenOnSubscriptions(name);
      return buttonItem(
        { title: name, subtitle: t(KEY + (hidden ? '.hidden' : '.shown')) },
        { icon: hidden ? 'VISIBILITY_OFF' : 'PERSON' },
        [{ customAction: { action: 'TOGGLE_SUBSCRIPTION_CHANNEL', parameters: { name, index } } }]
      );
    })
    // A modal with no rows reads as broken rather than as empty.
    : [buttonItem({ title: t(KEY + '.empty') }, { icon: null }, [{ signalAction: { signal: 'POPUP_BACK' } }])];
  showModal(
    { title: t(KEY + '.title'), subtitle: t(KEY + '.subtitle') },
    overlayPanelItemListRenderer(buttons, selectedIndex),
    'tt-subscription-channel-filter',
    update
  );
}

function showSetting(settingType, parameters) {
  try {
    if (settingType === 'TOGGLE_SUBSCRIPTION_CHANNEL') {
      const name = parameters?.name;
      const hidden = toggleSubscriptionChannel(name);
      showToast('TizenTube', t(hidden ? 'toasts.subscriptionChannelHidden' : 'toasts.subscriptionChannelShown', { name }));
      render(true, Number(parameters?.index) || 0);
      return;
    }
    showToast('TizenTube', t(KEY + '.loading'));
    loadChannels()
      .then((names) => { _channels = names; render(false, 0); })
      .catch((err) => {
        appendFileOnlyLog('channelHider.subscriptions.failed', { msg: String(err?.message || err) });
        _channels = subscriptionHiddenChannels().slice();
        render(false, 0);
      });
  } catch (err) {
    console.warn('[subscriptionChannelsSettings] failed:', err);
  }
}

export default showSetting;
