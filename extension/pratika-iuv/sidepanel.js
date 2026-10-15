const $ = s => document.querySelector(s);
const DEFAULTS = { auto: true, cbillMCTC: 'BFYKB', cbillPRA: 'B041S', importoFisso: '1' };
let items = [];
let settings = { ...DEFAULTS };
let run = {};
let harvest = {};

const STATI = { da_pagare: 'Da pagare', in_corso: 'In corso…', pagato: 'Pagato', errore: 'Errore', verificare: 'Da verificare' };
const group = s => (s || '').replace(/(\d{4})(?=\d)/g, '$1 ');
const toNum = s => {
  if (!s) return 0;
  let t = String(s).replace(/[^\d.,]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
};
const eur = n => n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
const impOf = it => it.importo_pagato || it.importo;

function msg(text, err) {
  const m = $('#msg');
  m.textContent = text;
  m.className = 'msg' + (err ? ' err' : '');
  m.hidden = !text;
  clearTimeout(msg.t);
  if (text) msg.t = setTimeout(() => (m.hidden = true), 7000);
}

async function copy(text, btn) {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  if (btn) { btn.classList.add('done'); setTimeout(() => btn.classList.remove('done'), 900); }
}

const save = () => chrome.storage.local.set({ items });
const saveSettings = () => chrome.storage.local.set({ settings });

// ---------- tabella ----------
function render() {
  const f = $('#filter').value;
  const show = items.filter(i =>
    f === 'all' ? true :
    f === 'problemi' ? (i.stato === 'errore' || i.stato === 'verificare') :
    f === 'da_pagare' ? (i.stato === 'da_pagare' || i.stato === 'in_corso') :
    i.stato === f);
  const tbody = $('#tbl tbody');
  tbody.innerHTML = '';
  show.forEach(it => {
    const tr = document.createElement('tr');
    tr.className = it.stato;
    tr.innerHTML = `
      <td class="codes"><button class="copy" title="Copia codice avviso"></button><button class="copy iuv" title="Copia IUV"></button></td>
      <td><span class="badge ${it.fonte}" title="Clic per cambiare (Motorizzazione / PRA)">${it.fonte === 'PRA' ? 'PRA' : 'MCTC'}</span></td>
      <td class="imp"></td>
      <td><span class="st ${it.stato}">${STATI[it.stato] || it.stato}</span></td>
      <td class="act">
        ${it.stato === 'da_pagare' ? '<button class="pay" title="Segna pagato">✓</button>' : '<button class="reset" title="Rimetti da pagare">↺</button>'}
        <button class="del" title="Elimina">✕</button>
      </td>`;
    const [bAv, bIuv] = tr.querySelectorAll('.copy');
    bAv.textContent = group(it.avviso);
    bIuv.textContent = 'IUV ' + it.iuv;
    bAv.onclick = () => copy(it.avviso, bAv);
    bIuv.onclick = () => copy(it.iuv, bIuv);
    tr.querySelector('.imp').textContent = impOf(it) ? eur(toNum(impOf(it))) : '—';
    tr.querySelector('.badge').onclick = () => { it.fonte = it.fonte === 'PRA' ? 'MCTC' : 'PRA'; save(); };
    const pay = tr.querySelector('.pay');
    if (pay) pay.onclick = () => { Object.assign(it, { stato: 'pagato', nota: 'Segnato a mano', pagato_il: new Date().toLocaleString('it-IT') }); save(); };
    const reset = tr.querySelector('.reset');
    if (reset) reset.onclick = () => { Object.assign(it, { stato: 'da_pagare', nota: '' }); save(); };
    tr.querySelector('.del').onclick = () => { if (confirm('Eliminare ' + it.avviso + '?')) { items = items.filter(x => x !== it); save(); } };
    tbody.appendChild(tr);

    const extra = [it.nota, it.rif, it.causale].filter(Boolean).join(' · ');
    if (extra) {
      const tr2 = document.createElement('tr');
      tr2.className = it.stato;
      tr2.innerHTML = '<td class="nota" colspan="5"></td>';
      tr2.firstChild.textContent = extra;
      tbody.appendChild(tr2);
    }
  });
  $('#empty').hidden = show.length > 0;

  const da = items.filter(i => i.stato === 'da_pagare');
  const mctc = da.filter(i => i.fonte !== 'PRA').length;
  const probl = items.filter(i => i.stato === 'errore' || i.stato === 'verificare').length;
  $('#summary').textContent = `${da.length} da pagare (${mctc} MCTC, ${da.length - mctc} PRA)` + (probl ? ` · ${probl} da controllare` : '');
}

function renderRun() {
  const on = !!run.active;
  $('#btnStart').hidden = on;
  $('#btnStop').hidden = !on;
  const box = $('#runStatus');
  box.className = 'run-status' + (on ? ' on' : '');
  box.textContent = (on ? 'In esecuzione — ' : '') + (run.msg || 'Fermo');
  $('#log').textContent = (run.log || []).join('\n');
}

// ---------- raccolta ----------
async function addItems(found, source) {
  const res = await chrome.runtime.sendMessage({ type: 'pratika-add', items: found, source });
  return res && res.ok ? res.added : 0;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function ensurePermission(url) {
  const origin = new URL(url).origin + '/*';
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  return chrome.permissions.request({ origins: [origin] });
}

async function scanActiveTab() {
  const tab = await activeTab();
  if (!tab || !/^https?:/.test(tab.url || '')) { msg('Apri prima la pagina del Portale del Trasporto o del PRA.', true); return; }
  if (/sella\.it/i.test(tab.url)) { msg('Questa è la pagina della banca: l\'estrazione si fa sul Portale del Trasporto o sul PRA.', true); return; }
  if (!(await ensurePermission(tab.url))) { msg('Permesso negato per questo sito.', true); return; }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['extractor.js'] });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => window.PratikaExtract ? window.PratikaExtract.scanDocument(document).map(i => Object.assign(i, { fonte: window.PratikaExtract.fonteOf(location.href, i.ente) })) : []
    });
    const found = results.flatMap(r => r.result || []);
    if (!found.length) { msg(/ilportaledeltrasporto/i.test(tab.url) ? 'Nessun IUV in questa pagina. Se è l\'elenco degli aggregati (tasti +) usa “Apri tutti gli aggregati e raccogli”.' : 'Nessun IUV / codice avviso trovato. Prova “Diagnostica” nelle Impostazioni.', true); return; }
    const gia = found.filter(f => f.pagatoFonte).length;
    const added = await addItems(found, tab.url);
    msg(`Trovati ${found.length} versamenti, ${added} nuovi.` + (gia ? ` ${gia} risultano già pagati sul portale.` : ''));
  } catch (e) { msg('Errore: ' + e.message, true); }
}

// ---------- banca ----------
async function startRun() {
  const tabs = await chrome.tabs.query({ url: ['https://*.sella.it/*'] });
  if (!tabs.length) { msg('Apri la pagina Sella "Bollettini, Mav/Rav, CBILL/PagoPA" e poi premi Avvia.', true); return; }
  if (tabs.length > 1) { msg('Hai più schede Sella aperte: lasciane aperta una sola.', true); return; }
  items.forEach(i => { if (i.stato === 'in_corso') i.stato = 'da_pagare'; });
  const probl = items.filter(i => i.stato === 'errore' || i.stato === 'verificare');
  if (probl.length && confirm(`Ci sono ${probl.length} versamenti con errore o da verificare. Li riprovo in questo giro?`)) {
    probl.forEach(i => { i.stato = 'da_pagare'; i.retry = 0; });
  }
  await save();
  if (!items.some(i => i.stato === 'da_pagare')) { msg('Non ci sono versamenti da pagare.', true); return; }
  await chrome.storage.local.set({ run: { active: true, phase: 'pick', iuv: null, ts: Date.now(), done: 0, msg: 'Avviato', log: run.log || [] } });
  chrome.tabs.update(tabs[0].id, { active: true });
  chrome.windows.update(tabs[0].windowId, { focused: true });
}

async function stopRun() {
  const { run: r = {} } = await chrome.storage.local.get('run');
  if (r.iuv) {
    const it = items.find(i => i.iuv === r.iuv);
    if (it) {
      if (r.phase === 'await_esito') Object.assign(it, { stato: 'verificare', nota: 'Fermato durante la conferma: controlla in banca' });
      else Object.assign(it, { stato: 'da_pagare' });
      await save();
    }
  }
  const t = new Date().toLocaleTimeString('it-IT');
  await chrome.storage.local.set({ run: Object.assign({}, r, { active: false, iuv: null, phase: 'pausa', msg: 'Fermato da te', log: [t + ' ■ Fermato da te', ...(r.log || [])].slice(0, 40) }) });
}

// ---------- raccolta aggregati ----------
function renderHarvest() {
  const on = !!harvest.active;
  $('#btnHarvest').hidden = on;
  $('#btnHarvestStop').hidden = !on;
  const box = $('#harvestStatus');
  box.hidden = !harvest.msg;
  box.className = 'run-status' + (on ? ' on' : '');
  box.textContent = (on ? `In corso (${(harvest.done || []).length} letti) — ` : '') + (harvest.msg || '');
  $('#harvestLogBox').hidden = !(harvest.log || []).length;
  $('#harvestLog').textContent = (harvest.log || []).join('\n');
}
async function startHarvest() {
  const tab = await activeTab();
  if (!tab || !/ilportaledeltrasporto\.it/i.test(tab.url || '')) { msg('Apri sul Portale del Trasporto l\'elenco degli aggregati (quello con i tasti +).', true); return; }
  try {
    let res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.PratikaHarvest ? window.PratikaHarvest.start() : null });
    if (!res[0].result) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['extractor.js'] });
      res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.PratikaHarvest ? window.PratikaHarvest.start() : { ok: false, msg: 'Ricarica la pagina (F5) e riprova.' } });
    }
    const r = res[0].result;
    if (!r.ok) msg(r.msg, true); else msg(`Avvio raccolta su ${r.n} aggregati.`);
  } catch (e) { msg('Errore: ' + e.message, true); }
}
async function stopHarvest() {
  await chrome.storage.local.set({ harvest: Object.assign({}, harvest, { active: false, msg: 'Raccolta fermata da te.' }) });
}

// ---------- export ----------
const COLS = [
  ['Ente', i => (i.fonte === 'PRA' ? 'PRA' : 'Motorizzazione')],
  ['Codice avviso', i => i.avviso], ['IUV', i => i.iuv],
  ['Importo', i => (impOf(i) ? toNum(impOf(i)).toFixed(2).replace('.', ',') : '')],
  ['Riferimento', i => i.rif], ['Causale', i => i.causale], ['CF ente', i => i.ente],
  ['Stato', i => STATI[i.stato] || i.stato], ['Nota', i => i.nota],
  ['Catturato il', i => (i.catturato ? new Date(i.catturato).toLocaleString('it-IT') : '')], ['Pagato il', i => i.pagato_il || '']
];
const isCode = h => ['Codice avviso', 'IUV', 'CF ente'].includes(h);

function exportCsv() {
  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const out = [COLS.map(c => esc(c[0])).join(';')];
  items.forEach(i => out.push(COLS.map(([h, f]) => { const v = f(i) || ''; return isCode(h) && v ? '="' + v + '"' : esc(v); }).join(';')));
  const blob = new Blob(['﻿' + out.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'IUV_PagoPA_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function copyAll() {
  copy([COLS.map(c => c[0]).join('\t'), ...items.map(i => COLS.map(([, f]) => f(i) || '').join('\t'))].join('\n'));
  msg('Tabella copiata: incollala in Excel.');
}

async function diagnose() {
  const tab = await activeTab();
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['extractor.js'] });
    const res = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => window.PratikaExtract ? window.PratikaExtract.diagnose(document) : null });
    const text = JSON.stringify(res.map(r => r.result), null, 2);
    $('#diag').hidden = false;
    $('#diag').textContent = text;
    copy(text);
    msg('Diagnostica copiata negli appunti: incollala nella chat con Claude.');
  } catch (e) { msg('Errore: ' + e.message, true); }
}

// ---------- eventi ----------
$('#btnScan').onclick = scanActiveTab;
$('#btnHarvest').onclick = startHarvest;
$('#btnCopyHLog').onclick = () => { copy((harvest.log || []).join('\n')); msg('Registro copiato: incollalo nella chat con Claude.'); };
$('#btnHarvestStop').onclick = stopHarvest;
$('#btnStart').onclick = startRun;
$('#btnStop').onclick = stopRun;
$('#filter').onchange = render;
$('#chkAuto').onchange = e => { settings.auto = e.target.checked; saveSettings(); };
$('#setMCTC').onchange = e => { settings.cbillMCTC = e.target.value.trim().toUpperCase() || DEFAULTS.cbillMCTC; e.target.value = settings.cbillMCTC; saveSettings(); };
$('#setPRA').onchange = e => { settings.cbillPRA = e.target.value.trim().toUpperCase() || DEFAULTS.cbillPRA; e.target.value = settings.cbillPRA; saveSettings(); };
$('#setImporto').onchange = e => { settings.importoFisso = e.target.value.trim() || DEFAULTS.importoFisso; e.target.value = settings.importoFisso; saveSettings(); };
$('#btnCsv').onclick = exportCsv;
$('#btnCopyAll').onclick = copyAll;
$('#btnDiag').onclick = diagnose;
$('#btnClearPaid').onclick = () => { const n = items.filter(i => i.stato === 'pagato').length; if (n && confirm(`Eliminare ${n} versamenti pagati?`)) { items = items.filter(i => i.stato !== 'pagato'); save(); } };
$('#btnClear').onclick = () => { if (run.active) { msg('Ferma prima i pagamenti.', true); return; } if (items.length && confirm('Svuotare tutta la tabella?')) { items = []; save(); } };
$('#btnPaste').onclick = async () => {
  const fonte = $('#pasteFonte').value;
  const found = window.PratikaExtract.scanText($('#txtPaste').value).map(i => Object.assign(i, { fonte }));
  if (!found.length) { msg('Nessun codice trovato nel testo.', true); return; }
  const added = await addItems(found, 'testo incollato');
  msg(`Trovati ${found.length}, ${added} nuovi.`);
  $('#txtPaste').value = '';
};

chrome.storage.onChanged.addListener(ch => {
  if (ch.items) { items = ch.items.newValue || []; render(); }
  if (ch.run) { run = ch.run.newValue || {}; renderRun(); }
  if (ch.harvest) { harvest = ch.harvest.newValue || {}; renderHarvest(); }
});

(async () => {
  const st = await chrome.storage.local.get(['items', 'settings', 'run', 'harvest']);
  harvest = st.harvest || {};
  items = st.items || [];
  settings = Object.assign({}, DEFAULTS, st.settings || {});
  run = st.run || {};
  $('#chkAuto').checked = settings.auto !== false;
  $('#setMCTC').value = settings.cbillMCTC;
  $('#setPRA').value = settings.cbillPRA;
  $('#setImporto').value = settings.importoFisso;
  render();
  renderRun();
  renderHarvest();
})();
