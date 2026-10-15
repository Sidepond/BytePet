const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { readProcesses, sameProcess, isRunning } = require('./processes.cjs');

class TerminationError extends Error {}

function createTerminator({ scan, inspect = readProcesses, confirm, react = () => {},
  isProtected = pid => pid <= 1 || pid === process.pid, uid = process.getuid?.(),
  sendSignal = (pid, signal) => process.kill(pid, signal), pause = delay, now = Date.now, timeout = 3000 }) {
  let busy = false;
  let disposed = false;
  const controller = new AbortController();
  const { signal } = controller;
  function reason(info) {
    if (!info || !isRunning(info)) return '프로세스 정보를 확인할 수 없어 종료할 수 없어요.';
    if (isProtected(info.pid)) return 'BytePet 또는 보호된 프로세스는 종료할 수 없어요.';
    if (info.uid !== uid) return '다른 사용자의 프로세스는 종료할 수 없어요.';
    return null;
  }
  async function terminate(item, identity, active) {
    if (busy) return { ok: false, error: '다른 프로세스의 종료를 처리하고 있어요.' };
    if (disposed || !active()) return { ok: false, error: '종료 요청이 취소됐어요.' };
    const blocked = reason(identity);
    if (blocked) return { ok: false, error: blocked };
    busy = true;
    let attackId;
    const checkActive = () => { if (disposed || !active()) throw new TerminationError('종료 요청이 취소됐어요.'); };
    const already = () => ({ ok: true, value: { status: 'already-exited', message: `PID ${item.pid}는 이미 종료됐어요.` } });
    try {
      const before = (await inspect({ pid: item.pid, signal })).get(item.pid);
      if (!isRunning(before)) return already();
      if (!sameProcess(identity, before)) throw new TerminationError('프로세스가 바뀌었어요. 새로고침 후 다시 선택해 주세요.');
      const current = await scan({ signal });
      if (!current.items.some(row => row.pid === item.pid && row.port === item.port)) {
        throw new TerminationError('선택한 포트를 더 이상 확인할 수 없어요. 목록을 새로고침해 주세요.');
      }
      checkActive();
      const ports = [...new Set(current.items.filter(row => row.pid === item.pid).map(row => row.port))].sort((a, b) => a - b);
      if (!(await confirm({ ...item, ports, command: before.command }))) return { ok: true, value: { status: 'cancelled', message: '종료를 취소했어요.' } };
      checkActive();
      // Recheck socket ownership and process identity after the confirmation dialog.
      const latest = await scan({ signal });
      const after = (await inspect({ pid: item.pid, signal })).get(item.pid);
      checkActive();
      if (!isRunning(after)) return already();
      if (!sameProcess(identity, after)) throw new TerminationError('프로세스가 바뀌었어요. 새로고침 후 다시 선택해 주세요.');
      if (!latest.items.some(row => row.pid === item.pid && row.port === item.port)) {
        throw new TerminationError('선택한 포트를 더 이상 확인할 수 없어요. 목록을 새로고침해 주세요.');
      }
      const protectedReason = reason(after);
      if (protectedReason) throw new TerminationError(protectedReason);
      attackId = randomUUID();
      react({ id: attackId, phase: 'attack' });
      sendSignal(item.pid, 'SIGTERM');
      const deadline = now() + timeout;
      do {
        const info = (await inspect({ pid: item.pid, signal })).get(item.pid);
        checkActive();
        // An exec/rename can change the command without terminating the process.
        if (!isRunning(info) || info.started !== identity.started) {
          react({ id: attackId, phase: 'success' });
          return { ok: true, value: { status: 'terminated', message: `PID ${item.pid} 프로세스를 종료했어요.` } };
        }
        if (now() >= deadline) break;
        await pause(100, undefined, { signal });
      } while (true);
      throw new TerminationError('종료 신호를 보냈지만 아직 실행 중이에요. 잠시 후 새로고침해 주세요.');
    } catch (error) {
      if (attackId && !disposed) react({ id: attackId, phase: 'failure' });
      if (error.code === 'ESRCH') return already();
      const message = error.code === 'EPERM' || error.code === 'EACCES'
        ? '프로세스를 종료할 권한이 없어요.'
        : error instanceof TerminationError ? error.message
          : '종료 상태를 확인하지 못했어요. 새로고침 후 다시 확인해 주세요.';
      return { ok: false, error: message };
    } finally { busy = false; }
  }
  return { reason, terminate, dispose() { disposed = true; controller.abort(); } };
}

module.exports = { createTerminator };
