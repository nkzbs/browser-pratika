# Store dei moduli

Lo Store (barra laterale → *Store moduli*) elenca i moduli, mostra cosa possono fare e permette di attivarli, spegnerli, installarli e rimuoverli.

## Come funziona
- **Moduli inclusi** (cartella `modules/` del programma): si possono attivare e spegnere, non rimuovere.
- **Moduli installati dallo Store** vanno in `%APPDATA%/PRATIKA Browser/modules/<id>/` (cartella dei dati dell'app). Si possono rimuovere; **i loro dati restano** (cartella `storage/`).
- **Moduli spenti** non avviano il background, non si inseriscono nelle pagine e spariscono dalla barra laterale.
- **Catalogo:** `src/catalog.json` (incluso) più `catalog/catalog.json` su GitHub, scaricato all'avvio. Il catalogo online ha la precedenza e può aggiungere moduli nuovi. Se è irraggiungibile, l'app usa quello incluso.
- **"Mi interessa"** sui moduli *In arrivo* viene salvato solo sul computer: non viene inviato a nessuno.

## Formato del catalogo
```json
{ "version": 1, "modules": [
  { "id": "nome-modulo", "name": "Nome", "letter": "N", "color": "#1a73e8", "category": "Clienti e pratiche",
    "status": "download", "price": "Modulo aggiuntivo", "description": "…", "long": "…",
    "version": "1.0.0", "url": "https://…/nome-modulo-1.0.0.zip", "sha256": "<64 caratteri esadecimali>" } ] }
```
`status` può essere `bundled` (incluso), `download` (installabile) o `soon` (in arrivo).

## Pubblicare un modulo scaricabile
1. Prepara il modulo come estensione Manifest V3 **autonoma** (non può usare le risorse condivise `modules/_shared` dei moduli inclusi) e comprimila in `.zip`: `manifest.json` alla radice, oppure in un'unica cartella di primo livello.
2. Calcola lo SHA-256 del file (`certutil -hashfile file.zip SHA256` su Windows) e mettilo in `sha256`.
3. Carica lo zip (per esempio come allegato di una release GitHub) e aggiungi la voce in `catalog/catalog.json`.
4. Se il modulo usa i dati condivisi o altri moduli, dichiara in `manifest.json`: `"pratika_permissions": ["shared", "send:<modulo>", "read:<modulo>"]`.

## Sicurezza
- Il download viene accettato solo con **HTTPS** e solo se lo SHA-256 corrisponde a quello del catalogo; senza `sha256` l'installazione è rifiutata.
- Prima di installare si mostra una finestra con i **permessi** del modulo, da confermare.
- Gli archivi sono controllati (percorsi, dimensione, Manifest V3) e un modulo installato non può sostituire uno incluso.
- **Limiti attuali:** i moduli non sono firmati e i permessi mostrati sono quelli *dichiarati*: l'app non li fa rispettare tutti in modo rigido. Installa solo moduli di cui ti fidi. Il catalogo ospitato su GitHub è affidabile quanto l'account che lo pubblica.
- **Non ancora provati end-to-end:** download dal catalogo online e finestra di conferma (verificati le parti: controlli dell'archivio, attivazione, spegnimento, disinstallazione).
