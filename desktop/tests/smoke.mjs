import { _electron as electron } from "playwright";
import { mkdir, readFile, writeFile, mkdtemp } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
await mkdir("artifacts", { recursive: true });
const testData = await mkdtemp("/tmp/ssgg-electron-test-");
const app = await electron.launch({
  chromiumSandbox: true,
  args: ["."],
  env: {
    ...process.env,
    NODE_ENV: "test",
    SSGG_TEST_MODE: "1",
    SSGG_TEST_USER_DATA: testData,
    SSGG_SIDECAR: "/nonexistent/ssgg_desktop",
  },
  timeout: 30000,
});
try {
  const page = await app.firstWindow();
  await page.getByText("Audio service unavailable", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  assert.equal(await page.evaluate(() => typeof window.ssgg?.getState), "function");
  const prefs = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  );
  const osPid = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getOSProcessId(),
  );
  const processStatus = await readFile(`/proc/${osPid}/status`, "utf8");
  assert.match(processStatus, /Seccomp:\s+2/);
  assert.equal(await app.evaluate(({ app }) => app.commandLine.hasSwitch("no-sandbox")), false);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(await page.getByRole("button", { name: "Enable ChatMix" }).isDisabled(), true);
  await page.screenshot({ path: "artifacts/unavailable.png" });
  console.log("PASS: real Electron; sandbox/context isolation; local preload; unavailable state; disabled controls");
} finally {
  await app.close();
}
const log = path.resolve("artifacts/requests.jsonl");
await writeFile(log, "");
const live = await electron.launch({
  chromiumSandbox: true,
  args: ["."],
  env: {
    ...process.env,
    NODE_ENV: "test",
    SSGG_TEST_MODE: "1",
    SSGG_TEST_USER_DATA: testData,
    SSGG_SIDECAR: path.resolve("tests/fixture-sidecar.cjs"),
    SSGG_TEST_REQUEST_LOG: log,
  },
  timeout: 30000,
});
try {
  const page = await live.firstWindow();
  await page.getByRole("combobox", { name: "Google Chrome group" }).waitFor();
  const startup = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  assert(
    startup.every((r) => r.method === "state.get"),
    "Startup must only enumerate",
  );
  const rejected = await page.evaluate(async () => {
    try {
      await window.ssgg.setStream({ id: "101", volume: 9 });
      return false;
    } catch {
      return true;
    }
  });
  assert(rejected, "Main must reject invalid gains");
  await page.getByRole("combobox", { name: "Google Chrome group" }).selectOption("chat");
  await page.getByText("Application assigned", { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.ssgg.getState())).streams[0].group, "chat");
  await page.getByRole("button", { name: "Mute Google Chrome", exact: true }).click();
  await page.getByRole("button", { name: "Unmute Google Chrome", exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.ssgg.getState())).streams[0].muted, true);
  await page.getByRole("combobox", { name: "Media wheel side" }).selectOption("b");
  await page.getByText("Wheel side updated", { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.ssgg.getState())).groups[2].wheelSide, "b");
  await page.getByRole("button", { name: "Enable ChatMix" }).click();
  await page.getByRole("button", { name: "Disable ChatMix" }).waitFor();
  const range = page.getByRole("slider", { name: "ChatMix balance", exact: true });
  await range.focus();
  await range.press("End");
  await page.getByText("Balance updated", { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.ssgg.getState())).chatmix.balance, 1);
  await page.getByRole("button", { name: "Devices", exact: true }).click();
  await page.getByRole("heading", { name: "Arctis Nova 7 Gen 2" }).waitFor();
  assert.equal(await page.evaluate(() => window.ssgg.getArtwork("test-nova7-gen2")), null);
  await page.getByRole("button", { name: "Profiles", exact: true }).click();
  await page.getByRole("textbox", { name: "Profile name" }).fill("Music and calls");
  await page.getByRole("button", { name: "Save current mix" }).click();
  await page.getByRole("button", { name: "Apply Music and calls" }).waitFor();
  assert((await page.evaluate(() => window.ssgg.getState())).profiles.some((p) => p.name === "Music and calls"));
  await page.getByRole("button", { name: "Apply Music and calls" }).click();
  await page.getByText("Profile applied", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const close = page.getByRole("checkbox", { name: "Keep running in the tray" });
  if (await close.isEnabled()) {
    await close.click();
    await page.waitForFunction(() => document.querySelector("input[type=checkbox]")?.checked === true);
    assert.equal((await page.evaluate(() => window.ssgg.getRuntime())).closeToTray, true);
    await live.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    assert.equal(await live.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
    assert.equal((await page.evaluate(() => window.ssgg.getState())).audio.available, true);
    await live.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  }
  console.log(
    "PASS: explicit test JSON-lines process; zero startup writes; IPC range validation; stream group/mute; group side; keyboard balance read-back; profiles save/apply; tray preference read-back; sidecar survives window hiding",
  );
} finally {
  await live.close();
}
