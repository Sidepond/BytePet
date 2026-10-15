const { BrowserWindow, ipcMain, screen, clipboard, shell, dialog, app } = require('electron');
const path = require('node:path');
const { getPanelBounds, getYardBoundsForPanel } = require('./window.cjs');
const { createFoodService } = require('./food.cjs');
const { createResultService } = require('./results.cjs');
const { createPortService } = require('./ports.cjs');
const { createAppearanceService } = require('./appearance.cjs');
const { createModuleService, createModuleStore } = require('./modules.cjs');

function createUtilityPanel(pet, { appearanceStore, appearanceInitial, applyAppearance }) {
  let panel;
  let open = false;
  let ready = false;
  const viewHeights = { food: 588, ports: 588, settings: 530, off: 298 };
  let view = 'food';
  const appearance = createAppearanceService({
    ipcMain, store: appearanceStore, initial: appearanceInitial, getPet: () => pet, getPanel: () => panel, apply: applyAppearance,
  });
  const modules = createModuleService({ ipcMain, store: createModuleStore(app.getPath('userData')), getPet: () => pet, getPanel: () => panel });
  const food = createFoodService(pet, () => panel);
  const results = createResultService({ ipcMain, clipboard, pet, getPanel: () => panel });
  const ports = createPortService({
    ipcMain, getPanel: () => panel, openExternal: url => shell.openExternal(url),
    isProtected: pid => pid <= 1 || pid === process.pid || app.getAppMetrics().some(info => info.pid === pid),
    confirm: async (item, { signal }) => {
      const result = await dialog.showMessageBox(panel, {
        signal, type: 'warning', title: '프로세스 종료', message: `${item.name} 프로세스를 종료할까요?`,
        detail: `PID ${item.pid}\n실행 파일: ${item.command}\n확인된 포트: ${item.ports.join(', ')}\n\n이 프로세스의 모든 작업과 포트가 함께 종료됩니다. 저장하지 않은 작업은 사라질 수 있어요.`,
        buttons: ['취소', '프로세스 종료'], defaultId: 0, cancelId: 0, noLink: true,
      });
      return result.response === 1;
    },
    react: reaction => {
      if (!pet.isDestroyed() && !pet.webContents.isDestroyed()) pet.webContents.send('ports:reaction', reaction);
    },
  });

  function applyModules({ modules: enabled }) {
    food.setEnabled(enabled.m01);
    results.setEnabled(enabled.m01);
    ports.setEnabled(enabled.m02);
  }
  applyModules(modules.state());
  modules.subscribe(applyModules);

  function publish() {
    // The renderer can be destroyed before the native parent window closes.
    if (!pet.isDestroyed() && !pet.webContents.isDestroyed()) pet.webContents.send('pet:panel-state', open);
  }
  function reposition() {
    if (!panel || panel.isDestroyed()) return;
    let bounds = pet.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    if (open) {
      const next = getYardBoundsForPanel(bounds, area, viewHeights[view], appearance.state().preferences);
      if (Object.keys(next).some(key => next[key] !== bounds[key])) pet.setBounds(next);
      bounds = next;
    }
    panel.setBounds(getPanelBounds(bounds, area, viewHeights[view], appearance.state().preferences));
  }
  function show() {
    if (!ready || !open || !panel) return;
    reposition();
    panel.show();
    panel.focus();
    panel.webContents.send('panel:opened');
  }
  function hide() {
    open = false;
    if (panel && !panel.isDestroyed()) panel.hide();
    publish();
  }
  function create() {
    const bounds = pet.getBounds();
    const win = new BrowserWindow({
      ...getPanelBounds(bounds, screen.getDisplayMatching(bounds).workArea, viewHeights[view], appearance.state().preferences),
      title: 'BytePet 유틸리티', parent: pet, modal: false,
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      show: false, resizable: false, maximizable: false, minimizable: false,
      fullscreenable: false, alwaysOnTop: true, acceptFirstMouse: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
      },
    });
    panel = win;
    win.setAlwaysOnTop(true, 'floating');
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.once('ready-to-show', () => { ready = true; show(); });
    win.on('closed', () => { panel = null; ready = false; open = false; publish(); });
    win.loadFile(path.join(__dirname, 'panel.html')).catch(error => {
      console.error('Could not load BytePet panel:', error);
      if (!win.isDestroyed()) win.destroy();
    });
  }
  function from(event, win) {
    return win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame;
  }
  function toggle(event) {
    if (!from(event, pet)) return;
    if (open) return hide();
    open = true;
    publish();
    if (!panel) create();
    show();
  }
  function close(event) {
    if (from(event, panel) || from(event, pet)) hide();
  }
  function rendererReady(event) {
    if (from(event, panel)) show();
  }
  function changeView(event, next) {
    if (!from(event, panel) || typeof next !== 'string' || !Object.hasOwn(viewHeights, next)) return;
    view = next;
    reposition();
  }
  ipcMain.on('panel:view', changeView);
  ipcMain.on('pet:panel-toggle', toggle);
  ipcMain.on('panel:close', close);
  ipcMain.on('panel:ready', rendererReady);
  pet.webContents.on('did-finish-load', publish);

  return {
    reposition,
    dispose() {
      appearance.dispose();
      modules.dispose();
      food.dispose();
      results.dispose();
      ports.dispose();
      ipcMain.removeListener('pet:panel-toggle', toggle);
      ipcMain.removeListener('panel:close', close);
      ipcMain.removeListener('panel:ready', rendererReady);
      ipcMain.removeListener('panel:view', changeView);
      if (panel && !panel.isDestroyed()) panel.destroy();
    },
  };
}

module.exports = { createUtilityPanel };
