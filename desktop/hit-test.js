export function isCanvasHit(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.x) * canvas.width / rect.width);
  const y = Math.floor((event.clientY - rect.y) * canvas.height / rect.height);
  return x >= 0 && y >= 0 && x < canvas.width && y < canvas.height &&
    canvas.getContext('2d').getImageData(x, y, 1, 1).data[3] > 0;
}

export function createHitRegionReporter(canvas, bridge) {
  let previous;
  return () => {
    const rect = canvas.getBoundingClientRect();
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const region = {
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      columns: canvas.width, rows: canvas.height,
      alpha: Array.from({ length: canvas.width * canvas.height }, (_, i) => data[i * 4 + 3]),
    };
    const signature = JSON.stringify(region);
    if (signature !== previous) {
      previous = signature;
      bridge.updateRegion(region);
    }
  };
}
