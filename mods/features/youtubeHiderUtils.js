import { configRead } from '../config.js';

const PAGE_QUERY_MAP = {
  FEtopics_music: 'music',
  FEtopics_gaming: 'gaming',
  FEsubscriptions: 'subscriptions',
  FElibrary: 'library',
  FEmore: 'more',
  FEtopics_live: 'live'
};

function normalizeBrowsePageName(browseId) {
  if (!browseId) return 'unknown';
  if (browseId.startsWith('UC')) return 'channel';
  if (browseId.startsWith('VL')) return 'playlist';
  if (browseId.startsWith('RD')) return 'mix';
  return PAGE_QUERY_MAP[browseId] || browseId.replace('FE', '').replace('topics_', '');
}

export function getCurrentPageName() {
  const hash = window.location.hash?.substring(1) || '';
  if (hash === '/' || hash === '') return 'home';

  if (hash.startsWith('/search')) return 'search';
  if (hash.startsWith('/watch')) return 'watch';
  if (hash.startsWith('/playlist')) return 'playlist';
  if (hash.startsWith('/channel') || hash.startsWith('/c/') || hash.startsWith('/user/') || hash.startsWith('/@')) {
    return 'channel';
  }

  const queryPart = hash.split('?')[1] || '';
  const params = new URLSearchParams(queryPart);
  const browse = params.get('browseId');
  return normalizeBrowsePageName(browse);
}

function collectTexts(node, bucket) {
  if (!node || typeof node !== 'object') return;

  if (typeof node.simpleText === 'string') {
    bucket.push(node.simpleText);
  }

  if (Array.isArray(node.runs)) {
    const runText = node.runs.map(run => run?.text || '').join('').trim();
    if (runText) bucket.push(runText);
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) collectTexts(item, bucket);
    } else if (value && typeof value === 'object') {
      collectTexts(value, bucket);
    }
  }
}

export function getTileText(item) {
  const texts = [];
  collectTexts(item?.tileRenderer?.metadata || item?.tileRenderer || item, texts);
  return [...new Set(texts.filter(Boolean))];
}

export function shouldApplyOnCurrentPage(settingKey) {
  const pages = configRead(settingKey) || [];
  if (!Array.isArray(pages) || pages.length === 0) return true;

  const currentPage = getCurrentPageName();
  if (pages.includes(currentPage)) return true;

  if (currentPage === 'playlist' && pages.includes('playlists')) return true;
  if (currentPage === 'playlists' && pages.includes('playlist')) return true;

  return false;
}

export function parseViewsFromText(texts) {
  const allText = texts.join(' · ');
  const match = allText.match(/([\d.,]+)\s*([KMB])?\s+views/i);
  if (!match) return null;

  const numeric = parseFloat(match[1].replace(/,/g, ''));
  const suffix = (match[2] || '').toUpperCase();
  if (Number.isNaN(numeric)) return null;

  const multipliers = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };
  return Math.round(numeric * (multipliers[suffix] || 1));
}

export function parseAgeInDays(texts) {
  const allText = texts.join(' · ').toLowerCase();
  if (allText.includes('yesterday')) return 1;
  if (allText.includes('today')) return 0;

  const match = allText.match(/(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const daysByUnit = {
    minute: 1 / (24 * 60),
    hour: 1 / 24,
    day: 1,
    week: 7,
    month: 30,
    year: 365
  };

  return value * (daysByUnit[unit] || 0);
}

export function isPlaylistTile(item, texts) {
  const tile = item?.tileRenderer;
  if (!tile) return false;

  if (tile?.onSelectCommand?.watchEndpoint?.playlistId) {
    const playlistId = tile.onSelectCommand.watchEndpoint.playlistId;
    if (playlistId.startsWith('RD')) return false;
    return true;
  }

  return texts.some(text => /playlist/i.test(text));
}

export function isMixTile(item, texts) {
  const playlistId = item?.tileRenderer?.onSelectCommand?.watchEndpoint?.playlistId;
  if (playlistId?.startsWith('RD')) return true;
  return texts.some(text => /\bmix\b/i.test(text));
}

export function isLiveTile(texts) {
  return texts.some(text => /\blive\b|watching now|started streaming/i.test(text.toLowerCase()));
}

export function isShortsItem(item) {
  if (!item || typeof item !== 'object') return false;

  if (item.reelItemRenderer || item.shortsLockupViewModel || item.reelShelfRenderer) return true;

  const tileType = item?.tileRenderer?.tvhtml5ShelfRendererType;
  if (tileType === 'TVHTML5_TILE_RENDERER_TYPE_SHORTS') return true;

  const endpoint = item?.tileRenderer?.onSelectCommand?.watchEndpoint;
  if (endpoint?.webPageType === 'WEB_PAGE_TYPE_SHORTS' || endpoint?.reelWatchEndpoint) return true;

  const texts = getTileText(item).map(text => text.toLowerCase());
  return texts.some(text => text === 'shorts' || text.includes('#shorts'));
}

export function getWatchedPercent(item) {
  const overlays = item?.tileRenderer?.header?.tileHeaderRenderer?.thumbnailOverlays || [];
  for (const overlay of overlays) {
    const progress = overlay?.thumbnailOverlayResumePlaybackRenderer?.percentDurationWatched;
    if (typeof progress === 'number') return progress;
  }

  const fallback = item?.tileRenderer?.thumbnailOverlays || [];
  for (const overlay of fallback) {
    const progress = overlay?.thumbnailOverlayResumePlaybackRenderer?.percentDurationWatched;
    if (typeof progress === 'number') return progress;
  }

  return null;
}
