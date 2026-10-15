const { contextBridge, ipcRenderer } = require('electron');

// Only the drag lifecycle is exposed; the renderer cannot read or write files.
contextBridge.exposeInMainWorld('petDrag', {
  start: (x, y) => ipcRenderer.send('pet:drag', 'start', { x, y }),
  move: (x, y) => ipcRenderer.send('pet:drag', 'move', { x, y }),
  end: () => ipcRenderer.send('pet:drag', 'end'),
});
