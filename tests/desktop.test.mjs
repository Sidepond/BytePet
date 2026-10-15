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

const bounds = app => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet').getBounds());

async function openPanel(app) {
  const pet = await app.firstWindow();
  await pet.waitForLoadState('load');
  const opened = app.waitForEvent('window');
  await pet.evaluate(() => window.petPanel.toggle());
  const panel = await opened;
  await panel.waitForLoadState('load');
  await panel.waitForFunction(() => document.activeElement?.id === 'draft');
  return { pet, panel };
}

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
      const win = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet');
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
      const pet = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet');
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
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet').close());
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
    await page.evaluate(() => window.petPanel.close());
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
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet').isAlwaysOnTop()), true);
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
      const win = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet');
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
      const win = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet');
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
      const win = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet');
      const original = win.setIgnoreMouseEvents.bind(win);
      win.setIgnoreMouseEvents = (ignore, options) => {
        win.testIgnoring = ignore;
        win.testForward = options?.forward;
        return original(ignore, options);
      };
      win.testCursor = { x: 4, y: 4 };
      screen.getCursorScreenPoint = () => {
        const { x, y } = win.getContentBounds();
        return { x: x + win.testCursor.x, y: y + win.testCursor.y };
      };
    });
    const ignoring = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet').testIgnoring);
    const cursor = point => app.evaluate(({ BrowserWindow }, point) => {
      BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet').testCursor = point;
    }, point);
    // Force a transition after installing the observer, independent of the real
    // cursor position when the test window first appeared.
    await page.waitForTimeout(60);
    await cursor({ x: 64, y: 64 });
    await waitUntil(async () => await ignoring() === false);
    await cursor({ x: 4, y: 4 });
    await waitUntil(async () => await ignoring() === true);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet').testForward), true);
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
      const win = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet');
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
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet').testMenu.callback());
    await waitUntil(async () => await ignoring() === true);
  } finally {
    await app.close();
  }
});

test('F04: pet click toggles a focused panel, text survives hiding, and drag never opens it', { timeout: 30000 }, async t => {
  const app = await launch(await profileFor(t));
  try {
    const pet = await app.firstWindow();
    await pet.waitForLoadState('load');
    const panelVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(win => win.getTitle() === 'BytePet 유틸리티' && win.isVisible()));
    await pet.mouse.click(20, 20);
    assert.equal(await panelVisible(), false, 'transparent pixels cannot open a panel');
    await pet.mouse.move(64, 64);
    await pet.mouse.down();
    await pet.mouse.move(40, 40);
    await pet.mouse.up();
    assert.equal(await panelVisible(), false, 'drag cannot open a panel');
    const opened = app.waitForEvent('window');
    await pet.mouse.click(64, 64);
    const panel = await opened;
    await panel.waitForLoadState('load');
    await waitUntil(panelVisible);
    await panel.waitForFunction(() => document.activeElement?.id === 'draft');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.getTitle()), 'BytePet 유틸리티');
    await panel.keyboard.type('F04 focus check');
    assert.equal(await panel.locator('#draft').inputValue(), 'F04 focus check');
    assert.equal(await pet.locator('canvas').getAttribute('aria-expanded'), 'true');
    const safety = await app.evaluate(({ BrowserWindow, screen }) => {
      const panel = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet 유틸리티');
      return { bounds: panel.getBounds(), area: screen.getDisplayMatching(panel.getBounds()).workArea,
        parent: panel.getParentWindow().getTitle(), prefs: panel.webContents.getLastWebPreferences() };
    });
    assert.equal(safety.parent, 'BytePet');
    assert.equal(safety.prefs.nodeIntegration, false);
    assert.equal(safety.prefs.contextIsolation, true);
    assert.equal(safety.prefs.sandbox, true);
    assert.ok(safety.bounds.x >= safety.area.x && safety.bounds.y >= safety.area.y);
    assert.ok(safety.bounds.x + safety.bounds.width <= safety.area.x + safety.area.width);
    assert.ok(safety.bounds.y + safety.bounds.height <= safety.area.y + safety.area.height);
    await panel.screenshot({ path: `${root}/test-results/f04-panel.png` });

    await pet.mouse.click(64, 64);
    await waitUntil(async () => !(await panelVisible()));
    await pet.waitForFunction(() => document.querySelector('canvas').getAttribute('aria-expanded') === 'false');
    await pet.mouse.click(64, 64);
    await waitUntil(panelVisible);
    await panel.waitForFunction(() => document.activeElement?.id === 'draft');
    assert.equal(await panel.locator('#draft').inputValue(), 'F04 focus check');
    assert.equal(app.windows().length, 2, 'reopening reuses the panel');
    await panel.keyboard.press('Escape');
    await waitUntil(async () => !(await panelVisible()));
    await pet.locator('canvas').focus();
    await pet.keyboard.press('Enter');
    await waitUntil(panelVisible);
    await panel.getByRole('button', { name: '패널 닫기', exact: true }).click();
    await waitUntil(async () => !(await panelVisible()));
  } finally {
    await app.close();
  }
});

test('F04: rapid toggles, panel following, and pet shutdown do not leave an orphan window', { timeout: 30000 }, async t => {
  const app = await launch(await profileFor(t));
  try {
    const pet = await app.firstWindow();
    await pet.waitForLoadState('load');
    const opened = app.waitForEvent('window');
    await pet.evaluate(() => { window.petPanel.toggle(); window.petPanel.toggle(); });
    const panel = await opened;
    await panel.waitForLoadState('load');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet 유틸리티').isVisible()), false);
    await pet.evaluate(() => window.petPanel.toggle());
    await waitUntil(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet 유틸리티').isVisible()));
    const placement = await app.evaluate(({ BrowserWindow, screen }) => {
      const pet = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet');
      const area = screen.getPrimaryDisplay().workArea;
      pet.setPosition(area.x + 40, area.y + 40);
      return area;
    });
    await waitUntil(async () => {
      const result = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet 유틸리티').getBounds());
      const petX = placement.x + 40, petY = placement.y + 40;
      const beside = result.x === petX + 128 + 8 || result.y === petY + 128 + 8;
      return beside && result.x >= placement.x && result.y >= placement.y &&
        result.x + result.width <= placement.x + placement.width && result.y + result.height <= placement.y + placement.height;
    });
    // Panel input remains available even when the pet itself is click-through.
    await panel.locator('#draft').click();
    await panel.keyboard.type('still editable');
    assert.equal(await panel.locator('#draft').inputValue(), 'still editable');
    const exited = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet').close());
    await exited;
  } finally {
    await app.close();
  }
});

test('F05: text and original image files persist, and only successful saves trigger eating', { timeout: 30000 }, async t => {
  const profile = await profileFor(t);
  let app = await launch(profile);
  try {
    let { pet, panel } = await openPanel(app);
    await pet.emulateMedia({ reducedMotion: 'no-preference' });
    await panel.locator('#feed-text').click();
    await panel.waitForFunction(() => document.querySelector('#feed-status').textContent.includes('입력해'));
    assert.notEqual(await pet.locator('canvas').getAttribute('data-state'), 'eating');
    const text = '  한글 🐱\n{"hello":"world"}\n';
    await panel.locator('#draft').fill(text);
    await panel.locator('#feed-text').click();
    await panel.waitForFunction(() => document.querySelectorAll('#food-list li').length === 1);
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'eating');
    const frame = await pet.locator('canvas').evaluate(canvas => canvas.toDataURL());
    await pet.waitForFunction(frame => document.querySelector('canvas').toDataURL() !== frame, frame);
    await pet.screenshot({ path: `${root}/test-results/f05-eating.png`, omitBackground: true });
    await waitUntil(async () => await panel.locator('#draft').inputValue() === '');

    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2l9sAAAAASUVORK5CYII=', 'base64');
    const sources = [path.join(profile, 'a', 'photo.png'), path.join(profile, 'b', 'photo.png')];
    for (const source of sources) { await mkdir(path.dirname(source)); await writeFile(source, image); }
    await panel.locator('#files').setInputFiles(sources);
    await panel.waitForFunction(() => document.querySelectorAll('#food-list li').length === 3);
    const result = await panel.evaluate(() => window.food.list());
    assert.equal(result.ok, true);
    for (const item of result.value.filter(item => item.kind === 'file')) {
      assert.deepEqual(await readFile(path.join(profile, 'food', item.id, 'content', item.filename)), image);
    }
    assert.deepEqual(await readFile(sources[0]), image);
    await panel.screenshot({ path: `${root}/test-results/f05-panel.png` });
    await app.close();
    app = await launch(profile);
    ({ pet, panel } = await openPanel(app));
    await panel.waitForFunction(() => document.querySelectorAll('#food-list li').length === 3);
    await panel.getByRole('button', { name: '텍스트 불러오기' }).click();
    assert.equal(await panel.locator('#draft').inputValue(), text);
    assert.notEqual(await pet.locator('canvas').getAttribute('data-state'), 'eating', 'restoring a list does not eat again');
    // User-initiated file opening resolves only a saved item, without launching an external app in the test.
    await app.evaluate(({ shell }) => { shell.openPath = async file => { globalThis.openedFood = file; return ''; }; });
    await panel.getByRole('button', { name: '파일 열기', exact: true }).first().click();
    await waitUntil(() => app.evaluate(() => typeof globalThis.openedFood === 'string'));
    assert.ok((await app.evaluate(() => globalThis.openedFood)).startsWith(path.join(profile, 'food') + path.sep));
  } finally { await app.close(); }
});

test('F05: pet drops, text paste, clipboard images, and oversize errors use the same shelf', { timeout: 30000 }, async t => {
  const app = await launch(await profileFor(t));
  try {
    const { pet, panel } = await openPanel(app);
    await pet.emulateMedia({ reducedMotion: 'reduce' });
    await pet.evaluate(() => {
      const data = new DataTransfer();
      data.setData('text/plain', 'dropped on pet');
      document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 64, clientY: 64, dataTransfer: data }));
    });
    await panel.waitForFunction(() => document.querySelectorAll('#food-list li').length === 1);
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'eating');
    const still = await pet.locator('canvas').evaluate(canvas => canvas.toDataURL());
    await pet.waitForTimeout(250);
    assert.equal(await pet.locator('canvas').evaluate(canvas => canvas.toDataURL()), still, 'reduced motion uses a static success pose');
    await panel.locator('#close').focus();
    await panel.evaluate(() => {
      const data = new DataTransfer();
      data.setData('text/plain', 'pasted text');
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    assert.equal(await panel.locator('#draft').inputValue(), 'pasted text');
    await panel.locator('#feed-text').click();
    await panel.waitForFunction(() => document.querySelectorAll('#food-list li').length === 2);
    await panel.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array([1, 2, 255, 4])], 'clipboard.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await panel.waitForFunction(() => document.querySelectorAll('#food-list li').length === 3);
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'idle');
    await panel.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'too-large.png'));
      document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
    });
    await panel.waitForFunction(() => document.querySelector('#feed-status').textContent.includes('25MB'));
    assert.equal(await panel.locator('#food-list li').count(), 3);
    assert.equal(await pet.locator('canvas').getAttribute('data-state'), 'idle');
    const rejected = await panel.evaluate(() => window.food.saveText('한'.repeat(400000)));
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /1MB/);
    assert.equal(await panel.locator('#food-list li').count(), 3);
  } finally { await app.close(); }
});

test('F05: partial file batches preserve successes; storage failures retain unsaved text', { timeout: 30000 }, async t => {
  const profile = await profileFor(t);
  let app = await launch(profile);
  try {
    let { pet, panel } = await openPanel(app);
    const mixed = await panel.evaluate(() => window.food.saveFiles([
      new File(['keep this file'], 'good.txt'),
      new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'large.bin'),
    ]));
    assert.equal(mixed.ok, true);
    assert.equal(mixed.value.items.length, 1);
    assert.equal(mixed.value.errors.length, 1);
    assert.match(mixed.value.errors[0], /large.bin.*25MB/);
    assert.equal((await panel.evaluate(() => window.food.list())).value.length, 1);
    const tooMany = await panel.evaluate(() => window.food.saveFiles(Array.from({ length: 11 }, () => new File(['x'], 'x.txt'))));
    assert.equal(tooMany.ok, false);
    await app.close();
    // Use a separate profile whose storage root is a file, simulating an I/O failure.
    const blocked = await profileFor(t);
    await writeFile(path.join(blocked, 'food'), 'do not overwrite');
    app = await launch(blocked);
    ({ pet, panel } = await openPanel(app));
    await panel.locator('#draft').fill('keep my unsaved input');
    await panel.locator('#feed-text').click();
    await panel.waitForFunction(() => !document.querySelector('#feed-text').disabled && document.querySelector('#feed-status').classList.contains('error'));
    assert.equal(await panel.locator('#draft').inputValue(), 'keep my unsaved input');
    assert.notEqual(await pet.locator('canvas').getAttribute('data-state'), 'eating');
    assert.equal(await readFile(path.join(blocked, 'food'), 'utf8'), 'do not overwrite');
  } finally { await app.close(); }
});
