const fs = require('node:fs');
const path = require('node:path');
const DEFAULTS = { m01: true, m02: true };

function createModuleStore(directory) {
  const file = path.join(directory, 'modules.json');
  return {
    read() {
      try {
        if (fs.statSync(file).size > 16384) throw new Error('Settings too large');
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (saved?.version !== 1 || !Object.keys(DEFAULTS).every(key => typeof saved.modules?.[key] === 'boolean')) throw new Error('Invalid settings');
        return { modules: { m01: saved.modules.m01, m02: saved.modules.m02 }, warning: null };
      } catch (error) {
        return { modules: { ...DEFAULTS }, warning: error.code === 'ENOENT' ? null : '설정을 읽지 못해 기본값으로 시작했어요. 원하는 설정을 다시 저장해 주세요.' };
      }
    },
    write(modules) {
      const temporary = `${file}.${process.pid}.tmp`;
      try {
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(temporary, JSON.stringify({ version: 1, modules }) + '\n', { mode: 0o600 });
        fs.renameSync(temporary, file);
      } catch (error) {
        try { fs.unlinkSync(temporary); } catch { /* No pending file. */ }
        throw error;
      }
    },
  };
}

function createModuleService({ ipcMain, store, getPet, getPanel }) {
  let { modules, warning } = store.read();
  let revision = 0;
  const epochs = { m01: 0, m02: 0 };
  const listeners = new Set();
  const state = () => ({ modules: { ...modules }, warning, revision, epochs: { ...epochs } });
  function from(event, win) {
    return win && !win.isDestroyed() && !win.webContents.isDestroyed()
      && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame;
  }
  ipcMain.handle('modules:get', event => {
    if (!from(event, getPet()) && !from(event, getPanel())) return { ok: false, error: '허용되지 않은 요청이에요.' };
    return { ok: true, value: state() };
  });
  ipcMain.handle('modules:set', (event, change) => {
    if (!from(event, getPanel())) return { ok: false, error: '허용되지 않은 요청이에요.' };
    if (!change || typeof change.key !== 'string' || !Object.hasOwn(DEFAULTS, change.key) || typeof change.enabled !== 'boolean') return { ok: false, error: '올바른 모듈 설정을 선택해 주세요.' };
    const next = { ...modules, [change.key]: change.enabled };
    try { store.write(next); }
    catch { return { ok: false, error: '설정을 저장하지 못했어요. 기존 설정을 유지합니다. 디스크 공간과 파일 권한을 확인해 주세요.' }; }
    if (modules[change.key] !== change.enabled) epochs[change.key]++;
    modules = next;
    warning = null;
    revision++;
    for (const listener of listeners) listener(state());
    for (const win of [getPet(), getPanel()]) {
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('modules:changed', state());
    }
    return { ok: true, value: state() };
  });
  return { state, enabled: key => modules[key], subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { listeners.clear(); ipcMain.removeHandler('modules:get'); ipcMain.removeHandler('modules:set'); } };
}

module.exports = { createModuleStore, createModuleService };
