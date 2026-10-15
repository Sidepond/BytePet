import { enableFoodDrop, resultMessage } from './feeding.js';

const draft = document.querySelector('#draft');
const status = document.querySelector('#feed-status');
const list = document.querySelector('#food-list');
const files = document.querySelector('#files');
let busy = false;
let listVersion = 0;
function feedback(text, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
}
async function consume(operation) {
  if (busy) { feedback('저장 중이에요. 잠시 기다려 주세요.', true); return; }
  busy = true;
  draft.disabled = true;
  document.querySelector('#feed-text').disabled = true;
  document.querySelector('#choose-files').disabled = true;
  feedback('먹이를 보관함에 저장하고 있어요…');
  try {
    const result = await operation();
    feedback(resultMessage(result), !result.ok || result.value.errors.length > 0);
    if (result.ok && result.value.items.length) await refresh();
    return result;
  } catch { feedback('저장하지 못했어요. 다시 시도해 주세요.', true); }
  finally {
    busy = false;
    draft.disabled = false;
    document.querySelector('#feed-text').disabled = false;
    document.querySelector('#choose-files').disabled = false;
  }
}
async function refresh() {
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
        try { const result = await run(); if (!result.ok) feedback(result.error, true); }
        catch { feedback('항목을 열지 못했어요.', true); }
      });
      actions.append(control);
    }
    if (item.kind === 'text') button('텍스트 불러오기', async () => {
      const result = await window.food.readText(item.id);
      if (result.ok) { draft.value = result.value; draft.focus(); }
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
  if (result?.ok && result.value.items.length && draft.value === text) draft.value = '';
});
document.querySelector('#choose-files').addEventListener('click', () => files.click());
files.addEventListener('change', () => {
  const selected = Array.from(files.files);
  files.value = '';
  if (selected.length) consume(() => window.food.saveFiles(selected));
});
document.querySelector('#open-folder').addEventListener('click', async () => {
  const result = await window.food.folder();
  if (!result.ok) feedback(result.error, true);
});
enableFoodDrop(document.body, consume);
document.addEventListener('paste', event => {
  const images = Array.from(event.clipboardData.files);
  if (images.length) {
    event.preventDefault();
    consume(() => window.food.saveFiles(images));
  } else if (document.activeElement !== draft) {
    event.preventDefault();
    draft.value += event.clipboardData.getData('text/plain');
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
window.utilityPanel.onOpen(() => { draft.focus({ preventScroll: true }); refresh(); });
window.food.onSaved(({ count }) => { feedback(`${count}개를 보관함에 저장했어요.`); refresh(); });
refresh();
