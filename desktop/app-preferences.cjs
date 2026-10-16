function createAppPreferences({ app, clipboard, platform = process.platform, arch = process.arch,
  systemVersion = process.getSystemVersion?.() ?? require('node:os').release(), resetPosition }) {
  const info = { version: app.getVersion(), platform: platform === 'darwin' ? 'macOS' : platform,
    systemVersion, arch, packaged: app.isPackaged };
  function loginState() {
    const unavailable = platform !== 'darwin' ? 'macOS에서 사용할 수 있어요.'
      : !app.isPackaged ? 'BytePet 앱으로 실행할 때 사용할 수 있어요.'
      : app.commandLine.hasSwitch('user-data-dir') ? '별도 데이터 폴더로 실행 중에는 변경할 수 없어요.' : null;
    if (unavailable) return { available: false, enabled: false, status: 'unavailable', message: unavailable };
    try {
      const value = app.getLoginItemSettings();
      const pending = value.status === 'requires-approval';
      return { available: true, enabled: value.openAtLogin || pending, status: pending ? 'requires-approval' : value.openAtLogin ? 'enabled' : 'disabled',
        message: pending ? 'macOS 시스템 설정 → 일반 → 로그인 항목에서 BytePet을 허용해 주세요.'
          : value.status === 'not-found' ? '앱 위치를 확인한 뒤 다시 켜주세요.'
          : value.openAtLogin ? 'Mac에 로그인하면 BytePet이 함께 시작돼요.' : '앱을 사용할 위치에 둔 뒤 켜주세요.' };
    } catch {
      return { available: false, enabled: false, status: 'error', message: '자동 실행 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.' };
    }
  }
  return {
    state: () => ({ info: { ...info }, login: loginState() }),
    setLogin(enabled) {
      if (typeof enabled !== 'boolean') throw new Error('올바른 자동 실행 설정을 선택해 주세요.');
      const before = loginState();
      if (!before.available) throw new Error(before.message);
      try { app.setLoginItemSettings({ openAtLogin: enabled }); }
      catch { throw new Error('자동 실행 설정을 변경하지 못했어요. macOS 로그인 항목을 확인해 주세요.'); }
      const next = loginState();
      if (!next.available || next.enabled !== enabled) throw new Error(next.status === 'error' ? next.message : '자동 실행 설정이 적용되지 않았어요. macOS 로그인 항목을 확인해 주세요.');
      return { info: { ...info }, login: next };
    },
    resetPosition,
    async copyInfo() {
      const text = `BytePet ${info.version}\n${info.platform} ${info.systemVersion} (${info.arch})\n실행: ${info.packaged ? '앱' : '개발 모드'}`;
      try { await clipboard.writeText(text); }
      catch { throw new Error('환경 정보를 복사하지 못했어요. 다시 시도해 주세요.'); }
      return { message: '버전과 운영체제 정보를 복사했어요.' };
    },
  };
}

function registerAppPreferences({ ipcMain, getPanel, service }) {
  const actions = {
    'app-preferences:get': () => service.state(),
    'app-preferences:login': enabled => service.setLogin(enabled),
    'app-preferences:reset-position': () => service.resetPosition(),
    'app-preferences:copy-info': () => service.copyInfo(),
  };
  for (const [name, action] of Object.entries(actions)) ipcMain.handle(name, async (event, value) => {
    const panel = getPanel();
    if (!panel || panel.isDestroyed() || panel.webContents.isDestroyed() || event.sender !== panel.webContents || event.senderFrame !== panel.webContents.mainFrame) {
      return { ok: false, error: '허용되지 않은 요청이에요.' };
    }
    try { return { ok: true, value: await action(value) }; }
    catch (error) { return { ok: false, error: error.message || '요청을 처리하지 못했어요.' }; }
  });
  return { dispose() { for (const name of Object.keys(actions)) ipcMain.removeHandler(name); } };
}
module.exports = { createAppPreferences, registerAppPreferences };
