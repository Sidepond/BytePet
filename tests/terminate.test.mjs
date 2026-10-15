import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProcesses, readProcesses } from '../desktop/processes.cjs';
import { createTerminator } from '../desktop/terminate.cjs';

const identity = { pid: 4242, uid: 501, started: 'Thu Oct 15 14:06:03 2026', state: 'S', command: '/Applications/My App/node' };
const item = { pid: 4242, port: 3000, name: 'node' };
function harness(overrides = {}) {
  let info = { ...identity };
  let time = 0;
  let ports = [item, { ...item, port: 3001 }];
  const signals = [];
  const reactions = [];
  const confirmations = [];
  const runner = createTerminator({
    uid: 501, isProtected: pid => pid <= 1,
    inspect: async () => new Map(info ? [[4242, info]] : []),
    scan: async () => ({ items: ports }),
    confirm: async detail => { confirmations.push(detail); return true; },
    sendSignal: (pid, signal) => { signals.push([pid, signal]); info = null; },
    react: event => reactions.push(event),
    pause: async ms => { time += ms; }, now: () => time, timeout: 300,
    ...overrides,
  });
  return { runner, signals, reactions, confirmations, run: (active = () => true) => runner.terminate(item, identity, active),
    setInfo: value => { info = value; }, setPorts: value => { ports = value; } };
}

test('termination: reads bounded process identity fields without arguments or shell execution', async () => {
  const line = ' 4242 501 Thu Oct 15 14:06:03 2026 S /Applications/My App/node\n';
  assert.deepEqual(parseProcesses(line).get(4242), identity);
  assert.equal(parseProcesses('invalid\n 0 501 Thu Oct 15 14:06:03 2026 S test').size, 0);
  for (const pid of [undefined, 4242]) {
    const result = await readProcesses({ pid, execute: async (file, args, options) => {
      assert.equal(file, '/bin/ps');
      assert.deepEqual(args, pid ? ['-p', '4242', '-o', 'pid=,uid=,lstart=,stat=,comm='] : ['-axo', 'pid=,uid=,lstart=,stat=,comm=']);
      assert.equal(options.shell, undefined);
      assert.equal(options.timeout, 2000);
      assert.equal(options.maxBuffer, 2 * 1024 * 1024);
      assert.equal(options.env.LC_ALL, 'C');
      return { stdout: line };
    } });
    assert.equal(result.size, 1);
  }
  await assert.rejects(readProcesses({ pid: -1, execute: () => assert.fail() }), /Invalid PID/);
  const gone = await readProcesses({ pid: 4242, execute: async () => { throw { code: 1, stdout: '', stderr: '' }; } });
  assert.equal(gone.size, 0);
  await assert.rejects(readProcesses({ pid: 4242, execute: async () => ({ stdout: 'unparseable' }) }), /Invalid/);
  await assert.rejects(readProcesses({ pid: 4242, execute: async () => { throw { code: 1, stderr: 'denied' }; } }));
});

test('termination: confirms all known ports, sends only SIGTERM, and reacts only after process exit', async () => {
  const h = harness();
  const result = await h.run();
  assert.equal(result.value.status, 'terminated');
  assert.deepEqual(h.signals, [[4242, 'SIGTERM']]);
  assert.deepEqual(h.confirmations[0].ports, [3000, 3001]);
  assert.equal(h.confirmations[0].command, identity.command);
  assert.deepEqual(h.reactions.map(x => x.phase), ['attack', 'success']);
  assert.equal(h.reactions[0].id, h.reactions[1].id);
});

test('termination: cancellation, already exited, changed PID identity and lost ports never signal', async () => {
  const cancelled = harness({ confirm: async () => false });
  assert.equal((await cancelled.run()).value.status, 'cancelled');
  assert.deepEqual(cancelled.signals, []);
  assert.deepEqual(cancelled.reactions, []);
  const gone = harness();
  gone.setInfo(null);
  assert.equal((await gone.run()).value.status, 'already-exited');
  assert.deepEqual(gone.signals, []);
  const changed = harness();
  changed.setInfo({ ...identity, started: 'Fri Oct 16 14:06:03 2026' });
  assert.match((await changed.run()).error, /바뀌었/);
  assert.deepEqual(changed.confirmations, []);
  let h;
  h = harness({ confirm: async () => { h.setInfo({ ...identity, command: '/another/program' }); return true; } });
  assert.match((await h.run()).error, /바뀌었/);
  assert.deepEqual(h.signals, []);
  h = harness({ confirm: async () => { h.setInfo(null); return true; } });
  assert.equal((await h.run()).value.status, 'already-exited');
  h = harness({ confirm: async () => { h.setPorts([]); return true; } });
  assert.match((await h.run()).error, /포트를 더 이상/);
  assert.deepEqual(h.signals, []);
});

test('termination: blocks protected/other-user processes and cancels on disposal or destroyed panel', async () => {
  for (const options of [{ isProtected: () => true }, { uid: 502 }]) {
    const h = harness(options);
    assert.equal((await h.run()).ok, false);
    assert.deepEqual(h.signals, []);
    assert.deepEqual(h.confirmations, []);
  }
  let h;
  h = harness({ confirm: async () => { h.runner.dispose(); return true; } });
  assert.equal((await h.run()).ok, false);
  assert.deepEqual(h.signals, []);
  let active = true;
  h = harness({ confirm: async () => { active = false; return true; } });
  assert.equal((await h.run(() => active)).ok, false);
  assert.deepEqual(h.signals, []);
});

test('termination: permission errors, disappeared PID and unresponsive processes do not report false success', async () => {
  for (const code of ['EPERM', 'EACCES', 'ESRCH']) {
    const h = harness({ sendSignal: () => { throw Object.assign(new Error('private'), { code }); } });
    const result = await h.run();
    if (code === 'ESRCH') assert.equal(result.value.status, 'already-exited');
    else assert.match(result.error, /권한/);
    assert.equal(h.reactions.some(x => x.phase === 'success'), false);
  }
  let signals = 0;
  const h = harness({ sendSignal: () => { signals++; h.setPorts([]); } });
  assert.match((await h.run()).error, /아직 실행 중/);
  assert.equal(signals, 1, 'no automatic force kill');
  assert.deepEqual(h.reactions.map(x => x.phase), ['attack', 'failure']);
  let renamed;
  renamed = harness({ sendSignal: () => renamed.setInfo({ ...identity, command: '/another/executable' }) });
  assert.match((await renamed.run()).error, /아직 실행 중/, 'exec is not process exit');
});

test('termination: concurrent requests share a lock until confirmation and exit checking finish', async () => {
  let finish;
  const h = harness({ confirm: () => new Promise(resolve => { finish = resolve; }) });
  const pending = h.run();
  await new Promise(resolve => setImmediate(resolve));
  assert.match((await h.run()).error, /다른 프로세스/);
  finish(false);
  assert.equal((await pending).value.status, 'cancelled');
  assert.deepEqual(h.signals, []);
});
