import assert from "node:assert/strict";
import { mkdtemp, readFile, lstat, rm, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { run, validateTree, inspectElf } from "./package-lib.mjs";

const deb = process.argv[2];
assert(deb && path.isAbsolute(deb), "Pass the absolute .deb path");
const root = await mkdtemp(path.join(os.tmpdir(), "ssgg-deb-check-"));
try {
  run("dpkg-deb", ["--raw-extract", deb, root]);
  const app = path.join(root, "opt/ssgg");
  await validateTree(app);
  assert.equal((await inspectElf(path.join(app, "ssgg-gui"))).architecture, "amd64");
  assert.equal((await inspectElf(path.join(app, "resources/ssgg-desktop"))).architecture, "amd64");
  assert.equal((await lstat(path.join(app, "resources/ssgg-desktop"))).mode & 0o7777, 0o755);
  const listing = run("dpkg-deb", ["--contents", deb]);
  assert.match(listing, /-rwsr-xr-x root\/root.*\.\/opt\/ssgg\/chrome-sandbox/);
  const manifest = JSON.parse(await readFile(path.join(app, "resources/app/package.json"), "utf8"));
  assert.equal(manifest.productName, "SSGG");
  assert.equal(manifest.desktopName, "io.github.MrTheSoulz.SSGG.desktop");
  await readFile(path.join(app, "resources/app/dist/index.html"));
  await readFile(path.join(app, "resources/app/dist-main/main.cjs"));
  assert(!(await readdir(path.join(app, "resources"))).includes("default_app.asar"));
  const main = await readFile(path.join(app, "resources/app/dist-main/main.cjs"), "utf8");
  assert(!main.includes('"no-sandbox"'));
  const desktop = path.join(root, "usr/share/applications/io.github.MrTheSoulz.SSGG.desktop");
  run("desktop-file-validate", [desktop]);
  assert.match(await readFile(desktop, "utf8"), /StartupWMClass=io.github.MrTheSoulz.SSGG/);
  for (const file of ["ssgg.png", "ssgg.svg", "ssgg-tray-light.png", "ssgg-tray-dark.png", "ssgg-symbolic.svg"])
    assert((await lstat(path.join(app, "resources/branding", file))).size > 0);
  for (const file of ["postinst", "postrm"]) {
    const script = path.join(root, "DEBIAN", file);
    run("sh", ["-n", script]);
    assert(!/systemctl|reboot|chmod\s+666|--no-sandbox/.test(await readFile(script, "utf8")));
  }
  const control = run("dpkg-deb", ["--field", deb]);
  assert.match(control, /Depends:.*pulseaudio-utils/);
  assert(!/Depends:.*(?:nodejs|rustc|google-chrome)/.test(control));
  assert(!listing.includes("/systemd/") && !listing.includes("/autostart/"));
  const abi = JSON.parse(await readFile(path.join(app, "resources/build-info.json"), "utf8"));
  if (process.argv.includes("--runtime"))
    for (const file of Object.keys(abi.binaries)) {
      const dependencies = run("ldd", [path.join(app, file)], { env: { ...process.env, LC_ALL: "C" } });
      assert(!dependencies.includes("not found"), `Missing runtime library for ${file}: ${dependencies}`);
    }
  assert(control.includes(`libc6 (>= ${abi.glibc})`));
  console.log(
    JSON.stringify(
      { deb, archiveVerified: true, sandbox: "root:root 4755", identity: manifest.desktopName, ...abi },
      null,
      2,
    ),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
