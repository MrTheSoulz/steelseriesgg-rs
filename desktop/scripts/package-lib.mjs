import { spawnSync } from "node:child_process";
import { lstat, readdir, open } from "node:fs/promises";
import path from "node:path";

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: false, ...options });
  if (result.error || result.status !== 0)
    throw new Error(`${command} failed: ${result.error?.message || result.stderr || result.status}`);
  return result.stdout;
}
export function compareVersions(a, b) {
  const left = a.split(".").map(Number),
    right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] || 0) - (right[i] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}
export async function inspectElf(file) {
  const handle = await open(file, "r");
  const header = Buffer.alloc(20);
  try {
    await handle.read(header, 0, 20, 0);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) || header[4] !== 2 || header[5] !== 1)
    throw new Error(`Expected a 64-bit little-endian ELF: ${file}`);
  const architecture = { 62: "amd64", 183: "arm64" }[header.readUInt16LE(18)];
  if (!architecture) throw new Error(`Unsupported ELF architecture: ${file}`);
  const versions = run("readelf", ["--version-info", file]);
  const requirements = {};
  for (const family of ["GLIBC", "GLIBCXX", "CXXABI"]) {
    const found = [...versions.matchAll(new RegExp(`\\b${family}_([0-9]+(?:\\.[0-9]+)+)`, "g"))].map((m) => m[1]);
    if (found.length) requirements[family.toLowerCase()] = found.sort(compareVersions).at(-1);
  }
  return { architecture, ...requirements };
}
export async function validateTree(directory) {
  for (const entry of await readdir(directory)) {
    const file = path.join(directory, entry),
      info = await lstat(file);
    if (info.isSymbolicLink()) throw new Error(`Shipped symbolic link is forbidden: ${file}`);
    if ((info.mode & 0o022) !== 0) throw new Error(`Shipped file is group/world writable: ${file}`);
    if (info.isDirectory()) await validateTree(file);
    else if (!info.isFile()) throw new Error(`Shipped special file is forbidden: ${file}`);
  }
}
