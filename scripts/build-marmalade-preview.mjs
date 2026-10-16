import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { profiles } from './pixellab-character-profiles.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const character = process.argv[3] ?? 'marmalade';
assert.ok(Object.hasOwn(profiles, character), 'Unknown character profile');
const profile = profiles[character];
const directory = path.join(root, 'art', `${character}-pixellab`);
const prepare = ['prepare', 'prepare-design'].includes(process.argv[2]);
assert.ok(process.argv[2] === undefined || process.argv[2] === 'build' || prepare, 'Usage: build-marmalade-preview.mjs [build|prepare|prepare-design] [character]');
const dataURL = async file => `data:image/png;base64,${(await readFile(file)).toString('base64')}`;
const sources = {};
for (const [action, pose] of [['idle', 'design'], ['sleeping', 'sleep-pose-wide']]) {
  if (process.argv[2] === 'prepare-design' && action !== 'idle') continue;
  const folder = path.join(directory, 'source', prepare ? pose : action);
  const files = (await readdir(folder)).filter(name => /^\d\d\.png$/.test(name)).sort();
  assert.equal(files.length, prepare ? 1 : 9, `${action}: unexpected API frame count`);
  sources[action] = await Promise.all(files.map(name => dataURL(path.join(folder, name))));
}
const scratch = await mkdtemp(path.join(tmpdir(), 'bytepet-marmalade-'));
await writeFile(path.join(scratch, 'main.cjs'), `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(scratch, 'profile'))});
app.whenReady().then(()=>new BrowserWindow({show:false,width:1120,height:900}).loadURL('about:blank'));`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: [path.join(scratch, 'main.cjs')], env });
  const page = await app.firstWindow();
  const result = await page.evaluate(async ({ sources, prepare, frameOrder, removeFloating }) => {
    const canvas = (width, height) => Object.assign(document.createElement('canvas'), { width, height });
    const bounds = frame => {
      const { data } = frame.getContext('2d').getImageData(0, 0, frame.width, frame.height);
      let left = frame.width, top = frame.height, right = -1, bottom = -1, visible = 0;
      for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
        if (!data[(y * frame.width + x) * 4 + 3]) continue;
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); visible++;
      }
      if (!visible) throw new Error('Empty frame');
      return { left, top, right, bottom, visible };
    };
    const actions = {};
    const withoutFloatingMarks = source => {
      const frame = canvas(48, 48), ctx = frame.getContext('2d'); ctx.drawImage(source, 0, 0);
      const pixels = ctx.getImageData(0, 0, 48, 48), seen = new Set(), groups = [];
      for (let start = 0; start < 48 * 48; start++) {
        if (!pixels.data[start * 4 + 3] || seen.has(start)) continue;
        const points = [start]; seen.add(start);
        for (let i = 0; i < points.length; i++) {
          const x = points[i] % 48, y = Math.floor(points[i] / 48);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy, p = yy * 48 + xx;
            if (xx < 0 || xx >= 48 || yy < 0 || yy >= 48 || seen.has(p) || !pixels.data[p * 4 + 3]) continue;
            seen.add(p); points.push(p);
          }
        }
        groups.push({ points, top: Math.min(...points.map(p => Math.floor(p / 48))), bottom: Math.max(...points.map(p => Math.floor(p / 48))) });
      }
      groups.sort((a, b) => b.points.length - a.points.length);
      const body = groups[0]; let removed = 0;
      // Tiny disconnected marks rising ABOVE the body. Their bottom can
      // overlap the ear-tip row. Keep the entire connected body untouched,
      // and retain disconnected features at/below it (paws, tail, etc.).
      for (const group of groups.slice(1)) if (group.top < body.top && group.points.length < body.points.length * .1) {
        for (const p of group.points) pixels.data.fill(0, p * 4, p * 4 + 4);
        removed += group.points.length;
      }
      ctx.putImageData(pixels, 0, 0);
      return { frame, removed };
    };
    for (const [action, urls] of Object.entries(sources)) {
      const raw = [];
      for (const url of urls) {
        const image = new Image(); image.src = url; await image.decode();
        if (image.width !== (prepare && action === 'idle' ? 32 : 48) || image.height !== image.width) throw new Error(`${action}: unexpected dimensions`);
        const frame = canvas(image.width, image.height); frame.getContext('2d').drawImage(image, 0, 0); raw.push(frame);
      }
      if (prepare) {
        const box = bounds(raw[0]), reference = canvas(48, 48);
        const x = Math.round(23.5 - (box.left + box.right) / 2), y = 44 - box.bottom;
        reference.getContext('2d').drawImage(raw[0], x, y);
        actions[action] = { png: reference.toDataURL(), offset: { x, y }, bounds: bounds(reference) };
        continue;
      }
      const sheet = canvas(384, 192), sc = sheet.getContext('2d'); sc.imageSmoothingEnabled = false;
      const contact = canvas(9 * 144, 144), cc = contact.getContext('2d'); cc.imageSmoothingEnabled = false;
      raw.forEach((frame, i) => cc.drawImage(frame, i * 144, 0, 144, 144));
      // Keep the generated whole-body motion. Only translate vertically to the
      // shared floor; never paste body parts, resize individual poses or ping-pong.
      const frames = [], signatures = [], framePixels = [];
      const order = frameOrder[action] ?? [0, 1, 2, 3, 4, 5, 6, 7];
      if (order.length !== 8 || order.some(i => !Number.isInteger(i) || i < 0 || i > 8)) throw new Error('Invalid frame order');
      for (const [i, sourceIndex] of order.entries()) {
        const clean = removeFloating.includes(action) ? withoutFloatingMarks(raw[sourceIndex]) : { frame: raw[sourceIndex], removed: 0 };
        const before = bounds(clean.frame), y = 44 - before.bottom;
        const frame = canvas(48, 48); frame.getContext('2d').drawImage(clean.frame, 0, y);
        const after = bounds(frame);
        if (after.visible !== before.visible || after.left < 1 || after.right > 46 || after.top < 1) throw new Error(`${action}/${i}: insufficient transparent margin`);
        sc.drawImage(frame, i % 4 * 96, Math.floor(i / 4) * 96, 96, 96);
        signatures.push(frame.toDataURL());
        framePixels.push(frame.getContext('2d').getImageData(0, 0, 48, 48).data);
        frames.push({ sourceIndex, offsetX: 0, offsetY: y, bounds: after, ...(removeFloating.includes(action) ? { removedFloatingPixels: clean.removed } : {}) });
      }
      const a = raw[0].getContext('2d').getImageData(0, 0, 48, 48).data;
      const b = raw[8].getContext('2d').getImageData(0, 0, 48, 48).data;
      const closingPoseMatches = a.every((value, i) => value === b[i]);
      let closingChangedPixels = 0;
      for (let i = 0; i < a.length; i += 4) if (a.slice(i, i + 4).some((v, c) => v !== b[i + c])) closingChangedPixels++;
      const difference = (a, b) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length;
      const stepDifferences = framePixels.map((data, i) => difference(data, framePixels[(i + 1) % 8]));
      actions[action] = { png: sheet.toDataURL(), contact: contact.toDataURL(), frames,
        distinct: new Set(signatures).size, closingPoseMatches, closingChangedPixels, stepDifferences,
        durationMs: action === 'idle' ? [700, 180, 180, 180, 180, 180, 220, 400] : Array(8).fill(450) };
    }
    return actions;
  }, { sources, prepare, frameOrder: profile.frameOrder ?? {}, removeFloating: profile.removeFloating ?? [] });
  if (prepare) {
    await mkdir(path.join(directory, 'references'), { recursive: true });
    for (const [action, value] of Object.entries(result)) {
      await writeFile(path.join(directory, 'references', `${action}.png`), Buffer.from(value.png.split(',')[1], 'base64'));
    }
    await writeFile(path.join(directory, 'reference-layout.json'), JSON.stringify(Object.fromEntries(Object.entries(result).map(([a, v]) => [a, { offset: v.offset, bounds: v.bounds }])), null, 2) + '\n');
    console.log('Prepared 48×48 references: original artwork translated/padded, never rescaled. No API request.');
  } else {
    for (const [action, value] of Object.entries(result)) {
      console.log(`${action}: closing changed pixels ${value.closingChangedPixels}; steps ${value.stepDifferences.map(n => n.toFixed(2)).join(', ')}`);
      await writeFile(path.join(directory, `raw-${action}.png`), Buffer.from(value.contact.split(',')[1], 'base64'));
    }
    const atlas = { version: 1, character, catalogId: profile.catalogId, name: profile.name, kind: profile.kind, provider: 'PixelLab', presentation: 'new-design',
      logicalFrame: { width: 48, height: 48 }, frame: { width: 96, height: 96 }, sourceScale: 2,
      columns: 4, rows: 2, frames: 8, pivot: { x: 48, y: 90 }, actions: {} };
    for (const [action, value] of Object.entries(result)) {
      assert.ok(value.distinct >= 4, `${action}: need multiple animated poses`);
      // The generated terminal pose can differ in small details. Test the
      // actual 7→0 playback transition against the internal frame transitions.
      assert.ok(value.stepDifferences[7] <= Math.max(...value.stepDifferences.slice(0, 7)), `${action}: loop seam is more abrupt than internal motion`);
      value.frames.forEach(frame => assert.equal(frame.bounds.bottom, 44));
      await writeFile(path.join(directory, `${action}.png`), Buffer.from(value.png.split(',')[1], 'base64'));
      await writeFile(path.join(directory, `raw-${action}.png`), Buffer.from(value.contact.split(',')[1], 'base64'));
      atlas.actions[action] = { file: `${action}.png`, durationMs: value.durationMs, frames: value.frames,
        distinct: value.distinct, closingPoseMatches: value.closingPoseMatches, closingChangedPixels: value.closingChangedPixels,
        stepDifferences: value.stepDifferences,
        omittedSourceIndices: Array.from({ length: 9 }, (_, i) => i).filter(i => !value.frames.some(frame => frame.sourceIndex === i)) };
    }
    await writeFile(path.join(directory, 'atlas.json'), JSON.stringify(atlas, null, 2) + '\n');
    const template = await readFile(path.join(root, 'scripts/sprite-preview.html'), 'utf8');
    const sheets = Object.fromEntries(Object.entries(result).map(([action, value]) => [action, value.png]));
    const preview = path.join(directory, 'preview.html');
    await writeFile(preview, template.replace('/* GENERATED_DATA */', `const atlas = ${JSON.stringify(atlas)}; const sheets = ${JSON.stringify(sheets)};`));
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.clock.install();
    await page.goto(pathToFileURL(preview).href);
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    await page.clock.pauseAt(new Date());
    await page.clock.runFor(750);
    assert.equal(await page.locator('#frame').textContent(), '2 / 8');
    await page.getByRole('button', { name: '일시 정지', exact: true }).click();
    const paused = await page.locator('#sprite').evaluate(canvas => canvas.toDataURL());
    await page.clock.runFor(1000);
    assert.equal(await page.locator('#sprite').evaluate(canvas => canvas.toDataURL()), paused);
    await page.locator('#zoom').selectOption('3');
    await page.screenshot({ path: path.join(directory, 'preview.png') });
    await page.getByRole('button', { name: '잠자기', exact: true }).click();
    await page.getByRole('button', { name: '다음 프레임', exact: true }).click();
    assert.equal(await page.locator('#frame').textContent(), '2 / 8');
    await page.screenshot({ path: path.join(directory, 'sleeping-preview.png') });
    const blockAligned = await page.evaluate(() => Object.values(images).every(image => {
      if (image.width !== 384 || image.height !== 192) return false;
      const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 192;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); const { data } = ctx.getImageData(0, 0, 384, 192);
      for (let y = 0; y < 192; y++) for (let x = 0; x < 384; x++) {
        const a = (y * 384 + x) * 4, b = (Math.floor(y / 2) * 2 * 384 + Math.floor(x / 2) * 2) * 4;
        for (let c = 0; c < 4; c++) if (data[a + c] !== data[b + c]) return false;
      }
      return true;
    }));
    assert.ok(blockAligned, 'exact 2× scaling');
    await page.getByRole('button', { name: '재생', exact: true }).click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('#play').textContent === '재생');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    const validation = { actions: Object.fromEntries(Object.entries(result).map(([name, value]) =>
      [name, { distinct: value.distinct, closingPoseMatches: value.closingPoseMatches, closingChangedPixels: value.closingChangedPixels,
        loopSeamDifference: value.stepDifferences[7], maxInternalDifference: Math.max(...value.stepDifferences.slice(0, 7)) }])),
      checks: ['canvas dimensions', 'transparent margins', 'no clipped pixels', 'fixed floor', 'loop seam vs internal transitions', '2× pixels', 'playback', 'pause', 'frame selection', 'reduced motion', 'mobile layout'] };
    await writeFile(path.join(directory, 'validation.json'), JSON.stringify(validation, null, 2) + '\n');
    console.log(JSON.stringify({ preview, ...validation }, null, 2));
  }
} finally {
  await app?.close();
  await rm(scratch, { recursive: true, force: true });
}
