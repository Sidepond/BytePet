import { drawCat } from './cat.js';
import { enableDragging } from './drag.js';
import { isCanvasHit, createHitRegionReporter } from './hit-test.js';

const canvas = document.querySelector('#pet');
enableDragging(canvas, window.petDrag, event => isCanvasHit(canvas, event), () => window.petPanel.toggle());
window.petPanel.onState(open => canvas.setAttribute('aria-expanded', String(open)));
canvas.addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
    event.preventDefault();
    window.petPanel.toggle();
  }
});
const reportHitRegion = createHitRegionReporter(canvas, window.petInput);
const ctx = canvas.getContext('2d');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const startedAt = performance.now();
let timer;

function render() {
  drawCat(ctx, reducedMotion.matches ? 0 : performance.now() - startedAt);
  reportHitRegion();
}

function updateAnimation() {
  clearInterval(timer);
  render();
  // A pixel idle animation needs only 10fps, not a permanent 60fps loop.
  if (!document.hidden && !reducedMotion.matches) timer = setInterval(render, 100);
}

reducedMotion.addEventListener('change', updateAnimation);
document.addEventListener('visibilitychange', updateAnimation);
window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
window.addEventListener('resize', reportHitRegion);
updateAnimation();
