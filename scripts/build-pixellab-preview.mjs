import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'art/cheese-pixellab-v1');
const sleepingRevision = process.argv[2] ?? '2';
assert.match(sleepingRevision, /^[1-9]\d?$/, 'revision must be 1–99');
const sources = {};
for (const action of ['idle', 'sleeping']) {
  const revisionPath = action === 'sleeping' && sleepingRevision !== '1' ? ['revisions', sleepingRevision] : [];
  const folder = path.join(directory, ...revisionPath, 'source', action);
  const files = (await readdir(folder)).filter(name => /^\d\d\.png$/.test(name)).sort();
  assert.equal(files.length, 9, `${action}: expected the input pose plus eight API frames`);
  sources[action] = await Promise.all(files.map(async name =>
    `data:image/png;base64,${(await readFile(path.join(folder, name))).toString('base64')}`));
}
const scratch = await mkdtemp(path.join(tmpdir(), 'bytepet-pixellab-'));
const entry = path.join(scratch, 'preview.cjs');
await writeFile(entry, `const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(scratch, 'profile'))});
app.whenReady().then(() => new BrowserWindow({ show: false, width: 1120, height: 900 }).loadURL('about:blank'));`);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: [entry], env });
  const page = await app.firstWindow();
  const result = await page.evaluate(async sources => {
    const canvas = (width, height) => Object.assign(document.createElement('canvas'), { width, height });
    const pixels = frame => frame.getContext('2d').getImageData(0, 0, 24, 24).data;
    const equal = (a, b) => a.every((value, i) => value === b[i]);
    const bounds = data => {
      let left = 24, right = -1, top = 24, bottom = -1, opaque = 0, partial = 0;
      for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
        const alpha = data[(y * 24 + x) * 4 + 3];
        if (!alpha) continue;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
        opaque++; if (alpha < 255) partial++;
      }
      return { left, right, top, bottom, opaque, partial };
    };
    // Measure only the sleeping face, excluding the breathing back and floating Zs.
    const headShift = (reference, candidate) => {
      let best = Infinity, shift = 0;
      for (const dx of [0, -1, 1, -2, 2, -3, 3]) {
        let error = 0;
        for (let y = 11; y < 20; y++) for (let x = 2; x < 14; x++) {
          const a = (y * 24 + x) * 4, sx = x - dx;
          const b = (y * 24 + sx) * 4;
          const aa = reference[a + 3] / 255, ba = sx < 0 || sx >= 24 ? 0 : candidate[b + 3] / 255;
          for (let c = 0; c < 3; c++) error += (reference[a + c] * aa - (ba ? candidate[b + c] * ba : 0)) ** 2;
          error += (aa - ba) ** 2 * 255 ** 2;
        }
        if (error < best) { best = error; shift = dx; }
      }
      return shift;
    };
    const actions = {};
    for (const [action, urls] of Object.entries(sources)) {
      const raw = [];
      for (const url of urls) {
        const image = new Image(); image.src = url; await image.decode();
        if (image.width !== 24 || image.height !== 24) throw new Error(`${action}: API frame must be 24×24`);
        const frame = canvas(24, 24); frame.getContext('2d').drawImage(image, 0, 0); raw.push(frame);
      }
      const reference = pixels(raw[0]);
      const backTop = data => {
        for (let y = 14; y < 20; y++) for (let x = 14; x < 23; x++) if (data[(y * 24 + x) * 4 + 3]) return y;
        return 20;
      };
      const rawClosingPoseMatches = equal(reference, pixels(raw[8]));
      const stabilize = frame => {
        const logical = canvas(24, 24), lc = logical.getContext('2d');
        lc.drawImage(frame, 0, 0);
        if (action === 'sleeping') {
          // The model also moves the ears/face and deletes the Zs. Keep those
          // pixels, feet and tail from the input; use generated motion only
          // inside the back/ribcage. No resizing or repainting generated pixels.
          const output = lc.getImageData(0, 0, 24, 24);
          for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
            if (x >= 14 && x < 23 && y >= 14 && y < 20) continue;
            const i = (y * 24 + x) * 4;
            output.data.set(reference.subarray(i, i + 4), i);
          }
          lc.putImageData(output, 0, 0);
        }
        return logical;
      };
      const closingPoseMatches = equal(pixels(stabilize(raw[0])), pixels(stabilize(raw[8])));
      if (!closingPoseMatches) throw new Error(`${action}: closing pose differs after stabilization`);
      const sheet = canvas(384, 192), ctx = sheet.getContext('2d'); ctx.imageSmoothingEnabled = false;
      const contact = canvas(9 * 144, 144), cc = contact.getContext('2d'); cc.imageSmoothingEnabled = false;
      raw.forEach((frame, i) => cc.drawImage(frame, i * 144, 0, 144, 144));
      const measurements = [], frames = [];
      // The middle generated sleep poses arch the back too far. Use only the
      // low-amplitude poses, with holds and a return to the starting pose.
      const order = action === 'sleeping' ? [0, 1, 7, 7, 1, 0, 0, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
      for (const [i, sourceIndex] of order.entries()) {
        const input = pixels(raw[sourceIndex]);
        const logical = stabilize(raw[sourceIndex]);
        const output = pixels(logical), after = bounds(output);
        ctx.drawImage(logical, i % 4 * 96, Math.floor(i / 4) * 96, 96, 96);
        frames.push(logical.toDataURL());
        measurements.push({ sourceIndex, offsetX: 0, offsetY: 0, bounds: after,
          ...(action === 'sleeping' ? { rawHeadShift: headShift(reference, input), headShift: headShift(reference, output),
            backRise: backTop(reference) - backTop(output) } : {}) });
      }
      actions[action] = { png: sheet.toDataURL(), contact: contact.toDataURL(), frames: measurements,
        distinct: new Set(frames).size, rawClosingPoseMatches, closingPoseMatches,
        durationMs: action === 'idle' ? [1000, 450, 450, 450, 450, 450, 450, 450] : Array(8).fill(500) };
    }
    return actions;
  }, sources);
  const atlas = { version: 1, character: 'cat-cheese-pixellab-v1', provider: 'PixelLab',
    endpoint: '/v2/animate-with-text-v3', frame: { width: 96, height: 96 }, logicalFrame: { width: 24, height: 24 },
    columns: 4, rows: 2, frames: 8, sourceScale: 4, pivot: { x: 48, y: 92 },
    sleepingAlignment: 'fixed-reference-outside-ribcage',
    sleepingRevision, sleepingMotionRegion: { x: 14, y: 14, width: 9, height: 6 }, actions: {} };
  for (const [action, value] of Object.entries(result)) {
    assert.ok(value.distinct >= 2, `${action}: animation must change`);
    for (const frame of value.frames) {
      assert.ok(frame.bounds.opaque > 0 && frame.bounds.opaque < 24 * 24, 'transparent background');
      assert.equal(frame.bounds.partial, 0, 'hard pixel edges');
      assert.equal(frame.bounds.bottom, 22, `${action}: fixed floor at logical y=23`);
      if (action === 'sleeping') {
        assert.equal(frame.headShift, 0, 'sleeping face must not translate horizontally');
        assert.ok(frame.backRise >= 0 && frame.backRise <= 1, 'breathing must rise by at most one logical pixel');
      }
    }
    await writeFile(path.join(directory, `${action}.png`), Buffer.from(value.png.split(',')[1], 'base64'));
    await writeFile(path.join(directory, `raw-${action}.png`), Buffer.from(value.contact.split(',')[1], 'base64'));
    atlas.actions[action] = { file: `${action}.png`, durationMs: value.durationMs, frames: value.frames,
      distinct: value.distinct, rawClosingPoseMatches: value.rawClosingPoseMatches,
      closingPoseMatches: value.closingPoseMatches, omittedClosingSourceIndex: 8 };
  }
  await writeFile(path.join(directory, 'atlas.json'), JSON.stringify(atlas, null, 2) + '\n');
  const cat = (await readFile(path.join(root, 'desktop/cat.js'), 'utf8')).replaceAll('export ', '');
  const sleep = (await readFile(path.join(root, 'desktop/sleeping.js'), 'utf8')).replaceAll('export ', '');
  const template = await readFile(path.join(root, 'scripts/sprite-preview.html'), 'utf8');
  const sheets = Object.fromEntries(Object.entries(result).map(([action, value]) => [action, value.png]));
  const preview = path.join(directory, 'preview.html');
  await writeFile(preview, template.replace('/* GENERATED_DATA */',
    `const atlas = ${JSON.stringify(atlas)}; const sheets = ${JSON.stringify(sheets)};\n${cat}\n${sleep}`));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install();
  await page.goto(pathToFileURL(preview).href);
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.clock.pauseAt(new Date());
  await page.clock.runFor(1100);
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
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, 384, 192);
    for (let y = 0; y < 192; y++) for (let x = 0; x < 384; x++) {
      const a = (y * 384 + x) * 4, b = (Math.floor(y / 4) * 4 * 384 + Math.floor(x / 4) * 4) * 4;
      for (let c = 0; c < 4; c++) if (data[a + c] !== data[b + c]) return false;
    }
    return true;
  }));
  assert.ok(blockAligned, 'exact 4× enlargement with no smoothing');
  await page.getByRole('button', { name: '재생', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('#play').textContent === '재생');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  const validation = { preview: 'preview.html', actions: Object.fromEntries(Object.entries(atlas.actions).map(([action, value]) =>
    [action, { distinct: value.distinct, closingPoseMatches: value.closingPoseMatches,
      ...(action === 'sleeping' ? { headShifts: value.frames.map(frame => frame.headShift), maxBackRise: Math.max(...value.frames.map(frame => frame.backRise)) } : {}) }])),
    checks: ['native size', 'alpha', 'floor', 'loop endpoint', 'head drift', 'breathing amplitude', '4× pixels', 'playback', 'pause', 'reduced motion', 'mobile layout'] };
  await writeFile(path.join(directory, 'validation.json'), JSON.stringify(validation, null, 2) + '\n');
  console.log(JSON.stringify({ directory, ...validation }, null, 2));
} finally {
  await app?.close();
  await rm(scratch, { recursive: true, force: true });
}
