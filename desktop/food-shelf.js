const ns = 'http://www.w3.org/2000/svg';
function fileStyle(item) {
  if (item.kind === 'text') return { icon: 'file', label: '메모', color: 'note' };
  const extension = item.name.split('.').pop().toLowerCase();
  const label = /^[a-z0-9]{1,6}$/.test(extension) ? extension.toUpperCase() : 'FILE';
  if (/^(png|jpe?g|gif|webp|heic|avif|bmp|svg)$/.test(extension)) return { icon: 'image', label, color: 'image' };
  if (/^(json|js|ts|jsx|tsx|py|html|css|sql|yaml|yml|xml)$/.test(extension)) return { icon: 'code', label, color: 'code' };
  if (/^(zip|gz|tar|7z|rar)$/.test(extension)) return { icon: 'archive', label, color: 'archive' };
  return { icon: 'file', label, color: 'document' };
}
function sizeLabel(size) {
  return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function setupFoodShelf({ enabled, onText, feedback, isFoodView }) {
  const list = document.querySelector('#food-list');
  const selection = document.querySelector('#shelf-selection');
  const open = document.querySelector('#shelf-open');
  const convert = document.querySelector('#shelf-convert');
  const reveal = document.querySelector('#shelf-reveal');
  let items = [], selected = null, version = 0, action = 0, busy = false;
  const selectedItem = () => items.find(item => item.id === selected);
  function select(id) {
    if (selected !== id) { action++; busy = false; }
    selected = id;
    const item = selectedItem();
    for (const tile of list.querySelectorAll('.file-tile')) tile.setAttribute('aria-pressed', String(tile.dataset.id === id));
    selection.hidden = !item;
    if (!item) return;
    document.querySelector('#selected-food-name').textContent = item.name;
    open.textContent = item.kind === 'text' ? '불러오기' : '열기';
    open.setAttribute('aria-label', item.kind === 'text' ? '텍스트 불러오기' : '파일 열기');
    reveal.setAttribute('aria-label', '폴더에서 보기');
    convert.hidden = item.kind !== 'text';
    open.disabled = convert.disabled = reveal.disabled = busy;
  }
  async function activate(destination = 'food') {
    const item = selectedItem();
    if (!item || !enabled() || busy) return;
    const current = ++action;
    busy = true; select(item.id);
    try {
      const response = destination === 'reveal' ? await window.food.reveal(item.id)
        : item.kind === 'text' ? await window.food.readText(item.id) : await window.food.open(item.id);
      if (current !== action || !enabled()) return;
      if (!response.ok) throw new Error(response.error);
      if (item.kind === 'text' && destination !== 'reveal' && isFoodView()) onText(response.value, destination);
    } catch (error) {
      if (current === action && enabled()) feedback(error.message || '항목을 열지 못했어요.', true);
    } finally {
      if (current === action) { busy = false; select(selected); }
    }
  }
  open.addEventListener('click', () => void activate());
  convert.addEventListener('click', () => void activate('convert'));
  reveal.addEventListener('click', () => void activate('reveal'));
  async function refresh() {
    if (!enabled()) return;
    const current = ++version;
    let response;
    try { response = await window.food.list(); }
    catch { if (current === version) feedback('보관함을 읽지 못했어요. 다시 열어 주세요.', true); return; }
    if (current !== version || !enabled()) return;
    if (!response.ok) { feedback(response.error, true); return; }
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset.id : null;
    items = response.value;
    list.replaceChildren();
    document.querySelector('#empty-shelf').hidden = items.length > 0;
    document.querySelector('#shelf-count').textContent = String(items.length);
    for (const item of items) {
      const row = document.createElement('li'); row.dataset.id = item.id;
      const tile = document.createElement('button'); tile.type = 'button'; tile.className = 'file-tile'; tile.dataset.id = item.id;
      tile.title = `${item.name}\n${sizeLabel(item.size)} · ${new Date(item.createdAt).toLocaleString('ko-KR')}\n더블클릭 또는 Enter로 열기`;
      const style = fileStyle(item);
      tile.dataset.kind = style.color;
      const icon = document.createElementNS(ns, 'svg'); icon.setAttribute('viewBox', '0 0 48 48'); icon.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS(ns, 'use'); use.setAttribute('href', `#icon-${style.icon}`); icon.append(use);
      const name = document.createElement('span'); name.className = 'item-name'; name.textContent = item.name;
      const meta = document.createElement('span'); meta.className = 'item-meta'; meta.textContent = `${style.label} · ${sizeLabel(item.size)}`;
      tile.append(icon, name, meta); row.append(tile); list.append(row);
      tile.addEventListener('click', () => select(item.id));
      tile.addEventListener('dblclick', () => { select(item.id); void activate(); });
      tile.addEventListener('keydown', event => {
        if (event.isComposing) return;
        if (event.key === 'Enter') { event.preventDefault(); select(item.id); void activate(); return; }
        const tiles = [...list.querySelectorAll('.file-tile')];
        const columns = getComputedStyle(list).gridTemplateColumns.split(' ').length;
        const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
        if (!Object.hasOwn(steps, event.key) && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? tiles.length - 1 : Math.max(0, Math.min(tiles.length - 1, tiles.indexOf(tile) + steps[event.key]));
        tiles[index].focus(); select(tiles[index].dataset.id);
      });
    }
    select(items.some(item => item.id === selected) ? selected : null);
    if (focused) [...list.querySelectorAll('.file-tile')].find(tile => tile.dataset.id === focused)?.focus({ preventScroll: true });
  }
  function clear() {
    version++; action++; busy = false; items = []; selected = null;
    list.replaceChildren(); selection.hidden = true;
    document.querySelector('#shelf-count').textContent = '0';
    document.querySelector('#empty-shelf').hidden = false;
  }
  return { refresh, clear };
}
