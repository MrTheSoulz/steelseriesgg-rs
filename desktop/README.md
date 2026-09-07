# SSGG desktop

Local Electron 44 + React + TypeScript application. The renderer never talks to a network service, invokes a shell, reads arbitrary files, or imports test fixtures.

## Run

```sh
cd desktop
npm ci --include=dev
npm run build
npm start
```

Build the Rust `ssgg-desktop` binary first. Development defaults to `../target/debug/ssgg-desktop`. A developer can explicitly set `SSGG_SIDECAR` to an **absolute, trusted, non-group/world-writable** binary. The application spawns it with `--stdio`; no HTTP listener is started. Packaged applications ignore this override and require `ssgg-desktop` in `process.resourcesPath` (alongside the application bundle). This directory currently supplies source/build outputs, not a Linux installer.

Cargo outputs on group-writable development trees may have mode 775. The bridge refuses these. Install a copy into a private development artifact directory with mode 755 rather than weakening the check or changing someone else's build output:

```sh
install -m 755 /absolute/build/ssgg-desktop artifacts/ssgg-desktop
SSGG_SIDECAR="$PWD/artifacts/ssgg-desktop" npm start
```

The backend may need `SSGG_PACTL` pointing to a trusted pactl installation; the main process inherits the launch environment. Production packaging must provision its native dependencies and sandbox correctly.

## Safe inspection

`SSGG_READ_ONLY=1` in an unpackaged development launch adds `--safe-mode`, displays a read-only banner and disables mixer/profile mutations. It does not simulate devices. Initial application startup only calls `state.get`. The real backend's capability records determine what is displayed; no HID acquisition is initiated by this UI.

```sh
SSGG_READ_ONLY=1 SSGG_SIDECAR=/absolute/trusted/ssgg-desktop npm start
```

## Tests

```sh
npm test
npm run typecheck
npm run smoke
# Real Rust inventory only; no audio/HID mutations:
SSGG_SIDECAR=/absolute/trusted/ssgg-desktop xvfb-run -a node tests/live-readonly.mjs
# Design evidence, using an explicitly labelled separate test transport:
xvfb-run -a node tests/capture.mjs
```

`smoke` launches real Electron with **Chromium sandboxing enabled** and checks the renderer's Linux seccomp status, context isolation, absent Node integration, validated IPC, real JSON-lines process communication, native control bridge requests/read-back, profiles and tray lifetime. Audio mutation tests use `tests/fixture-sidecar.cjs` only; it is never a production fallback. `capture` also exercises the actual manufacturer-download/caching path and needs outbound access to that one official image URL. `live-readonly` uses the real Rust binary and current host inventory without mutation requests. Screenshots live under `../.impeccable/review`; test process artifacts are ignored in `artifacts/`.

### Linux sandbox prerequisite

Do **not** use `--no-sandbox`. On this host, Ubuntu denies unprivileged user namespaces and npm's Electron helper is not root-owned setuid. Tests were run with Electron's generated `node_modules/electron/dist/chrome-sandbox` symlinked to the **already installed** `/opt/google/chrome/chrome-sandbox` (verified root-owned, mode 4755). No root permissions or host security-policy changes were made. The unprivileged npm helper was preserved as `chrome-sandbox.unprivileged`. This is local build-dependency setup, not committed configuration or a portable installer. A fresh install needs an available, correctly configured Chromium sandbox; provision one through the normal distro/packaging process rather than disabling sandboxing. Playwright's `chromiumSandbox:true` is deliberate: its default would silently pass `--no-sandbox`.

## Bridge and adapter

- `electron/preload.ts`: frozen, named API; no exposed `ipcRenderer`, arbitrary channels, shell or paths.
- `electron/security.ts`: exact top-level sender-frame and local asset checks; trusted sidecar path selection.
- `electron/rpc.ts`: JSON-lines framing, request IDs, bounded pending requests, 5-second timeouts, disconnect/error rejection, 2 MiB response buffer.
- `electron/adapter.ts`: actual Rust `mixer` / `backend` snapshot and numeric stream IDs → validated renderer DTO. Numeric IDs are validated before conversion back to the Rust command format.
- `src/shared/contracts.ts`: strict command schemas and finite bounded gains/balance.
- `electron/artwork.ts`: native local image picker, fixed-source opt-in download, raster-only decoding, bounded input, model-scoped cache. Only transparent margins are trimmed; the product and receiver remain intact.

Groups are logical policies over application streams, not virtual audio buses or DSP processing. The GUI intentionally offers no EQ curve, artificial meter, guessed battery percentage, raw HID report, or unsupported RGB action. Physical wheel acquisition is distinct from the working on-screen balance. The native microphone and hardware microphone are distinct capabilities; this UI currently does not expose either microphone gain API.

## Lifetime and privacy

“Keep running in the tray” is an explicit local desktop preference, default false. Hiding the window retains the main process and its sidecar. Quitting stops the child. No systemd service is installed or managed here; this implementation does not survive logout independently. Shell tray support varies; the setting explains this limitation. Desktop preferences live in Electron's user-data directory and are separate from Rust mixer settings.

No telemetry, accounts, promotions, automatic artwork downloads or renderer network permissions. A user-requested official photo download contacts the manufacturer's image CDN and caches the result locally. Other models receive an honest no-image state plus a local picker until an exact-model source is catalogued.

## Artwork rights

The exact Arctis Nova 7 Gen 2 source and image URL are recorded in `src/shared/artwork-catalog.ts`. Product photography belongs to SteelSeries, is not covered by the repository's code license, and is **not bundled for redistribution**. USB VID/PID does not determine casing color; the black-variant disclaimer is visible. Cache sidecars retain provenance. SSGG is independent and unaffiliated. Review screenshots containing manufacturer imagery are development evidence, not a license to redistribute its product art.
