import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, nativeTheme, session } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { stat, readFile, writeFile, mkdir, rename, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { connectPrivateService, assertWritable, hasTrayWatcher, trayIconFilename } from "./service";
import { ArtworkStore } from "./artwork";
import { adaptSnapshot, toWireCommand } from "./adapter";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { JsonLineClient } from "./rpc";
import { assertTrustedFrame, resolveSidecar, isLocalAsset } from "./security";
import { snapshotSchema, identifier, validateCommand, type Snapshot, type RuntimeInfo } from "../src/shared/contracts";
const APP_ID = "io.github.MrTheSoulz.SSGG";
app.setName("SSGG");
if (process.platform === "linux") app.setDesktopName(`${APP_ID}.desktop`);
if (app.isPackaged && process.getuid?.() === 0) {
  console.error("Run SSGG as your desktop user, never as root.");
  app.exit(1);
}
const brandingPath = app.isPackaged
  ? path.join(process.resourcesPath, "branding")
  : path.join(app.getAppPath(), "assets/branding");
let window: BrowserWindow | null = null;
let child: ChildProcessWithoutNullStreams | null = null;
let rpc: JsonLineClient | null = null;
let tray: Tray | null = null;
let quitting = false;
let lastSnapshot: Snapshot | null = null;
let connection: Awaited<ReturnType<typeof connectPrivateService>> = null;
let connecting: Promise<void> | null = null;
let safeConfigDir: string | null = null;
let attemptedSocket = false;
const runtime: RuntimeInfo = {
  readOnly: process.argv.includes("--read-only") || (!app.isPackaged && process.env.SSGG_READ_ONLY === "1"),
  connected: false,
  message: "Audio service unavailable",
  trayAvailable: false,
  closeToTray: false,
  transport: "sidecar",
  testMode: !app.isPackaged && process.env.NODE_ENV === "test" && process.env.SSGG_TEST_MODE === "1",
};
if (runtime.testMode && process.env.SSGG_TEST_USER_DATA && path.isAbsolute(process.env.SSGG_TEST_USER_DATA))
  app.setPath("userData", process.env.SSGG_TEST_USER_DATA);
const rendererPath = path.join(__dirname, "../dist/index.html");
const rendererURL = pathToFileURL(rendererPath).href;
// Inspection must not focus a writable instance in place of starting safely.
if (runtime.readOnly) app.setPath("userData", path.join(app.getPath("userData"), "inspection"));
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
});
async function refreshTrayAvailability() {
  runtime.trayAvailable = !!tray && (process.platform !== "linux" || (await hasTrayWatcher()));
  if (!runtime.trayAvailable) {
    runtime.closeToTray = false;
    if (window && !window.isVisible()) window.show();
  }
}
async function startSidecar() {
  let diagnostics = "";
  try {
    // Inspection never connects to a writable daemon, even when one is available.
    if (!runtime.readOnly && (!runtime.testMode || process.env.SSGG_TEST_SOCKET === "1")) {
      connection = await connectPrivateService(process.env.XDG_RUNTIME_DIR);
      if (connection) {
        attemptedSocket = true;
        runtime.transport = "socket";
        rpc = connection.rpc;
        const current = connection;
        current.socket.on("close", () => {
          if (connection !== current) return;
          runtime.connected = false;
          runtime.message = "Background service disconnected. Refresh to reconnect; ChatMix may need enabling again.";
          current.close();
          connection = null;
        });
        await rpc.request("state.get", {});
        runtime.connected = true;
        runtime.message = "Background service · continues when SSGG quits";
        return;
      }
      if (attemptedSocket)
        throw new Error("Background service is stopped. Start it, then refresh; no competing sidecar was started.");
    }
    runtime.transport = "sidecar";
    if (runtime.readOnly && !safeConfigDir) safeConfigDir = await mkdtemp(path.join(tmpdir(), "ssgg-inspection-"));
    const executable = resolveSidecar(
      app.isPackaged,
      process.resourcesPath,
      app.getAppPath(),
      process.env.SSGG_SIDECAR,
    );
    const info = await stat(executable);
    if (
      !info.isFile() ||
      (info.mode & 0o022) !== 0 ||
      (process.getuid && info.uid !== process.getuid() && info.uid !== 0)
    )
      throw new Error("Sidecar is not a trusted executable");
    child = spawn(
      executable,
      ["--stdio", ...(runtime.readOnly ? ["--safe-mode", "--config", path.join(safeConfigDir!, "state.json")] : [])],
      { shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    const ownedChild = child;
    const ownedRpc = new JsonLineClient(child.stdin, child.stdout);
    rpc = ownedRpc;
    child.stderr.on("data", (data) => {
      diagnostics = (diagnostics + String(data)).slice(-4096);
    });
    child.on("error", () => {
      if (child !== ownedChild) return;
      runtime.connected = false;
      runtime.message = "Audio service unavailable";
      ownedRpc.close();
    });
    child.on("exit", () => {
      if (child !== ownedChild) return;
      runtime.connected = false;
      runtime.message = /lock|already|in use/i.test(diagnostics)
        ? "Another SSGG service owns this configuration. Use its private socket or quit the competing sidecar, then refresh."
        : "Audio service exited. Check the matching binary and pactl installation, then refresh.";
      ownedRpc.close(runtime.message);
      child = null;
    });
    await rpc.request("state.get", {});
    runtime.connected = true;
    runtime.message = runtime.readOnly
      ? "Read-only inventory · isolated safe sidecar"
      : "Window-owned sidecar · stops when SSGG quits";
  } catch (error) {
    runtime.connected = false;
    if (connection) {
      const current = connection;
      connection = null;
      current.close();
    }
    if (child) {
      const current = child;
      child = null;
      current.kill("SIGTERM");
    }
    if (/lock|already|in use/i.test(diagnostics))
      runtime.message =
        "Another SSGG service owns this configuration. Use its private socket or quit the competing sidecar, then refresh.";
    else
      runtime.message =
        error instanceof Error && /private|service|socket/i.test(error.message)
          ? error.message
          : "Audio service unavailable";
  }
}
async function ensureService() {
  if (runtime.connected) return;
  if (!connecting)
    connecting = startSidecar().finally(() => {
      connecting = null;
    });
  await connecting;
}
function handle(channel: string, action: (...args: any[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!window || event.sender !== window.webContents) throw new Error("Untrusted IPC sender");
    assertTrustedFrame(event.senderFrame, window.webContents.mainFrame, rendererURL);
    return action(...args);
  });
}
function createWindow() {
  window = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 900,
    minHeight: 680,
    backgroundColor: "#edf0f2",
    title: "SSGG",
    icon: path.join(brandingPath, "ssgg.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.on("close", (event) => {
    if (!quitting && runtime.closeToTray && tray) {
      event.preventDefault();
      // Watchers can disappear after enabling the preference (GNOME extension disabled).
      void refreshTrayAvailability().then(() => {
        if (runtime.trayAvailable && runtime.closeToTray) window?.hide();
        else window?.close();
      });
    }
  });
  window.on("closed", () => {
    window = null;
  });
  void window.loadFile(rendererPath);
}
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !isLocalAsset(details.url, path.join(__dirname, "../dist")) }),
  );
  await ensureService();
  handle("ssgg:runtime", () => ({ ...runtime }));
  handle("ssgg:state", async () => {
    await ensureService();
    if (!rpc || !runtime.connected) throw new Error(runtime.message);
    const result = await rpc.request("state.get", {});
    try {
      lastSnapshot = { ...adaptSnapshot(result), readOnly: runtime.readOnly };
      return lastSnapshot;
    } catch {
      throw new Error("Audio service returned an incompatible snapshot. Update the desktop and service together.");
    }
  });
  for (const [channel, method] of [
    ["ssgg:profile-save", "profiles.save"],
    ["ssgg:profile-apply", "profiles.apply"],
  ])
    handle(channel, async (name) => {
      assertWritable(!!runtime.readOnly);
      const params = validateCommand(method, { name });
      if (!rpc || !runtime.connected) throw new Error(runtime.message);
      await rpc.request(method, params);
    });
  const preferencesPath = path.join(app.getPath("userData"), "desktop-preferences.json");
  try {
    if ((await stat(preferencesPath)).size < 4096) {
      const saved = JSON.parse(await readFile(preferencesPath, "utf8"));
      runtime.closeToTray = saved.closeToTray === true;
    }
  } catch {
    /* Missing or corrupt preferences use the safe visible-window default. */
  }
  handle("ssgg:close-to-tray", async (enabled) => {
    validateCommand("settings.set", { closeToTray: enabled });
    await refreshTrayAvailability();
    if (enabled && !runtime.trayAvailable) throw new Error("Your desktop does not provide a tray.");
    await mkdir(app.getPath("userData"), { recursive: true, mode: 0o700 });
    await writeFile(preferencesPath + ".tmp", JSON.stringify({ closeToTray: enabled }), { mode: 0o600 });
    await rename(preferencesPath + ".tmp", preferencesPath);
    const saved = JSON.parse(await readFile(preferencesPath, "utf8"));
    runtime.closeToTray = saved.closeToTray === true;
    return { ...runtime };
  });
  const artwork = new ArtworkStore(path.join(app.getPath("userData"), "artwork"));
  function selectedDevice(raw: unknown) {
    const id = identifier.parse(raw);
    const device = lastSnapshot?.devices.find((d) => d.id === id);
    if (!device) throw new Error("Device is no longer available. Refresh your devices.");
    return device;
  }
  handle("ssgg:artwork-get", (id) => artwork.get(selectedDevice(id).id));
  handle("ssgg:artwork-choose", (id) => {
    if (!window) throw new Error("Window unavailable");
    return artwork.choose(selectedDevice(id), window);
  });
  handle("ssgg:artwork-download", (id) => artwork.download(selectedDevice(id)));
  const mutations: Record<string, string> = {
    "ssgg:stream": "stream.set",
    "ssgg:group": "group.set",
    "ssgg:chatmix": "chatmix.set",
    "ssgg:device": "device.set",
    "ssgg:lighting": "lighting.apply",
  };
  for (const [channel, method] of Object.entries(mutations))
    handle(channel, async (params) => {
      assertWritable(!!runtime.readOnly);
      const valid = toWireCommand(method, params);
      if (!rpc || !runtime.connected) throw new Error(runtime.message);
      await rpc.request(method, valid);
    });
  try {
    const trayImage = () =>
      nativeImage.createFromPath(path.join(brandingPath, trayIconFilename(nativeTheme.shouldUseDarkColors)));
    const image = trayImage();
    if (image.isEmpty()) throw new Error("Missing tray branding");
    tray = new Tray(image);
    nativeTheme.on("updated", () => tray?.setImage(trayImage()));
    tray.setToolTip("SSGG — device & audio console");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Open SSGG",
          click: () => {
            if (!window) createWindow();
            window?.show();
          },
        },
        { type: "separator" },
        { label: "Quit SSGG", click: () => app.quit() },
      ]),
    );
    tray.on("click", () => window?.show());
    await refreshTrayAvailability();
  } catch {
    runtime.trayAvailable = false;
  }
  createWindow();
  const trayMonitor = setInterval(() => void refreshTrayAvailability(), 5000);
  trayMonitor.unref();
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  quitting = true;
  rpc?.close();
  connection?.close();
  child?.kill("SIGTERM");
  if (safeConfigDir) void rm(safeConfigDir, { recursive: true, force: true });
  tray?.destroy();
});
app.on("activate", () => {
  if (!window) createWindow();
  else window.show();
});
