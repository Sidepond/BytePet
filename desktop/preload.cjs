const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Narrow bridges only; the renderer has no unrestricted file or clipboard access.
contextBridge.exposeInMainWorld('petDrag', {
  start: (x, y) => ipcRenderer.send('pet:drag', 'start', { x, y }),
  move: (x, y) => ipcRenderer.send('pet:drag', 'move', { x, y }),
  end: () => ipcRenderer.send('pet:drag', 'end'),
});

contextBridge.exposeInMainWorld('petInput', {
  updateRegion: region => ipcRenderer.send('pet:hit-region', region),
});

contextBridge.exposeInMainWorld('petPanel', {
  toggle: () => ipcRenderer.send('pet:panel-toggle'),
  close: () => ipcRenderer.send('panel:close'),
  onState: callback => {
    const listener = (_event, open) => callback(open);
    ipcRenderer.on('pet:panel-state', listener);
    return () => ipcRenderer.removeListener('pet:panel-state', listener);
  },
});

contextBridge.exposeInMainWorld('utilityPanel', {
  close: () => ipcRenderer.send('panel:close'),
  onOpen: callback => {
    const listener = () => callback();
    ipcRenderer.on('panel:opened', listener);
    return () => ipcRenderer.removeListener('panel:opened', listener);
  },
});

contextBridge.exposeInMainWorld('resultTools', {
  copy: text => ipcRenderer.invoke('results:copy', text),
  react: outcome => ipcRenderer.send('results:react', outcome),
  onReaction: callback => {
    const listener = (_event, outcome) => callback(outcome);
    ipcRenderer.on('results:reaction', listener);
    return () => ipcRenderer.removeListener('results:reaction', listener);
  },
});

contextBridge.exposeInMainWorld('food', {
  saveText: text => ipcRenderer.invoke('food:save-text', text),
  async saveFiles(files) {
    if (!Array.isArray(files) || files.length > 10) return { ok: false, error: '파일은 한 번에 10개까지 먹일 수 있어요.' };
    try {
      const sources = [];
      for (const file of files) {
        const source = { name: file.name };
        const filePath = webUtils.getPathForFile(file);
        if (file.size > 25 * 1024 * 1024) source.oversized = true;
        else if (filePath) source.path = filePath;
        else source.bytes = new Uint8Array(await file.arrayBuffer());
        sources.push(source);
      }
      return ipcRenderer.invoke('food:save-files', sources);
    } catch { return { ok: false, error: '파일을 읽을 수 없어요. 다시 선택해 주세요.' }; }
  },
  list: () => ipcRenderer.invoke('food:list'),
  readText: id => ipcRenderer.invoke('food:read-text', id),
  open: id => ipcRenderer.invoke('food:open', id),
  reveal: id => ipcRenderer.invoke('food:reveal', id),
  folder: () => ipcRenderer.invoke('food:folder'),
  onSaved: callback => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on('food:saved', listener);
    return () => ipcRenderer.removeListener('food:saved', listener);
  },
});
