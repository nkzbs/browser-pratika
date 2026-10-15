// Dati dell'attività: si modificano dalla pagina "Messaggi e rubrica" e finiscono nei messaggi
// al posto di {ATTIVITA}, {TELEFONO}, {EMAIL}, {INDIRIZZO}, {ORARI}, {SERVIZI}, {NAVIGAZIONE}.
// Se un dato è vuoto, la riga del messaggio che lo contiene viene tolta.
const DATI_PREDEFINITI = {
  ATTIVITA: "AUTOFRANCIACORTA",
  TELEFONO: "",
  EMAIL: "autofranciacorta@libero.it",
  INDIRIZZO: "Via Roma 29, Timoline – Corte Franca (BS)",
  ORARI: "Lun–Ven 8:30–12:00 e 15:00–19:00 · Sab 9:00–12:00",
  SERVIZI: "tutto ciò che riguarda la Sua auto",
  NAVIGAZIONE: "https://www.google.com/maps/dir/?api=1&destination=AUTOFRANCIACORTA+Via+Roma+29+Timoline&destination_place_id=ChIJ5aiubgBlgUcRsCUkQIbVvko&travelmode=driving&dir_action=navigate"
};
const ETICHETTE_DATI = {
  ATTIVITA: "Nome dell'attività", TELEFONO: "Telefono", EMAIL: "Email", INDIRIZZO: "Indirizzo",
  ORARI: "Orari di apertura", SERVIZI: "Servizi (frase nel messaggio di ringraziamento)", NAVIGAZIONE: "Link di navigazione Google Maps"
};

const NAVIGA = `Come raggiungerci?
🧭 Avvia la navigazione:
{NAVIGAZIONE}`;
const FIRMA = `{ATTIVITA}
📞 {TELEFONO}`;

const MODELLI_PREDEFINITI = [
  { titolo: "Ringraziamento nuovo cliente", testo:
`Gentile {NOME} {COGNOME}, La ringraziamo per averci scelto.
Le ricordiamo che siamo sempre a Sua disposizione per {SERVIZI}.
Per qualsiasi necessità non esiti a contattarci:

📞 {TELEFONO}
✉️ {EMAIL}
📍 {INDIRIZZO}

${NAVIGA}

{ATTIVITA}` },
  { titolo: "Biglietto da visita", testo:
`Gentile {NOME} {COGNOME}, ecco i nostri contatti:

*{ATTIVITA}*
📍 {INDIRIZZO}
📞 {TELEFONO}
✉️ {EMAIL}
🕘 {ORARI}

Salvi il nostro numero, così ci trova sempre a portata di mano!` },
  { titolo: "Pratica pronta per il ritiro", testo:
`Buongiorno, {ATTIVITA} informa che la Sua pratica è pronta per il ritiro presso i Ns. uffici.

📍 {INDIRIZZO}
${NAVIGA}

${FIRMA}` },
  { titolo: "Pratica pronta (con targa)", testo:
`Buongiorno, {ATTIVITA} informa che la pratica relativa al veicolo targato [TARGA] è pronta per il ritiro presso i Ns. uffici.

📍 {INDIRIZZO}
${NAVIGA}

${FIRMA}` },
  { titolo: "Veicolo pronto per il ritiro", testo:
`Buongiorno, {ATTIVITA} informa che il Suo veicolo è pronto per il ritiro.

📍 {INDIRIZZO}
🕘 {ORARI}
${NAVIGA}

${FIRMA}` },
  { titolo: "Documenti mancanti", testo:
`Buongiorno, per completare la Sua pratica ci occorre ancora: [DOCUMENTI].
Può inviarceli in foto su questo numero oppure portarli presso i Ns. uffici.

${FIRMA}` },
  { titolo: "Richiesta foto documenti", testo:
`Buongiorno, per avviare la pratica ci invii per cortesia su questo numero una foto ben leggibile, fronte e retro, della carta d'identità e del codice fiscale (tessera sanitaria).

Grazie,
${FIRMA}` }
];

async function caricaModelli() {
  const { modelli } = await chrome.storage.sync.get("modelli");
  return Array.isArray(modelli) ? modelli : MODELLI_PREDEFINITI;
}
async function caricaDati() {
  const { dati = {} } = await chrome.storage.sync.get("dati");
  return { ...DATI_PREDEFINITI, ...dati };
}
function compilaDati(testo, dati) {
  return testo.split("\n")
    .filter(riga => !Object.keys(DATI_PREDEFINITI).some(k => riga.includes("{" + k + "}") && !String(dati[k] || "").trim()))
    .map(riga => riga.replace(/\{(ATTIVITA|TELEFONO|EMAIL|INDIRIZZO|ORARI|SERVIZI|NAVIGAZIONE)\}/g, (_, k) => dati[k].trim()))
    .join("\n")
    .replace(/Come raggiungerci\?\n🧭 Avvia la navigazione:\n(?!http)/g, "")
    .replace(/\n{3,}/g, "\n\n").trim();
}

/* ---- Rubrica (salvata solo su questo computer) ---- */
async function caricaRubrica() {
  const { rubrica = {} } = await chrome.storage.local.get("rubrica");
  return rubrica;
}
async function salvaContatto(cifre, nome, cognome) {
  const rubrica = await caricaRubrica();
  rubrica[cifre] = { nome, cognome, aggiornato: new Date().toISOString() };
  await chrome.storage.local.set({ rubrica });
}
function maiuscoleIniziali(t) {
  return t.trim().toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

/* ---- Immagini allegate ai messaggi (salvate solo su questo computer) ---- */
async function caricaAllegati() {
  const { allegati = {} } = await chrome.storage.local.get("allegati");
  return allegati;
}
