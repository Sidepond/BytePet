import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
async function fillFood(panel, text) {
  if (!(await panel.locator('#food-composer').evaluate(el => el.open))) await panel.locator('#food-composer > summary').click();
  await panel.locator('#draft').fill(text);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const menu = (app, id) => app.evaluate(({ Menu }, id) => Menu.getApplicationMenu().getMenuItemById(id).click(), id);
async function fixture(t) {
  const profile = await mkdtemp(path.join(tmpdir(), 'bytepet-app-prefs-'));
  await writeFile(path.join(profile, 'ai-usage.json'), JSON.stringify({ version: 1, preferences: { codex: false, claude: false, badgeMode: 'hidden', badgePosition: 'top', badgeWindow: 'primary' } }));
  t.after(() => rm(profile, { recursive: true, force: true }));
  const app = await electron.launch({ args: [root, `--user-data-dir=${profile}`], env, cwd: root });
  const pet = await app.firstWindow();
  await pet.waitForFunction(() => document.querySelector('#pet')?.dataset.character);
  return { profile, app, pet };
}
async function settings(app) {
  const opened = app.waitForEvent('window');
  await menu(app, 'open-settings');
  const panel = await opened;
  await panel.locator('#settings-view').waitFor();
  await panel.waitForFunction(() => document.querySelector('#app-version').textContent.includes('0.1.0'));
  return panel;
}

test('Convenience: settings shortcut, version, dev login guard, hidden recovery, position persistence and drafts', { timeout: 45000 }, async t => {
  const f = await fixture(t); let app = f.app;
  try {
    const panel = await settings(app);
    assert.equal(await panel.locator('#open-at-login').isDisabled(), true);
    assert.match(await panel.locator('#login-hint').textContent(), /앱으로 실행/);
    assert.equal((await f.pet.evaluate(() => window.appPreferences.resetPosition())).ok, false);
    assert.equal((await f.pet.evaluate(() => window.appPreferences.setLogin(true))).ok, false);
    assert.equal(await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('open-settings').accelerator), 'CommandOrControl+,');
    await panel.locator('#show-food').click();
    await fillFood(panel, '되돌려도 남아 있어야 하는 메모');
    await panel.locator('#draft').evaluate(el => { el.readOnly = true; });
    await panel.evaluate(() => window.appearance.set('ground', false));
    await panel.evaluate(() => window.appearance.set('menuSide', 'right'));
    await panel.evaluate(() => window.appearance.set('character', 'cat-black'));
    await app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'BytePet');
      const area = screen.getPrimaryDisplay().workArea; win.setPosition(area.x + 400, area.y + 150);
    });
    await menu(app, 'toggle-pet-visibility');
    await menu(app, 'open-settings');
    await panel.locator('#settings-view').waitFor();
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(w => w.isVisible())), true);
    await panel.locator('#reset-position').click();
    await panel.waitForFunction(() => document.querySelector('#position-status').textContent.includes('옮겼어요'));
    const snapshot = await app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'BytePet');
      return { bounds: win.getBounds(), area: screen.getPrimaryDisplay().workArea };
    });
    assert.ok(snapshot.bounds.x >= snapshot.area.x && snapshot.bounds.x + snapshot.bounds.width <= snapshot.area.x + snapshot.area.width);
    assert.equal(snapshot.bounds.y, snapshot.area.y + snapshot.area.height - 128 - 24);
    assert.equal(snapshot.bounds.width, 128);
    assert.equal((await panel.evaluate(() => window.appearance.get())).value.preferences.character, 'cat-black');
    await panel.locator('#show-food').click();
    assert.equal(await panel.locator('#draft').inputValue(), '되돌려도 남아 있어야 하는 메모');
    await panel.locator('#close').click();
    await menu(app, 'toggle-pet-visibility');
    await menu(app, 'reset-pet-position');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'BytePet').isVisible()), true);
    const expected = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'BytePet').getBounds());
    await app.close(); app = null;
    const saved = JSON.parse(await readFile(path.join(f.profile, 'pet-position.json'), 'utf8'));
    assert.equal(saved.x, expected.x); assert.equal(saved.y, expected.y);
    app = await electron.launch({ args: [root, `--user-data-dir=${f.profile}`], env, cwd: root });
    await (await app.firstWindow()).waitForLoadState('load');
    const restored = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'BytePet').getBounds());
    assert.deepEqual(restored, expected);
  } finally { if (app) await app.close(); }
});

test('Convenience: native login boundary, external approval refresh and copy feedback in actual settings UI', { timeout: 30000 }, async t => {
  const { app } = await fixture(t);
  try {
    // Native registration/clipboard are mocked before any preference action.
    // No actual login item or user clipboard is changed by this test.
    await app.evaluate(({ app, clipboard }) => {
      Object.defineProperty(app, 'isPackaged', { value: true });
      const hasSwitch = app.commandLine.hasSwitch.bind(app.commandLine);
      app.commandLine.hasSwitch = key => key === 'user-data-dir' ? false : hasSwitch(key);
      globalThis.loginState = { openAtLogin: false, status: 'not-registered' };
      app.getLoginItemSettings = () => globalThis.loginState;
      app.setLoginItemSettings = ({ openAtLogin }) => { globalThis.loginState = { openAtLogin, status: openAtLogin ? 'enabled' : 'not-registered' }; };
      clipboard.writeText = async text => { globalThis.copiedInfo = text; };
    });
    const panel = await settings(app);
    await panel.locator('#open-at-login').check();
    await panel.waitForFunction(() => !document.querySelector('#open-at-login').disabled);
    assert.equal(await panel.locator('#open-at-login').isChecked(), true);
    await app.evaluate(() => { globalThis.loginState = { openAtLogin: false, status: 'requires-approval' }; });
    await panel.locator('#show-food').click(); await panel.locator('#show-settings').click();
    await panel.waitForFunction(() => document.querySelector('#login-hint').textContent.includes('허용해'));
    await panel.locator('#open-at-login').uncheck();
    await panel.waitForFunction(() => !document.querySelector('#open-at-login').disabled);
    assert.equal(await panel.locator('#open-at-login').isChecked(), false);
    await panel.locator('#copy-app-info').click();
    await panel.waitForFunction(() => document.querySelector('#app-preferences-status').textContent.includes('복사했어요'));
    assert.match(await app.evaluate(() => globalThis.copiedInfo), /^BytePet 0\.1\.0\nmacOS/);
    await app.evaluate(({ app }) => { app.setLoginItemSettings = () => { throw new Error('denied'); }; });
    await panel.locator('#open-at-login').click();
    await panel.waitForFunction(() => document.querySelector('#app-preferences-status').classList.contains('error'));
    assert.equal(await panel.locator('#open-at-login').isChecked(), false);
    await panel.screenshot({ path: '/tmp/bytepet-convenience-settings.png', omitBackground: true });
  } finally { await app.close(); }
});
