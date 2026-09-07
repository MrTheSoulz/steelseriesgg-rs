import { spawnSync } from "node:child_process";
import { mkdir, copyFile, chmod, stat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const override = process.argv[2];
if (override && !path.isAbsolute(override))
  throw new Error("Pass an absolute prebuilt Rust binary path, or omit it to build with Cargo.");
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false });
  if (result.error || result.status !== 0)
    throw new Error(`${command} failed: ${result.error?.message || result.status}`);
}
if (!override) run("cargo", ["build", "--locked", "--bin", "ssgg-desktop"], path.dirname(desktop));
const source = override || path.join(desktop, "../target/debug/ssgg-desktop");
if (!(await stat(source)).isFile()) throw new Error("Rust binary is not a regular file");
await mkdir(path.join(desktop, "local-bin"), { recursive: true, mode: 0o700 });
await copyFile(source, path.join(desktop, "local-bin/ssgg-desktop"));
await chmod(path.join(desktop, "local-bin/ssgg-desktop"), 0o755);
const template = await readFile(path.join(desktop, "../assets/ssgg-desktop.service"), "utf8");
await writeFile(
  path.join(desktop, "local-bin/ssgg-desktop-local.service"),
  template.replace(
    "ExecStart=%h/.local/bin/ssgg-desktop",
    `ExecStart=${JSON.stringify(path.join(desktop, "local-bin/ssgg-desktop"))}`,
  ),
  { mode: 0o600 },
);
run("npm", ["run", "build"], desktop);
console.log(
  "Built local launch artifact. Run: npm run launch -- --read-only (inspection), or npm run launch (controls).",
);
