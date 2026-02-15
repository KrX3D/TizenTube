import { SettingActionRenderer, SettingsCategory } from './ytUI.js';
import rootPkg from '../../package.json';
const APP_VERSION = rootPkg.version;
const APP_VERSION_LABEL = `v${APP_VERSION.split('.').pop()}`;

function PatchSettings(settingsObject) {
    const version = window?.h5vcc?.tizentube?.GetVersion ? window.h5vcc.tizentube.GetVersion() : 'unknown';
    const tizentubeOpenAction = SettingActionRenderer(
        'TizenTube Settings',
        'tizentube_open_action',
        {
            customAction: {
                action: 'TT_SETTINGS_SHOW',
                parameters: []
            }
        },
        `Open TizenTube Settings\nVersion: ${APP_VERSION_LABEL}`,
        'https://www.gstatic.com/ytlr/img/parent_code.png'
    )

    const tizenTubeCategory = SettingsCategory(
        'tizentube_category',
        [tizentubeOpenAction]
    );
    // Add it as the first item in the settings object
    settingsObject.items.unshift(tizenTubeCategory);

}

export {
    PatchSettings
}
