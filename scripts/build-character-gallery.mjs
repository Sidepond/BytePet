import { readFile, writeFile, mkdir, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { profiles } from './pixellab-character-profiles.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'art/pixellab-character-pack');
const posesOnly = process.argv[2] === 'poses';
const dataURL = async file => `data:image/png;base64,${(await readFile(file)).toString('base64')}`;
await mkdir(directory, { recursive: true });
const pack = [];
for (const [id, profile] of Object.entries(profiles)) {
  const folder = path.join(root, 'art', `${id}-pixellab`);
  if (posesOnly) {
    pack.push({ id, name: profile.name, kind: profile.kind, src: await dataURL(path.join(folder, 'source/design/00.png')) });
  } else {
    const atlas = JSON.parse(await readFile(path.join(folder, 'atlas.json'), 'utf8'));
    assert.equal(atlas.frame.width, 96); assert.equal(atlas.frame.height, 96);
    assert.equal(atlas.frames, 8); assert.equal(atlas.pivot.y, 90);
    await access(path.join(folder, 'preview.html'));
    pack.push({ id, catalogId: profile.catalogId, name: profile.name, kind: profile.kind, atlas,
      sheets: Object.fromEntries(await Promise.all(['idle', 'sleeping'].map(async action => [action, await dataURL(path.join(folder, `${action}.png`))]))) });
  }
}
if (!posesOnly) for (const action of ['idle', 'sleeping']) assert.equal(new Set(pack.map(pet => pet.sheets[action])).size, 6, `${action}: all character sheets must be distinct`);
const scratch = await mkdtemp(path.join(tmpdir(), 'bytepet-gallery-'));
await writeFile(path.join(scratch, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(scratch,'profile'))});app.whenReady().then(()=>new BrowserWindow({show:false,width:1120,height:1030}).loadURL('about:blank'));`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: [path.join(scratch, 'main.cjs')], env });
  const page = await app.firstWindow();
  if (posesOnly) {
    const png = await page.evaluate(async pack => {
      const canvas = document.createElement('canvas'); canvas.width = 6 * 224; canvas.height = 272;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f3f4ef'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false; ctx.textAlign = 'center';
      for (const [i, entry] of pack.entries()) {
        const image = new Image(); image.src = entry.src; await image.decode();
        ctx.drawImage(image, i * 224 + 16, 12, 192, 192);
        ctx.fillStyle = '#313c36'; ctx.font = 'bold 18px sans-serif'; ctx.fillText(entry.name, i * 224 + 112, 232);
        ctx.fillStyle = '#6b786d'; ctx.font = '14px sans-serif'; ctx.fillText(entry.kind, i * 224 + 112, 254);
      }
      return canvas.toDataURL();
    }, pack);
    await writeFile(path.join(directory, 'designs.png'), Buffer.from(png.split(',')[1], 'base64'));
    console.log(path.join(directory, 'designs.png'));
  } else {
    const template = await readFile(path.join(root, 'scripts/character-gallery.html'), 'utf8');
    const preview = path.join(directory, 'preview.html');
    await writeFile(preview, template.replace('/* GENERATED_PACK */', `const pack = ${JSON.stringify(pack).replaceAll('<', '\\u003c')};`));
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.clock.install();
    await page.goto(pathToFileURL(preview).href);
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    assert.equal(await page.locator('.card').count(), 6);
    await page.clock.pauseAt(new Date()); await page.clock.runFor(750);
    assert.deepEqual(await page.locator('.frame').allTextContents(), Array(6).fill('2 / 8'));
    await page.getByRole('button', { name: '일시 정지', exact: true }).click();
    const snapshots = await page.locator('.stage canvas').evaluateAll(canvases => canvases.map(canvas => canvas.toDataURL()));
    await page.clock.runFor(1200);
    assert.deepEqual(await page.locator('.stage canvas').evaluateAll(canvases => canvases.map(canvas => canvas.toDataURL())), snapshots);
    await page.screenshot({ path: path.join(directory, 'preview.png'), fullPage: true });
    await page.getByRole('button', { name: '잠자기', exact: true }).click();
    await page.getByRole('button', { name: '다음 프레임', exact: true }).click();
    assert.deepEqual(await page.locator('.frame').allTextContents(), Array(6).fill('2 / 8'));
    await page.screenshot({ path: path.join(directory, 'sleeping-preview.png'), fullPage: true });
    await page.locator('#zoom').selectOption('1');
    assert.ok(await page.locator('.stage canvas').evaluateAll(canvases => canvases.every(canvas => canvas.getBoundingClientRect().width === 96)));
    await page.getByRole('button', { name: '재생', exact: true }).click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('#play').textContent === '재생');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#zoom').selectOption('2');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    assert.equal(await page.getByRole('button', { name: '재생', exact: true }).count(), 1);
    await page.clock.runFor(1200);
    assert.deepEqual(await page.locator('.frame').allTextContents(), Array(6).fill('1 / 8'), 'reduced motion starts paused');
    assert.deepEqual(errors, []);
    const manifest = { version: 1, characters: pack.map(({ id, catalogId, name, kind }) => ({ id, catalogId, name, kind, directory: `../${id}-pixellab` })),
      frame: { width: 96, height: 96 }, states: ['idle', 'sleeping'], framesPerState: 8 };
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    const validation = { characters: 6, actions: 12, displayedFrames: 96,
      checks: ['six distinct characters', 'matching frame size and floor', 'all playback advances', 'all pause', 'action and frame selection', '96px actual size', 'detail links exist', 'reduced motion on change and initial load', 'mobile overflow', 'no page errors'] };
    await writeFile(path.join(directory, 'validation.json'), JSON.stringify(validation, null, 2) + '\n');
    console.log(JSON.stringify({ preview, ...validation }, null, 2));
  }
} finally { await app?.close(); await rm(scratch, { recursive: true, force: true }); }
