import test from 'node:test';
import assert from 'node:assert/strict';
import { createReactionPlayer, CHEW_MS, RESULT_MS } from '../desktop/reaction.js';
import { EATING_MS } from '../desktop/cat.js';

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

test('reaction: attacks await a matching outcome and never overwrite newer feeding or conversion', () => {
  const p = player();
  p.controller.portReaction({ id: 'first', phase: 'attack' });
  assert.equal(p.history.at(-1).state, 'attack');
  p.advance(2000);
  assert.equal(p.history.at(-1).state, 'attack', 'no success until exit is verified');
  p.controller.portReaction({ id: 'first', phase: 'success' });
  p.advance(0);
  assert.equal(p.history.at(-1).state, 'success');
  assert.equal(p.history.at(-1).source, 'ports');
  p.advance(RESULT_MS);
  assert.equal(p.history.at(-1).state, 'idle');
  p.controller.portReaction({ id: 'second', phase: 'attack' });
  p.controller.portReaction({ id: 'wrong', phase: 'success' });
  assert.equal(p.history.at(-1).state, 'attack');
  p.controller.play('eating');
  p.controller.portReaction({ id: 'second', phase: 'failure' });
  p.advance(100);
  assert.equal(p.history.at(-1).state, 'eating');
  p.controller.portReaction({ id: 'third', phase: 'attack' });
  p.controller.portReaction({ id: 'third', phase: 'failure' });
  assert.equal(p.history.at(-1).state, 'attack', 'quick exits still show an attack');
  p.advance(650);
  assert.equal(p.history.at(-1).state, 'failure');
  p.advance(RESULT_MS);
  assert.equal(p.history.at(-1).state, 'idle');
});
