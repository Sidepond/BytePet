import test from 'node:test';
import assert from 'node:assert/strict';
import { formatJson, JsonFormatError, JSON_LIMIT, JSON_DEPTH_LIMIT } from '../desktop/json.js';

test('JSON: formats nested containers with two spaces and supports every root value', () => {
  const input = ' \r\n { "name" : "고양이 🐱", "items": [true,null,{"x":1}], "empty":{} }\t';
  assert.equal(formatJson(input), '{\n  "name": "고양이 🐱",\n  "items": [\n    true,\n    null,\n    {\n      "x": 1\n    }\n  ],\n  "empty": {}\n}');
  for (const value of ['{}', '[]', 'true', 'false', 'null', '1.5', '"text"']) {
    assert.equal(formatJson(` \t${value}\r\n`), value);
  }
  assert.equal(formatJson(formatJson(input)), formatJson(input));
});

test('JSON: preserves numeric precision, key order, duplicate keys, and string escapes', () => {
  const input = String.raw`{"10":900719925474099312345,"2":1e309,"n":-0,"n":1.2300E-04,"text":"\uD55C\n\t\"\\\/{}[],:"}`;
  const result = formatJson(input);
  assert.equal(result, String.raw`{
  "10": 900719925474099312345,
  "2": 1e309,
  "n": -0,
  "n": 1.2300E-04,
  "text": "\uD55C\n\t\"\\\/{}[],:"
}`);
  assert.equal(formatJson('{"__proto__":{"polluted":true}}'), '{\n  "__proto__": {\n    "polluted": true\n  }\n}');
  assert.equal({}.polluted, undefined);
});

test('JSON: reports original offsets and one-based Unicode line/column positions', () => {
  for (const [input, offset, line, column] of [
    ['{\n  "x": 1,\n}', 12, 3, 1],
    ['{\r\n"🐱":1,\r\n}', 12, 3, 1],
    ['{"🐱":true x}', 11, 1, 11],
    ['[1,', 3, 1, 4],
    ['{\r"x" 1}', 6, 2, 5],
  ]) {
    assert.throws(() => formatJson(input), error => {
      assert.ok(error instanceof JsonFormatError);
      assert.equal(error.offset, offset, input);
      assert.equal(error.line, line, input);
      assert.equal(error.column, column, input);
      return true;
    });
  }
});

test('JSON: rejects malformed syntax, comments, trailing commas, and bad escapes', () => {
  const invalid = [
    '', '  \n', '{', '[', '{"x"}', '{x:1}', "{'x':1}", '{"x":}', '[1 2]', '[1,]', '{"x":1,}',
    'true false', 'nullx', 'undefined', 'NaN', 'Infinity', '+1', '01', '.5', '1.', '1e', '1e+', '--1',
    '/* comment */ {}', '// comment\n{}', '\uFEFF{}', '\u00A0{}',
    '"unterminated', '"a\nb"', '"a\tb"', '"\u0000"', '"trailing\\',
    String.raw`"\x00"`, String.raw`"\u12"`, String.raw`"\u0X12"`, String.raw`"\v"`,
  ];
  for (const input of invalid) {
    assert.throws(() => JSON.parse(input), SyntaxError, input);
    assert.throws(() => formatJson(input), JsonFormatError, input);
  }
});

test('JSON: accepts the same syntax as native parsing across a deterministic mutation corpus', () => {
  const seeds = ['{"a":[1,-0,2.3e+4,true,null,"한🐱"],"b":{}}', '[[],{},false,"\\u1234\\n"]', '"\\\\\\\""'];
  const replacements = [' ', ',', ':', '}', ']', '"', '\\', '\n', '0', 'x', ''];
  for (const seed of seeds) {
    for (let index = 0; index < seed.length; index++) {
      for (const replacement of replacements) {
        const input = seed.slice(0, index) + replacement + seed.slice(index + 1);
        let native;
        try { native = JSON.parse(input); }
        catch { assert.throws(() => formatJson(input), JsonFormatError, input); continue; }
        const formatted = formatJson(input);
        assert.deepEqual(JSON.parse(formatted), native, input);
        assert.equal(formatJson(formatted), formatted, input);
      }
    }
  }
});

test('JSON: bounds UTF-8 input, nesting, and expanded output with actionable errors', () => {
  assert.throws(() => formatJson(null), /입력/);
  assert.equal(formatJson('"' + 'x'.repeat(JSON_LIMIT - 2) + '"').length, JSON_LIMIT);
  assert.throws(() => formatJson('"' + 'x'.repeat(JSON_LIMIT - 1) + '"'), /1MB/);
  assert.throws(() => formatJson('"' + '한'.repeat(400000) + '"'), /1MB/);
  const nested = depth => '['.repeat(depth) + '0' + ']'.repeat(depth);
  assert.doesNotThrow(() => formatJson(nested(JSON_DEPTH_LIMIT)));
  assert.throws(() => formatJson(nested(JSON_DEPTH_LIMIT + 1)), /128단계/);
  const expanded = '['.repeat(128) + Array(20000).fill('0').join(',') + ']'.repeat(128);
  assert.throws(() => formatJson(expanded), /결과가 너무 커/);
});
