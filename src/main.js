const { app, BaseWindow, BrowserWindow, WebContentsView, ipcMain, webFrameMain, session, Menu, Notification, nativeImage, dialog, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');
const { Store } = require('./store');
const SM = require('./store-manager');

const MODULES_DIR = path.join(__dirname, '..', 'modules'); // moduli inclusi
const userModulesDir = () => path.join(app.getPath('userData'), 'modules'); // moduli installati dallo Store
const PARTITION = 'persist:pratika';
const TOP_H = 84;
const SIDE_W = 232;
const PANEL_W = 440;
const CATALOG_URL = 'https://raw.githubusercontent.com/nkzbs/browser-pratika/master/catalog/catalog.json';
const INTERNAL_BASE = pathToFileURL(path.join(__dirname, 'pages', 'app.html')).href;
const PAGES_PRELOAD = path.join(__dirname, 'pages', 'pages-preload.js');
const ROUTES = ['home', 'store', 'installed'];
const internalUrl = r => INTERNAL_BASE + '#' + r;
const isInternal = u => typeof u === 'string' && u.startsWith(INTERNAL_BASE);
const START_URL = internalUrl('home');
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

// stato scelto dall'utente: moduli spenti, moduli "mi interessa", visita allo Store
let mstate = { disabled: [], interest: [], storeVisited: false };
const mstateFile = () => path.join(app.getPath('userData'), 'modules-state.json');
function loadMstate() { try { mstate = { ...mstate, ...JSON.parse(fs.readFileSync(mstateFile(), 'utf8')) }; } catch (e) { /* primo avvio */ } }
function saveMstate() { try { fs.mkdirSync(path.dirname(mstateFile()), { recursive: true }); fs.writeFileSync(mstateFile(), JSON.stringify(mstate)); } catch (e) { /* non critico */ } }

function readModule(dir, id, source) {
  const mfFile = path.join(dir, 'manifest.json');
  if (!fs.existsSync(mfFile)) return null;
  const manifest = JSON.parse(fs.readFileSync(mfFile, 'utf8'));
  const css = manifest.content_scripts || [];
  const panelRel = (manifest.side_panel && manifest.side_panel.default_path) || (manifest.action && manifest.action.default_popup) || null;
  const icons = Object.assign({}, manifest.icons, manifest.action && manifest.action.default_icon);
  const iconFile = icons['32'] || icons['48'] || icons['16'] || Object.values(icons)[0];
  const safe = f => { const p = path.resolve(dir, f); return p.startsWith(path.resolve(dir) + path.sep) ? p : null; };
  return {
    id, dir, manifest, source, enabled: !mstate.disabled.includes(id),
    name: manifest.name,
    scripts: css.map(cs => ({
      rx: (cs.matches || []).map(patRx).filter(Boolean),
      js: (cs.js || []).map(f => safe(f)).filter(Boolean).map(f => fs.readFileSync(f, 'utf8')),
      allFrames: !!cs.all_frames
    })),
    hostRx: [...(manifest.host_permissions || []), ...css.flatMap(c => c.matches || [])].map(patRx).filter(Boolean),
    panelUrl: panelRel && safe(panelRel) ? pathToFileURL(safe(panelRel)).href : null,
    optionsUrl: manifest.options_page && safe(manifest.options_page) ? pathToFileURL(safe(manifest.options_page)).href : null,
    icon: iconFile && safe(iconFile) && fs.existsSync(safe(iconFile)) ? mimeIcon(safe(iconFile)) : null,
    icon128: manifest.icons && manifest.icons['128'] && safe(manifest.icons['128']) ? safe(manifest.icons['128']) : null,
    shortcut: manifest.commands && manifest.commands._execute_action && manifest.commands._execute_action.suggested_key
      ? manifest.commands._execute_action.suggested_key.default : null,
    badge: { text: '', color: '#d93025' },
    stores: {}, panelView: null, bg: null, alarms: new Map()
  };
}
const ORDINE = ['pratika-iuv', 'autofranciacorta', 'pratika-fascicolo', 'pratika-scadenzario', 'pratika-preventivo', 'pratika-registro'];
const sortModules = list => list.sort((a, b) => {
  const ia = ORDINE.indexOf(a.id), ib = ORDINE.indexOf(b.id);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.id.localeCompare(b.id);
});
function scanModules() {
  const out = [];
  const bundled = new Set();
  for (const [root, source] of [[MODULES_DIR, 'bundled'], [userModulesDir(), 'user']]) {
    if (!fs.existsSync(root)) continue;
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory() || !SM.ID_RX.test(d.name)) continue;
      if (source === 'user' && bundled.has(d.name)) continue; // un modulo installato non può sostituirne uno incluso
      try { const m = readModule(path.join(root, d.name), d.name, source); if (m) { out.push(m); if (source === 'bundled') bundled.add(d.name); } }
      catch (e) { console.error('Modulo non caricabile', d.name, e.message); }
    }
  }
  return sortModules(out);
}
let modules = [];
const live = () => modules.filter(m => m.enabled);
const modOf = id => modules.find(m => m.id === id);
const moduleForUrl = url => {
  if (url.startsWith('file:')) {
    try {
      const f = fileURLToPath(url);
      for (const root of [MODULES_DIR, userModulesDir()]) {
        const rel = path.relative(root, f);
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) { const id = rel.split(path.sep)[0]; const m = modOf(id); return m && m.enabled ? id : null; }
      }
    } catch (e) { /* url non valido */ }
    return null;
  }
  const m = live().find(m => urlMatches(m.hostRx, url));
  return m ? m.id : null;
};

// ---------- stato ----------
let win, uiView, sideView;
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
  if (!m) throw new Error('Modulo non trovato: ' + M);
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
  const mainW = width - SIDE_W;
  sideView.setBounds({ x: 0, y: 0, width: SIDE_W, height });
  uiView.setBounds({ x: SIDE_W, y: 0, width: mainW, height: TOP_H });
  modules.forEach(m => { if (m.panelView) m.panelView.setVisible(m.id === activePanel); });
  const pv = activePanel && modOf(activePanel) && modOf(activePanel).panelView;
  if (pv) pv.setBounds({ x: width - pw, y: TOP_H, width: pw, height: height - TOP_H });
  const t = tabs.find(t => t.id === activeId);
  tabs.forEach(x => x.view.setVisible(x === t));
  if (t) t.view.setBounds({ x: SIDE_W, y: TOP_H, width: mainW - pw, height: height - TOP_H });
}

function ensurePanel(m) {
  if (m.panelView || !m.panelUrl) return;
  m.panelView = new WebContentsView({ webPreferences: { preload: PRELOAD, contextIsolation: false, sandbox: false, backgroundThrottling: false } });
  win.contentView.addChildView(m.panelView);
  m.panelView.webContents.loadURL(m.panelUrl);
}
function openPanel(id, force) {
  const m = modOf(id);
  if (!m || !m.enabled || !m.panelUrl) return;
  ensurePanel(m);
  activePanel = force ? id : (activePanel === id ? null : id);
  layout();
  pushTabs();
}
function closePanel() { activePanel = null; layout(); pushTabs(); }

const routeOf = url => { const h = (url.split('#')[1] || 'home'); return h; };
const friendlyUrl = url => (isInternal(url) ? 'pratika://' + routeOf(url) : url);
function tabInfo(t) {
  const wc = t.view.webContents;
  const url = wc.getURL();
  return { id: t.id, title: wc.getTitle() || friendlyUrl(url) || 'Nuova scheda', url: friendlyUrl(url), active: t.id === activeId, loading: wc.isLoading() };
}
const letterOf = m => { const c = catalogById(m.id); return (c && c.letter) || (m.name || '?').slice(0, 1).toUpperCase(); };
function sideItem(m) {
  const c = catalogById(m.id) || {};
  return { id: m.id, label: c.name || m.name, letter: String(letterOf(m)).slice(0, 4), color: /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : '#546e7a', badge: m.badge.text, active: m.id === activePanel };
}
function pushTabs() {
  if (!uiView || uiView.webContents.isDestroyed()) return;
  const t = tabs.find(t => t.id === activeId);
  uiView.webContents.send('tabs', {
    tabs: tabs.map(tabInfo),
    canBack: t ? t.view.webContents.navigationHistory.canGoBack() : false,
    canFwd: t ? t.view.webContents.navigationHistory.canGoForward() : false
  });
  if (sideView && !sideView.webContents.isDestroyed()) {
    const cur = t && isInternal(t.view.webContents.getURL()) ? routeOf(t.view.webContents.getURL()).split('/')[0] : null;
    sideView.webContents.send('state', { modules: live().filter(m => m.panelUrl).map(sideItem), route: cur });
  }
}

function normalizeUrl(s) {
  s = (s || '').trim();
  if (!s) return 'about:blank';
  const pr = /^pratika:\/\/([\w/-]+)/.exec(s);
  if (pr) return ROUTES.includes(pr[1].split('/')[0]) ? internalUrl(pr[1]) : START_URL;
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
  for (const m of live()) {
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
  url = normalizeUrl(url);
  const internal = isInternal(url);
  const view = new WebContentsView({
    webPreferences: internal ? {
      preload: PAGES_PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false
    } : {
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
  const t = { id: wc.id, view, internal };
  tabs.push(t);
  win.contentView.addChildView(view);

  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) setImmediate(() => addTab(url));
    return { action: 'deny' };
  });
  if (internal) wc.on('will-navigate', (e, u) => { if (!isInternal(u)) { e.preventDefault(); if (/^https?:/.test(u)) addTab(u); } });
  else wc.on('did-frame-finish-load', (_e, _isMain, pid, rid) => injectContentScripts(webFrameMain.fromId(pid, rid)));
  ['page-title-updated', 'did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading'].forEach(ev => wc.on(ev, pushTabs));
  wc.on('did-finish-load', () => live().forEach(m => emit(m.id, 'tabs.onUpdated', [t.id, { status: 'complete' }, toChromeTab(t)])));

  if (activate || !activeId) activeId = t.id;
  wc.loadURL(url);
  layout();
  pushTabs();
  return t;
}

// apre una pagina interna (Home, Store, Moduli installati), riusando la scheda se esiste già
function openInternal(route) {
  const base = route.split('/')[0];
  const existing = tabs.find(t => t.internal && routeOf(t.view.webContents.getURL()).split('/')[0] === base);
  if (existing) {
    if (route !== routeOf(existing.view.webContents.getURL())) existing.view.webContents.loadURL(internalUrl(route));
    activate(existing.id);
    return existing;
  }
  return addTab(internalUrl(route));
}

function closeTab(id) {
  const i = tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  const [t] = tabs.splice(i, 1);
  win.contentView.removeChildView(t.view);
  t.view.webContents.close();
  live().forEach(m => emit(m.id, 'tabs.onRemoved', [id, { windowId: 1, isWindowClosing: false }]));
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
ipcMain.on('ui:navigate', (_e, url) => {
  const target = normalizeUrl(url);
  const t = activeTab();
  if (!t || t.internal || isInternal(target)) addTab(target); else t.view.webContents.loadURL(target);
});
ipcMain.on('ui:back', () => activeTab()?.view.webContents.navigationHistory.goBack());
ipcMain.on('ui:forward', () => activeTab()?.view.webContents.navigationHistory.goForward());
ipcMain.on('ui:reload', () => activeTab()?.view.webContents.reload());
ipcMain.on('ui:ready', pushTabs);
ipcMain.on('ui:go', (_e, kind, id) => {
  if (kind === 'module') openPanel(id);
  else if (kind === 'help') addTab('https://github.com/nkzbs/browser-pratika#readme');
  else if (ROUTES.includes(kind)) openInternal(kind);
});

// ---------- IPC: API chrome.* ----------
ipcMain.on('chrome:module-of-url', (e, url) => { e.returnValue = moduleForUrl(url); });
ipcMain.on('chrome:module-url', (e, M, p) => { e.returnValue = modOf(M) ? pathToFileURL(path.join(modOf(M).dir, p)).href : null; });
ipcMain.on('chrome:module-manifest', (e, M) => { e.returnValue = modOf(M) ? modOf(M).manifest : null; });
ipcMain.on('chrome:ctx', (e, M) => { if (modOf(M) && modOf(M).enabled && e.senderFrame) set(ctxs, M).add(e.senderFrame); });
ipcMain.on('chrome:rt:register', (e, M) => { if (modOf(M) && modOf(M).enabled && e.senderFrame) set(rtTargets, M).add(e.senderFrame); });

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
const can = (M, perm) => !!modOf(M) && modOf(M).enabled && (modOf(M).manifest.pratika_permissions || []).includes(perm);
const need = (M, perm) => { if (!can(M, perm)) throw new Error(`Il modulo ${M} non ha il permesso "${perm}"`); };
let sharedStore;
const shared = () => sharedStore || (sharedStore = new Store(path.join(app.getPath('userData'), 'storage', 'shared.json'),
  ch => live().forEach(m => emit(m.id, 'pratika.sharedChanged', [ch]))));
ipcMain.handle('pratika:shared:get', (_e, M, k) => { need(M, 'shared'); return shared().get(k); });
ipcMain.handle('pratika:shared:set', (_e, M, o) => { need(M, 'shared'); return shared().set(o); });
ipcMain.handle('pratika:shared:remove', (_e, M, k) => { need(M, 'shared'); return shared().remove(k); });
ipcMain.handle('pratika:send', (e, M, target, msg) => { need(M, 'send:' + target); if (!modOf(target) || !modOf(target).enabled) throw new Error('Modulo non disponibile: ' + target); return deliver(target, e, M, msg); });
ipcMain.handle('pratika:read', (_e, M, target, area, k) => { need(M, 'read:' + target); if (!modOf(target)) throw new Error('Modulo non disponibile: ' + target); return storeOf(target, area).get(k); });

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

// ---------- gestione dei moduli, catalogo e Store ----------
let remoteCatalog = null;
let catalogError = null;
const bundledCatalog = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog.json'), 'utf8')); } catch (e) { return { modules: [] }; } };
const mergedCatalog = () => SM.mergeCatalog(bundledCatalog(), remoteCatalog);
const catalogById = id => mergedCatalog().find(c => c.id === id);
const nameOfId = id => { const c = catalogById(id); const m = modOf(id); return (c && c.name) || (m && m.name) || id; };
const str = (v, n) => String(v == null ? '' : v).slice(0, n);

function dataBytes(id) {
  let n = 0;
  for (const a of ['local', 'sync']) { try { n += fs.statSync(path.join(app.getPath('userData'), 'storage', `${id}-${a}.json`)).size; } catch (e) { /* nessun dato */ } }
  return n;
}

function catalogView(c, m) {
  const id = c ? c.id : m.id;
  const color = /^#[0-9a-f]{6}$/i.test((c && c.color) || '') ? c.color : '#546e7a';
  const status = m ? 'installed' : (c && c.status === 'download' && /^https:\/\//.test(c.url || '') ? 'download' : 'soon');
  return {
    id, name: str((c && c.name) || (m && m.name), 60), letter: str((c && c.letter) || (m && m.name || '?')[0], 4), color,
    category: str((c && c.category) || 'Altro', 30), price: str((c && c.price) || (m ? 'Installato' : ''), 30),
    description: str((c && c.description) || (m && m.manifest.description), 240), long: str((c && c.long) || (m && m.manifest.description), 800),
    status, installed: !!m, enabled: !!(m && m.enabled), source: m ? m.source : null, version: m ? str(m.manifest.version, 20) : null,
    hasPanel: !!(m && m.panelUrl), perms: m ? SM.describePermissions(m.manifest, nameOfId) : [], dataBytes: m ? dataBytes(id) : 0,
    latest: c && c.version ? str(c.version, 20) : null,
    hasUpdate: !!(m && m.source === 'user' && c && c.url && c.version && SM.cmpVersion(c.version, m.manifest.version) > 0),
    interest: mstate.interest.includes(id), featured: !!(c && c.featured)
  };
}
function catalogEntries() {
  const cat = mergedCatalog();
  const out = cat.map(c => catalogView(c, modOf(c.id)));
  modules.filter(m => !cat.some(c => c.id === m.id)).forEach(m => out.push(catalogView(null, m)));
  return out;
}

const broadcastApp = () => tabs.forEach(t => { if (t.internal && !t.view.webContents.isDestroyed()) t.view.webContents.send('app:changed'); });

function stopModule(m) {
  if (m.bg) { try { m.bg.destroy(); } catch (e) { /* già chiusa */ } m.bg = null; }
  if (m.panelView) {
    try { win.contentView.removeChildView(m.panelView); m.panelView.webContents.close(); } catch (e) { /* già chiusa */ }
    m.panelView = null;
  }
  for (const h of m.alarms.values()) { clearTimeout(h); clearInterval(h); }
  m.alarms.clear();
  ctxs.delete(m.id); rtTargets.delete(m.id);
  m.badge.text = '';
  if (activePanel === m.id) activePanel = null;
}
function afterModulesChanged() { buildMenu(); layout(); pushTabs(); broadcastApp(); }

function setEnabled(id, on) {
  const m = modOf(id);
  if (!m) throw new Error('Modulo non trovato');
  m.enabled = on;
  mstate.disabled = mstate.disabled.filter(x => x !== id);
  if (!on) mstate.disabled.push(id);
  saveMstate();
  if (on) startBackground(m); else stopModule(m);
  afterModulesChanged();
}

function uninstall(id) {
  const m = modOf(id);
  if (!m) throw new Error('Modulo non trovato');
  if (m.source !== 'user') throw new Error('I moduli inclusi nel programma si possono solo spegnere');
  stopModule(m);
  fs.rmSync(m.dir, { recursive: true, force: true }); // i dati del modulo (storage/) restano
  modules = modules.filter(x => x !== m);
  afterModulesChanged();
}

async function confirmInstall(manifest, id, fromCatalog) {
  const perms = SM.describePermissions(manifest, nameOfId);
  const { response } = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['Installa', 'Annulla'], defaultId: 1, cancelId: 1, title: 'Installa modulo',
    message: `Installare "${str(manifest.name, 60)}" (versione ${str(manifest.version, 20)})?`,
    detail: 'Questo modulo potrà:\n' + (perms.length ? perms.map(p => '• ' + p).join('\n') : '• (nessun permesso particolare)') +
      '\n\n' + (fromCatalog ? 'Installa solo moduli di cui ti fidi.' : 'ATTENZIONE: questo modulo NON proviene dal catalogo. Installalo solo se ti fidi di chi te l\'ha dato.')
  });
  return response === 0;
}

function performInstall(info) {
  const { id, files, manifest } = info;
  const existing = modOf(id);
  if (existing && existing.source === 'bundled') throw new Error('L\'identificativo "' + id + '" è riservato a un modulo incluso');
  if (existing) { stopModule(existing); modules = modules.filter(x => x !== existing); }
  const dir = SM.writeModule(userModulesDir(), id, files);
  const m = readModule(dir, id, 'user');
  if (!m) throw new Error('Modulo non valido');
  m.enabled = true;
  mstate.disabled = mstate.disabled.filter(x => x !== id);
  saveMstate();
  modules = sortModules([...modules, m]);
  startBackground(m);
  afterModulesChanged();
  return m;
}

async function installFromCatalog(id) {
  const c = catalogById(id);
  if (!c || c.status !== 'download' || !/^https:\/\//.test(c.url || '')) throw new Error('Modulo non scaricabile');
  if (!/^[0-9a-f]{64}$/i.test(c.sha256 || '')) throw new Error('Il catalogo non indica il controllo di integrità: installazione rifiutata');
  const r = await net.fetch(c.url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error('Download non riuscito (HTTP ' + r.status + ')');
  const buf = Buffer.from(await r.arrayBuffer());
  if (SM.sha256(buf) !== c.sha256.toLowerCase()) throw new Error('Il file scaricato non corrisponde al catalogo: installazione annullata');
  const info = SM.inspectZip(buf, id);
  if (!(await confirmInstall(info.manifest, id, true))) return { ok: true, cancelled: true };
  performInstall(info);
  return { ok: true };
}

async function installFromFile() {
  const r = await dialog.showOpenDialog(win, { title: 'Scegli il modulo (.zip)', filters: [{ name: 'Modulo PRATIKA (.zip)', extensions: ['zip'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return { ok: true, cancelled: true };
  const info = SM.inspectZip(fs.readFileSync(r.filePaths[0]));
  if (!(await confirmInstall(info.manifest, info.id, false))) return { ok: true, cancelled: true };
  performInstall(info);
  return { ok: true };
}

async function refreshCatalog() {
  try {
    const r = await net.fetch(CATALOG_URL, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!j || !Array.isArray(j.modules)) throw new Error('catalogo non valido');
    remoteCatalog = j; catalogError = null;
  } catch (e) { catalogError = e.message; }
  broadcastApp();
}

async function homeData() {
  const out = { scadSuperate: 0, scad15: 0, primaSuperata: '', pratAperte: 0, pratMancanti: 0, pagDaFare: 0, pagDaControllare: 0, clienti: 0, tariffario: false, storeVisited: mstate.storeVisited };
  try {
    const sh = await shared().get(['clienti', 'pratiche', 'scadenze']);
    const clienti = sh.clienti || [], pratiche = sh.pratiche || [], scadenze = sh.scadenze || [];
    out.clienti = clienti.length;
    const oggi = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00');
    for (const sc of scadenze.filter(x => !x.avvisata)) {
      const g = Math.round((new Date(sc.data + 'T00:00:00') - oggi) / 86400000);
      if (g < 0) { out.scadSuperate++; if (!out.primaSuperata) { const c = clienti.find(x => x.id === sc.clienteId); out.primaSuperata = str(sc.tipo, 30) + ' · ' + str(c && c.nome, 40); } }
      else if (g <= 15) out.scad15++;
    }
    out.pratAperte = pratiche.filter(x => x.stato !== 'Consegnata').length;
    out.pratMancanti = pratiche.filter(x => x.stato === 'Documenti mancanti').length;
  } catch (e) { /* nessun dato */ }
  try {
    if (modOf('pratika-iuv')) {
      const items = ((await storeOf('pratika-iuv', 'local').get('items')).items) || [];
      out.pagDaFare = items.filter(i => i.stato === 'da_pagare').length;
      out.pagDaControllare = items.filter(i => i.stato === 'errore' || i.stato === 'verificare').length;
    }
    if (modOf('pratika-preventivo')) out.tariffario = (((await storeOf('pratika-preventivo', 'local').get('tariffe')).tariffe) || []).some(t => Number(t.importo) > 0);
  } catch (e) { /* nessun dato */ }
  return out;
}

// le pagine interne (Home, Store…) parlano solo con questi canali, e solo se vengono dal nostro file
const fromInternal = e => { try { return isInternal(e.senderFrame.url); } catch (err) { return false; } };
const appHandle = (name, fn) => ipcMain.handle('app:' + name, async (e, ...a) => {
  if (!fromInternal(e)) return { ok: false, error: 'Non consentito' };
  try { const r = await fn(...a); return r === undefined ? { ok: true } : r; } catch (err) { return { ok: false, error: err.message }; }
});
appHandle('catalog', () => ({ ok: true, entries: catalogEntries(), error: catalogError }));
appHandle('home', async () => ({ ok: true, data: await homeData() }));
appHandle('toggle', (id, on) => { setEnabled(String(id), !!on); });
appHandle('install', id => installFromCatalog(String(id)));
appHandle('install-zip', () => installFromFile());
appHandle('uninstall', id => { uninstall(String(id)); });
appHandle('open-panel', id => { openPanel(String(id), true); });
appHandle('open-url', url => {
  url = String(url);
  if (/^https?:\/\//.test(url)) addTab(url); else if (/^pratika:\/\//.test(url)) openInternal(normalizeUrl(url).split('#')[1] || 'home');
});
appHandle('interest', (id, on) => {
  id = String(id);
  mstate.interest = mstate.interest.filter(x => x !== id);
  if (on) mstate.interest.push(id);
  saveMstate();
});
appHandle('refresh', async () => { await refreshCatalog(); return { ok: true, error: catalogError }; });
appHandle('visited-store', () => { if (!mstate.storeVisited) { mstate.storeVisited = true; saveMstate(); } });

// ---------- background dei moduli ----------
function startBackground(m) {
  if (!m.enabled || m.bg) return;
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
  const moduleItems = live().filter(m => m.panelUrl).map((m, i) => ({
    label: 'Pannello: ' + nameOfId(m.id),
    accelerator: m.shortcut ? m.shortcut.replace(/Ctrl/g, 'CmdOrCtrl') : `CmdOrCtrl+${i + 1}`,
    click: () => openPanel(m.id)
  }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Browser', submenu: [
      { label: 'Nuova scheda', accelerator: 'CmdOrCtrl+T', click: () => addTab(START_URL) },
      { label: 'Home', accelerator: 'CmdOrCtrl+Shift+H', click: () => openInternal('home') },
      { label: 'Store dei moduli', accelerator: 'CmdOrCtrl+Shift+S', click: () => openInternal('store') },
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
  loadMstate();
  modules = scanModules();

  const stateFile = path.join(app.getPath('userData'), 'window-state.json');
  let state = { width: 1440, height: 900 };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch (e) { /* primo avvio */ }
  win = new BaseWindow({ width: state.width, height: state.height, x: state.x, y: state.y, minWidth: 1000, minHeight: 620, title: 'PRATIKA Browser' });
  if (state.maximized) win.maximize();
  win.on('close', () => {
    const b = win.getNormalBounds();
    try { fs.writeFileSync(stateFile, JSON.stringify({ ...b, maximized: win.isMaximized() })); } catch (e) { /* non critico */ }
    modules.forEach(m => Object.values(m.stores).forEach(s => s.writeNow()));
    if (sharedStore) sharedStore.writeNow();
  });

  sideView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'ui', 'ui-preload.js'), contextIsolation: true, sandbox: true } });
  uiView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'ui', 'ui-preload.js'), contextIsolation: true, sandbox: true } });
  win.contentView.addChildView(sideView);
  win.contentView.addChildView(uiView);
  sideView.webContents.loadFile(path.join(__dirname, 'ui', 'side.html'));
  uiView.webContents.loadFile(path.join(__dirname, 'ui', 'index.html'));
  buildMenu();
  win.on('resize', layout);
  win.on('closed', () => app.quit());

  live().forEach(startBackground);
  addTab(START_URL);
  if (process.env.PRATIKA_START_URL) addTab(process.env.PRATIKA_START_URL);
  layout();
  refreshCatalog();

  // solo per prove: PRATIKA_EVAL="<idModulo>|<codice>" esegue codice nel pannello del modulo dopo 4 s
  if (process.env.PRATIKA_EVAL) {
    const [id, ...code] = process.env.PRATIKA_EVAL.split('|');
    setTimeout(() => { const m = modOf(id); ensurePanel(m); m.panelView.webContents.executeJavaScript(code.join('|')).then(r => console.log('EVAL', JSON.stringify(r)), e => console.log('EVAL-ERR', e.message)); }, 4000);
  }
  // solo per prove: PRATIKA_EVAL_PAGE="<codice>" esegue codice nella pagina interna Home dopo 4 s
  if (process.env.PRATIKA_EVAL_PAGE) {
    setTimeout(() => { const t = tabs.find(t => t.internal); t.view.webContents.executeJavaScript(process.env.PRATIKA_EVAL_PAGE).then(r => { console.log('EVALPAGE', JSON.stringify(r)); if (!process.env.PRATIKA_KEEP) app.quit(); }, e => { console.log('EVALPAGE-ERR', e.message); app.quit(); }); }, 4000);
  }
  // solo per prove: PRATIKA_SHOT=<cartella> salva immagini delle schermate e chiude
  if (process.env.PRATIKA_SHOT) runShots(process.env.PRATIKA_SHOT);
});

async function runShots(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const snap = async (name, view) => fs.writeFileSync(path.join(dir, name + '.png'), (await view.webContents.capturePage()).toPNG());
  await wait(2500);
  for (const route of (process.env.PRATIKA_ROUTES || 'home,store,store/pratika-scadenzario,installed').split(',')) {
    openInternal(route); await wait(1500);
    await snap(route.replace('/', '-') + '-page', activeTab().view);
  }
  openInternal('home'); await wait(800);
  openPanel('pratika-scadenzario', true); await wait(1500);
  await snap('shell-side', sideView); await snap('shell-top', uiView); await snap('shell-panel', modOf('pratika-scadenzario').panelView);
  console.log('SHOTS-DONE');
  app.quit();
}

app.on('window-all-closed', () => app.quit());
