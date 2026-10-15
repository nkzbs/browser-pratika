// Funzioni comuni dei moduli PRATIKA (pannelli).
const $ = (s, r = document) => r.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = n => (Number(n) || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
const today = () => new Date().toISOString().slice(0, 10);
const itDate = d => (d ? d.split('-').reverse().join('/') : '');
const daysTo = d => Math.round((new Date(d + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000);

function toast(text, err) {
  let m = $('.msg');
  if (!m) { m = document.createElement('div'); m.className = 'msg'; document.body.append(m); }
  m.textContent = text; m.className = 'msg' + (err ? ' err' : ''); m.style.display = 'block';
  clearTimeout(toast.t); toast.t = setTimeout(() => (m.style.display = 'none'), 4000);
}

// numero di telefono -> cifre con prefisso internazionale (come fa il modulo WhatsApp); null se non valido
function telefono(testo) {
  let c = String(testo || '').replace(/\D/g, '');
  if (!c) return null;
  if (c.startsWith('00')) c = c.slice(2);
  else if (c.startsWith('3') && (c.length === 9 || c.length === 10)) c = '39' + c;
  else if (!(c.startsWith('39') && (c.length === 11 || c.length === 12)) && c.length < 11) return null;
  return c.length < 8 || c.length > 15 ? null : c;
}

// invia un messaggio con il modulo WhatsApp (richiede il permesso "send:autofranciacorta")
async function inviaWhatsApp(cliente, testo) {
  const cifre = telefono(cliente && cliente.telefono);
  if (!cifre) { toast('Telefono mancante o non valido per ' + ((cliente && cliente.nome) || 'il cliente'), true); return false; }
  try {
    const r = await chrome.pratika.send('autofranciacorta', { tipo: 'inviaSubito', lavoro: { cifre, testo, chi: cliente.nome } });
    if (!r || !r.ok) { toast('Invio non avviato' + (r && r.errore ? ': ' + r.errore : ''), true); return false; }
    toast('Invio in corso: l\'esito compare sull\'icona di WhatsApp');
    return true;
  } catch (e) { toast('Errore: ' + e.message, true); return false; }
}

// archivio condiviso tra i moduli
const shared = {
  async get(k, def) { const r = await chrome.pratika.shared.get(k); return r[k] === undefined ? def : r[k]; },
  set: (k, v) => chrome.pratika.shared.set({ [k]: v })
};

function downloadCsv(nome, righe) {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const blob = new Blob(['﻿' + righe.map(r => r.map(q).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function copia(testo) {
  try { await navigator.clipboard.writeText(testo); }
  catch (e) { const t = document.createElement('textarea'); t.value = testo; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
  toast('Copiato');
}

function nomeCliente(clienti, id) { const c = clienti.find(c => c.id === id); return c ? c.nome : ''; }
function optClienti(clienti, sel) {
  return '<option value="">— cliente —</option>' + clienti.slice().sort((a, b) => a.nome.localeCompare(b.nome)).map(c => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${esc(c.nome)}</option>`).join('');
}
