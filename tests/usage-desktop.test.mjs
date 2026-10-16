import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { _electron as electron } from 'playwright';
const root = fileURLToPath(new URL('../', import.meta.url));
async function until(check) {
  const deadline = Date.now() + 10000;
  while (!await check()) { if (Date.now() > deadline) throw new Error('Timed out'); await new Promise(resolve => setTimeout(resolve, 40)); }
}
const native = (app, title, method) => app.evaluate(({ BrowserWindow }, { title, method }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === title)?.[method](), { title, method });
async function fixture(t) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'bytepet-usage-ui-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin'), profile = path.join(directory, 'profile'), claude = path.join(directory, 'claude');
  await Promise.all([mkdir(bin), mkdir(profile), mkdir(claude)]);
  await writeFile(path.join(bin, 'codex'), `#!${process.execPath}
const readline = require('node:readline');
const fs = require('node:fs');
readline.createInterface({input:process.stdin}).on('line', line => {
  const r = JSON.parse(line); if (!r.id) return;
  fs.appendFileSync(${JSON.stringify(path.join(directory, 'requests'))}, r.method + '\\n');
  const result = r.id === 1 ? {} : r.id === 2 ? {account:{type:'chatgpt'}} : {rateLimits:{primary:{usedPercent:42,windowDurationMins:300,resetsAt:Math.floor(Date.now()/1000)+7200},secondary:{usedPercent:28,windowDurationMins:10080,resetsAt:Math.floor(Date.now()/1000)+345600}}};
  process.stdout.write(JSON.stringify({id:r.id,result})+'\\n');
});
`, { mode: 0o700 });
  await writeFile(path.join(claude, 'settings.json'), JSON.stringify({ theme: 'dark', statusLine: { type: 'command', command: "printf 'original status'", padding: 1 } }));
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CLAUDE_CONFIG_DIR: claude };
  delete env.ELECTRON_RUN_AS_NODE;
  return { directory, profile, claude, env };
}
async function openPanel(app, pet) {
  await pet.evaluate(() => window.petPanel.toggle());
  await until(() => app.windows().some(w => w.url().endsWith('/panel.html')));
  const panel = app.windows().find(w => w.url().endsWith('/panel.html'));
  await panel.waitForFunction(() => document.activeElement?.matches('#food-composer > summary'));
  return panel;
}

test('Usage UI: providers, Claude connection, settings, migrated always-visible gauge, detail navigation and restart', { timeout: 60000 }, async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.profile, 'ai-usage.json'), JSON.stringify({ version: 1, preferences: { codex: true, claude: true, badgeMode: 'hover', badgePosition: 'top', badgeWindow: 'primary' } }));
  const options = process.env.BYTEPET_USAGE_TEST_APP
    ? { executablePath: process.env.BYTEPET_USAGE_TEST_APP, args: [`--user-data-dir=${f.profile}`], cwd: tmpdir(), env: f.env }
    : { args: [root, `--user-data-dir=${f.profile}`], cwd: root, env: f.env };
  let app = await electron.launch(options);
  const errors = [];
  const observe = page => page.on('pageerror', error => errors.push(error.message));
  app.on('window', observe);
  try {
    let pet = await app.firstWindow(); observe(pet);
    await pet.waitForFunction(() => document.querySelector('#pet')?.dataset.character);
    await app.evaluate(({ screen }) => { globalThis.usageCursor = { x: -10000, y: -10000 }; screen.getCursorScreenPoint = () => globalThis.usageCursor; });
    await until(() => native(app, 'BytePet AI 사용량', 'isVisible'));
    await new Promise(resolve => setTimeout(resolve, 650));
    assert.equal(await native(app, 'BytePet AI 사용량', 'isVisible'), true, 'legacy hover setting stays visible with cursor away');
    assert.equal(JSON.parse(await readFile(path.join(f.profile, 'ai-usage.json'), 'utf8')).preferences.badgeMode, 'always');
    let panel = await openPanel(app, pet); observe(panel);
    assert.equal((await pet.evaluate(() => window.aiUsage.set('badgeMode', 'always'))).ok, false, 'pet cannot mutate settings');
    assert.equal((await pet.evaluate(() => window.aiUsage.connectClaude(true))).ok, false, 'pet cannot change Claude configuration');
    await panel.locator('#show-usage').click();
    await panel.waitForFunction(() => document.querySelector('[data-provider="codex"] [data-window="primary"] strong').textContent === '42%');
    assert.equal(await panel.locator('[data-provider="claude"] [data-window="primary"] strong').textContent(), '—');
    await panel.locator('.usage-connection summary').click();
    await panel.locator('#connect-claude').click();
    await panel.waitForFunction(() => document.querySelector('#connect-claude').textContent === 'Claude 연결 해제');
    const settings = JSON.parse(await readFile(path.join(f.claude, 'settings.json'), 'utf8'));
    const input = JSON.stringify({ transcript_path: 'must-not-be-stored', rate_limits: { five_hour: { used_percentage: 67, resets_at: Math.floor(Date.now() / 1000) + 5700 }, seven_day: { used_percentage: 45, resets_at: Math.floor(Date.now() / 1000) + 259200 } } });
    // The packaged Electron executable is also the bridge runtime. Feed data
    // without a model request, exactly as Claude's statusLine does.
    const bridge = await new Promise((resolve, reject) => {
      const child = execFile('/bin/sh', ['-c', settings.statusLine.command], { env: f.env }, (error, stdout) => error ? reject(error) : resolve(stdout));
      child.stdin.end(input);
    });
    assert.equal(bridge, 'original status');
    await panel.locator('#refresh-usage').click();
    await panel.waitForFunction(() => document.querySelector('[data-provider="claude"] [data-window="primary"] strong').textContent === '67%');
    assert.equal((await readFile(path.join(f.profile, 'claude-usage.json'), 'utf8')).includes('must-not-be-stored'), false);
    await panel.screenshot({ path: '/tmp/bytepet-usage-panel.png' });
    await panel.locator('#close').click();
    await until(async () => !await native(app, 'BytePet 유틸리티', 'isVisible'));
    const hit = await pet.locator('#pet').evaluate(canvas => {
      const r = canvas.getBoundingClientRect(), data = canvas.getContext('2d').getImageData(0, 0, 48, 48).data;
      const i = Array.from({ length: 48 * 48 }, (_, i) => i).find(i => data[i * 4 + 3] === 255);
      return { x: r.x + (i % 48 + .5) * r.width / 48, y: r.y + (Math.floor(i / 48) + .5) * r.height / 48 };
    });
    await app.evaluate(({ BrowserWindow }, hit) => { const b = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'BytePet').getBounds(); globalThis.usageCursor = { x: Math.round(b.x + hit.x), y: Math.round(b.y + hit.y) }; }, hit);
    await until(() => native(app, 'BytePet AI 사용량', 'isVisible'));
    let badge = app.windows().find(w => w.url().endsWith('/usage-badge.html')); observe(badge);
    await badge.waitForFunction(() => document.querySelector('#badge-rows').textContent.includes('67%'));
    await badge.screenshot({ path: '/tmp/bytepet-usage-badge.png' });
    await app.evaluate(({ screen, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'BytePet AI 사용량');
      const b = win.getBounds(); globalThis.usageCursor = { x: b.x + 20, y: b.y + 20 };
    });
    assert.equal((await badge.evaluate(() => window.aiUsage.refresh())).ok, false);
    await badge.locator('#usage-badge').click();
    await until(() => native(app, 'BytePet 유틸리티', 'isVisible'));
    assert.equal(await panel.locator('#usage-view').isVisible(), true);
    await panel.locator('#show-settings').click();
    await panel.locator('#usage-mode').selectOption('always');
    await panel.waitForFunction(() => !document.querySelector('#usage-mode').disabled);
    await panel.locator('#usage-position').selectOption('right');
    await panel.waitForFunction(() => !document.querySelector('#usage-mode').disabled);
    await panel.locator('#usage-window').selectOption('secondary');
    await panel.waitForFunction(() => !document.querySelector('#usage-mode').disabled);
    await panel.locator('#show-ground').uncheck();
    await panel.waitForFunction(() => !document.querySelector('#show-ground').disabled);
    await panel.locator('#close').click();
    await until(() => native(app, 'BytePet AI 사용량', 'isVisible'));
    await badge.waitForFunction(() => document.querySelector('#badge-rows').textContent.includes('28%') && document.querySelector('#badge-rows').textContent.includes('45%'));
    // Edge fitting follows a moved pet, including an upper screen corner.
    await app.evaluate(({ BrowserWindow, screen }) => {
      const area = screen.getPrimaryDisplay().workArea;
      BrowserWindow.getAllWindows().find(w => w.getTitle() === 'BytePet').setPosition(area.x + area.width - 128, area.y);
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    const position = await app.evaluate(({ BrowserWindow, screen }) => ({ area: screen.getPrimaryDisplay().workArea, b: BrowserWindow.getAllWindows().find(w => w.getTitle() === 'BytePet AI 사용량').getBounds() }));
    assert.ok(position.b.x >= position.area.x && position.b.y >= position.area.y && position.b.x + position.b.width <= position.area.x + position.area.width);
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('toggle-pet-visibility').click());
    await until(async () => !await native(app, 'BytePet AI 사용량', 'isVisible'));
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('toggle-pet-visibility').click());
    await until(() => native(app, 'BytePet AI 사용량', 'isVisible'));
    await app.close();
    app = await electron.launch(options);
    app.on('window', observe);
    pet = await app.firstWindow(); await pet.waitForLoadState('load');
    await until(() => native(app, 'BytePet AI 사용량', 'isVisible'));
    const saved = (await pet.evaluate(() => window.aiUsage.get())).value;
    assert.equal(saved.preferences.badgeMode, 'always'); assert.equal(saved.preferences.badgePosition, 'right'); assert.equal(saved.preferences.badgeWindow, 'secondary');
    panel = await openPanel(app, pet);
    await panel.locator('#show-usage').click();
    await panel.locator('.usage-connection summary').click(); await panel.locator('#connect-claude').click();
    await panel.waitForFunction(() => document.querySelector('#connect-claude').textContent === 'Claude 연결');
    const restored = JSON.parse(await readFile(path.join(f.claude, 'settings.json'), 'utf8'));
    assert.equal(restored.statusLine.command, "printf 'original status'"); assert.equal(restored.theme, 'dark');
    await panel.locator('#show-settings').click(); await panel.locator('#usage-mode').selectOption('hidden');
    await panel.waitForFunction(() => !document.querySelector('#usage-mode').disabled);
    await panel.locator('#close').click();
    await until(async () => !await native(app, 'BytePet AI 사용량', 'isVisible'));
    assert.deepEqual(errors, []);
    assert.equal((await readFile(path.join(f.directory, 'requests'), 'utf8')).includes('turn/'), false);
  } finally { await app.close(); }
});

test('Usage UI: first badge click opens the usage view after a cold panel load', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.profile, 'ai-usage.json'), JSON.stringify({ version: 1, preferences: { codex: true, claude: true, badgeMode: 'always', badgePosition: 'top', badgeWindow: 'primary' } }));
  const options = process.env.BYTEPET_USAGE_TEST_APP
    ? { executablePath: process.env.BYTEPET_USAGE_TEST_APP, args: [`--user-data-dir=${f.profile}`], cwd: tmpdir(), env: f.env }
    : { args: [root, `--user-data-dir=${f.profile}`], cwd: root, env: f.env };
  const app = await electron.launch(options);
  try {
    await app.firstWindow();
    await until(() => native(app, 'BytePet AI 사용량', 'isVisible'));
    const badge = app.windows().find(w => w.url().endsWith('/usage-badge.html'));
    await badge.locator('#usage-badge').click();
    await until(() => native(app, 'BytePet 유틸리티', 'isVisible'));
    const panel = app.windows().find(w => w.url().endsWith('/panel.html'));
    await panel.waitForFunction(() => !document.querySelector('#usage-view').hidden);
    assert.equal(await panel.locator('#show-usage').getAttribute('aria-pressed'), 'true');
    assert.equal(await panel.locator('#food-view').isVisible(), false);
    await until(() => native(app, 'BytePet AI 사용량', 'isVisible'));
    const gaugeBounds = await native(app, 'BytePet AI 사용량', 'getBounds');
    assert.equal(gaugeBounds.width, 140); assert.equal(gaugeBounds.height, 40);
    const pet = app.windows().find(w => w.url().endsWith('/pet.html'));
    const headY = await pet.locator('#pet').evaluate(canvas => {
      const data = canvas.getContext('2d').getImageData(0, 0, 48, 48).data;
      const first = Array.from({ length: 48 * 48 }, (_, i) => i).find(i => data[i * 4 + 3] > 0);
      return canvas.getBoundingClientRect().y + Math.floor(first / 48) * 112 / 48;
    });
    const petBounds = await native(app, 'BytePet', 'getBounds');
    assert.ok(gaugeBounds.y + gaugeBounds.height <= petBounds.y + headY);
    assert.ok(petBounds.y + headY - gaugeBounds.y - gaugeBounds.height < 9, 'gauge hugs the visible head, not the transparent frame');
    await panel.locator('#show-settings').click();
    await panel.locator('#usage-claude').uncheck();
    await panel.waitForFunction(() => !document.querySelector('#usage-claude').disabled);
    await until(async () => (await native(app, 'BytePet AI 사용량', 'getBounds'))?.height === 26);
    await badge.waitForFunction(() => document.querySelectorAll('.badge-row').length === 1);
  } finally { await app.close(); }
});


test('Usage UI: gauge anchor ignores animated alpha and follows only window movement', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const options = process.env.BYTEPET_USAGE_TEST_APP
    ? { executablePath: process.env.BYTEPET_USAGE_TEST_APP, args: [`--user-data-dir=${f.profile}`], cwd: tmpdir(), env: f.env }
    : { args: [root, `--user-data-dir=${f.profile}`], cwd: root, env: f.env };
  const app = await electron.launch(options);
  try {
    const pet = await app.firstWindow();
    await pet.waitForFunction(() => document.querySelector('#pet')?.dataset.character);
    await pet.emulateMedia({ reducedMotion: 'reduce' });
    await app.evaluate(({ screen }) => { screen.getCursorScreenPoint = () => ({ x: -10000, y: -10000 }); });
    const panel = await openPanel(app, pet);
    for (const id of ['cat-cheese', 'cat-tuxedo', 'cat-black', 'dog-shiba', 'dog-retriever', 'dog-corgi']) {
      assert.equal((await panel.evaluate(id => window.appearance.set('character', id), id)).ok, true);
      await pet.waitForFunction(id => document.querySelector('#pet').dataset.character === id, id);
      await new Promise(resolve => setTimeout(resolve, 100));
      const fixed = await native(app, 'BytePet AI 사용량', 'getBounds');
      const tops = new Set();
      for (const [state, elapsed] of [['idle', 1000], ['sleeping', 1500], ['eating', 800], ['dragging', 360], ['landing', 0], ['success', 0]]) {
        const top = await pet.evaluate(async ({ id, state, elapsed }) => {
          const { drawCharacter, characterIdleAnchor } = await import('./characters.js');
          const { createHitRegionReporter } = await import('./hit-test.js');
          const canvas = document.querySelector('#pet');
          drawCharacter(canvas.getContext('2d'), id, state, elapsed);
          createHitRegionReporter(canvas, window.petInput, () => characterIdleAnchor(id))();
          const pixels = canvas.getContext('2d').getImageData(0, 0, 48, 48).data;
          return Math.floor(Array.from({ length: 48 * 48 }, (_, i) => i).find(i => pixels[i * 4 + 3] > 0) / 48);
        }, { id, state, elapsed });
        tops.add(top);
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.deepEqual(await native(app, 'BytePet AI 사용량', 'getBounds'), fixed, `${id} ${state} must not move the gauge`);
      }
      assert.ok(tops.size > 1, 'test actually changes the visible character height');
    }
    await panel.evaluate(() => window.utilityPanel.close());
    await until(async () => !await native(app, 'BytePet 유틸리티', 'isVisible'));
    const before = await native(app, 'BytePet AI 사용량', 'getBounds');
    await app.evaluate(({ BrowserWindow }) => {
      const pet = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet');
      const bounds = pet.getBounds(); pet.setPosition(bounds.x - 20, bounds.y - 20);
    });
    await until(async () => (await native(app, 'BytePet AI 사용량', 'getBounds'))?.y === before.y - 20);
    assert.equal((await native(app, 'BytePet AI 사용량', 'getBounds')).x, before.x - 20);
  } finally { await app.close(); }
});
