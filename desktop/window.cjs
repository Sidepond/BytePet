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

function getPanelBounds(pet, area) {
  const width = Math.min(360, area.width);
  const height = Math.min(560, area.height);
  const gap = 8;
  const candidates = [
    { x: pet.x + (pet.width - width) / 2, y: pet.y - height - gap },
    { x: pet.x + (pet.width - width) / 2, y: pet.y + pet.height + gap },
    { x: pet.x - width - gap, y: pet.y + (pet.height - height) / 2 },
    { x: pet.x + pet.width + gap, y: pet.y + (pet.height - height) / 2 },
  ];
  let best;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const x = Math.round(Math.max(area.x, Math.min(candidate.x, area.x + area.width - width)));
    const y = Math.round(Math.max(area.y, Math.min(candidate.y, area.y + area.height - height)));
    const overlap = Math.max(0, Math.min(x + width, pet.x + pet.width) - Math.max(x, pet.x)) *
      Math.max(0, Math.min(y + height, pet.y + pet.height) - Math.max(y, pet.y));
    const score = overlap * 1_000_000 + Math.abs(x - candidate.x) + Math.abs(y - candidate.y);
    if (score < bestScore) {
      best = { x, y, width, height };
      bestScore = score;
    }
  }
  return best;
}

module.exports = { getInitialBounds, getVisibleBounds, getPanelBounds, isPosition };
