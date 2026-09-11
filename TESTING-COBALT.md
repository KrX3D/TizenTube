# Cobalt test build

Testing branch for upstream's Cobalt approach (`reisxd/TizenTube` commit
`e63455ea`), sitting on top of this fork's `main`. Not for merging as-is.

## What it changes

Instead of injecting into Samsung's YouTube app over CDP, or proxying
youtube.com through the service, this launches **Samsung's own Cobalt runtime**
pointed at a local MITM proxy:

- `config.xml` declares the app as native Cobalt (`pkgid=com.samsung.tv.cobalt`)
  and passes it a command line, including a proxy flag aimed at `127.0.0.2:8101`.
- `utils/cobaltSetup.js` copies Cobalt's read-only content directory to
  `/home/owner/share/tizentube-content` and generates and installs a CA.
- `utils/cobaltProxyServer.js` mints a leaf certificate per hostname, so it can
  decrypt and rewrite YouTube's own HTTPS and inject the userscript.

No debugger, no `shell:0 debug`, and therefore none of the relaunch behaviour
that path brings: no app reopening itself, no foreground stealing, no
`isConnecting` to get stuck.

The service falls back to this fork's existing DIAL/proxy path whenever
`cobaltSetup()` returns false — no Cobalt content directory, or certificate
generation or installation failing — so a TV this does not suit behaves as it
does on `main`.

## Version scheme

Test builds use the **x5 series** so they cannot be confused with `main`:

| branch | series | example |
| --- | --- | --- |
| `main` | `.10`, `.20`, `.30` | `1.30.20` |
| this branch | `.15`, `.25`, `.35` | `1.30.15` |

`package.json` is set to `1.30.15`. The bump adds 10, so a later build here
becomes `1.30.25`, and so on — the odd series stays odd and the two never
collide on npm or in the release list.

## Building a `.wgt`

The standalone workflow checks out whatever branch it is dispatched from:

1. Actions → **Build TizenTube Standalone and Release** → **Run workflow**
2. Set **Use workflow from** to `test/cobalt-upstream`
3. Leave the version blank to take `1.30.15` from `package.json`, or type one

## Two packages from one tree

`node build-service.js remove-cobalt-flags` strips the three Cobalt metadata
entries from `config.xml`, so the same source can produce both the Cobalt
package and a plain one. Build the Cobalt `.wgt` first, run that, then build
the plain one. It writes `config.xml.bak` first, so a local run is reversible.

The workflow here does **not** yet build both — it produces the Cobalt package
only. Adding the second output is a follow-up once this one is known to work.

## Known gaps

- **Untested on hardware.** Everything here is a port plus a syntax and
  interface check; the Cobalt path cannot be exercised off-device at all.
- `utils/https.js` is vendored from upstream unchanged (736 lines) and has not
  been reviewed line by line.
- Our `injector.js` stays where it is rather than moving to `utils/` as upstream
  did, to keep this branch's diff against `main` readable.
- Upstream also moved the service port 8099 → 8100. Kept at 8099 here, since
  nothing in this fork requires the move and `index.html`, `logServer.js` and
  `syslog.js` all reference it.
