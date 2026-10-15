import { configRead, configChangeEmitter } from "../config.js";

const SELECTORS = {
    PLAYER: '.html5-video-player',
};

const EVENTS = {
    YT_STATE_CHANGE: 'onStateChange',
    CONFIG_CHANGE: 'configChange',
};

const CONFIG_KEYS = {
    QUALITY: 'preferredVideoQuality',
};

class PreferredQualityHandler {
    #player = null;
    #attachTimeout = null;
    #lastVideoId = null;
    #hasAppliedQuality = false;

    constructor() {
        this.init();
    }

    init() {
        this.#pollForPlayer();
        this.#setupConfigListener();
    }

    #pollForPlayer() {
        clearTimeout(this.#attachTimeout);

        const playerElement = document.querySelector(SELECTORS.PLAYER);

        if (!playerElement) {
            this.#attachTimeout = setTimeout(() => this.#pollForPlayer(), 100);
            return;
        }

        this.#player = playerElement;

        this.#player.addEventListener(EVENTS.YT_STATE_CHANGE, this.#handleStateChange);

        this.#handleStateChange();
    }

    #setupConfigListener() {
        configChangeEmitter.addEventListener(EVENTS.CONFIG_CHANGE, (ev) => {
            if (ev.detail?.key === CONFIG_KEYS.QUALITY) {
                this.#applyQuality();
            }
        });
    }

    #handleStateChange = () => {
        const state = this.#player?.getPlayerStateObject?.();
        const videoData = this.#player?.getVideoData?.();
        const videoId = videoData?.video_id;

        if (videoId !== this.#lastVideoId) {
            this.#lastVideoId = videoId;
            this.#hasAppliedQuality = false;
        }

        const isShorts = Object.values(this.#player.getVideoStats()).find(a => a && a === 'shortspage');
        if (state?.isPlaying && !this.#hasAppliedQuality && !isShorts) {
            this.#applyQuality();
            this.#hasAppliedQuality = true;
        }
    };

    #applyQuality() {
        const preferredQuality = configRead(CONFIG_KEYS.QUALITY);
        if (!preferredQuality || preferredQuality === 'auto' || !this.#player) return;

        try {
            const quality = this.#determineQuality(preferredQuality);

            if (quality) {
              // A range, not a single value. Passing the same quality as both
              // ends pins the player to exactly one resolution and takes away
              // its ability to adapt, so a connection that dips has nowhere to
              // go: instead of dropping to 720p it keeps asking for the pinned
              // one and starves.
              //
              // Captured on a 5.5 TV: four stalls in the first 100 seconds of a
              // video, the last lasting 40.7s with the buffer at 0.1s and
              // readyState 2, no dropped frames, and our own parsing costing
              // 21ms across the whole stall. Not one player.quality line in any
              // session reported a second resolution — the player never
              // adapted, in a session where adapting is exactly what it needed
              // to do.
              //
              // 'tiny' as the floor makes the setting a ceiling, which is what
              // a "preferred quality" asks for: never go above this, and go
              // below it rather than stop.
              this.#player.setPlaybackQualityRange('tiny', quality)
            }
        } catch (e) {
            console.warn('[PreferredQuality] Failed to apply quality:', e);
        }
    }

    #determineQuality(preference) {
        const availableQualities = this.#player.getAvailableQualityData();
        if (!availableQualities?.length) return 'highres';

        const getQualityValue = (label) => parseInt(label, 10) || 0;
        const targetValue = getQualityValue(preference);

        const match = availableQualities.find(q => getQualityValue(q.qualityLabel) === targetValue);

        return match ? match.quality : 'highres';
    }
}

window.preferredVideoQualityHandler = new PreferredQualityHandler();