const COPY_LIMIT = 4 * 1024 * 1024;

function createResultService({ ipcMain, clipboard, pet, getPanel }) {
  let copying = false;
  function allowed(event) {
    const panel = getPanel();
    return panel && !panel.isDestroyed() && !panel.webContents.isDestroyed()
      && event.sender === panel.webContents && event.senderFrame === panel.webContents.mainFrame;
  }
  ipcMain.handle('results:copy', async (event, text) => {
    if (!allowed(event)) return { ok: false, error: '허용되지 않은 요청이에요.' };
    if (typeof text !== 'string' || !text.length || text.length > COPY_LIMIT) {
      return { ok: false, error: '복사할 결과가 없거나 너무 커요.' };
    }
    if (copying) return { ok: false, error: '복사 중이에요. 잠시 후 다시 시도해 주세요.' };
    copying = true;
    try {
      await clipboard.writeText(text);
      return { ok: true };
    } catch { return { ok: false, error: '클립보드에 복사하지 못했어요. 다시 시도해 주세요.' }; }
    finally { copying = false; }
  });
  function react(event, outcome) {
    if (!allowed(event) || !['success', 'failure'].includes(outcome)) return;
    if (!pet.isDestroyed() && !pet.webContents.isDestroyed()) pet.webContents.send('results:reaction', outcome);
  }
  ipcMain.on('results:react', react);
  return { dispose() {
    ipcMain.removeHandler('results:copy');
    ipcMain.removeListener('results:react', react);
  } };
}

module.exports = { createResultService, COPY_LIMIT };
