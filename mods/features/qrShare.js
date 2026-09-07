import { showModal, showToast, overlayPanelItemListRenderer, overlayMessageRenderer, QrCodeRenderer } from '../ui/ytUI.js';
import qrcode from 'qrcode-npm';
import { t } from 'i18next';

// Share the currently playing video as a QR code (upstream 3aa3039).
//
// A TV has no clipboard and no browser address bar, so the only practical way
// to get a link off the device is to render it as something a phone camera can
// read. The QR is generated locally — nothing is sent anywhere.

// Version 6 at error-correction level H comfortably fits a ~43-character
// watch URL while staying readable from across a room.
const QR_VERSION = 6;
const QR_ERROR_CORRECTION = 'H';
const QR_CELL_SIZE = 8;
const QR_MARGIN = 8;

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

        const shareUrl = `https://www.youtube.com/watch?v=${videoId}`;

        const qr = qrcode.qrcode(QR_VERSION, QR_ERROR_CORRECTION);
        qr.addData(shareUrl);
        qr.make();

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
