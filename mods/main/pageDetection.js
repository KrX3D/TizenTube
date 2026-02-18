export function detectCurrentPage() {
  const hash = location.hash ? location.hash.substring(1) : '';
  const path = location.pathname || '';
  const search = location.search || '';
  const href = location.href || '';

  const cleanHash = hash.split('?additionalDataUrl')[0];

  let browseParam = '';
  const cMatch = hash.match(/[?&]c=([^&]+)/i);
  if (cMatch) browseParam = cMatch[1].toLowerCase();

  const browseIdMatch = hash.match(/\/browse\/([^?&#]+)/i);
  if (browseIdMatch && !browseParam) {
    browseParam = browseIdMatch[1].toLowerCase();
  }

  const combined = (cleanHash + ' ' + path + ' ' + search + ' ' + href + ' ' + browseParam).toLowerCase();

  // PRIORITY 1: Tizen browse parameters
  if (browseParam.includes('fesubscription')) return 'subscriptions';

  // Library and sub-pages
  if (browseParam === 'felibrary') return 'library';
  if (browseParam === 'fehistory') return 'history';
  if (browseParam === 'femy_youtube') return 'playlist';
  if (browseParam === 'feplaylist_aggregation') return 'playlists';

  // Individual playlists
  if (browseParam.startsWith('vlpl')) return 'playlist';
  if (browseParam === 'vlwl') return 'playlist';
  if (browseParam === 'vlll') return 'playlist';

  // Topics / home variants
  if (browseParam.includes('fetopics_music') || browseParam.includes('music')) return 'music';
  if (browseParam.includes('fetopics_gaming') || browseParam.includes('gaming')) return 'gaming';
  if (browseParam.includes('fetopics')) return 'home';

  // Channel pages
  if (browseParam.startsWith('uc') && browseParam.length > 10) return 'channel';

  // PRIORITY 2: URL patterns
  if (cleanHash.includes('/playlist') || combined.includes('list=')) return 'playlist';
  if (cleanHash.includes('/results') || cleanHash.includes('/search')) return 'search';
  if (cleanHash.includes('/watch')) return 'watch';
  if (cleanHash.includes('/@') || cleanHash.includes('/channel/')) return 'channel';
  if (cleanHash.includes('/browse') && !browseParam) return 'home';
  if (cleanHash === '' || cleanHash === '/') return 'home';

  return 'other';
}
