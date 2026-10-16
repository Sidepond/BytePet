const fs = require('node:fs/promises');
const { constants, createWriteStream } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const TEXT_LIMIT = 1024 * 1024;
const FILE_LIMIT = 25 * 1024 * 1024;
const BATCH_LIMIT = 10;
const ID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
class FoodError extends Error {}
const safeName = name => Array.from(path.basename(String(name)).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')).slice(0, 160).join('') || 'file';

function createFoodStore(directory) {
  const mutations = new Map();
  const location = (id, trash = false) => path.join(directory, ...(trash ? ['.trash'] : []), id);
  function mutate(id, operation) {
    const previous = mutations.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    mutations.set(id, next);
    return next.finally(() => { if (mutations.get(id) === next) mutations.delete(id); });
  }
  async function commit(kind, name, write, preview = '', signal) {
    signal?.throwIfAborted();
    const id = randomUUID();
    const temporary = path.join(directory, `.pending-${id}`);
    const filename = kind === 'text' ? 'text.txt' : safeName(name);
    await fs.mkdir(path.join(temporary, 'content'), { recursive: true, mode: 0o700 });
    try {
      signal?.throwIfAborted();
      const destination = path.join(temporary, 'content', filename);
      const size = await write(destination);
      signal?.throwIfAborted();
      const item = { id, kind, name, filename, size, createdAt: new Date().toISOString(), preview };
      await fs.writeFile(path.join(temporary, 'meta.json'), JSON.stringify(item), { mode: 0o600, flag: 'wx' });
      signal?.throwIfAborted();
      await fs.rename(temporary, path.join(directory, id));
      return item;
    } catch (error) {
      await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }
  async function get(id, { signal, trash = false } = {}) {
    signal?.throwIfAborted();
    if (typeof id !== 'string' || !ID.test(id)) throw new FoodError('저장된 항목을 찾을 수 없어요.');
    const folder = location(id, trash);
    if (!(await fs.lstat(folder)).isDirectory()) throw new FoodError('보관함 항목을 읽을 수 없어요.');
    const expected = path.join(await fs.realpath(directory), ...(trash ? ['.trash'] : []), id);
    if (await fs.realpath(folder) !== expected) throw new FoodError('보관함 항목을 읽을 수 없어요.');
    const item = JSON.parse(await fs.readFile(path.join(folder, 'meta.json'), { encoding: 'utf8', signal }));
    if (item.id !== id || !['text', 'file'].includes(item.kind) || typeof item.name !== 'string' ||
      typeof item.filename !== 'string' || item.filename !== safeName(item.filename) || ['.', '..'].includes(item.filename) ||
      !Number.isSafeInteger(item.size) || item.size < 0 || !Number.isFinite(Date.parse(item.createdAt))) {
      throw new FoodError('보관함 항목을 읽을 수 없어요.');
    }
    signal?.throwIfAborted();
    const file = path.join(folder, 'content', item.filename);
    const resolved = await fs.realpath(file);
    const root = await fs.realpath(folder);
    if (!resolved.startsWith(root + path.sep) || !(await fs.stat(resolved)).isFile()) throw new FoodError('저장된 파일을 찾을 수 없어요.');
    signal?.throwIfAborted();
    return { item, file: resolved };
  }
  return {
    directory,
    async saveText(text, { signal } = {}) {
      signal?.throwIfAborted();
      if (typeof text !== 'string' || !text.trim()) throw new FoodError('먹일 텍스트를 입력해 주세요.');
      const size = Buffer.byteLength(text, 'utf8');
      if (size > TEXT_LIMIT) throw new FoodError('텍스트는 1MB까지 저장할 수 있어요.');
      return commit('text', text.trim().split(/\r?\n/)[0].slice(0, 60), async file => {
        await fs.writeFile(file, text, { mode: 0o600, flag: 'wx', signal });
        return size;
      }, text.slice(0, 160), signal);
    },
    async saveFile(source, { signal } = {}) {
      signal?.throwIfAborted();
      if (!source || typeof source.name !== 'string' || !source.name || source.name.length > 1024) throw new FoodError('파일 이름을 확인해 주세요.');
      if (source.oversized) throw new FoodError('파일은 개당 25MB까지 저장할 수 있어요.');
      return commit('file', source.name, async destination => {
        signal?.throwIfAborted();
        if (typeof source.path === 'string' && path.isAbsolute(source.path)) {
          if (!(await fs.lstat(source.path)).isFile()) throw new FoodError('폴더나 바로가기 대신 일반 파일을 선택해 주세요.');
          signal?.throwIfAborted();
          const handle = await fs.open(source.path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
          try {
            const stat = await handle.stat();
            signal?.throwIfAborted();
            if (!stat.isFile()) throw new FoodError('폴더 대신 파일을 선택해 주세요.');
            if (stat.size > FILE_LIMIT) throw new FoodError('파일은 개당 25MB까지 저장할 수 있어요.');
            let size = 0;
            const limiter = new Transform({ transform(chunk, _encoding, callback) {
              size += chunk.length;
              callback(size > FILE_LIMIT ? new FoodError('파일은 개당 25MB까지 저장할 수 있어요.') : null, chunk);
            } });
            await pipeline(handle.createReadStream(), limiter, createWriteStream(destination, { flags: 'wx', mode: 0o600 }), { signal });
            return size;
          } finally { await handle.close(); }
        }
        if (!(source.bytes instanceof Uint8Array)) throw new FoodError('파일을 읽을 수 없어요. 다시 선택해 주세요.');
        if (source.bytes.byteLength > FILE_LIMIT) throw new FoodError('파일은 개당 25MB까지 저장할 수 있어요.');
        await fs.writeFile(destination, source.bytes, { mode: 0o600, flag: 'wx', signal });
        return source.bytes.byteLength;
      }, '', signal);
    },
    async list({ signal, query = '', trash = false } = {}) {
      signal?.throwIfAborted();
      if (typeof query !== 'string' || query.length > 200) throw new FoodError('검색어는 200자까지 입력할 수 있어요.');
      const needle = query.trim().normalize('NFC').toLocaleLowerCase();
      let names;
      try { names = await fs.readdir(trash ? path.join(directory, '.trash') : directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      const items = [];
      for (const id of names.filter(name => ID.test(name))) {
        signal?.throwIfAborted();
        try {
          const { item, file } = await get(id, { signal, trash });
          let matches = !needle || item.name.normalize('NFC').toLocaleLowerCase().includes(needle);
          if (!matches && item.kind === 'text' && (await fs.stat(file)).size <= TEXT_LIMIT) {
            matches = (await fs.readFile(file, { encoding: 'utf8', signal })).normalize('NFC').toLocaleLowerCase().includes(needle);
          }
          if (matches) items.push(item);
        } catch { signal?.throwIfAborted(); /* A damaged item must not hide the rest of the shelf. */ }
      }
      return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    get,
    rename(id, name, { signal } = {}) {
      return mutate(id, async () => {
        if (typeof name !== 'string' || !name.trim() || name.trim().length > 160 || /[\x00-\x1f]/.test(name)) throw new FoodError('이름은 1~160자로 입력해 주세요.');
        const { item } = await get(id, { signal });
        const updated = { ...item, name: name.trim() };
        const temporary = path.join(location(id), `.meta-${randomUUID()}.tmp`);
        try {
          await fs.writeFile(temporary, JSON.stringify(updated), { flag: 'wx', mode: 0o600, signal });
          signal?.throwIfAborted();
          await fs.rename(temporary, path.join(location(id), 'meta.json'));
          return updated;
        } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
      });
    },
    moveToTrash(id, { signal } = {}) {
      return mutate(id, async () => {
        const { item } = await get(id, { signal });
        await fs.mkdir(path.join(directory, '.trash'), { recursive: true, mode: 0o700 });
        if (!(await fs.lstat(path.join(directory, '.trash'))).isDirectory()) throw new FoodError('휴지통을 열 수 없어요.');
        signal?.throwIfAborted();
        await fs.rename(location(id), location(id, true));
        return item;
      });
    },
    restore(id, { signal } = {}) {
      return mutate(id, async () => {
        const { item } = await get(id, { signal, trash: true });
        signal?.throwIfAborted();
        await fs.rename(location(id, true), location(id));
        return item;
      });
    },
    async readText(id, { signal, trash = false } = {}) {
      const { item, file } = await get(id, { signal, trash });
      if (item.kind !== 'text' || (await fs.stat(file)).size > TEXT_LIMIT) throw new FoodError('텍스트 항목만 불러올 수 있어요.');
      return fs.readFile(file, { encoding: 'utf8', signal });
    },
  };
}

module.exports = { createFoodStore, FoodError, TEXT_LIMIT, FILE_LIMIT, BATCH_LIMIT };
