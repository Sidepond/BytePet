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

test('food search covers full memo contents, Unicode normalization and names without reading ordinary files', async t => {
  const { store } = await fixture(t);
  const memo = await store.saveText('제목\n' + 'x'.repeat(200) + '\nHidden NEEDLE 한글');
  await store.saveFile({ name: 'photo.png', bytes: new Uint8Array([1, 2]) });
  assert.deepEqual((await store.list({ query: 'needle' })).map(item => item.id), [memo.id]);
  assert.deepEqual((await store.list({ query: '한글'.normalize('NFD') })).map(item => item.id), [memo.id]);
  assert.equal((await store.list({ query: 'PHOTO' })).length, 1);
  assert.deepEqual(await store.list({ query: 'missing' }), []);
  await assert.rejects(store.list({ query: 1 }), /검색어/);
  await assert.rejects(store.list({ query: 'x'.repeat(201) }), /200/);
});

test('food rename updates only the shelf label atomically, preserving bytes and the original filename', async t => {
  const { store, directory } = await fixture(t);
  const item = await store.saveFile({ name: 'original.png', bytes: new Uint8Array([4, 3, 2]) });
  const updated = await store.rename(item.id, '  새 사진  ');
  assert.equal(updated.name, '새 사진');
  assert.equal(updated.filename, item.filename);
  assert.deepEqual(await readFile((await store.get(item.id)).file), Buffer.from([4, 3, 2]));
  assert.equal((await createFoodStore(directory).list())[0].name, '새 사진');
  for (const name of ['', ' ', 'bad\nname', 'x'.repeat(161), null]) await assert.rejects(store.rename(item.id, name), /이름/);
  assert.equal((await store.get(item.id)).item.name, '새 사진');
  assert.equal((await readdir(path.join(directory, item.id))).some(name => name.startsWith('.meta-')), false);
});

test('food trash survives restart and restores the exact identity, label and bytes without another save', async t => {
  const { store, directory } = await fixture(t);
  const item = await store.saveText('  keep\r\n🐱');
  await store.rename(item.id, '보관할 메모');
  await store.moveToTrash(item.id);
  assert.deepEqual(await store.list(), []);
  await assert.rejects(store.get(item.id));
  const restarted = createFoodStore(directory);
  assert.equal((await restarted.list({ trash: true }))[0].name, '보관할 메모');
  assert.equal(await restarted.readText(item.id, { trash: true }), '  keep\r\n🐱');
  assert.equal((await restarted.list({ trash: true, query: 'keep' })).length, 1);
  await restarted.restore(item.id);
  assert.equal((await store.list())[0].id, item.id);
  assert.equal(await store.readText(item.id), '  keep\r\n🐱');
  assert.deepEqual(await store.list({ trash: true }), []);
  await assert.rejects(store.restore(item.id));
  assert.equal(await store.readText(item.id), '  keep\r\n🐱');
});

test('food mutations serialize per item and aborted writes cannot lose an existing item', async t => {
  const { store } = await fixture(t);
  const item = await store.saveText('safe');
  await Promise.all([store.rename(item.id, 'renamed'), store.moveToTrash(item.id)]);
  assert.equal((await store.list({ trash: true }))[0].name, 'renamed');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(store.restore(item.id, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal((await store.list({ trash: true })).length, 1);
  await store.restore(item.id);
  await assert.rejects(store.rename(item.id, 'lost', { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(store.moveToTrash(item.id, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal((await store.get(item.id)).item.name, 'renamed');
});

test('food rejects traversal and symlinked trash directories before moving data', async t => {
  const { symlink } = await import('node:fs/promises');
  const { root, directory, store } = await fixture(t);
  const item = await store.saveText('stay local');
  for (const operation of [() => store.rename('../escape', 'name'), () => store.moveToTrash('../escape'), () => store.restore('../escape')]) await assert.rejects(operation());
  const outside = path.join(root, 'outside'); await mkdir(outside);
  await symlink(outside, path.join(directory, '.trash'));
  await assert.rejects(store.moveToTrash(item.id), /휴지통/);
  assert.equal(await store.readText(item.id), 'stay local');
  assert.deepEqual(await readdir(outside), []);
});

test('food metadata write failure and restore collision preserve recoverable data', async t => {
  const fs = await import('node:fs/promises');
  const { store, directory } = await fixture(t);
  const item = await store.saveText('recover me');
  const originalRename = fs.default.rename;
  const failure = t.mock.method(fs.default, 'rename', async (source, destination) => {
    if (destination.endsWith('meta.json')) throw new Error('disk failure');
    return originalRename(source, destination);
  });
  await assert.rejects(store.rename(item.id, 'unsaved'), /disk failure/);
  failure.mock.restore();
  assert.equal((await store.get(item.id)).item.name, item.name);
  assert.deepEqual((await readdir(path.join(directory, item.id))).sort(), ['content', 'meta.json']);
  await store.moveToTrash(item.id);
  await mkdir(path.join(directory, item.id));
  await writeFile(path.join(directory, item.id, 'conflict'), 'keep collision');
  await assert.rejects(store.restore(item.id));
  assert.equal(await store.readText(item.id, { trash: true }), 'recover me');
  assert.equal(await readFile(path.join(directory, item.id, 'conflict'), 'utf8'), 'keep collision');
});
