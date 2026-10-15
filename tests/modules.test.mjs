import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createModuleStore, createModuleService } from '../desktop/modules.cjs';
import { createFoodStore } from '../desktop/food-store.cjs';
import { createPortService } from '../desktop/ports.cjs';

async function directory(t) {
  const folder = await mkdtemp(path.join(tmpdir(), 'bytepet-modules-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

test('modules: defaults, exact booleans, persisted restart, corruption and atomic write failure', async t => {
  const folder = await directory(t);
  const store = createModuleStore(folder);
  assert.deepEqual(store.read(), { modules: { m01: true, m02: true }, warning: null });
  store.write({ m01: false, m02: true });
  assert.deepEqual(createModuleStore(folder).read().modules, { m01: false, m02: true });
  for (const contents of ['broken', JSON.stringify({ version: 1, modules: { m01: 'false', m02: false } }), JSON.stringify({ version: 2, modules: { m01: false, m02: false } })]) {
    await writeFile(path.join(folder, 'modules.json'), contents);
    assert.ok(store.read().warning);
    assert.deepEqual(store.read().modules, { m01: true, m02: true });
  }
  store.write({ m01: false, m02: false });
  const before = await readFile(path.join(folder, 'modules.json'), 'utf8');
  await mkdir(path.join(folder, `modules.json.${process.pid}.tmp`));
  assert.throws(() => store.write({ m01: true, m02: true }));
  assert.equal(await readFile(path.join(folder, 'modules.json'), 'utf8'), before);
});

test('modules: panel-only mutation, immutable snapshots, independent epochs and failed saves keep runtime state', () => {
  const handlers = new Map();
  const messages = [];
  const win = () => ({ isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: {}, send: (...args) => messages.push(args) } });
  const pet = win(); const panel = win();
  const event = w => ({ sender: w.webContents, senderFrame: w.webContents.mainFrame });
  let broken = false;
  let changed = 0;
  const service = createModuleService({
    ipcMain: { handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) }, getPet: () => pet, getPanel: () => panel,
    store: { read: () => ({ modules: { m01: true, m02: true }, warning: null }), write: () => { if (broken) throw new Error('disk full'); } },
  });
  service.subscribe(() => changed++);
  const set = handlers.get('modules:set'); const get = handlers.get('modules:get');
  assert.equal(get(event(pet)).ok, true);
  for (const sender of [{}, event(pet), { sender: panel.webContents, senderFrame: {} }]) assert.equal(set(sender, { key: 'm01', enabled: false }).ok, false);
  for (const change of [null, {}, { key: '__proto__', enabled: false }, { key: 'm03', enabled: true }, { key: 'm01', enabled: 0 }]) assert.equal(set(event(panel), change).ok, false);
  assert.equal(changed, 0);
  assert.equal(set(event(panel), { key: 'm01', enabled: false }).ok, true);
  assert.equal(service.enabled('m01'), false);
  assert.equal(service.enabled('m02'), true);
  assert.deepEqual(service.state().epochs, { m01: 1, m02: 0 });
  assert.equal(messages.length, 2);
  const copy = get(event(panel)).value;
  copy.modules.m01 = true;
  assert.equal(service.enabled('m01'), false);
  broken = true;
  assert.equal(set(event(panel), { key: 'm01', enabled: true }).ok, false);
  assert.equal(service.enabled('m01'), false);
  assert.equal(changed, 1);
  assert.equal(messages.length, 2);
  service.dispose();
  assert.equal(handlers.size, 0);
});

test('modules: interrupted food writes clean pending files and preserve committed food', async t => {
  const folder = await directory(t);
  const store = createFoodStore(folder);
  await store.saveText('already saved');
  const controller = new AbortController();
  const write = fs.writeFile;
  let finish;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const mock = t.mock.method(fs, 'writeFile', async (...args) => {
    if (String(args[0]).endsWith('text.txt') && args[1] === 'cancel this') {
      entered();
      await new Promise(resolve => { finish = resolve; });
    }
    return write(...args);
  });
  const pending = store.saveText('cancel this', { signal: controller.signal });
  await started;
  controller.abort();
  finish();
  await assert.rejects(pending, { name: 'AbortError' });
  mock.mock.restore();
  assert.equal((await store.list()).length, 1);
  assert.equal((await readdir(folder)).some(name => name.startsWith('.pending-')), false);
  await assert.rejects(store.saveFile({ name: 'image.png', bytes: new Uint8Array([1, 2]) }, { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(store.list({ signal: controller.signal }), { name: 'AbortError' });
  assert.equal((await store.saveText('resumed')).preview, 'resumed');
});

test('modules: turning ports off aborts queries, blocks all operations and rejects stale results after re-enable', async () => {
  const handlers = new Map();
  const panel = { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: {} } };
  const event = { sender: panel.webContents, senderFrame: panel.webContents.mainFrame };
  const scans = [];
  const service = createPortService({
    ipcMain: { handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) }, getPanel: () => panel,
    inspect: async () => new Map(),
    scan: ({ signal }) => new Promise(resolve => scans.push({ signal, resolve })),
    openExternal: () => assert.fail('must not open'), confirm: () => assert.fail('must not confirm'),
  });
  const list = handlers.get('ports:list');
  const old = list(event);
  await new Promise(resolve => setImmediate(resolve));
  service.setEnabled(false);
  assert.equal(scans[0].signal.aborted, true);
  for (const key of ['ports:list', 'ports:open', 'ports:terminate']) assert.equal((await handlers.get(key)(event, { pid: 999, port: 3000 })).ok, false);
  assert.equal(scans.length, 1);
  service.setEnabled(true);
  const current = list(event);
  await new Promise(resolve => setImmediate(resolve));
  scans[0].resolve({ items: [], warning: null });
  assert.equal((await old).ok, false);
  assert.equal(list(event), current, 'stale cleanup must not clear a newer request');
  scans[1].resolve({ items: [], warning: null });
  assert.equal((await current).ok, true);
  service.dispose();
});
