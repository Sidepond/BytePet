import { drawCat, drawEatingCat, drawResultCat, drawAttackCat } from './cat.js';
import { createReactionPlayer } from './reaction.js';
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
let reaction = { state: 'idle', startedAt: 0 };
let messageTimer;
let feeding = false;
const message = document.querySelector('#pet-message');
const reactions = createReactionPlayer(next => {
  reaction = next;
  canvas.dataset.state = next.state;
  if (next.state === 'processing') showMessage('냠냠…');
  if (next.state === 'attack') showMessage('얍! 종료를 요청했어요');
  if (next.state === 'success') showMessage(next.source === 'ports' ? '프로세스를 종료했어요!' : '변환했어요!');
  if (next.state === 'failure') showMessage(next.source === 'ports' ? '종료 결과를 확인해 주세요' : '입력을 확인해 주세요');
  updateAnimation();
});
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
  reactions.play('eating');
  showMessage(`냠냠! ${count}개 저장했어요`);
});
window.resultTools.onReaction(outcome => reactions.play(outcome));
window.ports.onReaction(reaction => reactions.portReaction(reaction));

function render() {
  const elapsed = performance.now() - reaction.startedAt;
  if (reaction.state === 'eating') drawEatingCat(ctx, reducedMotion.matches ? 1500 : elapsed);
  else if (reaction.state === 'attack') drawAttackCat(ctx, reducedMotion.matches ? 150 : elapsed);
  else if (reaction.state === 'processing') drawEatingCat(ctx, reducedMotion.matches ? 700 : 400 + elapsed % 900);
  else if (reaction.state === 'success' || reaction.state === 'failure') drawResultCat(ctx, reaction.state, reducedMotion.matches ? 0 : elapsed);
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
window.addEventListener('pagehide', () => { clearInterval(timer); clearTimeout(messageTimer); reactions.dispose(); }, { once: true });
window.addEventListener('resize', reportHitRegion);
updateAnimation();
