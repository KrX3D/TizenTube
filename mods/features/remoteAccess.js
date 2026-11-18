// Remote access (standalone only): a page on the LAN, port 8098, served by the
// standalone service (standalone/service/remoteAccess.js). It shows the log
// live in a notebook or phone browser and, if allowed, runs JavaScript in this
// page for testing.
//
// This module only tells the service what the settings say and keeps what it
// answers (address and PIN) in window.__ttRemoteInfo for the settings menu.
// CDP path: the injector's log poll picks window.__ttRemoteAccess up and sets
// __ttRemoteInfo back. Proxy path: same-origin POST to the service.

import { configRead, configChangeEmitter } from '../config.js';
import { shareUrlAsQr } from './qrShare.js';
import { showToast } from '../ui/ytUI.js';
import { t } from 'i18next';

const KEYS = ['enableRemoteAccess', 'enableRemoteEval'];

export function isStandalonePage() {
    return window.location.hostname === 'localhost' || window.__ttStandalone === true;
}

/** Whether page logs should go to the service for the remote page. */
export function remoteLogsWanted() {
    return isStandalonePage() && !!configRead('enableRemoteAccess');
}

function publish(newPin) {
    if (!isStandalonePage()) return;
    const state = {
        enabled: !!configRead('enableRemoteAccess'),
        evalEnabled: !!configRead('enableRemoteEval'),
        // Sticky until the service has seen it: a later publish before the
        // next poll must not drop a requested new PIN.
        newPin: !!newPin || !!(window.__ttRemoteAccess && window.__ttRemoteAccess.newPin)
    };
    if (window.location.hostname === 'localhost') {
        fetch('/tizentube/remoteAccess', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state)
        }).then((r) => r.json()).then((info) => {
            window.__ttRemoteInfo = info;
            try { window.dispatchEvent(new Event('tt-remote-info')); } catch (_) { }
        }).catch(() => { });
    } else {
        window.__ttRemoteAccess = state;
    }
}

function remoteUrl() {
    const info = window.__ttRemoteInfo;
    return info && info.enabled && info.urls && info.urls[0] ? info.urls[0] : '';
}

/** Settings subtitle: the address with PIN, or why there is none. */
export function remoteAccessSubtitle() {
    if (!isStandalonePage()) return t('settings.options.misc.options.remoteAccess.standaloneOnly');
    if (!configRead('enableRemoteAccess')) return t('settings.options.misc.options.remoteAccess.off');
    const info = window.__ttRemoteInfo;
    if (!info || !info.enabled) return t('settings.options.misc.options.remoteAccess.waiting');
    if (!info.listening) return t('settings.options.misc.options.remoteAccess.notListening', { port: info.port });
    return remoteUrl() || t('settings.options.misc.options.remoteAccess.noNetwork');
}

export function showRemoteAccessQr() {
    const target = remoteUrl();
    if (!target) {
        showToast('TizenTube', remoteAccessSubtitle());
        return;
    }
    shareUrlAsQr(target, t('settings.options.misc.options.remoteAccess.title'),
        t('settings.options.misc.options.remoteAccess.qrMessage', { url: target }));
}

export function newRemoteAccessPin() {
    if (!configRead('enableRemoteAccess')) {
        showToast('TizenTube', t('settings.options.misc.options.remoteAccess.off'));
        return;
    }
    const before = window.__ttRemoteInfo && window.__ttRemoteInfo.pin;
    publish(true);
    const onInfo = () => {
        const info = window.__ttRemoteInfo;
        if (!info || info.pin === before) return;
        window.removeEventListener('tt-remote-info', onInfo);
        showToast('TizenTube', t('settings.options.misc.options.remoteAccess.newPinDone', { pin: info.pin }));
    };
    window.addEventListener('tt-remote-info', onInfo);
    setTimeout(() => window.removeEventListener('tt-remote-info', onInfo), 10000);
}

// Proxy path: nothing can push into this page, so ask whether the remote
// page is open (info.viewer). The CDP path gets __ttRemoteViewer pushed by
// the injector's poll instead.
let _viewerTimer = null;
function watchViewerOnProxyPath() {
    if (window.location.hostname !== 'localhost') return;
    const on = !!configRead('enableRemoteAccess');
    if (!on) {
        if (_viewerTimer) { clearInterval(_viewerTimer); _viewerTimer = null; }
        window.__ttRemoteViewer = false;
        return;
    }
    if (_viewerTimer) return;
    _viewerTimer = setInterval(() => {
        fetch('/tizentube/remoteAccess').then((r) => r.json()).then((info) => {
            window.__ttRemoteInfo = info;
            window.__ttRemoteViewer = !!(info && info.viewer);
        }).catch(() => { });
    }, 3000);
}

if (isStandalonePage()) {
    configChangeEmitter.addEventListener('configChange', (ev) => {
        if (ev && ev.detail && KEYS.indexOf(ev.detail.key) >= 0) watchViewerOnProxyPath();
    });
    watchViewerOnProxyPath();
    configChangeEmitter.addEventListener('configChange', (ev) => {
        if (ev && ev.detail && KEYS.indexOf(ev.detail.key) >= 0) publish(false);
    });
    // Every load, so the service's answer (address, PIN) is always fresh.
    publish(false);
}
