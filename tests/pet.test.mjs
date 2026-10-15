import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getInitialBounds, getVisibleBounds, getPanelBounds, getYardBoundsForPanel } from '../desktop/window.cjs';
import { createPositionStore } from '../desktop/position-store.cjs';
import { getIdlePose, CYCLE_MS } from '../desktop/cat.js';
import { isHitRegion, hitsRegion, createPetInput } from '../desktop/input.cjs';
import { characters, drawCharacter } from '../desktop/characters.js';

test('all characters keep every action inside the pixel canvas and animate in place', () => {
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
    for (const state of ['idle', 'eating', 'processing', 'success', 'failure', 'attack']) {
      for (const time of [0, 180, 650, 800, 1500, 3250, 4799]) assert.ok(frame(id, state, time).length > 0);
    }
    assert.deepEqual(frame(id, 'idle', 0), frame(id, 'idle', 4800));
    assert.notDeepEqual(frame(id, 'idle', 0), frame(id, 'idle', 1500));
    assert.notDeepEqual(frame(id, 'eating', 650), frame(id, 'eating', 800));
    assert.notDeepEqual(frame(id, 'attack', 0), frame(id, 'attack', 180));
  }
});

test('initial placement respects work area origin and dock reservation', () => {
  assert.deepEqual(getInitialBounds({ x: -1920, y: 30, width: 1920, height: 1000 }), {
    x: -520, y: 878, width: 496, height: 128,
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
      ...position, width: 496, height: 128,
    });
  }
});

test('keeps the entire pet inside a work area after disconnects or resolution changes', () => {
  assert.deepEqual(getVisibleBounds({ x: -1600, y: -100 }, [primary], primary), {
    x: 0, y: 30, width: 496, height: 128,
  });
  assert.deepEqual(getVisibleBounds({ x: 1400, y: 880 }, [primary], primary), {
    x: 944, y: 772, width: 496, height: 128,
  });
  const tiny = { x: 40, y: 50, width: 100, height: 100 };
  assert.deepEqual(getVisibleBounds({ x: 90, y: 90 }, [tiny], tiny), {
    x: 40, y: 50, width: 100, height: 100,
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

test('all menu directions and ground settings keep the house beside the cat and inside the display', () => {
  for (const area of [primary, secondary, { x: -200, y: 40, width: 300, height: 250 }]) {
    for (const preferences of [{ ground: true, menuSide: 'left' }, { ground: true, menuSide: 'right' }, { ground: false, menuSide: 'left' }, { ground: false, menuSide: 'right' }]) {
      for (const height of [588, 530, 298]) {
        for (const position of [{ x: area.x, y: area.y }, { x: area.x + area.width, y: area.y + area.height }]) {
          const yard = getYardBoundsForPanel({ ...position, width: 496, height: 128 }, area, height, preferences);
          const house = getPanelBounds(yard, area, height, preferences);
          const catLeft = yard.x + (preferences.ground && preferences.menuSide === 'left' ? yard.width - 112 : 16);
          if (preferences.menuSide === 'left') assert.ok(house.x + house.width <= catLeft);
          else assert.ok(house.x >= catLeft + 96);
          assert.equal(house.y + house.height - 10, yard.y + yard.height - 20);
          assert.ok(house.x >= area.x && house.x + house.width <= area.x + area.width);
          assert.ok(house.y >= area.y);
          assert.ok(yard.x >= area.x && yard.x + yard.width <= area.x + area.width);
          assert.ok(yard.y + yard.height <= area.y + area.height);
        }
      }
    }
  }
});

test('hiding the ground also releases its native mouse interception', t => {
  let ignoring;
  let point = { x: 20, y: 114 };
  const win = {
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 0, y: 0, width: 128, height: 128 }),
    setIgnoreMouseEvents: value => { ignoring = value; },
  };
  const input = createPetInput(win, { getCursorScreenPoint: () => point }, true);
  t.after(() => input.dispose());
  assert.equal(ignoring, false, 'visible grass receives dragging');
  input.setGroundVisible(false);
  assert.equal(ignoring, true, 'hidden grass lets clicks through');
  point = { x: 64, y: 16 };
  input.update(hitRegion);
  assert.equal(ignoring, false, 'the cat remains interactive');
});
