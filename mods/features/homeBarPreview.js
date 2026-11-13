import { configRead, configChangeEmitter } from '../config.js';
import {
  appendFileOnlyLog, getItemVideoId, getItemTitle, getWatchPercent, tileWatchPercent,
} from './hideWatched.js';
import { getLockup, isLockupShort, lockupSubtitle, lockupSelectCommand } from './lockupViewModel.js';
import { openWhenReady } from './resumeOutOfVideo.js';
import { t } from 'i18next';

/**
 * homeBarPreview.js — TizenTube's row on the TV's home bar (Smart Hub Preview).
 *
 * Asked for: when TizenTube is highlighted on the home bar, show a row the way
 * Emby does, made of
 *   1. the latest history entry, if it is not finished (under 90%),
 *   2. the latest playlists, without Watch Later and Liked videos,
 *   3. videos from the subscriptions page,
 * each its own section (Samsung draws a section title between them), each
 * switchable and with its own count: 1, 3 and 6 by default.
 *
 * Samsung only shows these rows on TVs up to 2021. The test build proved it
 * on the 5.0 TV; the 6.5 TV accepts the data and shows nothing, as it does for
 * Emby. Only the standalone app can publish one: the row comes from its
 * PreviewService (standalone/preview/preview.js).
 *
 * The rows are built here, in the page, because this is where the signed-in
 * InnerTube client is. They reach the service the same way the logs do: on the
 * proxy path by a POST to the local service, on the injected path through a
 * global the injector drains over CDP (the page is https://youtube.com there,
 * and a fetch to http://localhost is blocked as mixed content). The service
 * writes them to a file and PreviewService publishes that file, on every app
 * start and when the system wakes it, roughly every ten minutes.
 *
 * A tile hands its action_data back when it is selected; standalone/index.html
 * passes it to the service, and openLaunchAction() below opens it once the
 * app is up. It goes to Home first and then opens the video, the same way a
 * wake reload does (resumeOutOfVideo.js): starting straight into a /watch URL
 * is what brings up the profile picker.
 */

const FINISHED_PERCENT = 90;
// After startup, so the fetches do not compete with the first page load.
const FIRST_RUN_MS = 20000;
const REFRESH_MS = 15 * 60 * 1000;
const MAX_DEPTH = 16;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,64}$/;
// Watch Later, Liked videos and the old "My YouTube" alias for Watch Later.
const SPECIAL_PLAYLISTS = new Set(['WL', 'LL', 'LM', 'MY_YOUTUBE']);
const HANDLED_KEY = 'ytaf-home-bar-launch-handled';

function onProxyPath() {
  try { return location.hostname === 'localhost'; } catch (_) { return false; }
}

function isStandalone() {
  return window.__ttStandalone === true || onProxyPath();
}

function count(key, fallback) {
  const n = Number(configRead(key));
  return isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 20) : fallback;
}

function innerTubeClient() {
  try {
    const mappings = Object.values(window._yttv || {}).find(a => a && a.mappings);
    return (mappings && mappings.get('KabukiInnerTubeClient')) || null;
  } catch (_) {
    return null;
  }
}

function browse(client, browseId) {
  // The response passes through adblock.js's parse hook, which records the
  // page it names as the page on screen. Put back what was there, so a
  // background fetch of Subscriptions does not make the hook treat the page
  // the user is actually on as Subscriptions.
  const pageBefore = window.__ttLastDetectedPage;
  const restore = () => { window.__ttLastDetectedPage = pageBefore; };
  return new Promise((resolve) => {
    const done = (value) => { restore(); resolve(value); };
    try {
      client.fetch({ path: '/youtubei/v1/browse', payload: { browseId } })
        .subscribe(done, (err) => {
          restore();
          appendFileOnlyLog('homeBar.fetchFailed', { browseId, message: (err && err.message) || String(err) });
          resolve(null);
        });
    } catch (err) {
      restore();
      appendFileOnlyLog('homeBar.fetchFailed', { browseId, message: (err && err.message) || String(err) });
      resolve(null);
    }
  });
}

/** Tiles and lockups in the order the page would show them. */
function collectItems(node, out, depth) {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return out;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) collectItems(node[i], out, depth + 1);
    return out;
  }
  if (node.tileRenderer || node.lockupViewModel) {
    out.push(node);
    return out;
  }
  for (const key of Object.keys(node)) collectItems(node[key], out, depth + 1);
  return out;
}

function text(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value.simpleText) return String(value.simpleText);
  if (value.content) return String(value.content);
  if (Array.isArray(value.runs)) return value.runs.map(r => (r && r.text) || '').join('');
  return '';
}

function clip(s, n) {
  s = String(s || '').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** The channel line of a tile, if it has one. */
function subtitleOf(item) {
  const lines = item?.tileRenderer?.metadata?.tileMetadataRenderer?.lines;
  if (Array.isArray(lines)) {
    for (const line of lines) {
      const items = line?.lineRenderer?.items;
      if (!Array.isArray(items)) continue;
      for (const part of items) {
        const s = text(part?.lineItemRenderer?.text);
        if (s && s.trim() !== '•') return s;
      }
    }
  }
  return lockupSubtitle(item) || '';
}

function isShort(item) {
  return !!item?.tileRenderer?.onSelectCommand?.reelWatchEndpoint || isLockupShort(item);
}

/** A video tile's id, or null for anything that is not a plain video. */
function videoIdOf(item) {
  if (isShort(item)) return null;
  const lockup = getLockup(item);
  if (lockup && lockup.contentType && lockup.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;
  const type = item?.tileRenderer?.contentType;
  if (type && type !== 'TILE_CONTENT_TYPE_VIDEO') return null;
  const id = getItemVideoId(item);
  return VIDEO_ID.test(id) ? id : null;
}

/** A playlist tile's id without its VL prefix, or null. */
function playlistIdOf(item) {
  const browseId = item?.tileRenderer?.onSelectCommand?.browseEndpoint?.browseId
    || lockupSelectCommand(item)?.browseEndpoint?.browseId
    || '';
  const raw = String(browseId || item?.tileRenderer?.contentId || getLockup(item)?.contentId || '');
  if (!raw) return null;
  const id = raw.replace(/^VL/, '');
  if (SPECIAL_PLAYLISTS.has(id.toUpperCase())) return null;
  // Only playlists: a browse id like UC… is a channel, FE… a feed.
  if (!/^(PL|OL|UU|FL|RD)/.test(id) || !PLAYLIST_ID.test(id)) return null;
  return id;
}

function videoThumb(videoId) {
  // 480x360, inside Samsung's 4:3 limits (333x250 to 480x360) and far under
  // the 360 KB cap. Confirmed rendering on the 5.0 TV by the test build.
  return 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg';
}

/** A playlist's cover as a video thumbnail, when its URL names the video. */
function playlistThumb(item) {
  const thumbs = item?.tileRenderer?.header?.tileHeaderRenderer?.thumbnail?.thumbnails
    || getLockup(item)?.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image?.sources
    || getLockup(item)?.contentImage?.thumbnailViewModel?.image?.sources
    || [];
  for (let i = thumbs.length - 1; i >= 0; i--) {
    const m = String(thumbs[i]?.url || '').match(/\/vi\/([A-Za-z0-9_-]{11})\//);
    if (m) return videoThumb(m[1]);
  }
  return null;
}

function videoTile(item, id) {
  return {
    title: clip(getItemTitle(item) || '', 100),
    subtitle: clip(subtitleOf(item), 60),
    image_url: videoThumb(id),
    image_ratio: '4by3',
    action_data: JSON.stringify({ v: id }),
    is_playable: true,
  };
}

/** Progress this TV knows for a history entry, never the history rule's 100%. */
function historyPercent(item, id) {
  const fromTile = tileWatchPercent(item);
  const cached = Number(window._ttVideoProgressCache?.[id]);
  const values = [fromTile, isFinite(cached) ? cached : null].filter(v => v !== null && isFinite(v));
  return values.length ? Math.max.apply(null, values) : null;
}

async function historySection(client, wanted) {
  if (!wanted) return null;
  const response = await browse(client, 'FEhistory');
  if (!response) return null;
  const tiles = [];
  let considered = 0;
  for (const item of collectItems(response, [], 0)) {
    const id = videoIdOf(item);
    if (!id) continue;
    // "The latest N entries, each only if it is not finished": a finished
    // latest entry leaves the section empty rather than reaching further
    // back for an older one.
    considered++;
    const pct = historyPercent(item, id);
    if (pct === null || pct < FINISHED_PERCENT) tiles.push(videoTile(item, id));
    if (considered >= wanted) break;
  }
  return tiles.length ? { title: t('homeBarPreview.sections.continue'), tiles } : null;
}

async function playlistSection(client, wanted) {
  if (!wanted) return null;
  const response = await browse(client, 'FEplaylist_aggregation');
  if (!response) return null;
  const tiles = [];
  const seen = new Set();
  for (const item of collectItems(response, [], 0)) {
    const id = playlistIdOf(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const image = playlistThumb(item);
    if (!image) continue;
    tiles.push({
      title: clip(getItemTitle(item) || text(item?.tileRenderer?.metadata?.tileMetadataRenderer?.title) || '', 100),
      subtitle: clip(subtitleOf(item), 60),
      image_url: image,
      image_ratio: '4by3',
      action_data: JSON.stringify({ p: id }),
      is_playable: false,
    });
    if (tiles.length >= wanted) break;
  }
  return tiles.length ? { title: t('homeBarPreview.sections.playlists'), tiles } : null;
}

async function subscriptionSection(client, wanted) {
  if (!wanted) return null;
  const response = await browse(client, 'FEsubscriptions');
  if (!response) return null;
  const tiles = [];
  const seen = new Set();
  for (const item of collectItems(response, [], 0)) {
    const id = videoIdOf(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    // Watched ones are left out, by the same rule hide-watched uses
    // (history included) at the 90% mark.
    const pct = getWatchPercent(item);
    if (pct !== null && pct >= FINISHED_PERCENT) continue;
    tiles.push(videoTile(item, id));
    if (tiles.length >= wanted) break;
  }
  return tiles.length ? { title: t('homeBarPreview.sections.subscriptions'), tiles } : null;
}

let _lastSent = '';
let _running = false;

function send(json, summary) {
  if (json === _lastSent) return;
  _lastSent = json;
  if (onProxyPath()) {
    try {
      fetch('/tizentube/homeBarPreview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json })
        .catch(() => { _lastSent = ''; });
    } catch (_) { _lastSent = ''; }
  } else {
    // Drained by standalone/service/injector.js's log poll.
    window.__ttHomeBarPreview = json;
  }
  appendFileOnlyLog('homeBar.published', summary);
}

async function refresh(reason) {
  if (!isStandalone() || _running) return;
  if (!configRead('homeBarPreviewEnabled')) {
    // Sent once, so a row published before it was switched off goes away.
    send(JSON.stringify({ sections: [] }), { reason, enabled: false });
    return;
  }
  const client = innerTubeClient();
  if (!client) { appendFileOnlyLog('homeBar.noClient', { reason }); return; }
  _running = true;
  try {
    const sections = [];
    const parts = [
      await historySection(client, count('homeBarPreviewHistoryCount', 1)),
      await playlistSection(client, count('homeBarPreviewPlaylistCount', 3)),
      await subscriptionSection(client, count('homeBarPreviewSubscriptionCount', 6)),
    ];
    for (const part of parts) if (part) sections.push(part);
    send(JSON.stringify({ sections }), {
      reason,
      enabled: true,
      tiles: sections.map(s => s.title + ':' + s.tiles.length),
    });
  } catch (err) {
    appendFileOnlyLog('homeBar.failed', { reason, msg: String(err?.message || err) });
  } finally {
    _running = false;
  }
}

if (isStandalone()) {
  setTimeout(() => refresh('startup'), FIRST_RUN_MS);
  setInterval(() => refresh('interval'), REFRESH_MS);
  configChangeEmitter.addEventListener('configChange', (e) => {
    if (String(e?.detail?.key || '').indexOf('homeBarPreview') === 0) refresh('settings');
  });
}

/** Changing a setting rebuilds the row instead of waiting for the interval. */
export function refreshHomeBarPreview(reason) {
  return refresh(reason || 'manual');
}

function commandFor(action) {
  if (action && typeof action.v === 'string' && VIDEO_ID.test(action.v)) {
    return { kind: 'video', id: action.v, command: { clickTrackingParams: null, watchEndpoint: { videoId: action.v } } };
  }
  if (action && typeof action.p === 'string' && PLAYLIST_ID.test(action.p)) {
    return { kind: 'playlist', id: action.p, command: { clickTrackingParams: null, browseEndpoint: { browseId: 'VL' + action.p } } };
  }
  return null;
}

function handleAction(action, resolveCommand) {
  const target = commandFor(action);
  if (!target) return false;
  // The injector puts the action into every context it injects, and a start
  // can create more than one: open it once.
  const stamp = String(action.at || '') + ':' + target.id;
  try {
    if (sessionStorage.getItem(HANDLED_KEY) === stamp) return false;
    sessionStorage.setItem(HANDLED_KEY, stamp);
  } catch (_) { }
  appendFileOnlyLog('homeBar.launchAction', { kind: target.kind, id: target.id });
  openWhenReady(resolveCommand, target.command, 'homeBar', 'openedFromTile', { kind: target.kind, id: target.id });
  return true;
}

/**
 * At startup: open what a home-bar tile asked for, if the app was started
 * from one. Returns true when a tile launch is being handled, so the startup
 * reload does not replace it.
 *
 * @param {(cmd: object) => void} resolveCommand
 */
export function openLaunchAction(resolveCommand) {
  try {
    const action = window.__ttLaunchAction;
    if (action) {
      window.__ttLaunchAction = null;
      return handleAction(action, resolveCommand);
    }
    if (onProxyPath()) {
      // Asynchronous here, so the startup reload is not held back; the
      // navigation below wins because it waits for the resolver.
      fetch('/tizentube/launchAction')
        .then(r => (r.ok ? r.json() : null))
        .then(a => { if (a) handleAction(a, resolveCommand); })
        .catch(() => { });
    }
  } catch (err) {
    appendFileOnlyLog('homeBar.launchFailed', { msg: String(err?.message || err) });
  }
  return false;
}
