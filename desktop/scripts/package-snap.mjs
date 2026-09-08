#!/usr/bin/env node
import { cp, mkdir, readFile, copyFile, readdir, lstat, readlink, chmod, writeFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../../', import.meta.url));

function run(command, args, cwd) {
  // readelf fields are parsed below; never inherit translated labels from the host.
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  if (result.error || result.status !== 0) {
    throw new Error(`${command}: ${result.error?.message || result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function validateApp(app) {
  for (const name of ['ssgg-gui', 'resources/ssgg-desktop']) {
    const path = join(app, name);
    let data;
    try { data = await readFile(path); } catch { throw new Error(`Missing shared distribution file: ${path}; build the standalone app first`); }
    if (data.length < 64 || data.subarray(0, 4).toString() !== '\x7fELF' || data[4] !== 2 || data[5] !== 1 || data.readUInt16LE(18) !== 62) {
      throw new Error(`${name} must be a real Linux amd64 ELF binary`);
    }
  }
  // Scan every ELF, including native modules, without executing the application.
  async function walk(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isSymbolicLink()) {
        const target = await readlink(path);
        const rel = relative(app, resolve(dirname(path), target));
        if (isAbsolute(target) || rel === '..' || rel.startsWith('../')) throw new Error(`Non-relocatable application symlink: ${path}`);
      } else if (item.isDirectory()) {
        await walk(path);
      } else if (item.isFile()) {
        const data = await readFile(path);
        if (data.subarray(0, 4).toString() !== '\x7fELF') continue;
        const info = run('readelf', ['--version-info', path]);
        const versions = [...info.matchAll(/Name: GLIBC_(\d+)\.(\d+)/g)];
        if (versions.some(([, major, minor]) => Number(major) > 2 || (Number(major) === 2 && Number(minor) > 39))) {
          throw new Error(`${path} requires GLIBC newer than core24 (2.39); rebuild the distribution on Ubuntu 24.04`);
        }
      }
    }
  }
  await walk(app);
}

async function main() {
  const { values } = parseArgs({ options: {
    'app-dir': { type: 'string' }, 'output-dir': { type: 'string' },
    icon: { type: 'string' }, version: { type: 'string' },
    'prepare-only': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    console.log('Usage: node desktop/scripts/package-snap.mjs --app-dir PATH [--icon SVG] [--version VERSION] [--output-dir NEW_PATH] [--prepare-only]');
    return;
  }
  const app = resolve(values['app-dir'] || join(root, 'desktop/release/app'));
  const output = resolve(values['output-dir'] || join(root, 'desktop/release/snap-project'));
  const rel = relative(app, output);
  if (!rel || (!rel.startsWith('../') && rel !== '..' && !isAbsolute(rel))) throw new Error('Output must be outside the input distribution');
  await validateApp(app);
  const icon = resolve(values.icon || join(app, 'resources/branding/ssgg.svg'));
  const svg = await readFile(icon, 'utf8');
  if (!/<svg\b/.test(svg)) throw new Error('--icon must point to the real SSGG SVG branding asset');
  const version = values.version || JSON.parse(await readFile(join(root, 'desktop/package.json'), 'utf8')).version;
  if (!/^[A-Za-z0-9][A-Za-z0-9.+:~\-]{0,31}$/.test(version)) throw new Error('Invalid Snap version');
  try { await lstat(output); throw new Error(`Output already exists: ${output}; choose a new --output-dir`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(output, { recursive: true });
  await cp(join(root, 'snap'), join(output, 'snap'), { recursive: true, filter: (path) => !path.includes('/snap/tests') });
  await cp(app, join(output, 'desktop/release/app'), { recursive: true, verbatimSymlinks: true });
  await copyFile(icon, join(output, 'snap/gui/ssgg.svg'));
  for (const name of ['ssgg-launch', 'ssgg-diagnostics']) {
    await chmod(join(output, 'snap/local/bin', name), 0o755);
  }
  const recipePath = join(output, 'snap/snapcraft.yaml');
  const recipe = (await readFile(recipePath, 'utf8')).replace(/^version:.*$/m, `version: '${version}'`);
  await writeFile(recipePath, recipe);
  console.log(`Prepared strict core24 Snap project: ${output}`);
  if (values['prepare-only']) return;
  const build = spawnSync('snapcraft', ['pack'], { cwd: output, stdio: 'inherit' });
  if (build.error) throw new Error(`Snapcraft is required to stage Ubuntu 24.04 dependencies and expand the GNOME extension. Project preserved at ${output}: ${build.error.message}`);
  if (build.status !== 0) throw new Error(`snapcraft pack failed (${build.status}); project preserved at ${output}`);
  const artifacts = (await readdir(output)).filter((name) => name.endsWith('.snap'));
  if (artifacts.length !== 1) throw new Error(`Expected exactly one .snap, found ${artifacts.length}`);
  const artifact = join(output, artifacts[0]);
  const metadata = run('unsquashfs', ['-cat', artifact, 'meta/snap.yaml']);
  if (!/^confinement: strict$/m.test(metadata) || !/^base: core24$/m.test(metadata)) throw new Error('Built artifact is not strict core24');
  console.log(`Built and metadata-verified: ${artifact}\nNot yet validated under installed strict confinement; see snap/README.md.`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
