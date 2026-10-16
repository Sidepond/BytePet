const { createUsageStore, validChange } = require('./usage-data.cjs');
const { readCodexUsage } = require('./usage-codex.cjs');
const { createClaudeConnection } = require('./usage-claude.cjs');
const empty = (status, message = '') => ({ status, message, windows: [], updatedAt: null });
function createUsageService({ directory, store = createUsageStore(directory), readCodex = readCodexUsage,
  claude = createClaudeConnection({ directory }), now = Date.now, autoStart = true } = {}) {
  let { preferences, warning } = store.read();
  let revision = 0, disposed = false, active = null, epoch = 0, lastAttempt = -Infinity;
  const listeners = new Set();
  let providers = { codex: empty(preferences.codex ? 'waiting' : 'disabled', '사용량을 확인하고 있어요.'), claude: empty('waiting') };
  let claudeConnected = false;
  const state = () => structuredClone({ preferences, warning, providers, claudeConnected, revision });
  function publish() { if (!disposed) { revision++; for (const listener of listeners) listener(state()); } }
  function refreshClaude() {
    if (disposed) return;
    const next = preferences.claude ? claude.read() : empty('disabled', '표시가 꺼져 있어요.');
    const connected = claude.connected();
    if (JSON.stringify(next) !== JSON.stringify(providers.claude) || connected !== claudeConnected) {
      providers.claude = next; claudeConnected = connected; publish();
    }
  }
  async function refreshCodex() {
    if (disposed || !preferences.codex) return;
    if (active) return active.promise;
    if (now() - lastAttempt < 30000) return;
    lastAttempt = now();
    const current = epoch;
    const controller = new AbortController();
    const task = { controller, promise: null };
    active = task;
    providers.codex = { ...providers.codex, status: 'loading', message: '확인 중…' }; publish();
    task.promise = (async () => {
      try {
        const result = await readCodex({ signal: controller.signal });
        if (disposed || current !== epoch) return;
        providers.codex = { status: 'ready', message: '', windows: result.windows, updatedAt: result.updatedAt };
      } catch (error) {
        if (disposed || current !== epoch) return;
        providers.codex = error.code === 'unavailable' ? empty('unavailable', error.message)
          : { ...providers.codex, status: 'error', message: error.message || '사용량을 확인하지 못했어요.' };
      } finally {
        if (active === task) active = null;
        if (!disposed && current === epoch) publish();
      }
    })();
    return task.promise;
  }
  async function refresh() { refreshClaude(); await refreshCodex(); return state(); }
  function set(key, value) {
    if (!validChange(key, value)) throw new Error('올바른 사용량 설정을 선택해 주세요.');
    const next = { ...preferences, [key]: value };
    try { store.write(next); } catch { throw new Error('사용량 설정을 저장하지 못했어요.'); }
    const changed = preferences[key] !== value;
    preferences = next; warning = null;
    if (changed && key === 'codex') {
      epoch++; active?.controller.abort(); active = null; lastAttempt = -Infinity;
      providers.codex = empty(value ? 'waiting' : 'disabled', value ? '사용량을 확인하고 있어요.' : '표시가 꺼져 있어요.');
      if (value) void refreshCodex();
    }
    refreshClaude(); publish(); return state();
  }
  function connectClaude(enabled) {
    if (enabled) claude.install(); else claude.disconnect();
    refreshClaude(); publish(); return state();
  }
  let poll, start;
  if (autoStart) {
    start = setTimeout(() => void refresh(), 0);
    poll = setInterval(() => { refreshClaude(); if (now() - lastAttempt >= 300000) void refreshCodex(); }, 5000);
  }
  return { state, refresh, set, connectClaude, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { disposed = true; epoch++; clearTimeout(start); clearInterval(poll); active?.controller.abort(); listeners.clear(); } };
}
module.exports = { createUsageService };
