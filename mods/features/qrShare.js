import { showModal, showToast, overlayPanelItemListRenderer, overlayMessageRenderer, QrCodeRenderer } from '../ui/ytUI.js';
import qrcode from 'qrcode-npm';
import { t } from 'i18next';

// Share the currently playing video as a QR code (upstream 3aa3039).
//
// A TV has no clipboard and no browser address bar, so the only practical way
// to get a link off the device is to render it as something a phone camera can
// read. The QR is generated locally — nothing is sent anywhere.

// Version 6 at error-correction level H comfortably fits a ~43-character
// watch URL while staying readable from across a room. A playlist URL is
// longer — youtube.com/playlist?list= plus a 34-character id is about 60 — so
// the version is chosen per URL rather than fixed, and version 6 remains the
// floor so a watch URL looks exactly as it did.
const QR_VERSION = 6;
const QR_VERSION_MAX = 10;
const QR_ERROR_CORRECTION = 'H';
const QR_CELL_SIZE = 8;
const QR_MARGIN = 8;

// Shares whatever is playing. The long press menu shares a tile instead, which
// is the same thing minus the player lookup — see shareVideo below.
export function shareCurrentVideo() {
    try {
        const videoPlayer = document.querySelector('.html5-video-player');
        const videoId = videoPlayer?.getVideoData?.()?.video_id;
        if (!videoId) {
            // Nothing is playing, or the player hasn't published its metadata
            // yet — better a toast than a modal showing a QR for "undefined".
            showToast('TizenTube', t('toasts.shareNoVideo'));
            return;
        }

        shareVideo(videoId);
    } catch (err) {
        console.warn('[qrShare] failed to build share QR code:', err);
        showToast('TizenTube', t('toasts.shareFailed'));
    }
}

/**
 * Show the QR code for one video id, wherever it came from.
 *
 * @param {string} videoId
 */
export function shareVideo(videoId) {
    if (!videoId) {
        showToast('TizenTube', t('toasts.shareNoVideo'));
        return;
    }
    shareUrlAsQr(`https://www.youtube.com/watch?v=${videoId}`);
}

/**
 * The same, for a whole playlist.
 *
 * A playlist is the one thing on a TV it is most useful to send to a phone —
 * the list is long, the remote is slow, and a watch URL for one of its videos
 * is not the same thing as the playlist. Reached from a playlist tile's long
 * press menu.
 *
 * @param {string} playlistId  with or without the VL prefix a tile carries
 */
export function sharePlaylist(playlistId) {
    // A tile's browse id is VL + the playlist id; a playlist URL wants the id
    // itself. WL and LL have no prefix and pass through unchanged.
    const list = String(playlistId || '').replace(/^VL/, '').trim();
    if (!list) {
        showToast('TizenTube', t('toasts.shareFailed'));
        return;
    }
    shareUrlAsQr(`https://www.youtube.com/playlist?list=${list}`);
}

/** The modal, which is the same whatever the URL points at. */
function shareUrlAsQr(shareUrl) {
    try {
        // The smallest version that holds this URL, so a short one stays as
        // large and as readable as it was before playlists came along.
        let qr = null;
        for (let version = QR_VERSION; version <= QR_VERSION_MAX; version++) {
            try {
                const attempt = qrcode.qrcode(version, QR_ERROR_CORRECTION);
                attempt.addData(shareUrl);
                attempt.make();
                qr = attempt;
                break;
            } catch (_) {
                // Too long for this version; the next one is bigger.
            }
        }
        if (!qr) {
            showToast('TizenTube', t('toasts.shareFailed'));
            return;
        }

        // qrcode-npm only emits a full <img> tag; the renderer wants the bare
        // data URL, so pull the src back out of it.
        const qrDataUrl = qr.createImgTag(QR_CELL_SIZE, QR_MARGIN).match(/src="([^"]+)"/)?.[1];
        if (!qrDataUrl) {
            showToast('TizenTube', t('toasts.shareFailed'));
            return;
        }

        showModal({
            title: t('player.share.title'),
        }, overlayPanelItemListRenderer([
            overlayMessageRenderer(t('player.share.qrCodeScanMessage')),
            QrCodeRenderer(qrDataUrl)
        ]), 'tt-share-modal');
    } catch (err) {
        console.warn('[qrShare] failed to build share QR code:', err);
        showToast('TizenTube', t('toasts.shareFailed'));
    }
}
