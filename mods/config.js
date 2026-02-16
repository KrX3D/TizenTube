const CONFIG_KEY = 'ytaf-configuration';
const defaultConfig = {
  enableAdBlock: true,
  enableSponsorBlock: true,
  sponsorBlockManualSkips: ['intro', 'outro', 'filler'],
  enableSponsorBlockSponsor: true,
  enableSponsorBlockIntro: true,
  enableSponsorBlockOutro: true,
  enableSponsorBlockInteraction: true,
  enableSponsorBlockSelfPromo: true,
  enableSponsorBlockPreview: true,
  enableSponsorBlockMusicOfftopic: true,
  enableSponsorBlockFiller: false,
  enableSponsorBlockHighlight: true,
  videoSpeed: 1,
  preferredVideoQuality: 'auto',
  enableDeArrow: true,
  enableDeArrowThumbnails: false,
  focusContainerColor: '#0f0f0f',
  routeColor: '#0f0f0f',
  enableFixedUI: (window.h5vcc && window.h5vcc.tizentube) ? false : true,
  enableHqThumbnails: true,
  enableChapters: true,
  enableLongPress: true,
  enableShorts: false,
  dontCheckUpdateUntil: 0,
  enableWhoIsWatchingMenu: false,
  enableShowUserLanguage: true,
  enableShowOtherLanguages: false,
  showWelcomeToast: false,
  enablePreviousNextButtons: true,
  enableSuperThanksButton: false,
  enableSpeedControlsButton: true,
  enablePatchingVideoPlayer: true,
  enablePreviews: false,
  enableHideWatchedVideos: true,
  hideWatchedVideosThreshold: 10,
  hideWatchedVideosPages: [
      'home', 
      'music', 
      'gaming', 
      'subscriptions', 
      'channel',
      'library',
      'playlist',
      'history',
      'more',
      'watch'
  ],
  enablePlaylistContinueButton: true,
  enableHideEndScreenCards: false,
  enableYouThereRenderer: false,
  lastAnnouncementCheck: 0,
  enableScreenDimming: true,
  dimmingTimeout: 60,
  dimmingOpacity: 0.5,
  enablePaidPromotionOverlay: false,
  speedSettingsIncrement: 0.25,
  videoPreferredCodec: 'any',
  launchToOnStartup: null,
  disabledSidebarContents: ['TROPHY', 'NEWS', 'YOUTUBE_MUSIC', 'BROADCAST', 'CLAPPERBOARD', 'LIVE', 'GAMING', 'TAB_MORE'],
  enableUpdater: true,
  autoFrameRate: false,
  autoFrameRatePauseVideoFor: 0,
  enableDebugConsole: false,
  debugConsolePosition: 'bottom-right', // top-left, top-right, bottom-left, bottom-right, center
  debugConsoleHeight: '500',
};

let localConfig;

try {
  localConfig = JSON.parse(window.localStorage[CONFIG_KEY]);
} catch (err) {
  console.warn('Config read failed:', err);
  localConfig = defaultConfig;
}

export function configRead(key) {
  // Ignore null/undefined keys silently (they're used for menu structure)
  if (key === null || key === undefined) {
    return null;
  }
  
  if (localConfig[key] === undefined || localConfig[key] === null) {
    if (defaultConfig[key] !== undefined) {
      console.log('[CONFIG] Setting default for key:', key, '=', defaultConfig[key]);
      localConfig[key] = defaultConfig[key];
      try {
        window.localStorage[CONFIG_KEY] = JSON.stringify(localConfig);
      } catch (e) {
        console.error('[CONFIG] Failed to save default:', e);
      }
    } else {
      // Only warn for real config keys, not menu structure keys
      if (typeof key === 'string' && !key.startsWith('tt-')) {
        console.warn('[CONFIG] No default value for key:', key);
      }
      return undefined;
    }
  }

  return localConfig[key];
}

export function configWrite(key, value) {
  console.info('Setting key', key, 'to', value);
  localConfig[key] = value;
  window.localStorage[CONFIG_KEY] = JSON.stringify(localConfig);
  configChangeEmitter.dispatchEvent(new CustomEvent('configChange', { detail: { key, value } }));
}

export const configChangeEmitter = {
  listeners: {},
  addEventListener(type, callback) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(callback);
  },
  removeEventListener(type, callback) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter(cb => cb !== callback);
  },
  dispatchEvent(event) {
    const type = event.type;
    if (!this.listeners[type]) return;
    this.listeners[type].forEach(cb => {
      try {
        cb.call(this, event)
      } catch (_) {};
    });
  }
};

if (typeof window !== 'undefined') {
  window.configChangeEmitter = configChangeEmitter;
}
