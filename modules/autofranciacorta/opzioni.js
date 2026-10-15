const lista = document.getElementById("lista");
const stato = document.getElementById("stato");
let allegatiSalvati = {};

// Riduce l'immagine (lato lungo max 1600 px) per non appesantire l'estensione
async function preparaImmagine(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scala = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scala);
    c.height = Math.round(img.naturalHeight * scala);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.9);
  } finally { URL.revokeObjectURL(url); }
}

function aggiungiRiquadro(m = { titolo: "", testo: "" }) {
  const box = document.createElement("div");
  box.className = "modello";
  box.innerHTML = `
    <div class="riga">
      <input class="titolo" placeholder="Nome nel menu (es. Pratica pronta)">
      <button class="elimina">Elimina</button>
    </div>
    <textarea class="testo" placeholder="Testo del messaggio"></textarea>
    <div class="immagine">
      <img class="anteprima" alt="Immagine allegata" hidden>
      <span class="nessuna">Nessuna immagine allegata</span>
      <label><button type="button" class="scegli">Allega immagine…</button><input type="file" accept="image/jpeg,image/png,image/webp"></label>
      <button type="button" class="togli" hidden>Togli immagine</button>
    </div>`;
  box.querySelector(".titolo").value = m.titolo;
  box.querySelector(".testo").value = m.testo;
  box.querySelector(".elimina").addEventListener("click", () => box.remove());

  const anteprima = box.querySelector(".anteprima"), nessuna = box.querySelector(".nessuna");
  const togli = box.querySelector(".togli"), fileInput = box.querySelector("input[type=file]");
  const mostraImmagine = dataUrl => {
    box._immagine = dataUrl || null;
    anteprima.hidden = !dataUrl; nessuna.hidden = !!dataUrl; togli.hidden = !dataUrl;
    if (dataUrl) anteprima.src = dataUrl;
    box.querySelector(".scegli").textContent = dataUrl ? "Cambia immagine…" : "Allega immagine…";
  };
  box.querySelector(".scegli").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    if (!fileInput.files[0]) return;
    try { mostraImmagine(await preparaImmagine(fileInput.files[0])); stato.textContent = "Ricorda di premere Salva modifiche"; }
    catch { alert("Non riesco a leggere questa immagine. Usa un file JPEG o PNG."); }
    fileInput.value = "";
  });
  togli.addEventListener("click", () => mostraImmagine(null));
  mostraImmagine(m.allegatoId ? allegatiSalvati[m.allegatoId] : null);

  lista.appendChild(box);
  return box;
}

async function mostraModelli(modelli) {
  allegatiSalvati = await caricaAllegati();
  lista.innerHTML = "";
  modelli.forEach(m => aggiungiRiquadro(m));
}

document.getElementById("aggiungi").addEventListener("click", () => {
  aggiungiRiquadro().querySelector(".titolo").focus();
});

document.getElementById("salva").addEventListener("click", async () => {
  const allegati = {};
  const modelli = [...lista.querySelectorAll(".modello")].map((b, i) => {
    const m = { titolo: b.querySelector(".titolo").value.trim(), testo: b.querySelector(".testo").value.trim() };
    if (b._immagine) {
      const id = "img" + Date.now().toString(36) + i;
      allegati[id] = b._immagine;
      m.allegatoId = id;
    }
    return m;
  }).filter(m => m.titolo && m.testo);
  try {
    await chrome.storage.local.set({ allegati });
    await chrome.storage.sync.set({ modelli });
    await chrome.storage.local.set({ ultimoModello: "-1" });
    allegatiSalvati = allegati;
    stato.textContent = "Salvato";
  } catch (e) {
    stato.textContent = "Errore nel salvataggio: " + e.message;
  }
  setTimeout(() => (stato.textContent = ""), 2500);
});

document.getElementById("ripristina").addEventListener("click", async () => {
  if (!confirm("Ripristinare i messaggi originali? Le modifiche fatte andranno perse.")) return;
  await chrome.storage.sync.remove("modelli");
  mostraModelli(MODELLI_PREDEFINITI);
  stato.textContent = "Messaggi originali ripristinati";
  setTimeout(() => (stato.textContent = ""), 2500);
});

caricaModelli().then(mostraModelli);

/* ---------- Rubrica ---------- */
const corpo = document.querySelector("#tabella tbody");
const cerca = document.getElementById("cerca");
let rubricaCorrente = {};

function fmt(c) {
  if (c.startsWith("39") && c[2] === "3") { const n = c.slice(2); return `+39 ${n.slice(0,3)} ${n.slice(3,6)} ${n.slice(6)}`; }
  return "+" + c;
}
function disegnaRubrica() {
  const q = cerca.value.trim().toLowerCase();
  const righe = Object.entries(rubricaCorrente)
    .filter(([num, c]) => !q || `${c.cognome} ${c.nome} ${c.nome} ${c.cognome} ${num}`.toLowerCase().includes(q.replace(/\s+/g, " ")) || num.includes(q.replace(/\D/g, "") || "§"))
    .sort((a, b) => (a[1].cognome || "").localeCompare(b[1].cognome || "") || (a[1].nome || "").localeCompare(b[1].nome || ""));
  corpo.innerHTML = "";
  for (const [num, c] of righe) {
    const tr = document.createElement("tr");
    const data = c.aggiornato ? new Date(c.aggiornato).toLocaleDateString("it-IT") : "";
    [c.cognome, c.nome, fmt(num), data].forEach((v, i) => {
      const td = document.createElement("td"); td.textContent = v || ""; if (i === 2) td.className = "num"; tr.appendChild(td);
    });
    const td = document.createElement("td"), b = document.createElement("button");
    b.textContent = "Elimina"; b.className = "elimina";
    b.addEventListener("click", async () => {
      if (!confirm(`Eliminare ${c.nome} ${c.cognome} dalla rubrica?`)) return;
      delete rubricaCorrente[num];
      await chrome.storage.local.set({ rubrica: rubricaCorrente });
      disegnaRubrica();
    });
    td.appendChild(b); tr.appendChild(td); corpo.appendChild(tr);
  }
  document.getElementById("vuota").hidden = Object.keys(rubricaCorrente).length > 0;
  document.getElementById("tabella").hidden = Object.keys(rubricaCorrente).length === 0;
}
cerca.addEventListener("input", disegnaRubrica);

document.getElementById("esporta").addEventListener("click", () => {
  const q = v => `"${String(v || "").replace(/"/g, '""')}"`;
  const righe = [["Cognome", "Nome", "Cellulare", "Salvato il"].join(";")];
  for (const [num, c] of Object.entries(rubricaCorrente))
    righe.push([q(c.cognome), q(c.nome), q("+" + num), q(c.aggiornato ? new Date(c.aggiornato).toLocaleDateString("it-IT") : "")].join(";"));
  const blob = new Blob(["\ufeff" + righe.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "rubrica-clienti-" + new Date().toISOString().slice(0, 10) + ".csv";
  a.click();
  URL.revokeObjectURL(a.href);
});

caricaRubrica().then(r => { rubricaCorrente = r; disegnaRubrica(); });


/* ---------- Registro invii ---------- */
const preRegistro = document.getElementById("registro");
async function mostraRegistro() {
  const { registro = [] } = await chrome.storage.local.get("registro");
  preRegistro.textContent = registro.length ? registro.map(r => r.t + "  " + r.testo).join("\n") : "Nessun invio registrato.";
  preRegistro.scrollTop = preRegistro.scrollHeight;
}
document.getElementById("copia-registro").addEventListener("click", async () => {
  await navigator.clipboard.writeText(preRegistro.textContent);
  const st = document.getElementById("stato-registro");
  st.textContent = "Copiato"; setTimeout(() => (st.textContent = ""), 2000);
});
document.getElementById("svuota-registro").addEventListener("click", async () => {
  await chrome.storage.local.set({ registro: [] }); mostraRegistro();
});
chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c.registro) mostraRegistro(); });
mostraRegistro();


/* ---------- Dati dell'attività ---------- */
const boxDati = document.getElementById("dati");
caricaDati().then(d => {
  for (const k of Object.keys(DATI_PREDEFINITI)) {
    const l = document.createElement("label");
    l.className = "dato";
    l.innerHTML = `<span></span> <code>{${k}}</code><input data-chiave="${k}">`;
    l.querySelector("span").textContent = ETICHETTE_DATI[k];
    l.querySelector("input").value = d[k] || "";
    if (k === "TELEFONO") l.querySelector("input").placeholder = "Da inserire: es. 030 1234567";
    boxDati.appendChild(l);
  }
});
document.getElementById("salva-dati").addEventListener("click", async () => {
  const dati = {};
  boxDati.querySelectorAll("input").forEach(i => (dati[i.dataset.chiave] = i.value.trim()));
  await chrome.storage.sync.set({ dati });
  const st = document.getElementById("stato-dati");
  st.textContent = "Salvato"; setTimeout(() => (st.textContent = ""), 2500);
});
