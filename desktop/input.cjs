function isHitRegion(region) {
  return region != null && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(region[key])) &&
    region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0 &&
    region.width <= 128 && region.height <= 128 &&
    region.x + region.width <= 496 && region.y + region.height <= 128 &&
    Number.isInteger(region.columns) && region.columns > 0 && region.columns <= 128 &&
    Number.isInteger(region.rows) && region.rows > 0 && region.rows <= 128 &&
    Array.isArray(region.alpha) && region.alpha.length === region.columns * region.rows &&
    region.alpha.every(alpha => Number.isInteger(alpha) && alpha >= 0 && alpha <= 255);
}

function hitsRegion(region, point) {
  if (!region || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const x = Math.floor((point.x - region.x) * region.columns / region.width);
  const y = Math.floor((point.y - region.y) * region.rows / region.height);
  return x >= 0 && y >= 0 && x < region.columns && y < region.rows &&
    region.alpha[y * region.columns + x] > 0;
}

function hitsGround(point, bounds) {
  return point.x >= 8 && point.x < bounds.width - 8 &&
    point.y >= bounds.height - 20 && point.y < bounds.height - 4;
}

function createPetInput(win, screen, groundVisible = true) {
  let region = null;
  let ignoring;
  const holds = new Set();

  function refresh() {
    if (win.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = win.getContentBounds();
    const point = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
    const hit = hitsRegion(region, point) || (groundVisible && hitsGround(point, bounds));
    const next = holds.size === 0 && !hit;
    if (next !== ignoring) {
      win.setIgnoreMouseEvents(next, { forward: true });
      ignoring = next;
    }
  }

  // Native cursor sampling works even while the entire window ignores input.
  // It also handles re-entry, a stationary cursor during animation, and moves
  // caused by display changes, without sending IPC for every mouse movement.
  const timer = setInterval(refresh, 20);
  refresh();
  return {
    setGroundVisible(value) { groundVisible = value; refresh(); },
    update(next) {
      if (!isHitRegion(next)) return;
      region = next;
      refresh();
    },
    hits: point => hitsRegion(region, point) || (groundVisible && hitsGround(point, win.getContentBounds())),
    hold(reason, active) {
      if (active) holds.add(reason);
      else holds.delete(reason);
      refresh();
    },
    reset() {
      region = null;
      holds.clear();
      refresh();
    },
    dispose() { clearInterval(timer); },
  };
}

module.exports = { isHitRegion, hitsRegion, createPetInput };
