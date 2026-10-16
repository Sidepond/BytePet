import { appearanceReady, appearanceState, onAppearanceChanged } from './appearance-state.js';
import { characters, drawCharacter, charactersReady, CHARACTER_SIZE } from './characters.js';
import { moduleEnabled, modulesReady, moduleState, onModulesChanged } from './module-state.js';
import { enableFoodDrop, resultMessage } from './feeding.js';
import { setupJwtPanel } from './jwt-panel.js';
import { setupJsonPanel } from './json-panel.js';
import { setupFormatPanel } from './format-panel.js';
import { setupPortsPanel } from './ports-panel.js';
import { setupUsagePanel } from './usage-panel.js';
import { setupFoodShelf } from './food-shelf.js';
import { setupAppPreferences } from './app-preferences-panel.js';

await Promise.all([modulesReady, appearanceReady, charactersReady]);
const draft = document.querySelector('#draft');
const convertDraft = document.querySelector('#convert-draft');
const composer = document.querySelector('#food-composer');
function syncComposer() { document.querySelector('#composer-label').textContent = draft.value ? '작성 중인 메모' : '메모 남기기 · 파일 넣기'; }
function expandComposer() { composer.open = true; syncComposer(); draft.focus(); }
draft.addEventListener('input', syncComposer);
const jwt = setupJwtPanel(convertDraft, () => json.clear());
const json = setupJsonPanel(convertDraft, () => jwt.clear());
function clearResults() { jwt.clear(); json.clear(); }
const updateFormat = setupFormatPanel(convertDraft, { jwt, json }, clearResults, () => moduleEnabled('m01'));
function draftChanged() { clearResults(); updateFormat(); syncSendToFood(); }
const status = document.querySelector('#feed-status');
const files = document.querySelector('#files');
const ports = setupPortsPanel();
const usage = setupUsagePanel();
const appPreferences = setupAppPreferences();
let view = 'food';
composer.addEventListener('toggle', () => { if (composer.open && view === 'food' && !document.querySelector('dialog[open]')) draft.focus(); });
const shelf = setupFoodShelf({ enabled: () => moduleEnabled('m01'), feedback, isFoodView: () => view === 'food',
  onText(text, destination) {
    if (destination === 'convert') { convertDraft.value = text; draftChanged(); showView('convert'); }
    else { draft.value = text; expandComposer(); }
  },
});
const refresh = () => shelf.refresh();
const labels = { food: '먹이', convert: '변환', ports: '개발 포트', usage: 'AI 사용량', settings: '설정' };
function renderView() {
  const off = (['food', 'convert'].includes(view) && !moduleEnabled('m01')) || (view === 'ports' && !moduleEnabled('m02'));
  window.utilityPanel.setView(off ? 'off' : view);
  document.querySelector('#food-view').hidden = view !== 'food' || off;
  document.querySelector('#convert-view').hidden = view !== 'convert' || off;
  document.querySelector('#ports-view').hidden = view !== 'ports' || off;
  document.querySelector('#usage-view').hidden = view !== 'usage';
  document.querySelector('#settings-view').hidden = view !== 'settings';
  document.querySelector('#module-off').hidden = !off;
  document.querySelector('#module-off-message').textContent = `${labels[view]} 모듈이 꺼져 있어요.`;
  for (const name of Object.keys(labels)) document.querySelector(`#show-${name}`).setAttribute('aria-pressed', String(view === name));
  document.querySelector('#panel-title').textContent = labels[view];
}
function focusView() {
  if (view === 'food' && moduleEnabled('m01')) (composer.open ? draft : composer.querySelector('summary')).focus({ preventScroll: true });
  else if (view === 'convert' && moduleEnabled('m01')) convertDraft.focus({ preventScroll: true });
  else if (view === 'settings') document.querySelector('#character-picker button[aria-pressed="true"]').focus();
  else document.querySelector(`#show-${view}`).focus({ preventScroll: true });
}
function showView(next) {
  if (next !== 'food') shelf.leave();
  view = next;
  document.body.classList.remove('food-over');
  renderView();
  document.querySelector('.content').scrollTo(0, 0);
  if (next === 'usage') usage.refresh();
  else if (next === 'ports') ports.refresh();
  else if (next === 'food') refresh();
  else if (next === 'settings') appPreferences.refresh();
  focusView();
}
for (const name of Object.keys(labels)) document.querySelector(`#show-${name}`).addEventListener('click', () => showView(name));
document.querySelector('#enable-module').addEventListener('click', () => showView('settings'));
let busy = false;
let foodGeneration = 0;
let feedbackTimer;
function feedback(text, error = false) {
  clearTimeout(feedbackTimer);
  if (text && !error) feedbackTimer = setTimeout(() => { if (!busy && status.textContent === text) status.textContent = ''; }, 4000);
  status.textContent = text;
  status.classList.toggle('error', error);
}
async function consume(operation) {
  if (!moduleEnabled('m01')) return;
  const current = foodGeneration;
  if (busy) { feedback('저장 중이에요. 잠시 기다려 주세요.', true); return; }
  busy = true;
  draft.disabled = true;
  document.querySelector('#feed-text').disabled = true;
  document.querySelector('#choose-files').disabled = true;
  feedback('먹이를 보관함에 저장하고 있어요…');
  try {
    const result = await operation();
    if (current !== foodGeneration) return;
    feedback(resultMessage(result), !result.ok || result.value.errors.length > 0);
    if (result.ok && result.value.items.length) await refresh();
    return result;
  } catch { if (current === foodGeneration) feedback('저장하지 못했어요. 다시 시도해 주세요.', true); }
  finally {
    if (current !== foodGeneration) return;
    busy = false;
    draft.disabled = false;
    document.querySelector('#feed-text').disabled = false;
    document.querySelector('#choose-files').disabled = false;
  }
}
document.querySelector('#feed-text').addEventListener('click', async () => {
  const text = draft.value;
  const result = await consume(() => window.food.saveText(text));
  if (result?.ok && result.value.items.length && draft.value === text) { draft.value = ''; composer.open = false; syncComposer(); if (view === 'food') composer.querySelector('summary').focus({ preventScroll: true }); }
});
document.querySelector('#choose-files').addEventListener('click', () => { if (moduleEnabled('m01')) files.click(); });
files.addEventListener('change', () => {
  const selected = Array.from(files.files);
  files.value = '';
  if (selected.length) consume(() => window.food.saveFiles(selected));
});
document.querySelector('#open-folder').addEventListener('click', async () => {
  if (!moduleEnabled('m01')) return;
  const current = foodGeneration;
  const result = await window.food.folder();
  if (current === foodGeneration && !result.ok) feedback(result.error, true);
});
enableFoodDrop(document.body, consume, () => moduleEnabled('m01') && view === 'food' && !document.querySelector('dialog[open]'));
document.addEventListener('paste', event => {
  if (document.querySelector('dialog[open]') || (document.activeElement?.matches('input, textarea') && document.activeElement !== draft && document.activeElement !== convertDraft)) return;
  if (!['food', 'convert'].includes(view) || !moduleEnabled('m01')) return;
  const images = Array.from(event.clipboardData.files);
  if (images.length) {
    event.preventDefault();
    if (view !== 'food') return;
    consume(() => window.food.saveFiles(images));
  } else {
    const input = view === 'food' ? draft : convertDraft;
    if (document.activeElement === input) return;
    event.preventDefault();
    input.value += event.clipboardData.getData('text/plain');
    if (view === 'convert') draftChanged();
    if (view === 'food') expandComposer();
    else input.focus();
  }
});
const sendToFood = document.querySelector('#send-to-food');
function syncSendToFood() { sendToFood.disabled = !convertDraft.value.trim(); }
convertDraft.addEventListener('input', syncSendToFood);
syncSendToFood();
document.querySelector('#send-to-food').addEventListener('click', () => {
  if (!moduleEnabled('m01') || !convertDraft.value.trim()) return;
  draft.value = convertDraft.value;
  composer.open = true; syncComposer();
  showView('food');
});
document.querySelector('#close').addEventListener('click', () => window.utilityPanel.close());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !event.isComposing && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    window.utilityPanel.close();
  }
});
window.utilityPanel.onOpen(requested => {
  if (requested === 'usage' || requested === 'settings') { showView(requested); return; }
  focusView();
  if (view === 'usage') usage.refresh();
  else if (view === 'ports') ports.refresh();
  else if (view === 'food') refresh();
  else if (view === 'settings') appPreferences.refresh();
});
window.food.onChanged(() => { if (moduleEnabled('m01')) refresh(); });
window.food.onSaved(({ count }) => {
  if (!moduleEnabled('m01')) return;
  feedback(`${count}개를 보관함에 저장했어요.`);
  refresh();
});
const settingsStatus = document.querySelector('#settings-status');
let settingBusy = false;
function syncSettings() {
  for (const key of ['m01', 'm02']) {
    document.querySelector(`#module-${key}`).checked = moduleEnabled(key);
    document.querySelector(`#module-${key}`).disabled = settingBusy;
    document.querySelector(`#state-${key}`).textContent = moduleEnabled(key) ? 'ON' : 'OFF';
  }
  for (const name of ['food', 'convert']) document.querySelector(`#show-${name}`).title = `${labels[name]}${moduleEnabled('m01') ? '' : ' 꺼짐'}`;
  document.querySelector('#show-ports').title = moduleEnabled('m02') ? '개발 포트' : '개발 포트 꺼짐';
  if (moduleState().warning) {
    settingsStatus.classList.add('error');
    settingsStatus.textContent = moduleState().warning;
  }
}
onModulesChanged((next, previous) => {
  if (next.modules.m01 !== previous.modules.m01) {
    foodGeneration++;
    clearResults();
    updateFormat();
    shelf.clear();
    feedback('');
    files.value = '';
    busy = false;
    draft.disabled = false;
    document.querySelector('#feed-text').disabled = false;
    document.querySelector('#choose-files').disabled = false;
    document.body.classList.remove('food-over');
    if (next.modules.m01 && view === 'food') refresh();
  }
  ports.setEnabled(next.modules.m02);
  if (next.modules.m02 && !previous.modules.m02 && view === 'ports') ports.refresh();
  syncSettings();
  renderView();
});
for (const key of ['m01', 'm02']) document.querySelector(`#module-${key}`).addEventListener('change', async event => {
  if (settingBusy) return;
  settingBusy = true;
  const enabled = event.target.checked;
  syncSettings();
  settingsStatus.classList.remove('error');
  settingsStatus.textContent = '설정을 저장하고 있어요…';
  try {
    const response = await window.modules.set(key, enabled);
    if (!response.ok) throw new Error(response.error);
    settingsStatus.textContent = `${key === 'm01' ? '먹이·변환' : '개발 포트'} ${enabled ? '켬' : '끔'} · 저장했어요.`;
  } catch (error) {
    settingsStatus.classList.add('error');
    settingsStatus.textContent = error.message || '설정을 저장하지 못했어요. 다시 시도해 주세요.';
  } finally {
    settingBusy = false;
    syncSettings();
  }
});
const sideControl = document.querySelector('#menu-side');
const groundControl = document.querySelector('#show-ground');
const appearanceStatus = document.querySelector('#appearance-status');
const characterButtons = characters.map(character => {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.character = character.id;
  button.setAttribute('aria-label', character.name);
  button.title = `${character.name} · ${character.kind}`;
  const preview = document.createElement('canvas');
  preview.width = preview.height = CHARACTER_SIZE;
  preview.setAttribute('aria-hidden', 'true');
  drawCharacter(preview.getContext('2d'), character.id);
  const label = document.createElement('span');
  label.textContent = character.name;
  button.append(preview, label);
  button.addEventListener('click', () => changeAppearance('character', character.id));
  document.querySelector('#character-picker').append(button);
  return button;
});
let appearanceBusy = false;
function syncAppearance() {
  const { preferences, warning } = appearanceState();
  sideControl.value = preferences.menuSide;
  groundControl.checked = preferences.ground;
  sideControl.disabled = groundControl.disabled = appearanceBusy;
  for (const button of characterButtons) {
    button.disabled = appearanceBusy;
    button.setAttribute('aria-pressed', String(button.dataset.character === preferences.character));
  }
  if (warning) {
    appearanceStatus.classList.add('error');
    appearanceStatus.textContent = warning;
  }
}
async function changeAppearance(key, value) {
  if (appearanceBusy) return;
  appearanceBusy = true;
  syncAppearance();
  appearanceStatus.classList.remove('error');
  appearanceStatus.textContent = '저장 중…';
  try {
    const result = await window.appearance.set(key, value);
    if (!result.ok) throw new Error(result.error);
    appearanceStatus.textContent = '저장했어요.';
  } catch (error) {
    appearanceStatus.classList.add('error');
    appearanceStatus.textContent = error.message || '화면 설정을 저장하지 못했어요.';
  } finally {
    appearanceBusy = false;
    syncAppearance();
  }
}
sideControl.addEventListener('change', () => changeAppearance('menuSide', sideControl.value));
groundControl.addEventListener('change', () => changeAppearance('ground', groundControl.checked));
onAppearanceChanged(syncAppearance);
syncAppearance();
ports.setEnabled(moduleEnabled('m02'));
syncSettings();
renderView();
window.utilityPanel.ready();
refresh();
