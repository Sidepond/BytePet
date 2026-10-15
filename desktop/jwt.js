// Local inspection only: this module does not authenticate or verify tokens.
export const JWT_LIMIT = 1024 * 1024;

function decodeSegment(segment, label) {
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment) || segment.length % 4 === 1) {
    throw new Error(`${label}의 Base64URL 형식이 올바르지 않아요.`);
  }
  const binary = atob(segment.replace(/-/g, '+').replace(/_/g, '/'));
  // Reject nonzero padding bits instead of silently accepting a different encoding.
  if (btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') !== segment) {
    throw new Error(`${label}의 Base64URL 형식이 올바르지 않아요.`);
  }
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function decodeObject(segment, label) {
  const bytes = decodeSegment(segment, label);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error(`${label}가 올바른 UTF-8 텍스트가 아니에요.`); }
  let value;
  try { value = JSON.parse(text); }
  catch { throw new Error(`${label}가 올바른 JSON이 아니에요.`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}는 JSON 객체여야 해요.`);
  }
  return value;
}

export function decodeJwt(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('해독할 JWT를 입력해 주세요.');
  if (input.length > JWT_LIMIT || new TextEncoder().encode(input).length > JWT_LIMIT) {
    throw new Error('JWT 입력은 1MB까지 해독할 수 있어요.');
  }
  const token = input.trim().replace(/^Bearer[ \t]+/i, '').trim();
  const parts = token.split('.');
  if (parts.length === 5) throw new Error('암호화된 JWT(JWE)는 아직 지원하지 않아요.');
  if (parts.length !== 3) throw new Error('JWT는 점(.)으로 구분된 Header.Payload.Signature 형식이어야 해요.');
  const header = decodeObject(parts[0], 'Header');
  const payload = decodeObject(parts[1], 'Payload');
  if (typeof header.alg !== 'string' || !header.alg.trim()) throw new Error('Header에 문자열 alg(알고리즘)가 필요해요.');
  if (header.b64 === false) throw new Error('Base64URL로 인코딩하지 않은 Payload는 지원하지 않아요.');
  if (header.alg === 'none') {
    if (parts[2]) throw new Error('alg가 none인 JWT의 Signature는 비어 있어야 해요.');
  } else {
    decodeSegment(parts[2], 'Signature');
  }
  return { header, payload, unsigned: header.alg === 'none' };
}

export function expirationStatus(payload, now = Date.now()) {
  if (!Object.hasOwn(payload, 'exp')) return { state: 'missing', message: '만료 정보 없음 · exp가 없어요.' };
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    return { state: 'invalid', message: '만료 정보 오류 · exp는 Unix 초 단위 숫자여야 해요.' };
  }
  const millis = payload.exp * 1000;
  const date = new Date(millis);
  if (!Number.isFinite(date.getTime())) {
    return { state: 'invalid', message: '만료 정보 오류 · exp가 표시 가능한 날짜 범위를 벗어났어요.' };
  }
  const expired = now >= millis;
  return {
    state: expired ? 'expired' : 'unexpired',
    message: `${expired ? '만료됨' : '아직 만료되지 않음'} · ${date.toISOString()} (UTC)`,
  };
}
