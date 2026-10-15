// Gira dentro WhatsApp Web. Agisce SOLO se l'estensione ha un invio in sospeso per questa scheda:
// 1) invia il testo  2) se c'è un'immagine allegata, la incolla nella chat e la invia.
(async () => {
  let lavoro = null;
  for (let i = 0; i < 4 && !lavoro; i++) {
    try { lavoro = await chrome.runtime.sendMessage({ tipo: "chiediLavoro" }); } catch { return; }
    if (!lavoro) await new Promise(r => setTimeout(r, 800));
  }
  if (!lavoro) return;

  const log = (...a) => console.log("[Apri chat WhatsApp]", ...a);
  const fuoriDaSide = el => el && !el.closest("#side, #pane-side");
  const primo = (sel, filtro = () => true) => [...document.querySelectorAll(sel)].find(e => fuoriDaSide(e) && filtro(e));
  const SEL_INVIA = ['button[aria-label="Invia"]', 'button[aria-label="Send"]', '[data-icon="wds-ic-send-filled"]', '[data-icon="send"]', '[data-icon*="send"]'].join(",");
  const comeTasto = el => el ? (el.closest('button, [role="button"]') || el) : null;

  const trovaCasella = () => primo([
    '#main footer [contenteditable="true"]', 'footer [contenteditable="true"]',
    '[contenteditable="true"][data-tab="10"]',
    'div[role="textbox"][contenteditable="true"][aria-label*="messaggio" i]',
    'div[role="textbox"][contenteditable="true"][aria-label*="message" i]'
  ].join(","));
  const trovaInvia = () => comeTasto(primo(SEL_INVIA, e => !!e.closest("footer")) || primo(SEL_INVIA));
  // Il tasto Invia della finestra dell'immagine non sta nella barra in basso della chat
  const trovaInviaImmagine = () => comeTasto(primo(SEL_INVIA, e => !e.closest("footer")));

  const premiInvio = casella => {
    casella.focus();
    for (const tipo of ["keydown", "keypress", "keyup"])
      casella.dispatchEvent(new KeyboardEvent(tipo, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
  };

  const trovaChiusuraAnteprima = casella => {
    const zona = casella.closest("footer") || document.querySelector("#main footer");
    if (!zona) return null;
    const el = [...zona.querySelectorAll(['button[aria-label*="anteprima" i]', 'button[aria-label*="preview" i]',
      '[data-icon="x"]', '[data-icon="x-alt"]', '[data-icon="wds-ic-close"]', '[data-icon*="close"]'].join(","))]
      .find(e => !casella.contains(e));
    return comeTasto(el);
  };

  // Immagine allegata: da testo base64 a file
  let fileImmagine = null;
  if (lavoro.allegato) {
    const [testa, dati] = lavoro.allegato.split(",");
    const tipo = (testa.match(/data:([^;]+)/) || [])[1] || "image/jpeg";
    const bin = atob(dati), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    fileImmagine = new File([arr], "biglietto-da-visita." + (tipo.split("/")[1] || "jpg"), { type: tipo });
  }
  const contenitore = () => { const d = new DataTransfer(); d.items.add(fileImmagine); return d; };
  const incolla = casella => {
    casella.focus();
    casella.dispatchEvent(new ClipboardEvent("paste", { clipboardData: contenitore(), bubbles: true, cancelable: true }));
  };
  const trascina = () => {
    const zona = document.querySelector("#main") || document.body;
    const dt = contenitore();
    for (const tipo of ["dragenter", "dragover", "drop"])
      zona.dispatchEvent(new DragEvent(tipo, { dataTransfer: dt, bubbles: true, cancelable: true }));
  };

  let fase = "caricamento di WhatsApp Web", faseInviata = "";
  let stato = "testo";            // testo -> immagine-incolla -> immagine-editor
  let tentativo = 0, ultimoTentativo = 0, chiestoVisibile = false;
  let testoVistoAlle = 0, anteprimaGestita = false;
  let tempoImmagine = 0, trascinato = false, cliccatoImmagine = 0;
  const inizio = Date.now();
  const limite = fileImmagine ? 90000 : 60000;

  const esito = (ok, motivo) => {
    clearInterval(timer);
    log(ok ? "inviato" : "non inviato: " + motivo);
    chrome.runtime.sendMessage({ tipo: "esito", id: lavoro.id, ok, motivo });
  };

  const timer = setInterval(() => {
    if (fase !== faseInviata) { faseInviata = fase; chrome.runtime.sendMessage({ tipo: "progresso", id: lavoro.id, fase }).catch(() => {}); }

    const pagina = document.body ? document.body.innerText : "";
    if (/tramite (l'|un )?url non è valido|shared via url is invalid/i.test(pagina))
      return esito(false, "il numero non risulta registrato su WhatsApp");
    if (/aperto in un'altra finestra|open in another window/i.test(pagina))
      return esito(false, "WhatsApp Web è aperto in un'altra finestra o nell'app");

    const casella = trovaCasella();
    const testo = casella ? casella.textContent.trim() : "";

    /* ----- Fase immagine ----- */
    if (stato === "immagine-incolla") {
      if (Date.now() - tempoImmagine < 1000 || !casella) return;
      fase = "incollo l'immagine nella chat";
      incolla(casella);
      stato = "immagine-editor"; tempoImmagine = Date.now();
      return;
    }
    if (stato === "immagine-editor") {
      const tasto = trovaInviaImmagine();
      if (!cliccatoImmagine) {
        if (tasto) { fase = "immagine pronta, premo Invia"; tasto.click(); cliccatoImmagine = Date.now(); return; }
        if (!trascinato && Date.now() - tempoImmagine > 4000) { fase = "provo ad allegare l'immagine trascinandola"; trascina(); trascinato = true; tempoImmagine = Date.now(); return; }
        if (trascinato && Date.now() - tempoImmagine > 5000) return esito(false, "testo inviato, ma non sono riuscito ad allegare l'immagine");
      } else {
        if (!tasto) return esito(true);
        if (Date.now() - cliccatoImmagine > 3000 && Date.now() - cliccatoImmagine < 3600) tasto.click();
        if (Date.now() - cliccatoImmagine > 10000) return esito(false, "testo inviato, ma l'immagine non è partita");
      }
      return;
    }

    /* ----- Fase testo ----- */
    if (tentativo > 0 && casella && !testo) {
      if (fileImmagine) { stato = "immagine-incolla"; tempoImmagine = Date.now(); fase = "testo inviato, allego l'immagine"; return; }
      return esito(true);
    }

    if (casella && testo && !anteprimaGestita && /https?:\/\//.test(testo)) {
      if (!testoVistoAlle) testoVistoAlle = Date.now();
      const chiudi = trovaChiusuraAnteprima(casella);
      if (chiudi) { chiudi.click(); anteprimaGestita = true; fase = "anteprima del link chiusa"; ultimoTentativo = Date.now() - 1800; return; }
      if (Date.now() - testoVistoAlle < 4000) { fase = "attesa anteprima del link"; return; }
      anteprimaGestita = true; fase = "anteprima del link non trovata, invio comunque";
    }

    if (casella && testo) {
      if (!fase.startsWith("anteprima")) fase = "chat aperta con il testo, invio non riuscito";
      if (Date.now() - ultimoTentativo > 2500 && tentativo < 4) {
        tentativo++; ultimoTentativo = Date.now();
        const tasto = trovaInvia();
        if (tasto && tentativo % 2 === 1) { log("clic su Invia (tentativo " + tentativo + ")"); tasto.click(); }
        else { log("tasto Invio (tentativo " + tentativo + ")"); premiInvio(casella); }
      }
    } else if (casella) {
      fase = "chat aperta ma senza testo";
    } else if (document.querySelector("#side")) {
      fase = "WhatsApp caricato ma la chat non si è aperta";
    }

    if (!chiestoVisibile && document.hidden && Date.now() - inizio > 8000 && tentativo === 0) {
      chiestoVisibile = true;
      chrome.runtime.sendMessage({ tipo: "serveVisibile", id: lavoro.id });
    }

    if (tentativo >= 4 && Date.now() - ultimoTentativo > 3000) return esito(false, fase);
    if (Date.now() - inizio > limite) {
      esito(false, document.querySelector("#side") ? fase : "WhatsApp Web non è collegato (serve il QR code)");
    }
  }, 500);
})();
