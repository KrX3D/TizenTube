const CONFIG_KEY = 'ytaf-configuration';
const defaultConfig = {
  enableAdBlock: true,
  enableSponsorBlock: true,
  enableSponsorBlockToasts: true,
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
  longPressMenuOrder: [],
  longPressMenuHidden: [],
  longPressShowPlaylists: false,
  hiddenChannels: [],
  longPressPlaylistIds: [],
  longPressPlaylistOrder: [],
  enableShorts: false,
  dontCheckUpdateUntil: 0,
  enableWhoIsWatchingMenu: false,
  permanentlyEnableWhoIsWatchingMenu: false,
  enableWhosWatchingMenuOnAppExit: false,
  enableShowUserLanguage: true,
  enableShowOtherLanguages: false,
  enableCaptionStylePersistence: true,
  captionStyleSettings: null,
  captionsEnabled: null,
  captionsOnCommand: null,
  captionRawKeyBackups: {},
  showWelcomeToast: false,
  enablePreviousNextButtons: false,
  enableSuperThanksButton: false,
  enableAIAskButton: false,
  enableSpeedControlsButton: true,
  enablePatchingVideoPlayer: true,
  enableMPButton: true,
  enableSwapMPWithPIP: false,
  // Buttons removed from the action row under the player.
  hidePlayerJoinButton: false,
  hidePlayerSubscribeButton: false,
  hidePlayerLikeButton: false,
  hidePlayerDislikeButton: false,
  hidePlayerSaveButton: false,
  hidePlayerCommentsButton: false,
  hidePlayerAboutButton: false,
  hidePlayerPreviousButton: false,
  hidePlayerNextButton: false,
  enablePreviews: false,
  enableHideWatchedVideos: true,
  hideWatchedVideosThreshold: 5,
  hideWatchedVideosPages: [
      'home',
      'search',
      'music',
      'gaming',
      'subscriptions',
      'channel',
      'playlist',
      'more',
      'watch'
  ],
  hiddenLibraryTabIds: ['festorefront', 'fecollection_podcasts', 'femy_videos', 'fehistory', 'femy_youtube', 'feplaylist_aggregation', 'femusic_last_played'],
  hiddenSpecialPlaylistShelves: ['WL', 'LL'],
  hiddenSpecialPlaylistTiles: ['WL', 'LL'],
  enableHideEndScreenCards: false,
  enableYouThereRenderer: false,
  lastAnnouncementCheck: 0,
  enableScreenDimming: false,
  dimmingTimeout: 60,
  dimmingOpacity: 0.5,
  enablePaidPromotionOverlay: false,
  speedSettingsIncrement: 0.25,
  preferredVideoCodec: 'any',
  launchToOnStartup: null,
  reloadHomeOnStartup: true,
  disabledSidebarContents: ['TROPHY', 'NEWS', 'YOUTUBE_MUSIC', 'BROADCAST', 'CLAPPERBOARD', 'LIVE', 'GAMING', 'TAB_MORE', 'SEARCH'],
  sidebarContentsOrder: [],
  disableChannelsOnSidebar: false,
  enableUpdater: true,
  autoFrameRate: false,
  autoFrameRatePauseVideoFor: 0,
  enableSigninReminder: false,
  sortSubscriptionsByAlphabet: false,
  enableDebugConsole: false,
  enableDebugLogging: false,
  debugConsolePosition: 'top-left',
  debugConsoleHeight: 1054,
  logServerEnabled: false,
  diagSubscriptionsShelf: false,
  // Every category on by default, so upgrading changes nothing until the
  // user narrows it down. 'basic' vs 'detailed' controls payload depth.
  logCategories: ['nav', 'ads', 'shorts', 'watched', 'playlist', 'filters', 'shelves', 'thumbs', 'player', 'other'],
  logVerbosity: 'detailed',
  // syslog output, independent of the log server above.
  syslogEnabled: false,
  syslogHost: '',
  syslogPort: 514,
  syslogFacility: 16,
  syslogAppName: 'TizenTube',
  syslogHostname: '',
  // Intentionally blank: this used to ship one developer's LAN address, so
  // every install pointed its logs at a machine that is not the user's.
  // Empty means "not set", which the settings menu already renders, and
  // sendOne() treats as nothing to send.
  logServerHost: '',
  logServerPort: 3030,
  enablePlaylistBatchCollect: false,
  playlistBatchCollectMaxBatches: 50,
  enableClock: false,
  isClock12HourFormat: false,
  clockShowSeconds: false,
  clockHideWhenVideoPlaying: false,
  disableEnlargingThumbnails: false,
  enableShrinkingThumbnails: false,
  enableKeywordHider: false,
  // Empty means the built-in list in features/keywordHider.js, which is
  // where it lives so that an upgrade reaches a config that already has an
  // empty list written into it. Anything set here is taken as deliberate.
  hiddenTitleKeywords: [],
  hideMembersOnlyVideos: false,
  hideViewCounts: false,
  hideQualityBadges: false,
  hidePaidVideos: false,
  hideFreeWithAdsVideos: false,
  hideDuplicateVideos: false,
  hideAggregateShelf: false,
  hideChannelShelves: false,
  hideMusicShelf: false,
  hideSurveys: false,
  enableJumpToPercentage: false,
  hideRelatedVideosPlayer: false,
  spoofViewport: 'disabled',
  enableReloadOnResume: false,
  enableRemainingTime: false,
  enableFinishTime: false,
};

/**
 * Keys that must not travel to another TV.
 *
 * Settings transfer copies the config from one TV to another, which only
 * makes sense for what you chose. These are either tied to the machine, to
 * the moment, or are state rather than a setting, and copying them would be
 * at best pointless and at worst wrong — spoofViewport is the clearest case,
 * since two TVs with different panels want different answers.
 *
 * Declared beside the defaults on purpose: a new key should be classified
 * where it is born, not somewhere a later reader has to go looking for.
 */
export const NON_TRANSFERABLE_KEYS = [
    // Tied to this screen.
    'spoofViewport',
    // Tied to this network, or to a receiver only this TV can reach.
    'logServerHost', 'logServerPort',
    'syslogHost', 'syslogPort', 'syslogHostname', 'syslogAppName', 'syslogFacility',
    // State, not settings: carried across restarts for this TV alone.
    'dontCheckUpdateUntil', 'lastAnnouncementCheck',
    'captionStyleSettings', 'captionsEnabled', 'captionsOnCommand', 'captionRawKeyBackups',
    // Diagnostics that are deliberately off at every start anyway.
    'enableDebugConsole', 'enableDebugLogging', 'logServerEnabled', 'syslogEnabled', 'diagSubscriptionsShelf',
];

/** The config, as stored. Used by settings transfer; nothing else should write it. */
export function configAll() {
    return { ...localConfig };
}

export function configDefault(key) {
    return Object.prototype.hasOwnProperty.call(defaultConfig, key) ? defaultConfig[key] : undefined;
}

/** Every key this build knows, so a payload cannot introduce unknown ones. */
export function configKnownKeys() {
    return Object.keys(defaultConfig);
}

let localConfig;
const populatedConfigWarnings = new Set();

try {
  const raw = window.localStorage[CONFIG_KEY];
  if (raw === undefined || raw === null || raw === '' || raw === 'undefined') {
    localConfig = { ...defaultConfig };
  } else {
    localConfig = JSON.parse(raw);
  }
} catch (err) {
  console.warn('Config read failed:', err);
  localConfig = { ...defaultConfig };
}

if (!localConfig || typeof localConfig !== 'object') {
  localConfig = { ...defaultConfig };
}

// The visual debug console (and the logging that feeds it) must always
// start off/hidden, regardless of what was last saved — confirmed
// on-device: leaving it enabled across a restart (e.g. after being turned
// on once to diagnose something) is suspected of contributing to the app
// hanging on startup. Overridden in memory only (not written back to
// storage), so re-enabling it from Settings during a session still works
// exactly as before — it just won't carry over to the next app start.
localConfig.enableDebugConsole = false;
localConfig.enableDebugLogging = false;
// Same reasoning applies to logServerEnabled: now that it alone triggers
// console.* interception work (see visualConsole.js addLog), leaving it on
// from a previous session means every console call pays that cost right
// during YouTube's own page bootstrap — the highest-load moment — without
// the user having deliberately turned it on for this session.
localConfig.logServerEnabled = false;

export function configRead(key) {
  if (localConfig[key] === undefined) {
    const hasDefault = Object.prototype.hasOwnProperty.call(defaultConfig, key);
    localConfig[key] = hasDefault ? defaultConfig[key] : undefined;
    if (hasDefault && !populatedConfigWarnings.has(key)) {
      populatedConfigWarnings.add(key);
      console.warn('Populating key', key, 'with default value', defaultConfig[key]);
    }
  }
  return localConfig[key];
}

export function configWrite(key, value) {
  console.info('Setting key', key, 'to', value);
  if (value === undefined) {
    delete localConfig[key];
  } else {
    localConfig[key] = value;
  }
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
