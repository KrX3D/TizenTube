import { buttonItem, overlayPanelItemListRenderer, showModal, showToast } from './ytUI.js';
import { innerTubeClient, browse, collectItems, continuationTokens } from '../features/homeBarPreview.js';
import { extractNavTabBrowseId } from '../features/shorts.js';
import {
  feedChannelName, isHiddenOnSubscriptions, seenSubscriptionChannels, subscriptionHiddenChannels, toggleSubscriptionChannel,
} from '../features/subscriptionChannelFilter.js';
import { appendFileOnlyLog } from '../features/hideWatched.js';
import { t } from 'i18next';

/**
 * subscriptionChannelsSettings.js — the list of subscribed channels, each one
 * switchable between shown and hidden on the Subscriptions page. See
 * subscriptionChannelFilter.js.
 *
 * The list is put together from three places, because none is enough alone:
 *   - the Subscriptions page's channel tabs, where they name a channel (on the
 *     5.0 TV they do not: no tab carried a channel id),
 *   - the channels of the feed's videos, from a few pages fetched when the
 *     screen opens,
 *   - channels remembered from browsing the Subscriptions page
 *     (noteSubscriptionChannels in subscriptionChannelFilter.js).
 * Channels hidden earlier stay in the list, so they can be shown again.
 */

const KEY = 'settings.options.uiSettings.options.subscriptionChannelFilter';
const MAX_DEPTH = 16;
// Feed pages read for channel names when the screen opens.
const FEED_PAGES = 4;

let _channels = null;

function tabTitle(tab) {
  const title = tab?.tabRenderer?.title;
  if (typeof title === 'string') return title;
  if (title?.simpleText) return String(title.simpleText);
  if (Array.isArray(title?.runs)) return title.runs.map(r => r?.text || '').join('');
  return '';
}

function tabIds(tab) {
  return String(extractNavTabBrowseId(tab)).split(',').filter(Boolean);
}

/** Channel tabs (browse id UC…) anywhere in the Subscriptions response. */
function collectChannelTabs(node, out, depth) {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return out;
  if (Array.isArray(node)) {
    for (const child of node) collectChannelTabs(child, out, depth + 1);
    return out;
  }
  if (node.tabRenderer) {
    out.tabs.push({ title: tabTitle(node).trim().slice(0, 40), ids: tabIds(node).slice(0, 3) });
    const name = tabTitle(node).trim();
    if (name && tabIds(node).some(id => /^UC[A-Za-z0-9_-]{10,}$/.test(id))) out.names.push(name);
    return out;
  }
  for (const key of Object.keys(node)) collectChannelTabs(node[key], out, depth + 1);
  return out;
}

function addName(names, name) {
  name = String(name || '').trim();
  if (name && !names.some(n => n.toLowerCase() === name.toLowerCase())) names.push(name);
}

async function loadChannels() {
  const client = innerTubeClient();
  const names = [];
  const stats = { hasClient: !!client, pages: 0, tiles: 0, fromTabs: 0, fromFeed: 0, remembered: 0, hidden: 0 };
  let tabs = [];
  if (client) {
    let response = await browse(client, 'FEsubscriptions');
    const used = new Set();
    while (response && stats.pages < FEED_PAGES) {
      stats.pages++;
      if (stats.pages === 1) {
        const found = collectChannelTabs(response, { tabs: [], names: [] }, 0);
        tabs = found.tabs;
        for (const name of found.names) addName(names, name);
        stats.fromTabs = names.length;
        stats.topKeys = Object.keys(response).slice(0, 8);
      }
      const items = collectItems(response, [], 0);
      stats.tiles += items.length;
      const before = names.length;
      for (const item of items) addName(names, feedChannelName(item));
      stats.fromFeed += names.length - before;
      const token = continuationTokens(response, [], 0).find(tok => !used.has(tok));
      if (!token) break;
      used.add(token);
      response = await browse(client, 'FEsubscriptions', token);
    }
  }
  let before = names.length;
  for (const name of seenSubscriptionChannels()) addName(names, name);
  stats.remembered = names.length - before;
  before = names.length;
  for (const name of subscriptionHiddenChannels()) addName(names, name);
  stats.hidden = names.length - before;
  names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  // The tabs as found, so a list built without them says what they looked like.
  appendFileOnlyLog('channelHider.subscriptions.list', Object.assign(stats, {
    channels: names.length, tabCount: tabs.length, tabs: tabs.slice(0, 6),
  }));
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
