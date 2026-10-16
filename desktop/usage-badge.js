import { watchUsage, usageState, usageDisplay } from './usage-ui.js';
function render(state) {
  const rows = document.querySelector('#badge-rows');
  rows.replaceChildren();
  const period = state.preferences.badgeWindow || 'primary';
  for (const [key, name] of [['codex', 'Codex'], ['claude', 'Claude']]) {
    if (!state.preferences[key]) continue;
    const display = usageDisplay(state.providers[key], period);
    const row = document.createElement('span'); row.className = 'badge-row'; row.dataset.level = display.level;
    const label = document.createElement('span'); label.className = 'badge-name'; label.textContent = name;
    const percent = document.createElement('span'); percent.className = 'badge-percent'; percent.textContent = `${display.percent}${display.stale && display.known ? '*' : ''}`;
    const bar = document.createElement('progress'); bar.max = 100; bar.value = display.known ? display.window.usedPercent : 0;
    bar.setAttribute('aria-label', `${name} ${display.label} ${display.known ? `${display.percent} 사용` : '확인 필요'}`);
    bar.dataset.known = String(display.known);
    row.title = `${name} · ${display.label} · ${display.percent}${display.note ? ` · ${display.note}` : ' 사용'}`;
    row.append(label, bar, percent); rows.append(row);
  }
}
watchUsage(render);
const timer = setInterval(() => render(usageState()), 10000);
window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
document.querySelector('#usage-badge').addEventListener('click', () => window.aiUsage.open());
