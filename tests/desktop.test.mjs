import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, realpath, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { getInitialBounds } from '../desktop/window.cjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const jwtToken = (payload, header = { alg: 'HS256', typ: 'JWT' }, signature = 'AA') =>
  `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`;

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

async function petPoint(page, x, y) {
  const rect = await page.locator('#pet').boundingBox();
  return { x: rect.x + x - 16, y: rect.y + y - 16 };
}
async function movePet(page, x, y) {
  const point = await petPoint(page, x, y);
  await page.mouse.move(point.x, point.y);
}
async function clickPet(page, x, y) {
  const point = await petPoint(page, x, y);
  await page.mouse.click(point.x, point.y);
}

async function runTool(panel, format) {
  await panel.locator('#input-format').selectOption(format);
  await panel.locator('#run-tool').click();
}

test('Characters: six previews, live selection, reactions, hit regions and restart persistence', { timeout: 30000 }, async t => {
  const profile = await profileFor(t);
  await writeFile(path.join(profile, 'appearance.json'), JSON.stringify({ version: 1, preferences: { ground: false, menuSide: 'right' } }));
  let app = await launch(profile);
  try {
    let { pet, panel } = await openPanel(app);
    const errors = [];
    pet.on('pageerror', error => errors.push(error.message));
    panel.on('pageerror', error => errors.push(error.message));
    await pet.emulateMedia({ reducedMotion: 'reduce' });
    await panel.locator('#draft').fill('캐릭터를 바꿔도 남아 있을 메모');
    await panel.locator('#show-settings').click();
    const anchor = await bounds(app);
    await app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet');
      const original = win.setIgnoreMouseEvents.bind(win);
      win.setIgnoreMouseEvents = (ignore, options) => { globalThis.characterIgnoring = ignore; original(ignore, options); };
      globalThis.characterCursor = { x: -10000, y: -10000 };
      screen.getCursorScreenPoint = () => globalThis.characterCursor;
    });
    assert.equal(await panel.locator('#character-picker button').count(), 6);
    const ids = ['cat-cheese', 'cat-tuxedo', 'cat-black', 'dog-shiba', 'dog-retriever', 'dog-corgi'];
    const frames = new Set();
    for (const id of ids) {
      await panel.locator(`#character-picker button[data-character="${id}"]`).click();
      await pet.waitForFunction(id => document.querySelector('#pet').dataset.character === id, id);
      await panel.waitForFunction(() => !document.querySelector('#character-picker button').disabled);
      assert.equal(await panel.locator(`#character-picker button[data-character="${id}"]`).getAttribute('aria-pressed'), 'true');
      assert.deepEqual(await bounds(app), anchor, 'selection never moves the yard');
      const snapshot = await pet.locator('#pet').evaluate(canvas => ({ image: canvas.toDataURL(),
        alpha: canvas.getContext('2d').getImageData(0, 0, 24, 24).data[3] }));
      assert.equal(snapshot.alpha, 0, 'corner stays click-through');
      frames.add(snapshot.image);
      const hit = await pet.locator('#pet').evaluate(canvas => {
        const pixels = canvas.getContext('2d').getImageData(0, 0, 24, 24).data;
        const index = Array.from({ length: 576 }, (_, i) => i).find(i => pixels[i * 4 + 3] === 255);
        const rect = canvas.getBoundingClientRect();
        return { x: rect.x + index % 24 * 4 + 2, y: rect.y + Math.floor(index / 24) * 4 + 2, corner: { x: rect.x + 1, y: rect.y + 1 } };
      });
      await app.evaluate((_electron, point) => { globalThis.characterCursor = point; }, { x: anchor.x + hit.x, y: anchor.y + hit.y });
      await waitUntil(() => app.evaluate(() => globalThis.characterIgnoring === false));
      await app.evaluate((_electron, point) => { globalThis.characterCursor = point; }, { x: anchor.x + hit.corner.x, y: anchor.y + hit.corner.y });
      await waitUntil(() => app.evaluate(() => globalThis.characterIgnoring === true));
    }
    assert.equal(frames.size, 6, 'each character has distinct artwork');
    const still = await pet.locator('#pet').evaluate(canvas => canvas.toDataURL());
    await pet.waitForTimeout(250);
    assert.equal(await pet.locator('#pet').evaluate(canvas => canvas.toDataURL()), still, 'reduced motion remains static after selection');
    assert.equal((await pet.evaluate(() => window.appearance.set('character', 'cat-black'))).ok, false);
    assert.equal((await panel.evaluate(() => window.appearance.set('character', 'unknown'))).ok, false);
    await panel.evaluate(() => window.resultTools.react('success'));
    await pet.waitForFunction(() => document.querySelector('#pet').dataset.state === 'processing');
    await panel.locator('#character-picker button[data-character="dog-retriever"]').click();
    await pet.waitForFunction(() => document.querySelector('#pet').dataset.character === 'dog-retriever');
    assert.notEqual(await pet.locator('#pet').evaluate(canvas => canvas.toDataURL()), still);
    await pet.waitForFunction(() => document.querySelector('#pet').dataset.state === 'success');

    // Render a review sheet from the same functions used by the live pet.
    const sheet = await panel.evaluate(async () => {
      const { characters, drawCharacter } = await import('./characters.js');
      const states = ['idle', 'eating', 'processing', 'success', 'failure', 'attack'];
      const canvas = document.createElement('canvas');
      canvas.width = 960; canvas.height = 840;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f1f4f0'; ctx.fillRect(0, 0, 960, 840);
      ctx.font = '13px -apple-system, sans-serif'; ctx.textAlign = 'center';
      characters.forEach((character, col) => states.forEach((state, row) => {
        const frame = document.createElement('canvas'); frame.width = frame.height = 24;
        drawCharacter(frame.getContext('2d'), character.id, state, state === 'attack' ? 180 : 650);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(frame, col * 160 + 32, row * 140 + 10, 96, 96);
        ctx.fillStyle = '#33473e'; ctx.fillText(`${character.name} · ${state}`, col * 160 + 80, row * 140 + 126);
      }));
      return canvas.toDataURL();
    });
    await mkdir(path.join(root, 'test-results'), { recursive: true });
    await writeFile(path.join(root, 'test-results/characters.png'), Buffer.from(sheet.split(',')[1], 'base64'));
    await panel.screenshot({ path: path.join(root, 'test-results/character-settings.png'), omitBackground: true });
    await panel.locator('#show-food').click();
    assert.equal(await panel.locator('#draft').inputValue(), '캐릭터를 바꿔도 남아 있을 메모');
    assert.deepEqual(errors, []);
    await app.close();
    app = await launch(profile);
    ({ pet, panel } = await openPanel(app));
    await pet.waitForFunction(() => document.querySelector('#pet').dataset.character === 'dog-retriever');
    await panel.locator('#show-settings').click();
    assert.equal(await panel.locator('#character-picker button[data-character="dog-retriever"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await panel.locator('#show-ground').isChecked(), false);
    assert.equal(await panel.locator('#menu-side').inputValue(), 'right');
  } finally {
    await app.close();
  }
});

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
        allWorkspaces: win.isVisibleOnAllWorkspaces(),
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
    if (process.platform === 'darwin') assert.equal(native.allWorkspaces, true);
    assert.equal(native.resizable, false);
    // Electron's getter omits alpha; inspect the native capture for transparency.
    assert.equal(native.background, '#000000');
    assert.equal(native.cornerAlpha, 0);
    assert.deepEqual(native.bounds, native.content, 'no native title bar or frame');
    assert.equal(native.bounds.width, 496);
    assert.equal(native.bounds.height, 128);
    assert.ok(native.bounds.x >= native.workArea.x);
    assert.ok(native.bounds.y >= native.workArea.y);
    assert.ok(native.bounds.x + native.bounds.width <= native.workArea.x + native.workArea.width);
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
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
    const before = await bounds(app);
    // A click or a small hand tremor must not become a drag.
    await movePet(page, 64, 64);
    await page.mouse.down();
    await movePet(page, 65, 65);
    await page.mouse.up();
    assert.deepEqual(await bounds(app), before);
    await page.evaluate(() => window.petPanel.close());
    // The transparent margin is not a drag handle.
    await movePet(page, 4, 4);
    await page.mouse.down();
    await movePet(page, 10, 10);
    await page.mouse.up();
    assert.deepEqual(await bounds(app), before);

    await movePet(page, 64, 64);
    await page.mouse.down();
    await movePet(page, 24, 24);
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
    assert.ok(recovered.x >= area.x + 20 && recovered.x + recovered.width <= area.x + 320);
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
    assert.ok(areas.some(a => restored.x >= a.x && restored.y >= a.y && restored.x + restored.width <= a.x + a.width && restored.y + 128 <= a.y + a.height));
  } finally {
    await app.close();
  }
});

test('F02: right-button gestures and lost capture do not leave a stuck drag', { timeout: 30000 }, async t => {
  const app = await launch(await profileFor(t));
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('load');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const before = await bounds(app);
    // Keep the OS menu out of this gesture test; F01 retains the quit menu.
    await page.evaluate(() => document.addEventListener('contextmenu', event => event.preventDefault()));
    await movePet(page, 64, 64);
    await page.mouse.down({ button: 'right' });
    await movePet(page, 24, 24);
    await page.mouse.up({ button: 'right' });
    assert.deepEqual(await bounds(app), before);

    await page.evaluate(() => document.querySelector('canvas').addEventListener('gotpointercapture', event => {
      window.capturedPointer = event.pointerId;
    }));
    await movePet(page, 64, 64);
    await page.mouse.down();
    // Travel outside the canvas: pointer capture must still move the pet.
    await movePet(page, 8, 8);
    await waitUntil(async () => (await bounds(app)).x < before.x);
    await page.evaluate(() => document.querySelector('canvas').releasePointerCapture(window.capturedPointer));
    await movePet(page, 10, 10);
    await page.waitForFunction(() => !document.querySelector('canvas').classList.contains('dragging'));
    const stopped = await bounds(app);
    await movePet(page, 12, 12);
    await page.mouse.up();
    assert.deepEqual(await bounds(app), stopped);
    // A new gesture still works after cancellation.
    await movePet(page, 64, 64);
    await page.mouse.down();
    await movePet(page, 40, 40);
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
    const cursor = async point => app.evaluate(({ BrowserWindow }, point) => {
      BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet').testCursor = point;
    }, await petPoint(page, point.x, point.y));
    // Force a transition after installing the observer, independent of the real
    // cursor position when the test window first appeared.
    await page.waitForTimeout(60);
    await cursor({ x: 64, y: 64 });
    await waitUntil(async () => await ignoring() === false);
    await cursor({ x: 4, y: 4 });
    await waitUntil(async () => await ignoring() === true);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet').testForward), true);
    await cursor({ x: 20, y: 20 }); // Transparent pixel inside the canvas.
    await movePet(page, 20, 20);
    const before = await bounds(app);
    await page.mouse.down();
    await movePet(page, 40, 40);
    await page.mouse.up();
    assert.deepEqual(await bounds(app), before);
    assert.equal(await ignoring(), true);

    await cursor({ x: 64, y: 64 });
    await waitUntil(async () => await ignoring() === false);
    await movePet(page, 64, 64);
    await page.mouse.down();
    await cursor({ x: 4, y: 4 });
    await movePet(page, 8, 8);
    await waitUntil(async () => (await bounds(app)).x < before.x);
    assert.equal(await ignoring(), false, 'drag owns input even over transparent pixels');
    await page.mouse.up();
    await waitUntil(async () => await ignoring() === true);

    await movePet(page, 64, 64); // Hover holds roaming while testing the idle sprite's alpha.
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
      win.webContents.emit('context-menu', {}, { x: win.getBounds().width - 128 + 20, y: 20 });
      if (win.testMenu) throw new Error('Transparent pixels opened the pet menu');
      win.webContents.emit('context-menu', {}, { x: win.getBounds().width - 128 + 64, y: 64 });
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
    await pet.emulateMedia({ reducedMotion: 'reduce' });
    const panelVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(win => win.getTitle() === 'BytePet 유틸리티' && win.isVisible()));
    await clickPet(pet, 20, 20);
    assert.equal(await panelVisible(), false, 'transparent pixels cannot open a panel');
    await movePet(pet, 64, 64);
    await pet.mouse.down();
    await movePet(pet, 40, 40);
    await pet.mouse.up();
    assert.equal(await panelVisible(), false, 'drag cannot open a panel');
    const opened = app.waitForEvent('window');
    await clickPet(pet, 64, 64);
    const panel = await opened;
    await panel.waitForLoadState('load');
    await waitUntil(panelVisible);
    await panel.waitForFunction(() => document.activeElement?.id === 'draft');
    await waitUntil(async () => await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.getTitle()) === 'BytePet 유틸리티');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.getTitle()), 'BytePet 유틸리티');
    await panel.keyboard.type('F04 focus check');
    assert.equal(await panel.locator('#draft').inputValue(), 'F04 focus check');
    assert.equal(await pet.locator('canvas').getAttribute('aria-expanded'), 'true');
    const safety = await app.evaluate(({ BrowserWindow, screen }) => {
      const panel = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet 유틸리티');
      return { bounds: panel.getBounds(), area: screen.getDisplayMatching(panel.getBounds()).workArea,
        allWorkspaces: panel.isVisibleOnAllWorkspaces(),
        parent: panel.getParentWindow().getTitle(), prefs: panel.webContents.getLastWebPreferences() };
    });
    assert.equal(safety.parent, 'BytePet');
    if (process.platform === 'darwin') assert.equal(safety.allWorkspaces, true);
    assert.equal(safety.prefs.nodeIntegration, false);
    assert.equal(safety.prefs.contextIsolation, true);
    assert.equal(safety.prefs.sandbox, true);
    assert.ok(safety.bounds.x >= safety.area.x && safety.bounds.y >= safety.area.y);
    assert.ok(safety.bounds.x + safety.bounds.width <= safety.area.x + safety.area.width);
    assert.ok(safety.bounds.y + safety.bounds.height <= safety.area.y + safety.area.height);
    await panel.screenshot({ path: `${root}/test-results/f04-panel.png` });

    await clickPet(pet, 64, 64);
    await waitUntil(async () => !(await panelVisible()));
    await pet.waitForFunction(() => document.querySelector('canvas').getAttribute('aria-expanded') === 'false');
    await clickPet(pet, 64, 64);
    await waitUntil(panelVisible);
    await panel.waitForFunction(() => document.activeElement?.id === 'draft');
    assert.equal(await panel.locator('#draft').inputValue(), 'F04 focus check');
    assert.equal(app.windows().length, 2, 'reopening reuses the panel');
    if (process.platform === 'darwin') {
      assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
        .every(win => win.isVisibleOnAllWorkspaces())), true, 'pet and reopened panel stay on every Space');
    }
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
  let mainLog = '';
  app.process().stderr.on('data', data => { mainLog += data.toString(); });
  // Capture shutdown errors rather than hanging behind Electron's native error dialog.
  await app.evaluate(() => { process.on('uncaughtException', error => process.stderr.write('BYTEPET_UNCAUGHT: ' + error.stack + '\n')); });
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
      const yard = await bounds(app);
      const beside = result.x === yard.x && result.y + result.height - 10 === yard.y + yard.height - 20;
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
    assert.doesNotMatch(mainLog, /BYTEPET_UNCAUGHT:/, 'closing the pet and child panel must not throw');
  } finally {
    await app.close();
  }
});

test('Tray: hide and restore the yard and open house without losing drafts or placement', { timeout: 30000 }, async t => {
  const profile = await profileFor(t);
  let app = await launch(profile);
  try {
    const { pet, panel } = await openPanel(app);
    await panel.locator('#draft').fill('숨겼다가 돌아와도 남아 있는 메모');
    const originalBounds = await bounds(app);
    // Observe the real tray's refreshed native menu, then exercise its callback.
    // No production test bridge or renderer access to the tray is exposed.
    await app.evaluate(({ Tray, Menu }) => {
      const setContextMenu = Tray.prototype.setContextMenu;
      Tray.prototype.setContextMenu = function (menu) {
        globalThis.testTray = this;
        globalThis.testTrayMenu = menu;
        return setContextMenu.call(this, menu);
      };
      Menu.getApplicationMenu().getMenuItemById('toggle-pet-visibility').click();
    });
    const visible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .filter(win => win.isVisible()).map(win => win.getTitle()).sort());
    assert.deepEqual(await visible(), []);
    const hiddenMenu = await app.evaluate(({ Menu }) => ({
      trayAlive: !globalThis.testTray.isDestroyed(),
      trayLabel: globalThis.testTrayMenu.getMenuItemById('toggle-pet-visibility').label,
      appLabel: Menu.getApplicationMenu().getMenuItemById('toggle-pet-visibility').label,
      canQuit: globalThis.testTrayMenu.items.some(item => item.role === 'quit'),
    }));
    assert.deepEqual(hiddenMenu, { trayAlive: true, trayLabel: '다시 표시', appLabel: '다시 표시', canQuit: true });

    // Late renderer messages cannot reopen a temporarily hidden house.
    await pet.evaluate(async () => { window.petPanel.toggle(); await window.modules.get(); });
    await panel.evaluate(async () => { window.utilityPanel.ready(); await window.modules.get(); });
    assert.deepEqual(await visible(), []);
    await app.evaluate(() => globalThis.testTrayMenu.getMenuItemById('toggle-pet-visibility').click());
    await waitUntil(async () => (await visible()).length === 2);
    assert.equal(await panel.locator('#draft').inputValue(), '숨겼다가 돌아와도 남아 있는 메모');
    assert.deepEqual(await bounds(app), originalBounds);
    assert.equal(app.windows().length, 2, 'restore reuses both windows');
    assert.equal(await app.evaluate(() => globalThis.testTrayMenu.getMenuItemById('toggle-pet-visibility').label), '잠시 숨기기');
    if (process.platform === 'darwin') assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .every(win => win.isVisibleOnAllWorkspaces())), true);

    await panel.getByRole('button', { name: '패널 닫기', exact: true }).click();
    await waitUntil(async () => (await visible()).length === 1);
    await app.evaluate(() => globalThis.testTrayMenu.getMenuItemById('toggle-pet-visibility').click());
    assert.deepEqual(await visible(), []);
    await app.evaluate(() => globalThis.testTrayMenu.getMenuItemById('toggle-pet-visibility').click());
    assert.deepEqual(await visible(), ['BytePet'], 'a previously closed house stays closed');

    await app.evaluate(() => globalThis.testTrayMenu.getMenuItemById('toggle-pet-visibility').click());
    await app.evaluate(({ app }) => app.emit('activate'));
    assert.deepEqual(await visible(), ['BytePet'], 'Dock activation also recovers a hidden pet');
    await app.evaluate(() => globalThis.testTrayMenu.getMenuItemById('toggle-pet-visibility').click());
    await app.close();
    app = await launch(profile);
    await (await app.firstWindow()).waitForLoadState('load');
    await waitUntil(async () => (await visible()).length === 1);
    assert.deepEqual(await visible(), ['BytePet'], 'temporary hiding is not persisted across launches');
  } finally {
    await app.close();
  }
});

test('Tray: hiding while the house loads prevents ready events from showing it', { timeout: 30000 }, async t => {
  const app = await launch(await profileFor(t));
  try {
    const pet = await app.firstWindow();
    await pet.waitForLoadState('load');
    await app.evaluate(({ ipcMain, Menu }) => {
      ipcMain.once('pet:panel-toggle', () => Menu.getApplicationMenu().getMenuItemById('toggle-pet-visibility').click());
    });
    const opened = app.waitForEvent('window');
    await pet.evaluate(() => window.petPanel.toggle());
    const panel = await opened;
    await panel.waitForLoadState('load');
    await panel.evaluate(async () => { window.utilityPanel.ready(); await window.modules.get(); });
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(win => win.isVisible())), false);
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('toggle-pet-visibility').click());
    await waitUntil(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(win => win.isVisible())));
    await panel.locator('#draft').fill('복원 후 입력 가능');
    assert.equal(await panel.locator('#draft').inputValue(), '복원 후 입력 가능');
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
      const rect = document.querySelector('#pet').getBoundingClientRect();
      document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: rect.x + 48, clientY: rect.y + 48, dataTransfer: data }));
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

test('F06: local JWT inspection, safe rendering, shelf restore, and stale-result clearing', { timeout: 30000 }, async t => {
  const app = await launch(await profileFor(t));
  try {
    const { pet, panel } = await openPanel(app);
    const errors = [];
    const requests = [];
    panel.on('pageerror', error => errors.push(error.message));
    panel.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    const payload = { sub: '고양이 🐱', role: 'developer', exp: 4102444800, note: '<img src=x onerror="window.injected=true">' };
    const token = jwtToken(payload);
    await panel.locator('#draft').fill(`Bearer ${token}`);
    await runTool(panel, 'jwt');
    assert.deepEqual(JSON.parse(await panel.locator('#jwt-header').textContent()), { alg: 'HS256', typ: 'JWT' });
    assert.deepEqual(JSON.parse(await panel.locator('#jwt-payload').textContent()), payload);
    assert.match(await panel.locator('#jwt-signature').textContent(), /서명 미검증/);
    assert.equal(await panel.locator('#jwt-expiration').getAttribute('data-state'), 'unexpired');
    assert.match(await panel.locator('#jwt-expiration').textContent(), /2100-01-01.*UTC/);
    assert.equal(await panel.locator('#jwt-output img').count(), 0);
    assert.equal(await panel.evaluate(() => window.injected), undefined);
    assert.equal((await panel.evaluate(() => window.food.list())).value.length, 0, 'inspection does not save a token');
    assert.notEqual(await pet.locator('canvas').getAttribute('data-state'), 'eating');
    await mkdir(path.join(root, 'test-results'), { recursive: true });
    await panel.screenshot({ path: `${root}/test-results/f06-jwt.png` });
    await panel.locator('#close-jwt').click();
    assert.equal(await panel.locator('#jwt-result').isVisible(), false);
    assert.equal(await panel.locator('#draft').inputValue(), `Bearer ${token}`);

    await panel.locator('#feed-text').click();
    await panel.waitForFunction(() => document.querySelector('#draft').value === '');
    await panel.getByRole('button', { name: '텍스트 불러오기' }).click();
    assert.equal(await panel.locator('#draft').inputValue(), `Bearer ${token}`);
    await runTool(panel, 'jwt');
    assert.deepEqual(JSON.parse(await panel.locator('#jwt-payload').textContent()), payload);
    await panel.keyboard.press('Escape');
    await pet.evaluate(() => window.petPanel.toggle());
    await panel.waitForFunction(() => document.activeElement?.id === 'draft');
    assert.equal(await panel.locator('#jwt-result').isVisible(), true);
    await panel.locator('#draft').fill('different input');
    assert.equal(await panel.locator('#jwt-result').isVisible(), false);
    assert.equal(await panel.locator('#jwt-payload').textContent(), '');
    await runTool(panel, 'jwt');
    assert.match(await panel.locator('#jwt-error').textContent(), /Header.Payload.Signature/);
    await panel.getByRole('button', { name: '텍스트 불러오기' }).click();
    assert.equal(await panel.locator('#jwt-result').isVisible(), false, 'loading a stored draft clears an earlier result');
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
  } finally { await app.close(); }
});

test('F06: invalid tokens, missing/invalid expiration, unsigned tokens, and live expiry', { timeout: 30000 }, async t => {
  const app = await launch(await profileFor(t));
  try {
    const { panel } = await openPanel(app);
    for (const [input, message] of [
      ['', /입력해/], ['a.b.c.d.e', /JWE/], ['e30._w.AA', /UTF-8/],
      [jwtToken([], { alg: 'HS256' }), /JSON 객체/],
    ]) {
      await panel.locator('#draft').fill(input);
      await runTool(panel, 'jwt');
      assert.match(await panel.locator('#jwt-error').textContent(), message);
      assert.equal(await panel.locator('#jwt-output').isVisible(), false);
      assert.equal(await panel.locator('#draft').inputValue(), input);
    }
    for (const [payload, state] of [[{}, 'missing'], [{ exp: '123' }, 'invalid'], [{ exp: 0 }, 'expired']]) {
      await panel.locator('#draft').fill(jwtToken(payload, { alg: 'none' }, ''));
      await runTool(panel, 'jwt');
      assert.equal(await panel.locator('#jwt-expiration').getAttribute('data-state'), state);
      assert.match(await panel.locator('#jwt-signature').textContent(), /서명 없음/);
      assert.deepEqual(JSON.parse(await panel.locator('#jwt-payload').textContent()), payload);
      assert.equal(await panel.locator('#jwt-error').isVisible(), false);
    }
    await panel.locator('#draft').fill(jwtToken({ exp: Date.now() / 1000 + 2.5 }));
    await runTool(panel, 'jwt');
    assert.equal(await panel.locator('#jwt-expiration').getAttribute('data-state'), 'unexpired');
    await panel.waitForFunction(() => document.querySelector('#jwt-expiration').dataset.state === 'expired');
    // A failed decode must remove all previous output, not leave a plausible old payload.
    await panel.locator('#draft').fill('broken');
    await runTool(panel, 'jwt');
    assert.equal(await panel.locator('#jwt-payload').textContent(), '');
    assert.equal(await panel.locator('#jwt-output').isVisible(), false);
  } finally { await app.close(); }
});

test('F07: lossless local JSON formatting, shelf restore, and tool switching', { timeout: 30000 }, async t => {
  const app = await launch(await profileFor(t));
  try {
    const { pet, panel } = await openPanel(app);
    const errors = [];
    const requests = [];
    panel.on('pageerror', error => errors.push(error.message));
    panel.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    const input = '{"name":"고양이 🐱","id":900719925474099312345,"tags":["pet","dev"],"html":"<img src=x onerror=alert(1)>"}';
    await panel.locator('#draft').fill(input);
    await runTool(panel, 'json');
    const formatted = await panel.locator('#json-output').textContent();
    assert.match(formatted, /\n  "name": "고양이 🐱",\n/);
    assert.match(formatted, /900719925474099312345/);
    assert.equal(await panel.locator('#draft').inputValue(), input);
    assert.equal(await panel.locator('#json-output img').count(), 0);
    assert.equal((await panel.evaluate(() => window.food.list())).value.length, 0);
    assert.notEqual(await pet.locator('canvas').getAttribute('data-state'), 'eating');
    assert.equal(await panel.locator('#json-error').isVisible(), false);
    await mkdir(path.join(root, 'test-results'), { recursive: true });
    await panel.screenshot({ path: `${root}/test-results/f07-json.png` });
    await panel.keyboard.press('Escape');
    await pet.evaluate(() => window.petPanel.toggle());
    await panel.waitForFunction(() => document.activeElement?.id === 'draft');
    assert.equal(await panel.locator('#json-output').textContent(), formatted);
    await runTool(panel, 'jwt');
    assert.equal(await panel.locator('#json-result').isVisible(), false);
    assert.equal(await panel.locator('#jwt-error').isVisible(), true);
    await runTool(panel, 'json');
    assert.equal(await panel.locator('#jwt-result').isVisible(), false);
    assert.equal(await panel.locator('#json-output').textContent(), formatted);
    await panel.locator('#close-json').click();
    assert.equal(await panel.locator('#json-result').isVisible(), false);
    assert.equal(await panel.locator('#draft').inputValue(), input);
    await runTool(panel, 'json');
    await panel.locator('#feed-text').click();
    await panel.waitForFunction(() => document.querySelector('#draft').value === '');
    assert.equal(await panel.locator('#json-result').isVisible(), false);
    await panel.getByRole('button', { name: '텍스트 불러오기' }).click();
    assert.equal(await panel.locator('#draft').inputValue(), input);
    await runTool(panel, 'json');
    assert.equal(await panel.locator('#json-output').textContent(), formatted);
    await panel.getByRole('button', { name: '텍스트 불러오기' }).click();
    assert.equal(await panel.locator('#json-result').isVisible(), false);
    await runTool(panel, 'json');
    await panel.locator('#draft').fill('null');
    assert.equal(await panel.locator('#json-result').isVisible(), false);
    await runTool(panel, 'json');
    assert.equal(await panel.locator('#json-output').textContent(), 'null');
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
  } finally { await app.close(); }
});

test('F07: JSON errors identify and select original positions, clear stale output, and recover', { timeout: 30000 }, async t => {
  const app = await launch(await profileFor(t));
  try {
    const { panel } = await openPanel(app);
    await panel.locator('#draft').fill('{"valid":true}');
    await runTool(panel, 'json');
    const input = '{\n  "name": "고양이 🐱",\n  "items": [1, 2,]\n}';
    await panel.locator('#draft').fill(input);
    await runTool(panel, 'json');
    assert.match(await panel.locator('#json-error').textContent(), /3줄 18열.*쉼표/);
    assert.equal(await panel.locator('#json-output').textContent(), '');
    assert.equal(await panel.locator('#json-output').isVisible(), false);
    assert.equal(await panel.locator('#draft').inputValue(), input);
    await panel.screenshot({ path: `${root}/test-results/f07-error.png` });
    await panel.locator('#json-error-location').click();
    assert.deepEqual(await panel.locator('#draft').evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, focused: document.activeElement === el })), {
      start: input.indexOf(']'), end: input.indexOf(']') + 1, focused: true,
    });
    const long = '[\n' + '  1,\n'.repeat(30) + ']';
    await panel.locator('#draft').fill(long);
    await runTool(panel, 'json');
    await panel.locator('#json-error-location').click();
    assert.equal(await panel.locator('#draft').evaluate(el => el.selectionStart), long.length - 1);
    await panel.waitForFunction(() => document.querySelector('#draft').scrollTop > 0);
    await panel.locator('#draft').fill('[1,');
    await runTool(panel, 'json');
    assert.match(await panel.locator('#json-error').textContent(), /1줄 4열.*끝났/);
    await panel.locator('#json-error-location').click();
    assert.equal(await panel.locator('#draft').evaluate(el => el.selectionStart), 3);
    await panel.locator('#draft').fill('['.repeat(129) + '0' + ']'.repeat(129));
    await runTool(panel, 'json');
    assert.match(await panel.locator('#json-error').textContent(), /128단계/);
    // Programmatic fill exercises the UI limit without spending time on a megabyte of keystrokes.
    await panel.locator('#draft').evaluate(el => { el.value = '"' + 'x'.repeat(1024 * 1024) + '"'; el.dispatchEvent(new Event('input')); });
    await runTool(panel, 'json');
    assert.match(await panel.locator('#json-error').textContent(), /1MB/);
    assert.equal(await panel.locator('#json-error-location').isVisible(), false);
    await panel.locator('#draft').fill('[true, false, null]');
    await runTool(panel, 'json');
    assert.equal(await panel.locator('#json-error').isVisible(), false);
    assert.equal(await panel.locator('#json-output').textContent(), '[\n  true,\n  false,\n  null\n]');
  } finally { await app.close(); }
});

test('F08: automatic routing, explicit overrides, unknown input, and result clearing', { timeout: 30000 }, async t => {
  const app = await launch(await profileFor(t));
  try {
    const { pet, panel } = await openPanel(app);
    const mode = panel.locator('#input-format');
    const run = panel.locator('#run-tool');
    const hint = panel.locator('#format-hint');
    assert.equal(await mode.inputValue(), 'auto');
    assert.equal(await run.isDisabled(), true);
    await panel.locator('#draft').fill('{"hello":"고양이 🐱"}');
    assert.equal(await hint.getAttribute('data-format'), 'json');
    assert.equal(await run.textContent(), 'JSON 정리');
    assert.equal(await panel.locator('#json-result').isVisible(), false);
    assert.equal((await panel.evaluate(() => window.food.list())).value.length, 0);
    assert.notEqual(await pet.locator('canvas').getAttribute('data-state'), 'eating');
    await run.click();
    assert.match(await panel.locator('#json-output').textContent(), /고양이/);
    await mode.selectOption('jwt');
    assert.equal(await panel.locator('#json-result').isVisible(), false);
    await run.click();
    assert.equal(await panel.locator('#jwt-error').isVisible(), true);
    await panel.locator('#draft').fill('[1,2]');
    assert.equal(await mode.inputValue(), 'jwt', 'manual mode survives editing');
    assert.equal(await run.textContent(), 'JWT 해독');
    assert.equal(await panel.locator('#jwt-result').isVisible(), false);
    await panel.keyboard.press('Escape');
    await pet.evaluate(() => window.petPanel.toggle());
    await panel.waitForFunction(() => document.activeElement?.id === 'draft');
    assert.equal(await mode.inputValue(), 'jwt', 'manual mode survives hiding the panel');
    await mode.selectOption('auto');
    assert.equal(await hint.getAttribute('data-format'), 'json');
    await run.click();
    assert.equal(await panel.locator('#json-output').textContent(), '[\n  1,\n  2\n]');
    const token = jwtToken({ sub: 'F08', exp: 4102444800 });
    await panel.locator('#draft').fill(`Bearer ${token}`);
    assert.equal(await hint.getAttribute('data-format'), 'jwt');
    assert.equal(await panel.locator('#json-result').isVisible(), false);
    await run.click();
    assert.match(await panel.locator('#jwt-payload').textContent(), /F08/);
    await panel.locator('#draft').fill('[1,]');
    await run.click();
    assert.match(await panel.locator('#json-error').textContent(), /쉼표/);
    await panel.locator('#draft').fill('Bearer invalid');
    await run.click();
    assert.equal(await panel.locator('#jwt-error').isVisible(), true);
    for (const text of ['ordinary note', 'photo.backup.png', 'https://example.com']) {
      await panel.locator('#draft').fill(text);
      assert.equal(await run.isDisabled(), true);
      assert.match(await hint.textContent(), /직접 선택/);
      assert.equal(await panel.locator('#jwt-result').isVisible(), false);
    }
    await mode.selectOption('json');
    assert.equal(await run.isDisabled(), false);
    await run.click();
    assert.equal(await panel.locator('#json-error').isVisible(), true);
    await mode.selectOption('auto');
    await panel.locator('#draft').fill('');
    assert.equal(await run.isDisabled(), true);
    await panel.locator('#draft').evaluate(el => { el.value = '한'.repeat(400000); el.dispatchEvent(new Event('input')); });
    assert.equal(await run.isDisabled(), true);
    assert.match(await hint.textContent(), /1MB/);
    await panel.locator('#draft').fill('{"name":"BytePet","features":["JWT","JSON"]}');
    await mkdir(path.join(root, 'test-results'), { recursive: true });
    await panel.screenshot({ path: `${root}/test-results/f08-auto.png` });
  } finally { await app.close(); }
});

test('F08: shelf loading, paste, save reset, and composition update the selected tool', { timeout: 30000 }, async t => {
  const app = await launch(await profileFor(t));
  try {
    const { panel } = await openPanel(app);
    const errors = [];
    panel.on('pageerror', error => errors.push(error.message));
    const draft = panel.locator('#draft');
    const run = panel.locator('#run-tool');
    const hint = panel.locator('#format-hint');
    await draft.fill('{"restored":true}');
    await panel.locator('#feed-text').click();
    await panel.waitForFunction(() => document.querySelector('#draft').value === '');
    assert.equal(await run.isDisabled(), true);
    assert.equal(await hint.getAttribute('data-format'), '');
    await draft.fill(jwtToken({ sub: 'temporary' }));
    assert.equal(await hint.getAttribute('data-format'), 'jwt');
    await run.click();
    await panel.getByRole('button', { name: '텍스트 불러오기' }).click();
    assert.equal(await hint.getAttribute('data-format'), 'json');
    assert.equal(await panel.locator('#jwt-result').isVisible(), false);
    await run.click();
    assert.equal(JSON.parse(await panel.locator('#json-output').textContent()).restored, true);
    await draft.fill('');
    await panel.locator('#close').focus();
    await panel.evaluate(token => {
      const data = new DataTransfer();
      data.setData('text/plain', token);
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, jwtToken({ sub: 'pasted' }));
    assert.equal(await hint.getAttribute('data-format'), 'jwt');
    assert.equal(await panel.locator('#json-result').isVisible(), false);
    assert.equal(await draft.evaluate(el => document.activeElement === el), true);
    await run.click();
    assert.match(await panel.locator('#jwt-payload').textContent(), /pasted/);
    await draft.evaluate(el => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      el.value = '{"한글":"입력 중"}';
      el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    });
    assert.equal(await run.isDisabled(), true);
    assert.match(await hint.textContent(), /입력을 마치면/);
    assert.equal(await panel.locator('#jwt-result').isVisible(), false);
    await draft.evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    assert.equal(await run.isDisabled(), false);
    assert.equal(await hint.getAttribute('data-format'), 'json');
    await run.click();
    assert.match(await panel.locator('#json-output').textContent(), /입력 중/);
    assert.equal((await panel.evaluate(() => window.food.list())).value.length, 1);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('F09: JSON and JWT buttons copy exact results to the native clipboard only on request', { timeout: 30000 }, async t => {
  const app = await launch(await profileFor(t));
  try {
    const { pet, panel } = await openPanel(app);
    // Keep all original clipboard formats inside the test process, never in test output.
    await app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const snapshot = await clipboard.read();
      globalThis.clipboardSnapshot = await Promise.all(snapshot.filter(item => item.types.length).map(async item => new ClipboardItem(
        Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))),
      )));
      globalThis.copyWrites = [];
      const write = clipboard.writeText.bind(clipboard);
      clipboard.writeText = async text => { await write(text); globalThis.copyWrites.push(text); };
    });
    const input = '{"id":900719925474099312345,"name":"고양이 🐱"}';
    await panel.locator('#draft').fill(input);
    await panel.locator('#run-tool').click();
    assert.deepEqual(await app.evaluate(() => globalThis.copyWrites), []);
    const expected = await panel.locator('#json-output').textContent();
    await panel.locator('#copy-json').click();
    await panel.waitForFunction(() => document.querySelector('#json-copy-status').textContent.includes('복사했어요'));
    assert.equal(await app.evaluate(async ({ clipboard }) => await clipboard.readText()), expected);
    assert.match(expected, /900719925474099312345/);
    assert.equal(await panel.locator('#draft').inputValue(), input);
    assert.equal((await panel.evaluate(() => window.food.list())).value.length, 0);
    await panel.screenshot({ path: `${root}/test-results/f09-copy.png` });
    const payload = { sub: '복사 테스트', exp: 4102444800 };
    await panel.locator('#draft').fill(jwtToken(payload));
    await panel.locator('#run-tool').click();
    const header = JSON.parse(await panel.locator('#jwt-header').textContent());
    for (const [selector, value] of [['#copy-jwt-header', header], ['#copy-jwt-payload', payload], ['#copy-jwt-all', { header, payload }]]) {
      await panel.locator(selector).click();
      await panel.waitForFunction(() => document.querySelector('#jwt-copy-status').textContent.includes('복사했어요'));
      assert.equal(await app.evaluate(async ({ clipboard }) => await clipboard.readText()), JSON.stringify(value, null, 2));
    }
    assert.equal((await app.evaluate(() => globalThis.copyWrites)).length, 4);
    await panel.locator('#draft').fill('Bearer broken');
    assert.equal(await panel.locator('#copy-jwt-header').isDisabled(), true);
    await panel.locator('#run-tool').click();
    assert.equal(await panel.locator('#copy-jwt-all').isDisabled(), true);
    assert.equal((await app.evaluate(() => globalThis.copyWrites)).length, 4);
    assert.equal((await pet.evaluate(() => window.resultTools.copy('unauthorized'))).ok, false);
  } finally {
    // Restore only if the clipboard still holds our last write; respect a newer user copy.
    await app.evaluate(async ({ clipboard }) => {
      const last = globalThis.copyWrites?.at(-1);
      if (last !== undefined && await clipboard.readText() === last) {
        if (globalThis.clipboardSnapshot.length) await clipboard.write(globalThis.clipboardSnapshot);
        else clipboard.clear();
      }
    });
    await app.close();
  }
});

test('F09: copy failures and late responses preserve current results and permit retry', { timeout: 30000 }, async t => {
  const app = await launch(await profileFor(t));
  try {
    const { panel } = await openPanel(app);
    await app.evaluate(({ clipboard }) => { clipboard.writeText = async () => { throw new Error('mock clipboard failure'); }; });
    await panel.locator('#draft').fill('{"keep":true}');
    await panel.locator('#run-tool').click();
    const expected = await panel.locator('#json-output').textContent();
    await panel.locator('#copy-json').click();
    await panel.waitForFunction(() => document.querySelector('#json-copy-status').classList.contains('error'));
    assert.equal(await panel.locator('#json-output').textContent(), expected);
    assert.equal(await panel.locator('#copy-json').isDisabled(), false);
    await app.evaluate(({ clipboard }) => { clipboard.writeText = () => new Promise(resolve => { globalThis.finishCopy = resolve; }); });
    await panel.locator('#copy-json').click();
    assert.equal(await panel.locator('#copy-json').isDisabled(), true);
    await waitUntil(() => app.evaluate(() => typeof globalThis.finishCopy === 'function'));
    await panel.locator('#draft').fill('null');
    await panel.locator('#run-tool').click();
    assert.equal(await panel.locator('#json-copy-status').textContent(), '');
    await app.evaluate(() => globalThis.finishCopy());
    await panel.waitForTimeout(100);
    assert.equal(await panel.locator('#json-copy-status').textContent(), '', 'old completion must not label a new result copied');
    assert.equal(await panel.locator('#json-output').textContent(), 'null');
    await app.evaluate(({ clipboard }) => { clipboard.writeText = async text => { globalThis.retryCopy = text; }; });
    await panel.locator('#copy-json').click();
    await panel.waitForFunction(() => document.querySelector('#json-copy-status').textContent.includes('복사했어요'));
    assert.equal(await app.evaluate(() => globalThis.retryCopy), 'null');
    await panel.locator('#close-json').click();
    assert.equal(await panel.locator('#copy-json').isDisabled(), true);
  } finally { await app.close(); }
});

test('F09: chewing, success/failure, reduced motion, and newer feeding return to idle', { timeout: 30000 }, async t => {
  const app = await launch(await profileFor(t));
  try {
    const { pet, panel } = await openPanel(app);
    await pet.emulateMedia({ reducedMotion: 'no-preference' });
    await panel.locator('#draft').fill('{"happy":true}');
    await panel.locator('#run-tool').click();
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'processing');
    const chew = await pet.locator('canvas').evaluate(canvas => canvas.toDataURL());
    await pet.waitForFunction(frame => document.querySelector('canvas').toDataURL() !== frame, chew);
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'success');
    await pet.screenshot({ path: `${root}/test-results/f09-success.png`, omitBackground: true });
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'idle');
    await pet.emulateMedia({ reducedMotion: 'reduce' });
    await panel.locator('#draft').fill('[1,]');
    await panel.locator('#run-tool').click();
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'processing');
    const still = await pet.locator('canvas').evaluate(canvas => canvas.toDataURL());
    await pet.waitForTimeout(200);
    assert.equal(await pet.locator('canvas').evaluate(canvas => canvas.toDataURL()), still);
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'failure');
    const failure = await pet.locator('canvas').evaluate(canvas => canvas.toDataURL());
    await pet.waitForTimeout(200);
    assert.equal(await pet.locator('canvas').evaluate(canvas => canvas.toDataURL()), failure);
    assert.notEqual(failure, still);
    await pet.screenshot({ path: `${root}/test-results/f09-failure.png`, omitBackground: true });
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'idle');
    // A newer save takes over the pet; the older conversion timers cannot reset it.
    await panel.locator('#run-tool').click();
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'processing');
    await panel.locator('#feed-text').click();
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'eating');
    await pet.waitForTimeout(850);
    assert.equal(await pet.locator('canvas').getAttribute('data-state'), 'eating');
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'idle');
    await panel.locator('#draft').fill('null');
    await panel.locator('#run-tool').click();
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'processing');
    await panel.locator('#draft').fill('[bad]');
    await panel.locator('#run-tool').click();
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'failure');
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'idle');
  } finally { await app.close(); }
});

test('F10: real TCP listeners show port, PID, name and address; refresh reflects closure', { timeout: 30000 }, async t => {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  t.after(() => { if (server.listening) server.close(); });
  const app = await launch(await profileFor(t));
  try {
    const { pet, panel } = await openPanel(app);
    const errors = [];
    panel.on('pageerror', error => errors.push(error.message));
    const input = '{"keep":"my draft"}';
    await panel.locator('#draft').fill(input);
    await panel.locator('#run-tool').click();
    const result = await panel.locator('#json-output').textContent();
    await panel.locator('#show-ports').click();
    const row = panel.locator(`#port-list li[data-port="${port}"][data-pid="${process.pid}"]`);
    await row.waitFor();
    assert.match(await row.textContent(), new RegExp(`:${port}.*TCP · PID ${process.pid}.*127\\.0\\.0\\.1`, 's'));
    assert.ok((await row.locator('.port-name').textContent()).length > 0);
    assert.equal(await panel.locator('#show-ports').getAttribute('aria-pressed'), 'true');
    assert.equal(await panel.locator('#food-view').isVisible(), false);
    assert.match(await panel.locator('#ports-updated').textContent(), /마지막 조회/);
    assert.equal((await pet.evaluate(() => window.ports.list())).ok, false, 'pet renderer cannot query processes');
    await mkdir(path.join(root, 'test-results'), { recursive: true });
    await panel.screenshot({ path: `${root}/test-results/f10-ports.png` });
    await new Promise(resolve => server.close(resolve));
    await panel.locator('#refresh-ports').click();
    await panel.waitForFunction(() => document.querySelector('#port-list').getAttribute('aria-busy') === 'false');
    assert.equal(await row.count(), 0);
    await panel.keyboard.press('Escape');
    await pet.evaluate(() => window.petPanel.toggle());
    await panel.waitForFunction(() => document.activeElement?.id === 'show-ports');
    assert.equal(await panel.locator('#ports-view').isVisible(), true);
    await panel.locator('#show-food').click();
    assert.equal(await panel.locator('#draft').inputValue(), input);
    assert.equal(await panel.locator('#json-output').textContent(), result);
    assert.equal(await panel.locator('#draft').evaluate(el => document.activeElement === el), true);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('F10: loading, empty lists, partial results, failures and retries preserve the right snapshot', { timeout: 30000 }, async t => {
  const app = await launch(await profileFor(t));
  try {
    const { panel } = await openPanel(app);
    await app.evaluate(({ ipcMain }) => {
      globalThis.portCalls = 0;
      globalThis.portMode = 'pending';
      const good = () => ({ ok: true, value: {
        items: [{ pid: 456, port: 3000, name: '<img src=x onerror=alert(1)>', addresses: [{ family: 'IPv4', address: '127.0.0.1' }] }],
        checkedAt: '2026-10-15T00:00:00.000Z', warning: '일부 항목을 조회하지 못했을 수 있어요.',
      } });
      ipcMain.removeHandler('ports:list');
      ipcMain.handle('ports:list', () => {
        globalThis.portCalls++;
        if (globalThis.portMode === 'pending') return new Promise(resolve => { globalThis.finishPorts = () => resolve(good()); });
        if (globalThis.portMode === 'failure') return { ok: false, error: '포트 조회 시간이 초과됐어요. 다시 시도해 주세요.' };
        return { ok: true, value: { items: [], checkedAt: '2026-10-15T00:00:01.000Z', warning: null } };
      });
    });
    assert.equal(await app.evaluate(() => globalThis.portCalls), 0, 'food view does not scan in the background');
    await panel.locator('#draft').fill('keep this');
    await panel.locator('#show-ports').click();
    assert.equal(await panel.locator('#refresh-ports').isDisabled(), true);
    assert.match(await panel.locator('#port-status').textContent(), /조회하고/);
    await panel.locator('#show-ports').click();
    assert.equal(await app.evaluate(() => globalThis.portCalls), 1, 'repeated navigation shares the pending refresh');
    // The port view does not accidentally turn pasted or dropped text into food.
    await panel.evaluate(() => {
      const data = new DataTransfer();
      data.setData('text/plain', 'not food');
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
    });
    assert.equal((await panel.evaluate(() => window.food.list())).value.length, 0);
    await panel.locator('#show-food').click();
    await app.evaluate(() => globalThis.finishPorts());
    await panel.waitForFunction(() => document.querySelector('#port-list').getAttribute('aria-busy') === 'false');
    assert.equal(await panel.locator('#draft').inputValue(), 'keep this');
    assert.equal(await panel.locator('#draft').evaluate(el => document.activeElement === el), true, 'background completion does not steal focus');
    assert.equal(await panel.locator('#port-list img').count(), 0);
    assert.match(await panel.locator('.port-name').textContent(), /<img/);
    assert.match(await panel.locator('#ports-warning').textContent(), /일부 항목/);
    const timestamp = await panel.locator('#ports-updated').textContent();
    await app.evaluate(() => { globalThis.portMode = 'failure'; });
    await panel.locator('#show-ports').click();
    await panel.waitForFunction(() => document.querySelector('#port-status').classList.contains('error'));
    assert.equal(await panel.locator('#port-list li').count(), 1);
    assert.equal(await panel.locator('#ports-updated').textContent(), timestamp);
    assert.match(await panel.locator('#port-status').textContent(), /이전 조회 결과/);
    assert.equal(await panel.locator('#empty-ports').isVisible(), false);
    assert.equal(await panel.locator('#refresh-ports').isDisabled(), false);
    await app.evaluate(() => { globalThis.portMode = 'empty'; });
    await panel.locator('#refresh-ports').click();
    await panel.waitForFunction(() => !document.querySelector('#empty-ports').hidden);
    assert.equal(await panel.locator('#port-list li').count(), 0);
    assert.match(await panel.locator('#port-status').textContent(), /0개 포트 항목/);
    assert.equal(await panel.locator('#ports-warning').isVisible(), false);
    await panel.screenshot({ path: `${root}/test-results/f10-empty.png` });
    await app.evaluate(() => { globalThis.portMode = 'failure'; });
    await panel.reload();
    await panel.waitForLoadState('load');
    await panel.locator('#show-ports').click();
    await panel.waitForFunction(() => document.querySelector('#port-status').classList.contains('error'));
    assert.doesNotMatch(await panel.locator('#port-status').textContent(), /이전 조회 결과/);
    assert.equal(await panel.locator('#empty-ports').isVisible(), false);
    assert.equal(await panel.locator('#ports-updated').textContent(), '');
  } finally { await app.close(); }
});

test('F11: opens a listed port through the default browser, handles pending launches, failures and refreshes', { timeout: 30000 }, async t => {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  t.after(() => { if (server.listening) server.close(); });
  const app = await launch(await profileFor(t));
  try {
    // Intercept only the OS browser launch boundary so tests never open user tabs.
    await app.evaluate(({ shell }) => {
      globalThis.openedPortUrls = [];
      shell.openExternal = url => {
        globalThis.openedPortUrls.push(url);
        return new Promise((resolve, reject) => {
          globalThis.finishPortOpen = resolve;
          globalThis.failPortOpen = () => reject(new Error('private launch diagnostic'));
        });
      };
    });
    const { pet, panel } = await openPanel(app);
    const errors = [];
    panel.on('pageerror', error => errors.push(error.message));
    const panelUrl = panel.url();
    await panel.locator('#show-ports').click();
    const row = panel.locator(`#port-list li[data-port="${port}"][data-pid="${process.pid}"]`);
    await row.waitFor();
    const button = row.getByRole('button', { name: `${port} 포트 브라우저로 열기`, includeHidden: true });
    const feedback = row.locator('.port-open-status');
    assert.equal(await row.locator('.port-url').textContent(), `http://127.0.0.1:${port}`);
    assert.equal((await pet.evaluate(({ pid, port }) => window.ports.open(pid, port), { pid: process.pid, port })).ok, false);
    assert.deepEqual(await app.evaluate(() => globalThis.openedPortUrls), []);
    await button.focus();
    await panel.keyboard.press('Enter');
    await panel.waitForFunction(() => document.querySelector('.open-port:disabled') !== null);
    assert.match(await feedback.textContent(), /여는 중/);
    assert.equal(await button.isDisabled(), true);
    assert.equal((await panel.evaluate(({ pid, port }) => window.ports.open(pid, port), { pid: process.pid, port })).ok, false);
    assert.deepEqual(await app.evaluate(() => globalThis.openedPortUrls), [`http://127.0.0.1:${port}`]);
    await app.evaluate(() => globalThis.failPortOpen());
    await waitUntil(async () => !(await button.isDisabled()));
    assert.match(await feedback.textContent(), /기본 브라우저를 열지 못/);
    assert.doesNotMatch(await feedback.textContent(), /private/);
    await button.click();
    await app.evaluate(() => globalThis.finishPortOpen());
    await waitUntil(async () => !(await button.isDisabled()));
    assert.match(await feedback.textContent(), /열기를 요청/);
    assert.equal(await feedback.evaluate(el => el.classList.contains('error')), false);
    assert.equal(panel.url(), panelUrl, 'the utility panel must not navigate to the server');
    assert.equal(app.windows().length, 2, 'no embedded browser window');
    await mkdir(path.join(root, 'test-results'), { recursive: true });
    await panel.screenshot({ path: `${root}/test-results/f11-open-port.png` });

    await button.click();
    await panel.locator('#refresh-ports').click();
    await panel.waitForFunction(() => document.querySelector('#port-list').getAttribute('aria-busy') === 'false');
    assert.equal(await button.isDisabled(), true, 'refreshed rows retain the launch lock');
    await panel.locator('#show-food').click();
    await app.evaluate(() => globalThis.finishPortOpen());
    await waitUntil(async () => !(await button.isDisabled()));
    assert.equal(await panel.locator('#draft').evaluate(el => document.activeElement === el), true, 'completion does not steal focus');
    assert.equal(await feedback.textContent(), '', 'old completion does not label a replacement row');
    await new Promise(resolve => server.close(resolve));
    await panel.locator('#show-ports').click();
    await panel.waitForFunction(() => document.querySelector('#port-list').getAttribute('aria-busy') === 'false');
    assert.equal(await row.count(), 0);
    assert.equal((await panel.evaluate(({ pid, port }) => window.ports.open(pid, port), { pid: process.pid, port })).ok, false);
    assert.equal((await app.evaluate(() => globalThis.openedPortUrls)).length, 3);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});


async function processServer(t, ignoreTermination = false) {
  const child = spawn(process.execPath, ['-e', `
    const net = require('node:net');
    const servers = [net.createServer(), net.createServer()];
    Promise.all(servers.map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))))
      .then(() => process.send(servers.map(server => server.address().port)));
    process.on('SIGTERM', () => { if (!${ignoreTermination}) setTimeout(() => process.exit(0), 500); });
  `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; });
  const ports = await new Promise((resolve, reject) => {
    child.once('message', resolve);
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Test server exited before listening')));
  });
  return { child, ports, exited };
}

test('F12: confirms the process, cancels safely, terminates an owned test server and refreshes every port', { timeout: 30000 }, async t => {
  const { child, ports, exited } = await processServer(t);
  const app = await launch(await profileFor(t));
  try {
    await app.evaluate(({ dialog }, pid) => {
      globalThis.terminationDialogs = [];
      dialog.showMessageBox = (_panel, options) => {
        if (!options.detail.includes(`PID ${pid}\n`)) throw new Error('Unexpected termination target');
        globalThis.terminationDialogs.push(options);
        return new Promise(resolve => { globalThis.answerTermination = response => resolve({ response }); });
      };
    }, child.pid);
    const { pet, panel } = await openPanel(app);
    await panel.locator('#show-ports').click();
    const row = panel.locator(`#port-list li[data-pid="${child.pid}"][data-port="${ports[0]}"]`);
    await row.waitFor();
    const stop = row.locator('.terminate-port');
    assert.equal(await stop.isDisabled(), false);
    const target = { pid: child.pid, port: ports[0] };
    assert.equal((await pet.evaluate(x => window.ports.terminate(x.pid, x.port), target)).ok, false);
    assert.equal((await panel.evaluate(() => window.ports.terminate(-1, 3000))).ok, false);
    await stop.click();
    await waitUntil(async () => (await app.evaluate(() => globalThis.terminationDialogs.length)) === 1);
    const detail = await app.evaluate(() => globalThis.terminationDialogs[0]);
    assert.equal(detail.defaultId, 0);
    assert.equal(detail.cancelId, 0);
    assert.deepEqual(detail.buttons, ['취소', '프로세스 종료']);
    for (const port of ports) assert.ok(detail.detail.includes(String(port)));
    assert.ok(detail.detail.includes(`PID ${child.pid}`));
    assert.equal((await panel.evaluate(x => window.ports.terminate(x.pid, x.port), target)).ok, false);
    assert.equal(await panel.locator('#refresh-ports').isDisabled(), true);
    await app.evaluate(() => globalThis.answerTermination(0));
    await waitUntil(async () => !(await stop.isDisabled()));
    assert.match(await panel.locator('#port-action-status').textContent(), /취소/);
    assert.equal(child.exitCode, null);
    assert.equal(await pet.locator('canvas').getAttribute('data-state'), null);

    await stop.click();
    await waitUntil(async () => (await app.evaluate(() => globalThis.terminationDialogs.length)) === 2);
    await app.evaluate(() => globalThis.answerTermination(1));
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'attack');
    await mkdir(path.join(root, 'test-results'), { recursive: true });
    await pet.screenshot({ path: `${root}/test-results/f12-attack.png` });
    await exited;
    await panel.waitForFunction(() => document.querySelector('#port-action-status').textContent.includes('프로세스를 종료했어요'));
    await panel.waitForFunction(() => document.querySelector('#port-list').getAttribute('aria-busy') === 'false');
    assert.equal(await panel.locator(`#port-list li[data-pid="${child.pid}"]`).count(), 0);
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'success');
    assert.match(await pet.locator('#pet-message').textContent(), /프로세스를 종료/);
    await panel.screenshot({ path: `${root}/test-results/f12-terminated.png` });
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'idle');
  } finally { await app.close(); }
});

test('F12: unresponsive servers report failure without force kill; an already exited process refreshes away', { timeout: 30000 }, async t => {
  const { child, ports, exited } = await processServer(t, true);
  const app = await launch(await profileFor(t));
  try {
    await app.evaluate(({ dialog }, pid) => {
      dialog.showMessageBox = async (_panel, options) => {
        if (!options.detail.includes(`PID ${pid}\n`)) throw new Error('Unexpected termination target');
        return { response: 1 };
      };
    }, child.pid);
    const { pet, panel } = await openPanel(app);
    await pet.emulateMedia({ reducedMotion: 'reduce' });
    await panel.locator('#show-ports').click();
    const row = panel.locator(`#port-list li[data-pid="${child.pid}"][data-port="${ports[0]}"]`);
    await row.waitFor();
    await row.locator('.terminate-port').click();
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'attack');
    const frame = await pet.locator('canvas').evaluate(canvas => canvas.toDataURL());
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(await pet.locator('canvas').evaluate(canvas => canvas.toDataURL()), frame, 'reduced motion keeps the attack static');
    await panel.waitForFunction(() => document.querySelector('#port-action-status').textContent.includes('아직 실행 중'));
    await panel.waitForFunction(() => document.querySelector('#port-list').getAttribute('aria-busy') === 'false');
    assert.equal(await row.count(), 1);
    assert.equal(child.exitCode, null);
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'failure');
    assert.match(await pet.locator('#pet-message').textContent(), /종료 결과/);
    await panel.screenshot({ path: `${root}/test-results/f12-timeout.png` });
    child.kill('SIGKILL'); // Only this test's own deliberately unresponsive child.
    await exited;
    await row.locator('.terminate-port').click();
    await panel.waitForFunction(() => document.querySelector('#port-action-status').textContent.includes('이미 종료'));
    await panel.waitForFunction(() => document.querySelector('#port-list').getAttribute('aria-busy') === 'false');
    assert.equal(await panel.locator(`#port-list li[data-pid="${child.pid}"]`).count(), 0);
  } finally { await app.close(); }
});

async function setModule(panel, key, enabled) {
  await panel.locator('#show-settings').click();
  await panel.locator(`#module-${key}`).setChecked(enabled);
  await panel.waitForFunction(() => !document.querySelector('#module-m01').disabled);
}

test('F13: module switches stop food tools and timers, retain drafts and shelf, and persist across restart', { timeout: 30000 }, async t => {
  const profile = await profileFor(t);
  let app = await launch(profile);
  try {
    const { pet, panel } = await openPanel(app);
    const errors = [];
    panel.on('pageerror', error => errors.push(error.message));
    await panel.evaluate(() => {
      const start = window.setInterval; const stop = window.clearInterval;
      window.moduleIntervals = new Set();
      window.setInterval = (...args) => { const id = start(...args); window.moduleIntervals.add(id); return id; };
      window.clearInterval = id => { window.moduleIntervals.delete(id); stop(id); };
    });
    assert.equal((await pet.evaluate(() => window.modules.set('m01', false))).ok, false);
    const saved = await panel.evaluate(() => window.food.saveText('keep this food'));
    assert.equal(saved.ok, true);
    const token = jwtToken({ exp: Math.floor(Date.now() / 1000) + 300 });
    await panel.locator('#draft').fill(token);
    await panel.locator('#run-tool').click();
    assert.equal(await panel.evaluate(() => window.moduleIntervals.size), 1);
    await setModule(panel, 'm01', false);
    assert.equal(await panel.evaluate(() => window.moduleIntervals.size), 0);
    assert.equal(await panel.locator('#jwt-result').isVisible(), false);
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'idle');
    assert.equal((await panel.evaluate(() => window.food.saveText('blocked'))).ok, false);
    assert.equal((await pet.evaluate(() => window.food.saveFiles([new File(['x'], 'blocked.txt')]))).ok, false);
    assert.equal((await panel.evaluate(() => window.resultTools.copy('blocked'))).ok, false);
    assert.equal((await panel.evaluate(() => window.food.list())).ok, false);
    assert.equal((await panel.evaluate(() => window.ports.list())).ok, true, 'M02 remains independent');
    await panel.evaluate(() => document.querySelector('#run-tool').click());
    assert.equal(await panel.locator('#jwt-result').isVisible(), false);
    await pet.evaluate(() => {
      const data = new DataTransfer(); data.setData('text/plain', 'ignored paste');
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await panel.locator('#show-food').click();
    assert.equal(await panel.locator('#module-off').isVisible(), true);
    assert.equal(await panel.locator('#draft').inputValue(), token);
    await panel.locator('#enable-module').click();
    await panel.screenshot({ path: `${root}/test-results/f13-settings.png` });
    await setModule(panel, 'm01', true);
    await panel.locator('#show-food').click();
    await panel.waitForFunction(() => document.querySelectorAll('#food-list li').length === 1);
    assert.equal(await panel.locator('#draft').inputValue(), token);
    assert.equal(await panel.evaluate(() => window.moduleIntervals.size), 0, 'old JWT result and timer do not resume');
    assert.equal((await panel.evaluate(() => window.food.list())).value.length, 1);
    await setModule(panel, 'm02', false);
    for (const result of await panel.evaluate(async () => [await window.ports.list(), await window.ports.open(1, 3000), await window.ports.terminate(1, 3000)])) assert.equal(result.ok, false);
    assert.equal((await panel.evaluate(() => window.food.list())).ok, true);
    await setModule(panel, 'm01', false);
    assert.deepEqual(JSON.parse(await readFile(path.join(profile, 'modules.json'), 'utf8')).modules, { m01: false, m02: false });
    assert.deepEqual(errors, []);
    await app.close();
    app = await launch(profile);
    const newPet = await app.firstWindow();
    await newPet.waitForLoadState('load');
    const opened = app.waitForEvent('window');
    await newPet.evaluate(() => window.petPanel.toggle());
    const restored = await opened;
    await restored.waitForLoadState('load');
    await restored.locator('#module-off').waitFor();
    assert.equal((await restored.evaluate(() => window.food.list())).ok, false);
    assert.equal((await restored.evaluate(() => window.ports.list())).ok, false);
    await restored.locator('#show-settings').click();
    assert.equal(await restored.locator('#module-m01').isChecked(), false);
    assert.equal(await restored.locator('#module-m02').isChecked(), false);
    await setModule(restored, 'm01', true);
    assert.equal((await restored.evaluate(() => window.food.list())).value.length, 1);
  } finally { await app.close(); }
});

test('F13: corrupt settings show a warning and failed writes preserve the current runtime and saved settings', { timeout: 30000 }, async t => {
  const profile = await profileFor(t);
  await writeFile(path.join(profile, 'modules.json'), '{broken');
  const app = await launch(profile);
  try {
    const { panel } = await openPanel(app);
    await panel.locator('#show-settings').click();
    assert.match(await panel.locator('#settings-status').textContent(), /기본값/);
    await setModule(panel, 'm02', false);
    const saved = await readFile(path.join(profile, 'modules.json'), 'utf8');
    const pid = await app.evaluate(() => process.pid);
    const blocked = path.join(profile, `modules.json.${pid}.tmp`);
    await mkdir(blocked);
    await panel.locator('#module-m01').click();
    await panel.waitForFunction(() => !document.querySelector('#module-m01').disabled);
    assert.equal(await panel.locator('#module-m01').isChecked(), true);
    assert.match(await panel.locator('#settings-status').textContent(), /저장하지 못/);
    assert.equal(await panel.locator('#settings-status').evaluate(el => el.classList.contains('error')), true);
    assert.equal((await panel.evaluate(() => window.food.list())).ok, true);
    assert.equal((await panel.evaluate(() => window.ports.list())).ok, false);
    assert.equal(await readFile(path.join(profile, 'modules.json'), 'utf8'), saved);
    await rm(blocked, { recursive: true });
    await setModule(panel, 'm01', false);
    assert.equal(await panel.locator('#module-m01').isChecked(), false);
    assert.match(await panel.locator('#settings-status').textContent(), /저장했어요/);
  } finally { await app.close(); }
});

test('F13: turning food off cancels an in-flight write and late completion preserves the draft', { timeout: 30000 }, async t => {
  const profile = await profileFor(t);
  const app = await launch(profile);
  try {
    const { pet, panel } = await openPanel(app);
    await app.evaluate(async () => {
      const fs = process.getBuiltinModule('fs/promises');
      const write = fs.writeFile;
      fs.writeFile = async (...args) => {
        if (String(args[0]).endsWith('text.txt') && args[1] === 'cancel pending food') {
          globalThis.pendingFoodSignal = args[2].signal;
          await new Promise(resolve => { globalThis.releasePendingFood = resolve; });
        }
        return write(...args);
      };
    });
    await panel.locator('#draft').fill('cancel pending food');
    await panel.locator('#feed-text').click();
    await waitUntil(() => app.evaluate(() => Boolean(globalThis.releasePendingFood)));
    await setModule(panel, 'm01', false);
    assert.equal(await app.evaluate(() => globalThis.pendingFoodSignal.aborted), true);
    await setModule(panel, 'm01', true);
    await app.evaluate(() => globalThis.releasePendingFood());
    await waitUntil(async () => !(await readdir(path.join(profile, 'food'))).some(name => name.startsWith('.pending-')));
    await panel.locator('#show-food').click();
    assert.equal(await panel.locator('#draft').inputValue(), 'cancel pending food');
    assert.equal((await panel.evaluate(() => window.food.list())).value.length, 0);
    assert.equal(await pet.locator('canvas').getAttribute('data-state'), 'idle');
    await panel.locator('#feed-text').click();
    // The second save has its own signal and can complete after re-enabling.
    await waitUntil(() => app.evaluate(() => !globalThis.pendingFoodSignal.aborted));
    await app.evaluate(() => globalThis.releasePendingFood());
    await panel.waitForFunction(() => document.querySelector('#draft').value === '');
    assert.equal((await panel.evaluate(() => window.food.list())).value.length, 1);
  } finally { await app.close(); }
});

test('F13: disabling ports aborts a pending confirmation and ignores stale list responses after re-enable', { timeout: 30000 }, async t => {
  const { child, ports } = await processServer(t);
  const app = await launch(await profileFor(t));
  try {
    await app.evaluate(({ dialog }, pid) => {
      dialog.showMessageBox = (_panel, options) => {
        if (!options.detail.includes(`PID ${pid}\n`)) throw new Error('Unexpected target');
        globalThis.pendingConfirmation = options.signal;
        return new Promise(resolve => options.signal.addEventListener('abort', () => resolve({ response: 0 }), { once: true }));
      };
    }, child.pid);
    const { pet, panel } = await openPanel(app);
    await panel.locator('#show-ports').click();
    const row = panel.locator(`#port-list li[data-pid="${child.pid}"][data-port="${ports[0]}"]`);
    await row.waitFor();
    await row.locator('.terminate-port').click();
    await waitUntil(() => app.evaluate(() => Boolean(globalThis.pendingConfirmation)));
    await setModule(panel, 'm02', false);
    assert.equal(await app.evaluate(() => globalThis.pendingConfirmation.aborted), true);
    assert.equal(child.exitCode, null);
    await setModule(panel, 'm02', true);
    await app.evaluate(({ ipcMain }) => {
      globalThis.delayedPortCalls = 0;
      ipcMain.removeHandler('ports:list');
      ipcMain.handle('ports:list', () => {
        globalThis.delayedPortCalls++;
        if (globalThis.delayedPortCalls === 1) return new Promise(resolve => { globalThis.finishOldPorts = () => resolve({ ok: true, value: { items: [], checkedAt: '2000-01-01T00:00:00Z' } }); });
        return { ok: true, value: { items: [], checkedAt: '2026-10-15T00:00:00Z' } };
      });
    });
    await panel.locator('#show-ports').click();
    await waitUntil(() => app.evaluate(() => Boolean(globalThis.finishOldPorts)));
    await setModule(panel, 'm02', false);
    await panel.locator('#show-ports').click();
    assert.equal(await app.evaluate(() => globalThis.delayedPortCalls), 1);
    await setModule(panel, 'm02', true);
    await panel.locator('#show-ports').click();
    await panel.waitForFunction(() => document.querySelector('#port-list').getAttribute('aria-busy') === 'false');
    const updated = await panel.locator('#ports-updated').textContent();
    await app.evaluate(() => globalThis.finishOldPorts());
    assert.equal(await panel.locator('#ports-updated').textContent(), updated);
    assert.equal(await panel.locator('#refresh-ports').isDisabled(), false);
    assert.equal(await panel.locator('#port-action-status').textContent(), '');
    await app.evaluate(({ BrowserWindow }) => {
      const pet = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet');
      pet.webContents.send('ports:reaction', { id: 'message-lifecycle', phase: 'attack' });
      pet.webContents.send('ports:reaction', { id: 'message-lifecycle', phase: 'success' });
    });
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'success');
    await pet.waitForFunction(() => document.querySelector('canvas').dataset.state === 'idle');
    await setModule(panel, 'm01', false);
    assert.equal(await pet.locator('#pet-message').isVisible(), true, 'M01 does not clear an M02 message');
    await setModule(panel, 'm02', false);
    await pet.waitForFunction(() => document.querySelector('#pet-message').hidden);
  } finally { await app.close(); }
});

test('Panel: compact views resize within the display, preserve drafts, and keep navigation reachable', { timeout: 30000 }, async t => {
  const app = await launch(await profileFor(t));
  try {
    const { pet, panel } = await openPanel(app);
    const panelBounds = () => app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet 유틸리티');
      return { bounds: win.getBounds(), area: screen.getDisplayMatching(win.getBounds()).workArea };
    });
    async function expectHeight(height) {
      await waitUntil(async () => {
        const { bounds, area } = await panelBounds();
        return bounds.height === Math.min(height, area.height - 10);
      });
      const { bounds, area } = await panelBounds();
      assert.ok(bounds.x >= area.x && bounds.y >= area.y);
      assert.ok(bounds.x + bounds.width <= area.x + area.width);
      assert.ok(bounds.y + bounds.height <= area.y + area.height);
      assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await expectHeight(588);
    const shape = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet 유틸리티');
      const capture = await win.capturePage();
      const pixels = capture.toBitmap();
      const { width, height } = capture.getSize();
      const alpha = (x, y) => pixels[(y * width + x) * 4 + 3];
      return { cornerAlpha: pixels[3], outsideRoofAlpha: alpha(Math.floor(width * .1), Math.floor(height * .04)), hasOpaqueSurface: pixels.some((value, index) => index % 4 === 3 && value === 255) };
    });
    assert.equal(shape.cornerAlpha, 0, 'the house has real native transparency outside its outline');
    assert.equal(shape.outsideRoofAlpha, 0, 'the area above the roof slope has no window background');
    assert.equal(shape.hasOpaqueSurface, true, 'the menu itself remains opaque and readable');

    await mkdir(path.join(root, 'test-results'), { recursive: true });
    await panel.screenshot({ path: path.join(root, 'test-results/panel-food.png') });
    await panel.locator('#draft').fill('{"project":"BytePet","enabled":true}');
    await panel.locator('#run-tool').click();
    assert.ok((await panel.locator('.toolbar').boundingBox()).y >= 0);
    await panel.screenshot({ path: path.join(root, 'test-results/panel-result.png') });
    await panel.locator('#show-settings').click();
    await expectHeight(530);
    assert.equal(await panel.locator('#character-picker button[aria-pressed="true"]').evaluate(el => el === document.activeElement), true);
    await panel.screenshot({ path: path.join(root, 'test-results/panel-settings.png') });
    await pet.evaluate(() => window.utilityPanel.setView('food'));
    await panel.evaluate(() => window.utilityPanel.setView('invalid'));
    assert.equal((await panelBounds()).bounds.height, Math.min(530, (await panelBounds()).area.height - 10));

    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('ports:list');
      ipcMain.handle('ports:list', () => ({ ok: true, value: {
        checkedAt: new Date().toISOString(),
        items: Array.from({ length: 12 }, (_, index) => ({
          port: 3000 + index, pid: 9000 + index, name: index ? 'node' : 'development-server-with-a-long-name',
          addresses: [{ family: 'IPv4', address: '127.0.0.1' }, { family: 'IPv6', address: '::1' }],
          url: `http://127.0.0.1:${3000 + index}/`,
        })),
      } }));
    });
    await panel.locator('#show-ports').click();
    await expectHeight(588);
    await panel.waitForFunction(() => document.querySelectorAll('#port-list li').length === 12);
    await panel.locator('.port-details summary').first().click();
    assert.equal(await panel.locator('.port-addresses').first().isVisible(), true);
    await panel.screenshot({ path: path.join(root, 'test-results/panel-ports.png') });
    await panel.evaluate(() => { const content = document.querySelector('.content'); content.scrollTo(0, content.scrollHeight); });
    assert.ok((await panel.locator('.toolbar').boundingBox()).y >= 0);
    await panel.locator('#show-food').click();
    assert.equal(await panel.locator('#draft').inputValue(), '{"project":"BytePet","enabled":true}');
    assert.equal(await panel.locator('#json-result').isVisible(), true);
    await panel.locator('#feed-text').click();
    await panel.waitForFunction(() => document.querySelectorAll('#food-list li').length === 1);
    await panel.screenshot({ path: path.join(root, 'test-results/panel-shelf.png') });
    await setModule(panel, 'm01', false);
    await panel.locator('#show-food').click();
    await expectHeight(298);
    assert.equal(await panel.locator('#enable-module').isVisible(), true);
    await panel.locator('#close').click();
    await pet.evaluate(() => window.petPanel.toggle());
    await expectHeight(298);
    await panel.locator('#enable-module').click();
    await expectHeight(530);
  } finally { await app.close(); }
});

test('Layout: cat stays still, left/right and ground switches apply immediately and survive restart', { timeout: 30000 }, async t => {
  const profile = await profileFor(t);
  let app = await launch(profile);
  try {
    let { pet, panel } = await openPanel(app);
    await panel.locator('#draft').fill('keep this draft');
    await panel.locator('#close').click();
    await pet.emulateMedia({ reducedMotion: 'no-preference' });
    await pet.mouse.move(4, 4);
    const initial = await pet.locator('#pet').boundingBox();
    const anchor = await bounds(app);
    await pet.waitForTimeout(3000);
    assert.deepEqual(await pet.locator('#pet').boundingBox(), initial, 'no autonomous travel');
    assert.deepEqual(await bounds(app), anchor);
    await pet.evaluate(() => window.petPanel.toggle());
    await panel.locator('#show-settings').click();
    assert.equal((await pet.evaluate(() => window.appearance.set('ground', false))).ok, false, 'pet cannot change settings');
    assert.equal((await panel.evaluate(() => window.appearance.set('menuSide', 'anywhere'))).ok, false);

    await panel.locator('#menu-side').selectOption('right');
    await panel.waitForFunction(() => !document.querySelector('#menu-side').disabled && document.querySelector('#appearance-status').textContent.includes('저장했어요'));
    assert.equal(await pet.locator('#pet').evaluate(el => el.getBoundingClientRect().x), 16);
    let house = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet 유틸리티').getBounds());
    let yard = await bounds(app);
    assert.equal(house.x + house.width, yard.x + yard.width);
    assert.equal(house.y + house.height - 10, yard.y + yard.height - 20);
    await panel.locator('#show-ground').uncheck();
    await pet.waitForFunction(() => innerWidth === 128 && document.querySelector('#yard-ground').hidden);
    house = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet 유틸리티').getBounds());
    yard = await bounds(app);
    assert.equal(house.x, yard.x + yard.width + 8);
    assert.deepEqual(JSON.parse(await readFile(path.join(profile, 'appearance.json'), 'utf8')), { version: 1, preferences: { ground: false, menuSide: 'right', character: 'cat-cheese' } });
    await panel.locator('#show-food').click();
    assert.equal(await panel.locator('#draft').inputValue(), 'keep this draft');
    await app.close();

    app = await launch(profile);
    ({ pet, panel } = await openPanel(app));
    assert.equal((await bounds(app)).width, 128);
    assert.equal(await pet.locator('#yard-ground').isVisible(), false);
    await panel.locator('#show-settings').click();
    assert.equal(await panel.locator('#menu-side').inputValue(), 'right');
    assert.equal(await panel.locator('#show-ground').isChecked(), false);
    await panel.locator('#show-ground').check();
    await pet.waitForFunction(() => innerWidth === 496 && !document.querySelector('#yard-ground').hidden);
    await panel.locator('#menu-side').selectOption('left');
    await pet.waitForFunction(() => document.querySelector('#pet').getBoundingClientRect().x === innerWidth - 112);
    house = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet 유틸리티').getBounds());
    yard = await bounds(app);
    assert.equal(house.x, yard.x);
    await mkdir(path.join(root, 'test-results'), { recursive: true });
    await panel.screenshot({ path: path.join(root, 'test-results/layout-settings.png'), omitBackground: true });
    await panel.locator('#close').click();
    const beforeDrag = await bounds(app);
    await pet.mouse.move(220, 115);
    await pet.mouse.down();
    await pet.mouse.move(200, 105);
    await waitUntil(async () => (await bounds(app)).x < beforeDrag.x);
    await pet.mouse.up();
    assert.equal(await pet.locator('#pet').getAttribute('aria-expanded'), 'false');
    await pet.screenshot({ path: path.join(root, 'test-results/yard-static.png'), omitBackground: true });
  } finally { await app.close(); }
});
