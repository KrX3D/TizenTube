import { configRead } from '../config.js';
import { showModal, buttonItem, overlayPanelItemListRenderer } from './ytUI.js';

const BLUE_KEY_CODES = new Set([406, 191, 115]);

function isBlueKey(evt) {
    if (BLUE_KEY_CODES.has(evt?.keyCode)) return true;
    const key = (evt?.key || '').toLowerCase();
    const keyIdentifier = (evt?.keyIdentifier || '').toLowerCase();
    const code = (evt?.code || '').toLowerCase();
    return key.includes('colorf3') || keyIdentifier.includes('colorf3') || key.includes('blue') ||
        code === 'f4' || code === 'keyb' || code === 'digit4';
}

// Initialize as soon as the app DOM exists, not once a <video> element
// appears, so the setting is wired up before the first video starts.
const interval = setInterval(() => {
    if (!document.body || window.__ttSpeedUiInitialized) return;
    window.__ttSpeedUiInitialized = true;
    execute_once_dom_loaded_speed();
    clearInterval(interval);
}, 250);

function execute_once_dom_loaded_speed() {
    const applyConfiguredSpeed = () => {
        const video = document.querySelector('video');
        if (!video) return;
        video.playbackRate = configRead('videoSpeed');
    };

    // Delegated + capture so this keeps working across video-element swaps
    // (a new <video> is created per playback session).
    document.addEventListener('canplay', (evt) => {
        if (evt?.target?.tagName === 'VIDEO') {
            applyConfiguredSpeed();
        }
    }, true);
    applyConfiguredSpeed();

    const eventHandler = (evt) => {
        if (isBlueKey(evt)) {
            evt.preventDefault();
            evt.stopPropagation();
            if (evt.type === 'keydown') {
                speedSettings();
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

    showModal('Playback Speed', overlayPanelItemListRenderer(buttons, selectedIndex), 'tt-speed');
}

export {
    speedSettings
}