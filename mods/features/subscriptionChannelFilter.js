import { configRead, configWrite } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';
import { lockupSubtitle } from './lockupViewModel.js';

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

// Channels seen on the Subscriptions page, name → last seen, so the picker has
// a list even where the page's channel tabs do not name the channels (the 5.0
// TV's do not: the picker found no channel tab at all there).
const SEEN_KEY = 'ytaf-subscription-channels-seen';
const MAX_SEEN = 300;
const NOT_A_NAME = /^(vor |live|premiere)|\b(ago|views|aufrufe|zuschauer|watching)\b/i;

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

function lineText(text) {
  if (!text) return '';
  if (text.simpleText) return String(text.simpleText);
  if (Array.isArray(text.runs)) return text.runs.map(r => (r && r.text) || '').join('');
  return '';
}

/**
 * The channel of a feed tile, only when the tile says so for certain: a line
 * part linking to a channel (UC…), else the first line part when it is not a
 * date or view count. Stricter than channelNameOf, because a wrong guess here
 * would put "vor 1 Tag" in the list.
 */
export function feedChannelName(item) {
  try {
    const lines = item?.tileRenderer?.metadata?.tileMetadataRenderer?.lines;
    if (Array.isArray(lines)) {
      for (const line of lines) {
        for (const part of (line?.lineRenderer?.items || [])) {
          const text = part?.lineItemRenderer?.text;
          const runs = Array.isArray(text?.runs) ? text.runs : [];
          for (const run of runs) {
            const id = run?.navigationEndpoint?.browseEndpoint?.browseId;
            if (typeof id === 'string' && id.indexOf('UC') === 0 && run.text) return String(run.text).trim();
          }
        }
      }
      const first = lineText(lines[0]?.lineRenderer?.items?.[0]?.lineItemRenderer?.text).trim();
      if (first && first !== '•' && !NOT_A_NAME.test(first)) return first;
    }
    const fromLockup = String(lockupSubtitle(item) || '').trim();
    if (fromLockup && !NOT_A_NAME.test(fromLockup)) return fromLockup;
  } catch (_) { }
  return '';
}

function readSeen() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

/** Remember the channels of Subscriptions tiles; called before any are hidden. */
export function noteSubscriptionChannels(items) {
  if (!Array.isArray(items) || !items.length) return;
  try {
    const seen = readSeen();
    const now = Date.now();
    let changed = false;
    for (const item of items) {
      const name = feedChannelName(item);
      if (!name || name.length > 100) continue;
      if (!seen[name]) changed = true;
      seen[name] = now;
    }
    if (!changed) return;
    const names = Object.keys(seen);
    if (names.length > MAX_SEEN) {
      names.sort((a, b) => seen[b] - seen[a]);
      for (const old of names.slice(MAX_SEEN)) delete seen[old];
    }
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch (_) { }
}

export function seenSubscriptionChannels() {
  return Object.keys(readSeen());
}
