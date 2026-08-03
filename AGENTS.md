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
    bootstrap.js               # plain ES5 (no ncc/bundling) — copied through as-is to dist/index.js,
                                # the actual tizen:service entry point. require()s dist/bundle.js
                                # (the real ncc bundle of index.js/injector.js/express/etc, output
                                # to a *different* filename on purpose) inside a try/catch, so a
                                # SyntaxError while Node parses that huge bundle — which can't be
                                # caught from inside the bundle itself, since parse errors happen
                                # before any of that file's own code runs — is at least catchable
                                # and loggable here. See "Known unresolved issues" re: Tizen 5.5.
    build-service.js          # ncc-bundles index.js, regex-patches known bundled-dep bugs, Babel-
                                # transpiles the bundle for Node 4.4.3, → dist/bundle.js; copies
                                # bootstrap.js → dist/index.js unmodified
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
scripts/log-receiver/         # PC-side PS1 receiver for logServer.js's remote logging (see Feature map)
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
| `logServer.js` | Optional remote log server (`logServerEnabled`) for on-device debugging. In TizenBrew mode, relays via TizenBrew's own `127.0.0.1:8081` service + CDP-queue fallback. In standalone mode (`window.location.hostname === 'localhost'`), instead POSTs to the standalone service's own `POST /tizentube/log` (see `standalone/service/index.js`), which relays to the PC receiver at `logServerHost`:`logServerPort` (same `/tv-log` path/JSON shape as TizenBrew's `remoteLogger.js`, so the receiver script at `scripts/log-receiver/receiver.ps1` works for both). Host/port are set via the RED-key theme overlay (`mods/ui/ui.js`), standalone-only fields — there's no free-text entry in the native TV settings menu. The standalone *service itself* also self-logs its own lifecycle (startup, uncaught exceptions, DIAL service load, proxy errors) unconditionally to a hardcoded `DEFAULT_LOG_HOST`/`DEFAULT_LOG_PORT` in `standalone/service/index.js`, independent of any page config — added specifically because the service can crash before the page/userscript ever loads, at which point page-driven config never gets read. `relayLog` (the single choke point both the page-side proxy fetch and the CDP-queue drain ultimately funnel through) tracks per-`host:port` availability: after the first failed attempt (fast `ECONNREFUSED`, or a 3s timeout for a genuinely unreachable host that would otherwise hang far longer at the OS TCP-connect level) it skips all further attempts to that target for the rest of the process, so an unreachable/not-running PC receiver can't add repeated delay to every subsequent log call. |
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
`build-service.js`, `package.json`) are **not** the
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

**Standalone `.wgt` install failure — RESOLVED (2026-08-02).** Kept here for
the history, since it took several disproven theories to get there:

1. Signing with `tizenjs` (unofficial community packaging tool) + its
   auto-downloaded distributor cert → installed fine as an *update* but
   was rejected on a fresh install (`invalid certificate chain`). Root
   cause was assumed to be the cert's expiration (Samsung's public sample
   cert, expired 2022) — **disproven**: a sibling project in this same
   author's ecosystem (`TizenYouTube`) installs fine fresh using that
   *exact same expired cert*, just packaged with official Tizen Studio
   instead of `tizenjs`.
2. Switched to Samsung's official Tizen Studio CLI (`tizen build-web` +
   `tizen package`), matching the working sibling projects
   (`TizenBrew`, `TizenBrewInstaller`, `TizenYouTube` all use it) — the
   structurally correct approach. Packaging then hit
   `CertificationException: Invaild password` while loading the author
   certificate, even though the same password/cert worked fine via
   `tizenjs`.
3. Attempted fix: re-encrypt the author `.p12` to an older,
   Java-compatible PKCS#12 cipher (`PBE-SHA1-3DES`) before Tizen Studio
   reads it, since Tizen Studio's bundled Java crypto can't read modern
   OpenSSL 3.x's default AES-256 PKCS#12 encryption. Didn't resolve it on
   its own — the `-legacy` flag needed for that re-encrypt/export step
   was missing from the *earlier* decrypt-to-PEM step too, so the
   pipeline still failed reading the incoming cert before it ever got to
   re-encrypting it.
4. **Actual fix, two parts:**
   - Build-side: add `-legacy` to *both* `openssl pkcs12` invocations
     (decrypt-to-PEM and re-encrypt-to-export), not just the export one —
     some freshly-generated certs' PKCS7 "Encrypted data" bag uses
     `RC2-40-CBC`, which OpenSSL 3.x's default provider can't even read
     without `-legacy`, independent of the AES-256/3DES issue above.
   - Cert-side: the specific `.p12` reused from the `TizenYouTube` sibling
     project (see point 1) never actually worked *as an install*, even
     after the build-side fix — a **fresh, dedicated** author certificate
     (never used to install a different app on the same TV) was required.
     Reusing a cert across different installed apps on one TV appears to
     cause on-device install problems distinct from any build/signing
     error — consistent with this repo's existing convention of never
     reusing app identities/certs across projects (see "Conventions"
     below). Generate a new cert per app, don't reuse one from another
     project even if it builds/signs without error.
   - Also worth knowing: GitHub's **Re-run failed jobs** stays pinned to
     the workflow file as it existed at that run's original commit — it
     will *not* pick up a workflow fix merged afterward. Use **Run
     workflow** (`workflow_dispatch`) or a new tag to actually test a fix.

**Standalone runtime issues on-device — open, one fix attempted.**
Reported 2026-08-02 after the install issue above was fixed:
- **Tizen 5.5:** app shows the TizenTube splash + loading bar, then hangs
  indefinitely — never finishes loading. Also reproduces with upstream's
  own published build, so this isn't a regression from anything in this
  fork; likely an old-WebKit-engine incompatibility somewhere in the
  proxy/injection path. Not yet root-caused.
- **Tizen 6.5:** regression specific to this fork's standalone build —
  upstream's `.wgt` works fine on the same TV, but this fork's build
  crash-loops: after a TV reboot the app opens then immediately closes;
  on subsequent launches it loads then restarts, repeating; sometimes it
  fails to open at all.

  **Babel transpilation ruled out.** This fork's `standalone/service/` had
  a Babel transpile step (PR #607) that ran over the *entire*
  `standalone/service/` directory including `node_modules` (minus a
  handful of excluded packages), transpiling `express` and its ~30
  transitive dependencies — code never written or tested with that in
  mind, and it never actually fixed the Tizen 5.5 hang it was added for.
  Reverted back to upstream's approach (`ncc`-bundle `index.js` directly,
  no Babel) and retested on-device — **no change on either TV**, so Babel
  was not the (or not the only) cause of either issue. Both problems are
  still fully open.

  **Next step: remote logging added for standalone mode** (2026-08-02),
  specifically to stop guessing blind. `standalone/service/index.js` now
  self-logs its own lifecycle (process start, `app.listen`
  success/error, DIAL service `require()` success/error, `uncaughtException`/
  `unhandledRejection`, proxy errors, first `/tv` request received) to a
  hardcoded `DEFAULT_LOG_HOST`/`DEFAULT_LOG_PORT` (currently
  `192.168.50.57:3030`) — unconditional, no reliance on the page/userscript
  ever loading, since the 6.5 crash happens before that point. The
  userscript's existing `logServer.js` also gained a standalone-mode path
  (`POST /tizentube/log` on the local service, which relays to
  `logServerHost`:`logServerPort`, configurable via the RED-key theme
  overlay) for once the page *does* load. Same `/tv-log` payload shape as
  TizenBrew's `remoteLogger.js`, so the receiver script at
  `scripts/log-receiver/receiver.ps1` works unmodified for both.

  **Tizen 6.5: DIAL service crash fixed, but that wasn't the whole story.**
  `dist/service.js`'s DIALServer constructor was throwing
  `crypto.getRandomValues() not supported` (uuid's browser-targeted rng,
  no Web Crypto on Tizen's old Node service runtime) — fixed by
  polyfilling `global.crypto.getRandomValues` with Node's own
  `crypto.randomBytes`. Confirmed via a real device log: `dist/service.js`
  now loads cleanly. But the user then clarified the actual observed
  pattern more precisely: **both TVs fail to send any logs (or reach the
  service) on the very first launch, and only work after the app
  auto-relaunches once** — 6.5 reliably gets through that one retry, 5.5
  never does (matches the original bug report: the splash/progress bar
  just hangs forever on 5.5). So this looks like a **first-launch
  service-startup timing race**, not (only) the DIAL crash.

  Comparing `standalone/config.xml` against `TizenBrew`'s own config.xml
  — TizenBrew reliably starts its service on *both* TVs, no retry needed —
  found it has a `<tizen:app-control>` block with Samsung's
  `eden_resume` operation and `reload="disable"` that ours was completely
  missing, plus `recorder`/`mediacapture`/`unlimitedstorage` privileges
  that PR #608 had removed as "unused" (present in both TizenBrew's and
  upstream's TizenTube's config.xml — removing them may have affected
  more than privilege gating). Added the `app-control`/`eden_resume` block
  and restored those three privileges to match. Also restructured
  `standalone/service/index.js` so logging infrastructure (which only
  needs Node's core `http` module) is set up *before* requiring
  `express`/`node-fetch`/`./injector.js`, with each of those requires
  wrapped individually (`safeRequire`) — previously, if any of those threw
  synchronously (plausible on 5.5's much older Node, since these packages
  likely assume newer Node APIs no amount of transpilation can add), it
  would happen before any logging existed to catch it, which is
  consistent with 5.5's total blackout. **None of this is confirmed
  on-device yet** — next session needs a real retest on both TVs to see
  whether first-launch startup is now reliable, and if 5.5 still produces
  zero logs, whether `safeRequire`'s per-require logging finally shows
  which one fails there.

  Also found, still unresolved/unconfirmed either way: `app.onRequest is
  not a function` fires repeatedly every launch (from Tizen's own service
  runner) but doesn't crash the process — likely benign, since neither
  our nor upstream's `standalone/service/index.js` implements that
  handler and upstream still works; and one `Cannot find context with
  specified id` from the CDP injector, a normal context-invalidation race
  that seems to resolve itself once a fresh execution context appears.
  Neither is proven unrelated to the retry-need — worth re-reading the
  log after the startup-timing fixes above land, not assumed irrelevant.

  **Standalone-mode detection was also wrong for the CDP-injection path.**
  `window.location.hostname === 'localhost'` (used by `logServer.js` and
  the RED-key theme overlay in `mods/ui/ui.js` to decide whether to show/
  use the standalone log relay) only covers the *proxy* path. The
  CDP-injection path (`injector.js`) navigates Cobalt directly to real
  `https://youtube.com/tv` — this TV has debug mode reachable, so it
  always uses that path — meaning `hostname` is never `'localhost'`
  there, so the host/port fields never showed and page-level logs never
  sent (they fell through to the TizenBrew-only branch, which has nothing
  listening on `127.0.0.1:8081` in pure standalone, and silently
  queued/dropped). Fixed by having `injector.js` set `window.__ttStandalone
  = true` before evaluating the userscript, and checking that in addition
  to the hostname in both places.

  **Confirmed on-device (2026-08-02): the mixed-content risk was real.**
  Host/port showed correctly and a manual test log appeared in
  TizenTube's own on-screen debug console (unrelated to network delivery),
  but nothing reached the PC receiver — the direct fetch from
  `https://youtube.com` (page origin) to `http://localhost:8099` (target)
  is cross-origin *and* HTTPS-page-to-HTTP-target, which Cobalt blocks
  silently. Fixed by not attempting that fetch on this path at all:
  `logServer.js` now pushes into `window.__ttLogQueue` instead (tagged
  with `__ttLogHost`/`__ttLogPort`), and `injector.js` drains it once a
  second over the same CDP connection already open for injection
  (`pollLogQueue`, threaded through `startDebugger`/`connectToDebugger`) —
  same technique TizenBrew's own service uses for the equivalent problem.
  The proxy path (`hostname === 'localhost'`) is unaffected — same-origin
  plain HTTP, no restrictions — and still uses the direct fetch.

  **Found a bug in `pollLogQueue` itself (2026-08-03), via a #631 retest
  on Tizen 6.5 that still hung after "Taking CDP-injection path."** The
  `setInterval` had no lifecycle tied to the CDP connection it depends
  on — once that connection closed (page navigation, app exit, etc.),
  every subsequent tick threw an unhandled `WebSocket.send... not
  opened` rejection on the *same* `Chrome.send`/`enqueueCommand` path
  the real userscript-injection `evaluate()` call uses. Timing lined up
  exactly with the poll's first tick, not the injection call itself.
  Fixed two ways: the interval now clears itself on the client's
  `'disconnect'` event, and as a defensive fallback (in case that event
  doesn't fire reliably) after 3 consecutive failures; it also no longer
  starts immediately alongside `Page.navigate()` — only after the first
  successful injection `evaluate()`, so it can't interfere with that
  critical early window at all, by construction rather than just cleanup.
  **Not yet retested on-device — for either this fix or the CDP delivery
  mechanism itself.** Note: the pre-existing `Cannot find context with
  specified id` / `not opened` timing races in the injection handshake
  itself (separate from this polling bug) were already known and
  unresolved before any of this logging work existed — this fix removes
  one source of instability but may not be the whole story for why 6.5's
  CDP handoff still isn't fully reliable.

  **Separately found, on Tizen 6.5 (2026-08-03): a real dead-end bug in
  `useInjectorOrProxy()`, unrelated to anything above.** A device log
  showed `getState` returning `{"canConnectToDaemon":true,"isConnecting":
  true}` — a state `standalone/index.html`'s `if (canConnectToDaemon &&
  !isConnecting) {...} else if (!canConnectToDaemon) {...}` had no branch
  for at all, so it silently did nothing. `isConnecting` is a
  module-level variable in `injector.js`, only ever reset to `false`
  inside a *successful* CDP connection callback — if an attempt stalls
  (the ADB shell command never produces a `debug` line, or
  `connectToDebugger`'s own connection retry loop never succeeds), it
  stays `true` forever, and since the service is a long-running
  background process that survives the foreground app closing/reopening,
  this stuck state persisted across every subsequent launch until a full
  TV reboot killed the service process — matching exactly what was
  reported (hangs after `getState`, only clears on TV reboot). Fixed two
  ways: `index.html` now retries (`setTimeout(useInjectorOrProxy, 1000)`)
  instead of silently doing nothing on `canConnectToDaemon && isConnecting`;
  `injector.js` now sets a 20s safety timeout when `isConnecting` is set
  `true` that force-resets it, bounding the worst case instead of a
  permanent hang.

  **Confirmed on-device (2026-08-03) that this retry logic works** — a
  6.5 log showed the retry loop firing every second and correctly
  recovering once the 20s timeout reset `isConnecting`. But the *next*
  debug-launch attempt then hit `Uncaught exception: ReferenceError:
  packet is not defined` in `AdbHostClient._onPacket`, followed by
  `ECONNRESET`, and the app never actually opened — a **regression from
  the blanket `"use strict"` prepend above**. `adbhost`'s own bundled
  code does `packet = this._packet;` with no declaration at
  `_onPacket`'s first line — a genuine pre-existing bug in that package,
  harmless in sloppy mode (silently creates an implicit global) but a
  `ReferenceError` in strict mode. Patched via a build-time regex in
  `build-service.js` (`packet = this._packet;` → `var packet = ...`),
  the same pattern already used there for two other bundle post-processing
  fixups. **Not yet retested on-device — for either the isConnecting fix
  or this one.**

  **Also added: earlier diagnostics for Tizen 5.5's still-total
  blackout.** All service-level self-logging lives inside
  `standalone/service/index.js`, which only runs once the service
  actually starts — if the *service* itself never starts on 5.5 (or
  `launchAppControl`'s callback never fires at all), none of that logging
  ever gets a chance to run. `standalone/index.html` now has its own
  minimal `sendLog()` (plain `fetch`, hardcoded to the same default
  receiver, no dependency on the service) logging at the earliest
  possible points: script start, right before `launchAppControl`, inside
  both its success and error callbacks, and at each branch of
  `useInjectorOrProxy()`'s `getState` resolution.

  **This diagnostic paid off (2026-08-02): on Tizen 5.5, all of
  `index.html`'s own log lines arrive fine — script start,
  `launchAppControl` success, `useInjectorOrProxy()` called — but
  `getState` fails every single time with `Failed to fetch`, across many
  rapid retries (the "progress bar keeps resetting" the user described
  is `index.html`'s own `window.location.reload()` firing every ~1.5s).
  Critically, not one single `[StandaloneService]` log line ever
  appeared — not even the very first one, which is the first statement
  after `require('http')`. Since that's wrapped in nothing but plain
  top-level code, the only way for it to never fire is if
  `service/dist/index.js` never got that far — most plausibly, Node
  failed to *parse* the file at all. A parse-time `SyntaxError` happens
  before any code in that file runs, including its own try/catch, so it
  can't self-report — and the huge `ncc` bundle includes not just this
  app's own code but all of `express`/`node-fetch`/`adbhost`/
  `chrome-remote-interface`'s code too, none of which was written with
  Tizen 5.5's older Node in mind.**

  Fix attempt: split the service entry into two files.
  `standalone/service/bootstrap.js` is deliberately plain ES5 (`var`/
  `function`, no arrow functions/template literals/const/destructuring)
  and is copied through to `dist/index.js` *unmodified* — no `ncc`
  processing, so it can't itself be the thing that fails to parse. It
  `require()`s the real bundle (now built to `dist/bundle.js` instead of
  `dist/index.js`) inside a try/catch. A `SyntaxError` while parsing a
  *required* file **is** catchable by the requiring file, unlike a parse
  error in the top-level file being executed — so if the bundle still
  fails to parse on 5.5, this should now at least produce one loggable
  line (`require('./bundle.js') FAILED: ...`) instead of total silence.
  **Confirmed on-device (2026-08-02) — the bootstrap paid off immediately.**
  `bootstrap.js starting, node v4.4.3` logged successfully, then:
  `require('./bundle.js') FAILED: SyntaxError: Block-scoped declarations
  (let, const, function, class) not yet supported outside strict mode`.
  A well-known Node 4.x V8 limitation: block-scoped `let`/`const`/
  `function`/`class` only work inside strict-mode code on that engine.
  `ncc` wraps each bundled module in its own function, so one module's
  own `"use strict"` (e.g. this app's `index.js`) doesn't cover sibling
  modules like `express`/`node-fetch`/`adbhost`/`chrome-remote-interface`,
  most of which don't declare it themselves. Fixed by prepending
  `"use strict";` as the literal first line of the *entire* bundled
  output in `build-service.js` — nested functions lexically inherit
  strict mode from their enclosing scope, so one directive at the true
  top of the file covers every bundled module.

  **Retested (2026-08-03): fixed that specific error, but not the whole
  problem — a *different* parse error surfaced next:**
  `SyntaxError: Unexpected token {`, no line number available (V8
  doesn't attach one to a parse-time error thrown this way). Forcing
  strict mode only fixed the one class of syntax it specifically
  targets; there's evidently at least one more ES6+ construct somewhere
  across the ~30 bundled dependencies that Node 4.4.3's parser rejects
  outright, strict mode or not. Also caused a real regression on Tizen
  6.5 — see the `adbhost` `packet` bug fix above; forcing strict mode
  turns other packages' latent sloppy-mode-only bugs into hard failures.

  **Resolved (2026-08-03): user chose to reintroduce Babel, deliberately
  differently from the previous attempt.** The original Babel step
  (reverted earlier — see above) ran Babel over the *whole*
  `standalone/service/` source tree, including `node_modules`, *before*
  bundling — that transpiled `ncc`'s own huge internals (~25 minute
  builds) and crash-parsed unrelated test fixtures elsewhere in
  `node_modules`. This time, `build-service.js` runs Babel on the
  *already-bundled* single output file instead, targeting `node: '4.4.3'`
  specifically via `@babel/preset-env`. The final bundle contains
  neither `ncc`'s own tooling nor any test fixtures — only the runtime
  code paths `ncc` already tree-shook down to — so neither previous
  problem applies. Verified locally: build completes in seconds, output
  has zero `regeneratorRuntime` references (no reachable async/await
  needing it), and manual inspection confirmed no real `let`/`const`/
  arrow-function syntax survives (only false-positive substring matches
  inside comments/JSDoc/embedded JSON documentation strings, e.g.
  `chrome-remote-interface`'s bundled protocol definitions). The earlier
  "use strict" prepend and `adbhost` patch are both kept (order:
  regex fixups → Babel → "use strict" prepend on Babel's output) — Babel
  should make the strict-mode prepend largely redundant now (its
  Node-4-targeted output uses `var`, not `let`/`const`), but it's
  harmless to keep, and it already caught one real latent bug
  (`adbhost`'s own undeclared `packet` assignment) by turning a silent
  sloppy-mode footgun into a loud, fixable error.

  **Confirmed on-device (2026-08-03): this fully solved Tizen 5.5's
  parsing problem.** `bootstrap.js starting, node v4.4.3` →
  `bundle.js required successfully` → `Standalone service listening on
  127.0.0.1:8099` — no more SyntaxErrors of any kind. 5.5's standalone
  service now starts reliably.

  It surfaced the *next* problem in the chain, though, common to both
  TVs: once `getState` resolves and the CDP-injection handoff begins,
  a device log showed `Unhandled rejection: Error: 'Page.setBypassCSP'
  wasn't found` — Cobalt's CDP implementation on this device doesn't
  support that protocol method at all — immediately followed by the
  same `not opened` / `ECONNRESET` pattern seen on 6.5 in every log so
  far, even ones from before any of this session's logging/fixes
  existed. Compared against TizenBrew's own `debugger.js` (reliably
  works on both TVs): it **never calls `Page.navigate()` or
  `Page.setBypassCSP()` at all** — it attaches to a YouTube TV instance
  already launched through normal means and injects via a script tag
  (with an eval-based fallback for Trusted Types), whereas
  `injector.js` spawns a *fresh* debug-mode instance via ADB and
  immediately drives its navigation via CDP — a structurally different,
  more timing-sensitive sequence TizenBrew's architecture sidesteps
  entirely. Fixed the immediate bug (both `Page.navigate()` and
  `Page.setBypassCSP()` had no error handling, so either failing
  produced an unhandled rejection) and made `setBypassCSP` explicitly
  non-fatal — injection here is `Runtime.evaluate()` of the userscript
  text directly, not a page-loaded `<script src>` that CSP would
  actually block, so that call was likely never load-bearing for this
  approach in the first place.

  **Real breakthrough (2026-08-03), from a `Clear Cache`/`Clear Data`
  experiment the user ran on-device.** Both TVs showed the exact same
  pattern: standalone works *exactly once* after any cache clear, then
  breaks on every subsequent launch until the cache is cleared again —
  reproduced repeatedly on both. Critically, a full TV **reboot alone
  did not fix it** (rules out anything in-memory — `isConnecting`, the
  CDP connection, any Node process state — none of that survives a
  reboot anyway), only clearing the app's cache did. This happens on
  the pure CDP-injection path (real `youtube.com`, no proxy/URL-
  rewriting involved at all), so it's not this app's own rewriting
  logic either.

  This explains *why TizenBrew doesn't hit this*: its `debugger.js`
  never calls `Page.navigate()` — it attaches to the actual native
  YouTube TV app, launched fresh each time through Tizen's own normal
  app-launch mechanism, a completely separate Tizen application with
  its own isolated WebView profile that the platform tears down and
  recreates properly on each launch. This app's approach is
  structurally different: `Page.navigate()` redirects the *same*
  WebView instance belonging to this app's own package
  (`krx3dTtSt1.TizenTubeStandalone`) to `youtube.com/tv` rather than
  launching a genuinely separate app — every relaunch reuses the same
  on-disk cache/profile tied to this app's package ID. First navigation
  is a clean cold load (works); the second reuses a now-warm cache from
  the previous run, and something about that warm cache breaks YouTube
  TV's own initialization.

  First fix attempt: `client.Network.setCacheDisabled({ cacheDisabled:
  true })` before `Page.navigate()`. **Confirmed on-device: did not
  resolve it** — a genuinely fresh app update ("worked once, broke
  again on reopen, cache-clear fixes it") reproduced the exact same
  pattern. Root cause of why: `setCacheDisabled` only stops *new*
  caching for the current session going forward — it does nothing about
  what's already cached/stored from the previous run, which is exactly
  what a stale second load would be reading. Also, the user separately
  found that on Tizen 5.5, clearing cache alone sometimes wasn't
  enough — clearing *data* (not just cache) was sometimes required —
  meaning this may not be HTTP-cache-only, and could involve
  localStorage/cookies/IndexedDB/service workers too, none of which
  `Network.setCacheDisabled` touches.

  Second fix attempt (2026-08-03): actively **clear** cache/cookies/
  storage before navigating, rather than just disabling new caching —
  replicating what the user's manual Clear Cache/Clear Data TV action
  does, programmatically, on every single launch. Chain (each step
  independently non-fatal, all proceed to `Page.navigate()` regardless
  of outcome — `Page.setBypassCSP` already turned out not to exist on
  this Cobalt CDP implementation, other domains may be similarly
  incomplete): `Network.enable()` → `Network.setCacheDisabled()` →
  `Network.clearBrowserCache()` → `Network.clearBrowserCookies()` →
  `Storage.clearDataForOrigin({ origin: 'https://www.youtube.com',
  storageTypes: 'cookies,local_storage,indexeddb,cache_storage,
  service_workers,websql' })` (only attempted if the `Storage` domain
  exists on this client at all) → then `Page.navigate()`, which now
  waits for this whole chain rather than firing immediately alongside
  it. **Confirmed on-device: did not resolve it either** — same
  "works once, breaks on reopen" pattern reproduced again on retest.

  **Reframing (2026-08-03), from a genuinely new piece of evidence: the
  user reported TizenBrew — a completely separate app/service, sharing
  no code with this one — hits the identical "closes itself, needs
  several relaunches before it works" pattern when this is happening.**
  That rules out anything specific to *this app's own code* as the sole
  cause of the underlying flakiness; it points at something systemic in
  how the SDB debug daemon / Cobalt's CDP session handling behaves
  across successive debug-session requests, possibly a limited/shared
  per-device resource (the user's own hypothesis, and a plausible one:
  a debug session or port this app fails to release could starve
  *any* app's next attempt, not just its own — clearing cache/data
  likely force-kills this app's service process, releasing whatever it
  was holding).

  The architectural difference that actually matters, revisited:
  TizenBrew's `debugger.js` retries internally (up to 15 attempts, with
  a session-id-supersession scheme so old retry loops abort cleanly
  once a newer one starts) entirely on its own — the user doesn't do
  anything except keep the app open. This app's `index.html` instead
  calls `tizen.application.getCurrentApplication().exit()` immediately
  after *triggering* the debugger, with no confirmation it actually
  succeeded — if that attempt then fails, there's nothing left alive to
  retry from, so the user has to manually relaunch the whole app every
  single time (the "reopen ~5 times" they were doing).

  Fix: ported the same pattern into `injector.js`.
  - `_activeSessionId` + a `sessionId` threaded through `startDebugger`/
    `connectToDebugger`: a fresh top-level call supersedes any retry
    loop still in flight from a previous one; superseded attempts abort
    silently (checked before acting at every async boundary: after
    `canConnectToDaemon()`, on ADB stream connect, on CDP connect, in
    the connectivity-retry catch).
  - Up to `MAX_RETRY_ATTEMPTS` (10) automatic retries at
    `RETRY_DELAY_MS` (750ms) apart, triggered by `retryOrGiveUp()` from:
    CDP disconnecting before injection succeeded, the injection
    `evaluate()` call failing, or `Page.navigate()` failing. All of this
    happens entirely service-side — the foreground app has already
    exited by the time these fire, so no user action is needed for a
    retry to happen at all.
  - `isConnecting`'s 20s safety-timeout is now re-armed on every retry
    attempt (not just the first), so the timeout window scales with the
    actual retry budget instead of assuming one attempt is enough.
  - Explicit cleanup on every failure path, not just relying on the
    natural `'disconnect'` event (which doesn't fire if an `evaluate()`
    call rejects without the connection itself dropping): the CDP
    `client.close()`s before retrying, and the ADB stream now always
    gets ended (a 5s fallback timeout in addition to the existing
    success-path `.end()`) — previously it only ended inside the
    `dataString.includes('debug')` branch, leaving it open indefinitely
    on any attempt where that never matched. This is the part directly
    responding to the user's leaked-resource hypothesis — if true, this
    should also reduce how often TizenBrew needs multiple relaunches
    during the same broken window, not just this app.

  **Resolved (2026-08-03) — not by fixing the CDP path, but by confirming
  the proxy path doesn't need it.** Tested on-device: with the TV's
  Developer Mode "Host PC IP" set to anything other than `127.0.0.1`
  (a real PC IP, or unset), `canConnectToDaemon()` correctly returns
  `false`, `useInjectorOrProxy()` takes the proxy path instead of CDP,
  and it has been **reliable on both Tizen 5.5 and 6.5** — clean
  `getState` → `Taking proxy path` → `Received GET /tv` every single
  time, no errors, no retries needed, repeated launches all succeeding.
  This is a stronger result than any of the CDP-path fixes above
  achieved. **README.md now explicitly documents not setting Host PC
  IP to `127.0.0.1`** for this reason. The CDP path and all the fixes
  above are still there (harmless, and useful if `127.0.0.1` is ever
  set for other reasons) but the proxy path is what actually works
  reliably — this isn't a "pick one" architectural decision so much as
  an operational finding: don't configure the TV in the way that
  triggers the unreliable path.

  Trade-off surfaced immediately: TizenBrew and TizenBrewInstaller
  (separate repos, separate apps) apparently *also* require Host PC IP
  `127.0.0.1` for their own local SDB-based mechanisms (TizenBrewInstaller
  needs it to install/update packages) — so a TV configured for
  standalone's reliable proxy path can no longer install updates via
  those tools without switching Host PC IP back and forth. Whether
  those tools can be given an equivalent non-CDP path is a separate,
  cross-repo question the user raised — see those repos' own
  documentation/AGENTS.md if that work happens, not this one.

  Also fixed while investigating: `standalone/index.html`'s
  `launchAppControl` error callback previously only showed an `alert()`
  and stopped — confirmed on-device, right after a TV reboot,
  `launchAppControl` can genuinely fail once (Tizen's own service-launch
  subsystem still warming up; took ~5s to succeed vs. the usual <1s in
  every other observed launch) and require a manual close/reopen to get
  past. Now retries automatically after 1s, matching the pattern the
  `getState`-fetch-failure path already used.

  Also added, per user request: a read-only `Receiver: {{host}}:{{port}}`
  subtitle on the native "Remote Log Server" settings menu item (`mods/ui/
  settings.js`, `en.json`/`de.json`), since the native TV settings menu has
  no free-text entry — editing the actual host/port still only happens via
  the RED-key theme overlay.

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
- In `standalone/service/` (bundled by `ncc`, no `node_modules` deployed
  on-device — everything must end up inlined into the single
  `dist/index.js`): every `require(...)` call must keep a literal string
  argument, never a variable. `require(path)` with `path` as a variable
  can't be statically analyzed/inlined by `ncc`, so it falls through to
  real Node module resolution at runtime and fails with "Cannot find
  module" — this actually broke every launch on Tizen 6.5 once already
  (a `safeRequire(name, path)` diagnostic helper introduced this exact
  mistake). If you need a per-dependency try/catch wrapper for
  diagnostics, wrap each literal `require('x')` call individually rather
  than passing the module name through a shared helper function.
