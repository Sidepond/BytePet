const ns = 'http://www.w3.org/2000/svg';
function fileStyle(item) {
  if (item.kind === 'text') return { icon: 'file', label: '메모', color: 'note' };
  const extension = item.filename.split('.').pop().toLowerCase();
  const label = /^[a-z0-9]{1,6}$/.test(extension) ? extension.toUpperCase() : 'FILE';
  if (/^(png|jpe?g|gif|webp|heic|heif|avif|bmp|tiff?|svg)$/.test(extension)) return { icon: 'image', label, color: 'image' };
  if (/^(json|js|ts|jsx|tsx|py|html|css|sql|yaml|yml|xml)$/.test(extension)) return { icon: 'code', label, color: 'code' };
  if (/^(zip|gz|tar|7z|rar)$/.test(extension)) return { icon: 'archive', label, color: 'archive' };
  return { icon: 'file', label, color: 'document' };
}
function sizeLabel(size) {
  return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function setupFoodShelf({ enabled, onText, isFoodView }) {
  const $ = id => document.querySelector(`#${id}`);
  const list = $('food-list'), selection = $('shelf-selection'), search = $('shelf-search');
  const open = $('shelf-open'), convert = $('shelf-convert'), restore = $('shelf-restore');
  const preview = $('food-preview'), rename = $('food-rename'), status = $('shelf-status');
  let items = [], selected = null, version = 0, action = 0, busy = false, filter = 'all', timer;
  let previewVersion = 0, renameId = null, renameBusy = false, renameVersion = 0;
  let queue = [], activeImages = 0;
  const selectedItem = () => items.find(item => item.id === selected);
  const inTrash = () => filter === 'trash';
  function feedback(text, error = false) { status.textContent = text; status.classList.toggle('error', error); }
  function closePreview() { previewVersion++; if (preview.open) preview.close(); $('preview-content').replaceChildren(); }
  function closeRename() { renameVersion++; if (rename.open) rename.close(); renameId = null; renameBusy = false; }
  function select(id) {
    if (selected !== id) { action++; busy = false; }
    selected = id;
    const item = selectedItem();
    for (const tile of list.querySelectorAll('.file-tile')) tile.setAttribute('aria-pressed', String(tile.dataset.id === id));
    selection.hidden = !item;
    if (!item) return;
    $('selected-food-name').textContent = item.name;
    open.textContent = item.kind === 'text' ? '불러오기' : '열기';
    open.setAttribute('aria-label', item.kind === 'text' ? '텍스트 불러오기' : '파일 열기');
    open.hidden = inTrash();
    convert.hidden = inTrash() || item.kind !== 'text';
    restore.hidden = !inTrash();
    for (const control of selection.querySelectorAll('button')) control.disabled = busy;
  }
  async function showPreview() {
    const item = selectedItem();
    if (!item || !enabled()) return;
    const current = ++previewVersion;
    $('preview-title').textContent = item.name;
    $('preview-meta').textContent = `${sizeLabel(item.size)} · ${new Date(item.createdAt).toLocaleString('ko-KR')}`;
    const content = $('preview-content');
    content.textContent = '미리보기를 준비하고 있어요…';
    if (!preview.open) preview.showModal();
    try {
      const response = await window.food.preview(item.id, inTrash());
      if (current !== previewVersion || !preview.open || !enabled()) return;
      if (!response.ok) throw new Error(response.error);
      content.replaceChildren();
      const value = response.value;
      if (value.kind === 'text') {
        const text = document.createElement('pre'); text.textContent = value.text; content.append(text);
      } else if (value.kind === 'image') {
        const image = document.createElement('img'); image.src = value.image; image.alt = item.name; content.append(image);
      } else content.textContent = inTrash() ? '이 형식은 미리보기를 지원하지 않아요. 복원한 뒤 기본 앱으로 열 수 있어요.' : '이 형식은 미리보기를 지원하지 않아요. 보관함에서 열기를 눌러 기본 앱으로 확인하세요.';
    } catch (error) { if (current === previewVersion && preview.open) content.textContent = error.message || '미리보기를 불러오지 못했어요.'; }
  }
  function showRename() {
    const item = selectedItem();
    if (!item || inTrash()) return;
    renameId = item.id; renameBusy = false; renameVersion++;
    $('food-name').value = item.name;
    $('rename-status').textContent = '';
    $('save-food-name').disabled = $('food-name').disabled = $('cancel-food-rename').disabled = false;
    rename.showModal(); $('food-name').select();
  }
  async function activate(destination = 'food') {
    const item = selectedItem();
    if (!item || !enabled() || busy) return;
    if (destination === 'preview') return showPreview();
    if (destination === 'rename') return showRename();
    if (inTrash() && destination !== 'restore') return;
    const current = ++action;
    busy = true; select(item.id);
    try {
      const response = destination === 'trash' ? await window.food.trash(item.id)
        : destination === 'restore' ? await window.food.restore(item.id)
        : destination === 'reveal' ? await window.food.reveal(item.id)
        : item.kind === 'text' ? await window.food.readText(item.id) : await window.food.open(item.id);
      if (!enabled()) return;
      if (!response.ok) throw new Error(response.error);
      if (destination === 'trash' || destination === 'restore') {
        await refresh();
        if (isFoodView()) feedback(destination === 'trash' ? '휴지통으로 옮겼어요. 휴지통에서 복원할 수 있어요.' : '보관함으로 복원했어요.');
      } else if (current === action && item.kind === 'text' && destination !== 'reveal' && isFoodView()) onText(response.value, destination);
    } catch (error) {
      if (current === action && enabled()) feedback(error.message || '항목을 열지 못했어요.', true);
    } finally {
      if (current === action) { busy = false; select(selected); }
    }
  }
  async function showMenu() {
    const item = selectedItem();
    if (!item || !enabled() || busy) return;
    const current = action;
    try {
      const response = await window.food.menu(item.id, inTrash());
      if (current !== action || !enabled() || !isFoodView()) return;
      if (!response.ok) throw new Error(response.error);
      if (response.value) await activate(response.value);
    } catch (error) { if (current === action && enabled()) feedback(error.message || '추가 작업을 열지 못했어요.', true); }
  }
  open.addEventListener('click', () => void activate());
  convert.addEventListener('click', () => void activate('convert'));
  restore.addEventListener('click', () => void activate('restore'));
  $('shelf-preview').addEventListener('click', () => void showPreview());
  $('shelf-more').addEventListener('click', () => void showMenu());
  $('close-food-preview').addEventListener('click', closePreview);
  preview.addEventListener('cancel', () => { previewVersion++; });
  $('cancel-food-rename').addEventListener('click', closeRename);
  rename.addEventListener('cancel', event => { if (renameBusy) event.preventDefault(); else { renameVersion++; renameId = null; } });
  $('food-rename-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!renameId || renameBusy || !enabled()) return;
    const current = ++renameVersion;
    renameBusy = true;
    $('save-food-name').disabled = $('food-name').disabled = $('cancel-food-rename').disabled = true;
    try {
      const response = await window.food.rename(renameId, $('food-name').value);
      if (current !== renameVersion || !enabled()) return;
      if (!response.ok) throw new Error(response.error);
      closeRename(); await refresh(); feedback('보관함 이름을 변경했어요.');
    } catch (error) { if (current === renameVersion) $('rename-status').textContent = error.message || '이름을 변경하지 못했어요.'; }
    finally {
      if (current === renameVersion) {
        renameBusy = false;
        $('save-food-name').disabled = $('food-name').disabled = $('cancel-food-rename').disabled = false;
      }
    }
  });

  // Request only nearby images, with two decodes in flight. Stale tiles never receive an image.
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      observer.unobserve(entry.target);
      queue.push({ tile: entry.target, version, trash: inTrash() });
    }
    drain();
  }, { root: document.querySelector('.content'), rootMargin: '120px' });
  function drain() {
    while (queue.length && activeImages < 2) {
      const job = queue.shift();
      if (job.version !== version || !job.tile.isConnected || !enabled()) continue;
      activeImages++;
      window.food.thumbnail(job.tile.dataset.id, job.trash).then(response => {
        if (job.version !== version || !job.tile.isConnected || !enabled() || !response.ok || !response.value) return;
        const image = document.createElement('img'); image.className = 'file-thumbnail'; image.alt = ''; image.src = response.value;
        image.addEventListener('load', () => { if (job.tile.isConnected) job.tile.querySelector('.file-art')?.replaceChildren(image); }, { once: true });
      }).catch(() => {}).finally(() => { activeImages--; drain(); });
    }
  }
  function render() {
    observer.disconnect(); queue = [];
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset.id : null;
    const visible = items.filter(item => filter === 'all' || inTrash() ||
      (filter === 'note' ? item.kind === 'text' : filter === 'image' ? fileStyle(item).color === 'image' : item.kind === 'file' && fileStyle(item).color !== 'image'));
    list.replaceChildren();
    $('empty-shelf').hidden = visible.length > 0;
    const emptyTitle = $('empty-shelf').querySelector('span'), emptyHint = $('empty-shelf').querySelector('small');
    emptyTitle.textContent = search.value.trim() ? '검색 결과가 없어요' : inTrash() ? '휴지통이 비어 있어요' : filter !== 'all' ? '이 분류에는 아직 없어요' : '아직 비어 있어요';
    emptyHint.textContent = search.value.trim() ? '다른 이름이나 메모 내용으로 찾아보세요' : inTrash() ? '옮긴 자료는 이곳에서 복원할 수 있어요' : '먹이를 주면 여기에 차곡차곡 모여요';
    $('shelf-count').textContent = String(visible.length);
    for (const item of visible) {
      const row = document.createElement('li'); row.dataset.id = item.id;
      const tile = document.createElement('button'); tile.type = 'button'; tile.className = 'file-tile'; tile.dataset.id = item.id;
      tile.title = `${item.name}\n${sizeLabel(item.size)} · ${new Date(item.createdAt).toLocaleString('ko-KR')}\nSpace로 미리보기 · 우클릭으로 추가 작업`;
      const style = fileStyle(item); tile.dataset.kind = style.color;
      const art = document.createElement('span'); art.className = 'file-art'; art.setAttribute('aria-hidden', 'true');
      if (item.kind === 'text') {
        const paper = document.createElement('span'); paper.className = 'note-preview'; paper.textContent = typeof item.preview === 'string' ? item.preview.trim() : item.name; art.append(paper);
      } else {
        const icon = document.createElementNS(ns, 'svg'); icon.setAttribute('viewBox', '0 0 48 48');
        const use = document.createElementNS(ns, 'use'); use.setAttribute('href', `#icon-${style.icon}`); icon.append(use); art.append(icon);
      }
      const name = document.createElement('span'); name.className = 'item-name'; name.textContent = item.name;
      const meta = document.createElement('span'); meta.className = 'item-meta'; meta.textContent = `${style.label} · ${sizeLabel(item.size)}`;
      tile.append(art, name, meta); row.append(tile); list.append(row);
      if (style.color === 'image') observer.observe(tile);
      tile.addEventListener('click', () => select(item.id));
      tile.addEventListener('dblclick', () => { select(item.id); void activate(inTrash() ? 'preview' : 'food'); });
      tile.addEventListener('contextmenu', event => { event.preventDefault(); tile.focus(); select(item.id); void showMenu(); });
      tile.addEventListener('keydown', event => {
        if (event.isComposing) return;
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault(); select(item.id); void activate(event.key === ' ' || inTrash() ? 'preview' : 'food'); return;
        }
        if (event.key === 'F2' && !inTrash()) { event.preventDefault(); select(item.id); showRename(); return; }
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); select(item.id); void showMenu(); return; }
        const tiles = [...list.querySelectorAll('.file-tile')];
        const columns = getComputedStyle(list).gridTemplateColumns.split(' ').length;
        const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
        if (!Object.hasOwn(steps, event.key) && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? tiles.length - 1 : Math.max(0, Math.min(tiles.length - 1, tiles.indexOf(tile) + steps[event.key]));
        tiles[index].focus(); select(tiles[index].dataset.id);
      });
    }
    select(visible.some(item => item.id === selected) ? selected : null);
    if (focused) [...list.querySelectorAll('.file-tile')].find(tile => tile.dataset.id === focused)?.focus({ preventScroll: true });
  }
  async function refresh() {
    clearTimeout(timer);
    if (!enabled()) return;
    const current = ++version;
    list.setAttribute('aria-busy', 'true');
    try {
      const response = await window.food.list({ query: search.value, trash: inTrash() });
      if (current !== version || !enabled()) return;
      if (!response.ok) throw new Error(response.error);
      items = response.value; render(); feedback('');
    } catch (error) { if (current === version && enabled()) { items = []; render(); feedback(error.message || '보관함을 불러오지 못했어요. 다시 검색해 주세요.', true); } }
    finally { if (current === version) list.setAttribute('aria-busy', 'false'); }
  }
  function queryChanged() {
    clearTimeout(timer); version++; select(null);
    $('clear-shelf-search').hidden = !search.value;
    list.setAttribute('aria-busy', 'true');
    feedback('검색 중…');
    timer = setTimeout(refresh, 180);
  }
  search.addEventListener('input', queryChanged);
  $('clear-shelf-search').addEventListener('click', () => { search.value = ''; queryChanged(); search.focus(); });
  for (const button of $('shelf-filters').querySelectorAll('button')) button.addEventListener('click', () => {
    const previousTrash = inTrash(); filter = button.dataset.filter;
    for (const control of $('shelf-filters').querySelectorAll('button')) control.setAttribute('aria-pressed', String(control === button));
    select(null);
    if (previousTrash !== inTrash()) { items = []; render(); void refresh(); }
    else render();
  });
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f' && isFoodView() && enabled() && !document.querySelector('dialog[open]')) {
      event.preventDefault(); search.focus(); search.select();
    }
  });
  function leave() { action++; busy = false; closePreview(); closeRename(); }
  function clear() {
    clearTimeout(timer); version++; leave(); items = []; selected = null;
    observer.disconnect(); queue = [];
    render(); feedback(''); list.setAttribute('aria-busy', 'false');
  }
  return { refresh, clear, leave };
}
