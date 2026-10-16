import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import spriteManifest from '../desktop/sprite-manifest.js';

const exec = promisify(execFile);
async function fillFood(panel, text) {
  if (!(await panel.locator('#food-composer').evaluate(el => el.open))) await panel.locator('#food-composer > summary').click();
  await panel.locator('#draft').fill(text);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = process.env.BYTEPET_PACKAGE_TEST_BUNDLE ?? path.join(root, 'dist', `BytePet-darwin-${process.arch}`, 'BytePet.app');
const expectedVersion = process.env.BYTEPET_PACKAGE_TEST_VERSION ?? JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const executablePath = path.join(bundle, 'Contents/MacOS/BytePet');
const devExecutable = createRequire(import.meta.url)('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

async function waitUntil(check) {
  const deadline = Date.now() + 5000;
  while (!(await check())) {
    if (Date.now() > deadline) assert.fail('Timed out waiting for packaged app state');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

test('Package: macOS bundle identity, icon and local signature are valid', { skip: process.platform !== 'darwin' }, async () => {
  const { stdout } = await exec('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(bundle, 'Contents/Info.plist')]);
  const info = JSON.parse(stdout);
  assert.equal(info.CFBundleIdentifier, 'app.bytepet.desktop');
  assert.equal(info.CFBundleName, 'BytePet');
  assert.equal(info.CFBundleDisplayName, 'BytePet');
  assert.equal(info.CFBundleExecutable, 'BytePet');
  assert.equal(info.CFBundleShortVersionString, expectedVersion);
  assert.ok((await stat(path.join(bundle, 'Contents/Resources', info.CFBundleIconFile))).size > 0);
  assert.deepEqual(await readFile(path.join(bundle, 'Contents/Resources', info.CFBundleIconFile)),
    await readFile(path.join(root, 'build/BytePet.icns')), 'bundle uses the BytePet artwork instead of the Electron icon');
  await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
});

test('Package: standalone app preserves development data and restores the existing instance on relaunch', {
  skip: process.platform !== 'darwin', timeout: 45000,
}, async () => {
  const profile = await realpath(await mkdtemp(path.join(tmpdir(), 'bytepet-package-test-')));
  await writeFile(path.join(profile, 'ai-usage.json'), JSON.stringify({ version: 1, preferences: { codex: false, claude: false, badgeMode: 'hidden', badgePosition: 'top', badgeWindow: 'primary' } }));
  let application;
  try {
    // Seed a real development profile, then open it through the standalone app.
    application = await electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root, env });
    let pet = await application.firstWindow();
    await pet.waitForLoadState('load');
    let opened = application.waitForEvent('window');
    await pet.evaluate(() => window.petPanel.toggle());
    let panel = await opened;
    await panel.waitForLoadState('load');
    assert.equal((await panel.evaluate(() => window.appearance.set('ground', false))).ok, true);
    assert.equal((await panel.evaluate(() => window.food.saveText('개발 앱에서 저장한 먹이'))).ok, true);
    await application.close();

    application = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], cwd: tmpdir(), env });
    pet = await application.firstWindow();
    await pet.waitForLoadState('load');
    const identity = await application.evaluate(({ app, BrowserWindow }) => ({
      packaged: app.isPackaged, name: app.getName(), profile: app.getPath('userData'),
      width: BrowserWindow.getAllWindows()[0].getBounds().width,
      files: process.getBuiltinModule('fs').readdirSync(app.getAppPath()).sort(),
    }));
    assert.deepEqual(identity, { packaged: true, name: 'BytePet', profile, width: 128, files: ['desktop', 'package.json'] });
    const spriteSizes = await pet.evaluate(async () => {
      const { default: manifest } = await import('./sprite-manifest.js');
      return Promise.all(Object.values(manifest).flatMap(character => Object.values(character.actions)).map(async ({ file }) => {
        const image = new Image(); image.src = file; await image.decode();
        return [image.naturalWidth, image.naturalHeight];
      }));
    });
    assert.deepEqual(spriteSizes, Object.values(spriteManifest).flatMap(pet => Object.values(pet.actions).map(() => [384, 192])), 'all sprites load from the standalone archive');
    opened = application.waitForEvent('window');
    await pet.evaluate(() => window.petPanel.toggle());
    panel = await opened;
    await panel.waitForLoadState('load');
    const appPreferences = await panel.evaluate(() => window.appPreferences.get());
    assert.equal(appPreferences.ok, true);
    assert.equal(appPreferences.value.info.packaged, true);
    assert.equal(appPreferences.value.info.version, expectedVersion);
    assert.equal(appPreferences.value.login.available, false, 'isolated package tests never alter system login items');
    await panel.locator('.item-name').filter({ hasText: '개발 앱에서 저장한 먹이' }).waitFor();
    await fillFood(panel, '중복 실행 후에도 유지할 초안');
    // Relaunch raises a real native window. Keep unrelated keyboard/IME input
    // from altering the seeded draft during the persistence assertion.
    await panel.locator('#draft').evaluate(draft => { draft.readOnly = true; });

    for (const [executable, args] of [[executablePath, []], [devExecutable, [root]]]) {
      await application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('toggle-pet-visibility').click());
      assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(win => win.isVisible())), false);
      // Execute the binary directly to exercise the lock even when Launch
      // Services would normally turn a second Finder launch into activation.
      await exec(executable, [...args, `--user-data-dir=${profile}`], { env, cwd: tmpdir(), timeout: 10000 });
      await waitUntil(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(win => win.isVisible())));
      assert.equal(application.windows().length, 2);
      assert.equal(await panel.locator('#draft').inputValue(), '중복 실행 후에도 유지할 초안');
    }
  } finally {
    if (application) await application.close();
    await rm(profile, { recursive: true, force: true });
  }
});
