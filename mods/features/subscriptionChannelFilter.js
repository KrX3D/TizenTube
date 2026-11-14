import { configRead, configWrite } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';

/**
 * subscriptionChannelFilter.js — channels whose videos are left out of the
 * Subscriptions page, picked from the list of subscribed channels.
 *
 * Asked for: a subscription to music channels that are never watched on the
 * TV. Unlike the long-press "hide this channel" (channelHider.js), which hides
 * a channel everywhere, these are only hidden on the Subscriptions feed and in
 * the subscriptions part of the TV home bar row (homeBarPreview.js). The
 * channel's own tab and page, search and Home are untouched.
 *
 * By name, for the same reason channelHider.js gives: a feed tile carries the
 * channel's name, not its id. The names come from the Subscriptions page's
 * channel tabs, which use the same spelling as the tiles.
 */

function normalise(name) {
  return String(name || '').trim().toLowerCase();
}

export function subscriptionHiddenChannels() {
  const stored = configRead('subscriptionHiddenChannels');
  return Array.isArray(stored) ? stored : [];
}

export function isHiddenOnSubscriptions(name) {
  const wanted = normalise(name);
  if (!wanted) return false;
  return subscriptionHiddenChannels().some(hidden => normalise(hidden) === wanted);
}

/** Hide the channel on the Subscriptions page, or show it again. Returns whether it is now hidden. */
export function toggleSubscriptionChannel(name) {
  name = String(name || '').trim();
  if (!name) return false;
  const list = subscriptionHiddenChannels();
  const hidden = isHiddenOnSubscriptions(name);
  configWrite('subscriptionHiddenChannels', hidden
    ? list.filter(c => normalise(c) !== normalise(name))
    : list.concat([name]));
  appendFileOnlyLog('channelHider.subscriptions', { channel: name.slice(0, 60), hidden: !hidden });
  return !hidden;
}
