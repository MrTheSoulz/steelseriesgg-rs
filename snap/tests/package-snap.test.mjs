import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = new URL('../../desktop/scripts/package-snap.mjs', import.meta.url);

test('prepare creates an isolated strict project from a distribution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ssgg-snap-test-'));
  try {
    const app = join(root, 'input');
    await mkdir(join(app, 'resources/branding'), { recursive: true });
    // Real system ELF files are test fixtures, NOT an SSGG release artifact.
    await copyFile('/usr/bin/true', join(app, 'ssgg-gui'));
    await copyFile('/usr/bin/true', join(app, 'resources/ssgg-desktop'));
    await writeFile(join(app, 'resources/branding/ssgg.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const output = join(root, 'project');
    const result = spawnSync(process.execPath, [script.pathname, '--app-dir', app, '--output-dir', output, '--prepare-only'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const recipe = await readFile(join(output, 'snap/snapcraft.yaml'), 'utf8');
    assert.match(recipe, /confinement: strict/);
    assert.match(recipe, /base: core24/);
    assert.match(recipe, /allow-sandbox: true/);
    assert.doesNotMatch(recipe, /raw-usb|audio-record|classic|devmode/);
    assert.match(recipe, /pulseaudio-utils/);
    assert.equal((await readFile(join(output, 'desktop/release/app/ssgg-gui'))).subarray(0, 4).toString(), '\x7fELF');
    assert.match(await readFile(join(output, 'snap/gui/ssgg.desktop'), 'utf8'), /Exec=ssgg/);
    const again = spawnSync(process.execPath, [script.pathname, '--app-dir', app, '--output-dir', output, '--prepare-only'], { encoding: 'utf8' });
    assert.notEqual(again.status, 0);
    assert.match(again.stderr, /already exists/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('launcher preserves sandbox, snap-local state, arguments and explicit audio server', async () => {
  const { chmod } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'ssgg-snap-launch-test-'));
  try {
    await mkdir(join(root, 'app'), { recursive: true });
    // An instrumented shell fixture checks only launcher behavior.
    const capture = join(root, 'app/ssgg-gui');
    await writeFile(capture, '#!/bin/sh\nprintf "%s\\n" "$XDG_CONFIG_HOME" "$XDG_RUNTIME_DIR" "$SSGG_PACTL" "$PULSE_SERVER" "$@"\n');
    await chmod(capture, 0o755);
    const launcher = new URL('../local/bin/ssgg-launch', import.meta.url).pathname;
    const result = spawnSync('/bin/sh', [launcher, '--read-only', 'space argument'], {
      encoding: 'utf8', env: { ...process.env, SNAP: root, SNAP_USER_DATA: join(root, 'user-data'), SNAP_USER_COMMON: join(root, 'common'), XDG_RUNTIME_DIR: join(root, 'runtime'), PULSE_SERVER: 'unix:/test/private-pulse' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'), [join(root, 'user-data/.config'), join(root, 'runtime'), join(root, 'usr/bin/pactl'), 'unix:/test/private-pulse', '--read-only', 'space argument']);
    assert.doesNotMatch(await readFile(launcher, 'utf8'), /--no-sandbox|--disable.*sandbox/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('diagnostics are read-only and explain the slot and audio limitations', async () => {
  const path = new URL('../local/bin/ssgg-diagnostics', import.meta.url).pathname;
  const result = spawnSync('/bin/sh', [path], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /snap interface hidraw/);
  assert.match(result.stdout, /does not guarantee/);
  assert.match(result.stdout, /browser-support/);
  assert.doesNotMatch(await readFile(path, 'utf8'), /set-sink|set-source|load-module|chmod|sudo snap set/);
});
