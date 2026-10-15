// Le voci del tariffario sono segnaposto a importo zero: vanno compilate dallo studio con i propri importi.
const TIPI = ['Passaggio di proprietà', 'Immatricolazione', 'Radiazione', 'Duplicato documenti', 'Rinnovo / altro'];
const VOCI_BASE = ['Emolumenti dello studio', 'Diritti Motorizzazione', 'Imposta provinciale di trascrizione', 'Emolumenti ACI / PRA', 'Marche e bolli'];
let tab = 'p', tariffe = [], clienti = [], righe = [], form = { clienteId: '', tipo: TIPI[0], targa: '' };

async function load() {
  const r = await chrome.storage.local.get('tariffe');
  tariffe = r.tariffe || VOCI_BASE.map(v => ({ id: uid(), voce: v, importo: 0 }));
  clienti = await shared.get('clienti', []);
  render();
}
const saveT = () => chrome.storage.local.set({ tariffe });
const totale = () => righe.reduce((s, r) => s + r.importo * r.qta, 0);

function testo() {
  const c = clienti.find(x => x.id === form.clienteId);
  return [`Preventivo — ${form.tipo}${form.targa ? ' — targa ' + form.targa : ''}`, c ? 'Cliente: ' + c.nome : '', '',
    ...righe.map(r => `• ${r.voce}${r.qta > 1 ? ' ×' + r.qta : ''}: ${eur(r.importo * r.qta)}`), '', `Totale: ${eur(totale())}`].filter((x, i) => x !== '' || i).join('\n');
}

function render() {
  $('#tabP').className = tab === 'p' ? 'on' : ''; $('#tabT').className = tab === 't' ? 'on' : '';
  $('#main').innerHTML = tab === 'p' ? viewPreventivo() : viewTariffario();
  bind();
}

function viewPreventivo() {
  return `<section class="card"><label>Cliente</label><select id="fCli">${optClienti(clienti, form.clienteId)}</select>
    <div class="row"><div><label>Pratica</label><select id="fTipo">${TIPI.map(t => `<option${t === form.tipo ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
    <div><label>Targa</label><input id="fTarga" value="${esc(form.targa)}"></div></div></section>
    <section class="card"><b>Voci</b>
    <div class="row" style="margin:6px 0"><select id="addVoce"><option value="">+ aggiungi dal tariffario…</option>${tariffe.map(t => `<option value="${t.id}">${esc(t.voce)} (${eur(t.importo)})</option>`).join('')}</select>
    <button class="b sec sm" id="addLibera" style="flex:0 0 auto">+ voce libera</button></div>
    ${righe.length ? `<table>${righe.map((r, i) => `<tr><td>${esc(r.voce)}</td><td style="width:54px"><input data-q="${i}" type="number" min="1" value="${r.qta}"></td><td style="width:84px"><input data-i="${i}" inputmode="decimal" value="${r.importo}"></td><td><button class="b red sm" data-x="${i}">×</button></td></tr>`).join('')}</table>` : '<div class="empty">Nessuna voce</div>'}
    <div style="text-align:right;font-size:16px;margin-top:8px"><b>Totale ${eur(totale())}</b></div></section>
    <div class="actions"><button class="b" id="wa">Invia al cliente (WhatsApp)</button><button class="b sec" id="cp">Copia testo</button><button class="b sec" id="mk">Crea pratica</button><button class="b sec" id="rs">Svuota</button></div>`;
}

function viewTariffario() {
  return `<section class="card"><b>Tariffario dello studio</b><div class="muted" style="margin:4px 0 8px">Importi a zero: inserisci i tuoi. L'app non applica tariffe ufficiali.</div>
    <table>${tariffe.map((t, i) => `<tr><td><input data-tv="${i}" value="${esc(t.voce)}"></td><td style="width:90px"><input data-ti="${i}" inputmode="decimal" value="${t.importo}"></td><td><button class="b red sm" data-td="${i}">×</button></td></tr>`).join('')}</table>
    <div class="actions" style="margin-top:8px"><button class="b" id="tAdd">+ voce</button></div></section>`;
}

const num = v => parseFloat(String(v).replace(',', '.')) || 0;
function bind() {
  if (tab === 't') {
    document.querySelectorAll('[data-tv]').forEach(i => i.onchange = () => { tariffe[i.dataset.tv].voce = i.value; saveT(); });
    document.querySelectorAll('[data-ti]').forEach(i => i.onchange = () => { tariffe[i.dataset.ti].importo = num(i.value); saveT(); });
    document.querySelectorAll('[data-td]').forEach(b => b.onclick = () => { tariffe.splice(b.dataset.td, 1); saveT(); render(); });
    $('#tAdd').onclick = () => { tariffe.push({ id: uid(), voce: 'Nuova voce', importo: 0 }); saveT(); render(); };
    return;
  }
  $('#fCli').onchange = e => (form.clienteId = e.target.value);
  $('#fTipo').onchange = e => (form.tipo = e.target.value);
  $('#fTarga').oninput = e => (form.targa = e.target.value.toUpperCase());
  $('#addVoce').onchange = e => { const t = tariffe.find(x => x.id === e.target.value); if (t) { righe.push({ voce: t.voce, importo: t.importo, qta: 1 }); render(); } };
  $('#addLibera').onclick = () => { righe.push({ voce: 'Voce', importo: 0, qta: 1 }); render(); };
  document.querySelectorAll('[data-q]').forEach(i => i.onchange = () => { righe[i.dataset.q].qta = Math.max(1, parseInt(i.value) || 1); render(); });
  document.querySelectorAll('[data-i]').forEach(i => i.onchange = () => { righe[i.dataset.i].importo = num(i.value); render(); });
  document.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { righe.splice(b.dataset.x, 1); render(); });
  $('#cp').onclick = () => righe.length ? copia(testo()) : toast('Aggiungi almeno una voce', true);
  $('#rs').onclick = () => { righe = []; form = { clienteId: '', tipo: TIPI[0], targa: '' }; render(); };
  $('#wa').onclick = () => {
    if (!righe.length) return toast('Aggiungi almeno una voce', true);
    inviaWhatsApp(clienti.find(c => c.id === form.clienteId), testo());
  };
  $('#mk').onclick = async () => {
    if (!form.clienteId || !form.targa) return toast('Servono cliente e targa', true);
    const pratiche = await shared.get('pratiche', []);
    pratiche.push({ id: uid(), clienteId: form.clienteId, tipo: form.tipo, targa: form.targa, importo: totale(), stato: 'Da avviare', creata: today() });
    await shared.set('pratiche', pratiche);
    toast('Pratica creata nel Fascicolo');
  };
}

$('#tabP').onclick = () => { tab = 'p'; render(); };
$('#tabT').onclick = () => { tab = 't'; render(); };
chrome.pratika.onSharedChanged.addListener(async ch => { if (ch.clienti) { clienti = await shared.get('clienti', []); if (tab === 'p') render(); } });
load();
