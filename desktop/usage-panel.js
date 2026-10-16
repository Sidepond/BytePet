import { watchUsage, usageState, usageDisplay, resetLabel, updatedLabel, refreshUsage } from './usage-ui.js';
export function setupUsagePanel() {
  const list = document.querySelector('#usage-providers');
  const status = document.querySelector('#usage-status');
  const settingsStatus = document.querySelector('#usage-settings-status');
  const refreshButton = document.querySelector('#refresh-usage');
  const connect = document.querySelector('#connect-claude');
  const fields = { badgeMode: '#usage-mode', badgePosition: '#usage-position', badgeWindow: '#usage-window', codex: '#usage-codex', claude: '#usage-claude' };
  let busy = false, refreshing = false;
  function render(state) {
    list.replaceChildren();
    for (const [key, name] of [['codex', 'Codex'], ['claude', 'Claude Code']]) {
      const provider = state.providers[key];
      const article = document.createElement('article'); article.className = 'usage-provider'; article.dataset.provider = key;
      const heading = document.createElement('div'); heading.className = 'usage-heading';
      const title = document.createElement('h3'); title.textContent = name;
      const updated = document.createElement('span'); updated.textContent = state.preferences[key] ? updatedLabel(provider, key) : '표시 꺼짐';
      if (provider?.updatedAt) updated.title = new Date(provider.updatedAt).toLocaleString('ko-KR');
      heading.append(title, updated); article.append(heading);
      if (state.preferences[key]) for (const id of ['primary', 'secondary']) {
        const display = usageDisplay(provider, id);
        const row = document.createElement('div'); row.className = 'usage-limit'; row.dataset.window = id; row.dataset.level = display.level;
        const label = document.createElement('span'); label.textContent = display.label;
        const value = document.createElement('strong'); value.textContent = display.percent;
        const progress = document.createElement('progress'); progress.max = 100; progress.value = display.known ? display.window.usedPercent : 0;
        progress.hidden = !display.known;
        progress.setAttribute('aria-label', `${name} ${display.label} 사용률`);
        const reset = document.createElement('small'); reset.textContent = `${display.stale && display.known ? '이전 확인 값 · ' : ''}${resetLabel(display.window)}`;
        row.append(label, value, progress, reset); article.append(row);
      }
      if (provider?.message) { const note = document.createElement('p'); note.className = 'usage-note'; note.textContent = provider.message; article.append(note); }
      list.append(article);
    }
    for (const [key, selector] of Object.entries(fields)) {
      const control = document.querySelector(selector);
      if (control.type === 'checkbox') control.checked = !!state.preferences[key];
      else control.value = state.preferences[key] || '';
      control.disabled = busy;
    }
    connect.textContent = state.claudeConnected ? 'Claude 연결 해제' : 'Claude 연결';
    connect.disabled = busy;
    if (state.warning) settingsStatus.textContent = state.warning;
    refreshButton.disabled = refreshing || state.providers.codex?.status === 'loading';
  }
  async function refresh() {
    if (refreshing) return;
    refreshing = true; render(usageState()); status.textContent = '';
    try { await refreshUsage(); }
    catch (error) { status.textContent = error.message; }
    finally { refreshing = false; render(usageState()); }
  }
  refreshButton.addEventListener('click', refresh);
  for (const [key, selector] of Object.entries(fields)) document.querySelector(selector).addEventListener('change', async event => {
    if (busy) return;
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    busy = true; render(usageState()); settingsStatus.textContent = '저장 중…';
    try {
      const result = await window.aiUsage.set(key, value);
      if (!result.ok) throw new Error(result.error);
      settingsStatus.textContent = '저장했어요.';
    } catch (error) { settingsStatus.textContent = error.message; }
    finally { busy = false; render(usageState()); }
  });
  connect.addEventListener('click', async () => {
    if (busy) return;
    const enabled = !usageState().claudeConnected;
    busy = true; render(usageState()); status.textContent = '';
    try {
      const result = await window.aiUsage.connectClaude(enabled);
      if (!result.ok) throw new Error(result.error);
      status.textContent = enabled ? '연결했어요. Claude Code의 다음 응답을 기다려 주세요.' : '기존 Claude 상태줄을 복원했어요.';
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; render(usageState()); }
  });
  watchUsage(render);
  const timer = setInterval(() => render(usageState()), 10000);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  return { refresh };
}
