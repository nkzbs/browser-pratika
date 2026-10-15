const $ = id => document.getElementById(id);
const input = $("numero"), campo = $("campo"), prefisso = document.querySelector(".prefisso");
const inNome = $("nome"), inCognome = $("cognome"), segnoRubrica = $("in-rubrica");
const selModello = $("modello"), areaTesto = $("testo"), messaggio = $("messaggio");
const inCerca = $("cerca"), suggerimenti = $("suggerimenti"), recentiBox = $("recenti-box"), recentiUl = $("recenti");
const MAX_RECENTI = 5;
let modelli = [], rubrica = {}, allegati = {}, dati = {}, testoModificato = false;

/* ---------- Numeri ---------- */
function normalizza(testo) {
  const haPiu = testo.trim().startsWith("+");
  let cifre = testo.replace(/\D/g, "");
  if (!cifre) return null;
  if (haPiu) {
  } else if (cifre.startsWith("00")) cifre = cifre.slice(2);
  else if (cifre.startsWith("3") && (cifre.length === 9 || cifre.length === 10)) cifre = "39" + cifre;
  else if (cifre.startsWith("39") && (cifre.length === 11 || cifre.length === 12)) {}
  else if (cifre.length < 11) return null;
  if (cifre.length < 8 || cifre.length > 15) return null;
  return cifre;
}
function formatta(c) {
  if (c.startsWith("39") && c[2] === "3") { const n = c.slice(2); return `+39 ${n.slice(0,3)} ${n.slice(3,6)} ${n.slice(6)}`; }
  return "+" + c;
}
const nomeCompleto = c => [c.nome, c.cognome].filter(Boolean).join(" ");

function mostra(testo, tipo) {
  messaggio.textContent = testo;
  messaggio.className = "messaggio" + (tipo ? " " + tipo : "");
}

/* ---------- Messaggi ---------- */
async function preparaModelli() {
  modelli = await caricaModelli();
  selModello.innerHTML = "";
  selModello.add(new Option("Nessun messaggio (chat vuota)", "-1"));
  modelli.forEach((m, i) => selModello.add(new Option(m.titolo, String(i))));
  const { ultimoModello = "-1" } = await chrome.storage.local.get("ultimoModello");
  selModello.value = Number(ultimoModello) < modelli.length ? ultimoModello : "-1";
  aggiornaTesto(true);
}
// Senza nome e cognome scrive "Cliente": "Gentile {NOME} {COGNOME}" -> "Gentile Cliente"
function sostituisciNomi(t) {
  const n = maiuscoleIniziali(inNome.value), c = maiuscoleIniziali(inCognome.value);
  const completo = [n, c].filter(Boolean).join(" ") || "Cliente";
  return t.replace(/\{NOME\}[ ]*\{COGNOME\}/g, completo)
          .replace(/\{COGNOME\}[ ]*\{NOME\}/g, [c, n].filter(Boolean).join(" ") || "Cliente")
          .replace(/\{NOME\}/g, n || "Cliente")
          .replace(/\{COGNOME\}/g, c || (n ? "" : "Cliente"))
          .replace(/[ ]{2,}/g, " ").replace(/[ ]+([,.;:!?])/g, "$1");
}
function immagineScelta() {
  const i = Number(selModello.value);
  const id = i >= 0 && modelli[i].allegatoId;
  return (id && allegati[id]) || null;
}
function aggiornaTesto(nuovoModello) {
  if (nuovoModello) testoModificato = false;
  const img = immagineScelta();
  $("allegato").hidden = !img;
  if (img) $("miniatura").src = img;
  const i = Number(selModello.value);
  if (i < 0) { areaTesto.hidden = true; areaTesto.value = ""; }
  else {
    areaTesto.hidden = false;
    if (!testoModificato) areaTesto.value = sostituisciNomi(compilaDati(modelli[i].testo, dati));
  }
  if (nuovoModello) chrome.storage.local.set({ ultimoModello: selModello.value });
}
function controllaSegnaposto() {
  const q = areaTesto.value.match(/\[[^\]]+\]/);
  if (q) {
    areaTesto.focus();
    areaTesto.setSelectionRange(q.index, q.index + q[0].length);
    mostra("Completa la parte evidenziata " + q[0] + " prima di inviare", "errore");
    return true;
  }
  return false;
}

/* ---------- Rubrica ---------- */
function trovaInRubrica() {
  const cifre = normalizza(input.value);
  const c = cifre && rubrica[cifre];
  segnoRubrica.hidden = !c;
  if (c) {
    if (!inNome.value) inNome.value = c.nome || "";
    if (!inCognome.value) inCognome.value = c.cognome || "";
    aggiornaTesto(false);
  }
}
function cercaNomi(testo) {
  const q = testo.trim().toLowerCase();
  suggerimenti.innerHTML = "";
  if (q.length < 2) { suggerimenti.hidden = true; return; }
  const soloCifre = q.replace(/[\s+.\-\/]/g, "");
  const perNumero = /^\d{3,}$/.test(soloCifre);
  const trovati = Object.entries(rubrica)
    .filter(([num, c]) => perNumero
      ? num.includes(soloCifre.replace(/^0039/, "39"))
      : nomeCompleto(c).toLowerCase().includes(q) || [c.cognome, c.nome].join(" ").toLowerCase().includes(q))
    .sort((a, b) => (a[1].cognome || "").localeCompare(b[1].cognome || ""))
    .slice(0, 8);
  if (!trovati.length) {
    suggerimenti.hidden = false;
    suggerimenti.innerHTML = '<li><button disabled>Nessun cliente trovato in rubrica</button></li>';
    return;
  }
  for (const [cifre, c] of trovati) suggerimenti.appendChild(vocePersona(cifre, c));
  suggerimenti.hidden = false;
}
function vocePersona(cifre, c) {
  const li = document.createElement("li"), b = document.createElement("button");
  b.textContent = c && nomeCompleto(c) ? nomeCompleto(c) : formatta(cifre);
  if (c && nomeCompleto(c)) { const s = document.createElement("small"); s.textContent = formatta(cifre); b.appendChild(s); }
  b.addEventListener("click", () => scegliPersona(cifre));
  li.appendChild(b);
  return li;
}
function scegliPersona(cifre) {
  const c = rubrica[cifre] || {};
  input.value = formatta(cifre);
  prefisso.classList.add("nascosto");
  inNome.value = c.nome || ""; inCognome.value = c.cognome || "";
  segnoRubrica.hidden = !rubrica[cifre];
  suggerimenti.hidden = true;
  inCerca.value = "";
  campo.classList.remove("errore");
  aggiornaTesto(false);
  selModello.focus();
  mostra("Scegli il messaggio e premi Invio");
}
async function salvaSeCompilato(cifre) {
  const nome = maiuscoleIniziali(inNome.value), cognome = maiuscoleIniziali(inCognome.value);
  if (!nome && !cognome) return false;
  await salvaContatto(cifre, nome, cognome);
  rubrica[cifre] = { nome, cognome };
  return true;
}

/* ---------- Azioni ---------- */
async function apriChat(cifre, testo) {
  let url = "https://web.whatsapp.com/send?phone=" + cifre;
  if (testo) url += "&text=" + encodeURIComponent(testo);
  const schede = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  if (schede.length) {
    await chrome.tabs.update(schede[0].id, { url, active: true });
    await chrome.windows.update(schede[0].windowId, { focused: true });
  } else await chrome.tabs.create({ url, active: true });
  const { recenti = [] } = await chrome.storage.local.get("recenti");
  await chrome.storage.local.set({ recenti: [cifre, ...recenti.filter(n => n !== cifre)].slice(0, MAX_RECENTI) });
  window.close();
}
function leggiNumero() {
  const cifre = normalizza(input.value);
  campo.classList.toggle("errore", !cifre);
  if (!cifre) { mostra("Numero non valido: controlla le cifre", "errore"); input.focus(); }
  return cifre;
}
async function invia() {
  const cifre = leggiNumero(); if (!cifre) return;
  const testo = areaTesto.hidden ? "" : areaTesto.value.trim();
  if (testo && controllaSegnaposto()) return;
  await salvaSeCompilato(cifre);
  const img = immagineScelta();
  if (img) {
    try {
      await copiaImmagine(img);
      mostra("Immagine copiata: nella chat premi Ctrl+V per allegarla", "ok");
      await new Promise(r => setTimeout(r, 1800));
    } catch (e) {
      mostra("Non riesco a copiare l'immagine: " + e.message, "errore");
      return;
    }
  } else {
    mostra("Apro la chat con " + formatta(cifre) + "…", "ok");
  }
  apriChat(cifre, testo);
}
async function copiaImmagine(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext("2d").drawImage(img, 0, 0);
  const blob = await new Promise(r => c.toBlob(r, "image/png"));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}
async function inviaSubito() {
  const cifre = leggiNumero(); if (!cifre) return;
  const testo = areaTesto.hidden ? "" : areaTesto.value.trim();
  if (!testo) { mostra("Scegli un messaggio da inviare", "errore"); selModello.focus(); return; }
  if (controllaSegnaposto()) return;
  await salvaSeCompilato(cifre);
  const { recenti = [] } = await chrome.storage.local.get("recenti");
  await chrome.storage.local.set({ recenti: [cifre, ...recenti.filter(n => n !== cifre)].slice(0, MAX_RECENTI) });
  const c = rubrica[cifre];
  let risposta;
  try {
    risposta = await chrome.runtime.sendMessage({
      tipo: "inviaSubito",
      lavoro: { cifre, testo, chi: (c && nomeCompleto(c)) || formatta(cifre), allegato: immagineScelta() }
    });
  } catch (e) {
    risposta = { ok: false, errore: e.message };
  }
  if (!risposta || !risposta.ok) {
    mostra("Invio non avviato: " + ((risposta && risposta.errore) || "nessuna risposta dall'estensione"), "errore");
    return;
  }
  mostra("Invio in corso: l'esito compare sull'icona (✓ o !)", "ok");
  setTimeout(() => window.close(), 1500);
}
async function soloSalva() {
  const cifre = leggiNumero(); if (!cifre) return;
  if (!(await salvaSeCompilato(cifre))) { mostra("Inserisci almeno nome o cognome", "errore"); inNome.focus(); return; }
  segnoRubrica.hidden = false;
  mostra("Salvato in rubrica: " + nomeCompleto(rubrica[cifre]), "ok");
}

/* ---------- Recenti ---------- */
async function caricaRecenti() {
  const { recenti = [] } = await chrome.storage.local.get("recenti");
  recentiUl.innerHTML = "";
  recentiBox.hidden = recenti.length === 0;
  for (const n of recenti) recentiUl.appendChild(vocePersona(n, rubrica[n]));
}

/* ---------- Eventi ---------- */
input.addEventListener("input", () => {
  const v = input.value.trim();
  prefisso.classList.toggle("nascosto", v.startsWith("+") || v.startsWith("00"));
  campo.classList.remove("errore");
  trovaInRubrica();
  mostra("Premi Invio per aprire la chat");
});
const conInvio = fn => e => { if (e.key === "Enter") { e.preventDefault(); fn(); } };
input.addEventListener("keydown", conInvio(invia));

/* Campo "Cerca in rubrica": frecce su/giù per scorrere, Invio per scegliere, Esc per pulire */
inCerca.addEventListener("input", () => cercaNomi(inCerca.value));
inCerca.addEventListener("keydown", e => {
  const voci = [...suggerimenti.querySelectorAll("button:not([disabled])")];
  let i = voci.findIndex(b => b.classList.contains("attivo"));
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!voci.length) return;
    voci[i]?.classList.remove("attivo");
    i = e.key === "ArrowDown" ? (i + 1) % voci.length : (i - 1 + voci.length) % voci.length;
    voci[i].classList.add("attivo");
    voci[i].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault();
    (voci[i] || voci[0])?.click();
  } else if (e.key === "Escape" && inCerca.value) {
    e.preventDefault();
    inCerca.value = ""; suggerimenti.hidden = true;
  }
});
inNome.addEventListener("keydown", conInvio(() => inCognome.focus()));
inCognome.addEventListener("keydown", conInvio(invia));
selModello.addEventListener("keydown", conInvio(invia));
[inNome, inCognome].forEach(el => el.addEventListener("input", () => aggiornaTesto(false)));
selModello.addEventListener("change", () => aggiornaTesto(true));
areaTesto.addEventListener("input", () => { testoModificato = true; mostra("Ctrl+Invio per aprire la chat"); });
areaTesto.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); invia(); } });
$("apri").addEventListener("click", invia);
$("salva").addEventListener("click", soloSalva);
$("invia").addEventListener("click", inviaSubito);
$("modifica").addEventListener("click", e => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

async function mostraUltimoEsito() {
  const { ultimoEsito } = await chrome.storage.local.get("ultimoEsito");
  if (!ultimoEsito) return;
  const el = $("ultimo");
  el.hidden = false;
  el.className = "ultimo" + (ultimoEsito.ok ? "" : " ko");
  el.textContent = ultimoEsito.ok
    ? `Ultimo invio (${ultimoEsito.t}): inviato a ${ultimoEsito.chi}`
    : `Ultimo invio (${ultimoEsito.t}): NON inviato a ${ultimoEsito.chi} – ${ultimoEsito.motivo}`;
  chrome.action.setBadgeText({ text: "" });
}

(async () => {
  mostraUltimoEsito();
  rubrica = await caricaRubrica();
  allegati = await caricaAllegati();
  dati = await caricaDati();
  await preparaModelli();
  caricaRecenti();
  input.focus();
})();
