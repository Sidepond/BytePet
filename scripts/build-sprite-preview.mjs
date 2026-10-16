import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const pack = process.argv[2] ?? 'cheese-sprite-v2';
assert.ok(['cheese-sprite-v1', 'cheese-sprite-v2'].includes(pack), 'Unknown sprite pack');
const coarse = pack === 'cheese-sprite-v2';
const directory = path.join(root, 'art', pack);
const dataURL = async file => `data:image/png;base64,${(await readFile(file)).toString('base64')}`;
const sources = Object.fromEntries(await Promise.all(['idle', 'sleeping'].map(async action =>
  [action, await dataURL(path.join(directory, 'source', `${action}.png`))])));
const scratch = await mkdtemp(path.join(tmpdir(), 'bytepet-sprites-'));
const entry = path.join(scratch, 'preview.cjs');
await writeFile(entry, `const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(scratch, 'profile'))});
app.whenReady().then(() => { const win = new BrowserWindow({ show: false, width: 1120, height: 900 }); win.loadURL('about:blank'); });`);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: [entry], env });
  const page = await app.firstWindow();
  const result = await page.evaluate(async ({ sources, coarse }) => {
    const canvas = (width, height) => Object.assign(document.createElement('canvas'), { width, height });
    const bounds = frame => {
      const { data } = frame.getContext('2d').getImageData(0, 0, frame.width, frame.height);
      let left = frame.width, top = frame.height, right = -1, bottom = -1;
      let collarX = 0, collarPixels = 0;
      for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
        const i = (y * frame.width + x) * 4;
        if (data[i + 3] < 16) continue;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
        const [r, g, b] = data.slice(i, i + 3);
        if (data[i + 3] > 240 && r < 110 && g > 90 && g < 180 && b > 65 && b < 160 && g > r * 1.3 && g > b * 1.05) {
          collarX += x; collarPixels++;
        }
      }
      return { left, top, right, bottom, anchorX: collarPixels ? collarX / collarPixels : (left + right) / 2 };
    };
    const frames = {};
    for (const [action, src] of Object.entries(sources)) {
      const image = new Image(); image.src = src; await image.decode();
      frames[action] = Array.from({ length: 8 }, (_, i) => {
        const frame = canvas(Math.ceil(image.width / 4), Math.ceil(image.height / 2));
        const ctx = frame.getContext('2d'); ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image, i % 4 * image.width / 4, Math.floor(i / 4) * image.height / 2,
          image.width / 4, image.height / 2, 0, 0, frame.width, frame.height);
        return { frame, ...bounds(frame) };
      });
    }
    if (coarse) {
      // A changing collar area was moving the whole sleeping cat sideways.
      // Register the stationary face against frame 1 instead. The floor still
      // controls Y; breathing in the back is deliberately outside this region.
      const reference = frames.sleeping[0];
      const ref = reference.frame.getContext('2d').getImageData(0, 0, reference.frame.width, reference.frame.height);
      for (const candidate of frames.sleeping) {
        const pixels = candidate.frame.getContext('2d').getImageData(0, 0, candidate.frame.width, candidate.frame.height);
        const dy = reference.bottom - candidate.bottom;
        let best = Infinity, shift = 0;
        for (let dx = -16; dx <= 16; dx++) {
          let error = 0;
          for (let y = reference.top; y < reference.top + (reference.bottom - reference.top) * .72; y += 2) {
            for (let x = reference.left; x < reference.left + (reference.right - reference.left) * .60; x += 2) {
              const a = (y * ref.width + x) * 4;
              const b = ((y - dy) * pixels.width + x - dx) * 4;
              if (x - dx < 0 || x - dx >= pixels.width || y - dy < 0 || y - dy >= pixels.height) { error += 255 ** 2 * 4; continue; }
              const aa = ref.data[a + 3] / 255, ba = pixels.data[b + 3] / 255;
              for (let c = 0; c < 3; c++) error += (ref.data[a + c] * aa - pixels.data[b + c] * ba) ** 2;
              error += (ref.data[a + 3] - pixels.data[b + 3]) ** 2;
            }
          }
          if (error < best) { best = error; shift = dx; }
        }
        candidate.anchorX = reference.anchorX - shift;
        candidate.registrationX = shift;
      }
    }
    // ONE scale for both actions and all frames. Translation aligns the collar
    // and ground; no frame is independently resized to its bounding box.
    const order = { idle: [0, 1, 2, 3, 4, 2, 1, 0], sleeping: [0, 1, 2, 3, 3, 2, 1, 0] };
    const envelopes = Object.fromEntries(Object.entries(order).map(([action, indices]) => {
      const selected = indices.map(i => frames[action][i]);
      return [action, {
        left: Math.max(...selected.map(frame => frame.anchorX - frame.left)),
        right: Math.max(...selected.map(frame => frame.right - frame.anchorX + 1)),
        height: Math.max(...selected.map(frame => frame.bottom - frame.top + 1)),
      }];
    }));
    const scale = Math.min(...Object.values(envelopes).flatMap(envelope => [80 / envelope.height, 88 / (envelope.left + envelope.right)]));
    const durations = { idle: [1000, 450, 450, 100, 120, 450, 450, 780], sleeping: Array(8).fill(450) };
    const colors = ['#53382f', '#edaa55', '#ffd58b', '#cb773d', '#fff0ca', '#e78d88', '#459b8f', '#ffe293', '#fff8e9'];
    const palette = colors.map(color => color.slice(1).match(/../g).map(hex => parseInt(hex, 16)));
    const actions = {};
    for (const action of Object.keys(frames)) {
      const sheet = canvas(384, 192), ctx = sheet.getContext('2d');
      const measurement = [];
      for (const [i, sourceIndex] of order[action].entries()) {
        const source = frames[action][sourceIndex];
        const frame = canvas(96, 96), fc = frame.getContext('2d');
        fc.imageSmoothingEnabled = false;
        const envelope = envelopes[action];
        const targetAnchor = 48 + (envelope.left - envelope.right) * scale / 2;
        const x = targetAnchor - source.anchorX * scale;
        // Place the thin closed eyelids within a logical row, rather than
        // splitting that line over two rows when reducing the sleeping art.
        const y = 92 - (source.bottom + 1) * scale - (coarse && action === 'sleeping' ? 2 : 0);
        if (coarse) {
          // Sample each logical cell as an area. A single nearest sample can
          // hit an antialiased edge and turn a thin brown eyelid pink.
          const sampled = canvas(96, 96), sc = sampled.getContext('2d');
          sc.imageSmoothingEnabled = false;
          sc.drawImage(source.frame, x, y, source.frame.width * scale, source.frame.height * scale);
          const input = sc.getImageData(0, 0, 96, 96).data;
          const logical = canvas(24, 24), lc = logical.getContext('2d');
          const pixels = lc.createImageData(24, 24);
          for (let row = 0; row < 24; row++) for (let col = 0; col < 24; col++) {
            const votes = palette.map(() => 0);
            let opaque = 0;
            for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
              const index = ((row * 4 + dy) * 96 + col * 4 + dx) * 4;
              if (input[index + 3] < 128) continue;
              opaque++;
              let best = Infinity, selected = 0;
              palette.forEach((color, i) => {
                const distance = color.reduce((sum, value, c) => sum + (value - input[index + c]) ** 2, 0);
                if (distance < best) { best = distance; selected = i; }
              });
              votes[selected]++;
            }
            if (opaque < 8) continue;
            const selected = votes[0] >= 6 ? 0 : votes.indexOf(Math.max(...votes));
            pixels.data.set([...palette[selected], 255], (row * 24 + col) * 4);
          }
          lc.putImageData(pixels, 0, 0);
          fc.drawImage(logical, 0, 0, 96, 96);
        } else fc.drawImage(source.frame, x, y, source.frame.width * scale, source.frame.height * scale);
        ctx.drawImage(frame, i % 4 * 96, Math.floor(i / 4) * 96);
        measurement.push({ sourceIndex, x, y, ...(coarse && action === 'sleeping' ? { registrationX: source.registrationX } : {}), ...bounds(frame) });
      }
      actions[action] = { png: sheet.toDataURL(), durations: durations[action], frames: measurement };
    }
    return { scale, actions, ...(coarse ? { palette: colors } : {}) };
  }, { sources, coarse });
  const atlas = { version: 1, character: `cat-${pack}`, frame: { width: 96, height: 96 },
    ...(coarse ? { logicalFrame: { width: 24, height: 24 }, palette: result.palette, sleepingAlignment: 'face-template' } : {}),
    columns: 4, rows: 2, frames: 8, pivot: { x: 48, y: 92 }, sourceScale: result.scale, actions: {} };
  for (const [action, value] of Object.entries(result.actions)) {
    for (const frame of value.frames) {
      assert.ok(frame.left >= 3 && frame.right <= 92 && frame.top >= 10 && frame.bottom >= 90 && frame.bottom <= 91,
        `${action}: safe area and ground alignment: ${JSON.stringify(frame)}`);
    }
    await writeFile(path.join(directory, `${action}.png`), Buffer.from(value.png.split(',')[1], 'base64'));
    atlas.actions[action] = { file: `${action}.png`, durationMs: value.durations, frames: value.frames };
  }
  await writeFile(path.join(directory, 'atlas.json'), JSON.stringify(atlas, null, 2) + '\n');
  const cat = (await readFile(path.join(root, 'desktop/cat.js'), 'utf8')).replaceAll('export ', '');
  const sleep = (await readFile(path.join(root, 'desktop/sleeping.js'), 'utf8')).replaceAll('export ', '');
  let html = await readFile(path.join(root, 'scripts/sprite-preview.html'), 'utf8');
  html = html.replace('/* GENERATED_DATA */', `const atlas = ${JSON.stringify(atlas)}; const sheets = ${JSON.stringify(Object.fromEntries(Object.entries(result.actions).map(([action, value]) => [action, value.png])))};\n${cat}\n${sleep}`);
  const preview = path.join(directory, 'preview.html');
  await writeFile(preview, html);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install();
  await page.goto(new URL(`file://${preview}`).href);
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.clock.pauseAt(new Date());
  await page.clock.runFor(1100);
  assert.equal(await page.locator('#frame').textContent(), '2 / 8', 'playback advances through the configured durations');
  const pixelChecks = await page.evaluate(() => {
    const reports = [];
    for (const [action, image] of Object.entries(images)) {
      const frames = [];
      const pixels = [];
      for (let i = 0; i < 8; i++) {
        const frame = document.createElement('canvas'); frame.width = frame.height = 96;
        const ctx = frame.getContext('2d'); ctx.drawImage(image, i % 4 * 96, Math.floor(i / 4) * 96, 96, 96, 0, 0, 96, 96);
        frames.push(frame.toDataURL());
        pixels.push(ctx.getImageData(0, 0, 96, 96).data);
      }
      let blockAligned = true;
      if (document.body.dataset.pixelStyle === '24') for (const data of pixels) {
        for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
          const reference = (Math.floor(y / 4) * 4 * 96 + Math.floor(x / 4) * 4) * 4;
          const index = (y * 96 + x) * 4;
          for (let c = 0; c < 4; c++) if (data[index + c] !== data[reference + c]) blockAligned = false;
        }
      }
      const headShifts = action === 'sleeping' ? pixels.map(data => {
        let best = Infinity, shift = 0;
        for (let dx = -8; dx <= 8; dx++) {
          let error = 0;
          for (let y = 36; y < 76; y++) for (let x = 8; x < 56; x++) {
            const a = (y * 96 + x) * 4, b = (y * 96 + x - dx) * 4;
            for (let c = 0; c < 4; c++) error += (pixels[0][a + c] - data[b + c]) ** 2;
          }
          if (error < best) { best = error; shift = dx; }
        }
        return shift;
      }) : undefined;
      reports.push({ action, width: image.width, height: image.height, seamless: frames[0] === frames[7], distinct: new Set(frames).size, blockAligned, headShifts });
    }
    return reports;
  });
  for (const check of pixelChecks) {
    assert.equal(check.width, 384); assert.equal(check.height, 192);
    assert.ok(check.seamless && check.distinct >= 4, JSON.stringify(check));
    if (coarse) {
      assert.ok(check.blockAligned, 'every logical pixel is an exact 4×4 block');
      if (check.action === 'sleeping') assert.ok(check.headShifts.every(shift => shift === 0), 'sleeping face must not drift horizontally');
    }
  }
  await page.getByRole('button', { name: '잠자기', exact: true }).click();
  await page.getByRole('button', { name: '일시 정지', exact: true }).click();
  const paused = await page.locator('#sprite').evaluate(canvas => canvas.toDataURL());
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#sprite').evaluate(canvas => canvas.toDataURL()), paused);
  await page.getByRole('button', { name: '다음 프레임', exact: true }).click();
  assert.equal(await page.locator('#frame').textContent(), '2 / 8');
  await page.locator('#zoom').selectOption('3');
  await page.screenshot({ path: path.join(directory, 'sleeping-preview.png') });
  await page.locator('#zoom').selectOption('1');
  await page.getByRole('button', { name: '대기', exact: true }).click();
  await page.screenshot({ path: path.join(directory, 'preview.png') });
  await page.getByRole('button', { name: '재생', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('#play').textContent === '재생');
  assert.equal(await page.getByRole('button', { name: '재생', exact: true }).count(), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ preview, sourceScale: result.scale, pixelChecks, checks: 'alignment, loop, alpha bounds, playback controls, reduced motion, mobile layout' }, null, 2));
} finally {
  await app?.close();
  await rm(scratch, { recursive: true, force: true });
}
