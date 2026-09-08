import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { chromium } from "playwright";
import assert from "node:assert/strict";
const data = await mkdtemp("/tmp/ssgg-launch-readonly-");
const child = spawn(
  process.execPath,
  ["scripts/launch.mjs", "--read-only", "--ozone-platform=x11", "--remote-debugging-port=0"],
  {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "test", SSGG_TEST_MODE: "1", SSGG_TEST_USER_DATA: data },
  },
);
let browser;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Local launcher did not expose a window in time")), 20000);
    let text = "";
    child.stderr.on("data", (chunk) => {
      text += chunk;
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Launcher exited ${code}: ${text.slice(-1500)}`));
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || (await context.waitForEvent("page"));
  await page.getByText("READ-ONLY SESSION", { exact: false }).waitFor();
  await page.waitForFunction(async () => {
    try {
      return (await window.ssgg.getState()).audio.available;
    } catch {
      return false;
    }
  });
  const state = await page.evaluate(() => window.ssgg.getState());
  assert.equal(state.readOnly, true);
  assert.equal(state.chatmix.enabled, false);
  assert.equal(await page.getByRole("button", { name: "Enable ChatMix" }).isDisabled(), true);
  await mkdir("artifacts", { recursive: true });
  for (const width of [1320, 900]) {
    await page.setViewportSize({ width, height: 900 });
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      "No horizontal overflow",
    );
    await page.screenshot({ path: `artifacts/launch-mixer-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Devices", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Enable hardware" }).isDisabled(), true);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: `artifacts/launch-devices-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Mixer", exact: true }).click();
  }
  await writeFile(
    "artifacts/local-launch-evidence.json",
    JSON.stringify(
      {
        launcher: "node scripts/launch.mjs --read-only",
        readOnly: state.readOnly,
        streams: state.streams.length,
        devices: state.devices.map((d) => ({ id: d.id, name: d.name })),
        hardwareAcquired: state.physical?.hardwareAcquired,
        noOverflow: [1320, 900],
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: built local launcher, actual Rust safe inventory, real connected headset, blocked hardware/audio controls, 1320/900px no overflow",
  );
} finally {
  if (browser) await browser.close();
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {}
  await new Promise((resolve) => (child.exitCode === null ? child.once("exit", resolve) : resolve()));
  await rm(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
