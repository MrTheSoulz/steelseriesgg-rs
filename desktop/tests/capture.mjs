import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const out = path.resolve("../.impeccable/review");
await mkdir(out, { recursive: true });
const userData = await mkdtemp("/tmp/ssgg-review-");
const app = await electron.launch({
  chromiumSandbox: true,
  args: ["."],
  env: {
    ...process.env,
    NODE_ENV: "test",
    SSGG_TEST_MODE: "1",
    SSGG_TEST_USER_DATA: userData,
    SSGG_SIDECAR: path.resolve("tests/fixture-sidecar.cjs"),
  },
  timeout: 30000,
});
const evidence = [];
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("combobox", { name: "Google Chrome group" }).waitFor();
  for (const [width, height, label] of [
    [1320, 980, "desktop"],
    [900, 740, "compact"],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, { width, height }) => BrowserWindow.getAllWindows()[0].setSize(width, height),
      { width, height },
    );
    await page.emulateMedia({ reducedMotion: label === "compact" ? "reduce" : "no-preference" });
    for (const tab of ["Mixer", "Devices", ...(label === "desktop" ? ["Profiles", "Settings"] : [])]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      if (tab === "Devices" && label === "desktop") {
        await page.getByRole("button", { name: "Download official photo" }).click();
        await page.getByRole("img", { name: "Arctis Nova 7 Gen 2 product photograph" }).waitFor({ timeout: 20000 });
        assert(
          (await page.evaluate(() => window.ssgg.getArtwork("test-nova7-gen2"))).startsWith("data:image/png;base64,"),
        );
      }
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})));
        window.scrollTo(0, 0);
      });
      const filename = `${label}-${tab.toLowerCase()}.png`;
      await page.screenshot({ path: path.join(out, filename), fullPage: true });
      const metrics = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        sceneAnimation: getComputedStyle(document.querySelector(".scene")).animationName,
        images: [...document.images].map((i) => ({
          loaded: i.complete && i.naturalWidth > 0,
          width: i.naturalWidth,
          height: i.naturalHeight,
        })),
        h1: getComputedStyle(document.querySelector("h1")).fontSize,
      }));
      assert(metrics.scroll <= metrics.width, "horizontal overflow");
      if (label === "compact") assert.equal(metrics.sceneAnimation, "none");
      evidence.push({ filename, ...metrics });
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, "runtime-evidence.json"),
    JSON.stringify(
      {
        transport:
          "Explicit test process. Not host audio. Official product photo downloaded by real main-process path.",
        sandboxEnabled: !(await app.evaluate(({ app }) => app.commandLine.hasSwitch("no-sandbox"))),
        electron: await app.evaluate(() => process.versions.electron),
        userData,
        captures: evidence,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await app.close();
}
