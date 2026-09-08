import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binary = path.join(desktop, "local-bin/ssgg-desktop");
await access(binary);
await access(path.join(desktop, "dist-main/main.cjs"));
const child = spawn(electron, [desktop, ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: false,
  env: { ...process.env, SSGG_SIDECAR: binary },
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
