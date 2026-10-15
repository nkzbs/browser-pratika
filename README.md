# PRATIKA Browser

Applicazione desktop (Windows): un browser a **moduli**. Ogni modulo è un'estensione Chrome (Manifest V3) nella cartella `modules/`.

| Modulo | Cartella | Cosa fa |
|---|---|---|
| PRATIKA – IUV PagoPA | `modules/pratika-iuv` | Raccoglie gli IUV da Portale del Trasporto e PRA e li paga in sequenza da Sella (CBILL). Vedi [`LEGGIMI.txt`](modules/pratika-iuv/LEGGIMI.txt) |
| Apri chat WhatsApp (AUTOFRANCIACORTA) | `modules/autofranciacorta` | Rubrica, messaggi predefiniti e invio su WhatsApp Web |
| Fascicolo clienti e pratiche | `modules/pratika-fascicolo` | Clienti, pratiche con stato, avviso al cliente via WhatsApp |
| Scadenzario | `modules/pratika-scadenzario` | Bollo, revisione, assicurazione; badge e promemoria WhatsApp |
| Preventivo pratiche | `modules/pratika-preventivo` | Tariffario dello studio, preventivo, crea la pratica nel Fascicolo |
| Registro pagamenti | `modules/pratika-registro` | Pagamenti IUV assegnati ai clienti, CSV, ricevuta via WhatsApp |

Elenco completo, API di piattaforma (`chrome.pratika`) e moduli ancora da realizzare: [`docs/MODULI.md`](docs/MODULI.md).

## Uso (utenti)
1. Scarica l'installer `.exe` dalla pagina [Releases](../../releases) (o l'artefatto dell'ultima build in *Actions*).
2. Installa (un clic, senza diritti di amministratore) e avvia **PRATIKA Browser**: un solo file contiene il browser e tutti i moduli. A destra c'è il pannello IUV (pulsante ▤ per mostrarlo/nasconderlo).
3. Apri Portale/PRA in una scheda, Sella in un'altra, e segui le istruzioni del pannello.

> L'installer non è firmato: Windows SmartScreen può avvisare ("Maggiori informazioni" → "Esegui comunque").

### Scorciatoie
`Ctrl+T` nuova scheda · `Ctrl+W` chiudi · `Ctrl+Tab` cambia scheda · `Ctrl+L` barra indirizzi · `F5`/`Ctrl+R` ricarica ·
`Alt+←/→` indietro/avanti · `Ctrl+1`, `Ctrl+2`… (o la scorciatoia del modulo, es. `Alt+W`) apre il pannello del modulo · `Ctrl+B` lo nasconde · `Ctrl +/-/0` zoom · `F12` strumenti sviluppatore (pagina) ·
`Ctrl+Shift+I` strumenti sviluppatore (pannello aperto).

## Sviluppo
Requisiti: Node.js 22+.

```bash
npm install
npm start          # avvia l'app
npm run dist       # crea l'installer Windows in dist/ (da eseguire su Windows)
```

## Architettura
Electron non supporta `chrome.sidePanel` e solo in parte le API delle estensioni, quindi l'estensione
**non viene caricata come estensione**: il suo codice resta invariato e l'app ne emula il contesto.

| File | Ruolo |
|---|---|
| `src/main.js` | Finestra, schede, caricamento dei moduli, iniezione dei content script secondo i `matches`, smistamento dei messaggi, notifiche, allarmi, badge |
| `src/shim-preload.js` | Costruisce il `window.chrome` di ciascun modulo (`storage` local/sync/session, `runtime`, `tabs`, `scripting`, `notifications`, `alarms`, `action`…) |
| `src/bg-host.html` | Finestra nascosta in cui gira il `background.js` di ogni modulo |
| `src/store.js` | Equivalente di `chrome.storage` su file JSON in `%APPDATA%/…/storage/<modulo>-<area>.json` |
| `src/ui/` | Barra delle schede, indirizzi e pulsanti dei moduli (con badge) |
| `modules/*/` | I moduli, con il codice originale delle estensioni, non modificato |

Ogni modulo ha la propria memoria, i propri messaggi e il proprio background: i moduli non si vedono tra loro.
Il pannello di un modulo (`side_panel` o `action.default_popup`) si apre con il suo pulsante nella barra o con la sua scorciatoia (es. `Alt+W` per WhatsApp).

### Aggiungere o aggiornare un modulo
Metti l'estensione decompressa in `modules/<nome>/` (con il suo `manifest.json`) e riavvia. Per aggiornarla sostituisci la cartella.
Se usa API `chrome.*` non emulate, vanno aggiunte in `src/shim-preload.js` (lato modulo) e `src/main.js` (lato app).
Un modulo che deve agire sulla stessa pagina di un altro non è supportato: per ogni pagina `window.chrome` appartiene al primo modulo che la dichiara nei suoi `matches`.

### Note sul modulo WhatsApp
- Al primo uso scansiona il QR di WhatsApp Web nella scheda che si apre; la sessione resta salvata.
- L'invio funziona solo se la scheda è visibile: il modulo la porta in primo piano da solo e poi ripristina la scheda precedente.
- L'app si presenta a WhatsApp Web come un normale Chrome (senza il token "Electron").
- L'automazione di WhatsApp Web può essere contraria ai termini del servizio e portare al blocco del numero: valutare l'API ufficiale (WhatsApp Business) per un uso commerciale.

### Note di sicurezza
- Le schede usano `contextIsolation: false` perché i content script condividono il mondo JS della pagina (es. `window.PratikaExtract`). `window.chrome` è esposto solo ai domini dei `matches` del manifest.
- I dati (IUV, impostazioni) restano sul computer; nessuna telemetria.

## Stato e limiti
Prototipo. Verificato in locale: acquisizione IUV su una pagina di prova e invio dei messaggi dal pannello WhatsApp fino alla coda del background. **Non ancora provati**: pagamento reale su Sella, invio reale su WhatsApp Web (richiede il QR) e l'esecuzione dell'installer su Windows.
