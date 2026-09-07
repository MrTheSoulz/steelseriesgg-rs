import { _electron as electron } from "playwright";
import { mkdtemp, copyFile, chmod, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";

await mkdir("artifacts", { recursive: true });
const evidence = [];
for (const mode of ["success", "acquired", "failure", "offline", "timeout", "cancel", "read-only"]) {
  const privateDir = await mkdtemp("/tmp/ssgg-wheel-smoke-");
  const executable = path.join(privateDir, "fixture-wheel-sidecar.cjs");
  const log = path.join(privateDir, "requests.jsonl");
  await copyFile("tests/fixture-wheel-sidecar.cjs", executable);
  await chmod(executable, 0o755);
  await copyFile("tests/fixture.json", path.join(privateDir, "fixture.json"));
  const app = await electron.launch({
    chromiumSandbox: true,
    args: ["--ozone-platform=x11", ".", ...(mode === "read-only" ? ["--read-only"] : [])],
    env: {
      ...process.env,
      NODE_ENV: "test",
      SSGG_TEST_MODE: "1",
      SSGG_TEST_SOCKET: "0",
      SSGG_READ_ONLY: mode === "read-only" ? "1" : "0",
      SSGG_TEST_USER_DATA: privateDir,
      SSGG_SIDECAR: executable,
      SSGG_TEST_REQUEST_LOG: log,
      SSGG_TEST_WHEEL_CASE: mode === "cancel" ? "timeout" : mode,
    },
    timeout: 30000,
  });
  try {
    const page = await app.firstWindow();
    const cta = page.getByRole("button", { name: "Use headset wheel", exact: true });
    await cta.waitFor();
    await page.getByRole("combobox", { name: "Google Chrome group" }).waitFor();
    const initial = await page.evaluate(() => window.ssgg.getState());
    assert.equal(initial.chatmix.inputMode, "software");
    const startup = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert(startup.every((r) => r.method === "state.get"));
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
    if (mode === "success") {
      for (const width of [1320, 900]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await cta.isVisible(), true);
        const box = await cta.boundingBox();
        assert(box.y + box.height < 900, "Setup must be discoverable in the first viewport");
        await page.screenshot({ path: `artifacts/wheel-setup-${width}.png` });
      }
    }
    if (mode === "read-only") {
      assert.equal(await cta.isDisabled(), true);
      await page.getByText("Read-only session — reopen SSGG in normal mode to use hardware.").waitFor();
    } else {
      await cta.click();
      if (["success", "offline", "timeout", "cancel"].includes(mode))
        await page.getByRole("button", { name: "Connecting to headset…", exact: true }).waitFor();
      if (mode === "cancel") await page.getByRole("button", { name: "Cancel wheel setup", exact: true }).click();
      if (["success", "acquired"].includes(mode)) {
        await page.getByText("Headset wheel active", { exact: true }).waitFor();
        await page.getByText("ChatMix is off — the wheel is not changing audio.").waitFor();
      } else {
        await page.getByRole("button", { name: "Retry headset wheel", exact: true }).waitFor({ timeout: 15000 });
        assert((await page.getByRole("alert").count()) > 0);
      }
    }
    const confirmed = await page.evaluate(() => window.ssgg.getState());
    assert.equal(confirmed.chatmix.enabled, false);
    assert.deepEqual(confirmed.streams, initial.streams);
    assert.deepEqual(confirmed.groups, initial.groups);
    const requests = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    const writes = requests.filter((r) => r.method !== "state.get");
    const successful = ["success", "acquired"].includes(mode);
    const expected = [
      ...(mode === "read-only" || mode === "acquired"
        ? []
        : [{ method: "device.set", params: { id: initial.devices[0].id, hardwareEnabled: true } }]),
      ...(successful ? [{ method: "chatmix.set", params: { inputMode: "hardware" } }] : []),
    ];
    assert.deepEqual(
      writes.map(({ method, params }) => ({ method, params })),
      expected,
    );
    assert.equal(confirmed.chatmix.inputMode, successful ? "hardware" : "software");
    if (successful) {
      const selectIndex = requests.findIndex((r) => r.method === "chatmix.set");
      const before = requests[selectIndex - 1];
      assert.equal(before.method, "state.get");
      assert.equal(before.physical.deviceId, initial.devices[0].id);
      assert.equal(before.physical.connected, true);
      assert.equal(before.physical.pending, false);
      assert(before.physical.sample);
    }
    evidence.push({ case: mode, passed: true, sandbox: true, writes, confirmed });
    await writeFile("artifacts/wheel-setup-evidence.json", JSON.stringify(evidence, null, 2));
    console.log(`PASS wheel setup: ${mode}; sandboxed fixture; exact writes and state readback verified`);
  } finally {
    await app.close();
    await rm(privateDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
assert.equal(evidence.length, 7);
