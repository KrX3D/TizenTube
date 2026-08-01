import { configRead } from '../config.js';

try {
  const RESOLUTIONS = {
    '2160p': { width: 3840, height: 2160 },
    '1440p': { width: 2560, height: 1440 },
    '1080p': { width: 1920, height: 1080 }
  };

  const spoofViewport = configRead('spoofViewport');
  const targetResolution = RESOLUTIONS[spoofViewport];

  if (targetResolution) {
    const { width, height } = targetResolution;

    // Spoof window.screen
    try {
      const spoofedScreen = { width, height, availWidth: width, availHeight: height };
      Object.defineProperty(window, 'screen', { get: () => spoofedScreen, configurable: true });
    } catch (e) {}

    // Safe matchMedia spoofing
    try {
      const originalMatchMedia = window.matchMedia;
      window.matchMedia = (query) => {
        const result = originalMatchMedia(query);
        const widthMatch = query.match(/\(min-width:\s*(\d+)px\)/);
        const heightMatch = query.match(/\(min-height:\s*(\d+)px\)/);
        if (widthMatch || heightMatch) {
          Object.defineProperty(result, 'matches', {
            get: () => {
              let match = true;
              if (widthMatch) match = width >= parseInt(widthMatch[1]);
              if (heightMatch) match = match && (height >= parseInt(heightMatch[1]));
              return match;
            }
          });
        }
        return result;
      };
    } catch (e) {}
  }
} catch (e) {
  console.warn('[ViewportSpoofing] Error:', e);
}
