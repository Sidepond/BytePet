import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAppearanceStore, createAppearanceService } from '../desktop/appearance.cjs';

test('appearance: defaults, persisted values, corruption and atomic write failure', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'bytepet-appearance-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = createAppearanceStore(directory);
  assert.deepEqual(store.read(), { preferences: { ground: true, menuSide: 'left' }, warning: null });
  store.write({ ground: false, menuSide: 'right' });
  assert.deepEqual(createAppearanceStore(directory).read().preferences, { ground: false, menuSide: 'right' });
  const file = path.join(directory, 'appearance.json');
  for (const text of ['{broken', '{"version":1,"preferences":{"ground":1,"menuSide":"left"}}', '{"version":1,"preferences":{"ground":true,"menuSide":"bottom"}}']) {
    writeFileSync(file, text);
    assert.ok(store.read().warning);
    assert.deepEqual(store.read().preferences, { ground: true, menuSide: 'left' });
  }
  rmSync(file);
  mkdirSync(file);
  writeFileSync(path.join(file, 'keep'), 'preserve');
  assert.throws(() => store.write({ ground: false, menuSide: 'right' }));
  assert.equal(readFileSync(path.join(file, 'keep'), 'utf8'), 'preserve');
});

test('appearance: panel-only validated changes, failure preserves current layout, and notifications are isolated copies', () => {
  const handlers = new Map();
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) };
  const makeWindow = () => ({ isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: {}, send: () => {} } });
  const pet = makeWindow(), panel = makeWindow();
  const event = win => ({ sender: win.webContents, senderFrame: win.webContents.mainFrame });
  let fail = false, applied = 0;
  const service = createAppearanceService({
    ipcMain, getPet: () => pet, getPanel: () => panel,
    store: { read: () => ({ preferences: { ground: true, menuSide: 'left' }, warning: null }), write: () => { if (fail) throw new Error('disk'); } },
    apply: () => applied++,
  });
  const set = handlers.get('appearance:set');
  assert.equal(set(event(pet), { key: 'ground', value: false }).ok, false);
  for (const change of [null, { key: '__proto__', value: false }, { key: 'ground', value: 0 }, { key: 'menuSide', value: 'bottom' }]) {
    assert.equal(set(event(panel), change).ok, false);
  }
  assert.equal(set(event(panel), { key: 'menuSide', value: 'right' }).ok, true);
  fail = true;
  assert.equal(set(event(panel), { key: 'ground', value: false }).ok, false);
  assert.equal(applied, 1);
  assert.deepEqual(service.state().preferences, { ground: true, menuSide: 'right' });
  const snapshot = service.state(); snapshot.preferences.ground = false;
  assert.equal(service.state().preferences.ground, true);
  service.dispose();
  assert.equal(handlers.size, 0);
});
