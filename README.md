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
- **The TV's Developer Mode "Host PC IP" setting picks between standalone's two internal paths, and both have known problems — there is no simply-correct setting.**
  - `127.0.0.1`/localhost → the CDP/SDB-based injection path (`standalone/service/injector.js`, connects to the real `youtube.com` directly). Extensively tested and found unreliable at the *connection* level on both Tizen 5.5 and 6.5 (works once, then fails on every subsequent launch until the app's cache is cleared) — see `AGENTS.md` "Known unresolved issues" for the full investigation and the fixes attempted so far.
  - Anything else (a real PC IP, or unset) → the local-proxy path (`standalone/service/index.js`, rewrites and proxies YouTube's traffic through `localhost:8099`). Connects reliably, but carries a real, confirmed-on-device risk: YouTube's own servers can detect the proxied traffic pattern as suspicious and throw up a verification challenge that stops video playback entirely — sometimes not immediately, but after the app's already been working for a while. This is *not* a bug we can straightforwardly fix: it's why upstream added the CDP injector in the first place (commit `c497c059`, "Since fixing #555 and #561 would be starting a cat and mouse game between me and YT, I think it's better to do it the old way") rather than continuing to patch the proxy path directly.
  - This also has a practical side effect: `127.0.0.1` is the *same* setting TizenBrew and TizenBrewInstaller need for their own local SDB-based mechanisms (module injection, package installs), so a TV configured for standalone's proxy path can't use those without switching back and forth.

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

Everything below is toggleable from the in-app settings menu (**green button** on
the remote, or `G` / `F2` / `2` when testing in Chrome). This fork carries a
number of features that upstream TizenTube does not — those are marked
**(fork)**.

Each row is one settings-menu entry; where an entry has its own sub-menu, its
options are described in the row rather than listed separately.

## Blocking and filtering

| Feature | What it does |
| --- | --- |
| Ad Block | Removes video ads, ad slots, and the masthead/banner ad on Home |
| [SponsorBlock](https://sponsor.ajay.app/) | Skips sponsor, intro, outro, self-promo, interaction, filler, preview and non-music segments. Each category can be set to auto-skip, skip manually, or ignore, with optional toasts. Highlights (jump to the video's main point) can be enabled separately |
| Hide End Screen Cards | Removes the suggested-video cards overlaid at the end of a video |
| "Includes paid promotion" overlay | Toggle the paid-promotion banner |
| Hide Members-Only Videos **(fork)** | Filters videos you can't watch without a channel membership out of shelves and grids |
| Hide Paid Videos **(fork)** | Filters videos that have to be rented or bought ("Kostenpflichtig") |
| Hide Free Films With Ads **(fork)** | Filters the free, ad-supported films YouTube mixes into rows and into the list beside the player |
| Hide Channel Shelves **(fork)** | Removes whole channel-recommendation shelves from feeds |
| Hide Feedback Surveys **(fork)** | Removes YouTube's in-feed "help us improve" survey cards |
| Hide Duplicate Videos **(fork)** | Removes a video from a page when it has already appeared higher up, keeping the first occurrence. Rows left empty by this are dropped too. Never applied on the watch page or inside a playlist, where repeats are meaningful |
| Hide the Combined Subscriptions Row **(fork)** | Subscriptions opens with one long row ("Relevanteste") holding videos that also appear in the per-channel rows below it. Because the duplicate filter keeps the first copy, that row would win every tie and the rows below it would empty out, collapsing the page into one row. This removes the combined row instead, so the per-channel rows survive. Identified by the overlap between rows, not by its title, which is localised |
| Hide the Music Row **(fork)** | Removes the YouTube Music row on Home ("Noch mal anhören" with its "Mehr Musik" link), identified by where it points rather than by its title |
| Hide Videos by Title Keyword **(fork)** | Hides videos whose title contains one of the keywords. Ships with a list aimed at AI-generated uploads — see "Title keyword filter" below — and you can replace it with your own. Matched case-insensitively anywhere in the title, except a single short word, which is matched on word boundaries so "ai" does not hide "Thailand" |
| Hide View Counts **(fork)** | Takes the view count off every tile, and cleans up the separator it leaves behind. Matched on the response fields rather than on the word "views", so it works in any language |
| Hide 4K/8K and Dubbed Badges **(fork)** | Removes the resolution and auto-dubbed badges from tiles. A badge it does not recognise is logged with its wording, so an unlisted one can be added |
| Hide Special Playlists **(fork)** | Hides Liked Videos and/or Watch Later from the Library and Playlists pages |
| Enable Shorts | Off by default — Shorts shelves and Shorts tiles are stripped from every surface |

## Watched-video handling

| Feature | What it does |
| --- | --- |
| Hide Watched Videos | Hides videos you've already watched. Configurable watched-percentage threshold, and per-page control over where it applies (Home, Search, Subscriptions, Channel pages, Library, individual playlists, History, Music, Gaming, More, Watch) |
| Playlist Batch Load **(fork)** | Loads a playlist's later batches up front instead of only as you scroll, so hide-watched can act on the whole playlist rather than the first ~30 items. The number of batches fetched is capped by a configurable limit |

## Video player

| Feature | What it does |
| --- | --- |
| Preferred Video Quality | Locks playback to a chosen quality (or the next best available) instead of letting YouTube pick |
| Preferred Video Codec | Prefer VP9, AV1 or AVC1 when the video offers a choice |
| Auto Frame Rate | Matches the TV's output frame rate to the video, with a configurable pause duration while it switches (Tizen only) |
| Spoof Viewport Resolution **(fork)** | Reports a different screen resolution to YouTube. Useful when the TV reports a lower resolution to the browser than it can actually decode. Requires an app restart |
| Speed Settings Increments | Sets the step size used by the playback-speed control |
| Picture-in-Picture / Mini Player | Both available from the player options popup; the two buttons can be swapped |
| Screen Off | Blanks the screen while audio keeps playing — for using the TV as a music player |
| Hide Related Videos in Player | Removes the related/suggested-videos rail that slides in over the player, so a nudge on the D-pad during playback doesn't cover the video with recommendations |
| Number Keys Jump to Percentage | Pressing `1`–`9` jumps to that percentage of the video, `0` jumps to the start |
| Reload After TV Wakes **(fork)** | Reloads the page after standby. A short absence only rebuilds a dead player, fixing the frozen first frame; an absence over 5 minutes reloads whatever the player looks like, since the feed and its continuations were fetched before the TV slept. Waits for the network first, so it never lands on the webview's offline page. A sleep the platform announces no event for is caught by the wall-clock gap between heartbeat ticks |
| Player UI patching | Optional Previous/Next, Super Thanks, Ask, and Speed Controls buttons |
| Hide Player Buttons **(fork)** | Removes buttons from the action row under the player: Join/Membership, Subscribe, both Thumbs, Save, Comments, Description, Previous and Next. Each one is a separate toggle. Matched on the button types and the endpoints they run rather than on the labels, which are localised — the Description button is matched by the panel it opens, since the app calls it ABOUT_BUTTON internally while the screen reads "Beschreibung". The thumbs are one setting for both: the app sends a single button that draws them together, and it ignores the renderer's own `hideDislikeButton` flag (tested on Tizen 5.5 and 6.5), so neither half can be hidden on its own. A thumbs setting stored by an older build still hides them. Hiding Previous/Next wins over the setting that adds them |
| Show Time Remaining **(fork)** | Adds how much of the video is left to the player’s own duration readout: `42:17 · -12:04` |
| Show When the Video Will End **(fork)** | Adds the clock time the video finishes at: `42:17 · →14:35`. Follows the playback speed, and uses the same 12/24-hour setting as the on-screen clock. Both readouts together give `42:17 · -12:04 · →14:35` — the minus means time left, the arrow means "until" |
| Instant Seek **(fork)** | The seek bar keeps moving while you hold left or right instead of waiting for OK on every step; the seek commits by itself once you stop. The delay is configurable (250–1500 ms) |
| Stop at the End of a Playlist **(fork)** | At the end of a playlist, stops and offers to replay instead of playing an unrelated recommendation (or showing a black screen) |
| Return YouTube Dislike **(fork)** | Puts the dislike count back, on the thumbs-down button and in the description panel. Sends the id of every video you open to returnyoutubedislike.com, so it is off by default and the setting names the service |

## Thumbnails and titles

| Feature | What it does |
| --- | --- |
| [DeArrow](https://dearrow.ajay.app/) | Community-sourced, non-clickbait titles, with optional DeArrow thumbnails |
| High Quality Thumbnails | Upgrades tile thumbnails to `hqdefault`/`sddefault` |
| Video Previews | Hover/focus previews on tiles |
| Disable Enlarged Thumbnails | Stops the focused tile from scaling up |
| Enable Shrinked Thumbnails | Shrinks unfocused tiles instead |

## Interface

| Feature | What it does |
| --- | --- |
| Customizable Themes | Custom focus-container and route colouring (**red button**) |
| Clock | On-screen clock, 12/24-hour, optional seconds, and an option to hide it while a video is playing |
| Screen Dimming | Dims the screen after a configurable idle timeout, at a configurable opacity |
| Disable Sidebar Contents | Choose which sidebar entries to hide |
| Disable Channels on Sidebar | Removes subscribed-channel entries from the sidebar |
| Sort Sidebar Contents | Reorder the sidebar entries, and place channels you pinned there |
| Launch To on Startup | Choose which page the app opens to |
| Reload Home on Startup | Forces a fresh Home feed on launch |
| Library Tabs Buttons to Hide **(fork)** | Hides individual Library tabs (Music, Movies & Shows, Podcasts, My Videos, History, Watch Later, Playlists) |
| Sort Subscriptions Alphabetically | Alphabetical instead of YouTube's own ordering |
| Stop Bixby Interrupting Voice Search **(fork)** | Pressing the microphone button starts Bixby and YouTube’s own speech recognition at the same time, and Bixby’s "not understood" dismisses the YouTube result. This swallows the key for Bixby while a search is on screen; the mic button works as normal everywhere else |
| Transfer Settings **(fork)** | Copies your settings to or from another TV on the same network. The receiving TV lists only the settings that would actually change, each one something you can leave out, and keeps a one-step undo. Device-bound settings never travel. See "Transferring settings between TVs" below |
| Who's Watching Menu | Control whether the profile picker appears, including on app exit, and whether it stays permanently enabled |
| "Are you still watching?" prompt | Toggle YouTube's idle-playback interruption |
| Show Guest Sign In Reminder | Toggle the prompt asking a signed-out viewer to sign in |
| Show TT Welcome Message | Toggle the TizenTube toast shown on launch |
| Fix UI | Layout corrections for TVs that render the YouTube TV UI incorrectly |

## Long press menu

Long-pressing a tile opens a menu of actions for that video. Upstream offers a
fixed list of five; this fork makes the list configurable and adds entries to
it. The options live on their own settings page under Miscellaneous.

| Feature | What it does |
| --- | --- |
| Enable Long Press Actions | The menu itself. Play, Save to Watch Later, Save to Playlist, Add to Queue and Go To Channel |
| "Not interested" / "Don't recommend channel" **(fork)** | Restored to the menu. YouTube stopped sending them as menu entries, so they are rebuilt from the feedback panel it sends instead |
| Long Press Menu Entries **(fork)** | Choose which entries the menu shows. Entries YouTube itself put there are never hidden, since this fork did not add them |
| Sort Long Press Menu **(fork)** | Choose the order the entries appear in. Only this fork's entries are reordered; YouTube's own keep their position |
| Show Your Playlists in the Long Press Menu **(fork)** | Adds one entry per playlist of yours, so a video goes straight into it instead of through YouTube's picker. The menu shows at most 15 of them — past that it is quicker to use the picker |
| Playlists in the Long Press Menu **(fork)** | Pick which of your playlists appear there. Picking none means all of them, so the feature shows something before anything is chosen |
| Sort Playlists in the Long Press Menu **(fork)** | Choose the order your playlists appear in. A playlist deleted on YouTube drops out of both lists the next time the picker is opened |
| Share (QR Code) **(fork)** | Menu entry. Shows a QR code for the video, to carry it over to a phone |
| Play Next **(fork)** | Menu entry. Queues the video directly after the one playing, rather than at the end of the queue |
| Remove From This Playlist **(fork)** | Menu entry, offered only while you are inside one of your own playlists: removes the video from that playlist |
| Hide This Channel **(fork)** | Menu entry. Hides everything from that channel across the feeds. Matched on the channel name, because tiles do not carry a channel id |
| Hidden Channels **(fork)** | Lists the channels you hid, under Interface settings. Select one to show it again |
| Sort Playlists in the Long Press Menu **(fork)** | Choose the order your playlists appear in. A playlist deleted on YouTube drops out of both lists the next time the picker is opened |

## Subtitles

| Feature | What it does |
| --- | --- |
| Show Local Subtitle | Surfaces subtitles in your own language |
| Show Hidden Subtitles | Exposes tracks YouTube hides from the picker |
| Remember Caption Style **(fork)** | Persists caption font/size/colour settings across sessions and restarts |
| Stop Videos Turning Subtitles On **(fork)** | Removes the instruction some videos carry to switch subtitles on by themselves — auto-dubbed videos mostly. Not the same as remembering your caption choice: that restores subtitles you switched on and cannot counteract a video that forces them. Every subtitle track stays selectable by hand |

## Maintenance and diagnostics

| Feature | What it does |
| --- | --- |
| Updater | Checks for TizenTube updates, optionally on startup |
| Debug Console **(fork)** | On-screen log console (**yellow button**), with configurable corner position and height |
| Background Debug Logging **(fork)** | Keeps collecting logs with the on-screen console closed, so a problem can be captured without the console covering it |
| Log Detail Level **(fork)** | Basic keeps each line short; Detailed keeps the full payloads |
| Log Categories **(fork)** | Choose which parts log at all: navigation, ad blocking, Shorts, hide-watched, playlist loading, filters, shelves and tiles, thumbnails, player, and everything else |
| Log Subscriptions Shelf Layout **(fork)** | One-off diagnostic that records how the Subscriptions page is laid out, for chasing a layout problem on a specific TV |
| Syslog Output **(fork)** | Sends the same logs to a syslog server (an unRAID box, a router, anything that listens), with its own IP, port and connection test. Frames are RFC 5424, with the TV's model as the HOSTNAME field and `TizenTube` as APP-NAME, so a server that files by host writes one file per TV rather than one called after the page. A name typed into the settings overrides the model. Independent of the log server below, so one can be used without the other |
| Remote Log Server **(fork)** | Streams logs to a PC receiver for on-device debugging, with a built-in connection test |

Missing something? [Request it](https://github.com/reisxd/TizenTube/issues/new).

# Title keyword filter

*Hide Videos by Title Keyword* ships with a list, because a TV has no way to
type one in: a switch with an empty list behind it would do nothing. The
built-in list targets AI-generated uploads, which is what the feature was
written for:

```js
'ai generated', 'ai-generated', 'ai voice', 'ai story',
'ai animation', 'ai movie', 'ai video'
```

Switching the setting on is all that is needed. The list lives in
`mods/features/keywordHider.js`, not in the config defaults, so that it
reaches a TV whose stored config already holds an empty list from an earlier
build.

## Using your own keywords instead

Set `hiddenTitleKeywords` and it replaces the built-in list entirely —
anything you put there is taken as deliberate. From the debug console
(yellow button) or a Tampermonkey session:

```js
const c = JSON.parse(localStorage['ytaf-configuration']);
c.hiddenTitleKeywords = ['ai voice', 'reaction', 'tier list'];
c.enableKeywordHider = true;
localStorage['ytaf-configuration'] = JSON.stringify(c);
```

Then restart the app. Setting it back to `[]` restores the built-in list.

## How a keyword is matched

| Keyword | Matches | Does not match |
| --- | --- | --- |
| `ai generated` | "How I made an **AI generated** film" | "AI-generated" — which is why both spellings are in the list |
| `ai` | "Made with **AI**", "(**AI**) slop" | "She s**ai**d nothing", "Th**ai**land" |
| `generation` | "**Generations** of pasta" | — |
| `c++` | "What a **c++** video" | — (regex characters are taken literally) |

A keyword of four characters or fewer with no space in it is matched on word
boundaries, which is what keeps `ai` from sweeping up ordinary videos.
Anything longer, or containing a space, is matched anywhere in the title. All
matching is case-insensitive.

Every removal is logged under `filters.keywordHidden` (log category
**filters**) with the keyword and the title, so a keyword catching more than
you meant is easy to spot.

# Transferring settings between TVs

Under Miscellaneous → Transfer Settings. On the TV you are copying **from**,
open *Export*; on the other, open *Import*. The importing TV searches the
network, you pick the TV, and it then shows **only the settings that differ**
— each one a row you can untick:

```
What Would Change — 6 of your settings differ from Wohnzimmer

  Oberfläche
  [x] Shorts aktivieren         Aus  →  Ein
  [x] Uhr anzeigen              Aus  →  Ein
  [ ] Ausgeblendete Kanäle      4 Einträge  →  11 Einträge

  [ Import 3 settings ]   [ Alle abwählen ]
```

Two TVs that already match say so rather than showing an empty list. Nothing
is written until you confirm, and **Undo Last Import** puts back whatever the
last one changed.

What does not travel: anything tied to the machine rather than chosen — the
spoofed viewport resolution (two TVs with different panels want different
answers), the log and syslog addresses, and state such as the caption
backups. A setting with no row in the settings menu cannot be transferred at
all: if a value cannot be named and shown on screen, it is not something to
copy between TVs.

Sharing is held in memory only, never written to disk, and the route answers
nothing unless the Export screen is open — it closes when you leave it.

Works in standalone mode on both its paths, and in TizenBrew mode in a plain
HTTP context. In TizenBrew over HTTPS the page cannot reach any local server
in either direction, and the screen says so rather than hanging.

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
