export function setupPortsPanel() {
  const list = document.querySelector('#port-list');
  const status = document.querySelector('#port-status');
  const empty = document.querySelector('#empty-ports');
  const refreshed = document.querySelector('#ports-updated');
  const warning = document.querySelector('#ports-warning');
  const button = document.querySelector('#refresh-ports');
  const actionStatus = document.querySelector('#port-action-status');
  let busy = false;
  let hasSnapshot = false;
  let opening = false;
  let terminating = false;
  let enabled = true;
  let generation = 0;
  function setEnabled(value) {
    if (enabled === value) return;
    enabled = value;
    generation++;
    busy = opening = terminating = false;
    hasSnapshot = false;
    list.replaceChildren();
    status.textContent = refreshed.textContent = warning.textContent = actionStatus.textContent = '';
    empty.hidden = warning.hidden = true;
    list.setAttribute('aria-busy', 'false');
    updateControls();
  }

  function updateControls() {
    button.disabled = !enabled || busy || terminating;
    for (const control of list.querySelectorAll('.open-port, .terminate-port')) {
      control.disabled = opening || terminating || busy || control.dataset.unavailable === 'true';
    }
  }

  async function terminatePort(item) {
    if (!enabled || terminating || opening || busy) return;
    const current = generation;
    terminating = true;
    updateControls();
    actionStatus.classList.remove('error');
    actionStatus.textContent = `PID ${item.pid} 종료 대상을 확인하고 있어요…`;
    let refreshNeeded = true;
    try {
      const response = await window.ports.terminate(item.pid, item.port);
      if (current !== generation) return;
      if (!response.ok) throw new Error(response.error);
      actionStatus.textContent = response.value.message;
      refreshNeeded = response.value.status !== 'cancelled';
    } catch (error) {
      if (current !== generation) return;
      actionStatus.classList.add('error');
      actionStatus.textContent = error.message || '종료하지 못했어요. 새로고침 후 다시 확인해 주세요.';
    } finally {
      if (current !== generation) return;
      terminating = false;
      if (refreshNeeded) await refresh();
      updateControls();
    }
  }

  async function openPort(item, feedback) {
    if (!enabled || opening || terminating || busy) return;
    const current = generation;
    opening = true;
    updateControls();
    feedback.classList.remove('error');
    feedback.textContent = '기본 브라우저를 여는 중이에요…';
    try {
      const response = await window.ports.open(item.pid, item.port);
      if (current !== generation) return;
      if (!response.ok) throw new Error(response.error);
      feedback.textContent = '기본 브라우저에 열기를 요청했어요.';
    } catch (error) {
      if (current !== generation) return;
      feedback.classList.add('error');
      feedback.textContent = error.message || '브라우저를 열지 못했어요. 다시 시도해 주세요.';
    } finally {
      if (current !== generation) return;
      opening = false;
      updateControls();
    }
  }

  async function refresh() {
    if (!enabled || busy || terminating) return;
    const current = generation;
    busy = true;
    updateControls();
    list.setAttribute('aria-busy', 'true');
    status.classList.remove('error');
    status.textContent = '리스닝 포트를 조회하고 있어요…';
    try {
      const response = await window.ports.list();
      if (current !== generation) return;
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
        const details = document.createElement('details');
        details.className = 'port-details';
        const summary = document.createElement('summary');
        summary.textContent = '수신 주소';
        details.append(summary, addresses);
        row.append(heading, meta, details);
        const url = document.createElement('p');
        url.className = 'port-url';
        url.textContent = item.url || '브라우저로 열 수 있는 주소가 없어요.';
        const actions = document.createElement('div');
        actions.className = 'item-actions';
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'open-port';
        open.textContent = '열기';
        open.setAttribute('aria-label', `${item.port} 포트 브라우저로 열기`);
        open.title = item.url ? `${item.url} · HTTP로 열기` : '열 수 있는 주소 없음';
        open.dataset.unavailable = String(!item.url);
        open.disabled = opening || !item.url;
        const feedback = document.createElement('p');
        feedback.className = 'port-open-status';
        feedback.setAttribute('role', 'status');
        feedback.setAttribute('aria-live', 'polite');
        open.addEventListener('click', () => openPort(item, feedback));
        actions.append(open);
        const terminate = document.createElement('button');
        terminate.type = 'button';
        terminate.className = 'terminate-port';
        terminate.textContent = '종료';
        terminate.setAttribute('aria-label', `PID ${item.pid} 프로세스 종료`);
        terminate.title = item.terminationBlocked || '프로세스의 모든 작업과 포트를 종료해요';
        terminate.dataset.unavailable = String(Boolean(item.terminationBlocked));
        terminate.addEventListener('click', () => terminatePort(item));
        actions.append(terminate);
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
      if (current !== generation) return;
      empty.hidden = true;
      status.classList.add('error');
      status.textContent = `${error.message || '포트를 조회하지 못했어요.'}${hasSnapshot ? ' 이전 조회 결과를 표시하고 있어요.' : ''}`;
    } finally {
      if (current !== generation) return;
      busy = false;
      updateControls();
      list.setAttribute('aria-busy', 'false');
    }
  }
  button.addEventListener('click', refresh);
  return { refresh, setEnabled };
}
