// Espone un sottoinsieme di `chrome.*` ai moduli: alle loro pagine (pannello, opzioni, background)
// e alle pagine su cui girano i loro content script. Ogni modulo ha il proprio `chrome`.
const { ipcRenderer } = require('electron');

const cache = {};

function makeChrome(M) {
  if (cache[M]) return cache[M];
  const inv = (ch, ...a) => ipcRenderer.invoke(ch, M, ...a);
  const cb = (p, f) => (typeof f === 'function' ? p.then(f) : p);
  const listeners = {};
  const ev = name => ({
    addListener: f => {
      (listeners[name] = listeners[name] || []).push(f);
      if (name === 'runtime.onMessage') ipcRenderer.send('chrome:rt:register', M);
    },
    removeListener: f => { listeners[name] = (listeners[name] || []).filter(x => x !== f); },
    hasListener: f => (listeners[name] || []).includes(f)
  });
  const area = a => ({
    get: (k, f) => cb(inv('chrome:storage:get', a, k), f),
    set: (o, f) => cb(inv('chrome:storage:set', a, o), f),
    remove: (k, f) => cb(inv('chrome:storage:remove', a, k), f),
    clear: f => cb(inv('chrome:storage:clear', a), f)
  });

  ipcRenderer.send('chrome:ctx', M);

  ipcRenderer.on('chrome:event', (_e, m, name, args) => {
    if (m !== M) return;
    (listeners[name] || []).slice().forEach(f => { try { f(...args); } catch (e) { console.error(e); } });
  });

  ipcRenderer.on('chrome:rt:deliver', (_e, m, reqId, msg, sender) => {
    if (m !== M) return;
    let done = false;
    let wait = false;
    const respond = r => { if (!done) { done = true; ipcRenderer.send('chrome:rt:response', reqId, true, r); } };
    for (const l of (listeners['runtime.onMessage'] || []).slice()) {
      try {
        const ret = l(msg, sender, respond);
        if (ret === true) wait = true;
        else if (ret && typeof ret.then === 'function') { wait = true; ret.then(respond, () => respond(undefined)); }
      } catch (e) { console.error(e); }
    }
    if (!wait && !done) ipcRenderer.send('chrome:rt:response', reqId, false);
  });

  const api = {
    runtime: {
      id: M,
      sendMessage: (msg, f) => cb(inv('chrome:runtime:send', msg), f),
      onMessage: ev('runtime.onMessage'),
      onInstalled: ev('runtime.onInstalled'),
      onStartup: ev('runtime.onStartup'),
      openOptionsPage: () => inv('chrome:runtime:options'),
      getURL: p => ipcRenderer.sendSync('chrome:module-url', M, p),
      getManifest: () => ipcRenderer.sendSync('chrome:module-manifest', M)
    },
    storage: { local: area('local'), sync: area('sync'), session: area('session'), onChanged: ev('storage.onChanged') },
    tabs: {
      query: (q, f) => cb(inv('chrome:tabs:query', q || {}), f),
      get: (id, f) => cb(inv('chrome:tabs:get', id), f),
      create: (p, f) => cb(inv('chrome:tabs:create', p || {}), f),
      update: (id, p, f) => cb(inv('chrome:tabs:update', id, p), f),
      onRemoved: ev('tabs.onRemoved'),
      onUpdated: ev('tabs.onUpdated')
    },
    windows: { update: (_id, _p, f) => cb(inv('chrome:windows:focus'), f) },
    permissions: { contains: async () => true, request: async () => true },
    scripting: {
      executeScript: ({ target, files, func, args }) =>
        inv('chrome:scripting', { target, files, func: func ? func.toString() : null, args: args || [] })
    },
    notifications: {
      create: (id, o, f) => cb(inv('chrome:notifications:create', id, o), f),
      clear: (id, f) => cb(inv('chrome:notifications:clear', id), f),
      onClicked: ev('notifications.onClicked')
    },
    alarms: {
      create: (name, info) => inv('chrome:alarms:create', name, info || {}),
      clear: (name, f) => cb(inv('chrome:alarms:clear', name), f),
      onAlarm: ev('alarms.onAlarm')
    },
    action: {
      setBadgeText: (d, f) => cb(inv('chrome:action:badge', { text: d.text }), f),
      setBadgeBackgroundColor: (d, f) => cb(inv('chrome:action:badge', { color: d.color }), f)
    },
    sidePanel: { setPanelBehavior: () => Promise.resolve() }
  };
  cache[M] = api;
  return api;
}

const argv = process.argv.find(a => a.startsWith('--module-id='));
let moduleId = argv ? argv.slice('--module-id='.length) : null;
if (!moduleId) moduleId = ipcRenderer.sendSync('chrome:module-of-url', location.href);

if (moduleId) {
  window.chrome = makeChrome(moduleId);
  // window.close() in un pannello o in una pagina di opzioni chiude il pannello / la scheda
  if (!argv) window.close = () => ipcRenderer.send('chrome:window-close');
}
