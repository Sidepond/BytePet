const fs = require('node:fs');
const path = require('node:path');
const DEFAULTS = { ground: true, menuSide: 'left' };
const valid = value => value && typeof value.ground === 'boolean' && ['left', 'right'].includes(value.menuSide);

function createAppearanceStore(directory) {
  const file = path.join(directory, 'appearance.json');
  return {
    read() {
      try {
        if (fs.statSync(file).size > 16384) throw new Error('Settings too large');
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (saved?.version !== 1 || !valid(saved.preferences)) throw new Error('Invalid settings');
        return { preferences: { ground: saved.preferences.ground, menuSide: saved.preferences.menuSide }, warning: null };
      } catch (error) {
        return { preferences: { ...DEFAULTS }, warning: error.code === 'ENOENT' ? null : '화면 설정을 읽지 못해 기본값으로 시작했어요.' };
      }
    },
    write(preferences) {
      const temporary = `${file}.${process.pid}.tmp`;
      try {
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(temporary, JSON.stringify({ version: 1, preferences }) + '\n', { mode: 0o600 });
        fs.renameSync(temporary, file);
      } catch (error) {
        try { fs.unlinkSync(temporary); } catch { /* No pending file. */ }
        throw error;
      }
    },
  };
}

function createAppearanceService({ ipcMain, store, initial = store.read(), getPet, getPanel, apply }) {
  let { preferences, warning } = initial;
  let revision = 0;
  const state = () => ({ preferences: { ...preferences }, warning, revision });
  function from(event, win) {
    return win && !win.isDestroyed() && !win.webContents.isDestroyed() &&
      event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame;
  }
  ipcMain.handle('appearance:get', event => {
    if (!from(event, getPet()) && !from(event, getPanel())) return { ok: false, error: '허용되지 않은 요청이에요.' };
    return { ok: true, value: state() };
  });
  ipcMain.handle('appearance:set', (event, change) => {
    if (!from(event, getPanel())) return { ok: false, error: '허용되지 않은 요청이에요.' };
    if (!change || typeof change.key !== 'string' || !Object.hasOwn(DEFAULTS, change.key) ||
        (change.key === 'ground' ? typeof change.value !== 'boolean' : !['left', 'right'].includes(change.value))) {
      return { ok: false, error: '올바른 화면 설정을 선택해 주세요.' };
    }
    const next = { ...preferences, [change.key]: change.value };
    try { store.write(next); }
    catch { return { ok: false, error: '화면 설정을 저장하지 못했어요. 기존 설정을 유지합니다.' }; }
    preferences = next;
    warning = null;
    revision++;
    apply(next);
    for (const win of [getPet(), getPanel()]) {
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('appearance:changed', state());
    }
    return { ok: true, value: state() };
  });
  return { state, dispose() { ipcMain.removeHandler('appearance:get'); ipcMain.removeHandler('appearance:set'); } };
}
module.exports = { createAppearanceStore, createAppearanceService };
