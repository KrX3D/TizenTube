import { noteReload } from './reloadCoordinator.js';
const deviceProfiles = [
    {
        architecture: 'Linux arm64-v8a',
        os: 'Android 10',
        rasterizer: 'gles',
        manufacturer: 'Sony',
        deviceType: 'ATV',
        chipsetModel: 'sdm845',
        modelYear: 13140765,
        firmwareVersion: '52.1.C.0.268',
        brand: 'KDDI',
        model: 'SOV38'
    },
    {
        architecture: 'Linux armeabi-v7a',
        os: 'Android 14',
        rasterizer: 'gles',
        manufacturer: 'Google',
        deviceType: 'ATV',
        chipsetModel: 'sabrina',
        modelYear: 2020,
        firmwareVersion: 'UTTC.250917.004',
        brand: 'google',
        model: 'Chromecast'
    },
    {
        architecture: 'Linux armeabi-v7a',
        os: 'Android 12',
        rasterizer: 'gles',
        manufacturer: 'TCL',
        deviceType: 'ATV',
        chipsetModel: 'merak',
        modelYear: 2023,
        firmwareVersion: 'STT2.221228.001',
        brand: 'TCL',
        model: 'Smart TV Pro'
    },
    {
        architecture: 'Linux armeabi-v7a',
        os: 'Android 7.1.2',
        rasterizer: 'gles',
        manufacturer: 'Amazon',
        deviceType: 'ATV',
        chipsetModel: 'mt8695',
        modelYear: 0,
        firmwareVersion: 'NS6294',
        brand: 'Amazon',
        model: 'AFTMM'
    }
];

const cobaltVersion = '25.lts.30.1034958-gold';
const v8Version = 'v8/8.8.278.17-jit';
const starboardVersion = '15';
const auxField = 'com.google.android.youtube.tv/5.30.301';

function generateUserAgent(profile) {
    return `Mozilla/5.0 (${profile.architecture}; ${profile.os}) Cobalt/${cobaltVersion} (unlike Gecko) ${v8Version} ${profile.rasterizer} Starboard/${starboardVersion}, ${profile.manufacturer}_${profile.deviceType}_${profile.chipsetModel}_${profile.modelYear}/${profile.firmwareVersion} (${profile.brand}, ${profile.model}) ${auxField}`;
}

// Applying a user agent only affects requests made from here on; the page
// itself was fetched with the old one, so it has to be reloaded once for the
// spoof to mean anything.
//
// It used to reload unconditionally, and twice in the same pass: once because a
// stored agent existed, then again after generating a new one — and since
// location.reload() does not stop the code after it, both ran. With an agent
// stored, every single load did it again. That is one of the three reloads
// reported after powering the TV on.
//
// Now: the profile is chosen once and kept, and the reload happens at most once
// per app session.
const APPLIED_KEY = 'ytaf-ua-applied';

if (document.querySelector('.content-container') && window.h5vcc && window.h5vcc.tizentube && window.h5vcc.tizentube.SetUserAgent) {
    try {
        let userAgent = localStorage.getItem('userAgent');
        if (!userAgent) {
            const randomProfile = deviceProfiles[Math.floor(Math.random() * deviceProfiles.length)];
            userAgent = generateUserAgent(randomProfile);
            localStorage.setItem('userAgent', userAgent);
        }
        window.h5vcc.tizentube.SetUserAgent(userAgent);

        // Already in effect, so this load already used it.
        const alreadyInEffect = navigator.userAgent === userAgent;
        // Tried once this session. Reloading again would only try the same
        // thing, which is how a reload loop starts.
        let triedThisSession = false;
        try { triedThisSession = !!sessionStorage.getItem(APPLIED_KEY); } catch (_) { }

        if (!alreadyInEffect && !triedThisSession) {
            try { sessionStorage.setItem(APPLIED_KEY, '1'); } catch (_) { }
            noteReload('user_agent');
            location.reload();
        }
    } catch (err) {
        console.warn('[userAgentSpoofing] could not apply the user agent:', err);
    }
}
