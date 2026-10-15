const WINDOW_SIZE = 128;
const MARGIN = 24;

function getInitialBounds(workArea) {
  return {
    width: WINDOW_SIZE,
    height: WINDOW_SIZE,
    x: workArea.x + Math.max(0, workArea.width - WINDOW_SIZE - MARGIN),
    y: workArea.y + Math.max(0, workArea.height - WINDOW_SIZE - MARGIN),
  };
}

function isPosition(value) {
  return value != null && ['x', 'y'].every(key =>
    Number.isInteger(value[key]) && Math.abs(value[key]) <= 1_000_000);
}

// Choose the work area requiring the smallest correction. This also handles
// negative display origins, gaps between displays, and disconnected monitors.
function getVisibleBounds(position, workAreas, primaryWorkArea) {
  if (!isPosition(position)) return getInitialBounds(primaryWorkArea);
  let closest;
  let distance = Infinity;
  for (const area of workAreas.length ? workAreas : [primaryWorkArea]) {
    const x = Math.max(area.x, Math.min(position.x, area.x + Math.max(0, area.width - WINDOW_SIZE)));
    const y = Math.max(area.y, Math.min(position.y, area.y + Math.max(0, area.height - WINDOW_SIZE)));
    const correction = (x - position.x) ** 2 + (y - position.y) ** 2;
    if (correction < distance) {
      closest = { x, y, width: WINDOW_SIZE, height: WINDOW_SIZE };
      distance = correction;
    }
  }
  return closest;
}

module.exports = { getInitialBounds, getVisibleBounds, isPosition };
