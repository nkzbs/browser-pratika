const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  send: (ch, ...a) => ipcRenderer.send('ui:' + ch, ...a),
  onFocusUrl: f => ipcRenderer.on('focus-url', f),
  onTabs: f => ipcRenderer.on('tabs', (_e, s) => f(s))
});
