const { app, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createFoodStore, FoodError, BATCH_LIMIT } = require('./food-store.cjs');

function createFoodService(pet, getPanel) {
  const store = createFoodStore(path.join(app.getPath('userData'), 'food'));
  const channels = [];
  let saving = false;
  const message = error => error instanceof FoodError ? error.message : '저장소에 접근할 수 없어요. 디스크 공간과 파일 권한을 확인해 주세요.';
  function send(channel, value) {
    for (const win of [pet, getPanel()]) {
      if (win && !win.isDestroyed()) win.webContents.send(channel, value);
    }
  }
  function handle(channel, operation) {
    channels.push(channel);
    ipcMain.handle(channel, async (event, value) => {
      const allowed = [pet, getPanel()].some(win => win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame);
      if (!allowed) return { ok: false, error: '허용되지 않은 요청이에요.' };
      try { return { ok: true, value: await operation(value) }; }
      catch (error) { return { ok: false, error: message(error) }; }
    });
  }
  async function save(operation) {
    if (saving) throw new FoodError('저장 중이에요. 잠시 후 다시 먹여 주세요.');
    saving = true;
    try {
      const result = await operation();
      if (result.items.length) send('food:saved', { count: result.items.length });
      return result;
    } finally { saving = false; }
  }
  handle('food:save-text', text => save(async () => ({ items: [await store.saveText(text)], errors: [] })));
  handle('food:save-files', sources => save(async () => {
    if (!Array.isArray(sources) || !sources.length) throw new FoodError('저장할 파일을 선택해 주세요.');
    if (sources.length > BATCH_LIMIT) throw new FoodError('파일은 한 번에 10개까지 먹일 수 있어요.');
    const result = { items: [], errors: [] };
    for (const source of sources) {
      try { result.items.push(await store.saveFile(source)); }
      catch (error) { result.errors.push(`${String(source?.name || '파일').slice(0, 100)}: ${message(error)}`); }
    }
    return result;
  }));
  handle('food:list', () => store.list());
  handle('food:read-text', id => store.readText(id));
  handle('food:reveal', async id => { shell.showItemInFolder((await store.get(id)).file); });
  handle('food:open', async id => {
    if (await shell.openPath((await store.get(id)).file)) throw new FoodError('이 파일을 열 수 있는 앱을 찾지 못했어요.');
  });
  handle('food:folder', async () => {
    await fs.mkdir(store.directory, { recursive: true, mode: 0o700 });
    if (await shell.openPath(store.directory)) throw new FoodError('보관함 폴더를 열 수 없어요.');
  });
  return { dispose() { for (const channel of channels) ipcMain.removeHandler(channel); } };
}

module.exports = { createFoodService };
