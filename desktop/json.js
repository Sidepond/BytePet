export const JSON_LIMIT = 1024 * 1024;
export const JSON_DEPTH_LIMIT = 128;
export const JSON_OUTPUT_LIMIT = 4 * 1024 * 1024;

export class JsonFormatError extends Error {
  constructor(message, input, offset = null) {
    super(message);
    this.name = 'JsonFormatError';
    this.offset = offset;
    if (offset !== null) {
      const lines = input.slice(0, offset).split(/\r\n|\r|\n/);
      this.line = lines.length;
      this.column = Array.from(lines.at(-1)).length + 1;
    }
  }
}

// Read the JSON grammar without converting values to JavaScript objects/numbers.
// This preserves large numbers, duplicate keys, key order, and escape sequences.
export function formatJson(input) {
  if (typeof input !== 'string') throw new JsonFormatError('정리할 JSON을 입력해 주세요.');
  if (input.length > JSON_LIMIT || new TextEncoder().encode(input).length > JSON_LIMIT) {
    throw new JsonFormatError('JSON 입력은 1MB까지 정리할 수 있어요.');
  }
  let index = 0;
  let outputLength = 0;
  const output = [];
  const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const fail = message => { throw new JsonFormatError(message, input, index); };
  function emit(text) {
    outputLength += text.length;
    if (outputLength > JSON_OUTPUT_LIMIT) throw new JsonFormatError('정리 결과가 너무 커요. JSON을 나누어 입력해 주세요.');
    output.push(text);
  }
  function whitespace() { while (index < input.length && /[ \t\r\n]/.test(input[index])) index++; }
  function newline(depth) { emit('\n' + '  '.repeat(depth)); }
  function string() {
    const start = index++;
    while (index < input.length) {
      const char = input[index++];
      if (char === '"') { emit(input.slice(start, index)); return; }
      if (char.charCodeAt(0) < 0x20) { index--; fail('문자열 안의 줄바꿈·제어 문자는 이스케이프해야 해요.'); }
      if (char === '\\') {
        if (index === input.length) fail('문자열의 이스케이프가 끝나지 않았어요.');
        if (input[index] === 'u') {
          index++;
          for (let digit = 0; digit < 4; digit++, index++) {
            if (index === input.length || !/[0-9a-fA-F]/.test(input[index])) fail('\\u 뒤에는 16진수 네 자리가 필요해요.');
          }
        } else {
          if (!'"\\/bfnrt'.includes(input[index])) fail('올바르지 않은 문자열 이스케이프예요.');
          index++;
        }
      }
    }
    fail('문자열을 닫는 큰따옴표가 필요해요.');
  }
  function container(depth, object) {
    if (depth >= JSON_DEPTH_LIMIT) fail(`중첩은 ${JSON_DEPTH_LIMIT}단계까지 지원해요.`);
    const close = object ? '}' : ']';
    emit(input[index++]);
    whitespace();
    if (input[index] === close) { emit(input[index++]); return; }
    newline(depth + 1);
    while (true) {
      if (object) {
        if (input[index] !== '"') fail('객체 키를 큰따옴표로 감싸 주세요.');
        string();
        whitespace();
        if (input[index] !== ':') fail('객체 키 뒤에 콜론(:)이 필요해요.');
        index++;
        emit(': ');
      }
      value(depth + 1);
      whitespace();
      if (input[index] === close) { index++; newline(depth); emit(close); return; }
      if (input[index] !== ',') fail(`항목 사이에 쉼표(,) 또는 닫는 ${close}가 필요해요.`);
      index++;
      whitespace();
      if (input[index] === close) fail('마지막 항목 뒤의 쉼표를 지워 주세요.');
      emit(',');
      newline(depth + 1);
    }
  }
  function value(depth) {
    whitespace();
    const char = input[index];
    if (char === '{' || char === '[') { container(depth, char === '{'); return; }
    if (char === '"') { string(); return; }
    for (const literal of ['true', 'false', 'null']) {
      if (input.startsWith(literal, index)) { index += literal.length; emit(literal); return; }
    }
    number.lastIndex = index;
    const match = number.exec(input);
    if (match) { index = number.lastIndex; emit(match[0]); return; }
    fail(index === input.length ? 'JSON 값이 필요한 위치에서 입력이 끝났어요.' : 'JSON 값(객체·배열·문자열·숫자·true·false·null)이 필요해요.');
  }
  whitespace();
  if (index === input.length) fail('정리할 JSON을 입력해 주세요.');
  value(0);
  whitespace();
  if (index !== input.length) fail('JSON 값 뒤에 불필요한 문자가 있어요.');
  return output.join('');
}
