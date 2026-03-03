# TizenTube

TizenTube is a TizenBrew module that enhances your favourite streaming websites viewing experience by removing ads and adding support for Sponsorblock.

Looking for an app for Android TVs? Check out [TizenTube Cobalt](https://github.com/reisxd/TizenTubeCobalt). It offers everything TizenTube has for Android TVs. [Download the latest release here](https://github.com/reisxd/TizenTubeCobalt/releases/latest).

[Discord Server Invite](https://discord.gg/m2P7v8Y2qR)

[Telegram Channel](https://t.me/tizentubeofficial)

# How to install

1. Install TizenBrew from [here](https://github.com/reisxd/TizenBrew) and follow the instructions.

2. TizenTube is installed to TizenBrew by default. It should be in the home screen. If not, add `@foxreis/tizentube` as a NPM module in TizenBrew module manager.

# Features

- Ad Blocker
- [SponsorBlock](https://sponsor.ajay.app/) Support
- Picture-in-Picture Mode
- [DeArrow](https://dearrow.ajay.app/) Support
- Customizable Themes (Custom Coloring)
- More to come, if you [request](https://github.com/reisxd/TizenTube/issues/new) it!

# Tampermonkey local debugging helpers (Windows + Chrome)

Use this when you want to test TizenTube locally in Chrome instead of on-device.

## Scripts in this repository

Tampermonkey scripts are stored in:

- `scripts/tampermonkey/tizentube-loader.user.js` (loads `dist/userScript.js`)
- `scripts/tampermonkey/tizentube-log-button.user.js` (adds floating **TT Logs** button that calls `window.downloadTizenTubeLogs()`)

## Full setup steps

1. Install **Tampermonkey** in Chrome.
2. Open `chrome://extensions/`:
   - Enable **Developer mode** (top-right).
   - Open Tampermonkey details and enable **Allow in Incognito**.
   - If you use a User-Agent extension, also enable **Allow in Incognito** for it.
3. Install a User-Agent switching extension (for TV UA testing).
4. Set a TV-like User-Agent for YouTube. Example that usually works:

   `Mozilla/5.0 (SMART-TV; Linux; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/3.0 TV Safari/537.36`

5. In Tampermonkey, create/import `scripts/tampermonkey/tizentube-loader.user.js`.
6. In Tampermonkey, create/import `scripts/tampermonkey/tizentube-log-button.user.js`.
7. In Tampermonkey script settings, set **Sandbox mode = ALL** for these scripts.
8. Open `https://www.youtube.com/tv` and sign in if needed.
9. Verify TizenTube loaded:
   - Open DevTools Console and run `typeof window.toggleDebugConsole` (should return `"function"`).
10. Click **TT Logs** (bottom-right) to download logs without typing console commands.

## Notes

- If `/tv` redirects back to desktop YouTube, re-check User-Agent override and extension scope.
- Keep both scripts enabled: loader + log-button.
- The log button is external (Tampermonkey UI helper), not an in-app visual-console button.

