# Moduli di PRATIKA Browser

Ogni modulo è un'estensione Chrome (Manifest V3) in `modules/<nome>/`. I moduli sono isolati tra loro:
possono scambiarsi dati solo tramite l'API della piattaforma, con permessi dichiarati nel manifest.

## Moduli presenti

| Modulo | Cartella | Stato | Permessi piattaforma |
|---|---|---|---|
| PRATIKA – IUV PagoPA | `pratika-iuv` | Funzionante in prova; pagamento Sella non provato | – |
| Apri chat WhatsApp | `autofranciacorta` | Integrato; invio reale non provato (serve il QR) | – |
| Fascicolo clienti e pratiche | `pratika-fascicolo` | Prima versione | `shared`, `send:autofranciacorta` |
| Scadenzario | `pratika-scadenzario` | Prima versione, badge sulle scadenze entro 15 giorni | `shared`, `send:autofranciacorta` |
| Preventivo pratiche | `pratika-preventivo` | Prima versione; tariffario da compilare | `shared`, `send:autofranciacorta` |
| Registro pagamenti | `pratika-registro` | Prima versione, legge i versamenti del modulo IUV | `shared`, `read:pratika-iuv`, `send:autofranciacorta` |

I dati comuni (clienti, pratiche, scadenze) stanno nell'archivio condiviso `shared.json`; ogni modulo ha poi i propri dati in `storage/<modulo>-local.json`.

## API della piattaforma (`chrome.pratika`)

Si dichiarano in `manifest.json`: `"pratika_permissions": ["shared", "send:<modulo>", "read:<modulo>"]`.

| Chiamata | Permesso | Cosa fa |
|---|---|---|
| `chrome.pratika.shared.get/set/remove` | `shared` | Archivio condiviso tra i moduli |
| `chrome.pratika.onSharedChanged.addListener(f)` | `shared` | Notifica i cambiamenti dell'archivio condiviso |
| `chrome.pratika.send(modulo, msg)` | `send:<modulo>` | Invia un messaggio al background di un altro modulo e ne restituisce la risposta |
| `chrome.pratika.read(modulo, area, chiavi)` | `read:<modulo>` | Legge (sola lettura) i dati di un altro modulo |

Esempio: inviare un WhatsApp con il modulo `autofranciacorta`:
`chrome.pratika.send('autofranciacorta', { tipo: 'inviaSubito', lavoro: { cifre: '393331234567', testo: 'Ciao', chi: 'Mario' } })`.

## Moduli da realizzare (non ancora presenti)

Dipendono da pagine o servizi esterni che non abbiamo ancora visto: vanno sviluppati sulle pagine reali.

| Modulo | Cosa serve per costruirlo |
|---|---|
| Controllo targa e visure | Le pagine del portale usate dall'ufficio e un accesso di prova; salva i dati veicolo nel fascicolo |
| Compilazione guidata delle pratiche | Le maschere dei portali da compilare; riporta i dati del fascicolo nei campi |
| Documenti con riconoscimento | Esempi di libretto, carta d'identità e patente; lettura del testo in locale, dati sensibili |
| Fatturazione | Il programma di fatturazione usato dallo studio e il formato di esportazione |
| SEPA | Cosa deve fare (bonifici, addebiti diretti o altro) e quali banche |
