export function enableDragging(canvas, bridge, canStart = () => true, onActivate = () => {}, onDragState = () => {}) {
  let gesture;

  function finish(reason = 'cancel') {
    if (!gesture) return;
    const { pointerId, dragging } = gesture;
    gesture = null;
    bridge.end();
    canvas.classList.remove('dragging');
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    if (dragging) onDragState(false, reason);
  }

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || gesture || !canStart(event)) return;
    gesture = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, dragging: false };
    canvas.setPointerCapture(event.pointerId);
    // Hold native input from pointer-down, including the pre-drag threshold.
    bridge.start(Math.round(gesture.x), Math.round(gesture.y));
  });
  canvas.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (!(event.buttons & 1)) return finish();
    if (!gesture.dragging) {
      if (Math.hypot(event.screenX - gesture.x, event.screenY - gesture.y) < 4) return;
      gesture.dragging = true;
      canvas.classList.add('dragging');
      onDragState(true, 'start');
    }
    bridge.move(Math.round(event.screenX), Math.round(event.screenY));
  });
  canvas.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.pointerId || event.button !== 0) return;
    const activate = !gesture.dragging && canStart(event) && Math.hypot(event.screenX - gesture.x, event.screenY - gesture.y) < 4;
    if (gesture.dragging) bridge.move(Math.round(event.screenX), Math.round(event.screenY));
    finish('release');
    if (activate) onActivate();
  });
  const cancel = () => finish();
  canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('lostpointercapture', cancel);
  window.addEventListener('blur', cancel);
  window.addEventListener('pagehide', cancel);
  return { cancel };
}
