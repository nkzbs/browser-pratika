const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  send: (ch, ...a) => ipcRenderer.send('ui:' + ch, ...a),
  onTabs: f => ipcRenderer.on('tabs', (_e, s) => f(s))
});
