import { buttonItem, overlayPanelItemListRenderer, showModal, showToast } from './ytUI.js';
import { innerTubeClient, browse, collectItems, continuationTokens } from '../features/homeBarPreview.js';
import { extractNavTabBrowseId } from '../features/shorts.js';
import {
  isHiddenOnSubscriptions, knownUploaders, resolveUploaders, subscriptionHiddenChannels, toggleSubscriptionChannel, uploaderOf,
} from '../features/subscriptionChannelFilter.js';
import { appendFileOnlyLog, getItemTitle, getItemVideoId } from '../features/hideWatched.js';
import { lockupSelectCommand } from '../features/lockupViewModel.js';
import { t } from 'i18next';

/**
 * subscriptionChannelsSettings.js — the list of subscribed channels, each one
 * switchable between shown and hidden on the Subscriptions page. See
 * subscriptionChannelFilter.js.
 *
 * Only real channels go in the list, never the names tiles show (an artist,
 * "GNU und 2 weitere"):
 *   - the channel list (browse FEchannels, what youtube.com/feed/channels
 *     shows) and channel tabs, where they carry a channel id,
 *   - the uploaders of the feed's videos, looked up when the screen opens,
 *   - uploaders looked up earlier, and channels already hidden.
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

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{10,}$/;
// Feed videos whose uploader is looked up when the screen opens.
const FEED_VIDEOS = 60;

/** Channel tabs (browse id UC…) anywhere in a response. */
function collectChannelTabs(node, out, depth) {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return out;
  if (Array.isArray(node)) {
    for (const child of node) collectChannelTabs(child, out, depth + 1);
    return out;
  }
  if (node.tabRenderer) {
    const name = tabTitle(node).trim();
    if (name && tabIds(node).some(id => CHANNEL_ID.test(id))) out.push(name);
    return out;
  }
  for (const key of Object.keys(node)) collectChannelTabs(node[key], out, depth + 1);
  return out;
}

/** Channel tiles (they open a UC… page) in a response, as their titles. */
function channelTileNames(response) {
  const out = [];
  for (const item of collectItems(response, [], 0)) {
    const id = item?.tileRenderer?.onSelectCommand?.browseEndpoint?.browseId
      || lockupSelectCommand(item)?.browseEndpoint?.browseId || '';
    if (!CHANNEL_ID.test(String(id))) continue;
    const name = getItemTitle(item)
      || tabTitle({ tabRenderer: { title: item?.tileRenderer?.metadata?.tileMetadataRenderer?.title } });
    if (name) out.push(String(name).trim());
  }
  return out;
}

function addName(names, name) {
  name = String(name || '').trim();
  if (name && !names.some(n => n.toLowerCase() === name.toLowerCase())) names.push(name);
}

async function loadChannels() {
  const client = innerTubeClient();
  const names = [];
  const stats = { hasClient: !!client, fromChannelList: 0, fromTabs: 0, feedPages: 0, videos: 0, lookupsFailed: 0, fromUploaders: 0, known: 0, hidden: 0 };
  if (client) {
    // The channel list, as youtube.com/feed/channels shows it.
    const channels = await browse(client, 'FEchannels');
    if (channels) {
      for (const name of channelTileNames(channels)) addName(names, name);
      for (const name of collectChannelTabs(channels, [], 0)) addName(names, name);
      stats.fromChannelList = names.length;
    }
    let response = await browse(client, 'FEsubscriptions');
    if (response) {
      const before = names.length;
      for (const name of collectChannelTabs(response, [], 0)) addName(names, name);
      stats.fromTabs = names.length - before;
    }
    // The uploaders of the feed's videos: the channels that actually post there.
    const ids = [];
    const used = new Set();
    while (response && stats.feedPages < FEED_PAGES && ids.length < FEED_VIDEOS) {
      stats.feedPages++;
      for (const item of collectItems(response, [], 0)) {
        const id = getItemVideoId(item);
        if (id && ids.indexOf(id) === -1 && ids.length < FEED_VIDEOS) ids.push(id);
      }
      const token = continuationTokens(response, [], 0).find(tok => !used.has(tok));
      if (!token) break;
      used.add(token);
      response = await browse(client, 'FEsubscriptions', token);
    }
    stats.videos = ids.length;
    stats.lookupsFailed = await resolveUploaders(ids);
    const before = names.length;
    for (const id of ids) addName(names, uploaderOf(id));
    stats.fromUploaders = names.length - before;
  }
  let before = names.length;
  for (const name of knownUploaders()) addName(names, name);
  stats.known = names.length - before;
  before = names.length;
  for (const name of subscriptionHiddenChannels()) addName(names, name);
  stats.hidden = names.length - before;
  names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  appendFileOnlyLog('channelHider.subscriptions.list', Object.assign(stats, { channels: names.length }));
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
