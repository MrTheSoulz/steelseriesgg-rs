import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, chmod, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import assert from "node:assert/strict";
const root = await mkdtemp("/tmp/ssgg-service-smoke-");
const fixture = JSON.parse(await readFile("tests/fixture.json", "utf8"));
await mkdir(path.join(root, "ssgg-desktop"), { mode: 0o700 });
const target = path.join(root, "ssgg-desktop/service.sock");
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
            : { id: request.id, error: { code: "UNSUPPORTED", message: "Fixture has no hardware bridge" } },
        ) + "\n",
      );
    }
  });
});
await new Promise((resolve) => server.listen(target, resolve));
await chmod(target, 0o600);
await copyFile("tests/fixture-sidecar.cjs", path.join(root, "fixture-sidecar.cjs"));
await chmod(path.join(root, "fixture-sidecar.cjs"), 0o755);
await copyFile("tests/fixture.json", path.join(root, "fixture.json"));
const env = {
  ...process.env,
  NODE_ENV: "test",
  SSGG_TEST_MODE: "1",
  SSGG_TEST_SOCKET: "1",
  XDG_RUNTIME_DIR: root,
  SSGG_TEST_USER_DATA: path.join(root, "userdata"),
  SSGG_SIDECAR: path.join(root, "fixture-sidecar.cjs"),
  SSGG_READ_ONLY: "0",
};
let app;
try {
  app = await electron.launch({ chromiumSandbox: true, args: ["--ozone-platform=x11", "."], env });
  let page = await app.firstWindow();
  await page.getByRole("combobox", { name: "Google Chrome group" }).waitFor();
  assert.equal((await page.evaluate(() => window.ssgg.getRuntime())).transport, "socket");
  assert(requests.every((r) => r.method === "state.get"));
  assert.match(
    await page.evaluate(async () => {
      try {
        await window.ssgg.setDevice({ id: "test-nova7-gen2", hardwareEnabled: true });
      } catch (e) {
        return e.message;
      }
    }),
    /no hardware bridge/,
  );
  for (const peer of peers) peer.destroy();
  await page.getByRole("button", { name: "Refresh audio and devices" }).click();
  await page.waitForFunction(async () => (await window.ssgg.getRuntime()).connected);
  assert.equal((await page.evaluate(() => window.ssgg.getState())).streams.length, fixture.streams.length);
  await app.close();
  app = null;
  assert(server.listening, "GUI quit must not stop external service");
  const before = connections;
  app = await electron.launch({
    chromiumSandbox: true,
    args: ["--ozone-platform=x11", "."],
    env: { ...env, SSGG_READ_ONLY: "1" },
  });
  page = await app.firstWindow();
  await page.getByRole("combobox", { name: "Google Chrome group" }).waitFor();
  const info = await page.evaluate(() => window.ssgg.getRuntime());
  assert.equal(info.transport, "sidecar");
  assert.equal(info.readOnly, true);
  for (const method of ["setStream", "setGroup", "setChatmix", "setDevice", "saveProfile", "applyProfile"]) {
    assert.match(
      await page.evaluate(async (method) => {
        const value = {
          setStream: { id: "101", volume: 0.5 },
          setGroup: { id: "media", muted: true },
          setChatmix: { enabled: true },
          setDevice: { id: "test-nova7-gen2", hardwareEnabled: true },
          saveProfile: "Safe",
          applyProfile: "Safe",
        }[method];
        try {
          await window.ssgg[method](value);
          return "NOT BLOCKED";
        } catch (e) {
          return e.message;
        }
      }, method),
      /Read-only/,
    );
  }
  assert.equal(connections, before, "Safe inspection must never attach to writable service");
  await app.close();
  app = null;
  const locked = path.join(root, "locked.cjs");
  await writeFile(
    locked,
    '#!/usr/bin/env node\nprocess.stderr.write("configuration lock is held by another service\\n"); process.exit(1);\n',
    { mode: 0o755 },
  );
  app = await electron.launch({
    chromiumSandbox: true,
    args: ["--ozone-platform=x11", "."],
    env: { ...env, SSGG_TEST_SOCKET: "0", SSGG_SIDECAR: locked },
  });
  page = await app.firstWindow();
  await page
    .getByText("Another SSGG service owns this configuration.", { exact: false })
    .first()
    .waitFor({ timeout: 10000 });
  console.log(
    "PASS: private UDS, reconnect, no startup writes, external owner survives GUI quit, unsupported hardware remains error, isolated safe sidecar and all mutation IPC blocked",
  );
} finally {
  if (app) await app.close();
  for (const peer of peers) peer.destroy();
  server.close();
  await rm(root, { recursive: true, force: true });
}
