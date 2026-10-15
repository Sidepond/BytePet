const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');
const { getPanelBounds } = require('./window.cjs');
const { createFoodService } = require('./food.cjs');

function createUtilityPanel(pet) {
  let panel;
  let open = false;
  let ready = false;
  const food = createFoodService(pet, () => panel);

  function publish() {
    if (!pet.isDestroyed()) pet.webContents.send('pet:panel-state', open);
  }
  function reposition() {
    if (!panel || panel.isDestroyed()) return;
    const bounds = pet.getBounds();
    panel.setBounds(getPanelBounds(bounds, screen.getDisplayMatching(bounds).workArea));
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
      ...getPanelBounds(bounds, screen.getDisplayMatching(bounds).workArea),
      title: 'BytePet 유틸리티', parent: pet, modal: false,
      frame: false, backgroundColor: '#fffaf0', hasShadow: true,
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
    if (!panel) create();
    show();
    publish();
  }
  function close(event) {
    if (from(event, panel) || from(event, pet)) hide();
  }
  ipcMain.on('pet:panel-toggle', toggle);
  ipcMain.on('panel:close', close);
  pet.webContents.on('did-finish-load', publish);

  return {
    reposition,
    dispose() {
      food.dispose();
      ipcMain.removeListener('pet:panel-toggle', toggle);
      ipcMain.removeListener('panel:close', close);
      if (panel && !panel.isDestroyed()) panel.destroy();
    },
  };
}

module.exports = { createUtilityPanel };
