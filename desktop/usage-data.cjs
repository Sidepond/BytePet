const fs = require('node:fs');
const path = require('node:path');
const DEFAULTS = Object.freeze({ codex: true, claude: true, badgeMode: 'always', badgePosition: 'ground', badgeWindow: 'primary' });
const validators = {
  codex: value => typeof value === 'boolean', claude: value => typeof value === 'boolean',
  badgeMode: value => ['always', 'hidden'].includes(value),
  badgePosition: value => ['ground', 'top', 'left', 'right'].includes(value),
  badgeWindow: value => ['primary', 'secondary'].includes(value),
};
function validChange(key, value) { return typeof key === 'string' && Object.hasOwn(validators, key) && validators[key](value); }
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { try { fs.unlinkSync(temporary); } catch {} }
}
function readJson(file, max = 16384) {
  if (fs.statSync(file).size > max) throw new Error('File too large');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function createUsageStore(directory) {
  const file = path.join(directory, 'ai-usage.json');
  return {
    read() {
      try {
        const saved = readJson(file);
        if (![1, 2].includes(saved?.version)) throw new Error('Unknown version');
        const preferences = { ...DEFAULTS };
        for (const key of Object.keys(DEFAULTS)) {
          let value = key === 'badgeMode' && saved.preferences?.badgeMode === 'hover' ? 'always' : saved.preferences?.[key];
          if (saved.version === 1 && key === 'badgePosition' && value === 'top') value = 'ground';
          if (!validChange(key, value)) throw new Error('Invalid preferences');
          preferences[key] = value;
        }
        if (saved.version === 1 || saved.preferences.badgeMode === 'hover') {
          try { atomicWrite(file, { version: 2, preferences }); }
          catch { return { preferences, warning: '사용량 배치 설정을 적용했지만 설정 파일에 저장하지 못했어요.' }; }
        }
        return { preferences, warning: null };
      } catch (error) {
        return { preferences: { ...DEFAULTS }, warning: error.code === 'ENOENT' ? null : 'AI 사용량 설정을 읽지 못해 기본값을 적용했어요.' };
      }
    },
    write: preferences => atomicWrite(file, { version: 2, preferences }),
  };
}
function usageWindow(id, percent, seconds, minutes) {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100 || !Number.isFinite(seconds) || seconds <= 0 || seconds > 1e11) return null;
  return { id, usedPercent: percent, resetsAt: seconds * 1000,
    durationMinutes: Number.isFinite(minutes) && minutes > 0 && minutes < 1e7 ? minutes : null };
}
function normalizeCodex(result) {
  const limits = result?.rateLimitsByLimitId?.codex ?? result?.rateLimits;
  if (!limits || (limits.limitId && limits.limitId !== 'codex')) return [];
  return ['primary', 'secondary'].map(id => {
    const value = limits[id];
    // Some plans put their only (weekly) window in primary. Classify by
    // duration so the badge's short/weekly selector stays truthful.
    const slot = value?.windowDurationMins >= 10080 ? 'secondary' : value?.windowDurationMins > 0 ? 'primary' : id;
    return usageWindow(slot, value?.usedPercent, value?.resetsAt, value?.windowDurationMins);
  }).filter(Boolean);
}
function normalizeClaude(data) {
  return [['primary', 'five_hour', 300], ['secondary', 'seven_day', 10080]].map(([id, key, minutes]) => {
    const value = data?.rate_limits?.[key];
    return usageWindow(id, value?.used_percentage, value?.resets_at, minutes);
  }).filter(Boolean);
}
module.exports = { DEFAULTS, validChange, atomicWrite, readJson, createUsageStore, usageWindow, normalizeCodex, normalizeClaude };
