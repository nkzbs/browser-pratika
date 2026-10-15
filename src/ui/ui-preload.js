const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  send: (ch, ...a) => ipcRenderer.send('ui:' + ch, ...a),
  onTabs: f => ipcRenderer.on('tabs', (_e, s) => f(s)),
  onState: f => ipcRenderer.on('state', (_e, s) => f(s)),
  onFocusUrl: f => ipcRenderer.on('focus-url', f)
});
