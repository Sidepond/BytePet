const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('utilityPanel', {
  close: () => ipcRenderer.send('panel:close'),
  onOpen: callback => {
    const listener = () => callback();
    ipcRenderer.on('panel:opened', listener);
    return () => ipcRenderer.removeListener('panel:opened', listener);
  },
});
