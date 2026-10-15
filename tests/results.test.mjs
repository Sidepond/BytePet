import test from 'node:test';
import assert from 'node:assert/strict';
import { createResultService, COPY_LIMIT } from '../desktop/results.cjs';
import { createReactionPlayer, CHEW_MS, RESULT_MS } from '../desktop/reaction.js';
import { EATING_MS } from '../desktop/cat.js';

function service(writeText = async () => {}) {
  const handlers = new Map();
  const listeners = new Map();
  const messages = [];
  const panel = { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: {} } };
  const pet = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (...args) => messages.push(args) } };
  const ipcMain = { handle: (key, fn) => handlers.set(key, fn), on: (key, fn) => listeners.set(key, fn),
    removeHandler: key => handlers.delete(key), removeListener: key => listeners.delete(key) };
  const instance = createResultService({ ipcMain, clipboard: { writeText }, pet, getPanel: () => panel });
  return { handlers, listeners, panel, pet, messages, instance, event: { sender: panel.webContents, senderFrame: panel.webContents.mainFrame } };
}

test('results: copying waits for clipboard completion, preserves text, and reports failure', async () => {
  let finish;
  let copied;
  const s = service(text => { copied = text; return new Promise(resolve => { finish = resolve; }); });
  let settled = false;
  const pending = s.handlers.get('results:copy')(s.event, '  한글 🐱\n900719925474099312345').then(value => { settled = true; return value; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.match((await s.handlers.get('results:copy')(s.event, 'newer result')).error, /복사 중/);
  assert.equal(copied, '  한글 🐱\n900719925474099312345');
  finish();
  assert.deepEqual(await pending, { ok: true });
  const broken = service(async () => { throw new Error('private OS details'); });
  const error = await broken.handlers.get('results:copy')(broken.event, '{}');
  assert.equal(error.ok, false);
  assert.match(error.error, /복사하지 못/);
  assert.doesNotMatch(error.error, /private/);
});

test('results: only the panel main frame may copy or trigger reactions, with bounded input', async () => {
  const writes = [];
  const s = service(async text => writes.push(text));
  const copy = s.handlers.get('results:copy');
  const react = s.listeners.get('results:react');
  for (const event of [{}, { sender: s.pet.webContents }, { sender: s.panel.webContents, senderFrame: {} }]) {
    assert.equal((await copy(event, '{}')).ok, false);
    react(event, 'success');
  }
  for (const text of ['', null, {}, 'x'.repeat(COPY_LIMIT + 1)]) assert.equal((await copy(s.event, text)).ok, false);
  assert.deepEqual(writes, []);
  assert.deepEqual(s.messages, []);
  react(s.event, 'arbitrary');
  react(s.event, 'success');
  assert.deepEqual(s.messages, [['results:reaction', 'success']]);
  s.pet.webContents.isDestroyed = () => true;
  react(s.event, 'failure');
  assert.equal(s.messages.length, 1);
  s.panel.webContents.isDestroyed = () => true;
  assert.equal((await copy(s.event, '{}')).ok, false);
  s.instance.dispose();
  assert.equal(s.handlers.size, 0);
  assert.equal(s.listeners.size, 0);
});

function player() {
  let now = 0;
  let id = 0;
  const timers = new Map();
  const history = [];
  const controller = createReactionPlayer(state => history.push(state), {
    now: () => now,
    schedule: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id; },
    cancel: key => timers.delete(key),
  });
  function advance(ms) {
    now += ms;
    for (const [key, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at <= now) { timers.delete(key); timer.fn(); }
    }
  }
  return { controller, history, timers, advance };
}

test('reaction: success and failure each proceed through chewing, outcome, and idle', () => {
  for (const outcome of ['success', 'failure']) {
    const p = player();
    p.controller.play(outcome);
    assert.equal(p.history.at(-1).state, 'processing');
    p.advance(CHEW_MS - 1);
    assert.equal(p.history.length, 1);
    p.advance(1);
    assert.equal(p.history.at(-1).state, outcome);
    p.advance(RESULT_MS);
    assert.equal(p.history.at(-1).state, 'idle');
    assert.equal(p.timers.size, 0);
  }
});

test('reaction: the latest save or conversion replaces earlier timers; dispose cancels callbacks', () => {
  const p = player();
  p.controller.play('failure');
  const stale = [...p.timers.values()].map(timer => timer.fn);
  p.advance(200);
  p.controller.play('eating');
  stale.forEach(fn => fn());
  assert.equal(p.history.at(-1).state, 'eating');
  p.advance(EATING_MS - 1);
  assert.equal(p.history.at(-1).state, 'eating');
  p.advance(1);
  assert.equal(p.history.at(-1).state, 'idle');
  p.controller.play('eating');
  p.controller.play('success');
  p.advance(CHEW_MS);
  assert.equal(p.history.at(-1).state, 'success');
  const pending = [...p.timers.values()].map(timer => timer.fn);
  p.controller.dispose();
  const count = p.history.length;
  pending.forEach(fn => fn());
  p.advance(5000);
  assert.equal(p.history.length, count);
  assert.equal(p.timers.size, 0);
});
