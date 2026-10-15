let state = { preferences: { ground: true, menuSide: 'left', character: 'cat-cheese' }, revision: -1, warning: null };
const listeners = new Set();
function apply(next) {
  if (next.revision <= state.revision) return;
  state = next;
  for (const listener of listeners) listener(state);
}
window.appearance.onChanged(apply);
export const appearanceReady = window.appearance.get().then(response => {
  if (response.ok) apply(response.value);
  else state.warning = response.error;
}).catch(() => { state.warning = '화면 설정을 불러오지 못했어요.'; });
export const appearanceState = () => state;
export function onAppearanceChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); }
