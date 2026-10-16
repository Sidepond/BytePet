const { app, BrowserWindow, Menu, screen, ipcMain, dialog } = require('electron');
const path = require('node:path');
const { getVisibleBounds, isPosition } = require('./window.cjs');
const { createPositionStore } = require('./position-store.cjs');
const { createPetInput } = require('./input.cjs');
const { createAppearanceStore } = require('./appearance.cjs');
const { createUtilityPanel } = require('./panel.cjs');
const { createStatusTray } = require('./tray.cjs');
const { createUsageFeature } = require('./usage.cjs');

app.setName('BytePet');
// Keep development and packaged builds on the same data directory. Explicit
// profiles (including desktop tests) remain isolated and keep their own lock.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', path.join(app.getPath('appData'), 'BytePet'));
}
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
let petWindow;
let petVisibility;
let statusTray;
let petActions;

function openSettings() {
  revealPet();
  petActions?.openSettings();
}

function resetPetPosition() {
  const result = petActions?.resetPosition();
  if (result?.warning) void dialog.showMessageBox({ type: 'warning', title: 'BytePet', message: result.message });
}

function toggleVisibility() {
  if (petVisibility) petVisibility.setHidden(!petVisibility.isHidden());
}

function updateVisibilityMenu(hidden) {
  statusTray?.refresh(hidden);
  const item = Menu.getApplicationMenu()?.getMenuItemById('toggle-pet-visibility');
  if (item) item.label = hidden ? '다시 표시' : '잠시 숨기기';
}

function createPetWindow() {
  let hidden = false;
  let ready = false;
  const appearanceStore = createAppearanceStore(app.getPath('userData'));
  const appearanceInitial = appearanceStore.read();
  let preferences = appearanceInitial.preferences;
  const store = createPositionStore(app.getPath('userData'));
  const visibleBounds = position => getVisibleBounds(position,
    screen.getAllDisplays().map(display => display.workArea), screen.getPrimaryDisplay().workArea, preferences);
  const win = new BrowserWindow({
    ...visibleBounds(store.read()),
    title: 'BytePet',
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    alwaysOnTop: true,
    acceptFirstMouse: true,
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
  const input = createPetInput(win, screen, preferences.ground);
  let usage;
  const panel = createUtilityPanel(win, {
    appearanceStore, appearanceInitial,
    resetPosition,
    applyAppearance(next) {
      if (preferences.ground === next.ground && preferences.menuSide === next.menuSide) {
        preferences = next;
        usage?.reposition();
        return;
      }
      const previous = win.getBounds();
      const catX = previous.x + (preferences.ground && preferences.menuSide === 'left' ? previous.width - 112 : 16);
      preferences = next;
      const area = screen.getDisplayMatching(previous).workArea;
      const width = Math.min(next.ground ? 496 : 128, area.width);
      const offset = next.ground && next.menuSide === 'left' ? width - 112 : 16;
      const bounds = visibleBounds({ x: catX - offset, y: previous.y });
      input.setGroundVisible(next.ground);
      win.setBounds(bounds);
      panel.reposition();
      savePosition();
    },
  });
  usage = createUsageFeature({ pet: win, getPanel: () => panel.window(),
    getAppearance: () => preferences, getCharacterBounds: () => input.characterBounds(), openPanel: () => panel.openUsage() });
  win.setAlwaysOnTop(true, 'floating');
  // Configure once: repeating this on show would briefly hide macOS windows.
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.once('ready-to-show', () => {
    ready = true;
    if (!hidden) win.showInactive();
  });
  let drag;
  let saveTimer;
  function savePosition() {
    clearTimeout(saveTimer);
    return !win.isDestroyed() && store.write(visibleBounds(win.getBounds()));
  }
  function resetPosition() {
    drag = null;
    input.hold('drag', false);
    win.webContents.send('pet:position-reset');
    win.setBounds(visibleBounds(null));
    panel.reposition();
    if (hidden) setHidden(false);
    else if (ready) win.showInactive();
    usage?.reposition();
    const saved = savePosition();
    return { warning: !saved, message: saved ? '기본 화면 오른쪽 아래로 옮겼어요.' : '위치는 옮겼지만 저장하지 못했어요. 다음 실행 때는 이전 위치로 돌아갈 수 있어요.' };
  }
  petActions = { openSettings: () => panel.openSettings(), resetPosition };
  function keepVisible() {
    if (win.isDestroyed()) return;
    const current = win.getBounds();
    const next = visibleBounds(current);
    if (Object.keys(next).some(key => current[key] !== next[key])) win.setBounds(next);
    panel.reposition();
    savePosition();
  }
  function setHidden(value) {
    if (win.isDestroyed() || hidden === value) return;
    hidden = value;
    if (hidden) {
      drag = null;
      input.hold('drag', false);
      panel.setSuspended(true);
      win.hide();
    } else {
      keepVisible();
      if (ready) win.showInactive();
      panel.setSuspended(false);
    }
    win.webContents.send('pet:visibility', !hidden);
    updateVisibilityMenu(hidden);
  }
  petVisibility = { setHidden, isHidden: () => hidden };
  updateVisibilityMenu(false);
  function handleDrag(event, action, point) {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return;
    if (hidden) return;
    if (action === 'end') {
      if (drag) {
        drag = null;
        keepVisible();
        input.hold('drag', false);
      }
      return;
    }
    if (!isPosition(point)) return;
    if (action === 'start' && !drag) {
      drag = { pointer: point, origin: win.getBounds() };
      input.hold('drag', true);
    }
    if (action === 'move' && drag) {
      const target = { x: drag.origin.x + point.x - drag.pointer.x, y: drag.origin.y + point.y - drag.pointer.y };
      if (isPosition(target)) win.setPosition(target.x, target.y);
    }
  }
  ipcMain.on('pet:drag', handleDrag);
  function handleHitRegion(event, region) {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return;
    input.update(region);
  }
  ipcMain.on('pet:hit-region', handleHitRegion);
  function resetInput() {
    drag = null;
    input.reset();
  }
  win.webContents.on('did-start-loading', resetInput);
  win.webContents.on('did-finish-load', () => win.webContents.send('pet:visibility', !hidden));
  win.webContents.on('render-process-gone', resetInput);
  win.on('move', () => {
    panel.reposition();
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
    ipcMain.removeListener('pet:hit-region', handleHitRegion);
    input.dispose();
    usage.dispose();
    panel.dispose();
    for (const event of displayEvents) screen.removeListener(event, keepVisible);
    petWindow = null;
    petVisibility = null;
    petActions = null;
  });

  // The renderer has only narrow pet input bridges and never opens external content.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.webContents.on('context-menu', (_event, params) => {
    if (!input.hits(params)) return;
    input.hold('menu', true);
    Menu.buildFromTemplate([
      { label: '설정…', click: openSettings },
      { label: '기본 위치로 되돌리기', click: resetPetPosition },
      { label: '잠시 숨기기', click: toggleVisibility },
      { type: 'separator' },
      { label: 'BytePet 종료', role: 'quit' },
    ]).popup({
      window: win,
      callback: () => input.hold('menu', false),
    });
  });
  win.loadFile(path.join(__dirname, 'pet.html')).catch(error => {
    console.error('Could not load BytePet:', error);
    app.exit(1);
  });
  return win;
}

function revealPet() {
  // Activation can arrive during startup or shutdown. Window creation belongs
  // only to the primary instance's ready handler, never to a relaunch event.
  if (!petWindow || petWindow.isDestroyed()) return;
  if (petVisibility.isHidden()) petVisibility.setHidden(false);
  else petWindow.showInactive();
}

if (primaryInstance) {
  app.on('second-instance', revealPet);
  app.on('activate', revealPet);
  app.whenReady().then(() => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'BytePet', submenu: [
        { id: 'open-settings', label: '설정…', accelerator: 'CommandOrControl+,', click: openSettings },
        { id: 'toggle-pet-visibility', label: '잠시 숨기기', click: toggleVisibility },
        { id: 'reset-pet-position', label: '기본 위치로 되돌리기', click: resetPetPosition },
        { type: 'separator' },
        { label: 'BytePet 종료', role: 'quit', accelerator: 'CommandOrControl+Q' },
      ] },
      { label: '편집', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    ]));
    createPetWindow();
    statusTray = createStatusTray(toggleVisibility, { openSettings, resetPosition: resetPetPosition });
  });
}

app.on('will-quit', () => {
  statusTray?.dispose();
  statusTray = null;
});
app.on('window-all-closed', () => app.quit());
