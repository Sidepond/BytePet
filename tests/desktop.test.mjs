import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));

test('F01: native transparent pet, idle playback, reduced motion, and clean exit', { timeout: 30000 }, async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [root], cwd: root, env });
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
