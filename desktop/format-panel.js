import { detectFormat } from './format.js';

export function setupFormatPanel(draft, tools, clearResults) {
  const mode = document.querySelector('#input-format');
  const run = document.querySelector('#run-tool');
  const hint = document.querySelector('#format-hint');
  let composing = false;

  function update() {
    if (composing) {
      run.disabled = true;
      hint.textContent = '입력을 마치면 형식을 확인해요.';
      return null;
    }
    const detection = mode.value === 'auto' ? detectFormat(draft.value) : { format: mode.value };
    const selected = detection.format;
    run.disabled = !selected;
    run.textContent = selected === 'jwt' ? 'JWT 해독' : selected === 'json' ? 'JSON 정리' : '도구 실행';
    hint.dataset.format = selected ?? '';
    if (mode.value !== 'auto') hint.textContent = `직접 선택 · ${selected.toUpperCase()}`;
    else if (selected) hint.textContent = `자동 선택 · ${selected.toUpperCase()} (실행 시 내용을 확인해요)`;
    else if (detection.reason === 'empty') hint.textContent = '텍스트를 입력하면 JWT/JSON을 자동으로 선택해요.';
    else if (detection.reason === 'limit') hint.textContent = '자동 선택은 1MB까지 지원해요. 입력을 줄여 주세요.';
    else hint.textContent = '형식을 찾지 못했어요. JWT 또는 JSON을 직접 선택해 주세요.';
    return selected;
  }
  mode.addEventListener('change', () => { clearResults(); update(); });
  draft.addEventListener('input', update);
  draft.addEventListener('compositionstart', () => { composing = true; update(); });
  draft.addEventListener('compositionend', () => { composing = false; update(); });
  run.addEventListener('click', () => {
    // Re-read the current input at execution time; never route a stale detection.
    const selected = update();
    if (selected && !composing) {
      const success = tools[selected].run();
      window.resultTools.react(success ? 'success' : 'failure');
    }
  });
  update();
  return update;
}
