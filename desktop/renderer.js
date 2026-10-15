import { drawCat, drawEatingCat, EATING_MS } from './cat.js';
import { enableDragging } from './drag.js';
import { isCanvasHit, createHitRegionReporter } from './hit-test.js';
import { enableFoodDrop, resultMessage } from './feeding.js';

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
let eatingStarted = null;
let eatingTimer;
let messageTimer;
let feeding = false;
const message = document.querySelector('#pet-message');
function showMessage(text) {
  clearTimeout(messageTimer);
  message.textContent = text;
  message.hidden = false;
  messageTimer = setTimeout(() => { message.hidden = true; }, 3500);
}
async function consume(operation) {
  if (feeding) return;
  feeding = true;
  try {
    const result = await operation();
    if (!result.ok || result.value.errors.length) showMessage(resultMessage(result));
  } catch { showMessage('저장하지 못했어요.'); }
  finally { feeding = false; }
}
enableFoodDrop(document.body, consume, event => isCanvasHit(canvas, event));
document.addEventListener('paste', event => {
  event.preventDefault();
  const files = Array.from(event.clipboardData.files);
  const text = event.clipboardData.getData('text/plain');
  consume(() => files.length ? window.food.saveFiles(files) : window.food.saveText(text));
});
window.food.onSaved(({ count }) => {
  eatingStarted = performance.now();
  canvas.dataset.state = 'eating';
  showMessage(`냠냠! ${count}개 저장했어요`);
  clearTimeout(eatingTimer);
  eatingTimer = setTimeout(() => {
    eatingStarted = null;
    canvas.dataset.state = 'idle';
    updateAnimation();
  }, EATING_MS);
  updateAnimation();
});

function render() {
  if (eatingStarted !== null) drawEatingCat(ctx, reducedMotion.matches ? 1500 : performance.now() - eatingStarted);
  else drawCat(ctx, reducedMotion.matches ? 0 : performance.now() - startedAt);
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
