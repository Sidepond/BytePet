const { app, ipcMain, shell, nativeImage, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createFoodStore, FoodError, BATCH_LIMIT, FILE_LIMIT } = require('./food-store.cjs');

function createFoodService(pet, getPanel) {
  const store = createFoodStore(path.join(app.getPath('userData'), 'food'));
  const channels = [];
  let saving = false;
  let activeMenu = null;
  const thumbnails = new Map();
  let enabled = true;
  let controller = new AbortController();
  function setEnabled(value) {
    if (enabled === value) return;
    enabled = value;
    activeMenu?.closePopup();
    thumbnails.clear();
    controller.abort();
    controller = new AbortController();
  }
  const message = error => error instanceof FoodError ? error.message : '저장소에 접근할 수 없어요. 디스크 공간과 파일 권한을 확인해 주세요.';
  function send(channel, value) {
    for (const win of [pet, getPanel()]) {
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, value);
    }
  }
  function handle(channel, operation, panelOnly = false) {
    channels.push(channel);
    ipcMain.handle(channel, async (event, value) => {
      const allowed = (panelOnly ? [getPanel()] : [pet, getPanel()]).some(win => win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame);
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
  handle('food:list', (options, context) => {
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options) ||
      (options.trash !== undefined && typeof options.trash !== 'boolean'))) throw new FoodError('보관함 요청을 확인해 주세요.');
    return store.list({ ...context, query: options?.query ?? '', trash: options?.trash === true });
  });
  function request(value) {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' ||
      (value.trash !== undefined && typeof value.trash !== 'boolean')) throw new FoodError('저장된 항목을 선택해 주세요.');
    return { id: value.id, trash: value.trash === true };
  }
  async function imageFor(id, { signal, check }, trash, size) {
    const { item, file } = await store.get(id, { signal, trash });
    if (item.kind !== 'file' || !/\.(png|jpe?g|gif|webp|heic|heif|avif|bmp|tiff?)$/i.test(item.filename)) return null;
    if ((await fs.stat(file)).size > FILE_LIMIT) return null;
    const key = `${id}:${trash}:${size}`;
    if (size === 128 && thumbnails.has(key)) return thumbnails.get(key);
    let data;
    try {
      const image = await nativeImage.createThumbnailFromPath(file, { width: size, height: size });
      check();
      if (image.isEmpty()) return null;
      data = image.toDataURL();
      if (data.length > 4 * 1024 * 1024) return null;
    } catch { check(); return null; }
    if (size === 128) {
      if (thumbnails.size >= 48) thumbnails.delete(thumbnails.keys().next().value);
      thumbnails.set(key, data);
    }
    return data;
  }
  handle('food:thumbnail', (value, context) => {
    const { id, trash } = request(value);
    return imageFor(id, context, trash, 128);
  }, true);
  handle('food:preview', async (value, context) => {
    const { id, trash } = request(value);
    const { item } = await store.get(id, { ...context, trash });
    if (item.kind === 'text') return { kind: 'text', text: await store.readText(id, { ...context, trash }) };
    const image = await imageFor(id, context, trash, 768);
    return image ? { kind: 'image', image } : { kind: 'file' };
  }, true);
  for (const [channel, operation] of [
    ['rename', (value, context) => { const { id } = request(value); return store.rename(id, value.name, context); }],
    ['trash', (id, context) => store.moveToTrash(id, context)],
    ['restore', (id, context) => store.restore(id, context)],
  ]) handle(`food:${channel}`, async (value, context) => {
    const item = await operation(value, context);
    context.check();
    thumbnails.clear();
    send('food:changed', {});
    return item;
  }, true);
  handle('food:menu', async (value, context) => {
    const { id, trash } = request(value);
    const { item } = await store.get(id, { ...context, trash });
    context.check();
    activeMenu?.closePopup();
    return new Promise(resolve => {
      let choice = null;
      const entry = (label, command) => ({ label, click: () => { choice = command; } });
      const template = trash ? [entry('미리보기', 'preview'), entry('보관함으로 복원', 'restore')] : [
        entry(item.kind === 'text' ? '텍스트 불러오기' : '파일 열기', 'food'), entry('미리보기', 'preview'),
        ...(item.kind === 'text' ? [entry('변환으로 보내기', 'convert')] : []),
        { type: 'separator' }, entry('보관함 이름 변경…', 'rename'), entry('폴더에서 보기', 'reveal'),
        { type: 'separator' }, entry('휴지통으로 이동', 'trash'),
      ];
      const menu = Menu.buildFromTemplate(template);
      activeMenu = menu;
      menu.popup({ window: getPanel(), callback: () => { if (activeMenu === menu) activeMenu = null; resolve(choice); } });
    });
  }, true);
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
  return { setEnabled, dispose() { enabled = false; activeMenu?.closePopup(); thumbnails.clear(); controller.abort(); for (const channel of channels) ipcMain.removeHandler(channel); } };
}

module.exports = { createFoodService };
