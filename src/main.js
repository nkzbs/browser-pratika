const { app, BaseWindow, BrowserWindow, WebContentsView, ipcMain, webFrameMain, session, Menu, Notification, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');
const { Store } = require('./store');

const MODULES_DIR = path.join(__dirname, '..', 'modules');
const PARTITION = 'persist:pratika';
const TOP_H = 84;
const PANEL_W = 440;
const START_URL = 'https://www.ilportaledeltrasporto.it/';
const PRELOAD = path.join(__dirname, 'shim-preload.js');

if (process.env.PRATIKA_NO_SANDBOX) app.commandLine.appendSwitch('no-sandbox');

// Siti come WhatsApp Web rifiutano i browser che si dichiarano "Electron"
app.userAgentFallback = app.userAgentFallback.replace(/\s?(Electron|pratika-browser)\/\S+/g, '');

// una sola istanza: due app sullo stesso archivio si sovrascriverebbero i dati
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

// ---------- match pattern -> regex ----------
const esc = s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
const patRx = p => {
  if (p === '<all_urls>') return /^https?:\/\//;
  const m = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(p);
  if (!m) return null;
  const host = m[2] === '*' ? '[^/]+' : m[2].startsWith('*.') ? '(?:[^/]+\\.)?' + esc(m[2].slice(2)) : esc(m[2]);
  const scheme = m[1] === '*' ? 'https?' : m[1];
  return new RegExp('^' + scheme + ':\\/\\/' + host + esc(m[3]).replace(/\*/g, '.*') + '$');
};
const urlMatches = (rxs, url) => rxs.some(r => r.test(url));

// ---------- moduli ----------
const mimeIcon = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');

function loadModules() {
  if (!fs.existsSync(MODULES_DIR)) return [];
  return fs.readdirSync(MODULES_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => {
    const dir = path.join(MODULES_DIR, d.name);
    const mfFile = path.join(dir, 'manifest.json');
    if (!fs.existsSync(mfFile)) return null;
    const manifest = JSON.parse(fs.readFileSync(mfFile, 'utf8'));
    const css = manifest.content_scripts || [];
    const panelRel = (manifest.side_panel && manifest.side_panel.default_path) || (manifest.action && manifest.action.default_popup) || null;
    const icons = Object.assign({}, manifest.icons, manifest.action && manifest.action.default_icon);
    const iconFile = icons['32'] || icons['48'] || icons['16'] || Object.values(icons)[0];
    return {
      id: d.name, dir, manifest,
      name: manifest.name,
      scripts: css.map(cs => ({
        rx: cs.matches.map(patRx).filter(Boolean),
        js: cs.js.map(f => fs.readFileSync(path.join(dir, f), 'utf8')),
        allFrames: !!cs.all_frames
      })),
      hostRx: [...(manifest.host_permissions || []), ...css.flatMap(c => c.matches)].map(patRx).filter(Boolean),
      panelUrl: panelRel ? pathToFileURL(path.join(dir, panelRel)).href : null,
      optionsUrl: manifest.options_page ? pathToFileURL(path.join(dir, manifest.options_page)).href : null,
      icon: iconFile ? mimeIcon(path.join(dir, iconFile)) : null,
      icon128: manifest.icons && manifest.icons['128'] ? path.join(dir, manifest.icons['128']) : null,
      shortcut: manifest.commands && manifest.commands._execute_action && manifest.commands._execute_action.suggested_key
        ? manifest.commands._execute_action.suggested_key.default : null,
      badge: { text: '', color: '#d93025' },
      stores: {}, panelView: null, bg: null, alarms: new Map()
    };
  }).filter(Boolean);
}
const ORDINE = ['pratika-iuv', 'autofranciacorta', 'pratika-fascicolo', 'pratika-scadenzario', 'pratika-preventivo', 'pratika-registro'];
const modules = loadModules().sort((a, b) => {
  const ia = ORDINE.indexOf(a.id), ib = ORDINE.indexOf(b.id);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.id.localeCompare(b.id);
});
const modOf = id => modules.find(m => m.id === id);
const moduleForUrl = url => {
  if (url.startsWith('file:')) {
    try {
      const rel = path.relative(MODULES_DIR, fileURLToPath(url));
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep)[0];
    } catch (e) { /* url non valido */ }
    return null;
  }
  const m = modules.find(m => urlMatches(m.hostRx, url));
  return m ? m.id : null;
};

// ---------- stato ----------
let win, uiView;
let tabs = []; // { id, view }
let activeId = null;
let activePanel = null; // id del modulo il cui pannello è aperto
const ctxs = new Map();      // modulo -> Set<WebFrameMain> con `chrome` attivo
const rtTargets = new Map(); // modulo -> Set<WebFrameMain> con un listener runtime.onMessage
const set = (map, k) => { if (!map.has(k)) map.set(k, new Set()); return map.get(k); };

function emit(M, name, args) {
  for (const f of [...set(ctxs, M)]) {
    try { f.send('chrome:event', M, name, args); } catch (e) { ctxs.get(M).delete(f); }
  }
}

function storeOf(M, area) {
  const m = modOf(M);
  if (!m.stores[area]) {
    const file = area === 'session' ? null : path.join(app.getPath('userData'), 'storage', `${M}-${area}.json`);
    m.stores[area] = new Store(file, ch => emit(M, 'storage.onChanged', [ch, area]));
  }
  return m.stores[area];
}

// ---------- layout ----------
function layout() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  const pw = activePanel ? PANEL_W : 0;
  uiView.setBounds({ x: 0, y: 0, width, height: TOP_H });
  modules.forEach(m => { if (m.panelView) m.panelView.setVisible(m.id === activePanel); });
  const pv = activePanel && modOf(activePanel).panelView;
  if (pv) pv.setBounds({ x: width - pw, y: TOP_H, width: pw, height: height - TOP_H });
  const t = tabs.find(t => t.id === activeId);
  tabs.forEach(x => x.view.setVisible(x === t));
  if (t) t.view.setBounds({ x: 0, y: TOP_H, width: width - pw, height: height - TOP_H });
}

function ensurePanel(m) {
  if (m.panelView || !m.panelUrl) return;
  m.panelView = new WebContentsView({ webPreferences: { preload: PRELOAD, contextIsolation: false, sandbox: false, backgroundThrottling: false } });
  win.contentView.addChildView(m.panelView);
  m.panelView.webContents.loadURL(m.panelUrl);
}
function openPanel(id) {
  const m = modOf(id);
  if (!m || !m.panelUrl) return;
  ensurePanel(m);
  activePanel = activePanel === id ? null : id;
  layout();
  pushTabs();
}
function closePanel() { activePanel = null; layout(); pushTabs(); }

function tabInfo(t) {
  const wc = t.view.webContents;
  return { id: t.id, title: wc.getTitle() || wc.getURL() || 'Nuova scheda', url: wc.getURL(), active: t.id === activeId, loading: wc.isLoading() };
}
function pushTabs() {
  if (!uiView || uiView.webContents.isDestroyed()) return;
  const t = tabs.find(t => t.id === activeId);
  uiView.webContents.send('tabs', {
    tabs: tabs.map(tabInfo),
    canBack: t ? t.view.webContents.navigationHistory.canGoBack() : false,
    canFwd: t ? t.view.webContents.navigationHistory.canGoForward() : false,
    modules: modules.filter(m => m.panelUrl).map(m => ({ id: m.id, name: m.name, icon: m.icon, badge: m.badge, active: m.id === activePanel }))
  });
}

function normalizeUrl(s) {
  s = (s || '').trim();
  if (!s) return 'about:blank';
  if (/^[a-z]+:\/\//i.test(s) || /^about:/i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s) || /^localhost(:\d+)?/.test(s)) return 'http' + (/^localhost/.test(s) ? '' : 's') + '://' + s;
  return 'https://www.google.com/search?q=' + encodeURIComponent(s);
}

// ---------- schede ----------
function injectContentScripts(frame) {
  if (!frame) return;
  let url;
  try { url = frame.url; } catch (e) { return; }
  const isMain = !frame.parent;
  for (const m of modules) {
    for (const cs of m.scripts) {
      if (!urlMatches(cs.rx, url)) continue;
      if (!isMain && !cs.allFrames) continue;
      cs.js.forEach(code => frame.executeJavaScript(code).catch(() => {}));
    }
  }
}

const toChromeTab = t => {
  const wc = t.view.webContents;
  return { id: t.id, windowId: 1, active: t.id === activeId, pinned: false, url: wc.getURL(), title: wc.getTitle(), status: wc.isLoading() ? 'loading' : 'complete' };
};

function addTab(url, activate = true) {
  const view = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      preload: PRELOAD,
      contextIsolation: false, // i content script condividono il mondo JS della pagina, come window.PratikaExtract
      sandbox: false,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: true,
      backgroundThrottling: false
    }
  });
  const wc = view.webContents;
  const t = { id: wc.id, view };
  tabs.push(t);
  win.contentView.addChildView(view);

  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) setImmediate(() => addTab(url));
    return { action: 'deny' };
  });
  wc.on('did-frame-finish-load', (_e, _isMain, pid, rid) => injectContentScripts(webFrameMain.fromId(pid, rid)));
  ['page-title-updated', 'did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading'].forEach(ev => wc.on(ev, pushTabs));
  wc.on('did-finish-load', () => modules.forEach(m => emit(m.id, 'tabs.onUpdated', [t.id, { status: 'complete' }, toChromeTab(t)])));

  if (activate || !activeId) activeId = t.id;
  wc.loadURL(normalizeUrl(url));
  layout();
  pushTabs();
  return t;
}

function closeTab(id) {
  const i = tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  const [t] = tabs.splice(i, 1);
  win.contentView.removeChildView(t.view);
  t.view.webContents.close();
  modules.forEach(m => emit(m.id, 'tabs.onRemoved', [id, { windowId: 1, isWindowClosing: false }]));
  if (!tabs.length) { addTab(START_URL); return; }
  if (activeId === id) activeId = tabs[Math.min(i, tabs.length - 1)].id;
  layout();
  pushTabs();
}

function activate(id) {
  if (!tabs.some(t => t.id === id)) return false;
  activeId = id;
  layout();
  pushTabs();
  return true;
}

// ---------- IPC: interfaccia browser ----------
const activeTab = () => tabs.find(t => t.id === activeId);
ipcMain.on('ui:new-tab', (_e, url) => addTab(url || START_URL));
ipcMain.on('ui:close-tab', (_e, id) => closeTab(id));
ipcMain.on('ui:activate', (_e, id) => activate(id));
ipcMain.on('ui:navigate', (_e, url) => activeTab()?.view.webContents.loadURL(normalizeUrl(url)));
ipcMain.on('ui:back', () => activeTab()?.view.webContents.navigationHistory.goBack());
ipcMain.on('ui:forward', () => activeTab()?.view.webContents.navigationHistory.goForward());
ipcMain.on('ui:reload', () => activeTab()?.view.webContents.reload());
ipcMain.on('ui:module', (_e, id) => openPanel(id));
ipcMain.on('ui:ready', pushTabs);

// ---------- IPC: API chrome.* ----------
ipcMain.on('chrome:module-of-url', (e, url) => { e.returnValue = moduleForUrl(url); });
ipcMain.on('chrome:module-url', (e, M, p) => { e.returnValue = pathToFileURL(path.join(modOf(M).dir, p)).href; });
ipcMain.on('chrome:module-manifest', (e, M) => { e.returnValue = modOf(M).manifest; });
ipcMain.on('chrome:ctx', (e, M) => { if (modOf(M) && e.senderFrame) set(ctxs, M).add(e.senderFrame); });
ipcMain.on('chrome:rt:register', (e, M) => { if (modOf(M) && e.senderFrame) set(rtTargets, M).add(e.senderFrame); });

ipcMain.on('chrome:window-close', e => {
  const m = modules.find(m => m.panelView && m.panelView.webContents === e.sender);
  if (m) { closePanel(); return; }
  const t = tabs.find(t => t.view.webContents === e.sender);
  if (t) closeTab(t.id);
});

ipcMain.handle('chrome:storage:get', (_e, M, a, k) => storeOf(M, a).get(k));
ipcMain.handle('chrome:storage:set', (_e, M, a, o) => storeOf(M, a).set(o));
ipcMain.handle('chrome:storage:remove', (_e, M, a, k) => storeOf(M, a).remove(k));
ipcMain.handle('chrome:storage:clear', (_e, M, a) => storeOf(M, a).clear());

// messaggi tra le parti di uno stesso modulo (pannello, background, content script)
const pending = new Map();
let seq = 0;
function deliver(targetM, e, fromM, msg) {
  return new Promise(resolve => {
    const targets = [...set(rtTargets, targetM)].filter(f => f !== e.senderFrame);
    if (!targets.length) return resolve(undefined);
    const tab = tabs.find(t => t.view.webContents === e.sender);
    const sender = { id: fromM, url: e.senderFrame ? e.senderFrame.url : '', frameId: e.senderFrame ? e.senderFrame.routingId : 0, tab: tab ? toChromeTab(tab) : undefined };
    const reqId = ++seq;
    const entry = { resolve, left: targets.length, timer: setTimeout(() => { if (pending.delete(reqId)) resolve(undefined); }, 60000) };
    pending.set(reqId, entry);
    const done = () => { if (--entry.left <= 0 && pending.delete(reqId)) { clearTimeout(entry.timer); resolve(undefined); } };
    targets.forEach(f => { try { f.send('chrome:rt:deliver', targetM, reqId, msg, sender); } catch (err) { rtTargets.get(targetM).delete(f); done(); } });
  });
}
ipcMain.handle('chrome:runtime:send', (e, M, msg) => deliver(M, e, M, msg));
ipcMain.on('chrome:rt:response', (_e, reqId, handled, resp) => {
  const p = pending.get(reqId);
  if (!p) return;
  if (handled) { pending.delete(reqId); clearTimeout(p.timer); p.resolve(resp); }
  else if (--p.left <= 0) { pending.delete(reqId); clearTimeout(p.timer); p.resolve(undefined); }
});

// ---------- piattaforma: dati condivisi e comunicazione tra moduli (con permessi nel manifest) ----------
// "pratika_permissions": ["shared", "send:<modulo>", "read:<modulo>"]
const can = (M, perm) => (modOf(M).manifest.pratika_permissions || []).includes(perm);
const need = (M, perm) => { if (!can(M, perm)) throw new Error(`Il modulo ${M} non ha il permesso "${perm}"`); };
let sharedStore;
const shared = () => sharedStore || (sharedStore = new Store(path.join(app.getPath('userData'), 'storage', 'shared.json'),
  ch => modules.forEach(m => emit(m.id, 'pratika.sharedChanged', [ch]))));
ipcMain.handle('pratika:shared:get', (_e, M, k) => { need(M, 'shared'); return shared().get(k); });
ipcMain.handle('pratika:shared:set', (_e, M, o) => { need(M, 'shared'); return shared().set(o); });
ipcMain.handle('pratika:shared:remove', (_e, M, k) => { need(M, 'shared'); return shared().remove(k); });
ipcMain.handle('pratika:send', (e, M, target, msg) => { need(M, 'send:' + target); if (!modOf(target)) throw new Error('Modulo non trovato: ' + target); return deliver(target, e, M, msg); });
ipcMain.handle('pratika:read', (_e, M, target, area, k) => { need(M, 'read:' + target); if (!modOf(target)) throw new Error('Modulo non trovato: ' + target); return storeOf(target, area).get(k); });

ipcMain.handle('chrome:runtime:options', (_e, M) => { const m = modOf(M); if (m.optionsUrl) addTab(m.optionsUrl); });
ipcMain.handle('chrome:windows:focus', () => { win.focus(); });

ipcMain.handle('chrome:tabs:query', (_e, _M, q) => {
  let list = tabs.map(toChromeTab);
  if (q.active) list = list.filter(t => t.active);
  if (q.url) {
    const rxs = [].concat(q.url).map(patRx).filter(Boolean);
    list = list.filter(t => urlMatches(rxs, t.url));
  }
  return list;
});
ipcMain.handle('chrome:tabs:get', (_e, _M, id) => {
  const t = tabs.find(t => t.id === id);
  if (!t) throw new Error('No tab with id: ' + id);
  return toChromeTab(t);
});
ipcMain.handle('chrome:tabs:create', (_e, _M, p) => toChromeTab(addTab(p.url || 'about:blank', p.active !== false)));
ipcMain.handle('chrome:tabs:update', (_e, _M, id, p) => {
  const t = tabs.find(t => t.id === id);
  if (!t) throw new Error('No tab with id: ' + id);
  if (p && p.url) t.view.webContents.loadURL(normalizeUrl(p.url));
  if (p && p.active) activate(id);
  return toChromeTab(t);
});

ipcMain.handle('chrome:scripting', async (_e, M, { target, files, func, args }) => {
  const t = tabs.find(t => t.id === target.tabId);
  if (!t) throw new Error('Scheda non trovata');
  const frames = target.allFrames ? t.view.webContents.mainFrame.framesInSubtree : [t.view.webContents.mainFrame];
  const code = files
    ? files.map(f => fs.readFileSync(path.join(modOf(M).dir, f), 'utf8')).join('\n')
    : `(${func})(...${JSON.stringify(args)})`;
  const out = [];
  for (const fr of frames) {
    let result = null;
    try { result = await fr.executeJavaScript(code); } catch (err) { result = null; }
    out.push({ frameId: fr.routingId, result: result === undefined ? null : result });
  }
  return out;
});

// notifiche di sistema
const notes = new Map();
ipcMain.handle('chrome:notifications:create', (_e, M, id, o) => {
  const m = modOf(M);
  id = id || 'n' + Date.now();
  const n = new Notification({ title: o.title || m.name, body: o.message || '', icon: m.icon128 ? nativeImage.createFromPath(m.icon128) : undefined, urgency: o.priority > 0 ? 'critical' : 'normal' });
  n.on('click', () => emit(M, 'notifications.onClicked', [id]));
  notes.set(M + ':' + id, n);
  n.show();
  return id;
});
ipcMain.handle('chrome:notifications:clear', (_e, M, id) => {
  const n = notes.get(M + ':' + id);
  if (n) { n.close(); notes.delete(M + ':' + id); }
  return !!n;
});

// allarmi
ipcMain.handle('chrome:alarms:create', (_e, M, name, info) => {
  const m = modOf(M);
  clearAlarm(m, name);
  const period = info.periodInMinutes ? info.periodInMinutes * 60000 : 0;
  const delay = info.delayInMinutes != null ? info.delayInMinutes * 60000 : info.when ? Math.max(0, info.when - Date.now()) : period;
  const fire = () => emit(M, 'alarms.onAlarm', [{ name, scheduledTime: Date.now() }]);
  const first = setTimeout(() => { fire(); if (period) m.alarms.set(name, setInterval(fire, period)); else m.alarms.delete(name); }, delay);
  m.alarms.set(name, first);
});
function clearAlarm(m, name) {
  const h = m.alarms.get(name);
  if (!h) return false;
  clearTimeout(h); clearInterval(h); m.alarms.delete(name);
  return true;
}
ipcMain.handle('chrome:alarms:clear', (_e, M, name) => clearAlarm(modOf(M), name));

// badge sul pulsante del modulo
ipcMain.handle('chrome:action:badge', (_e, M, d) => {
  const m = modOf(M);
  if (d.text !== undefined) m.badge.text = d.text;
  if (d.color) m.badge.color = Array.isArray(d.color) ? `rgb(${d.color.slice(0, 3).join(',')})` : d.color;
  pushTabs();
});

// ---------- background dei moduli ----------
function startBackground(m) {
  const sw = m.manifest.background && m.manifest.background.service_worker;
  if (!sw) return;
  const w = new BrowserWindow({
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: false, sandbox: false, backgroundThrottling: false, additionalArguments: ['--module-id=' + m.id] }
  });
  m.bg = w;
  if (process.env.PRATIKA_DEBUG) w.webContents.on('console-message', (_e, level, msg) => console.log(`[${m.id}]`, msg));
  w.webContents.once('did-finish-load', () => emit(m.id, 'runtime.onStartup', []));
  w.loadFile(path.join(__dirname, 'bg-host.html'), { query: { src: pathToFileURL(path.join(m.dir, sw)).href } });
}

// ---------- menu e scorciatoie ----------
function buildMenu() {
  const wc = () => activeTab()?.view.webContents;
  const cycle = d => { const i = tabs.findIndex(t => t.id === activeId); if (tabs.length) activate(tabs[(i + d + tabs.length) % tabs.length].id); };
  const moduleItems = modules.filter(m => m.panelUrl).map((m, i) => ({
    label: 'Pannello: ' + m.name,
    accelerator: m.shortcut ? m.shortcut.replace(/Ctrl/g, 'CmdOrCtrl') : `CmdOrCtrl+${i + 1}`,
    click: () => openPanel(m.id)
  }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Browser', submenu: [
      { label: 'Nuova scheda', accelerator: 'CmdOrCtrl+T', click: () => addTab(START_URL) },
      { label: 'Chiudi scheda', accelerator: 'CmdOrCtrl+W', click: () => activeId && closeTab(activeId) },
      { label: 'Scheda successiva', accelerator: 'Ctrl+Tab', click: () => cycle(1) },
      { label: 'Scheda precedente', accelerator: 'Ctrl+Shift+Tab', click: () => cycle(-1) },
      { label: 'Barra indirizzi', accelerator: 'CmdOrCtrl+L', click: () => { uiView.webContents.focus(); uiView.webContents.send('focus-url'); } },
      { label: 'Ricarica', accelerator: 'F5', click: () => wc()?.reload() },
      { label: 'Ricarica (Ctrl+R)', accelerator: 'CmdOrCtrl+R', visible: false, click: () => wc()?.reload() },
      { label: 'Indietro', accelerator: 'Alt+Left', click: () => wc()?.navigationHistory.goBack() },
      { label: 'Avanti', accelerator: 'Alt+Right', click: () => wc()?.navigationHistory.goForward() },
      ...moduleItems,
      { label: 'Nascondi pannello', accelerator: 'CmdOrCtrl+B', click: () => closePanel() },
      { type: 'separator' },
      { label: 'Esci', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
    ] },
    { role: 'editMenu' },
    { label: 'Vista', submenu: [
      { label: 'Zoom +', accelerator: 'CmdOrCtrl+=', click: () => { const w = wc(); if (w) w.setZoomLevel(w.getZoomLevel() + 0.5); } },
      { label: 'Zoom -', accelerator: 'CmdOrCtrl+-', click: () => { const w = wc(); if (w) w.setZoomLevel(w.getZoomLevel() - 0.5); } },
      { label: 'Zoom 100%', accelerator: 'CmdOrCtrl+0', click: () => wc()?.setZoomLevel(0) },
      { type: 'separator' },
      { label: 'Strumenti sviluppatore (pagina)', accelerator: 'F12', click: () => wc()?.openDevTools({ mode: 'detach' }) },
      { label: 'Strumenti sviluppatore (pannello)', accelerator: 'CmdOrCtrl+Shift+I', click: () => { const m = activePanel && modOf(activePanel); if (m && m.panelView) m.panelView.webContents.openDevTools({ mode: 'detach' }); } }
    ] }
  ]));
  win.setMenuBarVisibility(false); // le scorciatoie restano attive, Alt mostra la barra
}

// ---------- avvio ----------
app.whenReady().then(() => {
  session.fromPartition(PARTITION).setPermissionRequestHandler((wc, perm, cb) => cb(['clipboard-sanitized-write', 'notifications'].includes(perm)));

  const stateFile = path.join(app.getPath('userData'), 'window-state.json');
  let state = { width: 1400, height: 900 };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch (e) { /* primo avvio */ }
  win = new BaseWindow({ width: state.width, height: state.height, x: state.x, y: state.y, title: 'PRATIKA Browser' });
  if (state.maximized) win.maximize();
  win.on('close', () => {
    const b = win.getNormalBounds();
    try { fs.writeFileSync(stateFile, JSON.stringify({ ...b, maximized: win.isMaximized() })); } catch (e) { /* non critico */ }
    modules.forEach(m => Object.values(m.stores).forEach(s => s.writeNow()));
    if (sharedStore) sharedStore.writeNow();
  });
  buildMenu();

  uiView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'ui', 'ui-preload.js') } });
  win.contentView.addChildView(uiView);
  uiView.webContents.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.on('resize', layout);
  win.on('closed', () => app.quit());

  modules.forEach(startBackground);
  const first = modules.find(m => m.panelUrl);
  addTab(process.env.PRATIKA_START_URL || START_URL);
  if (first) openPanel(first.id);
  layout();

  // solo per prove: PRATIKA_EVAL="<idModulo>|<codice>" esegue codice nel pannello del modulo dopo 4 s
  if (process.env.PRATIKA_EVAL) {
    const [id, ...code] = process.env.PRATIKA_EVAL.split('|');
    setTimeout(() => { const m = modOf(id); ensurePanel(m); m.panelView.webContents.executeJavaScript(code.join('|')).then(r => console.log('EVAL', JSON.stringify(r)), e => console.log('EVAL-ERR', e.message)); }, 4000);
    if (process.env.PRATIKA_EVAL_UI) setTimeout(() => uiView.webContents.executeJavaScript(process.env.PRATIKA_EVAL_UI).then(r => console.log('EVALUI', JSON.stringify(r))), 7000);
  }
});

app.on('window-all-closed', () => app.quit());
