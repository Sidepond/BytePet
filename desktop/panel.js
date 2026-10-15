import { moduleEnabled, modulesReady, moduleState, onModulesChanged } from './module-state.js';
import { enableFoodDrop, resultMessage } from './feeding.js';
import { setupJwtPanel } from './jwt-panel.js';
import { setupJsonPanel } from './json-panel.js';
import { setupFormatPanel } from './format-panel.js';
import { setupPortsPanel } from './ports-panel.js';

await modulesReady;
const draft = document.querySelector('#draft');
const jwt = setupJwtPanel(draft, () => json.clear());
const json = setupJsonPanel(draft, () => jwt.clear());
function clearResults() { jwt.clear(); json.clear(); }
const updateFormat = setupFormatPanel(draft, { jwt, json }, clearResults, () => moduleEnabled('m01'));
function draftChanged() { clearResults(); updateFormat(); }
const status = document.querySelector('#feed-status');
const list = document.querySelector('#food-list');
const files = document.querySelector('#files');
const ports = setupPortsPanel();
let view = 'food';
function renderView() {
  const off = (view === 'food' && !moduleEnabled('m01')) || (view === 'ports' && !moduleEnabled('m02'));
  document.querySelector('#food-view').hidden = view !== 'food' || off;
  document.querySelector('#ports-view').hidden = view !== 'ports' || off;
  document.querySelector('#settings-view').hidden = view !== 'settings';
  document.querySelector('#module-off').hidden = !off;
  document.querySelector('#module-off-message').textContent = `${view === 'food' ? '먹이·변환' : '개발 포트'} 모듈이 꺼져 있어요.`;
  for (const name of ['food', 'ports', 'settings']) document.querySelector(`#show-${name}`).setAttribute('aria-pressed', String(view === name));
  document.querySelector('#panel-title').textContent = view === 'settings' ? '모듈 설정' : view === 'ports' ? '개발 포트' : '오늘의 먹이';
}
function focusView() {
  if (view === 'food' && moduleEnabled('m01')) draft.focus({ preventScroll: true });
  else if (view === 'settings') document.querySelector('#module-m01').focus({ preventScroll: true });
  else document.querySelector(`#show-${view}`).focus({ preventScroll: true });
}
function showView(next) {
  view = next;
  renderView();
  window.scrollTo(0, 0);
  if (next === 'ports') ports.refresh();
  else if (next === 'food') refresh();
  focusView();
}
for (const name of ['food', 'ports', 'settings']) document.querySelector(`#show-${name}`).addEventListener('click', () => showView(name));
document.querySelector('#enable-module').addEventListener('click', () => showView('settings'));
let busy = false;
let listVersion = 0;
let foodGeneration = 0;
function feedback(text, error = false) {
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
async function refresh() {
  if (!moduleEnabled('m01')) return;
  const version = ++listVersion;
  const result = await window.food.list();
  if (version !== listVersion) return;
  if (!result.ok) { feedback(result.error, true); return; }
  list.replaceChildren();
  document.querySelector('#empty-shelf').hidden = result.value.length > 0;
  for (const item of result.value) {
    const row = document.createElement('li');
    row.dataset.id = item.id;
    const name = document.createElement('span');
    name.className = 'item-name';
    name.textContent = item.name;
    const meta = document.createElement('p');
    meta.className = 'item-meta';
    const size = item.size < 1024 ? `${item.size} B` : `${(item.size / 1024).toFixed(1)} KB`;
    meta.textContent = `${item.kind === 'text' ? '텍스트' : '파일'} · ${size} · ${new Date(item.createdAt).toLocaleString('ko-KR')}`;
    const actions = document.createElement('div');
    actions.className = 'item-actions';
    function button(label, run) {
      const control = document.createElement('button');
      control.type = 'button';
      control.textContent = label;
      control.addEventListener('click', async () => {
        if (!moduleEnabled('m01')) return;
        const current = foodGeneration;
        try { const result = await run(); if (current === foodGeneration && !result.ok) feedback(result.error, true); }
        catch { if (current === foodGeneration) feedback('항목을 열지 못했어요.', true); }
      });
      actions.append(control);
    }
    if (item.kind === 'text') button('텍스트 불러오기', async () => {
      const current = foodGeneration;
      const result = await window.food.readText(item.id);
      if (current === foodGeneration && result.ok) { draft.value = result.value; draftChanged(); draft.focus(); }
      return result;
    });
    else button('파일 열기', () => window.food.open(item.id));
    button('폴더에서 보기', () => window.food.reveal(item.id));
    row.append(name, meta, actions);
    list.append(row);
  }
}
document.querySelector('#feed-text').addEventListener('click', async () => {
  const text = draft.value;
  const result = await consume(() => window.food.saveText(text));
  if (result?.ok && result.value.items.length && draft.value === text) { draft.value = ''; draftChanged(); }
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
enableFoodDrop(document.body, consume, () => moduleEnabled('m01') && view === 'food');
document.addEventListener('paste', event => {
  if (view !== 'food' || !moduleEnabled('m01')) return;
  const images = Array.from(event.clipboardData.files);
  if (images.length) {
    event.preventDefault();
    consume(() => window.food.saveFiles(images));
  } else if (document.activeElement !== draft) {
    event.preventDefault();
    draft.value += event.clipboardData.getData('text/plain');
    draftChanged();
    draft.focus();
  }
});
document.querySelector('#close').addEventListener('click', () => window.utilityPanel.close());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !event.isComposing) {
    event.preventDefault();
    window.utilityPanel.close();
  }
});
window.utilityPanel.onOpen(() => {
  focusView();
  if (view === 'ports') ports.refresh();
  else if (view === 'food') refresh();
});
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
  document.querySelector('#show-food').textContent = moduleEnabled('m01') ? '먹이·변환' : '먹이·변환 OFF';
  document.querySelector('#show-ports').textContent = moduleEnabled('m02') ? '개발 포트' : '개발 포트 OFF';
  if (moduleState().warning) {
    settingsStatus.classList.add('error');
    settingsStatus.textContent = moduleState().warning;
  }
}
onModulesChanged((next, previous) => {
  if (next.modules.m01 !== previous.modules.m01) {
    foodGeneration++;
    listVersion++;
    clearResults();
    updateFormat();
    list.replaceChildren();
    feedback('먹인 내용은 이 컴퓨터에 저장됩니다.');
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
    settingsStatus.textContent = `${key.toUpperCase()} ${enabled ? 'ON' : 'OFF'} · 저장했어요.`;
  } catch (error) {
    settingsStatus.classList.add('error');
    settingsStatus.textContent = error.message || '설정을 저장하지 못했어요. 다시 시도해 주세요.';
  } finally {
    settingBusy = false;
    syncSettings();
  }
});
ports.setEnabled(moduleEnabled('m02'));
syncSettings();
renderView();
window.utilityPanel.ready();
refresh();
