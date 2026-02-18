import resolveCommand from "./resolveCommand.js";
import appPkg from "../package.json";
const APP_VERSION = appPkg.version;
const APP_VERSION_LABEL = `v${APP_VERSION.split('.').pop()}`;

import { configWrite } from "./config.js";

import { initVisualConsole } from "./main/features/visualConsole.js";

initVisualConsole({
  APP_VERSION,
  APP_VERSION_LABEL,
  resolveCommand,
  configWrite
});

import "./main/userAgentSpoofing.js";
import "whatwg-fetch";
import 'core-js/proposals/object-getownpropertydescriptors';
import '@formatjs/intl-getcanonicallocales/polyfill.iife'
import '@formatjs/intl-locale/polyfill.iife'
import '@formatjs/intl-displaynames/polyfill.iife'
import '@formatjs/intl-displaynames/locale-data/en';

import "./domrect-polyfill";
import "./main/features/responsePatches.js";
import "./main/features/sponsorblock.js";
import "./ui/ui.js";
import "./ui/speedUI.js";
import "./ui/theme.js";
import "./ui/settings.js";
import "./ui/disableWhosWatching.js";
import "./main/features/moreSubtitles.js";
import "./main/updater.js";
import "./main/features/pictureInPicture.js";
import "./main/features/preferredVideoQuality.js";
import "./main/features/videoQueuing.js";
import "./main/features/enableFeatures.js";
import "./ui/customUI.js";
import "./ui/customGuideAction.js";
import "./main/features/autoFrameRate.js";
import "./main/features/playlistEnhancements.js";
