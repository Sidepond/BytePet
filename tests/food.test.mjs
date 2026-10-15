import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, open } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createFoodStore, TEXT_LIMIT, FILE_LIMIT } from '../desktop/food-store.cjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'bytepet-food-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'shelf');
  return { root, directory, store: createFoodStore(directory) };
}

test('food preserves exact UTF-8 text and reloads from a fresh store', async t => {
  const { store, directory } = await fixture(t);
  const text = '  고양이 🐱\n{"message":"안녕"}\r\n';
  const item = await store.saveText(text);
  const restarted = createFoodStore(directory);
  assert.equal((await restarted.list()).length, 1);
  assert.equal(await restarted.readText(item.id), text);
  assert.equal(item.size, Buffer.byteLength(text));
});

test('food copies files byte-for-byte without overwriting sources or same-named entries', async t => {
  const { root, store } = await fixture(t);
  const source = path.join(root, '사진.png');
  const bytes = Buffer.from([137, 80, 78, 71, 0, 255, 1, 2]);
  await writeFile(source, bytes);
  const first = await store.saveFile({ path: source, name: '사진.png' });
  const second = await store.saveFile({ path: source, name: '사진.png' });
  assert.notEqual(first.id, second.id);
  assert.deepEqual(await readFile((await store.get(first.id)).file), bytes);
  assert.deepEqual(await readFile(source), bytes);
  assert.equal((await store.list()).length, 2);
});

test('clipboard image bytes are stored without decoding or changing the original', async t => {
  const { store } = await fixture(t);
  const bytes = new Uint8Array([0, 128, 255, 4]);
  const item = await store.saveFile({ name: 'clipboard.png', bytes });
  assert.deepEqual(await readFile((await store.get(item.id)).file), Buffer.from(bytes));
});

test('blank text, UTF-8 byte overflow, and oversized files do not create visible entries', async t => {
  const { root, store } = await fixture(t);
  await assert.rejects(store.saveText(' \n\t'), /입력/);
  await assert.rejects(store.saveText('한'.repeat(Math.ceil(TEXT_LIMIT / 3))), /1MB/);
  const source = path.join(root, 'large.bin');
  const handle = await open(source, 'w');
  await handle.truncate(FILE_LIMIT + 1);
  await handle.close();
  await assert.rejects(store.saveFile({ path: source, name: 'large.bin' }), /25MB/);
  await assert.rejects(store.saveFile({ name: 'large.png', oversized: true }), /25MB/);
  assert.deepEqual(await store.list(), []);
});

test('copy failures and folders leave no partially saved item', async t => {
  const { root, directory, store } = await fixture(t);
  await assert.rejects(store.saveFile({ path: path.join(root, 'missing'), name: 'missing' }));
  await assert.rejects(store.saveFile({ path: root, name: 'folder' }), /폴더/);
  assert.deepEqual(await readdir(directory), []);
});

test('damaged metadata and abandoned pending writes do not hide healthy items', async t => {
  const { directory, store } = await fixture(t);
  const good = await store.saveText('good');
  const bad = await store.saveText('bad');
  await writeFile(path.join(directory, bad.id, 'meta.json'), '{broken');
  await mkdir(path.join(directory, '.pending-abandoned'));
  assert.deepEqual((await store.list()).map(item => item.id), [good.id]);
  await assert.rejects(store.get('../outside'));
  await writeFile(path.join(directory, good.id, 'meta.json'), JSON.stringify({ ...good, filename: '../outside' }));
  await assert.rejects(store.get(good.id));
});

test('storage failures preserve previously saved entries', async t => {
  const { directory, store } = await fixture(t);
  const saved = await store.saveText('keep me');
  const broken = createFoodStore((await store.get(saved.id)).file);
  await assert.rejects(broken.saveText('cannot save inside a file'));
  assert.equal(await createFoodStore(directory).readText(saved.id), 'keep me');
});
