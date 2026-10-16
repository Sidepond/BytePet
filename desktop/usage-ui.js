export function windowLabel(window, id = window?.id) {
  const minutes = window?.durationMinutes;
  if (minutes === 10080) return '주간';
  if (minutes && minutes % 1440 === 0) return `${minutes / 1440}일`;
  if (minutes && minutes % 60 === 0) return `${minutes / 60}시간`;
  return minutes ? `${minutes}분` : id === 'secondary' ? '주간' : '단기';
}
export function usageDisplay(provider, id, now = Date.now()) {
  const window = provider?.windows?.find(window => window.id === id);
  const expired = !!window && window.resetsAt <= now;
  const stale = !!window && (!provider.updatedAt || now - provider.updatedAt > 15 * 60 * 1000 || provider.status === 'error' || provider.status === 'unavailable');
  const known = !!window && !expired;
  return { window, label: windowLabel(window, id), known, stale, expired,
    percent: known ? `${Math.round(window.usedPercent)}%` : '—',
    note: expired ? '초기화 후 확인 필요' : stale ? '이전 확인 값' : !window ? '확인 필요' : '',
    level: stale || !known ? 'muted' : window.usedPercent >= 95 ? 'high' : window.usedPercent >= 80 ? 'warning' : 'normal' };
}
export function resetLabel(window, now = Date.now()) {
  if (!window) return '초기화 시간 확인 필요';
  if (window.resetsAt <= now) return '초기화 후 확인 필요';
  const minutes = Math.ceil((window.resetsAt - now) / 60000);
  const text = minutes >= 1440 ? `${Math.floor(minutes / 1440)}일 ${Math.floor(minutes % 1440 / 60)}시간` : minutes >= 60 ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분` : `${minutes}분`;
  return `${text} 후 초기화`;
}
export function updatedLabel(provider, name, now = Date.now()) {
  if (!provider?.updatedAt) return '아직 받은 정보가 없어요';
  const minutes = Math.max(0, Math.floor((now - provider.updatedAt) / 60000));
  const ago = minutes === 0 ? '방금' : minutes < 60 ? `${minutes}분 전` : minutes < 1440 ? `${Math.floor(minutes / 60)}시간 전` : `${Math.floor(minutes / 1440)}일 전`;
  return `${ago} ${name === 'claude' ? '수신' : '조회'}`;
}
let current = { revision: -1, preferences: {}, providers: {} };
const listeners = new Set();
function apply(state) {
  if (!state || state.revision < current.revision) return;
  current = state; for (const listener of listeners) listener(state);
}
export function watchUsage(listener) {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}
export const usageState = () => current;
export async function refreshUsage() {
  const result = await window.aiUsage.refresh();
  if (!result.ok) throw new Error(result.error);
  apply(result.value);
}
// The pure display helpers are also imported by Node tests.
if (typeof window !== 'undefined' && window.aiUsage) {
  window.aiUsage.onChanged(apply);
  window.aiUsage.get().then(result => { if (result.ok) apply(result.value); }).catch(() => {});
}
