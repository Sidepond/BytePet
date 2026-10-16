import test from 'node:test';
import assert from 'node:assert/strict';
import { getIdlePose, CYCLE_MS, EATING_MS } from '../desktop/cat.js';
import { characters, drawLegacyCharacter as drawCharacter } from '../desktop/characters.js';
import { frameAt } from '../desktop/sprite-character.js';
import manifest from '../desktop/sprite-manifest.js';
import { createIdleBehavior, IDLE_DURATIONS } from '../desktop/idle-behavior.js';

test('idle gestures alternate with quiet time, cover every action, and restart after interruption', () => {
  const idle = createIdleBehavior({ random: () => 0 });
  idle.reset(100);
  assert.equal(idle.sample(12099).state, 'idle');
  assert.deepEqual(idle.sample(12100), { state: 'sleeping', elapsed: 0 });
  assert.deepEqual(idle.sample(18000), { state: 'sleeping', elapsed: 5900 });
  assert.equal(idle.sample(30100).state, 'idle');
  assert.equal(idle.sample(42099).state, 'idle');
  assert.equal(idle.sample(42100).state, 'grooming');
  idle.reset(43000);
  assert.deepEqual(idle.sample(43000), { state: 'idle', elapsed: 0 });
  assert.equal(idle.sample(54999).state, 'idle');
  assert.equal(idle.sample(55000).state, 'sleeping');
  idle.reset(500000);
  assert.equal(idle.sample(500001).state, 'idle', 'returning from a hidden window starts fresh');
});

test('idle gestures never immediately repeat across random selection rounds', () => {
  const idle = createIdleBehavior();
  let now = 0;
  let previous;
  for (let round = 0; round < 20; round++) {
    const actions = new Set();
    for (let i = 0; i < 2; i++) {
      now += 24000;
      const { state } = idle.sample(now);
      assert.notEqual(state, previous);
      actions.add(state);
      previous = state;
      now += IDLE_DURATIONS[state];
      assert.equal(idle.sample(now).state, 'idle');
    }
    assert.deepEqual([...actions].sort(), ['grooming', 'sleeping']);
  }
});

test('fallback characters keep every action inside the pixel canvas and animate in place', () => {
  function frame(id, state, time) {
    const operations = [];
    const ctx = {
      fillStyle: '#000000', clearRect() {},
      fillRect(x, y, width, height) {
        assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 24 && y + height <= 24, `${id}/${state} stays inside its canvas`);
        assert.match(this.fillStyle, /^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
        operations.push([x, y, width, height, this.fillStyle]);
      },
    };
    drawCharacter(ctx, id, state, time);
    return operations;
  }
  for (const { id } of characters) {
    for (const state of ['idle', 'eating', 'processing', 'success', 'failure', 'attack', ...Object.keys(IDLE_DURATIONS)]) {
      for (let time = 0; time <= (IDLE_DURATIONS[state] ?? 4800); time += 100) assert.ok(frame(id, state, time).length > 0);
    }
    assert.deepEqual(frame(id, 'idle', 0), frame(id, 'idle', 4800));
    assert.notDeepEqual(frame(id, 'idle', 0), frame(id, 'idle', 1500));
    assert.notDeepEqual(frame(id, 'eating', 650), frame(id, 'eating', 800));
    assert.notDeepEqual(frame(id, 'attack', 0), frame(id, 'attack', 180));
    for (const state of Object.keys(IDLE_DURATIONS)) {
      assert.deepEqual(frame(id, state, 0), frame(id, 'idle', 0), 'gestures begin in the standing pose');
      assert.deepEqual(frame(id, state, IDLE_DURATIONS[state]), frame(id, 'idle', 0), 'gestures finish in the standing pose');
      assert.notDeepEqual(frame(id, state, 900), frame(id, 'idle', 0));
      assert.notDeepEqual(frame(id, state, 650), frame(id, state, state === 'sleeping' ? 2200 : 1500));
    }
  }
});

test('idle cycle breathes, blinks, moves its tail, and loops without a jump', () => {
  assert.equal(getIdlePose(0).blink, false);
  assert.equal(getIdlePose(3250).blink, true);
  assert.equal(getIdlePose(3400).blink, false);
  assert.equal(getIdlePose(3600).blink, true);
  assert.notEqual(getIdlePose(0).lift, getIdlePose(1500).lift);
  assert.notEqual(getIdlePose(0).tail, getIdlePose(700).tail);
  assert.deepEqual(getIdlePose(CYCLE_MS - 1), getIdlePose(0));
  assert.deepEqual(getIdlePose(CYCLE_MS), getIdlePose(0));
});

test('image pack frame timing honors each hold and loops at the exact boundary', () => {
  for (const character of Object.values(manifest)) {
    assert.equal(character.actions.eating.durationMs.reduce((total, ms) => total + ms, 0), EATING_MS,
      'a complete bite finishes before the feeding reaction returns to idle');
    for (const { durationMs } of Object.values(character.actions)) {
      let elapsed = 0;
      durationMs.forEach((duration, index) => {
        assert.equal(frameAt(durationMs, elapsed), index);
        assert.equal(frameAt(durationMs, elapsed + duration - 1), index);
        elapsed += duration;
      });
      assert.equal(frameAt(durationMs, elapsed), 0);
      assert.equal(frameAt(durationMs, elapsed * 20 + durationMs[0]), 1);
      assert.equal(frameAt(durationMs, -1), 0);
    }
  }
});

test('an image pack with only sleeping still schedules repeated naps with quiet time', () => {
  const idle = createIdleBehavior({ random: () => 0, actions: ['sleeping'] });
  for (let cycle = 0; cycle < 4; cycle++) {
    const start = cycle * 30000;
    assert.equal(idle.sample(start + 11999).state, 'idle');
    assert.deepEqual(idle.sample(start + 12000), { state: 'sleeping', elapsed: 0 });
    assert.equal(idle.sample(start + 30000).state, 'idle');
  }
  assert.equal(createIdleBehavior({ actions: [] }).sample(60000).state, 'idle');
});
