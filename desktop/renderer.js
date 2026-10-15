import { drawCat } from './cat.js';

const canvas = document.querySelector('#pet');
const ctx = canvas.getContext('2d');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const startedAt = performance.now();
let timer;

function render() {
  drawCat(ctx, reducedMotion.matches ? 0 : performance.now() - startedAt);
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
updateAnimation();
