import { configRead, configWrite } from '../config.js';
import { showModal, buttonItem, overlayPanelItemListRenderer, showToast } from './ytUI.js';
import { sendTestPing } from '../features/logServer.js';
import { showLogServerTestToast } from '../resolveCommand.js';
import { t } from 'i18next';

const interval = setInterval(() => {
    const videoElement = document.querySelector('video');
    if (videoElement) {
        execute_once_dom_loaded_speed();
        clearInterval(interval);
    }
}, 1000);

function execute_once_dom_loaded_speed() {
    document.querySelector('video').addEventListener('canplay', () => {
        document.getElementsByTagName('video')[0].playbackRate = configRead('videoSpeed');;
    });

    const eventHandler = (evt) => {
        if (evt.keyCode == 406 || evt.keyCode == 191) {
            evt.preventDefault();
            evt.stopPropagation();
            if (evt.type === 'keydown') {
                toggleLogServer();
                return false;
            }
            return true;
        };
    }

    // Red, Green, Yellow, Blue
    // 403, 404, 405, 406
    // ---, 172, 170, 191
    document.addEventListener('keydown', eventHandler, true);
}

// Blue used to open the playback-speed menu (speedSettings(), still defined
// below and still reachable from the native playback-settings popup — see
// resolveCommand.js's openPopupAction handling). Repurposed as a quick
// Remote Log Server toggle, since that's a debug workflow reached far more
// often than changing playback speed via the remote directly.
function toggleLogServer() {
    const next = !configRead('logServerEnabled');
    configWrite('logServerEnabled', next);

    if (!next) {
        showToast('TizenTube', t('settings.options.misc.options.logServer.disabled'));
        return;
    }

    showLogServerTestToast(sendTestPing());
}

function speedSettings() {
    const currentSpeed = configRead('videoSpeed');
    let selectedIndex = 0;
    const maxSpeed = 5;
    const increment = configRead('speedSettingsIncrement') || 0.25;
    const buttons = [];
    for (let speed = increment; speed <= maxSpeed; speed += increment) {
        const fixedSpeed = Math.round(speed * 100) / 100;
        buttons.push(
            buttonItem(
                { title: `${fixedSpeed}x` },
                null,
                [
                    {
                        signalAction: {
                            signal: 'POPUP_BACK'
                        }
                    },
                    {
                        setClientSettingEndpoint: {
                            settingDatas: [
                                {
                                    clientSettingEnum: {
                                        item: 'videoSpeed'
                                    },
                                    intValue: fixedSpeed.toString()
                                }
                            ]
                        }
                    },
                    {
                        customAction: {
                            action: 'SET_PLAYER_SPEED',
                            parameters: fixedSpeed.toString()
                        }
                    }
                ]
            )
        );
        if (currentSpeed === fixedSpeed) {
            selectedIndex = buttons.length - 1;
        }
    }

    buttons.push(
        buttonItem(
            { title: `Fix stuttering (1.0001x)` },
            null,
            [
                {
                    signalAction: {
                        signal: 'POPUP_BACK'
                    }
                },
                {
                    setClientSettingEndpoint: {
                        settingDatas: [
                            {
                                clientSettingEnum: {
                                    item: 'videoSpeed'
                                },
                                intValue: '1.0001'
                            }
                        ]
                    }
                },
                {
                    customAction: {
                        action: 'SET_PLAYER_SPEED',
                        parameters: '1.0001'
                    }
                }
            ]
        )
    );

    showModal(t('player.playbackSpeed.title'), overlayPanelItemListRenderer(buttons, selectedIndex), 'tt-speed');
}

export {
    speedSettings
}