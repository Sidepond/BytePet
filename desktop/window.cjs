const WINDOW_WIDTH = 496;
const WINDOW_HEIGHT = 128;
const MARGIN = 24;

function getInitialBounds(workArea, preferences = { ground: true }) {
  const width = Math.min(preferences.ground ? WINDOW_WIDTH : 128, workArea.width);
  const height = Math.min(WINDOW_HEIGHT, workArea.height);
  return {
    width, height,
    x: workArea.x + Math.max(0, workArea.width - width - MARGIN),
    y: workArea.y + Math.max(0, workArea.height - height - MARGIN),
  };
}

function isPosition(value) {
  return value != null && ['x', 'y'].every(key =>
    Number.isInteger(value[key]) && Math.abs(value[key]) <= 1_000_000);
}

function getVisibleBounds(position, workAreas, primaryWorkArea, preferences = { ground: true }) {
  if (!isPosition(position)) return getInitialBounds(primaryWorkArea, preferences);
  let closest;
  let distance = Infinity;
  for (const area of workAreas.length ? workAreas : [primaryWorkArea]) {
    const width = Math.min(preferences.ground ? WINDOW_WIDTH : 128, area.width);
    const height = Math.min(WINDOW_HEIGHT, area.height);
    const x = Math.max(area.x, Math.min(position.x, area.x + area.width - width));
    const y = Math.max(area.y, Math.min(position.y, area.y + area.height - height));
    const correction = (x - position.x) ** 2 + (y - position.y) ** 2;
    if (correction < distance) {
      closest = { x, y, width, height };
      distance = correction;
    }
  }
  return closest;
}

// The house's visible bottom is 10px above its native window bottom.
// The grass starts 20px above the yard bottom, so both share one baseline.
function panelWidth(pet, area, preferences) {
  return Math.min(360, Math.max(1, preferences.ground ? pet.width - 128 : area.width - pet.width - 8));
}

function getYardBoundsForPanel(pet, area, preferredHeight, preferences = { ground: true, menuSide: 'left' }) {
  const bounds = getVisibleBounds(pet, [area], area, preferences);
  const height = Math.min(preferredHeight, Math.max(1, area.height - 10));
  const minY = area.y + height - (bounds.height - 10);
  if (!preferences.ground) {
    const space = panelWidth(bounds, area, preferences) + 8;
    bounds.x = preferences.menuSide === 'left'
      ? Math.max(bounds.x, area.x + space)
      : Math.min(bounds.x, area.x + area.width - bounds.width - space);
  }
  return { ...bounds, y: Math.max(bounds.y, Math.min(minY, area.y + area.height - bounds.height)) };
}

function getPanelBounds(pet, area, preferredHeight = 588, preferences = { ground: true, menuSide: 'left' }) {
  const bottom = pet.y + pet.height - 10;
  const width = panelWidth(pet, area, preferences);
  const height = Math.min(preferredHeight, Math.max(1, bottom - area.y));
  const x = preferences.ground
    ? (preferences.menuSide === 'left' ? pet.x : pet.x + pet.width - width)
    : (preferences.menuSide === 'left' ? pet.x - width - 8 : pet.x + pet.width + 8);
  return { x, y: bottom - height, width, height };
}

module.exports = { getInitialBounds, getVisibleBounds, getPanelBounds, getYardBoundsForPanel, isPosition };
