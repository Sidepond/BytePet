import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import manifest from '../desktop/sprite-manifest.js';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

// Use the approved Marmalade idle frame, with no separately drawn substitute.
export async function createIcon(directory) {
  await mkdir(directory, { recursive: true });
  const source = path.join(directory, 'BytePet.png');
  const sheet = await readFile(path.join(root, 'desktop', manifest['cat-cheese'].actions.idle.file));
  let app;
  try {
    app = await chromium.launch();
    const page = await app.newPage();
    const png = await page.evaluate(async data => {
      const image = new Image(); image.src = data; await image.decode();
      if (image.width !== 384 || image.height !== 192) throw new Error('Unexpected Marmalade sprite dimensions');
      const frame = document.createElement('canvas'); frame.width = frame.height = 96;
      const frameContext = frame.getContext('2d');
      frameContext.drawImage(image, 0, 0, 96, 96, 0, 0, 96, 96);
      const pixels = frameContext.getImageData(0, 0, 96, 96).data;
      let left = 96, top = 96, right = -1, bottom = -1;
      for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
        if (!pixels[(y * 96 + x) * 4 + 3]) continue;
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
      if (right < left) throw new Error('Marmalade frame is empty');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
      const ctx = canvas.getContext('2d');
      // Keep the familiar teal macOS tile and transparent outer margins.
      ctx.fillStyle = '#459b8f'; ctx.beginPath(); ctx.roundRect(80, 80, 864, 864, 180); ctx.fill();
      const width = right - left + 1, height = bottom - top + 1;
      const scale = Math.floor(720 / Math.max(width, height));
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(frame, left, top, width, height,
        Math.round((1024 - width * scale) / 2), Math.round((1024 - height * scale) / 2), width * scale, height * scale);
      return canvas.toDataURL('image/png').split(',')[1];
    }, `data:image/png;base64,${sheet.toString('base64')}`);
    await writeFile(source, Buffer.from(png, 'base64'));
  } finally {
    if (app) await app.close();
  }

  const iconset = path.join(directory, 'BytePet.iconset');
  await mkdir(iconset, { recursive: true });
  for (const points of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const target = path.join(iconset, `icon_${points}x${points}${scale === 2 ? '@2x' : ''}.png`);
      await exec('/usr/bin/sips', ['--resampleHeightWidth', String(points * scale), String(points * scale), source, '--out', target]);
    }
  }
  const icon = path.join(directory, 'BytePet.icns');
  await exec('/usr/bin/iconutil', ['--convert', 'icns', iconset, '--output', icon]);
  return icon;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.join(root, 'build/icons');
  const icon = await createIcon(directory);
  await cp(icon, path.join(root, 'src-tauri/icons/icon.icns'));
  await cp(path.join(directory, 'BytePet.png'), path.join(root, 'src-tauri/icons/icon.png'));
  console.log('Updated Tauri app icons from the approved Marmalade frame.');
}
