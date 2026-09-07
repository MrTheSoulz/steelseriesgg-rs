#!/usr/bin/env node
// Build-time tooling only: no renderer dependency is required by the app.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/branding');
const dependencyRoot = process.env.SSGG_BRANDING_RENDERER || join(homedir(), '.cache/ssgg-branding-renderer');
const require = createRequire(join(dependencyRoot, 'package.json'));
let Resvg, sharp;
try {
  ({ Resvg } = require('@resvg/resvg-js'));
  sharp = require('sharp');
} catch {
  throw new Error('Install build-only renderers using the command in desktop/assets/branding/PROVENANCE.md.');
}
assert.equal(require('@resvg/resvg-js/package.json').version, '2.6.2');
assert.equal(require('sharp/package.json').version, '0.34.5');
const check = process.argv.includes('--check');
const source = await readFile(join(root, 'ssgg.svg'), 'utf8');
const signal = source.match(/<g id="signal"[\s\S]*?<\/g>/)?.[0];
assert.ok(signal, 'Canonical SVG must contain the signal group');
const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
const traySizes = [16, 22, 24, 32, 44];
const mono = (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><title>SSGG</title>${signal.replace(/stroke="#[a-f0-9]+"/g, `stroke="${color}"`)}</svg>\n`;
const symbolic = mono('#2e3436');
const provenance = 'Original SSGG Split signal vector; source: desktop/assets/branding/ssgg.svg; license: MIT; recipe: desktop/scripts/generate-branding.mjs; not manufacturer artwork.';

// PNG text metadata is deterministic and survives independently of the folder.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function withProvenance(png) {
  const text = Buffer.from(`Description\0${provenance}`, 'latin1');
  const body = Buffer.concat([Buffer.from('tEXt'), text]);
  const chunk = Buffer.alloc(body.length + 8);
  chunk.writeUInt32BE(text.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), chunk.length - 4);
  return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
}
function render(svg, size) {
  return withProvenance(new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());
}
const outputs = new Map([['ssgg-symbolic.svg', Buffer.from(symbolic)]]);
for (const size of sizes) outputs.set(`sizes/${size}.png`, render(source, size));
outputs.set('ssgg.png', outputs.get('sizes/512.png'));
for (const [name, color] of [['light', '#ffffff'], ['dark', '#20282d']]) {
  for (const size of traySizes) outputs.set(`tray/${name}-${size}.png`, render(mono(color), size));
  outputs.set(`ssgg-tray-${name}.png`, outputs.get(`tray/${name}-22.png`));
}

const report = { source: 'ssgg.svg', renderer: '@resvg/resvg-js@2.6.2', pngDecoder: 'sharp@0.34.5', icons: [] };
for (const [name, data] of outputs) {
  const path = join(root, name);
  if (check) assert.deepEqual(await readFile(path), data, `${name} is stale; regenerate branding`);
  else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }
  if (!name.endsWith('.png')) continue;
  const metadata = await sharp(data).metadata();
  const size = name.match(/(?:sizes\/|-(\d+)\.png$)/);
  const expectedSize = name.startsWith('sizes/') ? Number(name.split('/')[1].split('.')[0]) : name === 'ssgg.png' ? 512 : Number(size?.[1] || 22);
  assert.equal(metadata.width, expectedSize, name);
  assert.equal(metadata.height, expectedSize, name);
  assert.equal(metadata.hasAlpha, true, name);
  const { data: rgba, info } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  let transparent = 0, opaque = 0, partial = 0;
  const expectedColor = name.includes('light') ? [255, 255, 255] : [32, 40, 45];
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3];
    if (alpha === 0) transparent++;
    else if (alpha === 255) opaque++;
    else partial++;
    if (alpha === 255 && (name.includes('tray') || name.includes('dark') || name.includes('light'))) {
      assert.deepEqual([...rgba.subarray(i, i + 3)], expectedColor, `${name}: wrong foreground`);
    }
  }
  assert.ok(transparent > 0 && opaque > 0 && partial > 0, `${name}: missing transparency, ink or antialiasing`);
  assert.equal(rgba[3], 0, `${name}: corner must be transparent`);
  assert.ok(data.includes(Buffer.from(provenance)), `${name}: missing embedded provenance`);
  report.icons.push({ file: name, width: info.width, height: info.height, alpha: true, transparentPixels: transparent, opaquePixels: opaque, antialiasedPixels: partial, sha256: createHash('sha256').update(data).digest('hex') });
}
for (const size of traySizes) {
  const a = await sharp(outputs.get(`tray/light-${size}.png`)).extractChannel('alpha').raw().toBuffer();
  const b = await sharp(outputs.get(`tray/dark-${size}.png`)).extractChannel('alpha').raw().toBuffer();
  assert.deepEqual(a, b, `Tray silhouettes differ at ${size}px`);
}
// Test scalable symbolic geometry at the smallest requested panel sizes too.
for (const size of [16, 22, 32]) {
  const symbolAlpha = await sharp(render(symbolic, size)).extractChannel('alpha').raw().toBuffer();
  const trayAlpha = await sharp(outputs.get(`tray/dark-${size}.png`)).extractChannel('alpha').raw().toBuffer();
  assert.deepEqual(symbolAlpha, trayAlpha, `Symbolic geometry differs at ${size}px`);
}
report.symbolicSizesVerified = [16, 22, 32];
report.traySilhouettesMatch = true;

if (!check) {
  // Native-size cells: never upscale tiny icons to conceal raster defects.
  const width = 1120, height = 680;
  const label = (text, x, y, fill = '#596770', fontSize = 14) => `<text x="${x}" y="${y}" fill="${fill}" font-family="sans-serif" font-size="${fontSize}">${text}</text>`;
  let board = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="1120" height="680" fill="#edf0f2"/>`;
  board += label('SSGG / Split signal', 32, 42, '#263238', 26);
  board += label('Original two-channel mark · icons shown at native pixel size', 32, 70);
  const composites = [];
  const proofSizes = [16, 22, 24, 32, 48, 64, 128, 256];
  const xs = [42, 112, 190, 273, 365, 468, 590, 792];
  for (let i = 0; i < proofSizes.length; i++) {
    const size = proofSizes[i];
    composites.push({ input: render(source, size), left: xs[i], top: 112 });
    board += label(`${size}px`, xs[i], 396);
  }
  board += '<rect x="24" y="422" width="528" height="170" rx="12" fill="#20282d"/><rect x="568" y="422" width="528" height="170" rx="12" fill="#ffffff"/>';
  board += label('Dark panel / white glyph', 42, 455, '#f8fafb');
  board += label('Light panel / graphite glyph', 586, 455, '#263238');
  for (const [side, name] of [[0, 'light'], [1, 'dark']]) {
    for (let i = 0; i < traySizes.length; i++) {
      const size = traySizes[i], x = 48 + side * 544 + i * 94;
      composites.push({ input: outputs.get(`tray/${name}-${size}.png`), left: x, top: 482 });
      board += label(`${size}px`, x, 566, side === 0 ? '#c5d4d3' : '#596770');
    }
  }
  board += label('No SteelSeries artwork. Matching geometry in app, symbolic and panel variants.', 32, 634);
  board += '</svg>';
  const sheet = await sharp(new Resvg(board).render().asPng()).composite(composites).png().toBuffer();
  await mkdir(join(root, 'proof'), { recursive: true });
  await writeFile(join(root, 'proof/contact-sheet.png'), withProvenance(sheet));
  await writeFile(join(root, 'proof/verification.json'), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(`${check ? 'Verified byte-for-byte reproduction of' : 'Generated and verified'} ${report.icons.length} PNG icons + symbolic SVG. Dimensions, transparent corners, antialiasing, foreground colors, tray silhouette parity and embedded provenance passed.`);
