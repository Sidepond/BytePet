import test from 'node:test';
import assert from 'node:assert/strict';
import { usageDisplay, resetLabel } from '../desktop/usage-ui.js';

test('usage: shows zero, missing, expired and stale limits accurately', () => {
  const provider = { status: 'ready', updatedAt: 1000000, windows: [{ id: 'primary', usedPercent: 0, resetsAt: 2000000 }] };
  assert.equal(usageDisplay(provider, 'primary', 1000001).percent, '0%');
  assert.equal(usageDisplay(provider, 'secondary', 1000001).percent, '—');
  assert.equal(usageDisplay(provider, 'primary', 2000001).percent, '—');
  assert.equal(usageDisplay(provider, 'primary', 1950000).stale, true);
  assert.equal(resetLabel(provider.windows[0], 2000001), '초기화 후 확인 필요');
});
