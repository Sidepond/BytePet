import { decodeJwt, expirationStatus } from './jwt.js';
import { setupResultCopy } from './result-copy.js';

export function setupJwtPanel(draft, beforeDecode = () => {}) {
  const result = document.querySelector('#jwt-result');
  const error = document.querySelector('#jwt-error');
  const output = document.querySelector('#jwt-output');
  const header = document.querySelector('#jwt-header');
  const payload = document.querySelector('#jwt-payload');
  const signature = document.querySelector('#jwt-signature');
  const expiration = document.querySelector('#jwt-expiration');
  let decoded = null;
  const setCopyAvailable = setupResultCopy('#jwt-copy-status', [
    ['#copy-jwt-header', () => header.textContent],
    ['#copy-jwt-payload', () => payload.textContent],
    ['#copy-jwt-all', () => JSON.stringify({ header: decoded.header, payload: decoded.payload }, null, 2)],
  ]);

  function updateExpiration() {
    if (!decoded) return;
    const status = expirationStatus(decoded.payload);
    if (expiration.textContent !== status.message) expiration.textContent = status.message;
    expiration.dataset.state = status.state;
  }
  function clear() {
    setCopyAvailable(false);
    decoded = null;
    result.hidden = true;
    header.textContent = payload.textContent = signature.textContent = expiration.textContent = error.textContent = '';
  }
  function run() {
    beforeDecode();
    clear();
    result.hidden = false;
    try {
      decoded = decodeJwt(draft.value);
      header.textContent = JSON.stringify(decoded.header, null, 2);
      payload.textContent = JSON.stringify(decoded.payload, null, 2);
      signature.textContent = decoded.unsigned
        ? '서명 없음 (alg: none) · 토큰의 진위를 확인하지 않았어요.'
        : '서명 미검증 · 토큰의 진위를 확인하지 않았어요.';
      updateExpiration();
      output.hidden = false;
      error.hidden = true;
      setCopyAvailable(true);
    } catch (cause) {
      decoded = null;
      output.hidden = true;
      error.hidden = false;
      error.textContent = cause.message;
    }
    result.focus({ preventScroll: true });
    result.scrollIntoView({ block: 'nearest' });
    return decoded !== null;
  }
  draft.addEventListener('input', clear);
  document.querySelector('#close-jwt').addEventListener('click', () => { clear(); draft.focus(); });
  // Refresh against the system clock even while an unchanged result stays open.
  const timer = setInterval(updateExpiration, 1000);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  return { clear, run };
}
