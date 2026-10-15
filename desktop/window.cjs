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

module.exports = { getInitialBounds };
