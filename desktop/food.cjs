const { app, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createFoodStore, FoodError, BATCH_LIMIT } = require('./food-store.cjs');

function createFoodService(pet, getPanel) {
  const store = createFoodStore(path.join(app.getPath('userData'), 'food'));
  const channels = [];
  let saving = false;
  let enabled = true;
  let controller = new AbortController();
  function setEnabled(value) {
    if (enabled === value) return;
    enabled = value;
    controller.abort();
    controller = new AbortController();
  }
  const message = error => error instanceof FoodError ? error.message : '저장소에 접근할 수 없어요. 디스크 공간과 파일 권한을 확인해 주세요.';
  function send(channel, value) {
    for (const win of [pet, getPanel()]) {
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, value);
    }
  }
  function handle(channel, operation) {
    channels.push(channel);
    ipcMain.handle(channel, async (event, value) => {
      const allowed = [pet, getPanel()].some(win => win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame);
      if (!allowed) return { ok: false, error: '허용되지 않은 요청이에요.' };
      if (!enabled) return { ok: false, error: 'M01 먹이·변환이 꺼져 있어요.' };
      const { signal } = controller;
      const check = () => signal.throwIfAborted();
      try {
        const result = await operation(value, { signal, check });
        check();
        return { ok: true, value: result };
      }
      catch (error) { return { ok: false, error: signal.aborted ? '모듈 설정이 바뀌어 작업을 중단했어요.' : message(error) }; }
    });
  }
  async function save(operation, { check }) {
    if (saving) throw new FoodError('저장 중이에요. 잠시 후 다시 먹여 주세요.');
    saving = true;
    try {
      const result = await operation();
      check();
      if (result.items.length) send('food:saved', { count: result.items.length });
      return result;
    } finally { saving = false; }
  }
  handle('food:save-text', (text, context) => save(async () => ({ items: [await store.saveText(text, context)], errors: [] }), context));
  handle('food:save-files', (sources, context) => save(async () => {
    if (!Array.isArray(sources) || !sources.length) throw new FoodError('저장할 파일을 선택해 주세요.');
    if (sources.length > BATCH_LIMIT) throw new FoodError('파일은 한 번에 10개까지 먹일 수 있어요.');
    const result = { items: [], errors: [] };
    for (const source of sources) {
      context.check();
      try { result.items.push(await store.saveFile(source, context)); }
      catch (error) { result.errors.push(`${String(source?.name || '파일').slice(0, 100)}: ${message(error)}`); }
    }
    return result;
  }, context));
  handle('food:list', (_value, context) => store.list(context));
  handle('food:read-text', (id, context) => store.readText(id, context));
  handle('food:reveal', async (id, { check, signal }) => { const { file } = await store.get(id, { signal }); check(); shell.showItemInFolder(file); });
  handle('food:open', async (id, { check, signal }) => {
    const { file } = await store.get(id, { signal });
    check();
    if (await shell.openPath(file)) throw new FoodError('이 파일을 열 수 있는 앱을 찾지 못했어요.');
  });
  handle('food:folder', async (_value, { check }) => {
    await fs.mkdir(store.directory, { recursive: true, mode: 0o700 });
    check();
    if (await shell.openPath(store.directory)) throw new FoodError('보관함 폴더를 열 수 없어요.');
  });
  return { setEnabled, dispose() { enabled = false; controller.abort(); for (const channel of channels) ipcMain.removeHandler(channel); } };
}

module.exports = { createFoodService };
