import { configRead, configWrite } from '../config.js';
import { appendFileOnlyLog, getItemVideoId } from './hideWatched.js';
import { lockupSubtitle } from './lockupViewModel.js';

/**
 * subscriptionChannelFilter.js — channels whose videos are left out of the
 * Subscriptions page, picked from the list of subscribed channels.
 *
 * Asked for: a subscription to music channels that are never watched on the
 * TV. Unlike the long-press "hide this channel" (channelHider.js), which hides
 * a channel everywhere, these are only hidden on the Subscriptions feed and in
 * the subscriptions part of the TV home bar row (homeBarPreview.js).
 *
 * A feed tile does not always name its channel. Music uploads show the artist
 * ("eaJ" on a CloudKid upload), collaborations show "GNU und 2 weitere", and
 * no tile carries a channel id (checked against a dumped Subscriptions
 * response on the 5.0 TV). So the uploader of each video is looked up once
 * through YouTube's oEmbed endpoint (author_name) and kept, and a tile is
 * hidden when its uploader or its shown name is a hidden channel. A video seen
 * for the first time is looked up in the background and hidden from the next
 * load of the page on.
 */

const UPLOADERS_KEY = 'ytaf-video-uploaders';
const MAX_UPLOADERS = 800;
// The list of an earlier version, built from tile names; it held artists.
const OLD_SEEN_KEY = 'ytaf-subscription-channels-seen';
const LOOKUP_CONCURRENCY = 3;
// Background lookups per page load, so a long feed does not fire hundreds.
const BACKGROUND_LIMIT = 40;
const NOT_A_NAME = /^(vor |live|premiere)|\b(ago|views|aufrufe|zuschauer|watching)\b/i;
const COLLAB = /^(.+?)\s+(und|and)\s+\d+\s+(weitere|more)$/i;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

try { localStorage.removeItem(OLD_SEEN_KEY); } catch (_) { }

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

/** The name a feed tile shows under its title: a channel, an artist or "X und 2 weitere". */
export function feedChannelName(item) {
  try {
    const lines = item?.tileRenderer?.metadata?.tileMetadataRenderer?.lines;
    if (Array.isArray(lines)) {
      const first = lineText(lines[0]?.lineRenderer?.items?.[0]?.lineItemRenderer?.text).trim();
      if (first && first !== '•' && !NOT_A_NAME.test(first)) return first;
    }
    const fromLockup = String(lockupSubtitle(item) || '').trim();
    if (fromLockup && !NOT_A_NAME.test(fromLockup)) return fromLockup;
  } catch (_) { }
  return '';
}

// ── Uploaders ────────────────────────────────────────────────────────────────

let _uploaders = null;

function uploaders() {
  if (_uploaders) return _uploaders;
  try {
    const parsed = JSON.parse(localStorage.getItem(UPLOADERS_KEY) || '{}');
    _uploaders = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    _uploaders = {};
  }
  return _uploaders;
}

function saveUploaders() {
  try {
    const map = uploaders();
    const ids = Object.keys(map);
    // Oldest first, as added: drop from the front.
    for (let i = 0; i < ids.length - MAX_UPLOADERS; i++) delete map[ids[i]];
    localStorage.setItem(UPLOADERS_KEY, JSON.stringify(map));
  } catch (_) { }
}

export function uploaderOf(videoId) {
  return uploaders()[videoId] || '';
}

/** Every uploader looked up so far. */
export function knownUploaders() {
  const map = uploaders();
  const out = [];
  for (const id of Object.keys(map)) if (map[id] && out.indexOf(map[id]) === -1) out.push(map[id]);
  return out;
}

const _failed = new Set();
const _pending = new Set();

function lookupUploader(videoId) {
  const url = 'https://www.youtube.com/oembed?format=json&url='
    + encodeURIComponent('https://www.youtube.com/watch?v=' + videoId);
  return fetch(url, { credentials: 'omit' })
    .then(res => (res.ok ? res.json() : null))
    .then((data) => {
      const name = String((data && data.author_name) || '').trim();
      if (!name) { _failed.add(videoId); return ''; }
      uploaders()[videoId] = name.slice(0, 100);
      return name;
    })
    .catch(() => { _failed.add(videoId); return ''; });
}

/** Look up the uploaders of these videos, a few at a time. Resolves to how many failed. */
export function resolveUploaders(videoIds) {
  const queue = videoIds.filter(id => VIDEO_ID.test(id) && !uploaderOf(id) && !_failed.has(id) && !_pending.has(id));
  queue.forEach(id => _pending.add(id));
  let failed = 0;
  const worker = () => {
    const id = queue.shift();
    if (!id) return Promise.resolve();
    return lookupUploader(id).then((name) => {
      _pending.delete(id);
      if (!name) failed++;
      return worker();
    });
  };
  const workers = [];
  for (let i = 0; i < LOOKUP_CONCURRENCY; i++) workers.push(worker());
  return Promise.all(workers).then(() => { saveUploaders(); return failed; });
}

let _backgroundUsed = 0;

/**
 * Called with the Subscriptions page's tiles before any are hidden: look up
 * the uploaders not known yet, so their tiles can be hidden next time.
 */
export function noteSubscriptionChannels(items) {
  if (!Array.isArray(items) || !items.length || !subscriptionHiddenChannels().length) return;
  if (_backgroundUsed >= BACKGROUND_LIMIT) return;
  const ids = [];
  for (const item of items) {
    const id = getItemVideoId(item);
    if (id && VIDEO_ID.test(id) && !uploaderOf(id) && !_failed.has(id) && !_pending.has(id)) ids.push(id);
  }
  if (!ids.length) return;
  const batch = ids.slice(0, BACKGROUND_LIMIT - _backgroundUsed);
  _backgroundUsed += batch.length;
  resolveUploaders(batch).then((failed) => {
    appendFileOnlyLog('channelHider.subscriptions.uploaders', { looked: batch.length, failed });
  });
}

/** Whether a Subscriptions tile belongs to a channel hidden there. */
export function isTileHiddenOnSubscriptions(item, shownName) {
  if (!subscriptionHiddenChannels().length) return false;
  const names = [uploaderOf(getItemVideoId(item)), feedChannelName(item), shownName];
  for (const name of names) {
    if (!name) continue;
    if (isHiddenOnSubscriptions(name)) return true;
    const collab = COLLAB.exec(String(name).trim());
    if (collab && isHiddenOnSubscriptions(collab[1])) return true;
  }
  return false;
}
