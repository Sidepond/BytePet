const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { isIP } = require('node:net');

const executeFile = promisify(execFile);
const LSOF_ARGS = ['-nP', '-a', '-iTCP', '-sTCP:LISTEN', '+c', '0', '-F0pcfntP'];
class PortError extends Error {}

function parseListeningPorts(output) {
  const entries = new Map();
  let pid = null;
  let command = '';
  let socket = null;
  function finishSocket() {
    if (!pid || !socket || socket.protocol !== 'TCP' || !['IPv4', 'IPv6'].includes(socket.family)) return;
    const match = /^(.*):([0-9]+)$/.exec(socket.name || '');
    if (!match) return;
    const address = match[1].replace(/^\[(.*)\]$/, '$1');
    const port = Number(match[2]);
    if ((!isIP(address) && address !== '*') || port < 1 || port > 65535) return;
    const key = `${pid}:${port}`;
    if (!entries.has(key)) entries.set(key, { pid, port, name: command || '알 수 없음', protocol: 'TCP', addresses: [] });
    const entry = entries.get(key);
    if (!entry.addresses.some(value => value.address === address && value.family === socket.family)) {
      entry.addresses.push({ address, family: socket.family });
    }
  }
  // -F0 fields are NUL-terminated; process/file records also end with a newline.
  for (const raw of output.split('\0')) {
    const field = raw.replace(/^\n/, '');
    const value = field.slice(1);
    switch (field[0]) {
      case 'p':
        finishSocket();
        socket = null;
        pid = /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
        command = '';
        break;
      case 'c': command = value; break;
      case 'f': finishSocket(); socket = {}; break;
      case 't': if (socket) socket.family = value; break;
      case 'P': if (socket) socket.protocol = value; break;
      case 'n': if (socket) socket.name = value; break;
    }
  }
  finishSocket();
  for (const entry of entries.values()) entry.addresses.sort((a, b) => a.family.localeCompare(b.family) || a.address.localeCompare(b.address));
  return [...entries.values()].sort((a, b) => a.port - b.port || a.pid - b.pid);
}

async function listListeningPorts({ execute = executeFile, platform = process.platform, signal } = {}) {
  if (platform !== 'darwin') throw new PortError('개발 포트 조회는 현재 macOS에서 지원해요.');
  let stdout = '';
  let stderr = '';
  let partial = false;
  try {
    ({ stdout, stderr } = await execute('/usr/sbin/lsof', LSOF_ARGS, {
      encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' }, signal,
    }));
  } catch (error) {
    if (error.code === 1) {
      partial = true;
      stdout = error.stdout || '';
      stderr = error.stderr || '';
      if (!stdout.trim() && !stderr.trim()) return { items: [], warning: null };
      if (!stdout.trim()) throw new PortError('포트를 조회하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } else if (error.name === 'AbortError') throw new PortError('포트 조회가 취소됐어요.');
    else if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new PortError('조회 결과가 너무 커요. 실행 중인 앱을 확인한 뒤 다시 시도해 주세요.');
    else if (error.killed) throw new PortError('포트 조회 시간이 초과됐어요. 다시 시도해 주세요.');
    else if (error.code === 'ENOENT') throw new PortError('포트 조회에 필요한 시스템 도구를 찾지 못했어요.');
    else if (error.code === 'EACCES' || error.code === 'EPERM') throw new PortError('포트 조회 권한이 없어요. 앱의 실행 권한을 확인해 주세요.');
    else throw new PortError('포트를 조회하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  const items = parseListeningPorts(stdout);
  if (!items.length && (stdout.trim() || stderr.trim())) throw new PortError('포트 조회 결과를 확인하지 못했어요. 다시 시도해 주세요.');
  return { items, warning: partial || stderr.trim() ? '일부 항목을 조회하지 못했을 수 있어요. 새로고침으로 다시 확인해 주세요.' : null };
}

function getPortUrl(item) {
  if (!Number.isInteger(item.port) || item.port < 1 || item.port > 65535 || item.protocol !== 'TCP') return null;
  const candidates = [];
  for (const { address, family } of item.addresses) {
    const version = family === 'IPv4' ? 4 : family === 'IPv6' ? 6 : 0;
    if (!version || (address !== '*' && isIP(address) !== version)) continue;
    const wildcard = address === '*' || address === '0.0.0.0' || address === '::';
    const host = wildcard ? (version === 4 ? '127.0.0.1' : '::1') : address;
    const loopback = host.startsWith('127.') || host === '::1';
    // Prefer loopback, then IPv4; scoped IPv6 addresses are not browser URL hosts.
    try {
      const url = `http://${version === 6 ? `[${host}]` : host}:${item.port}`;
      new URL(url);
      candidates.push({ url, rank: (loopback ? 0 : 2) + (version === 4 ? 0 : 1) });
    } catch { /* No browser-compatible address for this socket. */ }
  }
  return candidates.sort((a, b) => a.rank - b.rank)[0]?.url || null;
}

function createPortService({ ipcMain, getPanel, scan = listListeningPorts, openExternal }) {
  let pending = null;
  let controller = null;
  let disposed = false;
  let snapshot = [];
  let opening = false;
  function allowed(event) {
    const panel = getPanel();
    return !disposed && panel && !panel.isDestroyed() && !panel.webContents.isDestroyed()
      && event.sender === panel.webContents && event.senderFrame === panel.webContents.mainFrame;
  }
  ipcMain.handle('ports:list', event => {
    if (!allowed(event)) return { ok: false, error: '허용되지 않은 요청이에요.' };
    if (!pending) {
      controller = new AbortController();
      const signal = controller.signal;
      pending = Promise.resolve().then(() => scan({ signal }))
        .then(value => {
          if (disposed) throw new PortError('포트 조회가 취소됐어요.');
          snapshot = value.items.map(item => ({ ...item, url: getPortUrl(item) }));
          return { ok: true, value: { ...value, items: snapshot, checkedAt: new Date().toISOString() } };
        })
        .catch(error => ({ ok: false, error: error instanceof PortError ? error.message : '포트를 조회하지 못했어요. 다시 시도해 주세요.' }))
        .finally(() => { pending = null; controller = null; });
    }
    return pending;
  });
  ipcMain.handle('ports:open', async (event, target) => {
    if (!allowed(event)) return { ok: false, error: '허용되지 않은 요청이에요.' };
    if (!target || !Number.isSafeInteger(target.pid) || target.pid < 1
      || !Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
      return { ok: false, error: '올바른 포트 항목을 선택해 주세요.' };
    }
    // Resolve exclusively from the main process snapshot, never a renderer-supplied URL.
    const item = snapshot.find(item => item.pid === target.pid && item.port === target.port);
    if (!item?.url) return { ok: false, error: '열 수 있는 주소가 없어요. 목록을 새로고침해 주세요.' };
    if (opening) return { ok: false, error: '브라우저를 여는 중이에요. 잠시 후 다시 시도해 주세요.' };
    opening = true;
    try {
      await openExternal(item.url);
      return { ok: true, value: { url: item.url } };
    } catch {
      return { ok: false, error: '기본 브라우저를 열지 못했어요. 브라우저 설정을 확인하고 다시 시도해 주세요.' };
    } finally { opening = false; }
  });
  return { dispose() {
    disposed = true;
    snapshot = [];
    controller?.abort();
    ipcMain.removeHandler('ports:list');
    ipcMain.removeHandler('ports:open');
  } };
}

module.exports = { parseListeningPorts, listListeningPorts, getPortUrl, createPortService, PortError };
