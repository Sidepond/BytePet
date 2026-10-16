import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import manifest from '../desktop/sprite-manifest.js';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

// Use the approved Marmalade idle frame, with no separately drawn substitute.
export async function createIcon(directory) {
  await mkdir(directory, { recursive: true });
  const scratch = await mkdtemp(path.join(tmpdir(), 'bytepet-icon-'));
  const source = path.join(directory, 'BytePet.png');
  const sheet = await readFile(path.join(root, 'desktop', manifest['cat-cheese'].actions.idle.file));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    await writeFile(path.join(scratch, 'main.cjs'), `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(scratch, 'profile'))});
app.whenReady().then(()=>new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}}).loadURL('about:blank'));`);
    app = await electron.launch({ args: [path.join(scratch, 'main.cjs')], env });
    const page = await app.firstWindow();
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
    await rm(scratch, { recursive: true, force: true });
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
