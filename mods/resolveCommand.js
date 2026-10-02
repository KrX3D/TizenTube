import { configWrite, configRead } from './config.js';
import { enablePip } from './features/pictureInPicture.js';
import modernUI, { optionShow } from './ui/settings.js';
import { speedSettings } from './ui/speedUI.js';
import { showToast, buttonItem } from './ui/ytUI.js';
import checkForUpdates from './features/updater.js';
import { playlistContinue } from './features/playlistContinue.js';
import { sendTestPing } from './features/logServer.js';
import { showNumericEditor, saveNumericEditor, cancelNumericEditor } from './ui/numericEditor.js';
import { sendSyslogTest } from './features/syslog.js';
import { screenOff } from './features/screenOff.js';
import { shareCurrentVideo, shareVideo } from './features/qrShare.js';
import { requestNextAndNavigateChannel, getFeedbackPanelTokens, sendFeedbackToken } from './utils/innerTubeCalls.js';
import showGuideSettings from './ui/sidebarModification.js';
import showLongPressMenuSettings from './ui/longPressMenuSettings.js';
import { lockupVideoId } from './features/lockupViewModel.js';
import { appendFileOnlyLog } from './features/hideWatched.js';
import { t } from 'i18next';


export default function resolveCommand(cmd, _) {
    // resolveCommand function is pretty OP, it can do from opening modals, changing client settings and way more.
    // Because the client might change, we should find it first.

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

// Shared with speedUI.js's blue-button remote-log toggle, so both the
// settings-menu "Test Log Server Connection" button and the shortcut show
// the same wording for the same outcome.
export function showLogServerTestToast(result) {
    // The test now sends whether or not remote logging is enabled, so a
    // disabled state is no longer a refusal — it just means the ping went out
    // while ongoing logging stays off. Reported as its own message rather than
    // the old "enable it first", which made the button useless for its main
    // job: confirming the host and port before switching logging on.
    if (!result.queued) {
        showToast('TizenTube', t('settings.options.misc.options.logServer.testFailed'));
    } else if (result.enabled) {
        showToast('TizenTube', t('settings.options.misc.options.logServer.testQueued'));
    } else {
        showToast('TizenTube', t('settings.options.misc.options.logServer.testSentButOff'));
    }
}

// Patch resolveCommand to be able to change TizenTube settings

// NOTE: mods/features/captionStylePersistence.js also independently wraps
// window._yttv[key].instance.resolveCommand (its own #patchResolveCommand,
// polling until _yttv is populated, with its own isPatchedByCaptionPersistence
// flag). Both wrappers currently compose correctly regardless of which one
// patches first (each calls through to whatever it captured as "original"),
// but there's no shared coordination between them — an early return added to
// either wrapper in the future could silently swallow calls before the
// other's logic ever runs. Keep that in mind before changing either one.
export function patchResolveCommand() {
    for (const key in window._yttv) {
        if (window._yttv[key] && window._yttv[key].instance && window._yttv[key].instance.resolveCommand) {

            const ogResolve = window._yttv[key].instance.resolveCommand;
            window._yttv[key].instance.resolveCommand = function (cmd, _) {
                if (cmd.setClientSettingEndpoint) {
                    // Command to change client settings. Use TizenTube configuration to change settings.
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

                                // Auto-verify the connection the moment Remote
                                // Logging gets turned on from the settings menu,
                                // instead of requiring a separate trip to the
                                // "Test Log Server Connection" button.
                                if (setting.clientSettingEnum.item === 'logServerEnabled' && value === true) {
                                    showLogServerTestToast(sendTestPing());
                                }
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
                    // Patch the playback settings popup to use TizenTube speed settings
                    const items = cmd.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer.content.overlayPanelItemListRenderer.items;
                    for (const item of items) {
                        if (item?.compactLinkRenderer?.icon?.iconType === 'SLOW_MOTION_VIDEO') {
                            item.compactLinkRenderer.subtitle && (item.compactLinkRenderer.subtitle.simpleText = t('player.withTizenTube'));
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
                            { title: t('player.miniPlayer') },
                            { icon: 'CLEAR_COOKIES' }, [
                            {
                                customAction: {
                                    action: 'ENTER_MP'
                                }
                            }
                        ])
                    );
                    // Screen off (upstream 8977e23). Also splices at 3, so when PiP is
                    // available it inserts at 3 afterwards and ends up above this one.
                    cmd.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer.content.overlayPanelItemListRenderer.items.splice(3, 0,
                        buttonItem(
                            { title: t('player.screenOff') },
                            { icon: 'EYE_OFF' }, [
                            {
                                customAction: {
                                    action: 'SCREEN_OFF'
                                }
                            }
                        ])
                    );
                    // Share as QR code (upstream 3aa3039). Splices at 3 as well, so
                    // it lands directly above Screen off.
                    cmd.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer.content.overlayPanelItemListRenderer.items.splice(3, 0,
                        buttonItem(
                            { title: t('player.share.button') },
                            { icon: 'OPEN_IN_NEW' }, [
                            {
                                customAction: {
                                    action: 'SHARE'
                                }
                            }
                        ])
                    );

                    if (window.h5vcc && window.h5vcc.tizentube && window.h5vcc.tizentube.HasSystemFeature &&
                        window.h5vcc.tizentube.HasSystemFeature('android.software.picture_in_picture')) {
                        cmd.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer.content.overlayPanelItemListRenderer.items.splice(3, 0,
                            buttonItem(
                                { title: t('player.pictureInPicture') },
                                { icon: 'TV' }, [
                                {
                                    customAction: {
                                        action: 'ENTER_PIP'
                                    }
                                },
                                {
                                    signalAction: {
                                        signal: 'POPUP_BACK'
                                    }
                                }
                            ])
                        );
                    }
                } else if (cmd?.watchEndpoint?.videoId) {
                    // Basic-tier navigation trail: which video was opened, and
                    // from where. Page changes are already covered by
                    // page.store in hideWatched.js.
                    appendFileOnlyLog('nav.video.open', {
                        videoId: cmd.watchEndpoint.videoId,
                        page: window.__ttLastDetectedPage || null,
                        playlistId: cmd.watchEndpoint.playlistId || null,
                    });
                    window.isPipPlaying = false;
                    const ytlrPlayerContainer = document.querySelector('ytlr-player-container');
                    ytlrPlayerContainer.style.removeProperty('z-index');
                }

                if (cmd.customAction) return window._yttv[key].instance.resolveCommand(cmd, _);

                if (cmd.commandExecutorCommand && cmd.commandExecutorCommand.commands) {
                    for (const command of cmd.commandExecutorCommand.commands) {
                        if (command.customAction) {
                            customAction(command.customAction.action, command.customAction.parameters);
                        } else if (command.signalAction?.customAction) {
                            customAction(command.signalAction.customAction.action, command.signalAction.customAction.parameters);
                        } else if (command.showEngagementPanelEndpoint?.customAction) {
                            customAction(command.showEngagementPanelEndpoint.customAction.action, command.showEngagementPanelEndpoint.customAction.parameters);
                        } else if (command.playlistEditEndpoint?.customAction) {
                            customAction(command.playlistEditEndpoint.customAction.action, command.playlistEditEndpoint.customAction.parameters);
                        } else {
                            window._yttv[key].instance.resolveCommand(command, _);
                        }
                    }
                    return true;
                }

                if (cmd?.requestAccountSelectorCommand
                    && cmd.requestAccountSelectorCommand?.identityActionContext?.eventTrigger === 'ACCOUNT_EVENT_TRIGGER_ON_EXIT') {
                    if (!configRead('enableWhosWatchingMenuOnAppExit')) {
                        ogResolve.call(this, {
                            signalAction: {
                                signal: 'EXIT_APP'
                            }
                        });
                        return false;
                    }
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
            showToast('TizenTube Update', t('toasts.downloadingUpdate'));
            break;
        case 'SET_PLAYER_SPEED':
            const speed = Number(parameters);
            document.querySelector('video').playbackRate = speed;
            break;
        case 'SCREEN_OFF':
            screenOff();
            break;
        case 'ENTER_MP':
            enablePip();
            break;
        case 'ENTER_PIP':
            window.h5vcc.tizentube.EnterPIP();
            break;
        case 'SHOW_TOAST':
            showToast('TizenTube', parameters);
            break;
        case 'ADD_TO_QUEUE':
            window.queuedVideos.videos.push(parameters);
            showToast('TizenTube', t('toasts.videoAddedToQueue'));
            break;
        case 'PLAY_NEXT':
            playNext(parameters);
            break;
        case 'CLEAR_QUEUE':
            window.queuedVideos.videos = [];
            showToast('TizenTube', t('toasts.videoQueueCleared'));
            break;
        case 'CHECK_FOR_UPDATES':
            checkForUpdates(true);
            break;
        case 'PLAYLIST_CONTINUE':
            playlistContinue(resolveCommand, showToast);
            break;
        case 'SHARE':
            shareCurrentVideo();
            break;
        case 'NOT_INTERESTED':
            markFeedback(parameters, 0, false);
            break;
        case 'DONT_RECOMMEND_CHANNEL':
            markFeedback(parameters, 1, true);
            break;
        case 'FEEDBACK_REASON':
            sendFeedbackToken(parameters.token)
                .then(() => {
                    resolveCommand({ signalAction: { signal: 'POPUP_BACK' } });
                    showToast('TizenTube', t('toasts.feedbackSent'));
                })
                .catch((err) => {
                    console.warn('TizenTube: failed to send feedback:', err);
                    showToast('TizenTube', t('toasts.feedbackFailed'));
                });
            break;
        case 'SHARE_VIDEO':
            shareVideo(parameters?.videoId);
            break;
        case 'GO_TO_CHANNEL':
            requestNextAndNavigateChannel(parameters);
            break;
        case 'SHOW_LONGPRESS_MENU_SETTINGS':
            showLongPressMenuSettings(parameters);
            break;
        case 'SHOW_LONGPRESS_MOVE':
            showLongPressMenuSettings('SHOW_LONGPRESS_MOVE', parameters);
            break;
        case 'MOVE_LONGPRESS_ENTRY':
            showLongPressMenuSettings('MOVE_LONGPRESS_ENTRY', parameters);
            break;
        case 'TOGGLE_LONGPRESS_ENTRY':
            showLongPressMenuSettings('TOGGLE_LONGPRESS_ENTRY', parameters);
            break;
        case 'SHOW_GUIDE_SETTINGS':
            showGuideSettings(parameters);
            break;
        case 'SHOW_GUIDE_BUTTONS':
            showGuideSettings('SHOW_GUIDE_BUTTONS', parameters);
            break;
        case 'MOVE_GUIDE_BUTTON':
            showGuideSettings('MOVE_GUIDE_BUTTON', parameters);
            break;
        case 'TOGGLE_GUIDE_ENTRY':
            showGuideSettings('TOGGLE_GUIDE_ENTRY', parameters);
            break;
        case 'RELOAD_GUIDE_OPTIONS':
            showGuideSettings(parameters.settingType, true);
            break;
        case 'ADD_OR_REMOVE_CHANNEL_TO_SIDEBAR': {
            const sidebarOrder = configRead('sidebarContentsOrder') || [];
            const existing = sidebarOrder.findIndex(entry =>
                (typeof entry === 'object' && entry !== null ? entry.browseId : entry) === parameters.browseId);
            if (existing !== -1) {
                sidebarOrder.splice(existing, 1);
            } else {
                sidebarOrder.push({ browseId: parameters.browseId, title: parameters.title });
            }
            configWrite('sidebarContentsOrder', sidebarOrder);
            showToast(t('toasts.sidebarContentsUpdated.title'), t('toasts.sidebarContentsUpdated.subtitle'));
            break;
        }
        case 'NUMERIC_EDITOR_SHOW':
            showNumericEditor(parameters);
            break;
        case 'NUMERIC_EDITOR_SAVE':
            saveNumericEditor();
            break;
        case 'NUMERIC_EDITOR_CANCEL':
            cancelNumericEditor();
            break;
        case 'SYSLOG_TEST': {
            const result = sendSyslogTest();
            // Mirrors the log server's test: a disabled output is no longer a
            // refusal, so the outcomes are no-host, failed, sent, and
            // sent-while-output-is-off.
            if (result.noHost) showToast('TizenTube', t('settings.options.misc.options.syslog.testNoHost'));
            else if (!result.queued) showToast('TizenTube', t('settings.options.misc.options.syslog.testFailed'));
            else if (result.enabled) showToast('TizenTube', t('settings.options.misc.options.syslog.testQueued'));
            else showToast('TizenTube', t('settings.options.misc.options.syslog.testSentButOff'));
            break;
        }
        case 'LOG_SERVER_TEST_PING': {
            showLogServerTestToast(sendTestPing());
            break;
        }
    }
}

// "Not interested" and "Don't recommend channel" (upstream 137ab52d, itself a
// port of the SmartTube fix). The tokens are no longer in the long press menu;
// the entry carries an engagement panel reference, the panel is fetched here,
// and its token is what gets sent. Token order: [0] not interested,
// [1] don't recommend channel.
//
// "Don't recommend channel" may come back with a follow-up asking why; those
// reasons are shown as a modal and the chosen one is sent as FEEDBACK_REASON.
async function markFeedback(parameters, tokenIndex, showReasons) {
    try {
        const tokens = await getFeedbackPanelTokens(parameters.panelId, parameters.params);
        const token = tokens[tokenIndex];
        if (!token) {
            showToast('TizenTube', t('toasts.feedbackFailed'));
            return;
        }

        const response = await sendFeedbackToken(token);
        if (!showReasons) {
            showToast('TizenTube', t('toasts.feedbackSent'));
            return;
        }

        const dismissal = response?.feedbackResponses?.[0]?.followUpDialog?.dismissalFollowUpRenderer;
        const reasons = dismissal?.reasons;
        if (!Array.isArray(reasons) || !reasons.length) {
            showToast('TizenTube', t('toasts.feedbackSent'));
            return;
        }

        const buttons = reasons.map((reason) => buttonItem(
            { title: extractFeedbackText(reason.title) },
            null,
            [
                { signalAction: { signal: 'POPUP_BACK' } },
                { customAction: { action: 'FEEDBACK_REASON', parameters: { token: reason.token } } }
            ]
        ));
        showModal(extractFeedbackText(dismissal.dismissalReasonsPrompt), overlayPanelItemListRenderer(buttons), 'tt-feedback-reasons');
    } catch (err) {
        console.warn('TizenTube: failed to mark feedback:', err);
        showToast('TizenTube', t('toasts.feedbackFailed'));
    }
}

// Panel text arrives as simpleText, runs or a plain content string depending on
// which renderer YouTube used.
function extractFeedbackText(text) {
    if (!text) return '';
    if (text.simpleText) return text.simpleText;
    if (text.content) return text.content;
    if (Array.isArray(text.runs)) return text.runs.map((run) => run?.text ?? '').join('');
    return String(text);
}

// Put one video next in the queue.
//
// Not the front of the list: the queue plays the entry AFTER the one currently
// playing (see videoQueuing.js), so inserting at the front would only play next
// when nothing from the queue is playing — which is also exactly when the front
// IS next, so both cases are covered by anchoring on the current video.
function playNext(item) {
    try {
        const queue = window.queuedVideos?.videos;
        if (!Array.isArray(queue)) return;
        const idOf = (v) => v?.tileRenderer?.contentId || lockupVideoId(v) || null;
        const id = idOf(item);

        // Queue it once. A second copy would also confuse the queue, which
        // finds the playing video by the FIRST match.
        const existing = id ? queue.findIndex((v) => idOf(v) === id) : -1;
        if (existing !== -1) queue.splice(existing, 1);

        const playing = (() => {
            try { return document.querySelector('.html5-video-player')?.getVideoData?.()?.video_id || null; } catch (_) { return null; }
        })() || window.queuedVideos.lastVideoId || null;
        const anchor = playing ? queue.findIndex((v) => idOf(v) === playing) : -1;
        queue.splice(anchor === -1 ? 0 : anchor + 1, 0, item);
        showToast('TizenTube', t('toasts.videoPlaysNext'));
    } catch (err) {
        console.warn('TizenTube: could not queue the video next:', err);
    }
}
