import test from 'node:test';
import assert from 'node:assert/strict';
import { parseListeningPorts, listListeningPorts, createPortService, PortError } from '../desktop/ports.cjs';

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
  let removed = false;
  let calls = 0;
  let finish;
  let scanSignal;
  const panel = { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: {} } };
  const event = { sender: panel.webContents, senderFrame: panel.webContents.mainFrame };
  const service = createPortService({
    ipcMain: { handle: (_key, fn) => { handler = fn; }, removeHandler: key => { assert.equal(key, 'ports:list'); removed = true; } },
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
  assert.equal(removed, true);
  assert.equal((await next).ok, false);
  assert.equal(handler(event).ok, false);
});
