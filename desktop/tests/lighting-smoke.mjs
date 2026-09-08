// Real renderer -> sandboxed preload -> main -> private fixture RPC.
// The fixture models asynchronous completion; it never opens HID or audio.
import { _electron as electron, expect } from "playwright/test";
import { mkdtemp, mkdir, chmod, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import assert from "node:assert/strict";

// Require the no-activation bus/private audio environment of test-session.mjs.
assert.match(process.env.HOME ?? "", /\/ssgg-test-session-[^/]+\/home$/);
assert.match(process.env.PULSE_SERVER ?? "", /\/ssgg-test-session-[^/]+\/no-audio\.sock$/);
assert.equal(process.env.PIPEWIRE_REMOTE, "ssgg-no-audio");
const root = await mkdtemp("/tmp/ssgg-lighting-smoke-");
const fixture = JSON.parse(await readFile("tests/fixture.json", "utf8"));
const keyboard = {
  id: "1038:1642:fixture",
  name: "Apex Pro TKL Gen 3",
  vendorId: 0x1038,
  productId: 0x1642,
  kind: "keyboard",
  connected: true,
  capabilities: {
    rgb: {
      supported: true,
      applicable: true,
      locallyValidated: false,
      reason: "Source-derived protocol implemented; not locally validated on physical hardware.",
    },
  },
  lighting: { lastSent: null, pending: false, error: null },
};
assert.equal(fixture.devices[0].productId, 0x227e);
fixture.devices.unshift(keyboard);
await mkdir(path.join(root, "ssgg-desktop"), { mode: 0o700 });
await mkdir("artifacts", { recursive: true });
const target = path.join(root, "ssgg-desktop/service.sock");
const requests = [],
  peers = new Set(),
  evidence = [];
let connections = 0;
const server = createServer((socket) => {
  connections++;
  peers.add(socket);
  socket.on("close", () => peers.delete(socket));
  let buffer = "";
  socket.on("data", (data) => {
    buffer += data.toString();
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n");
      const request = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      requests.push(request);
      let response;
      if (request.method === "state.get") response = { result: fixture };
      else if (request.method === "lighting.apply" && request.params.id === keyboard.id) {
        keyboard.lighting.pending = true;
        keyboard.lighting.error = null;
        // Accepted is deliberately separate from runner-controlled completion.
        response = { result: { pending: true } };
      } else
        response = {
          error: { code: "UNSUPPORTED", message: "Fixture rejects non-keyboard lighting and all other mutations" },
        };
      socket.write(JSON.stringify({ id: request.id, ...response }) + "\n");
    }
  });
});
await new Promise((resolve) => server.listen(target, resolve));
await chmod(target, 0o600);
const sidecar = path.join(root, "fixture-sidecar.cjs");
await copyFile("tests/fixture-sidecar.cjs", sidecar);
await chmod(sidecar, 0o755);
await writeFile(path.join(root, "fixture.json"), JSON.stringify(fixture));
const readOnlyLog = path.join(root, "readonly-requests.jsonl");
const env = {
  ...process.env,
  NODE_ENV: "test",
  SSGG_TEST_MODE: "1",
  SSGG_TEST_SOCKET: "1",
  XDG_RUNTIME_DIR: root,
  SSGG_TEST_USER_DATA: path.join(root, "userdata"),
  SSGG_SIDECAR: sidecar,
  SSGG_READ_ONLY: "0",
};
const payload = { id: keyboard.id, allowHardware: true, color: [255, 128, 0], brightness: 50 };
const writes = () =>
  requests.filter((request) => request.method !== "state.get").map(({ method, params }) => ({ method, params }));
async function rejection(page, value) {
  return page.evaluate(async (value) => {
    try {
      await window.ssgg.applyLighting(value);
      return "NOT BLOCKED";
    } catch (error) {
      return error.message;
    }
  }, value);
}
async function verifySandbox(app, page) {
  const { pid, prefs, unsafe } = await app.evaluate(({ BrowserWindow, app }) => ({
    pid: BrowserWindow.getAllWindows()[0].webContents.getOSProcessId(),
    prefs: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
    unsafe: app.commandLine.hasSwitch("no-sandbox"),
  }));
  assert.match(await readFile(`/proc/${pid}/status`, "utf8"), /Seccomp:\s+2/);
  assert.equal(unsafe, false);
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  return { rendererSeccomp: 2, sandbox: true, contextIsolation: true, nodeIntegration: false, noSandboxFlag: false };
}
let app;
try {
  app = await electron.launch({ chromiumSandbox: true, args: ["--ozone-platform=x11", "."], env });
  let page = await app.firstWindow();
  await page.getByRole("combobox", { name: "Google Chrome group" }).waitFor();
  const initial = await page.evaluate(() => window.ssgg.getState());
  assert.equal((await page.evaluate(() => window.ssgg.getRuntime())).transport, "socket");
  const sandbox = await verifySandbox(app, page);
  assert.deepEqual(writes(), []);
  await page.getByRole("button", { name: "Devices", exact: true }).click();
  const section = page.getByRole("region", { name: "RGB lighting" });
  const apply = section.getByRole("button", { name: "Apply lighting", exact: true });
  await expect(apply).toBeEnabled();
  await expect(section.getByRole("checkbox")).toHaveCount(0);
  await expect(section.getByText(/not locally validated on physical hardware/)).toBeVisible();
  await expect(section.getByText(/Close other RGB software first/)).toBeVisible();
  const logo = page.getByRole("button", { name: "SSGG home" }).locator("img");
  assert.equal(await logo.evaluate((image) => image.complete && image.naturalWidth > 0), true);
  const logoSource = await logo.getAttribute("src");
  assert(logoSource.startsWith("data:image/svg+xml") || logoSource.includes("/assets/ssgg-"));

  // Invalid inputs must fail in main before the private socket sees them.
  for (const change of [
    { allowHardware: false },
    { allowHardware: undefined },
    { color: [256, 0, 0] },
    { color: [1, 2] },
    { color: [1.5, 2, 3] },
    { brightness: 101 },
    { brightness: -1 },
    { brightness: 0.5 },
    { effect: "rainbow" },
    { id: "" },
  ]) {
    const message = await rejection(page, { ...payload, ...change });
    assert.notEqual(message, "NOT BLOCKED");
    assert.doesNotMatch(message, /No handler registered/);
  }
  assert.deepEqual(writes(), []);
  evidence.push({ case: "invalid-main-ipc", passed: true, rejectedInputs: 10 });

  await section.getByRole("button", { name: "White", exact: true }).click();
  await section.getByRole("button", { name: "Off", exact: true }).click();
  await section.getByLabel("Lighting color", { exact: true }).fill("#ff8000");
  await section.getByRole("slider", { name: "Lighting brightness" }).fill("50");
  await page.getByRole("combobox", { name: "Selected device" }).selectOption("test-nova7-gen2");
  await expect(page.getByRole("heading", { name: "RGB lighting" })).toHaveCount(0);
  await expect(page.getByLabel("Lighting color", { exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Selected device" }).selectOption(keyboard.id);
  await section.getByLabel("Lighting color", { exact: true }).fill("#ff8000");
  await section.getByRole("slider", { name: "Lighting brightness" }).fill("50");
  await page.getByRole("button", { name: "Refresh audio and devices" }).click();
  await expect(apply).toBeEnabled();
  assert.deepEqual(writes(), []);
  for (const width of [1320, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(apply).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `artifacts/lighting-${width}.png`, fullPage: true });
  }
  await apply.click();
  await expect(section.getByRole("button", { name: "Applying lighting…" })).toBeDisabled();
  await expect(section.getByText("Lighting write in progress…", { exact: true })).toBeVisible();
  await expect(section.getByText(/Last sent:/)).toHaveCount(0);
  assert.deepEqual(writes(), [{ method: "lighting.apply", params: payload }]);
  const pending = (await page.evaluate(() => window.ssgg.getState())).devices[0].lighting;
  assert.deepEqual(pending, { lastSent: null, pending: true, error: null });
  // Fixture-only completion, never a claim of a physical HID send.
  keyboard.lighting = {
    lastSent: { color: payload.color, brightness: payload.brightness },
    pending: false,
    error: null,
  };
  await page.getByRole("button", { name: "Refresh audio and devices" }).click();
  await expect(section.getByText(/Last sent: #FF8000/)).toContainText("No device readback.");
  const sent = (await page.evaluate(() => window.ssgg.getState())).devices[0].lighting;
  assert.deepEqual(sent, keyboard.lighting);
  evidence.push({ case: "apply-pending-completion", passed: true, pending, sent, sandbox, payload });

  // Off is still only a draft, then the second explicit Apply can fail.
  await section.getByRole("button", { name: "Off", exact: true }).click();
  assert.equal(writes().length, 1);
  await apply.click();
  await expect(section.getByText("Lighting write in progress…", { exact: true })).toBeVisible();
  keyboard.lighting.pending = false;
  keyboard.lighting.error = "Fixture: keyboard disconnected before lighting completed; refresh and retry.";
  await page.getByRole("button", { name: "Refresh audio and devices" }).click();
  await expect(section.getByRole("alert")).toHaveText(keyboard.lighting.error);
  await expect(section.getByText(/Last sent: #FF8000/)).toContainText("50% brightness.");
  assert.deepEqual(writes(), [
    { method: "lighting.apply", params: payload },
    { method: "lighting.apply", params: { ...payload, brightness: 0 } },
  ]);
  const failed = (await page.evaluate(() => window.ssgg.getState())).devices[0].lighting;
  assert.deepEqual(failed, keyboard.lighting);
  evidence.push({ case: "off-draft-and-failed-completion", passed: true, failed });

  // Reconnect and profile browsing must not replay lighting.
  for (const peer of peers) peer.destroy();
  await page.getByRole("button", { name: "Refresh audio and devices" }).click();
  await page.waitForFunction(async () => (await window.ssgg.getRuntime()).connected);
  await page.getByRole("button", { name: "Profiles", exact: true }).click();
  await page.getByRole("button", { name: "Devices", exact: true }).click();
  const confirmed = await page.evaluate(() => window.ssgg.getState());
  assert.deepEqual(confirmed.streams, initial.streams);
  assert.deepEqual(confirmed.groups, initial.groups);
  assert.deepEqual(confirmed.chatmix, initial.chatmix);
  assert.equal(writes().length, 2);
  await app.close();
  app = null;
  assert(server.listening, "GUI exit must not kill the external fixture service");
  const before = connections;

  app = await electron.launch({
    chromiumSandbox: true,
    args: ["--ozone-platform=x11", ".", "--read-only"],
    env: { ...env, SSGG_READ_ONLY: "1", SSGG_TEST_REQUEST_LOG: readOnlyLog },
  });
  page = await app.firstWindow();
  await page.getByRole("combobox", { name: "Google Chrome group" }).waitFor();
  const safeRuntime = await page.evaluate(() => window.ssgg.getRuntime());
  assert.equal(safeRuntime.readOnly, true);
  assert.equal(safeRuntime.transport, "sidecar");
  await verifySandbox(app, page);
  await page.getByRole("button", { name: "Devices", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply lighting", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Lighting color", { exact: true })).toBeDisabled();
  assert.match(await rejection(page, payload), /Read-only/);
  assert.equal(connections, before, "Read-only must never attach to the writable fixture socket");
  const safeRequests = (await readFile(readOnlyLog, "utf8")).trim().split("\n").map(JSON.parse);
  assert(safeRequests.every((request) => request.method === "state.get"));
  assert.equal(writes().length, 2);
  evidence.push({ case: "readonly-ipc-and-ui", passed: true, runtime: safeRuntime, requests: safeRequests });
  await writeFile(
    "artifacts/lighting-evidence.json",
    JSON.stringify(
      {
        evidenceTier: "sandboxed Electron with private synthetic service; no physical RGB validation",
        hostAccess: {
          hidOperations: 0,
          audioOperations: 0,
          privateSocket: target,
          inheritedPrivateHome: process.env.HOME,
        },
        writes: writes(),
        cases: evidence,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS lighting: real sandboxed IPC, exact Apply/Off payloads, pending/sent/error readback, invalid/read-only refusal, Nova controls absent, no automatic writes; 1320/900 captures. Fixture only, no HID/audio operations.",
  );
} finally {
  if (app) await app.close();
  for (const peer of peers) peer.destroy();
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
