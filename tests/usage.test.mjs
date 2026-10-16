import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { DEFAULTS, createUsageStore, normalizeCodex, normalizeClaude } from '../desktop/usage-data.cjs';
import { readCodexUsage } from '../desktop/usage-codex.cjs';
import { createClaudeConnection } from '../desktop/usage-claude.cjs';
import { createUsageService } from '../desktop/usage-service.cjs';
import { badgeBounds, characterBounds } from '../desktop/usage-layout.cjs';
import { usageDisplay, resetLabel } from '../desktop/usage-ui.js';
const temporary = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytepet-usage-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const future = () => Math.floor(Date.now() / 1000) + 3600;

test('usage: normalize missing, zero, malformed and single weekly windows without guessing', () => {
  assert.deepEqual(normalizeCodex({ rateLimits: { primary: { usedPercent: 31, windowDurationMins: 10080, resetsAt: 2000000000 } } }), [
    { id: 'secondary', usedPercent: 31, durationMinutes: 10080, resetsAt: 2000000000000 },
  ]);
  assert.deepEqual(normalizeCodex({ rateLimits: { limitId: 'other', primary: { usedPercent: 22, resetsAt: 2000000000 } } }), []);
  assert.deepEqual(normalizeClaude({ rate_limits: { five_hour: { used_percentage: 0, resets_at: 2000000000 }, seven_day: { used_percentage: '30', resets_at: 2000000000 } } }), [
    { id: 'primary', usedPercent: 0, durationMinutes: 300, resetsAt: 2000000000000 },
  ]);
  for (const value of [-1, 101, null, NaN, '0']) assert.equal(normalizeClaude({ rate_limits: { five_hour: { used_percentage: value, resets_at: 2000000000 } } }).length, 0);
  const provider = { status: 'ready', updatedAt: 1000000, windows: [{ id: 'primary', usedPercent: 0, resetsAt: 2000000 }] };
  assert.equal(usageDisplay(provider, 'primary', 1000001).percent, '0%');
  assert.equal(usageDisplay(provider, 'secondary', 1000001).percent, '—');
  assert.equal(usageDisplay(provider, 'primary', 2000001).percent, '—');
  assert.equal(usageDisplay(provider, 'primary', 1950000).stale, true);
  assert.equal(resetLabel(provider.windows[0], 2000001), '초기화 후 확인 필요');
});

test('usage: atomic preferences survive restart and invalid changes do not enter storage', t => {
  const directory = temporary(t), store = createUsageStore(directory);
  assert.deepEqual(store.read(), { preferences: DEFAULTS, warning: null });
  store.write({ ...DEFAULTS, badgeMode: 'always', badgePosition: 'right', codex: false });
  assert.equal(createUsageStore(directory).read().preferences.badgePosition, 'right');
  fs.writeFileSync(path.join(directory, 'ai-usage.json'), '{broken');
  assert.ok(store.read().warning);
  const legacy = { ...DEFAULTS, badgeMode: 'hover', badgeWindow: 'secondary', claude: false };
  fs.writeFileSync(path.join(directory, 'ai-usage.json'), JSON.stringify({ version: 1, preferences: legacy }));
  assert.deepEqual(store.read().preferences, { ...legacy, badgeMode: 'always' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'ai-usage.json'))).preferences.badgeMode, 'always');
  store.write({ ...DEFAULTS, badgeMode: 'hidden' });
  assert.equal(store.read().preferences.badgeMode, 'hidden', 'explicit hide is preserved');
});

test('usage: legacy top migrates to ground once while explicit placements and hide remain intact', t => {
  const directory = temporary(t), file = path.join(directory, 'ai-usage.json'), store = createUsageStore(directory);
  fs.writeFileSync(file, JSON.stringify({ version: 1, preferences: { ...DEFAULTS, badgePosition: 'top', badgeMode: 'hidden' } }));
  assert.equal(store.read().preferences.badgePosition, 'ground');
  assert.equal(store.read().preferences.badgeMode, 'hidden');
  assert.equal(JSON.parse(fs.readFileSync(file)).version, 2);
  store.write({ ...DEFAULTS, badgePosition: 'top' });
  assert.equal(createUsageStore(directory).read().preferences.badgePosition, 'top', 'a new explicit top preference survives restart');
  for (const position of ['left', 'right']) {
    fs.writeFileSync(file, JSON.stringify({ version: 1, preferences: { ...DEFAULTS, badgePosition: position } }));
    assert.equal(store.read().preferences.badgePosition, position);
  }
});

test('usage: ground gauge stays on the yard, including one provider, hidden ground and all screen edges', () => {
  for (const area of [{ x: 0, y: 0, width: 1440, height: 900 }, { x: -1200, y: -100, width: 1200, height: 800 }]) {
    for (const ground of [true, false]) for (const menuSide of ['left', 'right']) for (const rows of [1, 2]) {
      const width = ground ? 496 : 128;
      for (const x of [area.x, area.x + area.width - width]) for (const y of [area.y, area.y + area.height - 128]) {
        const pet = { x, y, width, height: 128 }, appearance = { ground, menuSide };
        const result = badgeBounds(pet, area, appearance, 'ground', { y: 50, height: 60 }, rows);
        assert.deepEqual(result, badgeBounds(pet, area, appearance, 'ground', { y: 0, height: 20 }, rows));
        assert.equal(result.side, 'ground'); assert.equal(result.height, rows === 1 ? 16 : 24);
        assert.ok(result.x >= pet.x + 8 && result.x + result.width <= pet.x + pet.width - 8);
        assert.equal(result.y + result.height / 2, pet.y + pet.height - 12);
        assert.ok(result.x >= area.x && result.y >= area.y && result.x + result.width <= area.x + area.width && result.y + result.height <= area.y + area.height);
      }
    }
  }
});

function fakeServer({ account = { type: 'chatgpt', email: 'do-not-expose@example.test' }, fail = false, hang = false } = {}) {
  const requests = []; let killed = false;
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.exitCode = null; child.signalCode = null;
  child.kill = () => { killed = true; child.signalCode = 'SIGTERM'; queueMicrotask(() => child.emit('exit', null)); };
  child.stdin.on('data', data => {
    const request = JSON.parse(data.toString()); requests.push(request);
    if (hang || !request.id) return;
    const response = request.id === 1 ? { id: 1, result: {} } : request.id === 2 ? { id: 2, result: { account } } : fail ? { id: 3, error: { message: 'secret server detail' } } : { id: 3, result: { rateLimits: { primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 2000000000 } } } };
    queueMicrotask(() => child.stdout.write(JSON.stringify(response) + '\n'));
  });
  return { spawn: () => child, requests, killed: () => killed };
}
test('usage: Codex reads only account/limits, strips identity, closes child and handles errors/timeouts', async () => {
  const server = fakeServer();
  const value = await readCodexUsage({ executable: '/fake/codex', spawnProcess: server.spawn });
  assert.equal(value.windows[0].usedPercent, 42);
  assert.equal(JSON.stringify(value).includes('email'), false);
  assert.deepEqual(server.requests.map(r => r.method), ['initialize', 'initialized', 'account/read', 'account/rateLimits/read']);
  assert.ok(server.killed());
  for (const options of [{ fail: true }, { account: null }, { account: { type: 'apiKey' } }, { hang: true }]) {
    const failed = fakeServer(options);
    await assert.rejects(readCodexUsage({ executable: '/fake', spawnProcess: failed.spawn, timeoutMs: 20 }), error => !error.message.includes('secret'));
    assert.ok(failed.killed());
  }
  const hanging = fakeServer({ hang: true }), controller = new AbortController();
  const result = readCodexUsage({ executable: '/fake', spawnProcess: hanging.spawn, signal: controller.signal });
  controller.abort(); await assert.rejects(result, error => error.code === 'cancelled'); assert.ok(hanging.killed());
});

test('usage: service coalesces queries, enforces cooldown, cancels disabled providers and rejects foreign settings', async () => {
  let clock = 1000000, calls = 0, finish, failWrite = false;
  const service = createUsageService({ autoStart: false, now: () => clock,
    store: { read: () => ({ preferences: { ...DEFAULTS }, warning: null }), write: () => { if (failWrite) throw new Error('disk'); } },
    claude: { connected: () => false, read: () => ({ status: 'unavailable', windows: [] }) },
    readCodex: () => { calls++; return new Promise(resolve => { finish = resolve; }); },
  });
  const first = service.refresh(), second = service.refresh(); assert.equal(calls, 1);
  service.set('codex', false);
  finish({ windows: [{ id: 'primary', usedPercent: 50 }], updatedAt: clock }); await Promise.all([first, second]);
  assert.equal(service.state().providers.codex.status, 'disabled');
  assert.deepEqual(service.state().providers.codex.windows, []);
  assert.throws(() => service.set('__proto__', true)); assert.throws(() => service.set('badgePosition', 'bottom'));
  failWrite = true; assert.throws(() => service.set('badgeMode', 'hidden')); assert.equal(service.state().preferences.badgeMode, 'always'); failWrite = false;
  service.set('codex', true); finish({ windows: [], updatedAt: clock }); await service.refresh(); assert.equal(calls, 2);
  await service.refresh(); assert.equal(calls, 2);
  clock += 30001; const later = service.refresh(); assert.equal(calls, 3); finish({ windows: [], updatedAt: clock }); await later;
  service.dispose();
});

test('usage: Claude bridge preserves output/settings, stores only numbers and restores safely', t => {
  const directory = temporary(t), claudeDirectory = path.join(directory, "claude's settings");
  fs.mkdirSync(claudeDirectory);
  const settingsFile = path.join(claudeDirectory, 'settings.json');
  const original = { theme: 'dark', statusLine: { type: 'command', command: "printf 'existing status'", padding: 2 } };
  fs.writeFileSync(settingsFile, JSON.stringify(original));
  const connection = createClaudeConnection({ directory, claudeDirectory });
  assert.equal(connection.connected(), false); connection.install(); assert.equal(connection.connected(), true);
  const installed = JSON.parse(fs.readFileSync(settingsFile));
  assert.equal(installed.statusLine.padding, 2); assert.equal(installed.theme, 'dark');
  const raw = JSON.stringify({ transcript_path: 'private-file', apiKey: 'not-for-storage', rate_limits: { five_hour: { used_percentage: 67, resets_at: future() }, seven_day: { used_percentage: 45, resets_at: future() } } });
  const result = spawnSync('/bin/sh', ['-c', installed.statusLine.command], { input: raw, encoding: 'utf8' });
  assert.equal(result.status, 0); assert.equal(result.stdout, 'existing status');
  const snapshot = fs.readFileSync(path.join(directory, 'claude-usage.json'), 'utf8');
  assert.equal(snapshot.includes('private-file'), false); assert.equal(snapshot.includes('not-for-storage'), false);
  assert.equal(connection.read().windows[0].usedPercent, 67);
  connection.install(); // reconnect never nests the wrapper
  const configFile = path.join(claudeDirectory, 'bytepet-usage', 'config.json');
  const before = fs.readFileSync(configFile, 'utf8');
  const rename = fs.renameSync;
  fs.renameSync = (source, target) => { if (target === settingsFile) throw new Error('settings write failure'); return rename(source, target); };
  try {
    const moved = createClaudeConnection({ directory, claudeDirectory, executable: '/moved/app' });
    assert.throws(() => moved.install());
    assert.equal(fs.readFileSync(configFile, 'utf8'), before, 'failed install preserves the previous restoration record');
    assert.equal(connection.connected(), true);
  } finally { fs.renameSync = rename; }
  const edited = JSON.parse(fs.readFileSync(settingsFile)); edited.theme = 'light'; fs.writeFileSync(settingsFile, JSON.stringify(edited));
  connection.disconnect(); assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile)), { ...original, theme: 'light' });
  connection.install();
  fs.writeFileSync(settingsFile, JSON.stringify({ statusLine: { type: 'command', command: 'new-user-setting' } }));
  assert.throws(() => connection.disconnect()); assert.equal(JSON.parse(fs.readFileSync(settingsFile)).statusLine.command, 'new-user-setting');
  fs.writeFileSync(settingsFile, '{bad'); assert.throws(() => connection.install()); assert.equal(fs.readFileSync(settingsFile, 'utf8'), '{bad');
});

test('usage: badge fits every screen edge with ground on/off and both menu positions', () => {
  for (const area of [{ x: 0, y: 0, width: 1440, height: 900 }, { x: -1280, y: -100, width: 1280, height: 800 }]) {
    for (const ground of [true, false]) for (const menuSide of ['left', 'right']) for (const position of ['top', 'left', 'right']) {
      const width = ground ? 496 : 128;
      for (const x of [area.x, area.x + area.width - width]) for (const y of [area.y, area.y + area.height - 128]) {
        const pet = { x, y, width, height: 128 }, appearance = { ground, menuSide };
        const badge = badgeBounds(pet, area, appearance, position), cat = characterBounds(pet, appearance);
        assert.ok(badge.x >= area.x && badge.y >= area.y && badge.x + badge.width <= area.x + area.width && badge.y + badge.height <= area.y + area.height);
        assert.ok(badge.x + badge.width <= cat.x || badge.x >= cat.x + cat.width || badge.y + badge.height <= cat.y || badge.y >= cat.y + cat.height);
      }
    }
  }
});


test('usage: network failures retain stale data, but an unavailable account clears it', async () => {
  let clock = 1000000, mode = 'ready';
  const service = createUsageService({ autoStart: false, now: () => clock,
    store: { read: () => ({ preferences: { ...DEFAULTS }, warning: null }), write() {} },
    claude: { connected: () => false, read: () => ({ status: 'unavailable', windows: [] }) },
    readCodex: async () => {
      if (mode !== 'ready') { const error = new Error('failed'); error.code = mode; throw error; }
      return { windows: [{ id: 'primary', usedPercent: 12, resetsAt: 2000000 }], updatedAt: clock };
    },
  });
  await service.refresh(); mode = 'error'; clock += 30001; await service.refresh();
  assert.equal(service.state().providers.codex.windows[0].usedPercent, 12);
  assert.equal(usageDisplay(service.state().providers.codex, 'primary', clock).stale, true);
  mode = 'unavailable'; clock += 30001; await service.refresh();
  assert.deepEqual(service.state().providers.codex.windows, []);
  service.dispose();
});
