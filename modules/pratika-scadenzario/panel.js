const TIPI = ['Bollo', 'Revisione', 'Assicurazione', 'Tagliando', 'Altro'];
let clienti = [], scadenze = [], mostra = 'aperte';

const load = async () => { clienti = await shared.get('clienti', []); scadenze = await shared.get('scadenze', []); render(); };
const save = () => shared.set('scadenze', scadenze);

function stato(s) {
  const g = daysTo(s.data);
  if (g < 0) return { cls: 'red', txt: `scaduta da ${-g} g` };
  if (g <= 15) return { cls: 'amber', txt: g === 0 ? 'oggi' : `tra ${g} g` };
  return { cls: 'green', txt: `tra ${g} g` };
}

function render() {
  const ord = scadenze.slice().sort((a, b) => a.data.localeCompare(b.data));
  const lista = ord.filter(s => mostra === 'tutte' || !s.avvisata);
  $('#main').innerHTML = `<section class="card"><b>Nuova scadenza</b>
    <label>Cliente</label><select id="sCli">${optClienti(clienti)}</select>
    <div class="row"><div><label>Tipo</label><select id="sTipo">${TIPI.map(t => `<option>${t}</option>`).join('')}</select></div>
    <div><label>Targa</label><input id="sTarga" placeholder="AB123CD"></div></div>
    <label>Data di scadenza</label><input id="sData" type="date">
    <div class="actions" style="margin-top:8px"><button class="b" id="sAdd">Aggiungi</button></div>
    ${clienti.length ? '' : '<div class="muted" style="margin-top:6px">Aggiungi prima i clienti nel modulo Fascicolo.</div>'}</section>
    <div class="row" style="margin-bottom:8px"><select id="filtro"><option value="aperte"${mostra === 'aperte' ? ' selected' : ''}>Da gestire</option><option value="tutte"${mostra === 'tutte' ? ' selected' : ''}>Tutte (anche già avvisate)</option></select></div>
    ${lista.length ? lista.map(s => { const st = stato(s); const c = clienti.find(x => x.id === s.clienteId);
      return `<section class="card"><div style="display:flex;justify-content:space-between"><b>${esc(c ? c.nome : '—')}</b><span class="tag ${st.cls}">${st.txt}</span></div>
      <div class="muted">${esc(s.tipo)} · ${esc(s.targa)} · ${itDate(s.data)}${s.avvisata ? ' · avvisata il ' + itDate(s.avvisata) : ''}</div>
      <div class="actions" style="margin-top:6px"><button class="b sm" data-wa="${s.id}">Promemoria WhatsApp</button>
      <button class="b sec sm" data-ok="${s.id}">${s.avvisata ? 'Riapri' : 'Segna avvisata'}</button><button class="b sec sm" data-rinnova="${s.id}">Rinnova +1 anno</button><button class="b red sm" data-del="${s.id}">×</button></div></section>`; }).join('')
      : '<div class="empty">Nessuna scadenza da gestire</div>'}`;
  bind();
}

function bind() {
  $('#filtro').onchange = e => { mostra = e.target.value; render(); };
  $('#sAdd').onclick = async () => {
    const clienteId = $('#sCli').value, data = $('#sData').value;
    if (!clienteId || !data) return toast('Scegli cliente e data', true);
    const c = clienti.find(x => x.id === clienteId);
    scadenze.push({ id: uid(), clienteId, tipo: $('#sTipo').value, targa: $('#sTarga').value.trim().toUpperCase() || (c.targhe || [])[0] || '', data });
    await save(); render();
  };
  document.querySelectorAll('[data-wa]').forEach(b => b.onclick = async () => {
    const s = scadenze.find(x => x.id === b.dataset.wa), c = clienti.find(x => x.id === s.clienteId);
    const quando = daysTo(s.data) < 0 ? `è scaduta il ${itDate(s.data)}` : `scade il ${itDate(s.data)}`;
    if (await inviaWhatsApp(c, `Buongiorno ${c ? c.nome : ''}, le ricordiamo che ${s.tipo.toLowerCase() === 'altro' ? 'una scadenza' : 'la scadenza ' + (s.tipo === 'Bollo' ? 'del bollo' : s.tipo === 'Revisione' ? 'della revisione' : s.tipo === 'Assicurazione' ? "dell'assicurazione" : 'del tagliando')} per la targa ${s.targa} ${quando}. Ci contatti per occuparcene noi.`)) {
      s.avvisata = today(); await save(); render();
    }
  });
  document.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => { const s = scadenze.find(x => x.id === b.dataset.ok); s.avvisata = s.avvisata ? null : today(); await save(); render(); });
  document.querySelectorAll('[data-rinnova]').forEach(b => b.onclick = async () => {
    const s = scadenze.find(x => x.id === b.dataset.rinnova); const d = new Date(s.data + 'T00:00:00'); d.setFullYear(d.getFullYear() + 1);
    scadenze.push({ ...s, id: uid(), data: d.toISOString().slice(0, 10), avvisata: null }); s.avvisata = s.avvisata || today(); await save(); render();
  });
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (confirm('Eliminare la scadenza?')) { scadenze = scadenze.filter(x => x.id !== b.dataset.del); await save(); render(); } });
}

$('#csv').onclick = () => downloadCsv('scadenze_' + today() + '.csv', [['Cliente', 'Tipo', 'Targa', 'Scadenza', 'Avvisata il'],
  ...scadenze.slice().sort((a, b) => a.data.localeCompare(b.data)).map(s => [nomeCliente(clienti, s.clienteId), s.tipo, s.targa, itDate(s.data), itDate(s.avvisata)])]);
chrome.pratika.onSharedChanged.addListener(ch => { if ((ch.clienti || ch.scadenze) && !['INPUT', 'SELECT'].includes((document.activeElement || {}).tagName)) load(); });
load();
