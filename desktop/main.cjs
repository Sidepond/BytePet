const { app, BrowserWindow, Menu, screen } = require('electron');
const path = require('node:path');
const { getInitialBounds } = require('./window.cjs');

app.setName('BytePet');
let petWindow;

function createPetWindow() {
  const win = new BrowserWindow({
    ...getInitialBounds(screen.getPrimaryDisplay().workArea),
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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  petWindow = win;
  win.setAlwaysOnTop(true, 'floating');
  win.once('ready-to-show', () => win.showInactive());
  win.on('closed', () => { petWindow = null; });

  // The renderer has no OS bridge and never opens external content.
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
