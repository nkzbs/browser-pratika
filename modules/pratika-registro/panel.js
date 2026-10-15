// Legge i versamenti del modulo "PRATIKA – IUV PagoPA" (sola lettura) e li collega ai clienti del Fascicolo.
let items = [], clienti = [], ass = {}, mese = '', solo = 'pagato';

async function load() {
  const r = await chrome.pratika.read('pratika-iuv', 'local', ['items']);
  items = r.items || [];
  clienti = await shared.get('clienti', []);
  ass = (await chrome.storage.local.get('ass')).ass || {};
  render();
}
const importo = i => { const t = String(i.importo_pagato || i.importo || '').replace(/[^\d.,]/g, ''); return parseFloat(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t) || 0; };
const dataPag = i => (i.pagato_il || '').slice(0, 10);
const meseDi = i => (/^\d{4}-\d{2}/.test(dataPag(i)) ? dataPag(i).slice(0, 7) : /(\d{2})\/(\d{2})\/(\d{4})/.test(i.pagato_il || '') ? RegExp.$3 + '-' + RegExp.$2 : '');
const visibili = () => items.filter(i => (solo === 'tutti' || i.stato === 'pagato') && (!mese || meseDi(i) === mese));

function render() {
  const mesi = [...new Set(items.map(meseDi).filter(Boolean))].sort().reverse();
  const lista = visibili();
  const tot = lista.reduce((s, i) => s + importo(i), 0);
  $('#main').innerHTML = `<div class="row" style="margin-bottom:8px">
    <select id="fMese"><option value="">Tutti i mesi</option>${mesi.map(m => `<option${m === mese ? ' selected' : ''}>${m}</option>`).join('')}</select>
    <select id="fSolo"><option value="pagato"${solo === 'pagato' ? ' selected' : ''}>Solo pagati</option><option value="tutti"${solo === 'tutti' ? ' selected' : ''}>Tutti i versamenti</option></select></div>
    <div class="muted" style="margin-bottom:6px">${lista.length} versamenti · totale ${eur(tot)}${lista.some(i => !ass[i.iuv]) ? ' · ' + lista.filter(i => !ass[i.iuv]).length + ' da assegnare' : ''}</div>
    ${lista.length ? lista.map(i => `<section class="card"><div style="display:flex;justify-content:space-between"><b>${esc(i.avviso || i.iuv)}</b><span class="tag ${i.stato === 'pagato' ? 'green' : i.stato === 'errore' || i.stato === 'verificare' ? 'red' : ''}">${esc(i.stato)}</span></div>
      <div class="muted">${eur(importo(i))} · ${esc(i.fonte || '')} · ${esc(i.pagato_il || '')}${i.causale ? '<br>' + esc(i.causale) : ''}</div>
      <div class="actions" style="margin-top:6px"><select data-ass="${esc(i.iuv)}" style="width:auto;max-width:190px">${optClienti(clienti, ass[i.iuv])}</select>
      ${i.stato === 'pagato' ? `<button class="b sm" data-ric="${esc(i.iuv)}">Invia ricevuta</button>` : ''}</div></section>`).join('') : '<div class="empty">Nessun versamento. Si riempie con il modulo IUV PagoPA.</div>'}`;
  $('#fMese').onchange = e => { mese = e.target.value; render(); };
  $('#fSolo').onchange = e => { solo = e.target.value; render(); };
  document.querySelectorAll('[data-ass]').forEach(s => s.onchange = async () => { if (s.value) ass[s.dataset.ass] = s.value; else delete ass[s.dataset.ass]; await chrome.storage.local.set({ ass }); render(); });
  document.querySelectorAll('[data-ric]').forEach(b => b.onclick = () => {
    const i = items.find(x => x.iuv === b.dataset.ric), c = clienti.find(x => x.id === ass[i.iuv]);
    if (!c) return toast('Assegna prima il cliente', true);
    inviaWhatsApp(c, `Buongiorno ${c.nome}, confermiamo il pagamento dell'avviso ${i.avviso || i.iuv} di ${eur(importo(i))}${i.pagato_il ? ' eseguito il ' + i.pagato_il : ''}. Conservi questo messaggio come ricevuta.`);
  });
}

$('#csv').onclick = () => downloadCsv('registro_pagamenti_' + today() + '.csv', [['Data pagamento', 'Cliente', 'Ente', 'Codice avviso', 'IUV', 'Importo', 'Causale', 'Stato'],
  ...visibili().map(i => [i.pagato_il || '', nomeCliente(clienti, ass[i.iuv]), i.fonte || '', i.avviso ? '="' + i.avviso + '"' : '', '="' + i.iuv + '"', importo(i).toFixed(2).replace('.', ','), i.causale || '', i.stato])]);
$('#ref').onclick = load;
chrome.pratika.onSharedChanged.addListener(ch => { if (ch.clienti) load(); });
load();
