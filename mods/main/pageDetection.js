export function detectCurrentPage() {
  const hash = location.hash ? location.hash.substring(1) : '';
  const path = location.pathname || '';
  const search = location.search || '';
  const href = location.href || '';

  const cleanHash = hash.split('?additionalDataUrl')[0];

  // Extract browse parameters
  let browseParam = '';
  const cMatch = hash.match(/[?&]c=([^&]+)/i);
  if (cMatch) browseParam = cMatch[1].toLowerCase();

  const browseIdMatch = hash.match(/\/browse\/([^?&#]+)/i);
  if (browseIdMatch && !browseParam) {
    browseParam = browseIdMatch[1].toLowerCase();
  }

  const combined = (cleanHash + ' ' + path + ' ' + search + ' ' + href + ' ' + browseParam).toLowerCase();

  let detectedPage = 'other';

  // PRIORITY 1: Tizen browse parameters
  if (browseParam.includes('fesubscription')) detectedPage = 'subscriptions';
  else if (browseParam === 'felibrary') detectedPage = 'library';
  else if (browseParam === 'fehistory') detectedPage = 'history';
  else if (browseParam === 'femy_youtube') detectedPage = 'playlist';
  else if (browseParam === 'feplaylist_aggregation') detectedPage = 'playlists';
  // Individual playlists (VL prefix = Video List)
  else if (browseParam.startsWith('vlpl')) detectedPage = 'playlist'; // User playlist
  else if (browseParam === 'vlwl') detectedPage = 'playlist'; // Watch Later
  else if (browseParam === 'vlll') detectedPage = 'playlist'; // Liked Videos

  // Topics (home variations)
  else if (browseParam.includes('fetopics_music') || browseParam.includes('music')) detectedPage = 'music';
  else if (browseParam.includes('fetopics_gaming') || browseParam.includes('gaming')) detectedPage = 'gaming';
  else if (browseParam.includes('fetopics')) detectedPage = 'home';
  
  // Channel pages
  else if (browseParam.startsWith('uc') && browseParam.length > 10) detectedPage = 'channel';

  // PRIORITY 2: URL patterns
  else if (cleanHash.includes('/playlist') || combined.includes('list=')) detectedPage = 'playlist';
  else if (cleanHash.includes('/results') || cleanHash.includes('/search')) detectedPage = 'search';
  else if (cleanHash.includes('/watch')) detectedPage = 'watch';
  else if (cleanHash.includes('/@') || cleanHash.includes('/channel/')) detectedPage = 'channel';
  else if (cleanHash.includes('/browse') && !browseParam) detectedPage = 'home';
  else if (cleanHash === '' || cleanHash === '/') detectedPage = 'home';

  if (typeof window !== 'undefined') {
    if (detectedPage !== 'other') {
      window._lastDetectedPage = detectedPage;
      window._lastFullUrl = href;
      return detectedPage;
    }
    if (window._lastDetectedPage) {
      return window._lastDetectedPage;
    }
  }

  return detectedPage;
}

export function getCurrentPage() {
  return detectCurrentPage();
}
