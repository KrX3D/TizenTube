import { configRead } from '../config.js';

const PAGE_QUERY_MAP = {
  FEtopics_music: 'music',
  FEtopics_gaming: 'gaming',
  FEsubscriptions: 'subscriptions',
  FElibrary: 'library',
  FEmore: 'more',
  FEtopics_live: 'live'
};

export function getCurrentPageName() {
  const hash = window.location.hash?.substring(1) || '';
  if (hash === '/' || hash === '') return 'home';
  if (hash.startsWith('/search')) return 'search';

  const queryPart = hash.split('?')[1] || '';
  const params = new URLSearchParams(queryPart);
  const browse = params.get('browseId');
  if (!browse) return 'unknown';
  return PAGE_QUERY_MAP[browse] || browse.replace('FE', '').replace('topics_', '');
}

export function getTileText(item) {
  const lines = item?.tileRenderer?.metadata?.tileMetadataRenderer?.lines || [];
  const texts = [];

  for (const line of lines) {
    const lineItems = line?.lineRenderer?.items || [];
    for (const lineItem of lineItems) {
      const text = lineItem?.lineItemRenderer?.text;
      if (!text) continue;
      if (text.simpleText) texts.push(text.simpleText);
      if (Array.isArray(text.runs)) texts.push(text.runs.map(run => run.text).join(''));
    }
  }

  return texts.filter(Boolean);
}

export function shouldApplyOnCurrentPage(settingKey) {
  const pages = configRead(settingKey) || [];
  if (!Array.isArray(pages) || pages.length === 0) return false;
  return pages.includes(getCurrentPageName());
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
