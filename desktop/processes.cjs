const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const executeFile = promisify(execFile);

function parseProcesses(output) {
  const entries = new Map();
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s+(.+)$/.exec(line);
    if (!match) continue;
    const [, pid, uid, started, state, command] = match;
    if (!Number.isSafeInteger(Number(pid)) || Number(pid) < 1) continue;
    entries.set(Number(pid), { pid: Number(pid), uid: Number(uid), started, state, command });
  }
  return entries;
}

async function readProcesses({ pid, signal, execute = executeFile } = {}) {
  const fields = 'pid=,uid=,lstart=,stat=,comm=';
  if (pid !== undefined && (!Number.isSafeInteger(pid) || pid < 1)) throw new Error('Invalid PID');
  const args = pid === undefined ? ['-axo', fields] : ['-p', String(pid), '-o', fields];
  try {
    const { stdout } = await execute('/bin/ps', args, {
      encoding: 'utf8', timeout: 2000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' }, signal,
    });
    const entries = parseProcesses(stdout);
    if (stdout.trim() && !entries.size) throw new Error('Invalid process data');
    return entries;
  } catch (error) {
    if (pid !== undefined && error.code === 1 && !error.stdout?.trim() && !error.stderr?.trim()) return new Map();
    throw error;
  }
}

function sameProcess(a, b) {
  return Boolean(a && b && a.pid === b.pid && a.uid === b.uid && a.started === b.started && a.command === b.command);
}
function isRunning(info) { return Boolean(info && !info.state.startsWith('Z')); }

module.exports = { parseProcesses, readProcesses, sameProcess, isRunning };
