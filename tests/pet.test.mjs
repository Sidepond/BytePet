import test from 'node:test';
import assert from 'node:assert/strict';
import { getInitialBounds } from '../desktop/window.cjs';
import { getIdlePose, CYCLE_MS } from '../desktop/cat.js';

test('initial placement respects work area origin and dock reservation', () => {
  assert.deepEqual(getInitialBounds({ x: -1920, y: 30, width: 1920, height: 1000 }), {
    x: -152, y: 878, width: 128, height: 128,
  });
});

test('small work areas do not move the window before the display origin', () => {
  const bounds = getInitialBounds({ x: 40, y: 50, width: 140, height: 140 });
  assert.equal(bounds.x, 40);
  assert.equal(bounds.y, 50);
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
