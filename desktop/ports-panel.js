export function setupPortsPanel() {
  const list = document.querySelector('#port-list');
  const status = document.querySelector('#port-status');
  const empty = document.querySelector('#empty-ports');
  const refreshed = document.querySelector('#ports-updated');
  const warning = document.querySelector('#ports-warning');
  const button = document.querySelector('#refresh-ports');
  let busy = false;
  let hasSnapshot = false;
  let opening = false;

  async function openPort(item, feedback) {
    if (opening) return;
    opening = true;
    for (const control of list.querySelectorAll('.open-port')) control.disabled = true;
    feedback.classList.remove('error');
    feedback.textContent = '기본 브라우저를 여는 중이에요…';
    try {
      const response = await window.ports.open(item.pid, item.port);
      if (!response.ok) throw new Error(response.error);
      feedback.textContent = '기본 브라우저에 열기를 요청했어요.';
    } catch (error) {
      feedback.classList.add('error');
      feedback.textContent = error.message || '브라우저를 열지 못했어요. 다시 시도해 주세요.';
    } finally {
      opening = false;
      for (const control of list.querySelectorAll('.open-port')) control.disabled = control.dataset.unavailable === 'true';
    }
  }

  async function refresh() {
    if (busy) return;
    busy = true;
    button.disabled = true;
    list.setAttribute('aria-busy', 'true');
    status.classList.remove('error');
    status.textContent = '리스닝 포트를 조회하고 있어요…';
    try {
      const response = await window.ports.list();
      if (!response.ok) throw new Error(response.error);
      const { items, checkedAt } = response.value;
      list.replaceChildren();
      for (const item of items) {
        const row = document.createElement('li');
        row.dataset.port = String(item.port);
        row.dataset.pid = String(item.pid);
        const heading = document.createElement('div');
        heading.className = 'port-heading';
        const port = document.createElement('strong');
        port.textContent = `:${item.port}`;
        const name = document.createElement('span');
        name.className = 'port-name';
        name.textContent = item.name;
        heading.append(port, name);
        const meta = document.createElement('p');
        meta.className = 'port-meta';
        meta.textContent = `TCP · PID ${item.pid}`;
        const addresses = document.createElement('p');
        addresses.className = 'port-addresses';
        addresses.textContent = item.addresses.map(({ family, address }) => `${family} ${address}`).join(' · ');
        row.append(heading, meta, addresses);
        const url = document.createElement('p');
        url.className = 'port-url';
        url.textContent = item.url || '브라우저로 열 수 있는 주소가 없어요.';
        const actions = document.createElement('div');
        actions.className = 'item-actions';
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'open-port';
        open.textContent = '브라우저로 열기';
        open.setAttribute('aria-label', `${item.port} 포트 브라우저로 열기`);
        open.title = item.url || '열 수 있는 주소 없음';
        open.dataset.unavailable = String(!item.url);
        open.disabled = opening || !item.url;
        const feedback = document.createElement('p');
        feedback.className = 'port-open-status';
        feedback.setAttribute('role', 'status');
        feedback.setAttribute('aria-live', 'polite');
        open.addEventListener('click', () => openPort(item, feedback));
        actions.append(open);
        row.append(url, actions, feedback);
        list.append(row);
      }
      hasSnapshot = true;
      empty.hidden = items.length > 0;
      status.textContent = `${items.length}개 포트 항목 · ${new Set(items.map(item => item.pid)).size}개 프로세스`;
      refreshed.textContent = `마지막 조회 ${new Date(checkedAt).toLocaleTimeString('ko-KR')}`;
      warning.textContent = response.value.warning || '';
      warning.hidden = !response.value.warning;
    } catch (error) {
      empty.hidden = true;
      status.classList.add('error');
      status.textContent = `${error.message || '포트를 조회하지 못했어요.'}${hasSnapshot ? ' 이전 조회 결과를 표시하고 있어요.' : ''}`;
    } finally {
      busy = false;
      button.disabled = false;
      list.setAttribute('aria-busy', 'false');
    }
  }
  button.addEventListener('click', refresh);
  return { refresh };
}
