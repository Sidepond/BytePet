import test from 'node:test';
import assert from 'node:assert/strict';
import { detectFormat, FORMAT_LIMIT } from '../desktop/format.js';

const header = Buffer.from('{"alg":"HS256"}').toString('base64url');

test('format: recognizes all JSON root types without changing or validating input', () => {
  for (const input of ['{}', ' [1,2] \n', '"한글 🐱"', 'true', 'false', 'null', '0', '-12.3e+5', '1.2',
    '{"unfinished":', '[1,]', '"unfinished', '01', '1e', '1.2.3', '{"token":"a.b.c"}']) {
    assert.deepEqual(detectFormat(input), { format: 'json' }, input);
  }
});

test('format: recognizes JWT headers, Bearer prefixes, unsigned and encrypted candidates', () => {
  for (const input of [`${header}.e30.AA`, `${header}.e30.`, `${header}.bad!.bad!`, `${header}.a.b.c.d`,
    ` \n${header}.e30.AA\t`, 'Bearer malformed-token', 'bearer\tabc', 'Bearer']) {
    assert.deepEqual(detectFormat(input), { format: 'jwt' }, input);
  }
  const spaced = Buffer.from(' \n { "alg": "none" }').toString('base64url');
  assert.deepEqual(detectFormat(`${spaced}.e30.`), { format: 'jwt' });
});

test('format: does not interpret ordinary text, filenames, URLs, or arbitrary base64 as JWTs', () => {
  for (const input of ['오늘의 메모', 'photo.backup.png', 'https://example.com', 'a.b.c', 'nullify',
    '2026년 일정', 'BearerToken', '_w.e30.AA', 'bnVsbA.e30.AA', 'e30.too-short']) {
    assert.deepEqual(detectFormat(input), { format: null, reason: 'unknown' }, input);
  }
  // A quoted JWT is a JSON string, not a token to be silently unwrapped.
  assert.deepEqual(detectFormat(`"${header}.e30.AA"`), { format: 'json' });
});

test('format: bounds input by UTF-8 size and distinguishes empty input from unknown text', () => {
  for (const input of ['', ' \r\n\t']) assert.deepEqual(detectFormat(input), { format: null, reason: 'empty' });
  assert.equal(detectFormat('"' + 'x'.repeat(FORMAT_LIMIT - 2) + '"').format, 'json');
  for (const input of ['x'.repeat(FORMAT_LIMIT + 1), '한'.repeat(400000)]) {
    assert.deepEqual(detectFormat(input), { format: null, reason: 'limit' });
  }
});
