import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getInitialBounds, getVisibleBounds, getPanelBounds } from '../desktop/window.cjs';
import { createPositionStore } from '../desktop/position-store.cjs';
import { getIdlePose, CYCLE_MS } from '../desktop/cat.js';
import { isHitRegion, hitsRegion } from '../desktop/input.cjs';

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

const hitRegion = { x: 16, y: 16, width: 96, height: 96, columns: 2, rows: 2, alpha: [0, 255, 36, 0] };

test('pixel hit testing includes visible pixels and excludes transparent holes and outside edges', () => {
  assert.equal(isHitRegion(hitRegion), true);
  for (const point of [{ x: 16, y: 16 }, { x: 15.99, y: 80 }, { x: 80, y: 112 }, { x: 112, y: 30 }, { x: 80, y: 80 }]) {
    assert.equal(hitsRegion(hitRegion, point), false);
  }
  assert.equal(hitsRegion(hitRegion, { x: 64, y: 16 }), true);
  assert.equal(hitsRegion(hitRegion, { x: 16, y: 64 }), true, 'partially transparent visible pixels also receive input');
  assert.equal(hitsRegion(hitRegion, { x: NaN, y: 16 }), false);
  assert.equal(hitsRegion(null, { x: 80, y: 16 }), false);
});

test('invalid or oversized hit regions from the renderer are rejected', () => {
  for (const region of [null, {}, { ...hitRegion, width: Infinity }, { ...hitRegion, x: -1 },
    { ...hitRegion, width: 200 }, { ...hitRegion, columns: 1.5 }, { ...hitRegion, rows: 0 },
    { ...hitRegion, alpha: [0, 255] }, { ...hitRegion, alpha: [0, 255, -1, 0] }]) {
    assert.equal(isHitRegion(region), false);
  }
});

test('panel remains on its display and avoids covering the pet near each edge', () => {
  for (const area of [primary, secondary]) {
    for (const offset of [{ x: 0, y: 0 }, { x: area.width - 128, y: 0 }, { x: 0, y: area.height - 128 }, { x: area.width - 128, y: area.height - 128 }]) {
      const pet = { x: area.x + offset.x, y: area.y + offset.y, width: 128, height: 128 };
      const panel = getPanelBounds(pet, area);
      assert.ok(panel.x >= area.x && panel.y >= area.y);
      assert.ok(panel.x + panel.width <= area.x + area.width && panel.y + panel.height <= area.y + area.height);
      assert.ok(panel.x + panel.width <= pet.x || panel.x >= pet.x + pet.width || panel.y + panel.height <= pet.y || panel.y >= pet.y + pet.height);
    }
  }
});

test('panel fits a work area smaller than its preferred size', () => {
  const area = { x: -200, y: 40, width: 300, height: 250 };
  assert.deepEqual(getPanelBounds({ x: -100, y: 70, width: 128, height: 128 }, area), area);
});
