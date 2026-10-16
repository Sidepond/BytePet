import { moduleEnabled, moduleState, modulesReady, onModulesChanged } from './module-state.js';
import { characterFor, drawCharacter, charactersReady, characterIdleAnchor } from './characters.js';
import { appearanceReady, appearanceState, onAppearanceChanged } from './appearance-state.js';
import { createReactionPlayer } from './reaction.js';
import { enableDragging } from './drag.js';
import { isCanvasHit, createHitRegionReporter } from './hit-test.js';
import { enableFoodDrop, resultMessage } from './feeding.js';
import { createIdleBehavior } from './idle-behavior.js';
import { LANDING_MS } from './sprite-character.js';

await Promise.all([modulesReady, appearanceReady, charactersReady]);
const canvas = document.querySelector('#pet');
let dragVisual = null;
const petDragging = enableDragging(canvas, window.petDrag, event => isCanvasHit(canvas, event), () => window.petPanel.toggle(), (active, reason) => {
  dragVisual = active ? { state: 'dragging', startedAt: performance.now() }
    : reason === 'release' && !reducedMotion.matches && nativeVisible ? { state: 'landing', startedAt: performance.now() } : null;
  updateAnimation();
});
const groundDragging = enableDragging(document.querySelector('#yard-ground'), window.petDrag);
let panelOpen = false;
window.petPanel.onState(open => {
  panelOpen = open;
  canvas.setAttribute('aria-expanded', String(open));
  updateAnimation();
});
canvas.addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
    event.preventDefault();
    window.petPanel.toggle();
  }
});
const reportHitRegion = createHitRegionReporter(canvas, window.petInput, () => characterIdleAnchor(appearanceState().preferences.character));
const ctx = canvas.getContext('2d');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
// Only schedule poses present in the approved image pack.
const idleBehavior = createIdleBehavior({ actions: ['sleeping'] });
let nativeVisible = true;
let timer;
let reaction = { state: 'idle', startedAt: 0 };
let messageTimer;
let messageModule = 'm01';
let feeding = false;
const message = document.querySelector('#pet-message');
const reactions = createReactionPlayer(next => {
  reaction = next;
  canvas.dataset.state = next.state;
  if (next.state === 'processing') showMessage('냠냠…');
  if (next.state === 'attack') showMessage('얍! 종료를 요청했어요', 'm02');
  if (next.state === 'success') showMessage(next.source === 'ports' ? '프로세스를 종료했어요!' : '변환했어요!', next.source === 'ports' ? 'm02' : 'm01');
  if (next.state === 'failure') showMessage(next.source === 'ports' ? '종료 결과를 확인해 주세요' : '입력을 확인해 주세요', next.source === 'ports' ? 'm02' : 'm01');
  updateAnimation();
});
function showMessage(text, module = 'm01') {
  clearTimeout(messageTimer);
  messageModule = module;
  message.textContent = text;
  message.hidden = false;
  messageTimer = setTimeout(() => { message.hidden = true; }, 3500);
}
async function consume(operation) {
  if (feeding || !moduleEnabled('m01')) return;
  feeding = true;
  const epoch = moduleState().epochs.m01;
  try {
    const result = await operation();
    if (epoch !== moduleState().epochs.m01 || !moduleEnabled('m01')) return;
    if (!result.ok || result.value.errors.length) showMessage(resultMessage(result));
  } catch { if (epoch === moduleState().epochs.m01 && moduleEnabled('m01')) showMessage('저장하지 못했어요.'); }
  finally { feeding = false; }
}
enableFoodDrop(document.body, consume, event => moduleEnabled('m01') && isCanvasHit(canvas, event));
document.addEventListener('paste', event => {
  if (!moduleEnabled('m01')) return;
  event.preventDefault();
  const files = Array.from(event.clipboardData.files);
  const text = event.clipboardData.getData('text/plain');
  consume(() => files.length ? window.food.saveFiles(files) : window.food.saveText(text));
});
window.food.onSaved(({ count }) => {
  if (!moduleEnabled('m01')) return;
  reactions.play('eating');
  showMessage(`냠냠! ${count}개 저장했어요`);
});
window.resultTools.onReaction(outcome => { if (moduleEnabled('m01')) reactions.play(outcome); });
window.ports.onReaction(reaction => { if (moduleEnabled('m02')) reactions.portReaction(reaction); });
onModulesChanged(({ modules }) => {
  document.body.classList.remove('food-over');
  if ((reaction.source === 'ports' && !modules.m02) || (reaction.source !== 'ports' && !modules.m01)) {
    reactions.dispose();
    reaction = { state: 'idle', startedAt: performance.now() };
    canvas.dataset.state = 'idle';
    updateAnimation();
  }
  if (!modules[messageModule]) {
    clearTimeout(messageTimer);
    message.hidden = true;
  }
});

function render() {
  const now = performance.now();
  let state = reaction.state;
  let elapsed = now - reaction.startedAt;
  if (state === 'idle') {
    const resting = nativeVisible && !panelOpen && !document.hidden && !reducedMotion.matches && !document.querySelector('.dragging');
    const pose = resting ? idleBehavior.sample(now) : { state: 'idle', elapsed: now };
    state = pose.state;
    elapsed = pose.elapsed;
  }
  if (dragVisual?.state === 'landing' && (now - dragVisual.startedAt >= LANDING_MS || reducedMotion.matches)) dragVisual = null;
  if (dragVisual) { state = dragVisual.state; elapsed = now - dragVisual.startedAt; }
  if (reducedMotion.matches) elapsed = state === 'eating' ? 800 : state === 'attack' ? 150 : state === 'processing' ? 300 : 0;
  canvas.dataset.motion = dragVisual?.state ?? '';
  canvas.dataset.idle = reaction.state === 'idle' && !dragVisual ? state : '';
  drawCharacter(ctx, appearanceState().preferences.character, state, elapsed);
  reportHitRegion();
}

function updateAnimation() {
  clearInterval(timer);
  idleBehavior.reset(performance.now());
  render();
  // A stationary pixel pet only needs 10fps for its idle and reaction frames.
  if (nativeVisible && !document.hidden && !reducedMotion.matches) timer = setInterval(render, 100);
}

// Let the original silhouette complete click hit testing before waking the pet.
document.addEventListener('pointerup', updateAnimation);
document.addEventListener('pointercancel', updateAnimation);

reducedMotion.addEventListener('change', updateAnimation);
document.addEventListener('visibilitychange', updateAnimation);
window.addEventListener('pagehide', () => { clearInterval(timer); clearTimeout(messageTimer); reactions.dispose(); }, { once: true });
function applyAppearance() {
  const { ground, menuSide, character } = appearanceState().preferences;
  const selected = characterFor(character);
  canvas.dataset.character = selected.id;
  canvas.setAttribute('aria-label', `${selected.name} 유틸리티 패널`);
  document.querySelector('#yard-ground').hidden = !ground;
  const size = canvas.getBoundingClientRect().width;
  const center = ground && menuSide === 'left' ? innerWidth - 64 : 64;
  const x = Math.max(0, Math.min(innerWidth - size, center - size / 2));
  canvas.style.left = `${x}px`;
  message.style.left = `${Math.max(0, Math.min(innerWidth - 128, x + size / 2 - 64))}px`;
  updateAnimation();
}
window.addEventListener('resize', applyAppearance);
onAppearanceChanged(applyAppearance);
applyAppearance();
window.petVisibility.onChanged(visible => {
  nativeVisible = visible;
  if (!visible) { petDragging.cancel(); groundDragging.cancel(); dragVisual = null; }
  canvas.dataset.visible = String(visible);
  updateAnimation();
});
window.petDrag.onReset(() => {
  petDragging.cancel();
  groundDragging.cancel();
  dragVisual = null;
  updateAnimation();
});
