// Gestisce gli invii "silenziosi": una coda, un invio alla volta, nella scheda di WhatsApp Web.
// Ogni passaggio viene scritto nel "Registro invii" (pagina Messaggi e rubrica) per capire dove si blocca.
const SCADENZA_MS = 75000;

function formatta(c) {
  if (c.startsWith("39") && c[2] === "3") { const n = c.slice(2); return `+39 ${n.slice(0,3)} ${n.slice(3,6)} ${n.slice(6)}`; }
  return "+" + c;
}
const leggi = async k => (await chrome.storage.session.get(k))[k];
const scrivi = (k, v) => chrome.storage.session.set({ [k]: v });

async function registra(testo) {
  const { registro = [] } = await chrome.storage.local.get("registro");
  registro.push({ t: new Date().toLocaleString("it-IT"), testo });
  await chrome.storage.local.set({ registro: registro.slice(-60) });
}

async function accoda(lavoro) {
  const coda = (await leggi("coda")) || [];
  coda.push({ ...lavoro, id: Date.now() + "-" + Math.random().toString(36).slice(2, 7) });
  await scrivi("coda", coda);
  await registra(`Richiesta di invio a ${lavoro.chi} (${formatta(lavoro.cifre)})` + (lavoro.allegato ? " con immagine" : ""));
  await controllaBloccati();
  if (!(await leggi("inCorso"))) await prossimo();
  else await registra("Un altro invio è in corso: messo in coda");
}

async function prossimo() {
  const coda = (await leggi("coda")) || [];
  if (!coda.length) return;
  const lavoro = coda.shift();
  await scrivi("coda", coda);
  try {
    let [scheda] = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
    if (scheda) {
      await registra(`Uso la scheda di WhatsApp Web già aperta (n. ${scheda.id})`);
    } else {
      scheda = await chrome.tabs.create({ url: "about:blank", active: false, pinned: true });
      await registra(`Nessuna scheda di WhatsApp Web aperta: ne creo una fissata (n. ${scheda.id})`);
    }
    await scrivi("inCorso", { ...lavoro, tabId: scheda.id, avviato: Date.now(), fase: "apertura della chat" });
    const url = "https://web.whatsapp.com/send?phone=" + lavoro.cifre + "&text=" + encodeURIComponent(lavoro.testo);
    await chrome.tabs.update(scheda.id, { url });
    await registra("Chat in caricamento nella scheda di WhatsApp Web");
    chrome.alarms.create("controllo-invio", { periodInMinutes: 0.5 });
  } catch (e) {
    await registra("ERRORE nell'aprire la chat: " + e.message);
    await concludi({ ...lavoro, tabId: null }, false, "errore nell'aprire WhatsApp Web (" + e.message + ")");
  }
}

async function controllaBloccati() {
  const inCorso = await leggi("inCorso");
  if (inCorso && Date.now() - inCorso.avviato > SCADENZA_MS + (inCorso.allegato ? 40000 : 0)) {
    await registra("Nessuna risposta da WhatsApp Web entro il tempo limite");
    await concludi(inCorso, false, "nessuna risposta da WhatsApp Web (ultima fase: " + inCorso.fase + ")");
  }
}

async function concludi(lavoro, ok, motivo) {
  await chrome.storage.session.remove("inCorso");
  if (lavoro.schedaPrecedente) { try { await chrome.tabs.update(lavoro.schedaPrecedente, { active: true }); } catch {} }

  await registra(ok ? `✓ Inviato a ${lavoro.chi}` : `✗ NON inviato a ${lavoro.chi}: ${motivo}`);
  await chrome.storage.local.set({ ultimoEsito: { ok, chi: lavoro.chi, motivo: motivo || "", t: new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) } });

  // Segnale sull'icona dell'estensione: funziona anche se le notifiche di Windows sono spente
  await chrome.action.setBadgeBackgroundColor({ color: ok ? "#1FA855" : "#B3261E" });
  await chrome.action.setBadgeText({ text: ok ? "✓" : "!" });
  if (ok) setTimeout(() => chrome.action.setBadgeText({ text: "" }), 15000);

  const idNotifica = "esito-" + lavoro.id;
  chrome.notifications.create(idNotifica, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: ok ? "Messaggio inviato" : "Messaggio NON inviato",
    message: ok ? `A ${lavoro.chi} (${formatta(lavoro.cifre)})` : `${lavoro.chi}: ${motivo}. Clicca qui per aprire WhatsApp.`,
    priority: ok ? 0 : 2,
    requireInteraction: !ok
  });
  const mappa = (await leggi("notifiche")) || {};
  mappa[idNotifica] = lavoro.tabId;
  await scrivi("notifiche", mappa);

  const coda = (await leggi("coda")) || [];
  if (coda.length) await prossimo(); else chrome.alarms.clear("controllo-invio");
}

chrome.alarms.onAlarm.addListener(a => { if (a.name === "controllo-invio") controllaBloccati(); });

chrome.runtime.onMessage.addListener((msg, sender, rispondi) => {
  (async () => {
    const inCorso = await leggi("inCorso");
    if (msg.tipo === "inviaSubito") {
      await accoda(msg.lavoro);
      rispondi({ ok: true });
    } else if (msg.tipo === "chiediLavoro") {
      const mio = inCorso && inCorso.tabId === sender.tab?.id;
      if (inCorso) await registra(mio ? "WhatsApp Web caricato: l'estensione è attiva nella pagina" : `WhatsApp Web caricato in un'altra scheda (n. ${sender.tab?.id}), non in quella dell'invio`);
      rispondi(mio ? inCorso : null);
    } else if (msg.tipo === "progresso") {
      if (inCorso && inCorso.id === msg.id && inCorso.fase !== msg.fase) {
        inCorso.fase = msg.fase;
        await scrivi("inCorso", inCorso);
        await registra("Fase: " + msg.fase);
      }
      rispondi(true);
    } else if (msg.tipo === "serveVisibile") {
      if (inCorso && inCorso.id === msg.id) {
        const scheda = await chrome.tabs.get(inCorso.tabId);
        const [attiva] = await chrome.tabs.query({ active: true, windowId: scheda.windowId });
        if (attiva && attiva.id !== scheda.id) inCorso.schedaPrecedente = attiva.id;
        await scrivi("inCorso", inCorso);
        await chrome.tabs.update(scheda.id, { active: true });
        await registra("La scheda era in secondo piano: la rendo attiva per completare l'invio");
      }
      rispondi(true);
    } else if (msg.tipo === "esito") {
      if (inCorso && inCorso.id === msg.id) await concludi(inCorso, msg.ok, msg.motivo);
      rispondi(true);
    }
  })().catch(async e => { await registra("ERRORE interno: " + e.message); rispondi({ ok: false, errore: e.message }); });
  return true;
});

chrome.tabs.onRemoved.addListener(async tabId => {
  const inCorso = await leggi("inCorso");
  if (inCorso && inCorso.tabId === tabId) await concludi(inCorso, false, "la scheda di WhatsApp è stata chiusa");
});

chrome.notifications.onClicked.addListener(async id => {
  const mappa = (await leggi("notifiche")) || {};
  chrome.notifications.clear(id);
  try {
    const scheda = await chrome.tabs.get(mappa[id]);
    await chrome.tabs.update(scheda.id, { active: true });
    await chrome.windows.update(scheda.windowId, { focused: true });
  } catch { chrome.tabs.create({ url: "https://web.whatsapp.com/" }); }
});
