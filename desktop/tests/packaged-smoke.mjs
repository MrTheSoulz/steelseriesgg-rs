import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, chmod, readFile, writeFile, rm, lstat, readlink } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { run } from "../scripts/package-lib.mjs";

const executablePath = path.resolve(process.argv[2] || "release/app/ssgg-gui");
const evidencePath = path.resolve(process.argv[3] || "artifacts/packaged-smoke.json");
assert(process.env.DISPLAY, "Run under dbus-run-session -- xvfb-run -a");
assert(process.env.DBUS_SESSION_BUS_ADDRESS, "Use a private dbus-run-session, not the user's desktop bus");
const root = await mkdtemp(path.join(os.tmpdir(), "ssgg-packaged-smoke-"));
const fixture = JSON.parse(await readFile(new URL("./fixture.json", import.meta.url), "utf8"));
for (const directory of ["home", "config", "cache", "runtime", "tmp", "runtime/ssgg-desktop"])
  await mkdir(path.join(root, directory), { recursive: true, mode: 0o700 });
const target = path.join(root, "runtime/ssgg-desktop/service.sock");
// A preference saved under an indicator-enabled session must be safe on stock GNOME.
await mkdir(path.join(root, "config/SSGG"), { mode: 0o700 });
await writeFile(path.join(root, "config/SSGG/desktop-preferences.json"), JSON.stringify({ closeToTray: true }));
const requests = [],
  peers = new Set();
let connections = 0;
const server = createServer((socket) => {
  connections++;
  peers.add(socket);
  socket.on("close", () => peers.delete(socket));
  let buffer = "";
  socket.on("data", (data) => {
    buffer += data.toString();
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n"),
        request = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      requests.push(request);
      socket.write(
        JSON.stringify(
          request.method === "state.get"
            ? { id: request.id, result: fixture }
            : {
                id: request.id,
                error: { code: "READ_ONLY_FIXTURE", message: "No hardware or audio writes in package verification" },
              },
        ) + "\n",
      );
    }
  });
});
await new Promise((resolve) => server.listen(target, resolve));
await chmod(target, 0o600);
const env = {
  ...process.env,
  HOME: path.join(root, "home"),
  XDG_CONFIG_HOME: path.join(root, "config"),
  XDG_CACHE_HOME: path.join(root, "cache"),
  XDG_RUNTIME_DIR: path.join(root, "runtime"),
  TMPDIR: path.join(root, "tmp"),
  PULSE_SERVER: `unix:${root}/no-audio.sock`,
  PIPEWIRE_REMOTE: "ssgg-package-no-audio",
  NODE_ENV: "production",
  SSGG_TEST_MODE: "0",
  SSGG_READ_ONLY: "0",
  SSGG_SIDECAR: "/nonexistent/packaged-must-ignore-override",
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const helperPath = path.join(path.dirname(executablePath), "chrome-sandbox");
const helperInfo = await lstat(helperPath).catch(() => null);
const testHelperOverride = helperInfo?.isSymbolicLink() ? await readlink(helperPath) : null;
const evidence = {
  executablePath,
  isolatedHomeAndRuntime: true,
  fixtureRequests: [],
  hostAudioAccess: false,
  testHelperOverride,
};
try {
  app = await electron.launch({
    executablePath,
    chromiumSandbox: true,
    args: ["--ozone-platform=x11"],
    cwd: root,
    env,
  });
  let page = await app.firstWindow();
  await page.waitForFunction(async () => (await window.ssgg.getRuntime()).connected);
  const runtime = await page.evaluate(() => window.ssgg.getRuntime());
  assert.equal(runtime.transport, "socket");
  assert.equal(runtime.testMode, false);
  assert.equal(runtime.trayAvailable, false, "A bus with no watcher must not advertise a tray");
  assert.equal(runtime.closeToTray, false);
  assert.match(
    await page.evaluate(async () => {
      try {
        await window.ssgg.setCloseToTray(true);
        return "NOT BLOCKED";
      } catch (error) {
        return error.message;
      }
    }),
    /does not provide a tray/,
  );
  const state = await page.evaluate(() => window.ssgg.getState());
  assert.equal(state.streams.length, fixture.streams.length);
  const identity = await app.evaluate(({ app, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return {
      packaged: app.isPackaged,
      name: app.getName(),
      appPath: app.getAppPath(),
      pid: window.webContents.getOSProcessId(),
      nativeHandle: window.getNativeWindowHandle().readUInt32LE().toString(16),
      preferences: window.webContents.getLastWebPreferences(),
      noSandbox: app.commandLine.hasSwitch("no-sandbox"),
    };
  });
  assert(identity.packaged, "Must exercise the packaged branch, not electron .");
  assert.equal(identity.name, "SSGG");
  assert.equal(identity.noSandbox, false);
  assert.equal(identity.preferences.sandbox, true);
  assert.equal(identity.preferences.contextIsolation, true);
  assert.equal(identity.preferences.nodeIntegration, false);
  assert.match(await readFile(`/proc/${identity.pid}/status`, "utf8"), /Seccomp:\s+2/);
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  const wmClass = run("xprop", ["-id", `0x${identity.nativeHandle}`, "WM_CLASS"]);
  assert.match(wmClass, /"io\.github\.MrTheSoulz\.SSGG"/);
  const icon = run("xprop", ["-id", `0x${identity.nativeHandle}`, "-len", "80", "_NET_WM_ICON"]);
  assert.match(icon, /Icon \(|CARDINAL/);
  evidence.identity = { packaged: identity.packaged, name: identity.name, wmClass: wmClass.trim(), windowIcon: true };
  evidence.sandbox = { seccomp: 2, sandbox: true, contextIsolation: true, nodeIntegration: false, noSandbox: false };
  assert(
    requests.every((request) => request.method === "state.get"),
    "Startup must not mutate even fixture state",
  );
  const mainPid = app.process().pid;
  const childPids = (await readFile(`/proc/${mainPid}/task/${mainPid}/children`, "utf8"))
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  for (const pid of childPids) {
    const command = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "");
    assert(!command.includes("resources/ssgg-desktop"), "External fixture must prevent a competing sidecar");
  }
  // Launching again must recover the existing window, not create a competing owner.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  const { spawn } = await import("node:child_process");
  const second = spawn(executablePath, ["--ozone-platform=x11"], { env, cwd: root, stdio: "ignore" });
  const secondExit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      second.kill();
      reject(new Error("Second instance did not exit"));
    }, 15000);
    second.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    second.once("error", reject);
  });
  assert.equal(secondExit, 0);
  assert(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()));
  evidence.secondInstanceRecoversWindow = true;
  const closed = app.waitForEvent("close");
  await app
    .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    .catch((error) => {
      if (!/closed|destroyed/.test(error.message)) throw error;
    });
  await closed;
  app = null;
  evidence.noWatcherWindowCloseExits = true;
  assert(server.listening, "Closing GUI must not stop the fixture service");
  const previousConnections = connections;
  // Real bundled Rust, not a mock executable: safe inventory with private config
  // and deliberately unreachable audio. Never touches the user's running daemon.
  app = await electron.launch({
    executablePath,
    chromiumSandbox: true,
    args: ["--ozone-platform=x11", "--read-only"],
    cwd: root,
    env,
  });
  page = await app.firstWindow();
  await page.waitForFunction(async () => (await window.ssgg.getRuntime()).connected);
  const safe = await page.evaluate(() => window.ssgg.getRuntime());
  assert.equal(safe.readOnly, true);
  assert.equal(safe.transport, "sidecar");
  await page.evaluate(() => window.ssgg.getState());
  assert.equal(connections, previousConnections);
  for (const method of ["setStream", "setGroup", "setChatmix", "setDevice", "applyLighting", "saveProfile", "applyProfile"]) {
    const error = await page.evaluate(async (method) => {
      try {
        await window.ssgg[method]({});
        return "NOT BLOCKED";
      } catch (error) {
        return error.message;
      }
    }, method);
    assert.match(error, /Read-only/);
  }
  evidence.realBundledRustSafeInventory = true;
  evidence.allMutationIpcBlockedInInspection = true;
  evidence.fixtureRequests = requests.map((request) => request.method);
  evidence.externalServiceSurvived = server.listening;
  await app.close();
  app = null;
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (app) await app.close();
  for (const peer of peers) peer.destroy();
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
