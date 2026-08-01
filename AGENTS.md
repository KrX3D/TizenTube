# AGENTS.md — TizenTube (KrX3D fork)

This file is for AI coding agents (and humans) working in this repository. It
describes the actual current state of the codebase — keep it in sync when
you make structural changes. A stale version of this file is worse than no
file at all: update it in the same PR as the change that makes it stale.

## What this project is

TizenTube is an ad-blocking / SponsorBlock-enabled mod for the YouTube TV app
on Samsung Tizen TVs. It ships as a userscript (`dist/userScript.js`) that
gets injected into YouTube TV's page context, plus a small DIAL service
(`dist/service.js`) that lets the app be cast/launched.

This is `KrX3D/TizenTube`, a fork of `reisxd/TizenTube`. It has diverged
substantially — do not assume upstream's code, conventions, or file layout
still apply; verify against this repo directly.

There are **two independent ways this mod actually reaches a TV**, and
they matter for understanding "what code path am I changing":

1. **TizenBrew-injected (the original, still primary path).** A separate
   host app, [TizenBrew](https://github.com/KrX3D/TizenBrew), uses Chrome
   DevTools Protocol to inject `dist/userScript.js` directly into Cobalt's
   (YouTube TV's browser engine) JS context. TizenBrew is not part of this
   repo. The published npm package (`@krx3d/tizentube2`) is what TizenBrew
   fetches — see "npm publish" below.
2. **Standalone mode (`standalone/`).** A self-contained, separately
   installable Tizen app that doesn't need TizenBrew at all. See
   "Standalone mode" section below — it's non-trivial and has its own
   quirks, including an unresolved packaging/signing issue (see "Known
   unresolved issues").

Both paths ultimately load the *same* `mods/userScript.js` bundle from the
npm CDN at runtime — standalone mode does not bundle a copy of the mod
into its `.wgt`. So most feature work in `mods/` automatically applies to
both paths without any standalone-specific changes.

## Repo layout

```
package.json                 # root — published to npm as @krx3d/tizentube2
README.md
AGENTS.md                    # this file
dist/                        # build output, partially committed (see CI section)
  userScript.js              # built mod bundle (mods/ → rollup)
  service.js                 # built DIAL service (service/ → rollup)

mods/                        # the userscript — THIS IS WHERE MOST FEATURE WORK HAPPENS
  package.json                (package name: @tizentube/mods, not published itself)
  userScript.js               # entry point: imports every feature/ui module
  config.js                   # config schema + configRead/configWrite/configChangeEmitter
  resolveCommand.js           # central dispatcher: opens modals, changes client settings, etc.
  rollup.config.js
  tiny-sha256.js, domrect-polyfill.js, spatial-navigation-polyfill.js
  features/                   # one file per feature (see "Feature map" below)
  ui/                         # settings menu, themes, custom player UI, etc.
  translations/
    index.js                  # i18next init
    i18nResources.js          # registers every resources/*.json file
    language-names.js
    resources/*.json          # 27 language files — see "Translations" section
  utils/
    ASTParser.js               # esprima/estraverse-based pattern finder, used to
                                # locate YouTube's internal functions/classes that
                                # aren't exposed by name (YouTube's TV app code is
                                # minified/obfuscated and changes over time)

service/                     # DIAL service (cast/launch support) — separate from mods/
  service.js
  rollup.config.js
  package.json

standalone/                  # standalone installable app — see "Standalone mode" below
  config.xml                  # Tizen app manifest — app id: krx3dTtSt1.TizenTubeStandalone
  index.html                  # loading screen, decides injector vs proxy path
  icon.png, icon_16b9.png
  service/                    # standalone's own local proxy + CDP injector (NOT mods/'s service/)
    index.js                  # Express proxy: rewrites youtube.com/tv, injects userscript <script> tag
    injector.js               # CDP-based injector (same technique TizenBrew itself uses)
    babel.config.json         # transpiles for Tizen's old JS service engine (Node v4.4.3 on ~Tizen 5.5-)
    build-service.js          # babel → ncc bundle → service/dist/index.js
    package.json

.github/
  workflows/
    build-publish-cleanup.yml   # push to main: bump version, build, npm publish, cleanup old npm versions
    build-standalone-release.yaml  # builds/signs standalone/ into a .wgt via Tizen Studio, GitHub Release
    codeql.yml                  # security scanning
    claude.yml
  assets/
    profiles.xml                 # Tizen Studio signing profile for standalone (see Known issues)

scripts/tampermonkey/         # local Chrome-based dev/test loader — see README.md
```

## Configuration system (`mods/config.js`)

- Storage: `localStorage['ytaf-configuration']`, JSON-serialized.
- API: `configRead(key)`, `configWrite(key, value)`,
  `configChangeEmitter.addEventListener('configChange', cb)`.
- `configRead` auto-populates missing keys from `defaultConfig` and warns
  once per key — don't add a config key without adding its default here.
- Current default keys (check `mods/config.js` directly for the live list —
  this repo adds new ones regularly, e.g. `enableAIAskButton`, `spoofViewport`,
  `disabledSidebarContents`, `hiddenLibraryTabIds`, `launchToOnStartup`,
  clock/dimming/debug-console settings). **Do not trust a cached list of
  config keys from memory or an old doc — read the file.**

## Feature map (`mods/features/*.js`)

| File | What it does |
|---|---|
| `adblock.js` | Patches `JSON.parse` to strip ad placements/slots from YouTube's data before the app renders it. Also runs DeArrow, hqify, tile processing, library-tab hiding, watch-progress caching, and most per-page-type UI patches from the same hook. **Everything in the patch body is wrapped in try/catch with `parse.error` logging (`appendFileOnlyLog`) and always returns the original parsed object on failure** — a thrown error here previously broke `JSON.parse` for the entire page; do not remove that wrapper. |
| `sponsorblock.js` | SponsorBlock integration. Uses a *scheduled* `setTimeout` (`scheduleSkip()`) timed to the exact next segment boundary, adjusted for `video.playbackRate`, rather than polling — don't reintroduce a polling/`timeupdate`-based approach without a specific reason. `buildOverlay()` retries every 100ms if the slider DOM element isn't ready yet instead of giving up. |
| `standaloneUserscript.js` | Only active when `window.location.hostname === 'localhost'` (i.e. running inside standalone mode's local proxy). Redirects `fetch`/`XHR`/`sendBeacon`/img/script `src` for YouTube/Google hosts through the local CORS-bypass proxy. Has its own hostname allowlist — keep it in sync with `standalone/service/index.js`'s server-side allowlist if you touch either. |
| `viewportSpoofing.js` | Overrides `window.screen` + `matchMedia` width/height queries to report a different resolution to YouTube (`spoofViewport` config: disabled/2160p/1440p/1080p). For TVs that under-report their real decode capability. |
| `pictureInPicture.js` | PiP mode. |
| `updater.js` | Checks for and applies TizenTube updates. |
| `moreSubtitles.js` | Adds extra subtitle language options. |
| `preferredVideoQuality.js` | Applies `preferredVideoQuality`/`videoPreferredCodec` on playback start. |
| `autoFrameRate.js` | Matches TV frame rate to video (Tizen-specific `h5vcc.tizentube.SetFrameRate` API when available). |
| `userAgentSpoofing.js` | UA string overrides. |
| `enableFeatures.js` | Force-enables YouTube features normally gated because YT treats the TV as a low-end device. |
| `hideWatched.js` | Watched-video hiding/threshold logic; also hosts shared logging helpers (`appendFileOnlyLog`) and playlist button injection used by `playlistContinue.js`. |
| `playlistContinue.js` | "Continue playlist" / queued-videos behavior, built on `hideWatched.js`'s helpers. |
| `libraryTabHider.js` | Hides library tabs per `hiddenLibraryTabIds`. |
| `specialPlaylistHider.js` | Hides Watch Later / Liked Videos shelves/tiles per `hiddenSpecialPlaylist*` config. |
| `shorts.js` | Shorts-related behavior (`enableShorts`). |
| `videoQueuing.js` | Manual video queue feature. |
| `playlistBatchCollect.js` | Batch-collects playlist items (`enablePlaylistBatchCollect`). |
| `logServer.js` | Optional remote log server (`logServerEnabled`) for on-device debugging. |
| `visualConsole.js` | On-screen debug console (`enableDebugConsole`) — shows version via `../../package.json`, executes commands via `resolveCommand`. |

## UI map (`mods/ui/*.js`)

`settings.js` is the main settings menu tree — every entry is
`{ name: t('...'), icon: 'ICON_NAME', ... }`. **Icon names must already be
used elsewhere in `settings.js` (verified with a grep) before you use them
— YouTube TV's icon set is closed and many plausible Material icon names
(e.g. `THUMB_UP`) silently render no icon at all if they don't exist in the
app.** Don't guess an icon name; check first.

Other files: `ui.js` (top-level UI patches), `ytUI.js` (toast/button
helpers shared across features), `theme.js` (color customization),
`speedUI.js`, `chapters.js`, `customUI.js` (player transport-controls
button filtering — e.g. `enableAIAskButton`/`enableSuperThanksButton`),
`customGuideAction.js`, `customCommandExecution.js`, `customYTSettings.js`,
`disableWhosWatching.js`, `clock.js`.

## Translations (`mods/translations/resources/*.json`)

27 language files. **`en.json` and `de.json` are the only two kept fully in
sync with every new feature** — when you add a user-facing string, update
both. Other languages are community-contributed snapshots; don't assume
they have a given nested block (e.g. the `nav.*` sidebar-icon-name block
under `uiSettings.options` only exists in `en`/`de` — other languages
correctly fall back to English for it via i18next, which is fine).
`i18nResources.js` registers every file in `resources/` — a new language
file needs a matching import/registration there too.

## Standalone mode (`standalone/`)

A fully separate installable Tizen app (own `config.xml`, own Tizen app
identity `krx3dTtSt1.TizenTubeStandalone` / package `krx3dTtSt1` — chosen
deliberately distinct from upstream's `xvvl3S1TT1`, which several other
forks reuse unchanged, causing them to collide with each other's installs
on the same device).

On launch (`standalone/index.html`) it asks its own local service
(`standalone/service/index.js`, an Express app on `localhost:8099`)
whether Tizen debugging (SDB) is reachable:

- **If yes:** uses `standalone/service/injector.js` — the *same* CDP
  technique TizenBrew itself uses (hook `Runtime.executionContextCreated`,
  evaluate the userscript before the page's own scripts run, then
  navigate). The standalone app exits once the injected session takes over.
- **If no:** falls back to navigating its own webview to
  `http://localhost:8099/tv`. The local Express proxy fetches the real
  `youtube.com/tv`, rewrites resource URLs so everything routes back
  through `localhost:8099` (avoiding CORS), and injects the userscript
  `<script>` tag right after `<body>` opens (must run before YouTube's own
  scripts, since the ad blocker's `JSON.parse` patch needs to be active
  before YouTube parses its initial player data). This proxy also
  enforces a hostname allowlist before forwarding any `/cors-bypass/`
  request — never remove that; it's what stops the proxy being an open
  relay to arbitrary hosts.

Both paths fetch the userscript live from
`https://cdn.jsdelivr.net/npm/@krx3d/tizentube2/dist/userScript.js` (with
an `unpkg.com` fallback) — **never hardcode `@foxreis/tizentube`** (that's
upstream's package; several forks that copy-paste from upstream get this
wrong and end up running unmodified upstream code inside "their" fork).

`standalone/service/`'s own source files (`index.js`, `injector.js`,
`build-service.js`, `babel.config.json`, `package.json`) are **not** the
same thing as top-level `service/` (the DIAL service) — the standalone
build step builds top-level `service/` first because
`standalone/service/index.js` wraps and `require()`s its output
(`dist/service.js`).

## CI / build (`.github/workflows/`)

- **`build-publish-cleanup.yml`** — on push to `main`: bumps
  `package.json`'s version (+10 patch, rolling over to minor at 1000),
  builds `mods/` and `service/`, commits the bump + built `dist/*` files
  back to `main` with `[skip ci]`, then publishes to npm and removes old
  npm versions. This is why `dist/userScript.js` is partially committed
  despite being build output — CI keeps it in sync, don't hand-edit it.
- **`build-standalone-release.yaml`** — triggered automatically via
  `workflow_run` right after the above finishes successfully (so
  standalone's version always matches the just-published userscript
  version — it reads `package.json` and writes the same number into
  `standalone/config.xml` before packaging), or by a `v*.*.*` tag push, or
  manually. Builds `mods/`, `service/`, and `standalone/service/`, then
  signs `standalone/` into a `.wgt` using **Tizen Studio's own CLI**
  (`tizen build-web` + `tizen package`, via `.github/assets/profiles.xml`)
  — see "Known unresolved issues", this is mid-troubleshooting.
- **`codeql.yml`** — security scanning on PRs; check its findings before
  merging anything touching `standalone/service/` (the proxy) or auth-ish
  code — false positives happen (e.g. SSRF flags on the proxy's
  intentional catch-all forwarding) but real findings do too (an actual
  open-proxy gap was found and fixed this way once).

Local verification without waiting on CI:
```
cd mods && npm ci && npx rollup -c        # builds ../dist/userScript.js
cd service && npm ci && npx rollup -c     # builds ../dist/service.js
cd standalone/service && npm install && npm run build   # builds dist/index.js
```
Revert `dist/*` afterward if you're not intentionally changing it —
CI owns that file's committed state.

## Known unresolved issues (as of writing)

**Standalone `.wgt` install failure — still open, multiple fix attempts,
paused pending more information.** Summary of what's been ruled out and
what's still live, so the next session doesn't repeat dead ends:

1. Signing with `tizenjs` (unofficial community packaging tool) + its
   auto-downloaded distributor cert → installed fine as an *update* but
   was rejected on a fresh install (`invalid certificate chain`). Root
   cause was assumed to be the cert's expiration (Samsung's public sample
   cert, expired 2022) — **this was later disproven**: a sibling project
   in this same author's ecosystem (`TizenYouTube`) installs fine fresh
   using that *exact same expired cert*, just packaged with official
   Tizen Studio instead of `tizenjs`.
2. Switched to Samsung's official Tizen Studio CLI (`tizen build-web` +
   `tizen package`), matching the working sibling projects exactly
   (`TizenBrew`, `TizenBrewInstaller`, `TizenYouTube` all use it). This is
   very likely the structurally correct fix — but packaging then hit a
   *different* failure: `CertificationException: Invaild password` from
   Tizen Studio's own signing tool while loading the author certificate,
   even though the same password/cert work fine via `tizenjs`.
3. Attempted fix: re-encrypt the author `.p12` to an older, more
   broadly-Java-compatible PKCS#12 cipher (`PBE-SHA1-3DES`) before Tizen
   Studio reads it, on the theory that Tizen Studio's old bundled Java
   crypto can't read modern OpenSSL 3.x's default AES-256 PKCS#12
   encryption. **Did not resolve it** — still failing with the same error
   as of the last test.
4. **Paused here at the user's request.** Next step, if resumed: the
   workflow logs the PBE algorithm before/after the re-encryption attempt
   (`Configure certificate profile` step) — read that log output first
   rather than guessing again blind. Also worth directly diffing this
   repo's actual `author.p12` (openssl `pkcs12 -info`) against one that's
   confirmed working (e.g. regenerate a fresh cert via Tizen Studio's own
   Certificate Manager, since that's guaranteed cipher-compatible with
   Tizen Studio's own signing tool).

**Deferred feature: Q-Symphony 5.1 audio.** `pilvepank/TizenTube`'s fork
(compare: `reisxd/TizenTube...pilvepank:TizenTube:main`) has a well-built
feature that rewrites the standalone proxy's outgoing HTTP User-Agent to a
Cobalt 20+ living-room-client string, which unlocks YouTube's multichannel
audio streams (E-AC-3/AC-3/AAC 5.1 — itags 328/380/258/327) that it
otherwise only ever serves stereo to Tizen's web engine. It's standalone-
mode-only structurally: the injected-userscript path can only override
`navigator.userAgent` (what JS reads), not the actual HTTP header YouTube's
server keys off — only the proxy can rewrite that. Needs a
`mods/features/surroundAudio.js` codec-support module (`MediaSource.
isTypeSupported`/`canPlayType` for AC-3/E-AC-3/AC-4, careful never to claim
a codec the platform doesn't actually support), a settings toggle with 3
UA profiles, and a diagnostics panel (~600 lines total). Not yet ported —
deferred until the standalone signing issue above is fixed (can't test an
install-blocked mode), and the user's hardware is an unconfirmed fit (has
a Samsung soundbar, not confirmed Q-Symphony-compatible). Ask before
implementing if this comes back up.

## Conventions this repo has established (follow these)

- New app identities (Tizen `package`/app id) must be unique, not reused
  from upstream or another project — collisions cause cross-app "wrong
  version shown" bugs and install conflicts (this has actually happened —
  see standalone's `krx3dTtSt1` choice above).
- Never hardcode another fork's npm package name or GitHub repo as a
  fallback/CDN source — always this fork's own (`@krx3d/tizentube2`,
  `KrX3D/TizenTube`).
- New features go in their own file under `mods/features/`, not inline in
  an existing file like `adblock.js`.
- Verify icon names against existing `settings.js` usage before adding a
  new settings entry.
- Add new user-facing strings to **both** `en.json` and `de.json`, minimum.
- Don't add error handling for scenarios that can't happen; do keep the
  defensive try/catch patterns already established in `adblock.js`'s
  `JSON.parse` patch and `sponsorblock.js`'s scheduled-skip handler — both
  exist because an uncaught error there previously broke playback/parsing
  page-wide, not out of general caution.
