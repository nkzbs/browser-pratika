const { app, BaseWindow, WebContentsView, ipcMain, webFrameMain, session, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { Store } = require('./store');
const { startBackground } = require('./background-host');

const EXT_DIR = path.join(__dirname, '..', 'extension', 'pratika-iuv');
const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'));
const PARTITION = 'persist:pratika';
const TOP_H = 84;
const PANEL_W = 400;
const START_URL = 'https://www.ilportaledeltrasporto.it/';

if (process.env.PRATIKA_NO_SANDBOX) app.commandLine.appendSwitch('no-sandbox');

// una sola istanza: due app sullo stesso archivio si sovrascriverebbero i dati
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

// ---------- match pattern -> regex ----------
const patRx = p => {
  const m = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(p);
  if (!m) return null;
  const host = m[2] === '*' ? '[^/]+' : m[2].startsWith('*.') ? '(?:[^/]+\\.)?' + esc(m[2].slice(2)) : esc(m[2]);
  const scheme = m[1] === '*' ? 'https?' : m[1];
  return new RegExp('^' + scheme + ':\\/\\/' + host + esc(m[3]).replace(/\\\*/g, '.*') + '$');
};
const esc = s => s.replace(/[.+?^${}()|[\]\\*]/g, '\\$&').replace(/\\\*/g, '*');
const scripts = manifest.content_scripts.map(cs => ({
  rx: cs.matches.map(patRx).filter(Boolean),
  js: cs.js.map(f => fs.readFileSync(path.join(EXT_DIR, f), 'utf8')),
  allFrames: !!cs.all_frames
}));
const allHostRx = [...manifest.host_permissions, ...manifest.content_scripts.flatMap(c => c.matches)].map(patRx).filter(Boolean);
const urlMatches = (rxs, url) => rxs.some(r => r.test(url));

// ---------- stato ----------
let win, uiView, panelView, store, dispatch;
let tabs = []; // { id, view }
let activeId = null;
let panelOpen = true;
const shimWCs = new Set();

const broadcast = (ch, payload) => shimWCs.forEach(wc => { if (!wc.isDestroyed()) wc.send(ch, payload); });

function layout() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  const pw = panelOpen ? PANEL_W : 0;
  uiView.setBounds({ x: 0, y: 0, width, height: TOP_H });
  panelView.setVisible(panelOpen);
  panelView.setBounds({ x: width - pw, y: TOP_H, width: pw, height: height - TOP_H });
  const t = tabs.find(t => t.id === activeId);
  tabs.forEach(x => x.view.setVisible(x === t));
  if (t) t.view.setBounds({ x: 0, y: TOP_H, width: width - pw, height: height - TOP_H });
}

function tabInfo(t) {
  const wc = t.view.webContents;
  return { id: t.id, title: wc.getTitle() || wc.getURL() || 'Nuova scheda', url: wc.getURL(), active: t.id === activeId, loading: wc.isLoading() };
}
function pushTabs() {
  if (uiView.webContents.isDestroyed()) return;
  const t = tabs.find(t => t.id === activeId);
  uiView.webContents.send('tabs', {
    tabs: tabs.map(tabInfo),
    canBack: t ? t.view.webContents.navigationHistory.canGoBack() : false,
    canFwd: t ? t.view.webContents.navigationHistory.canGoForward() : false,
    panelOpen
  });
}

function normalizeUrl(s) {
  s = (s || '').trim();
  if (!s) return 'about:blank';
  if (/^[a-z]+:\/\//i.test(s) || /^about:/i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s) || /^localhost(:\d+)?/.test(s)) return 'http' + (/^localhost/.test(s) ? '' : 's') + '://' + s;
  return 'https://www.google.com/search?q=' + encodeURIComponent(s);
}

function injectContentScripts(frame) {
  if (!frame || frame.isDestroyed?.()) return;
  const url = frame.url;
  const isMain = !frame.parent;
  for (const cs of scripts) {
    if (!urlMatches(cs.rx, url)) continue;
    if (!isMain && !cs.allFrames) continue;
    cs.js.forEach(code => frame.executeJavaScript(code).catch(() => {}));
  }
}

function addTab(url) {
  const view = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'shim-preload.js'),
      contextIsolation: false, // i content script condividono il mondo JS della pagina, come window.PratikaExtract
      sandbox: false,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: true
    }
  });
  const wc = view.webContents;
  const t = { id: wc.id, view };
  tabs.push(t);
  shimWCs.add(wc);
  win.contentView.addChildView(view);

  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) setImmediate(() => addTab(url));
    return { action: 'deny' };
  });
  wc.on('did-frame-finish-load', (_e, _isMain, pid, rid) => injectContentScripts(webFrameMain.fromId(pid, rid)));
  ['page-title-updated', 'did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading'].forEach(ev => wc.on(ev, pushTabs));
  wc.on('destroyed', () => shimWCs.delete(wc));

  activeId = t.id;
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
ipcMain.on('ui:toggle-panel', () => { panelOpen = !panelOpen; layout(); pushTabs(); });
ipcMain.on('ui:ready', pushTabs);

// ---------- IPC: API chrome.* ----------
ipcMain.on('chrome:is-ext-page', (e, url) => { e.returnValue = urlMatches(allHostRx, url); });
ipcMain.handle('chrome:storage:get', (_e, k) => store.get(k));
ipcMain.handle('chrome:storage:set', (_e, o) => store.set(o));
ipcMain.handle('chrome:runtime:send', (e, msg) => dispatch(msg, { tab: { id: e.sender.id, url: e.sender.getURL() } }));
ipcMain.handle('chrome:windows:focus', () => { win.focus(); });

const toChromeTab = t => {
  const wc = t.view.webContents;
  return { id: t.id, windowId: 1, active: t.id === activeId, url: wc.getURL(), title: wc.getTitle() };
};
ipcMain.handle('chrome:tabs:query', (_e, q) => {
  let list = tabs.map(toChromeTab);
  if (q.active) list = list.filter(t => t.active);
  if (q.url) {
    const rxs = [].concat(q.url).map(patRx).filter(Boolean);
    list = list.filter(t => urlMatches(rxs, t.url));
  }
  return list;
});
ipcMain.handle('chrome:tabs:update', (_e, id, p) => {
  if (p && p.active) activate(id);
  const t = tabs.find(t => t.id === id);
  if (p && p.url && t) t.view.webContents.loadURL(p.url);
  return t ? toChromeTab(t) : null;
});

ipcMain.handle('chrome:scripting', async (_e, { target, files, func, args }) => {
  const t = tabs.find(t => t.id === target.tabId);
  if (!t) throw new Error('Scheda non trovata');
  const frames = target.allFrames ? t.view.webContents.mainFrame.framesInSubtree : [t.view.webContents.mainFrame];
  const code = files
    ? files.map(f => fs.readFileSync(path.join(EXT_DIR, f), 'utf8')).join('\n')
    : `(${func})(...${JSON.stringify(args)})`;
  const out = [];
  for (const fr of frames) {
    let result = null;
    try { result = await fr.executeJavaScript(code); } catch (err) { if (func) result = null; }
    out.push({ frameId: fr.routingId, result: result === undefined ? null : result });
  }
  return out;
});

// ---------- menu e scorciatoie ----------
function buildMenu() {
  const wc = () => activeTab()?.view.webContents;
  const cycle = d => { const i = tabs.findIndex(t => t.id === activeId); if (tabs.length) activate(tabs[(i + d + tabs.length) % tabs.length].id); };
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
      { label: 'Mostra/nascondi pannello IUV', accelerator: 'CmdOrCtrl+B', click: () => { panelOpen = !panelOpen; layout(); pushTabs(); } },
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
      { label: 'Strumenti sviluppatore (pannello IUV)', accelerator: 'CmdOrCtrl+Shift+I', click: () => panelView.webContents.openDevTools({ mode: 'detach' }) }
    ] }
  ]));
  win.setMenuBarVisibility(false); // le scorciatoie restano attive, Alt mostra la barra
}

// ---------- avvio ----------
app.whenReady().then(() => {
  store = new Store(path.join(app.getPath('userData'), 'extension-storage.json'), ch => broadcast('chrome:storage:changed', ch));
  dispatch = startBackground(EXT_DIR, { get: k => store.get(k), set: o => store.set(o) });

  session.fromPartition(PARTITION).setPermissionRequestHandler((wc, perm, cb) => cb(['clipboard-sanitized-write', 'notifications'].includes(perm)));

  const stateFile = path.join(app.getPath('userData'), 'window-state.json');
  let state = { width: 1400, height: 900 };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch (e) { /* primo avvio */ }
  win = new BaseWindow({ width: state.width, height: state.height, x: state.x, y: state.y, title: 'PRATIKA Browser' });
  if (state.maximized) win.maximize();
  win.on('close', () => {
    const b = win.getNormalBounds();
    try { fs.writeFileSync(stateFile, JSON.stringify({ ...b, maximized: win.isMaximized() })); } catch (e) { /* non critico */ }
  });
  buildMenu();
  uiView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'ui', 'ui-preload.js') } });
  panelView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'shim-preload.js'), contextIsolation: false, sandbox: false }
  });
  win.contentView.addChildView(uiView);
  win.contentView.addChildView(panelView);
  shimWCs.add(panelView.webContents);
  uiView.webContents.loadFile(path.join(__dirname, 'ui', 'index.html'));
  panelView.webContents.loadFile(path.join(EXT_DIR, 'sidepanel.html'));
  win.on('resize', layout);
  win.on('closed', () => app.quit());

  addTab(process.env.PRATIKA_START_URL || START_URL);
  layout();

  if (process.env.PRATIKA_DEBUG_PORT) global.__dbg = { tabs: () => tabs, panelView: () => panelView };
});

app.on('window-all-closed', () => app.quit());
