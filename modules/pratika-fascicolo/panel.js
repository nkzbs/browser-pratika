const TIPI = ['Passaggio di proprietà', 'Immatricolazione', 'Radiazione', 'Duplicato documenti', 'Rinnovo / altro'];
const STATI = ['Da avviare', 'In lavorazione', 'Documenti mancanti', 'Pronta', 'Consegnata'];
let clienti = [], pratiche = [], tab = 'c', cerca = '', editC = null;

const load = async () => { clienti = await shared.get('clienti', []); pratiche = await shared.get('pratiche', []); render(); };
const saveC = () => shared.set('clienti', clienti);
const saveP = () => shared.set('pratiche', pratiche);

function render() {
  $('#tabC').className = tab === 'c' ? 'on' : '';
  $('#tabP').className = tab === 'p' ? 'on' : '';
  $('#main').innerHTML = tab === 'c' ? viewClienti() : viewPratiche();
  bind();
}

function viewClienti() {
  const c = editC ? clienti.find(x => x.id === editC) || {} : {};
  const q = cerca.toLowerCase();
  const lista = clienti.filter(x => !q || (x.nome + ' ' + x.telefono + ' ' + (x.targhe || []).join(' ')).toLowerCase().includes(q))
    .sort((a, b) => a.nome.localeCompare(b.nome));
  return `<section class="card"><b>${editC ? 'Modifica cliente' : 'Nuovo cliente'}</b>
    <label>Nome e cognome / ragione sociale</label><input id="cNome" value="${esc(c.nome)}">
    <div class="row"><div><label>Telefono</label><input id="cTel" value="${esc(c.telefono)}" placeholder="333 1234567"></div>
    <div><label>Targhe (separate da virgola)</label><input id="cTarghe" value="${esc((c.targhe || []).join(', '))}"></div></div>
    <label>Note</label><textarea id="cNote">${esc(c.note)}</textarea>
    <div class="actions" style="margin-top:8px"><button class="b" id="cSalva">${editC ? 'Salva' : 'Aggiungi'}</button>${editC ? '<button class="b sec" id="cAnnulla">Annulla</button>' : ''}</div></section>
    <input id="cerca" placeholder="Cerca per nome, telefono o targa" value="${esc(cerca)}" style="margin-bottom:8px">
    ${lista.length ? `<table><tr><th>Cliente</th><th>Targhe</th><th></th></tr>${lista.map(x => `<tr><td><b>${esc(x.nome)}</b><br><span class="muted">${esc(x.telefono)}</span></td><td>${esc((x.targhe || []).join(', '))}</td>
      <td class="actions"><button class="b sec sm" data-edit="${x.id}">Modifica</button><button class="b red sm" data-delc="${x.id}">×</button></td></tr>`).join('')}</table>` : '<div class="empty">Nessun cliente</div>'}`;
}

function viewPratiche() {
  const q = cerca.toLowerCase();
  const lista = pratiche.filter(p => !q || (p.targa + p.tipo + p.stato + nomeCliente(clienti, p.clienteId)).toLowerCase().includes(q))
    .sort((a, b) => (b.creata || '').localeCompare(a.creata || ''));
  const apert = pratiche.filter(p => p.stato !== 'Consegnata').length;
  return `<section class="card"><b>Nuova pratica</b>
    <label>Cliente</label><select id="pCli">${optClienti(clienti)}</select>
    <div class="row"><div><label>Tipo</label><select id="pTipo">${TIPI.map(t => `<option>${t}</option>`).join('')}</select></div>
    <div><label>Targa</label><input id="pTarga" placeholder="AB123CD"></div></div>
    <div class="row"><div><label>Importo (€)</label><input id="pImp" inputmode="decimal"></div>
    <div><label>Stato</label><select id="pStato">${STATI.map(t => `<option>${t}</option>`).join('')}</select></div></div>
    <div class="actions" style="margin-top:8px"><button class="b" id="pAdd">Aggiungi pratica</button></div></section>
    <input id="cerca" placeholder="Cerca per cliente, targa, tipo o stato" value="${esc(cerca)}" style="margin-bottom:8px">
    <div class="muted" style="margin-bottom:6px">${apert} pratiche aperte su ${pratiche.length}</div>
    ${lista.length ? lista.map(p => `<section class="card"><div style="display:flex;justify-content:space-between"><b>${esc(nomeCliente(clienti, p.clienteId) || '—')}</b><span class="tag">${esc(p.targa)}</span></div>
      <div class="muted">${esc(p.tipo)}${p.importo ? ' · ' + eur(p.importo) : ''} · ${itDate(p.creata)}</div>
      <div class="actions" style="margin-top:6px"><select data-stato="${p.id}" style="width:auto">${STATI.map(s => `<option${s === p.stato ? ' selected' : ''}>${s}</option>`).join('')}</select>
      <button class="b sm" data-avvisa="${p.id}">Avvisa il cliente</button><button class="b red sm" data-delp="${p.id}">×</button></div></section>`).join('') : '<div class="empty">Nessuna pratica</div>'}`;
}

function bind() {
  const cercaEl = $('#cerca');
  if (cercaEl) cercaEl.oninput = e => { cerca = e.target.value; const pos = e.target.selectionStart; render(); const n = $('#cerca'); n.focus(); n.setSelectionRange(pos, pos); };
  if ($('#cSalva')) $('#cSalva').onclick = async () => {
    const nome = $('#cNome').value.trim();
    if (!nome) return toast('Inserisci il nome', true);
    const tel = $('#cTel').value.trim();
    if (tel && !telefono(tel)) return toast('Telefono non valido', true);
    const targhe = $('#cTarghe').value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const dati = { nome, telefono: tel, targhe, note: $('#cNote').value.trim() };
    if (editC) Object.assign(clienti.find(x => x.id === editC), dati); else clienti.push({ id: uid(), ...dati });
    editC = null; await saveC(); render(); toast('Salvato');
  };
  if ($('#cAnnulla')) $('#cAnnulla').onclick = () => { editC = null; render(); };
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { editC = b.dataset.edit; render(); scrollTo(0, 0); });
  document.querySelectorAll('[data-delc]').forEach(b => b.onclick = async () => {
    const usate = pratiche.filter(p => p.clienteId === b.dataset.delc).length;
    if (!confirm(usate ? `Il cliente ha ${usate} pratiche collegate. Eliminarlo comunque?` : 'Eliminare il cliente?')) return;
    clienti = clienti.filter(x => x.id !== b.dataset.delc); await saveC(); render();
  });
  if ($('#pAdd')) $('#pAdd').onclick = async () => {
    const clienteId = $('#pCli').value;
    if (!clienteId) return toast('Scegli il cliente', true);
    const targa = $('#pTarga').value.trim().toUpperCase();
    if (!targa) return toast('Inserisci la targa', true);
    pratiche.push({ id: uid(), clienteId, tipo: $('#pTipo').value, targa, importo: parseFloat(($('#pImp').value || '0').replace(',', '.')) || 0, stato: $('#pStato').value, creata: today() });
    await saveP(); render();
  };
  document.querySelectorAll('[data-stato]').forEach(s => s.onchange = async () => { pratiche.find(p => p.id === s.dataset.stato).stato = s.value; await saveP(); render(); });
  document.querySelectorAll('[data-delp]').forEach(b => b.onclick = async () => { if (confirm('Eliminare la pratica?')) { pratiche = pratiche.filter(p => p.id !== b.dataset.delp); await saveP(); render(); } });
  document.querySelectorAll('[data-avvisa]').forEach(b => b.onclick = () => {
    const p = pratiche.find(x => x.id === b.dataset.avvisa);
    const c = clienti.find(x => x.id === p.clienteId);
    const frasi = { 'Da avviare': 'è stata presa in carico', 'In lavorazione': 'è in lavorazione', 'Documenti mancanti': 'è ferma: mancano dei documenti, può passare o inviarceli?', 'Pronta': 'è pronta per il ritiro', 'Consegnata': 'è stata completata. Grazie!' };
    inviaWhatsApp(c, `Buongiorno ${c ? c.nome : ''}, la pratica "${p.tipo}" per la targa ${p.targa} ${frasi[p.stato]}.`);
  });
}

$('#tabC').onclick = () => { tab = 'c'; cerca = ''; render(); };
$('#tabP').onclick = () => { tab = 'p'; cerca = ''; render(); };
chrome.pratika.onSharedChanged.addListener(ch => { if (ch.clienti || ch.pratiche) { if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return; load(); } });
load();
