const { app, BrowserWindow, Menu, screen, ipcMain } = require('electron');
const path = require('node:path');
const { getVisibleBounds, isPosition } = require('./window.cjs');
const { createPositionStore } = require('./position-store.cjs');

app.setName('BytePet');
let petWindow;

function createPetWindow() {
  const store = createPositionStore(app.getPath('userData'));
  const visibleBounds = position => getVisibleBounds(position,
    screen.getAllDisplays().map(display => display.workArea), screen.getPrimaryDisplay().workArea);
  const win = new BrowserWindow({
    ...visibleBounds(store.read()),
    title: 'BytePet',
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  petWindow = win;
  win.setAlwaysOnTop(true, 'floating');
  win.once('ready-to-show', () => win.showInactive());
  let drag;
  let saveTimer;
  function savePosition() {
    clearTimeout(saveTimer);
    if (!win.isDestroyed()) store.write(visibleBounds(win.getBounds()));
  }
  function keepVisible() {
    if (win.isDestroyed()) return;
    const current = win.getBounds();
    const next = visibleBounds(current);
    if (current.x !== next.x || current.y !== next.y) win.setPosition(next.x, next.y);
    savePosition();
  }
  function handleDrag(event, action, point) {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return;
    if (action === 'end') {
      if (drag) {
        drag = null;
        keepVisible();
      }
      return;
    }
    if (!isPosition(point)) return;
    if (action === 'start' && !drag) drag = { pointer: point, origin: win.getBounds() };
    if (action === 'move' && drag) {
      const target = { x: drag.origin.x + point.x - drag.pointer.x, y: drag.origin.y + point.y - drag.pointer.y };
      if (isPosition(target)) win.setPosition(target.x, target.y);
    }
  }
  ipcMain.on('pet:drag', handleDrag);
  win.on('move', () => {
    clearTimeout(saveTimer);
    // Avoid disk writes for every pointer update; close also flushes immediately.
    saveTimer = setTimeout(savePosition, 250);
  });
  const displayEvents = ['display-added', 'display-removed', 'display-metrics-changed'];
  for (const event of displayEvents) screen.on(event, keepVisible);
  win.on('close', savePosition);
  win.on('closed', () => {
    clearTimeout(saveTimer);
    ipcMain.removeListener('pet:drag', handleDrag);
    for (const event of displayEvents) screen.removeListener(event, keepVisible);
    petWindow = null;
  });

  // The renderer has only a narrow drag bridge and never opens external content.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.webContents.on('context-menu', () => {
    Menu.buildFromTemplate([{ label: 'BytePet 종료', role: 'quit' }]).popup({ window: win });
  });
  win.loadFile(path.join(__dirname, 'pet.html')).catch(error => {
    console.error('Could not load BytePet:', error);
    app.exit(1);
  });
  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'BytePet', submenu: [{ label: 'BytePet 종료', role: 'quit', accelerator: 'CommandOrControl+Q' }] },
  ]));
  createPetWindow();
  app.on('activate', () => {
    if (!petWindow) createPetWindow();
    else petWindow.showInactive();
  });
});

app.on('window-all-closed', () => app.quit());
