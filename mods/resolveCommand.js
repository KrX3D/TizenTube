import { configWrite, configRead } from './config.js';
import { enablePip } from './features/pictureInPicture.js';
import modernUI, { optionShow } from './ui/settings.js';
import { speedSettings } from './ui/speedUI.js';
import { showToast, buttonItem } from './ui/ytUI.js';
import checkForUpdates from './features/updater.js';

export default function resolveCommand(cmd, _) {
    for (const key in window._yttv) {
        if (window._yttv[key] && window._yttv[key].instance && window._yttv[key].instance.resolveCommand) {
            return window._yttv[key].instance.resolveCommand(cmd, _);
        }
    }
}

export function findFunction(funcName) {
    for (const key in window._yttv) {
        if (window._yttv[key] && window._yttv[key][funcName] && typeof window._yttv[key][funcName] === 'function') {
            return window._yttv[key][funcName];
        }
    }
}

export function patchResolveCommand() {
    for (const key in window._yttv) {
        if (window._yttv[key] && window._yttv[key].instance && window._yttv[key].instance.resolveCommand) {

            const ogResolve = window._yttv[key].instance.resolveCommand;
            window._yttv[key].instance.resolveCommand = function (cmd, _) {
                if (cmd.setClientSettingEndpoint) {
                    for (const settings of cmd.setClientSettingEndpoint.settingDatas) {
                        if (!settings.clientSettingEnum.item.includes('_')) {
                            for (const setting of cmd.setClientSettingEndpoint.settingDatas) {
                                const valName = Object.keys(setting).find(key => key.includes('Value'));
                                const value = valName === 'intValue' ? Number(setting[valName]) : setting[valName];
                                if (valName === 'arrayValue') {
                                    const arr = configRead(setting.clientSettingEnum.item);
                                    if (arr.includes(value)) {
                                        arr.splice(arr.indexOf(value), 1);
                                    } else {
                                        arr.push(value);
                                    }
                                    configWrite(setting.clientSettingEnum.item, arr);
                                } else configWrite(setting.clientSettingEnum.item, value);
                            }
                        } else if (settings.clientSettingEnum.item === 'I18N_LANGUAGE') {
                            const lang = settings.stringValue;
                            const date = new Date();
                            date.setFullYear(date.getFullYear() + 10);
                            document.cookie = `PREF=hl=${lang}; expires=${date.toUTCString()};`;
                            resolveCommand({
                                signalAction: {
                                    signal: 'RELOAD_PAGE'
                                }
                            });
                            return true;
                        }
                    }
                } else if (cmd.customAction) {
                    customAction(cmd.customAction.action, cmd.customAction.parameters);
                    return true;
                } else if (cmd?.signalAction?.customAction) {
                    customAction(cmd.signalAction.customAction.action, cmd.signalAction.customAction.parameters);
                    return true;
                } else if (cmd?.showEngagementPanelEndpoint?.customAction) {
                    customAction(cmd.showEngagementPanelEndpoint.customAction.action, cmd.showEngagementPanelEndpoint.customAction.parameters);
                    return true;
                } else if (cmd?.playlistEditEndpoint?.customAction) {
                    customAction(cmd.playlistEditEndpoint.customAction.action, cmd.playlistEditEndpoint.customAction.parameters);
                    return true;
                } else if (cmd?.openPopupAction?.uniqueId === 'playback-settings') {
                    const items = cmd.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer.content.overlayPanelItemListRenderer.items;
                    for (const item of items) {
                        if (item?.compactLinkRenderer?.icon?.iconType === 'SLOW_MOTION_VIDEO') {
                            item.compactLinkRenderer.subtitle && (item.compactLinkRenderer.subtitle.simpleText = 'with TizenTube');
                            item.compactLinkRenderer.serviceEndpoint = {
                                clickTrackingParams: "null",
                                signalAction: {
                                    customAction: {
                                        action: 'TT_SPEED_SETTINGS_SHOW',
                                        parameters: []
                                    }
                                }
                            };
                        }
                    }

                    cmd.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer.content.overlayPanelItemListRenderer.items.splice(2, 0,
                        buttonItem(
                            { title: 'Mini Player' },
                            { icon: 'CLEAR_COOKIES' }, [
                            {
                                customAction: {
                                    action: 'ENTER_PIP'
                                }
                            }
                        ])
                    );
                } else if (cmd?.watchEndpoint?.videoId) {
                    window.isPipPlaying = false;
                    const ytlrPlayerContainer = document.querySelector('ytlr-player-container');
                    ytlrPlayerContainer.style.removeProperty('z-index');
                }

                return ogResolve.call(this, cmd, _);
            }
        }
    }
}

function customAction(action, parameters) {
    switch (action) {
        case 'SETTINGS_UPDATE':
            modernUI(true, parameters);
            break;
        case 'OPTIONS_SHOW':
            optionShow(parameters, parameters.update);
            break;
        case 'SKIP':
            const kE = document.createEvent('Event');
            kE.initEvent('keydown', true, true);
            kE.keyCode = 27;
            kE.which = 27;
            document.dispatchEvent(kE);

            document.querySelector('video').currentTime = parameters.time;
            break;
        case 'TT_SETTINGS_SHOW':
            modernUI();
            break;
        case 'TT_SPEED_SETTINGS_SHOW':
            speedSettings();
            break;
        case 'UPDATE_REMIND_LATER':
            configWrite('dontCheckUpdateUntil', parameters);
            break;
        case 'UPDATE_DOWNLOAD':
            window.h5vcc.tizentube.InstallAppFromURL(parameters);
            showToast('TizenTube Update', 'Downloading update, please wait...');
            break;
        case 'SET_PLAYER_SPEED':
            const speed = Number(parameters);
            document.querySelector('video').playbackRate = speed;
            break;
        case 'ENTER_PIP':
            enablePip();
            break;
        case 'SHOW_TOAST':
            showToast('TizenTube', parameters);
            break;
        case 'ADD_TO_QUEUE':
            window.queuedVideos.videos.push(parameters);
            showToast('TizenTube', 'Video added to queue.');
            break;
        case 'CLEAR_QUEUE':
            window.queuedVideos.videos = [];
            showToast('TizenTube', 'Video queue cleared.');
            break;
        case 'CHECK_FOR_UPDATES':
            checkForUpdates(true);
            break;
        case 'TOGGLE_DEBUG_CONSOLE':
            if (typeof window.toggleDebugConsole === 'function') {
                window.toggleDebugConsole();
                showToast('Debug Console', 'Console ' + (configRead('enableDebugConsole') ? 'shown' : 'hidden'));
            } else {
                showToast('Debug Console', 'Console not available');
            }
            break;
        case 'FORCE_SHOW_CONSOLE':
            console.log('========================================');
            console.log('FORCE SHOW CONSOLE TEST');
            console.log('========================================');
            console.log('If you see this, the console is working!');
            console.log('Time:', new Date().toISOString());
            console.error('This is an ERROR message');
            console.warn('This is a WARN message');
            
            // Try to find the console div
            const consoleDiv = document.getElementById('tv-debug-console');
            if (consoleDiv) {
                consoleDiv.style.display = 'block';
                consoleDiv.style.zIndex = '999999';
                console.log('✓ Console DIV found and forced visible');
                showToast('Console', 'Console should be visible now');
            } else {
                console.error('✗ Console DIV not found!');
                showToast('Console', 'ERROR: Console DIV not found');
            }
            break;
        case 'TEST_SYSLOG_CONNECTION':
            console.log('╔═══════════════════════════════════════════════════════════╗');
            console.log('║          TEST_SYSLOG_CONNECTION TRIGGERED                 ║');
            console.log('╚═══════════════════════════════════════════════════════════╝');
            
            // Immediate feedback
            showToast('Syslog Test', '🔄 Starting test...');
            
            console.log('[TEST] Step 1: Showing initial toast');
            
            // Try to import logger
            console.log('[TEST] Step 2: Attempting to import logger module');
            
            import('./utils/logger.js')
                .then(module => {
                    console.log('[TEST] Step 3: Logger module imported successfully');
                    console.log('[TEST] Module:', module);
                    
                    const logger = module.default;
                    
                    if (!logger) {
                        console.error('[TEST] ✗ Logger is undefined!');
                        showToast('Syslog Test', '✗ Logger not found');
                        return;
                    }
                    
                    console.log('[TEST] Step 4: Logger instance obtained');
                    console.log('[TEST] Logger:', logger);
                    
                    // Get current status
                    const status = logger.getStatus();
                    console.log('[TEST] Step 5: Logger status:', status);
                    
                    showToast('Syslog Test', '🔄 Connecting...');
                    
                    // Call testConnection
                    console.log('[TEST] Step 6: Calling logger.testConnection()');
                    
                    logger.testConnection()
                        .then(result => {
                            console.log('[TEST] Step 7: testConnection() returned');
                            console.log('[TEST] Result:', result);
                            console.log('[TEST] Result type:', typeof result);
                            console.log('[TEST] Result keys:', Object.keys(result || {}));
                            
                            if (!result) {
                                console.error('[TEST] ✗ Result is null/undefined');
                                showToast('Syslog Test', '✗ No response from test');
                                return;
                            }
                            
                            if (result.success) {
                                console.log('[TEST] ✓ Test reported SUCCESS');
                                const msg = result.message || 'Success! Check PC terminal.';
                                showToast('Syslog Test', '✓ ' + msg);
                            } else {
                                console.error('[TEST] ✗ Test reported FAILURE');
                                const err = result.error || 'Unknown error';
                                const errType = result.errorType || '';
                                console.error('[TEST] Error:', err);
                                console.error('[TEST] Error type:', errType);
                                console.error('[TEST] URL:', result.url);
                                showToast('Syslog Test', '✗ Failed: ' + err);
                            }
                        })
                        .catch(err => {
                            console.log('[TEST] ═══════════════════════════════════════');
                            console.error('[TEST] ✗ testConnection() threw an error');
                            console.log('[TEST] ═══════════════════════════════════════');
                            console.error('[TEST] Error:', err);
                            console.error('[TEST] Error name:', err.name);
                            console.error('[TEST] Error message:', err.message);
                            console.error('[TEST] Error stack:', err.stack);
                            showToast('Syslog Test', '✗ Error: ' + err.message);
                        });
                })
                .catch(err => {
                    console.log('[TEST] ═══════════════════════════════════════');
                    console.error('[TEST] ✗ Failed to import logger module');
                    console.log('[TEST] ═══════════════════════════════════════');
                    console.error('[TEST] Import error:', err);
                    console.error('[TEST] Error name:', err.name);
                    console.error('[TEST] Error message:', err.message);
                    console.error('[TEST] Error stack:', err.stack);
                    showToast('Syslog Test', '✗ Failed to load logger');
                });
            
            console.log('[TEST] Step 8: Import chain started, waiting for async completion');
            break;
    }
}