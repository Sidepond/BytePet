import test from 'node:test';
import assert from 'node:assert/strict';
import { parseListeningPorts, listListeningPorts, getPortUrl, createPortService, PortError } from '../desktop/ports.cjs';

const record = (pid, name, sockets) => `p${pid}\0c${name}\0\n` + sockets.map((s, index) =>
  `f${index + 3}\0t${s.family || 'IPv4'}\0P${s.protocol || 'TCP'}\0n${s.name}\0\n`).join('');
const node = record(123, 'node', [{ name: '127.0.0.1:3000' }]);

test('ports: parses NUL fields, preserves names, groups addresses, and sorts port then PID', () => {
  const output = record(456, 'My Long Process', [
    { name: '*:8080' }, { name: '*:8080', family: 'IPv6' }, { name: '*:8080' },
    { name: '[::1]:3000', family: 'IPv6' }, { name: '127.0.0.1:3000' },
  ]) + node;
  const items = parseListeningPorts(output);
  assert.deepEqual(items.map(({ pid, port }) => [pid, port]), [[123, 3000], [456, 3000], [456, 8080]]);
  assert.equal(items[1].name, 'My Long Process');
  assert.equal(items[1].protocol, 'TCP');
  assert.deepEqual(items[1].addresses, [{ address: '127.0.0.1', family: 'IPv4' }, { address: '::1', family: 'IPv6' }]);
  assert.deepEqual(items[2].addresses, [{ address: '*', family: 'IPv4' }, { address: '*', family: 'IPv6' }]);
});

test('ports: ignores invalid records, connected sockets, non-TCP data, and resets process context', () => {
  const output = record('bad', 'ignored', [{ name: '*:3000' }])
    + record(9, 'bad sockets', [
      { name: '*:0' }, { name: '*:65536' }, { name: 'localhost:1234' },
      { name: '127.0.0.1:1234->127.0.0.1:5678' }, { name: '*:1234', protocol: 'UDP' },
      { name: '*:1234', family: 'unix' }, { name: 'broken' },
    ]) + 'p42\0\nf4\0tIPv4\0PTCP\0n*:8080\0\n';
  assert.deepEqual(parseListeningPorts(output), [{ pid: 42, port: 8080, name: '알 수 없음', protocol: 'TCP', addresses: [{ address: '*', family: 'IPv4' }] }]);
  assert.deepEqual(parseListeningPorts(''), []);
});

test('ports: executes only a fixed bounded macOS TCP listener query without a shell', async () => {
  const controller = new AbortController();
  const result = await listListeningPorts({ platform: 'darwin', signal: controller.signal, execute: async (file, args, options) => {
    assert.equal(file, '/usr/sbin/lsof');
    assert.deepEqual(args, ['-nP', '-a', '-iTCP', '-sTCP:LISTEN', '+c', '0', '-F0pcfntP']);
    assert.equal(options.shell, undefined);
    assert.equal(options.timeout, 5000);
    assert.equal(options.maxBuffer, 2 * 1024 * 1024);
    assert.equal(options.signal, controller.signal);
    assert.equal(options.env.LC_ALL, 'C');
    return { stdout: node, stderr: '' };
  } });
  assert.equal(result.items[0].port, 3000);
  assert.equal(result.warning, null);
  await assert.rejects(listListeningPorts({ platform: 'win32', execute: () => assert.fail('must not execute') }), /macOS/);
  for (const response of [{ stdout: '', stderr: '' }, { code: 1, stdout: '', stderr: '' }]) {
    const result = await listListeningPorts({ platform: 'darwin', execute: async () => { if (response.code) throw response; return response; } });
    assert.deepEqual(result, { items: [], warning: null });
  }
});

test('ports: distinguishes tool failures and incomplete results from an empty snapshot', async () => {
  for (const [error, message] of [
    [{ code: 'ENOENT' }, /시스템 도구/], [{ code: 'EACCES' }, /권한/], [{ killed: true }, /시간이 초과/],
    [{ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, /너무 커/], [{ name: 'AbortError' }, /취소/],
    [{ code: 1, stderr: 'permission denied' }, /조회하지 못/], [{ code: 2, stdout: node }, /조회하지 못/],
  ]) {
    await assert.rejects(listListeningPorts({ platform: 'darwin', execute: async () => { throw error; } }), message);
  }
  await assert.rejects(listListeningPorts({ platform: 'darwin', execute: async () => ({ stdout: 'unexpected output', stderr: '' }) }), /결과를 확인하지 못/);
  for (const error of [false, true]) {
    const result = await listListeningPorts({ platform: 'darwin', execute: async () => {
      const output = { stdout: node, stderr: 'some diagnostics' };
      if (error) throw { code: 1, ...output };
      return output;
    } });
    assert.equal(result.items.length, 1);
    assert.match(result.warning, /일부 항목/);
    assert.doesNotMatch(result.warning, /diagnostics/);
  }
});

test('ports: IPC checks the panel main frame, shares pending scans, retries, and aborts on disposal', async () => {
  let handler;
  const removed = [];
  let calls = 0;
  let finish;
  let scanSignal;
  const panel = { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: {} } };
  const event = { sender: panel.webContents, senderFrame: panel.webContents.mainFrame };
  const service = createPortService({
    ipcMain: { handle: (key, fn) => { if (key === 'ports:list') handler = fn; }, removeHandler: key => removed.push(key) },
    getPanel: () => panel,
    scan: ({ signal }) => {
      calls++;
      scanSignal = signal;
      return new Promise((resolve, reject) => {
        finish = resolve;
        signal.addEventListener('abort', () => reject(new PortError('포트 조회가 취소됐어요.')));
      });
    },
  });
  assert.equal(handler({}).ok, false);
  assert.equal(handler({ sender: panel.webContents, senderFrame: {} }).ok, false);
  assert.equal(calls, 0);
  const first = handler(event);
  const second = handler(event);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish({ items: parseListeningPorts(node), warning: null });
  assert.equal((await first).ok, true);
  assert.ok(Number.isFinite(Date.parse((await second).value.checkedAt)));
  const next = handler(event);
  await Promise.resolve();
  assert.equal(calls, 2);
  service.dispose();
  assert.equal(scanSignal.aborted, true);
  assert.deepEqual(removed, ['ports:list', 'ports:open']);
  assert.equal((await next).ok, false);
  assert.equal(handler(event).ok, false);
});


test('ports: browser URLs use bound IPs, map wildcard to loopback, and validate ports and hosts', () => {
  const url = (addresses, port = 3000) => getPortUrl({ port, protocol: 'TCP', addresses });
  const v4 = address => ({ address, family: 'IPv4' });
  const v6 = address => ({ address, family: 'IPv6' });
  for (const address of ['*', '0.0.0.0', '127.0.0.1']) assert.equal(url([v4(address)]), 'http://127.0.0.1:3000');
  for (const address of ['*', '::', '::1']) assert.equal(url([v6(address)]), 'http://[::1]:3000');
  assert.equal(url([v4('127.0.0.2')]), 'http://127.0.0.2:3000');
  assert.equal(url([v4('192.168.1.5')]), 'http://192.168.1.5:3000');
  assert.equal(url([v6('fd00::2')]), 'http://[fd00::2]:3000');
  assert.equal(url([v6('::1'), v4('*')]), 'http://127.0.0.1:3000');
  assert.equal(url([v4('192.168.1.5'), v6('::1')]), 'http://[::1]:3000');
  assert.equal(url([v4('*')], 65535), 'http://127.0.0.1:65535');
  for (const port of [0, 65536, -1, 1.5, NaN, '3000']) assert.equal(url([v4('*')], port), null);
  for (const address of ['localhost', 'example.com', '127.0.0.1/path', '127.0.0.1@evil.test', 'file:///tmp/x', '::1']) {
    assert.equal(url([v4(address)]), null);
  }
  assert.equal(url([v6('fe80::1%en0')]), null);
  assert.equal(url([]), null);
});

test('ports: opening uses only the latest trusted snapshot, rejects unauthorized requests, and handles retries', async () => {
  const handlers = new Map();
  const panel = { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: {} } };
  const event = { sender: panel.webContents, senderFrame: panel.webContents.mainFrame };
  const target = { pid: 123, port: 3000 };
  let items = parseListeningPorts(node);
  let scanError = false;
  const opened = [];
  let finish;
  let rejectOpen;
  const service = createPortService({
    ipcMain: { handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) },
    getPanel: () => panel,
    scan: async () => { if (scanError) throw new Error('private diagnostic'); return { items, warning: null }; },
    openExternal: url => {
      opened.push(url);
      return new Promise((resolve, reject) => { finish = resolve; rejectOpen = reject; });
    },
  });
  const list = handlers.get('ports:list');
  const open = handlers.get('ports:open');
  assert.equal((await open(event, target)).ok, false, 'must be listed first');
  const snapshot = await list(event);
  assert.equal(snapshot.value.items[0].url, 'http://127.0.0.1:3000');
  for (const sender of [{}, { sender: panel.webContents, senderFrame: {} }]) assert.equal((await open(sender, target)).ok, false);
  for (const input of [null, 'http://evil.test', {}, { pid: 123, port: '3000' }, { pid: 123, port: 0 }, { pid: 999, port: 3000 }]) {
    assert.equal((await open(event, input)).ok, false);
  }
  assert.deepEqual(opened, []);
  const pending = open(event, { ...target, url: 'file:///tmp/untrusted' });
  assert.equal((await open(event, target)).ok, false, 'no duplicate tabs while launch is pending');
  assert.deepEqual(opened, ['http://127.0.0.1:3000']);
  finish();
  assert.deepEqual(await pending, { ok: true, value: { url: 'http://127.0.0.1:3000' } });
  const failed = open(event, target);
  rejectOpen(new Error('private system error'));
  assert.match((await failed).error, /기본 브라우저를 열지 못/);
  scanError = true;
  assert.equal((await list(event)).ok, false);
  const retry = open(event, target);
  finish();
  assert.equal((await retry).ok, true, 'failed scans retain the displayed snapshot');
  scanError = false;
  items = [];
  await list(event);
  assert.equal((await open(event, target)).ok, false, 'removed rows are no longer openable');
  service.dispose();
  assert.equal(handlers.size, 0);
  assert.equal((await open(event, target)).ok, false);
});
