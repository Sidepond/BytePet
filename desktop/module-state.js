let state = { modules: { m01: false, m02: false }, revision: -1, warning: null };
const listeners = new Set();
export const moduleEnabled = key => state.modules[key];
export const moduleState = () => state;
function apply(next) {
  if (next.revision <= state.revision) return;
  const previous = state;
  state = next;
  for (const listener of listeners) listener(state, previous);
}
window.modules.onChanged(apply);
export const modulesReady = window.modules.get().then(response => {
  if (response.ok) apply(response.value);
  else state.warning = response.error;
}).catch(() => { state.warning = '설정을 불러오지 못했어요. 패널을 다시 열어 주세요.'; });
export function onModulesChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); }
