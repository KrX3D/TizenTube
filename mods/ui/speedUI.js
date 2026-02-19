import { configRead } from '../config.js';
import { showModal, buttonItem, overlayPanelItemListRenderer } from './ytUI.js';

const interval = setInterval(() => {
    const videoElement = document.querySelector('video');
    if (videoElement) {
        //execute_once_dom_loaded_speed();
        clearInterval(interval);
    }
}, 1000);

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