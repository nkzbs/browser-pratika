# PRATIKA Browser

Applicazione desktop (Windows) che incorpora l'estensione **PRATIKA – IUV PagoPA** (`extension/pratika-iuv`).
Raccoglie gli IUV da Portale del Trasporto (Motorizzazione) e PRA e li paga in sequenza dall'home banking Sella (CBILL).
Il funzionamento dell'estensione è descritto in [`extension/pratika-iuv/LEGGIMI.txt`](extension/pratika-iuv/LEGGIMI.txt).

## Uso (utenti)
1. Scarica l'installer `.exe` dalla pagina [Releases](../../releases) (o l'artefatto dell'ultima build in *Actions*).
2. Installa ed avvia **PRATIKA Browser**. A destra c'è il pannello IUV (pulsante ▤ per mostrarlo/nasconderlo).
3. Apri Portale/PRA in una scheda, Sella in un'altra, e segui le istruzioni del pannello.

> L'installer non è firmato: Windows SmartScreen può avvisare ("Maggiori informazioni" → "Esegui comunque").

### Scorciatoie
`Ctrl+T` nuova scheda · `Ctrl+W` chiudi · `Ctrl+Tab` cambia scheda · `Ctrl+L` barra indirizzi · `F5`/`Ctrl+R` ricarica ·
`Alt+←/→` indietro/avanti · `Ctrl+B` pannello IUV · `Ctrl +/-/0` zoom · `F12` strumenti sviluppatore (pagina) ·
`Ctrl+Shift+I` strumenti sviluppatore (pannello IUV).

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
| `src/main.js` | Finestra, schede (`WebContentsView`), pannello laterale, iniezione dei content script secondo i `matches` del manifest, API `chrome.tabs`/`scripting` |
| `src/shim-preload.js` | Espone `window.chrome` (`storage`, `runtime`, `tabs`, `scripting`, `permissions`) al pannello e alle pagine abilitate |
| `src/background-host.js` | Esegue `background.js` dell'estensione in un contesto `vm` con un `chrome` finto |
| `src/store.js` | Equivalente di `chrome.storage.local` su file JSON in `%APPDATA%` |
| `src/ui/` | Barra delle schede e degli indirizzi |
| `extension/pratika-iuv/` | Estensione originale (v2.2.6), non modificata |

### Aggiornare l'estensione
Sostituisci il contenuto di `extension/pratika-iuv/` con la nuova versione. Se aggiunge API `chrome.*` non emulate, vanno aggiunte in `src/shim-preload.js` e `src/main.js`.

### Note di sicurezza
- Le schede usano `contextIsolation: false` perché i content script condividono il mondo JS della pagina (es. `window.PratikaExtract`). `window.chrome` è esposto solo ai domini dei `matches` del manifest.
- I dati (IUV, impostazioni) restano sul computer; nessuna telemetria.

## Stato e limiti
Prototipo. Verificato in locale il flusso di acquisizione su una pagina di prova; **non ancora provato** il pagamento reale su Sella né la build Windows.
