const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { normalizeCodex } = require('./usage-data.cjs');
class UsageError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function findCodex(env = process.env, home = os.homedir()) {
  const directories = [...(env.PATH || '').split(path.delimiter), path.join(home, '.local/bin'), path.join(home, '.npm-global/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/Applications/Codex.app/Contents/Resources'];
  for (const dir of directories) {
    if (!path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, 'codex');
    try { fs.accessSync(candidate, fs.constants.X_OK); if (fs.statSync(candidate).isFile()) return candidate; } catch {}
  }
  return null;
}
function readCodexUsage({ executable = findCodex(), signal, spawnProcess = spawn, timeoutMs = 15000 } = {}) {
  if (!executable) return Promise.reject(new UsageError('unavailable', 'Codex CLI를 설치하고 ChatGPT 계정으로 로그인해 주세요.'));
  return new Promise((resolve, reject) => {
    let child, buffer = '', bytes = 0, settled = false, timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (child) {
        child.stdin.end();
        child.kill();
        const killTimer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 1000);
        killTimer.unref();
        child.once('exit', () => clearTimeout(killTimer));
      }
      if (error) reject(error); else resolve(value);
    };
    const fail = () => finish(new UsageError('error', 'Codex 사용량을 조회하지 못했어요. CLI 로그인 상태를 확인해 주세요.'));
    const abort = () => finish(new UsageError('cancelled', '조회를 취소했어요.'));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(new UsageError('error', 'Codex 응답이 늦어지고 있어요. 잠시 후 다시 확인해 주세요.')), timeoutMs);
    try {
      child = spawnProcess(executable, ['app-server', '--listen', 'stdio://'], {
        cwd: os.homedir(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      });
    } catch { fail(); return; }
    child.on('error', fail);
    child.on('exit', () => { if (!settled) fail(); });
    child.stdin.on('error', () => { if (!settled) fail(); });
    // Drain diagnostic output without storing or exposing account information.
    child.stderr.on('data', () => {});
    const send = message => { if (!settled) child.stdin.write(JSON.stringify(message) + '\n'); };
    child.stdout.on('data', chunk => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) { fail(); return; }
      buffer += chunk.toString();
      let newline;
      while (!settled && (newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let response;
        try { response = JSON.parse(line); } catch { fail(); return; }
        if (response.error && [1, 2, 3].includes(response.id)) { fail(); return; }
        if (response.id === 1) {
          send({ method: 'initialized' });
          send({ id: 2, method: 'account/read', params: { refreshToken: false } });
        } else if (response.id === 2) {
          const account = response.result?.account;
          if (!account) { finish(new UsageError('unavailable', 'Codex CLI에서 ChatGPT 계정으로 로그인해 주세요.')); return; }
          if (account.type !== 'chatgpt') { finish(new UsageError('unavailable', 'ChatGPT 구독으로 로그인한 Codex의 한도를 표시해요.')); return; }
          send({ id: 3, method: 'account/rateLimits/read' });
        } else if (response.id === 3) {
          const windows = normalizeCodex(response.result);
          if (!windows.length) finish(new UsageError('unavailable', '이 계정에서 조회 가능한 구독 한도가 없어요.'));
          else finish(null, { windows, updatedAt: Date.now() });
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'bytepet_usage', title: 'BytePet usage', version: '0.1.0' } } });
  });
}
module.exports = { readCodexUsage, findCodex, UsageError };
