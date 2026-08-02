# TizenTube

TizenTube is a TizenBrew module that enhances your favourite streaming websites viewing experience by removing ads and adding support for Sponsorblock.

Looking for an app for Android TVs? Check out [TizenTube Cobalt](https://github.com/reisxd/TizenTubeCobalt). It offers everything TizenTube has for Android TVs. [Download the latest release here](https://github.com/reisxd/TizenTubeCobalt/releases/latest).

[Discord Server Invite](https://discord.gg/m2P7v8Y2qR)

[Telegram Channel](https://t.me/tizentubeofficial)

# How to install

1. Install TizenBrew from [here](https://github.com/reisxd/TizenBrew) and follow the instructions.

2. TizenTube is installed to TizenBrew by default. It should be in the home screen. If not, add `@krx3d/tizentube2` as a NPM module in TizenBrew module manager.

# Standalone Mode

TizenTube can also run as its own installable Tizen app, without needing TizenBrew at all. It bundles a small local proxy service that loads YouTube TV through `http://localhost:8099`, injecting TizenTube automatically.

- The `.wgt` is built and signed by the [`Build TizenTube Standalone and Release`](.github/workflows/build-standalone-release.yaml) GitHub Actions workflow — see below for setting it up.
- Once built, install the `.wgt` the same way you'd install any other Tizen app (e.g. via [TizenBrewInstaller](https://github.com/KrX3D/TizenBrewInstaller)'s "Install from GitHub"/"Select file to install", or sideloaded directly).
- The standalone app always loads TizenTube from `https://cdn.jsdelivr.net/npm/@krx3d/tizentube2/dist/userScript.js`, so it stays in sync with whatever this repo last published to npm — no separate rebuild needed when only the mod itself changes.
- Its version is kept in lockstep with the userscript: once the build workflow above has the required secrets, it builds automatically right after every successful npm publish (triggered by `build-publish-cleanup.yml` completing), reading the just-bumped `package.json` version and writing it into `standalone/config.xml` before packaging — so "installed version" always matches the userscript version, no matter which of the two you're running.

## Building a signed Standalone `.wgt` (GitHub Actions)

The build workflow needs a Tizen author certificate to sign the package. This is a one-time setup:

1. Install the **baseline** Tizen Studio installer from [download.tizen.org/sdk/Installer/tizen-studio_6.1](https://download.tizen.org/sdk/Installer/tizen-studio_6.1/) — the newer Web CLI/IDE package-manager-based installer doesn't include Certificate Manager, so it has to be the baseline one.
2. Open Certificate Manager directly: `C:\tizen-studio\tools\certificate-manager\certificate-manager.exe`.
3. **Author** tab → **+** → create a **new, dedicated** author certificate — don't reuse one that's already been used to install a *different* app on the TV(s) you're targeting. A reused cert has been observed to sign successfully but fail (or behave unreliably) at install time on-device, seemingly because Tizen ties certificate identity to whatever app it was already registered against there. Fill in a name, organization/email, and a password — remember the password, you'll need it below. This produces a `.p12` and `.pwd` file under `C:\tizen-studio-data\keystore\author\`.
4. Base64-encode the `.p12` with no line wrapping:
   - Linux/macOS: `base64 -w0 author.p12`
   - Windows (PowerShell): `[Convert]::ToBase64String([IO.File]::ReadAllBytes("author.p12"))`
5. In this repo, go to **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `TIZEN_AUTHOR_KEY` — the base64 string from step 4
   - `TIZEN_AUTHOR_KEY_PW` — **the plain-text certificate password from step 3, not base64-encoded.** Only the `.p12` file itself needs base64 (it's binary); the password is already text. Pasting a base64-encoded password here fails the build with `PKCS#12 MAC could not be verified. Invalid password?`.

Once both secrets are set, the workflow builds automatically after every successful npm publish — no further action needed. To trigger an ad-hoc build without publishing first, either push a version tag:

```
git tag v1.0.0
git push origin v1.0.0
```

or run it manually from the **Actions** tab (`Build TizenTube Standalone and Release` → **Run workflow**). The signed `.wgt` is attached to the resulting GitHub Release either way.

If a run failed because of a bug in the workflow file itself and that's since been fixed, use **Run workflow** (or a new tag) to test the fix — not **Re-run failed jobs**. A re-run stays pinned to the workflow file as it existed at that run's original commit, so it won't pick up any fix merged afterward.

# Features

- Ad Blocker
- [SponsorBlock](https://sponsor.ajay.app/) Support
- Picture-in-Picture Mode
- [DeArrow](https://dearrow.ajay.app/) Support
- Customizable Themes (Custom Coloring)
- More to come, if you [request](https://github.com/reisxd/TizenTube/issues/new) it!

# Tampermonkey local debugging helpers (Windows + Chrome)

Use this when you want to test TizenTube locally in Chrome instead of on-device.

Tampermonkey runs the userscripts, while a User-Agent switcher extension makes Chrome present itself as a TV browser so `https://www.youtube.com/tv` stays on the TV UI.

## Scripts in this repository

Tampermonkey scripts are stored in:

- `scripts/tampermonkey/tizentube-loader.user.js` (loads `dist/userScript.js` via `@require`)
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


   Real TV User-Agent examples captured from your devices:

   - Tizen 5.0 TV - TV Model UE75RU7099UXZG:
     `Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.0 TV Safari/537.36`
   - Tizen 6.5 TV - TV Model LS32BM500EUXEN:
     `Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 108.0.5359.1/6.5 TV Safari/537.36 UWE/0.2.27108`

5. In Tampermonkey, create/import `scripts/tampermonkey/tizentube-loader.user.js` (configured for `youtube.com/tv*` only).
6. In Tampermonkey, create/import `scripts/tampermonkey/tizentube-log-button.user.js` (configured for `youtube.com/tv*` only).
7. In Tampermonkey script settings, set **Sandbox mode = ALL** for these scripts.
8. Open `https://www.youtube.com/tv` and sign in if needed.
9. Verify TizenTube loaded:
   - Open DevTools Console and run `typeof window.toggleDebugConsole` (should return `"function"`).
10. Click **TT Logs** (bottom-right corner of the page, floating above the YouTube TV UI) to download logs without typing console commands.


### Keyboard shortcuts for Windows testing (no TV remote)

When testing in Chrome on desktop, TizenTube maps TV color-button actions to normal keys:

- **GREEN** (open TizenTube settings): `G`, `F2`, or `2`
- **RED** (open theme settings): `R`, `F1`, or `1`
- **YELLOW** (toggle debug console): `Y`, `F3`, or `3`
- **BLUE**: `B`, `F4`, or `4`

### Where should I see the button?

After both userscripts are enabled and `/tv` has loaded, the **TT Logs** button appears in the **bottom-right corner** as a small black/green floating button.

If you do not see it:
- confirm `tizentube-log-button.user.js` is enabled in Tampermonkey,
- refresh the page once,
- and verify Tampermonkey script sandbox is set to **ALL**.

## Notes

- These helper scripts are intentionally limited to `/tv` URLs so they do not affect normal desktop YouTube pages.
- In Tampermonkey, you can force-refresh `@require` files via **TizenTube Loader → Externals → Requires → Update**.
- If Tampermonkey seems stale in Incognito, open script dashboard and use **Utilities → Check for userscript updates**, then hard-refresh YouTube TV.
- Tampermonkey only refreshes `@require` when it checks script updates; bumping loader `@version` and running update check forces newest bundle.
- If `/tv` redirects back to desktop YouTube, re-check User-Agent override and extension scope.
- Keep both scripts enabled: loader + log-button.
- The log button is external (Tampermonkey UI helper), not an in-app visual-console button.
