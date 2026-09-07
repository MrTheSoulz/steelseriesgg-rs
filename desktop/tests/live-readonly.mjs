import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
if (!process.env.SSGG_SIDECAR || !path.isAbsolute(process.env.SSGG_SIDECAR))
  throw new Error("Set SSGG_SIDECAR to the trusted real Rust binary");
const out = path.resolve("../.impeccable/review");
await mkdir(out, { recursive: true });
const app = await electron.launch({
  chromiumSandbox: true,
  args: ["--ozone-platform=x11", "."],
  env: {
    ...process.env,
    NODE_ENV: "test",
    SSGG_TEST_MODE: "1",
    SSGG_TEST_USER_DATA: await mkdtemp("/tmp/ssgg-live-readonly-"),
    SSGG_READ_ONLY: "1",
  },
  timeout: 30000,
});
try {
  const page = await app.firstWindow();
  await page.getByText("READ-ONLY SESSION", { exact: false }).waitFor();
  const state = await page.evaluate(() => window.ssgg.getState());
  assert.equal(state.readOnly, true);
  assert.equal(state.audio.available, true);
  assert.equal(state.chatmix.enabled, false);
  assert.equal(await page.getByRole("button", { name: "Enable ChatMix" }).isDisabled(), true);
  await page.screenshot({ path: path.join(out, "live-readonly-mixer.png"), fullPage: true });
  await page.getByRole("button", { name: "Devices", exact: true }).click();
  if (state.devices.some((d) => d.vendorId === 0x1038 && d.productId === 0x227e)) {
    await page.getByRole("heading", { name: "Arctis Nova 7 Gen 2" }).waitFor();
    await page.getByRole("button", { name: "Download official photo" }).click();
    await page.getByRole("img", { name: "Arctis Nova 7 Gen 2 product photograph" }).waitFor({ timeout: 20000 });
  }
  await page.evaluate(async () => Promise.allSettled(document.getAnimations().map((a) => a.finished)));
  await page.screenshot({ path: path.join(out, "live-readonly-devices.png"), fullPage: true });
  await writeFile(
    path.join(out, "live-readonly-evidence.json"),
    JSON.stringify(
      {
        mode: "Real Rust sidecar --stdio --safe-mode. Inventory only, no audio/HID mutation requests.",
        electron: await app.evaluate(() => process.versions.electron),
        sandbox: !(await app.evaluate(({ app }) => app.commandLine.hasSwitch("no-sandbox"))),
        state,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        success: true,
        actualDevices: state.devices.map((d) => ({ name: d.name, id: d.id, vid: d.vendorId, pid: d.productId })),
        streams: state.streams.length,
        audioAvailable: state.audio.available,
        readOnly: state.readOnly,
        chatmixEnabled: state.chatmix.enabled,
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
}
