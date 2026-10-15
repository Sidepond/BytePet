import { formatJson, JsonFormatError } from './json.js';

export function setupJsonPanel(draft, beforeFormat) {
  const result = document.querySelector('#json-result');
  const error = document.querySelector('#json-error');
  const output = document.querySelector('#json-output');
  const jump = document.querySelector('#json-error-location');
  let errorOffset = null;
  function clear() {
    result.hidden = true;
    error.textContent = output.textContent = '';
    jump.hidden = true;
    errorOffset = null;
  }
  document.querySelector('#format-json').addEventListener('click', () => {
    beforeFormat();
    clear();
    result.hidden = false;
    output.hidden = true;
    error.hidden = true;
    try {
      output.textContent = formatJson(draft.value);
      output.hidden = false;
    } catch (cause) {
      error.hidden = false;
      if (cause instanceof JsonFormatError) {
        errorOffset = cause.offset;
        error.textContent = errorOffset === null ? cause.message : `${cause.line}줄 ${cause.column}열 · ${cause.message}`;
        jump.hidden = errorOffset === null;
      } else error.textContent = 'JSON을 정리하지 못했어요. 입력을 확인해 주세요.';
    }
    result.focus({ preventScroll: true });
    result.scrollIntoView({ block: 'nearest' });
  });
  jump.addEventListener('click', () => {
    if (errorOffset === null) return;
    const width = draft.value.codePointAt(errorOffset) > 0xffff ? 2 : 1;
    draft.setSelectionRange(errorOffset, Math.min(errorOffset + width, draft.value.length));
    draft.focus();
  });
  draft.addEventListener('input', clear);
  document.querySelector('#close-json').addEventListener('click', () => { clear(); draft.focus(); });
  return clear;
}
