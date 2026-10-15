// API delle pagine interne (Home, Store, Moduli installati). Solo questi canali, tutti verificati dal processo principale.
const { contextBridge, ipcRenderer } = require('electron');
const call = (name, ...a) => ipcRenderer.invoke('app:' + name, ...a);
contextBridge.exposeInMainWorld('pratika', {
  catalog: () => call('catalog'),
  home: () => call('home'),
  toggle: (id, on) => call('toggle', id, on),
  install: id => call('install', id),
  installZip: () => call('install-zip'),
  uninstall: id => call('uninstall', id),
  openPanel: id => call('open-panel', id),
  openUrl: url => call('open-url', url),
  interest: (id, on) => call('interest', id, on),
  refresh: () => call('refresh'),
  visitedStore: () => call('visited-store'),
  onChanged: f => ipcRenderer.on('app:changed', () => f())
});
