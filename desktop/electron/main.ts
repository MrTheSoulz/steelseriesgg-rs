import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, session } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { stat, readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { ArtworkStore } from "./artwork";
import { adaptSnapshot, toWireCommand } from "./adapter";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { JsonLineClient } from "./rpc";
import { assertTrustedFrame, resolveSidecar, isLocalAsset } from "./security";
import { snapshotSchema, identifier, validateCommand, type Snapshot, type RuntimeInfo } from "../src/shared/contracts";
let window: BrowserWindow | null = null;
let child: ChildProcessWithoutNullStreams | null = null;
let rpc: JsonLineClient | null = null;
let tray: Tray | null = null;
let quitting = false;
let lastSnapshot: Snapshot | null = null;
const runtime: RuntimeInfo = {
  readOnly: !app.isPackaged && process.env.SSGG_READ_ONLY === "1",
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
async function startSidecar() {
  try {
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
      ["--stdio", ...(!app.isPackaged && process.env.SSGG_READ_ONLY === "1" ? ["--safe-mode"] : [])],
      { shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    rpc = new JsonLineClient(child.stdin, child.stdout);
    child.stderr.on("data", () => {
      /* Drain diagnostics; never forward raw paths or logs to renderer. */
    });
    child.on("error", () => {
      runtime.connected = false;
      runtime.message = "Audio service unavailable";
      rpc?.close();
    });
    child.on("exit", () => {
      runtime.connected = false;
      runtime.message = "Audio service disconnected. Reopen SSGG to reconnect.";
      rpc?.close();
    });
    runtime.connected = true;
    runtime.message = "Local audio service";
  } catch {
    runtime.connected = false;
    runtime.message = "Audio service unavailable";
  }
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
      window?.hide();
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
  await startSidecar();
  handle("ssgg:runtime", () => ({ ...runtime }));
  handle("ssgg:state", async () => {
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
  };
  for (const [channel, method] of Object.entries(mutations))
    handle(channel, async (params) => {
      const valid = toWireCommand(method, params);
      if (!rpc || !runtime.connected) throw new Error(runtime.message);
      await rpc.request(method, valid);
    });
  try {
    const pixels = Buffer.alloc(32 * 32 * 4);
    for (let y = 5; y < 27; y++)
      for (let x = 5; x < 27; x++) {
        const i = (y * 32 + x) * 4;
        pixels[i] = 37;
        pixels[i + 1] = 168;
        pixels[i + 2] = 150;
        pixels[i + 3] = x < 10 || x > 21 || y < 10 || y > 21 ? 255 : 0;
      }
    tray = new Tray(nativeImage.createFromBitmap(pixels, { width: 32, height: 32 }));
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
        { label: "Quit SSGG and its sidecar", click: () => app.quit() },
      ]),
    );
    tray.on("click", () => window?.show());
    runtime.trayAvailable = true;
  } catch {
    runtime.trayAvailable = false;
  }
  createWindow();
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  quitting = true;
  rpc?.close();
  child?.kill("SIGTERM");
  tray?.destroy();
});
app.on("activate", () => {
  if (!window) createWindow();
  else window.show();
});
