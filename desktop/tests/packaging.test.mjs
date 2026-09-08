import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink, rm, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectElf, validateTree, compareVersions } from "../scripts/package-lib.mjs";
import * as packaging from "../scripts/package-lib.mjs";

test("package builds use a portable Rust CPU baseline instead of developer tuning", () => {
  assert.equal(typeof packaging.portableCargoEnv, "function");
  const original = {
    PATH: "/test/bin",
    RUSTFLAGS: "-Ctarget-cpu=native",
    CARGO_ENCODED_RUSTFLAGS: "-Ctarget-cpu=x86-64-v3",
  };
  assert.deepEqual(packaging.portableCargoEnv(original), { PATH: "/test/bin", RUSTFLAGS: "-Ctarget-cpu=x86-64" });
  assert.equal(original.RUSTFLAGS, "-Ctarget-cpu=native");
});

test("derive the real ELF ABI floor instead of claiming a build is portable", async () => {
  const result = await inspectElf("/bin/true");
  assert.equal(result.architecture, "amd64");
  assert.match(result.glibc, /^2\.\d+$/);
  assert.equal(compareVersions("2.9", "2.39"), -1);
  assert.equal(compareVersions("2.42", "2.39"), 1);
  await assert.rejects(inspectElf(import.meta.filename), /ELF/);
});

test("refuse machine-specific symlinks and writable shipped files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ssgg-package-test-"));
  try {
    await writeFile(path.join(root, "chrome-sandbox"), "fixture", { mode: 0o755 });
    await validateTree(root);
    await symlink("/opt/google/chrome/chrome-sandbox", path.join(root, "helper"));
    await assert.rejects(validateTree(root), /symbolic link/);
    await rm(path.join(root, "helper"));
    await writeFile(path.join(root, "unsafe"), "fixture", { mode: 0o666 });
    const { chmod } = await import("node:fs/promises");
    await chmod(path.join(root, "unsafe"), 0o666);
    await assert.rejects(validateTree(root), /writable/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
