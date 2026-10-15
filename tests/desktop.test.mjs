import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { getInitialBounds } from '../desktop/window.cjs';

const root = fileURLToPath(new URL('../', import.meta.url));

async function profileFor(t) {
  const profile = await realpath(await mkdtemp(path.join(tmpdir(), 'bytepet-desktop-')));
  t.after(() => rm(profile, { recursive: true, force: true }));
  return profile;
}

async function launch(profile) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root, env });
}

const bounds = app => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());

async function waitUntil(check) {
  const deadline = Date.now() + 5000;
  while (!(await check())) {
    if (Date.now() > deadline) assert.fail('Timed out waiting for desktop state');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

test('F01: native transparent pet, idle playback, reduced motion, and clean exit', { timeout: 30000 }, async t => {
  const app = await launch(await profileFor(t));
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForLoadState('load');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => {
      const canvas = document.querySelector('canvas');
      return canvas && canvas.getContext('2d').getImageData(12, 10, 1, 1).data[3] > 0;
    });
    const native = await app.evaluate(async ({ BrowserWindow, screen, Menu }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const capture = await win.capturePage();
      return {
        visible: win.isVisible(),
        topmost: win.isAlwaysOnTop(),
        resizable: win.isResizable(),
        background: win.getBackgroundColor(),
        cornerAlpha: capture.toBitmap()[3],
        bounds: win.getBounds(),
        content: win.getContentBounds(),
        workArea: screen.getPrimaryDisplay().workArea,
        preferences: win.webContents.getLastWebPreferences(),
        canQuit: Menu.getApplicationMenu().items[0].submenu.items.some(item => item.role === 'quit'),
      };
    });
    assert.equal(native.visible, true);
    assert.equal(native.topmost, true);
    assert.equal(native.resizable, false);
    // Electron's getter omits alpha; inspect the native capture for transparency.
    assert.equal(native.background, '#000000');
    assert.equal(native.cornerAlpha, 0);
    assert.deepEqual(native.bounds, native.content, 'no native title bar or frame');
    assert.equal(native.bounds.width, 128);
    assert.equal(native.bounds.height, 128);
    assert.ok(native.bounds.x >= native.workArea.x);
    assert.ok(native.bounds.y >= native.workArea.y);
    assert.ok(native.bounds.x + 128 <= native.workArea.x + native.workArea.width);
    assert.ok(native.bounds.y + 128 <= native.workArea.y + native.workArea.height);
    assert.equal(native.preferences.nodeIntegration, false);
    assert.equal(native.preferences.contextIsolation, true);
    assert.equal(native.preferences.sandbox, true);
    assert.equal(native.canQuit, true);

    const rendering = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const pixels = canvas.getContext('2d').getImageData(0, 0, 24, 24).data;
      return {
        background: getComputedStyle(document.body).backgroundColor,
        size: canvas.getBoundingClientRect().width,
        transparentCorner: pixels[3],
        opaquePixels: [...pixels].filter((value, index) => index % 4 === 3 && value === 255).length,
        requireType: typeof window.require,
      };
    });
    assert.equal(rendering.background, 'rgba(0, 0, 0, 0)');
    assert.equal(rendering.size, 96);
    assert.equal(rendering.transparentCorner, 0);
    assert.ok(rendering.opaquePixels > 100);
    assert.equal(rendering.requireType, 'undefined');

    const firstFrame = await page.locator('canvas').evaluate(canvas => canvas.toDataURL());
    await page.waitForFunction(frame => document.querySelector('canvas').toDataURL() !== frame, firstFrame);
    await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
    await page.screenshot({ path: `${root}/test-results/f01-idle.png`, omitBackground: true });

    // A normal foreground window must not demote the native pet window.
    await app.evaluate(async ({ BrowserWindow }) => {
      const pet = BrowserWindow.getAllWindows()[0];
      const other = new BrowserWindow({ width: 300, height: 200, show: false });
      await other.loadURL('data:text/html,<body>BytePet foreground test</body>');
      other.show();
      other.focus();
      if (!pet.isAlwaysOnTop()) throw new Error('Pet lost always-on-top state');
      other.destroy();
    });

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(200);
    const still = await page.locator('canvas').evaluate(canvas => canvas.toDataURL());
    await page.waitForTimeout(800);
    assert.equal(await page.locator('canvas').evaluate(canvas => canvas.toDataURL()), still);
    assert.deepEqual(errors, []);

    const exited = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await exited;
  } finally {
    await app.close();
  }
});

test('F02: pointer drag saves position and restores it after restarting', { timeout: 30000 }, async t => {
  const profile = await profileFor(t);
  let app = await launch(profile);
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('load');
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
    const before = await bounds(app);
    // A click or a small hand tremor must not become a drag.
    await page.mouse.move(64, 64);
    await page.mouse.down();
    await page.mouse.move(65, 65);
    await page.mouse.up();
    assert.deepEqual(await bounds(app), before);
    // The transparent margin is not a drag handle.
    await page.mouse.move(4, 4);
    await page.mouse.down();
    await page.mouse.move(10, 10);
    await page.mouse.up();
    assert.deepEqual(await bounds(app), before);

    await page.mouse.move(64, 64);
    await page.mouse.down();
    await page.mouse.move(24, 24);
    await waitUntil(async () => (await bounds(app)).x < before.x);
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('canvas').classList.contains('dragging'));
    let moved;
    await waitUntil(async () => {
      moved = await bounds(app);
      try {
        const saved = JSON.parse(await readFile(path.join(profile, 'pet-position.json'), 'utf8'));
        return saved.x === moved.x && saved.y === moved.y;
      } catch { return false; }
    });
    assert.ok(moved.x < before.x && moved.y < before.y);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()), true);
    await app.close();
    app = await launch(profile);
    await app.firstWindow();
    assert.deepEqual(await bounds(app), moved);
  } finally {
    await app.close();
  }
});

test('F02: corrupt saved state falls back, display changes recover visibility, close flushes position', { timeout: 30000 }, async t => {
  const profile = await profileFor(t);
  const file = path.join(profile, 'pet-position.json');
  await writeFile(file, '{broken');
  let app = await launch(profile);
  try {
    await app.firstWindow();
    const area = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
    assert.deepEqual(await bounds(app), getInitialBounds(area));
    // Simulate a work-area change while running; the real handler must relocate.
    const recovered = await app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const area = screen.getPrimaryDisplay().workArea;
      const original = screen.getAllDisplays;
      try {
        screen.getAllDisplays = () => [{ workArea: { x: area.x + 20, y: area.y + 20, width: 300, height: 300 } }];
        screen.emit('display-metrics-changed', {}, {}, ['workArea']);
        return win.getBounds();
      } finally {
        screen.getAllDisplays = original;
      }
    });
    assert.ok(recovered.x >= area.x + 20 && recovered.x + 128 <= area.x + 320);
    assert.ok(recovered.y >= area.y + 20 && recovered.y + 128 <= area.y + 320);
    const final = { x: area.x + 70, y: area.y + 80 };
    const exited = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }, point) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setPosition(point.x, point.y);
      win.close(); // No time for the debounced save.
    }, final);
    await exited;
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { version: 1, ...final });
    await app.close();
    await writeFile(file, JSON.stringify({ version: 1, x: -900000, y: -900000 }));
    app = await launch(profile);
    await app.firstWindow();
    const restored = await bounds(app);
    const areas = await app.evaluate(({ screen }) => screen.getAllDisplays().map(display => display.workArea));
    assert.ok(areas.some(a => restored.x >= a.x && restored.y >= a.y && restored.x + 128 <= a.x + a.width && restored.y + 128 <= a.y + a.height));
  } finally {
    await app.close();
  }
});

test('F02: right-button gestures and lost capture do not leave a stuck drag', { timeout: 30000 }, async t => {
  const app = await launch(await profileFor(t));
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('load');
    const before = await bounds(app);
    // Keep the OS menu out of this gesture test; F01 retains the quit menu.
    await page.evaluate(() => document.addEventListener('contextmenu', event => event.preventDefault()));
    await page.mouse.move(64, 64);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(24, 24);
    await page.mouse.up({ button: 'right' });
    assert.deepEqual(await bounds(app), before);

    await page.evaluate(() => document.querySelector('canvas').addEventListener('gotpointercapture', event => {
      window.capturedPointer = event.pointerId;
    }));
    await page.mouse.move(64, 64);
    await page.mouse.down();
    // Travel outside the canvas: pointer capture must still move the pet.
    await page.mouse.move(8, 8);
    await waitUntil(async () => (await bounds(app)).x < before.x);
    await page.evaluate(() => document.querySelector('canvas').releasePointerCapture(window.capturedPointer));
    await page.mouse.move(10, 10);
    await page.waitForFunction(() => !document.querySelector('canvas').classList.contains('dragging'));
    const stopped = await bounds(app);
    await page.mouse.move(12, 12);
    await page.mouse.up();
    assert.deepEqual(await bounds(app), stopped);
    // A new gesture still works after cancellation.
    await page.mouse.move(64, 64);
    await page.mouse.down();
    await page.mouse.move(40, 40);
    await waitUntil(async () => (await bounds(app)).x < stopped.x);
    await page.mouse.up();
  } finally {
    await app.close();
  }
});

test('F03: native input switches on visible pixels, follows animation, and stays held during drag', { timeout: 30000 }, async t => {
  const app = await launch(await profileFor(t));
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('load');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // CDP mouse events bypass OS routing. Observe actual native API calls here;
    // a separate desktop check verifies clicks reaching the window underneath.
    await app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const original = win.setIgnoreMouseEvents.bind(win);
      win.setIgnoreMouseEvents = (ignore, options) => {
        win.testIgnoring = ignore;
        win.testForward = options?.forward;
        return original(ignore, options);
      };
      win.testCursor = { x: 64, y: 64 };
      screen.getCursorScreenPoint = () => {
        const { x, y } = win.getContentBounds();
        return { x: x + win.testCursor.x, y: y + win.testCursor.y };
      };
    });
    const ignoring = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].testIgnoring);
    const cursor = point => app.evaluate(({ BrowserWindow }, point) => {
      BrowserWindow.getAllWindows()[0].testCursor = point;
    }, point);
    await waitUntil(async () => await ignoring() === false);
    await cursor({ x: 4, y: 4 });
    await waitUntil(async () => await ignoring() === true);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].testForward), true);
    await cursor({ x: 20, y: 20 }); // Transparent pixel inside the canvas.
    await page.mouse.move(20, 20);
    const before = await bounds(app);
    await page.mouse.down();
    await page.mouse.move(40, 40);
    await page.mouse.up();
    assert.deepEqual(await bounds(app), before);
    assert.equal(await ignoring(), true);

    await cursor({ x: 64, y: 64 });
    await waitUntil(async () => await ignoring() === false);
    await page.mouse.move(64, 64);
    await page.mouse.down();
    await cursor({ x: 4, y: 4 });
    await page.mouse.move(8, 8);
    await waitUntil(async () => (await bounds(app)).x < before.x);
    assert.equal(await ignoring(), false, 'drag owns input even over transparent pixels');
    await page.mouse.up();
    await waitUntil(async () => await ignoring() === true);

    // The ear moves under a stationary cursor. No mouse event is sent here.
    await cursor({ x: 38, y: 26 });
    assert.equal(await ignoring(), true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await waitUntil(async () => await ignoring() === false);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await waitUntil(async () => await ignoring() === true);
    // Re-entering after click-through must re-enable interaction.
    await cursor({ x: 64, y: 64 });
    await waitUntil(async () => await ignoring() === false);
    await page.reload();
    await page.waitForLoadState('load');
    await waitUntil(async () => await ignoring() === false);

    // Keep a menu interaction pinned until Electron's close callback fires.
    await app.evaluate(({ BrowserWindow, Menu }) => {
      const win = BrowserWindow.getAllWindows()[0];
      Menu.prototype.popup = options => { win.testMenu = options; };
      win.webContents.emit('context-menu', {}, { x: 20, y: 20 });
      if (win.testMenu) throw new Error('Transparent pixels opened the pet menu');
      win.webContents.emit('context-menu', {}, { x: 64, y: 64 });
      if (!win.testMenu) throw new Error('Visible pixels did not open the pet menu');
    });
    await cursor({ x: 4, y: 4 });
    // Allow at least one native cursor poll with the menu held open.
    await page.waitForTimeout(60);
    assert.equal(await ignoring(), false);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].testMenu.callback());
    await waitUntil(async () => await ignoring() === true);
  } finally {
    await app.close();
  }
});
