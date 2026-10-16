export function setupAppPreferences() {
  const login = document.querySelector('#open-at-login');
  const hint = document.querySelector('#login-hint');
  const status = document.querySelector('#app-preferences-status');
  const reset = document.querySelector('#reset-position');
  const copy = document.querySelector('#copy-app-info');
  let busy = false;
  let generation = 0;
  let state;
  function render() {
    login.checked = state?.login.enabled ?? false;
    login.disabled = busy || !state?.login.available;
    reset.disabled = copy.disabled = busy;
    hint.textContent = state?.login.message ?? '자동 실행 상태를 확인하고 있어요…';
    if (state) document.querySelector('#app-version').textContent = `BytePet ${state.info.version}`;
  }
  function feedback(message, error = false, target = status) {
    target.textContent = message;
    target.classList.toggle('error', error);
  }
  async function refresh() {
    if (busy) return;
    const current = ++generation;
    try {
      const response = await window.appPreferences.get();
      if (current !== generation) return;
      if (!response.ok) throw new Error(response.error);
      state = response.value;
      render();
    } catch (error) { if (current === generation) feedback(error.message || '앱 정보를 읽지 못했어요.', true); }
  }
  async function run(operation, message, target = status) {
    if (busy) return;
    busy = true; generation++;
    render(); feedback('', false, target);
    try {
      const response = await operation();
      if (!response.ok) throw new Error(response.error);
      if (response.value.info) state = response.value;
      feedback(response.value.message ?? message, Boolean(response.value.warning), target);
    } catch (error) { feedback(error.message || '요청을 처리하지 못했어요.', true, target); }
    finally {
      busy = false; render();
      if (!document.querySelector('#settings-view').hidden) target.scrollIntoView({ block: 'nearest' });
      await refresh();
    }
  }
  login.addEventListener('change', () => {
    const enabled = login.checked;
    void run(() => window.appPreferences.setLogin(enabled), enabled ? '자동 실행 설정을 변경했어요.' : '자동 실행을 껐어요.');
  });
  reset.addEventListener('click', () => void run(() => window.appPreferences.resetPosition(), '', document.querySelector('#position-status')));
  copy.addEventListener('click', () => void run(() => window.appPreferences.copyInfo()));
  window.addEventListener('focus', () => {
    if (!document.querySelector('#settings-view').hidden) void refresh();
  });
  render();
  return { refresh };
}
