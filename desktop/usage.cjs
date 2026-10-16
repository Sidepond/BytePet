const { BrowserWindow, ipcMain, screen, app } = require('electron');
const path = require('node:path');
const { createUsageService } = require('./usage-service.cjs');
const { badgeBounds } = require('./usage-layout.cjs');
function createUsageFeature({ pet, getPanel, getAppearance, getCharacterBounds, openPanel }) {
  const service = createUsageService({ directory: app.getPath('userData') });
  let badge, ready = false, disposed = false;
  function from(event, win) {
    return win && !win.isDestroyed() && !win.webContents.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame;
  }
  const authorized = event => from(event, pet) || from(event, getPanel()) || from(event, badge);
  const channels = [];
  function handle(name, onlyPanel, run) {
    channels.push(name);
    ipcMain.handle(name, async (event, ...args) => {
      if (!(onlyPanel ? from(event, getPanel()) : authorized(event))) return { ok: false, error: '허용되지 않은 요청이에요.' };
      try { return { ok: true, value: await run(...args) }; }
      catch (error) { return { ok: false, error: error.message || '사용량 요청을 처리하지 못했어요.' }; }
    });
  }
  handle('usage:get', false, service.state);
  handle('usage:refresh', true, service.refresh);
  handle('usage:set', true, (key, value) => service.set(key, value));
  handle('usage:claude-connect', true, enabled => {
    if (typeof enabled !== 'boolean') throw new Error('올바른 연결 설정을 선택해 주세요.');
    return service.connectClaude(enabled);
  });
  function publish(state) {
    for (const win of [pet, getPanel(), badge]) {
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('usage:changed', state);
    }
    update();
  }
  service.subscribe(publish);
  function create(bounds) {
    badge = new BrowserWindow({
      ...bounds, title: 'BytePet AI 사용량', parent: pet, frame: false, transparent: true,
      backgroundColor: '#00000000', hasShadow: false, show: false, focusable: false,
      resizable: false, minimizable: false, maximizable: false, fullscreenable: false, alwaysOnTop: true, acceptFirstMouse: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    badge.setAlwaysOnTop(true, 'floating');
    if (process.platform === 'darwin') badge.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    badge.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    badge.webContents.on('will-navigate', event => event.preventDefault());
    badge.once('ready-to-show', () => { ready = true; update(); });
    badge.on('closed', () => { badge = null; ready = false; });
    badge.loadFile(path.join(__dirname, 'usage-badge.html')).catch(() => { if (badge && !badge.isDestroyed()) badge.destroy(); });
  }
  function update() {
    if (disposed || pet.isDestroyed()) return;
    const { preferences } = service.state();
    const enabled = preferences.codex || preferences.claude;
    const allowed = enabled && preferences.badgeMode !== 'hidden' && pet.isVisible();
    if (!allowed) { badge?.hide(); return; }
    const petBounds = pet.getBounds();
    const { side, ...bounds } = badgeBounds(petBounds, screen.getDisplayMatching(petBounds).workArea, getAppearance(), preferences.badgePosition, getCharacterBounds(), Number(preferences.codex) + Number(preferences.claude));
    if (!badge) create(bounds);
    if (badge && ready) {
      const current = badge.getBounds();
      if (Object.keys(bounds).some(key => bounds[key] !== current[key])) badge.setBounds(bounds);
      if (!badge.isVisible()) badge.showInactive();
    }
  }
  function open(event) { if (from(event, badge) || from(event, pet)) { openPanel(); update(); } }
  ipcMain.on('usage:open', open);
  const timer = setInterval(update, 60);
  pet.on('move', update); pet.on('show', update); pet.on('hide', update);
  return { reposition: update, dispose() {
    disposed = true; clearInterval(timer); service.dispose();
    pet.removeListener('move', update); pet.removeListener('show', update); pet.removeListener('hide', update);
    ipcMain.removeListener('usage:open', open);
    for (const channel of channels) ipcMain.removeHandler(channel);
    if (badge && !badge.isDestroyed()) badge.destroy();
  } };
}
module.exports = { createUsageFeature };
