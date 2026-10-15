import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getInitialBounds, getVisibleBounds } from '../desktop/window.cjs';
import { createPositionStore } from '../desktop/position-store.cjs';
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

const primary = { x: 0, y: 30, width: 1440, height: 870 };
const secondary = { x: -1920, y: -200, width: 1920, height: 1080 };

test('restores positions on either display, including negative coordinates', () => {
  for (const position of [{ x: 400, y: 300 }, { x: -1600, y: -100 }]) {
    assert.deepEqual(getVisibleBounds(position, [primary, secondary], primary), {
      ...position, width: 128, height: 128,
    });
  }
});

test('keeps the entire pet inside a work area after disconnects or resolution changes', () => {
  assert.deepEqual(getVisibleBounds({ x: -1600, y: -100 }, [primary], primary), {
    x: 0, y: 30, width: 128, height: 128,
  });
  assert.deepEqual(getVisibleBounds({ x: 1400, y: 880 }, [primary], primary), {
    x: 1312, y: 772, width: 128, height: 128,
  });
  const tiny = { x: 40, y: 50, width: 100, height: 100 };
  assert.deepEqual(getVisibleBounds({ x: 90, y: 90 }, [tiny], tiny), {
    x: 40, y: 50, width: 128, height: 128,
  });
});

test('invalid positions fall back to the initial placement', () => {
  for (const invalid of [null, {}, { x: '5', y: 6 }, { x: NaN, y: 0 }, { x: Infinity, y: 0 }, { x: 2 ** 40, y: 0 }]) {
    assert.deepEqual(getVisibleBounds(invalid, [primary], primary), getInitialBounds(primary));
  }
});

test('position storage handles missing, corrupt, unsupported and valid files', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'bytepet-store-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = createPositionStore(directory, () => {});
  const file = path.join(directory, 'pet-position.json');
  assert.equal(store.read(), null);
  for (const contents of ['{broken', 'null', '{"version":2,"x":5,"y":6}', '{"version":1,"x":"5","y":6}']) {
    writeFileSync(file, contents);
    assert.equal(store.read(), null);
  }
  assert.equal(store.write({ x: -500, y: 75 }), true);
  assert.deepEqual(store.read(), { x: -500, y: 75 });
  assert.equal(store.write({ x: Infinity, y: 0 }), false);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { version: 1, x: -500, y: 75 });
});

test('a storage failure does not throw or prevent the pet from running', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'bytepet-store-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const blocker = path.join(directory, 'not-a-directory');
  writeFileSync(blocker, 'keep');
  const warnings = [];
  const store = createPositionStore(blocker, (...args) => warnings.push(args));
  assert.equal(store.read(), null);
  assert.equal(store.write({ x: 100, y: 100 }), false);
  assert.equal(readFileSync(blocker, 'utf8'), 'keep');
  assert.equal(warnings.length, 2);
});
