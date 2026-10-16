import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppPreferences, registerAppPreferences } from '../desktop/app-preferences.cjs';

function fixture(options = {}) {
  let current = { openAtLogin: false, status: 'not-registered' }, writes = [], copied;
  const app = {
    isPackaged: true, getVersion: () => '0.1.0', commandLine: { hasSwitch: () => false },
    getLoginItemSettings: () => current,
    setLoginItemSettings: value => { writes.push(value); current = { openAtLogin: value.openAtLogin, status: value.openAtLogin ? 'enabled' : 'not-registered' }; },
  };
  const clipboard = { writeText: async text => { copied = text; } };
  const service = createAppPreferences({ app, clipboard, platform: 'darwin', arch: 'arm64', systemVersion: '26.0', resetPosition: () => ({ message: 'reset' }), ...options });
  return { app, clipboard, service, writes, set current(value) { current = value; }, get copied() { return copied; } };
}

test('app preferences: native login state, explicit changes, pending approval and external changes', () => {
  const f = fixture();
  assert.equal(f.service.state().login.enabled, false);
  assert.equal(f.writes.length, 0, 'reading settings never registers a login item');
  assert.equal(f.service.setLogin(true).login.enabled, true);
  assert.deepEqual(f.writes, [{ openAtLogin: true }]);
  f.current = { openAtLogin: false, status: 'requires-approval' };
  assert.equal(f.service.state().login.status, 'requires-approval');
  assert.equal(f.service.state().login.enabled, true, 'pending registration can still be removed');
  assert.match(f.service.state().login.message, /시스템 설정/);
  assert.equal(f.service.setLogin(false).login.enabled, false);
  f.current = { openAtLogin: true, status: 'enabled' };
  assert.equal(f.service.state().login.enabled, true, 'always reads OS changes');
});

test('app preferences: unsupported, development and isolated profiles never call the OS login APIs', () => {
  for (const mode of ['platform', 'development', 'profile']) {
    const f = fixture(mode === 'platform' ? { platform: 'linux' } : {});
    if (mode === 'development') f.app.isPackaged = false;
    if (mode === 'profile') f.app.commandLine.hasSwitch = () => true;
    f.app.getLoginItemSettings = () => { throw new Error('must not read'); };
    assert.equal(f.service.state().login.status, 'unavailable');
    assert.throws(() => f.service.setLogin(true));
    assert.deepEqual(f.writes, []);
  }
});

test('app preferences: malformed requests and OS failures do not report false success', () => {
  const f = fixture();
  for (const value of [undefined, null, 1, 'true', {}]) assert.throws(() => f.service.setLogin(value));
  assert.deepEqual(f.writes, []);
  f.app.setLoginItemSettings = () => { throw new Error('native error'); };
  assert.throws(() => f.service.setLogin(true), /변경하지 못/);
  f.app.setLoginItemSettings = () => {};
  assert.throws(() => f.service.setLogin(true), /적용되지/);
  f.app.getLoginItemSettings = () => { throw new Error('query failed'); };
  assert.equal(f.service.state().login.status, 'error');
  assert.throws(() => f.service.setLogin(true), /확인하지 못/);
});

test('app preferences: environment copy is explicit, minimal and awaits clipboard completion', async () => {
  const f = fixture();
  f.service.state(); assert.equal(f.copied, undefined);
  await f.service.copyInfo();
  assert.equal(f.copied, 'BytePet 0.1.0\nmacOS 26.0 (arm64)\n실행: 앱');
  f.clipboard.writeText = async () => { throw new Error('denied'); };
  await assert.rejects(f.service.copyInfo(), /복사하지 못/);
});

test('app preferences: every IPC action is restricted to the live panel main frame', async () => {
  const handlers = new Map();
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) };
  const panel = { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: {} } };
  const f = fixture();
  const registration = registerAppPreferences({ ipcMain, getPanel: () => panel, service: f.service });
  for (const handle of handlers.values()) {
    assert.equal((await handle({ sender: {}, senderFrame: panel.webContents.mainFrame }, true)).ok, false);
    assert.equal((await handle({ sender: panel.webContents, senderFrame: {} }, true)).ok, false);
  }
  const event = { sender: panel.webContents, senderFrame: panel.webContents.mainFrame };
  assert.equal((await handlers.get('app-preferences:login')(event, true)).ok, true);
  assert.equal((await handlers.get('app-preferences:reset-position')(event)).value.message, 'reset');
  assert.equal((await handlers.get('app-preferences:login')(event, 'bad')).ok, false);
  panel.isDestroyed = () => true;
  assert.equal((await handlers.get('app-preferences:get')(event)).ok, false);
  registration.dispose(); assert.equal(handlers.size, 0);
});
