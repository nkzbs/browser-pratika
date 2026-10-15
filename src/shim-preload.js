// Espone un sottoinsieme di `chrome.*` (storage, runtime, tabs, scripting, permissions)
// alle pagine dell'estensione (pannello) e alle pagine su cui girano i content script.
const { ipcRenderer } = require('electron');

const allowed = location.protocol === 'file:' || ipcRenderer.sendSync('chrome:is-ext-page', location.href);
if (allowed) {
  const inv = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
  const changed = [];
  ipcRenderer.on('chrome:storage:changed', (_e, ch) => changed.forEach(f => { try { f(ch, 'local'); } catch (e) { /* listener */ } }));

  window.chrome = {
    runtime: {
      id: 'pratika-iuv-embedded',
      sendMessage: msg => inv('chrome:runtime:send', msg),
      onMessage: { addListener() {} }
    },
    storage: {
      local: { get: k => inv('chrome:storage:get', k), set: o => inv('chrome:storage:set', o) },
      onChanged: { addListener: f => changed.push(f) }
    },
    tabs: {
      query: q => inv('chrome:tabs:query', q || {}),
      update: (id, p) => inv('chrome:tabs:update', id, p)
    },
    windows: { update: () => inv('chrome:windows:focus') },
    permissions: { contains: async () => true, request: async () => true },
    scripting: {
      executeScript: ({ target, files, func, args }) =>
        inv('chrome:scripting', { target, files, func: func ? func.toString() : null, args: args || [] })
    }
  };
}
