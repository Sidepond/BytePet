import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeJwt, expirationStatus, JWT_LIMIT } from '../desktop/jwt.js';

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (payload = {}, header = { alg: 'HS256', typ: 'JWT' }, signature = 'AA') => `${encode(header)}.${encode(payload)}.${signature}`;

test('JWT: decodes Unicode objects and optional Bearer prefix without verifying a signature', () => {
  const payload = { sub: '사용자🐱', roles: ['admin'], nested: { value: '<script>test</script>' } };
  const decoded = decodeJwt(` \nBearer ${token(payload)}\n`);
  assert.deepEqual(decoded.payload, payload);
  assert.deepEqual(decoded.header, { alg: 'HS256', typ: 'JWT' });
  assert.equal(decoded.unsigned, false);
  assert.deepEqual(decodeJwt(`bearer\t${token(payload)}`), decoded);
  assert.deepEqual(decodeJwt(token(payload, { alg: 'custom' })).payload, payload);
});

test('JWT: rejects empty, oversize, wrong segment count, and encrypted input', () => {
  for (const value of ['', '  ', null, 12]) assert.throws(() => decodeJwt(value), /입력/);
  assert.throws(() => decodeJwt('a'.repeat(JWT_LIMIT + 1)), /1MB/);
  assert.throws(() => decodeJwt('가'.repeat(JWT_LIMIT / 2)), /1MB/);
  for (const value of ['abc', 'a.b', 'a.b.c.d']) assert.throws(() => decodeJwt(value), /Header.Payload.Signature/);
  assert.throws(() => decodeJwt('a.b.c.d.e'), /JWE/);
});

test('JWT: validates Base64URL, UTF-8, JSON objects, and algorithm metadata', () => {
  const header = encode({ alg: 'HS256' });
  const payload = encode({});
  for (const segment of ['', 'a', 'e30=', 'e3+', 'e3/', 'e3 ', 'e31']) {
    assert.throws(() => decodeJwt(`${header}.${segment}.AA`), /Payload.*Base64URL/);
  }
  assert.throws(() => decodeJwt(`${header}._w.AA`), /UTF-8/);
  assert.throws(() => decodeJwt(`${header}.${Buffer.from('{bad').toString('base64url')}.AA`), /JSON/);
  for (const value of [null, [], 'string', 123, false]) {
    assert.throws(() => decodeJwt(token(value)), /Payload.*객체/);
    assert.throws(() => decodeJwt(token({}, value)), /Header.*객체/);
  }
  for (const value of [{}, { alg: '' }, { alg: 12 }]) assert.throws(() => decodeJwt(token({}, value)), /alg/);
  assert.throws(() => decodeJwt(token({}, { alg: 'HS256', b64: false })), /지원하지/);
  for (const signature of ['', 'a', 'A=', 'AB']) {
    assert.throws(() => decodeJwt(`${header}.${payload}.${signature}`), /Signature/);
  }
});

test('JWT: accepts explicitly unsigned tokens and rejects conflicting signatures', () => {
  assert.equal(decodeJwt(token({ sub: '123' }, { alg: 'none' }, '')).unsigned, true);
  assert.throws(() => decodeJwt(token({}, { alg: 'none' }, 'AA')), /비어/);
});

test('JWT: expiration uses Unix seconds and expires exactly at the boundary', () => {
  assert.equal(expirationStatus({ exp: 100 }, 99999).state, 'unexpired');
  assert.equal(expirationStatus({ exp: 100 }, 100000).state, 'expired');
  assert.equal(expirationStatus({ exp: 0 }, 0).state, 'expired');
  assert.equal(expirationStatus({ exp: -1 }, 0).state, 'expired');
  assert.equal(expirationStatus({ exp: 100.5 }, 100499).state, 'unexpired');
  assert.equal(expirationStatus({ exp: 100.5 }, 100500).state, 'expired');
  assert.match(expirationStatus({ exp: 100.5 }, 0).message, /1970-01-01T00:01:40.500Z/);
});

test('JWT: distinguishes missing, invalid, and unrepresentable expiration claims', () => {
  assert.equal(expirationStatus({}).state, 'missing');
  for (const exp of [null, '100', true, [], {}, Infinity, NaN, 1e100]) {
    assert.equal(expirationStatus({ exp }).state, 'invalid');
  }
  // Valid JSON can still contain a number that overflows a JavaScript Number.
  const raw = Buffer.from('{"exp":1e309}').toString('base64url');
  assert.equal(expirationStatus(decodeJwt(`${encode({ alg: 'none' })}.${raw}.`).payload).state, 'invalid');
});
