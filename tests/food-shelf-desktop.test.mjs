import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
const root = fileURLToPath(new URL('../', import.meta.url));
async function profileFor(t) {
  const profile = await realpath(await mkdtemp(path.join(tmpdir(), 'bytepet-shelf-')));
  t.after(() => rm(profile, { recursive: true, force: true }));
  await writeFile(path.join(profile, 'ai-usage.json'), JSON.stringify({ version: 1, preferences: { codex: false, claude: false, badgeMode: 'hidden', badgePosition: 'top', badgeWindow: 'primary' } }));
  return profile;
}
async function launch(profile) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root, env });
  const pet = await app.firstWindow(); await pet.waitForLoadState('load');
  const opened = app.waitForEvent('window'); await pet.evaluate(() => window.petPanel.toggle());
  const panel = await opened;
  await panel.waitForFunction(() => document.activeElement?.matches('#food-composer > summary'));
  return { app, pet, panel };
}
const waitShelf = panel => panel.waitForFunction(() => document.querySelector('#food-list').getAttribute('aria-busy') === 'false');
const filter = async (panel, name) => { await panel.locator(`[data-filter="${name}"]`).click(); await waitShelf(panel); };
async function chooseMenu(app, panel, label) {
  await app.evaluate((_electron, choice) => { globalThis.foodMenuChoice = choice; }, label);
  await panel.locator('#shelf-more').click();
}
async function mockMenu(app) {
  await app.evaluate(({ Menu }) => {
    Menu.buildFromTemplate = template => ({
      popup({ callback }) {
        globalThis.foodMenuLabels = template.map(item => item.label).filter(Boolean);
        template.find(item => item.label === globalThis.foodMenuChoice)?.click(); callback();
      }, closePopup() {},
    });
  });
}

test('Shelf: collapsed bowl, full-text search, filters, local thumbnails and Space preview preserve drafts', { timeout: 30000 }, async t => {
  const { app, pet, panel } = await launch(await profileFor(t));
  try {
    const errors = []; panel.on('pageerror', error => errors.push(error.message));
    assert.equal(await panel.locator('#food-composer').evaluate(el => el.open), false);
    await panel.locator('#food-composer > summary').click();
    await panel.locator('#draft').fill('보관할 메모\n' + '본문 '.repeat(100) + 'needle🐱');
    await panel.locator('#feed-text').click();
    await panel.waitForFunction(() => !document.querySelector('#food-composer').open && document.querySelectorAll('.file-tile').length === 1);
    await panel.locator('#files').setInputFiles([
      { name: '고양이.png', mimeType: 'image/png', buffer: await readFile(path.join(root, 'docs/images/marmalade.png')) },
      { name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{}') },
    ]);
    await panel.waitForFunction(() => document.querySelectorAll('.file-tile').length === 3);
    await panel.locator('.file-thumbnail').waitFor();
    assert.match(await panel.locator('.file-thumbnail').getAttribute('src'), /^data:image\/png;base64,/);
    await panel.locator('#food-composer > summary').click();
    await panel.locator('#draft').fill('아직 작성 중인 먹이');
    await panel.locator('#food-composer > summary').click();
    assert.equal(await panel.locator('#composer-label').textContent(), '작성 중인 메모');
    await panel.keyboard.press('Meta+f');
    assert.equal(await panel.locator('#shelf-search').evaluate(el => el === document.activeElement), true);
    await panel.locator('#shelf-search').fill('needle');
    await waitShelf(panel);
    assert.equal(await panel.locator('.file-tile').count(), 1, 'search reads beyond the short memo preview');
    await panel.locator('.file-tile').click();
    await panel.keyboard.press('Space');
    await panel.locator('#preview-content pre').waitFor();
    assert.match(await panel.locator('#preview-content').textContent(), /needle🐱/);
    assert.equal(await panel.locator('#draft').inputValue(), '아직 작성 중인 먹이');
    await panel.keyboard.press('Escape');
    assert.equal(await panel.locator('#food-preview').evaluate(el => el.open), false);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'BytePet 유틸리티').isVisible()), true);
    await panel.locator('#clear-shelf-search').click(); await waitShelf(panel);
    await filter(panel, 'image'); assert.equal(await panel.locator('.file-tile').count(), 1);
    await panel.locator('.file-tile').click(); await panel.locator('#shelf-preview').click();
    await panel.locator('#preview-content img').waitFor();
    await panel.screenshot({ path: path.join(root, 'test-results/shelf-photo-preview.png') });
    await panel.locator('#close-food-preview').click();
    await filter(panel, 'file'); assert.equal(await panel.locator('.file-tile').count(), 1);
    await panel.locator('.file-tile').click(); await panel.locator('#shelf-preview').click();
    await panel.waitForFunction(() => document.querySelector('#preview-content').textContent.includes('지원하지'));
    await panel.keyboard.press('Escape');
    await filter(panel, 'all');
    await panel.locator('#shelf-search').fill('no results'); await waitShelf(panel);
    assert.equal(await panel.locator('.file-tile').count(), 0);
    assert.match(await panel.locator('#empty-shelf').textContent(), /검색 결과/);
    await panel.locator('#shelf-search').focus();
    await app.evaluate(({ clipboard }) => clipboard.writeText('고양이'));
    await panel.keyboard.press('Meta+a'); await panel.keyboard.press('Meta+v'); await waitShelf(panel);
    assert.equal(await panel.locator('#shelf-search').inputValue(), '고양이');
    assert.equal(await panel.locator('#draft').inputValue(), '아직 작성 중인 먹이', 'search paste cannot feed the bowl');
    assert.equal(await panel.locator('.file-tile').count(), 1);
    await panel.locator('#clear-shelf-search').click(); await waitShelf(panel);
    await panel.screenshot({ path: path.join(root, 'test-results/shelf-browsing.png') });
    assert.deepEqual(errors, []);
    assert.equal((await pet.evaluate(() => window.food.preview('invalid'))).ok, false, 'preview is panel-only');
  } finally { await app.close(); }
});

test('Shelf: context actions rename, move to trash and restore across restart without touching originals', { timeout: 30000 }, async t => {
  const profile = await profileFor(t);
  let { app, panel } = await launch(profile);
  try {
    await mockMenu(app);
    const saved = await panel.evaluate(() => window.food.saveText('original body'));
    const id = saved.value.items[0].id;
    await panel.waitForFunction(() => document.querySelectorAll('.file-tile').length === 1);
    await panel.locator('.file-tile').click();
    await chooseMenu(app, panel, '보관함 이름 변경…');
    await panel.locator('#food-name').fill('새 이름 <b>안전</b>');
    await panel.locator('#save-food-name').click();
    await panel.waitForFunction(() => !document.querySelector('#food-rename').open);
    await waitShelf(panel);
    assert.equal(await panel.locator('.item-name').textContent(), '새 이름 <b>안전</b>');
    assert.equal(await panel.locator('.item-name b').count(), 0);
    assert.equal((await panel.evaluate(id => window.food.readText(id), id)).value, 'original body');
    await panel.locator('.file-tile').click();
    await chooseMenu(app, panel, '휴지통으로 이동');
    await panel.waitForFunction(() => document.querySelectorAll('.file-tile').length === 0);
    assert.equal((await panel.evaluate(() => window.food.list())).value.length, 0);
    assert.equal((await panel.evaluate(() => window.food.list({ trash: true }))).value[0].id, id);
    await app.close();
    ({ app, panel } = await launch(profile));
    await filter(panel, 'trash');
    assert.equal(await panel.locator('.file-tile').count(), 1);
    await panel.locator('.file-tile').click();
    assert.equal(await panel.locator('#shelf-open').isVisible(), false);
    await panel.locator('#shelf-preview').click();
    await panel.locator('#preview-content pre').waitFor();
    assert.equal(await panel.locator('#preview-content pre').textContent(), 'original body');
    await panel.keyboard.press('Escape');
    await panel.locator('#shelf-restore').click();
    await panel.waitForFunction(() => document.querySelectorAll('.file-tile').length === 0);
    await filter(panel, 'all');
    assert.equal(await panel.locator('.file-tile').count(), 1);
    assert.equal((await panel.evaluate(() => window.food.list())).value[0].id, id);
    assert.equal(await readFile(path.join(profile, 'food', id, 'content', 'text.txt'), 'utf8'), 'original body');
    await panel.locator('.file-tile').click();
    await panel.keyboard.press('F2');
    await panel.locator('#food-name').fill('실패할 이름');
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('food:rename'); ipcMain.handle('food:rename', () => ({ ok: false, error: '테스트 저장 실패' })); });
    await panel.locator('#save-food-name').click();
    await panel.waitForFunction(() => document.querySelector('#rename-status').textContent.includes('실패'));
    assert.equal(await panel.locator('#save-food-name').isDisabled(), false);
    await panel.locator('#cancel-food-rename').click();
    assert.equal(await panel.locator('.item-name').textContent(), '새 이름 <b>안전</b>');
  } finally { await app.close(); }
});

test('Shelf: panel-only IPC, stale preview cancellation and module-off boundaries', { timeout: 30000 }, async t => {
  const { app, pet, panel } = await launch(await profileFor(t));
  try {
    const saved = await panel.evaluate(() => window.food.saveText('keep this'));
    const id = saved.value.items[0].id;
    const denied = await pet.evaluate(async id => Promise.all([
      window.food.thumbnail(id), window.food.preview(id), window.food.rename(id, 'bad'), window.food.trash(id), window.food.restore(id), window.food.menu(id),
    ]), id);
    assert.equal(denied.every(result => !result.ok), true);
    const invalid = await panel.evaluate(async () => Promise.all([window.food.thumbnail('../outside'), window.food.preview('../outside'), window.food.trash('../outside'), window.food.restore('../outside')]));
    assert.equal(invalid.every(result => !result.ok), true);
    await panel.waitForFunction(() => document.querySelectorAll('.file-tile').length === 1);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('food:preview');
      ipcMain.handle('food:preview', () => new Promise(resolve => { globalThis.finishPreview = resolve; }));
    });
    await panel.locator('.file-tile').click(); await panel.locator('#shelf-preview').click();
    await panel.locator('#preview-content').filter({ hasText: '준비' }).waitFor();
    await panel.keyboard.press('Escape');
    await app.evaluate(() => globalThis.finishPreview({ ok: true, value: { kind: 'text', text: 'late old response' } }));
    assert.equal(await panel.locator('#food-preview').evaluate(el => el.open), false);
    assert.equal(await panel.locator('#draft').inputValue(), '');
    await panel.evaluate(() => window.modules.set('m01', false));
    await panel.locator('#module-off').waitFor();
    const blocked = await panel.evaluate(async id => Promise.all([window.food.thumbnail(id), window.food.rename(id, 'blocked'), window.food.trash(id), window.food.restore(id), window.food.menu(id)]), id);
    assert.equal(blocked.every(result => !result.ok), true);
    await panel.evaluate(() => window.modules.set('m01', true));
    await panel.waitForFunction(() => document.querySelectorAll('.file-tile').length === 1);
    assert.equal((await panel.evaluate(id => window.food.readText(id), id)).value, 'keep this');
  } finally { await app.close(); }
});
