const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { atomicWrite, readJson, usageWindow } = require('./usage-data.cjs');
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
function createClaudeConnection({ directory, claudeDirectory = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), executable = process.execPath } = {}) {
  const settingsFile = path.join(claudeDirectory, 'settings.json');
  const bridgeDirectory = path.join(claudeDirectory, 'bytepet-usage');
  const configFile = path.join(bridgeDirectory, 'config.json');
  const snapshotPath = path.join(directory, 'claude-usage.json');
  function settings() {
    try {
      const value = readJson(settingsFile, 1024 * 1024);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings');
      return value;
    } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  function connected() {
    try {
      const config = readJson(configFile, 1024 * 1024);
      return settings().statusLine?.command === config.installedCommand && config.snapshotPath === snapshotPath && fs.existsSync(path.join(bridgeDirectory, 'bridge.cjs'));
    } catch { return false; }
  }
  function install() {
    const current = settings();
    let previousStatusLine = current.statusLine ?? null;
    let priorConfig = null;
    try {
      const config = readJson(configFile, 1024 * 1024);
      priorConfig = config;
      if (current.statusLine?.command === config.installedCommand) previousStatusLine = config.previousStatusLine;
      else if (current.statusLine?.command?.includes(path.join(bridgeDirectory, 'bridge.cjs'))) throw new Error('Connection record mismatch');
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('기존 BytePet 연결 기록을 읽지 못했어요. Claude 설정을 유지합니다.');
      if (current.statusLine?.command?.includes(path.join(bridgeDirectory, 'bridge.cjs'))) throw new Error('이전 상태줄 복원 기록이 없어요. Claude 설정을 확인해 주세요.');
    }
    if (previousStatusLine !== null && (previousStatusLine.type !== 'command' || typeof previousStatusLine.command !== 'string')) throw new Error('현재 Claude 상태줄 형식을 지원하지 않아 설정을 유지했어요.');
    fs.mkdirSync(bridgeDirectory, { recursive: true, mode: 0o700 });
    fs.copyFileSync(path.join(__dirname, 'usage-claude-bridge.cjs'), path.join(bridgeDirectory, 'bridge.cjs'));
    fs.copyFileSync(path.join(__dirname, 'usage-data.cjs'), path.join(bridgeDirectory, 'usage-data.cjs'));
    const installedCommand = `ELECTRON_RUN_AS_NODE=1 ${quote(executable)} ${quote(path.join(bridgeDirectory, 'bridge.cjs'))} ${quote(configFile)}`;
    atomicWrite(configFile, { snapshotPath, previousStatusLine, installedCommand });
    try {
      atomicWrite(settingsFile, { ...current, statusLine: { ...(previousStatusLine || {}), type: 'command', command: installedCommand } });
    } catch (error) {
      // Keep the prior command and its restoration record paired if changing
      // the user settings fails (for example after moving the app).
      try { if (priorConfig) atomicWrite(configFile, priorConfig); else fs.unlinkSync(configFile); } catch {}
      throw error;
    }
    return true;
  }
  function disconnect() {
    const current = settings();
    const config = readJson(configFile, 1024 * 1024);
    if (current.statusLine?.command !== config.installedCommand || config.snapshotPath !== snapshotPath) throw new Error('Claude 상태줄이 다른 곳에서 변경되어 덮어쓰지 않았어요.');
    if (config.previousStatusLine === null) delete current.statusLine;
    else current.statusLine = config.previousStatusLine;
    atomicWrite(settingsFile, current);
    try { fs.unlinkSync(snapshotPath); } catch {}
  }
  function read() {
    if (!connected()) return { status: 'unavailable', message: 'Claude Code 상태줄을 연결해 주세요.', windows: [], updatedAt: null };
    try {
      const value = readJson(snapshotPath);
      if (value?.version !== 1 || !Number.isFinite(value.updatedAt) || value.updatedAt <= 0 || value.updatedAt > Date.now() + 60000 || !Array.isArray(value.windows)) throw new Error('Invalid snapshot');
      const windows = ['primary', 'secondary'].map(id => {
        const item = value.windows.find(w => w?.id === id);
        return usageWindow(id, item?.usedPercent, item?.resetsAt / 1000, id === 'primary' ? 300 : 10080);
      }).filter(Boolean);
      return { status: windows.length ? 'ready' : 'unavailable', windows, updatedAt: value.updatedAt,
        message: windows.length ? '' : '한도 데이터가 없어요. Pro·Max 로그인과 Claude Code 버전을 확인해 주세요.' };
    } catch (error) {
      return { status: error.code === 'ENOENT' ? 'waiting' : 'error', windows: [], updatedAt: null,
        message: error.code === 'ENOENT' ? '연결했어요. Claude Code에서 응답을 받은 뒤 표시됩니다.' : 'Claude 사용량 기록을 읽지 못했어요. 다음 상태줄 갱신을 기다려 주세요.' };
    }
  }
  return { connected, install, disconnect, read };
}
module.exports = { createClaudeConnection };
