// Estrattore IUV / codici avviso PagoPA.
// Usato sia come content script sul Portale del Trasporto, sia dal pannello (per il testo incollato).
(() => {
  if (window.PratikaExtract) return;

  const RX = {
    iuv: /\bI\.?\s?U\.?\s?V\.?\b|identificativo\s+univoco/i,
    avviso: /(codice|cod\.?|numero|n\.|n°)\s*(di\s*|dell'?\s*)?avviso/i,
    importo: /importo|totale|ammontare|euro|€/i,
    causale: /causale|descrizione|tipologia|\btipo|servizio|oggetto|tariffa|motivo/i,
    stato: /stato|esito|pagat/i,
    data: /\bdata\b|del\s*$|scadenza|creat/i,
    ente: /codice\s*fiscale|c\.?\s?f\.?|ente/i,
    rif: /targa|pratica|riferimento|rif\.|telaio|repertorio|\bRP\b/i,
    // sequenze di cifre (anche raggruppate con spazio o trattino) di 15-18 cifre
    run: /\d(?:\d|[  \-](?=\d)){13,24}\d/g,
    money: /(?:€|EUR)\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+[.,]\d{2})|(\d{1,3}(?:\.\d{3})*,\d{2}|\d+[.,]\d{2})\s*(?:€|EUR|euro)/i,
    moneyLoose: /\d{1,3}(?:\.\d{3})*,\d{2}|\d+\.\d{2}\b/,
    date: /\b(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/,
    cf11: /\b(\d{11})\b/
  };

  const isPaidText = s => /^\s*(si|sì|s|pagat[oa]|eseguit[oa]|incassat[oa])\b/i.test(s || '') && !/non\s+pagat|da\s+pagare/i.test(s || '');
  const ENTE_ACI = '00493410583';
  // MCTC = Motorizzazione (Portale del Trasporto), PRA = ACI
  function fonteOf(url, ente) {
    if (/\.aci(\/|:|$)|aci\.it/i.test(url || '') || ente === ENTE_ACI) return 'PRA';
    return 'MCTC';
  }
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const digits = s => (s || '').replace(/\D/g, '');

  // Da una sequenza di cifre ricava {iuv, avviso}. hint: 'iuv' | 'avviso' | null
  function normalize(raw, hint) {
    const d = digits(raw);
    if (d.length === 18 && /^[0-3]/.test(d)) {
      if (d[0] === '0') return { avviso: d, iuv: d.slice(3) };
      return { avviso: d, iuv: d.slice(1) };
    }
    if (d.length === 17) return { iuv: d, avviso: '3' + d };
    if (d.length === 15 && (hint === 'iuv' || hint === 'avviso')) return { iuv: d, avviso: '' };
    return null;
  }

  function findCodes(text, hint) {
    const out = [];
    const t = text || '';
    RX.run.lastIndex = 0;
    let m;
    while ((m = RX.run.exec(t))) {
      const n = normalize(m[0], hint);
      if (n) { out.push(n); continue; }
      // la sequenza potrebbe unire più numeri vicini: prova le combinazioni di gruppi consecutivi
      const tok = m[0].split(/[ \u00A0\-]/).filter(Boolean);
      for (let i = 0; i < tok.length; i++) {
        let best = null, bestJ = i;
        let acc = '';
        for (let j = i; j < tok.length && acc.length < 18; j++) {
          acc += tok[j];
          const r = normalize(acc, hint);
          if (r) { best = r; bestJ = j; }
        }
        if (best) { out.push(best); i = bestJ; }
      }
    }
    return out;
  }

  function moneyIn(text, loose) {
    const m = (text || '').match(RX.money);
    if (m) return (m[1] || m[2]).trim();
    if (loose) { const l = (text || '').match(RX.moneyLoose); if (l) return l[0]; }
    return '';
  }
  const dateIn = text => { const m = (text || '').match(RX.date); return m ? m[0].trim() : ''; };

  function cellText(el) {
    let t = el.innerText != null ? el.innerText : el.textContent;
    el.querySelectorAll && el.querySelectorAll('input,textarea').forEach(i => { if (i.value) t += ' ' + i.value; });
    return clean(t);
  }

  // ---------- Tabelle ----------
  function headerMap(headers) {
    const map = {};
    headers.forEach((h, i) => {
      const t = clean(h);
      if (!t) return;
      for (const k of ['iuv', 'avviso', 'importo', 'causale', 'stato', 'data', 'ente', 'rif']) {
        if (map[k] == null && RX[k].test(t)) { map[k] = i; break; }
      }
    });
    return map;
  }

  function rowsOf(table) {
    const rows = [...table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr, :scope > tfoot > tr')];
    return rows.length ? rows : [...table.querySelectorAll('tr')];
  }

  function scanTable(table, pageEnte) {
    const rows = rowsOf(table);
    if (!rows.length) return [];
    let headers = [];
    let start = 0;
    const thead = table.querySelector('thead tr');
    if (thead) headers = [...thead.children].map(cellText);
    else if (rows[0].querySelector('th')) { headers = [...rows[0].children].map(cellText); start = 1; }
    const map = headerMap(headers);
    const out = [];
    rows.slice(start).forEach(tr => {
      if (tr.parentElement && tr.parentElement.tagName === 'THEAD') return;
      const cells = [...tr.children].map(cellText);
      if (!cells.length) return;
      const rowText = cells.join(' | ');
      let codes = [];
      if (map.iuv != null) codes = findCodes(cells[map.iuv], 'iuv');
      if (!codes.length && map.avviso != null) codes = findCodes(cells[map.avviso], 'avviso');
      if (!codes.length) codes = findCodes(rowText, null);
      // se esistono sia colonna IUV che avviso, prendi l'avviso esatto
      if (codes.length && map.avviso != null) {
        const av = findCodes(cells[map.avviso], 'avviso')[0];
        if (av && av.avviso && av.iuv === codes[0].iuv) codes[0].avviso = av.avviso;
      }
      const seen = new Set();
      codes.forEach(c => {
        if (seen.has(c.iuv)) return; seen.add(c.iuv);
        const enteCell = map.ente != null ? (cells[map.ente].match(RX.cf11) || [])[1] : '';
        out.push({
          iuv: c.iuv,
          avviso: c.avviso,
          importo: map.importo != null ? moneyIn(cells[map.importo], true) : moneyIn(rowText),
          causale: map.causale != null ? cells[map.causale] : '',
          data: map.data != null ? dateIn(cells[map.data]) || cells[map.data] : dateIn(rowText),
          stato: map.stato != null ? cells[map.stato] : '',
          pagatoFonte: map.stato != null && isPaidText(cells[map.stato]),
          ente: enteCell || pageEnte || '',
          rif: map.rif != null ? cells[map.rif] : ''
        });
      });
    });
    return out;
  }

  // ---------- Fuori dalle tabelle (schede, riepiloghi, campi) ----------
  function contextBlock(el) {
    let cur = el, best = el;
    for (let i = 0; i < 5 && cur && cur !== document.body; i++) {
      const len = clean(cur.innerText || cur.textContent).length;
      if (len > 700) break;
      best = cur;
      if (/^(LI|FIELDSET|SECTION|ARTICLE|FORM|DL)$/.test(cur.tagName) || /card|panel|box|riepilog|dettagl|item|row/i.test(cur.className || '')) break;
      cur = cur.parentElement;
    }
    return best;
  }

  function labeledValue(text, rx) {
    // "Causale: xxxx" su una riga
    const lines = (text || '').split(/\n|\|/);
    for (const l of lines) {
      const m = l.match(/^\s*([^:]{2,40}):\s*(.+)$/);
      if (m && rx.test(m[1])) return clean(m[2]);
    }
    return '';
  }

  function scanLoose(root, pageEnte, skip) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits = new Set();
    let n;
    while ((n = walker.nextNode())) {
      if (!/\d{4}/.test(n.nodeValue)) continue;
      const el = n.parentElement;
      if (!el || el.closest('table') || el.closest('script,style,noscript')) continue;
      hits.add(el);
    }
    root.querySelectorAll('input[value], input').forEach(i => {
      if (i.value && /\d{15}/.test(digits(i.value)) && !i.closest('table')) hits.add(i);
    });
    hits.forEach(el => {
      const own = el.tagName === 'INPUT' ? el.value : (el.innerText || el.textContent);
      const labelCtx = clean((el.previousElementSibling && el.previousElementSibling.textContent) || '') + ' ' +
        clean((el.closest('label,dt,dd,div,p,li') || el).textContent || '');
      const hint = RX.iuv.test(labelCtx) ? 'iuv' : RX.avviso.test(labelCtx) ? 'avviso' : null;
      const codes = findCodes(own, hint);
      if (!codes.length) return;
      const block = contextBlock(el);
      const bt = block.innerText || block.textContent || '';
      codes.forEach(c => {
        if (skip.has(c.iuv)) return;
        skip.add(c.iuv);
        out.push({
          iuv: c.iuv,
          avviso: c.avviso,
          importo: labeledValue(bt, RX.importo) ? moneyIn(labeledValue(bt, RX.importo), true) : moneyIn(bt),
          causale: labeledValue(bt, RX.causale),
          data: dateIn(bt),
          stato: labeledValue(bt, RX.stato),
          ente: (labeledValue(bt, /codice\s*fiscale.*ente|ente.*creditore|c\.?f\.?\s*ente/i).match(RX.cf11) || [])[1] || pageEnte || '',
          rif: labeledValue(bt, RX.rif)
        });
      });
    });
    return out;
  }

  function pageEnteOf(text) {
    const m = (text || '').match(/(?:codice\s*fiscale\s*(?:dell'?\s*)?ente(?:\s*creditore)?|c\.?\s?f\.?\s*ente(?:\s*creditore)?)[^\d]{0,40}(\d{11})/i);
    return m ? m[1] : '';
  }

  function scanDocument(doc) {
    doc = doc || document;
    const body = doc.body;
    if (!body) return [];
    const pageText = body.innerText || body.textContent || '';
    const ente = pageEnteOf(pageText);
    const res = [];
    const seen = new Set();
    doc.querySelectorAll('table').forEach(t => {
      if (t.querySelector('table')) return; // solo tabelle "foglia"
      scanTable(t, ente).forEach(r => { if (!seen.has(r.iuv)) { seen.add(r.iuv); res.push(r); } });
    });
    scanLoose(body, ente, seen).forEach(r => res.push(r));
    return res;
  }

  // Testo incollato (copiato da pagina, PDF, email…)
  function scanText(text) {
    const ente = pageEnteOf(text);
    const lines = (text || '').split(/\r?\n/);
    const res = [];
    const seen = new Set();
    lines.forEach((line, i) => {
      const prev = lines[i - 1] || '';
      const hint = RX.iuv.test(line + prev) ? 'iuv' : RX.avviso.test(line + prev) ? 'avviso' : null;
      findCodes(line, hint).forEach(c => {
        if (seen.has(c.iuv)) return; seen.add(c.iuv);
        const ctx = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
        res.push({ iuv: c.iuv, avviso: c.avviso, importo: moneyIn(line) || moneyIn(ctx), causale: labeledValue(ctx, RX.causale), data: dateIn(line) || dateIn(ctx), stato: '', ente, rif: '' });
      });
    });
    return res;
  }

  // Diagnostica: solo struttura (intestazioni), nessun dato
  function diagnose(doc) {
    doc = doc || document;
    const tables = [...doc.querySelectorAll('table')].map(t => {
      return { intestazioni: [...t.querySelectorAll('th')].map(c => clean(c.textContent)).slice(0, 15), righe: t.querySelectorAll('tr').length };
    });
    const vis = el => el.offsetParent !== null;
    const campi = [...doc.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(vis).slice(0, 40)
      .map(i => ({ tag: i.tagName.toLowerCase(), tipo: i.type, nome: i.name || i.id || '', placeholder: i.placeholder || '', opzioni: i.tagName === 'SELECT' ? [...i.options].map(o => clean(o.text)) : undefined }));
    const pulsanti = [...doc.querySelectorAll('button,a,[role=button],[role=tab],[role=combobox],input[type=submit]')].filter(vis)
      .map(b => clean(b.textContent || b.value)).filter(t => t && t.length < 50 && !/\d{6}/.test(t)).slice(0, 60);
    return { url: location.origin + location.pathname, titolo: doc.title, tabelle: tables, campi, pulsanti, iframes: doc.querySelectorAll('iframe').length };
  }

  window.PratikaExtract = { scanDocument, scanText, diagnose, normalize, fonteOf };

  // ---------- Cattura automatica sul Portale del Trasporto ----------
  const isPortal = /ilportaledeltrasporto\.it$|servizi2\.aci$|\.aci\.it$/i.test(location.hostname);
  if (!isPortal || !(window.chrome && chrome.runtime && chrome.runtime.id)) return;

  let auto = true;
  let timer = null;
  let lastSig = '';

  function capture() {
    if (!auto) return;
    const items = scanDocument(document).map(i => Object.assign(i, { fonte: fonteOf(location.href, i.ente) }));
    const sig = items.map(i => i.iuv).sort().join(',');
    if (!items.length || sig === lastSig) return;
    lastSig = sig;
    try { chrome.runtime.sendMessage({ type: 'pratika-add', items, source: location.href }).catch(() => {}); } catch (e) { /* estensione ricaricata */ }
  }
  const schedule = () => { if (!chrome.runtime || !chrome.runtime.id) return; clearTimeout(timer); timer = setTimeout(capture, 900); };

  chrome.storage.local.get('settings').then(({ settings }) => {
    auto = !settings || settings.auto !== false;
    schedule();
  });
  chrome.storage.onChanged.addListener(ch => {
    if (ch.settings) { auto = ch.settings.newValue ? ch.settings.newValue.auto !== false : true; if (auto) { lastSig = ''; schedule(); } }
  });
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  // ---------- Raccolta automatica dagli aggregati (tasto "+") ----------
  if (window !== window.top) return;
  const H = { busy: false };
  const hsleep = ms => new Promise(r => setTimeout(r, ms));
  const hvis = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

  function listInfo() {
    for (const t of document.querySelectorAll('table')) {
      if (!hvis(t)) continue;
      const heads = [...t.querySelectorAll('thead th, tr:first-child th')].map(h => clean(h.textContent));
      const iId = heads.findIndex(h => /id\.?\s*richiesta/i.test(h));
      if (iId < 0) continue;
      const iStato = heads.findIndex(h => /^stato/i.test(h));
      const rows = [...t.querySelectorAll('tbody tr')].filter(hvis).map(tr => {
        const cells = [...tr.children];
        const btn = [...tr.querySelectorAll('button,a,[role=button]')].filter(hvis)
          .find(b => /^\s*\+\s*$/.test(b.textContent) || /dettagl|espandi|apri|visualizz/i.test((b.title || '') + (b.getAttribute('aria-label') || '')))
          || [...(cells[cells.length - 1] || tr).querySelectorAll('button,a,[role=button]')].filter(hvis).pop();
        return { tr, id: clean((cells[iId] || {}).textContent), stato: iStato >= 0 ? clean((cells[iStato] || {}).textContent) : '', btn };
      }).filter(r => r.id && /^\d+$/.test(r.id));
      if (rows.length) return { table: t, rows };
    }
    return null;
  }
  // visibile davvero: nessun antenato trasparente/nascosto e l'elemento è quello sotto il puntatore
  function reallyVisible(el, r) {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    }
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return true; // fuori schermo: non verificabile
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const item = el.closest('a,button,[role=menuitem],[role=option],li') || el;
    return !!hit && (item.contains(hit) || hit.contains(el));
  }
  function realClick(el) {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    for (const t of ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      el.dispatchEvent(t.startsWith('pointer') ? new PointerEvent(t, o) : new MouseEvent(t, o));
    }
    el.click();
  }
  const codesOnPage = () => new Set(scanDocument(document).map(i => i.iuv));

  async function hget() { const { harvest } = await chrome.storage.local.get('harvest'); return harvest || {}; }
  async function hset(patch) {
    const prev = await hget();
    const h = Object.assign(prev, patch);
    if (patch.msg) h.log = [new Date().toLocaleTimeString('it-IT') + ' ' + patch.msg, ...(prev.log || [])].slice(0, 80);
    await chrome.storage.local.set({ harvest: h });
    return h;
  }

  function findBtn(rx, root) {
    return [...(root || document).querySelectorAll('button,a,[role=button],input[type=button]')].filter(hvis)
      .find(b => rx.test(clean(b.textContent || b.value || '').replace(/^[^a-zà-ù×]+|[^a-zà-ù×]+$/gi, '') || b.getAttribute('aria-label') || b.title || ''));
  }

  async function hstep() {
    const h = await hget();
    if (!h.active || (h.origin && h.origin !== location.origin)) return;
    const done = h.done || [];
    const list = listInfo();
    const elapsed = Date.now() - (h.ts || 0);

    if (h.phase === 'list') {
      if (!list) {
        if (elapsed > 20000) await hset({ active: false, msg: 'Non trovo più l\'elenco degli aggregati: raccolta fermata.' });
        return;
      }
      // "Visualizza N elementi": scegli il valore più alto per avere meno pagine
      const sizeSel = [...document.querySelectorAll('select')].find(sl => hvis(sl) && [...sl.options].every(o => /^\s*\d+\s*$/.test(o.text)) && sl.options.length > 1);
      if (sizeSel) {
        const max = [...sizeSel.options].reduce((a, o) => (+o.value || +o.text) > (+a.value || +a.text) ? o : a);
        if (sizeSel.value !== max.value && (H.sizeTries || 0) < 3) {
          H.sizeTries = (H.sizeTries || 0) + 1;
          sizeSel.value = max.value;
          sizeSel.dispatchEvent(new Event('input', { bubbles: true }));
          sizeSel.dispatchEvent(new Event('change', { bubbles: true }));
          await hset({ ts: Date.now(), msg: `Mostro ${max.text.trim()} elementi per pagina…` });
          await hsleep(2000);
          return;
        }
      }
      const next = list.rows.find(r => !done.includes(r.id) && !/pagat|annullat|scadut|bruciat/i.test(r.stato) && r.btn);
      if (!next) {
        // pagina successiva ("1 di 3" → freccia ">")
        const pager = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && hvis(e) && /^\s*\d+\s+di\s+\d+\s*$/.test(e.textContent));
        const m = pager && pager.textContent.match(/(\d+)\s+di\s+(\d+)/);
        if (m && +m[1] < +m[2]) {
          if (h.pageClickAt && Date.now() - h.pageClickAt < 4000) return; // attendo il cambio pagina
          const nextBtn = [...document.querySelectorAll('a,button,li,[role=button]')].filter(e => hvis(e) && (pager.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING))
            .find(e => /^\s*[›>]\s*$/.test(e.textContent) || /succ|next/i.test((e.getAttribute('aria-label') || '') + (e.title || '')))
            || [...document.querySelectorAll('a,button,li,[role=button]')].filter(e => hvis(e) && (pager.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING))[0];
          if (nextBtn && (h.pageClicks || 0) < 60) {
            (nextBtn.closest('a,button') || nextBtn).click();
            await hset({ pageClickAt: Date.now(), pageClicks: (h.pageClicks || 0) + 1, ts: Date.now(), msg: `Passo alla pagina ${+m[1] + 1} di ${m[2]}…` });
            return;
          }
        }
        const err = (h.errori || []).length;
        await hset({ active: false, msg: `✔ Raccolta finita: ${done.length - err} aggregati letti, ${h.found || 0} IUV trovati` + (err ? `, ${err} non riusciti (vedi Registro)` : '.') });
        return;
      }
      H.before = codesOnPage();
      await hset({ phase: 'menu', current: next.id, ts: Date.now(), msg: `Apro l'aggregato ${next.id}…`, backTried: 0, plusTries: 1 });
      next.btn.scrollIntoView({ block: 'center' });
      await hsleep(300);
      realClick(next.btn);
      return;
    }

    if (h.phase === 'menu') {
      // menu del "+": Dettaglio / Stampa avviso / Paga Online → solo "Dettaglio"
      // cerca la voce "Dettaglio" del menu appena aperto: quella più vicina al "+" cliccato
      const row = list && list.rows.find(r => r.id === h.current);
      const anchor = row && row.btn ? row.btn.getBoundingClientRect() : null;
      const cands = [];
      const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let tn;
      while ((tn = tw.nextNode())) {
        if (!/^\s*dettaglio\s*$/i.test(tn.nodeValue)) continue;
        const el = tn.parentElement;
        if (!el || el.closest('table thead')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || !reallyVisible(el, r)) continue;
        const d = anchor ? Math.hypot(r.left - anchor.left, r.top - anchor.bottom) : 0;
        cands.push({ el, d });
      }
      cands.sort((a, b) => a.d - b.d);
      if (cands.length) {
        const textEl = cands[0].el;
        const item = textEl.closest('a,button,[role=menuitem],[role=option],li') || textEl;
        const inner = item.querySelector && item.querySelector('a,button');
        // bersagli da provare in ordine: link/pulsante interno, voce, testo
        H.targets = [inner, item, textEl].filter((x, i, arr) => x && arr.indexOf(x) === i);
        const det = H.targets[0];
        const href = det.tagName === 'A' ? det.getAttribute('href') : '';
        await hset({ phase: 'detail', ts: Date.now(), tryIdx: 0, detHref: href && !/^#?$|^javascript/i.test(href) ? det.href : '', hrefTried: 0,
          msg: `Aggregato ${h.current}: clic su "Dettaglio" (${cands.length} voci trovate; elemento: ${clean(det.outerHTML).replace(/\d{6,}/g, '#').slice(0, 140)})` });
        realClick(det);
        return;
      }
      if (elapsed > 4000 && (h.plusTries || 0) < 2 && list) {
        const row = list.rows.find(r => r.id === h.current);
        if (row && row.btn) {
          row.btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          row.btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          row.btn.click();
          await hset({ plusTries: 2, ts: Date.now(), msg: `Aggregato ${h.current}: menu non visto, riprovo il + (pulsante: "${clean(row.btn.outerHTML).slice(0, 120)}")` });
        }
        return;
      }
      if (elapsed > 8000) {
        await hset({ phase: list ? 'list' : 'back', done: [...done, h.current], ts: Date.now(), errori: [...(h.errori || []), h.current], msg: `Aggregato ${h.current}: menu "Dettaglio" non trovato, passo oltre (testi "dettagl" in pagina: ${[...document.body.innerText.matchAll(/[^\n]{0,20}dettagl[^\n]{0,20}/gi)].slice(0, 4).map(m => m[0].trim()).join(' / ') || 'nessuno'})` });
      }
      return;
    }

    if (h.phase === 'detail') {
      const before = H.before || new Set();
      const items = scanDocument(document).filter(i => !before.has(i.iuv));
      if (items.length && H.lastCount === items.length && Date.now() - H.lastChange > 1200) {
        items.forEach(i => { i.fonte = 'MCTC'; i.rif = 'Richiesta ' + h.current; });
        try { await chrome.runtime.sendMessage({ type: 'pratika-add', items, source: location.href }); } catch (e) {}
        H.lastCount = 0;
        await hset({ phase: 'back', done: [...done, h.current], found: (h.found || 0) + items.length, ts: Date.now(), msg: `Aggregato ${h.current}: ${items.length} IUV` });
        return;
      }
      if (items.length !== H.lastCount) { H.lastCount = items.length; H.lastChange = Date.now(); }
      // il clic non ha aperto il dettaglio: provo gli altri elementi della voce
      if (!items.length && list && H.targets && elapsed > 5000 * ((h.tryIdx || 0) + 1) && (h.tryIdx || 0) + 1 < H.targets.length) {
        const i = (h.tryIdx || 0) + 1;
        const t = H.targets[i];
        await hset({ tryIdx: i, msg: `Aggregato ${h.current}: riprovo il clic su "Dettaglio" (${t.tagName.toLowerCase()})` });
        if (!t.isConnected || !hvis(t)) { const rr = list.rows.find(r => r.id === h.current); if (rr && rr.btn) { realClick(rr.btn); await hsleep(800); } }
        realClick(t);
        return;
      }
      // il clic non ha aperto il dettaglio: apro direttamente il collegamento
      if (!items.length && list && elapsed > 6000 && h.detHref && !h.hrefTried) {
        await hset({ hrefTried: 1, msg: `Aggregato ${h.current}: apro il dettaglio dal collegamento` });
        location.href = h.detHref;
        return;
      }
      if (elapsed > 25000) {
        H.lastCount = 0;
        await hset({ phase: 'back', done: [...done, h.current], ts: Date.now(), errori: [...(h.errori || []), h.current], msg: `Aggregato ${h.current}: nessun IUV trovato, passo oltre (pagina: ${location.pathname}; "Lista degli IUV": ${/lista degli iuv/i.test(document.body.innerText) ? 'sì' : 'no'})` });
      }
      return;
    }

    if (h.phase === 'back') {
      // finestra/riquadro sopra l'elenco: chiudilo
      const dlg = [...document.querySelectorAll('[role=dialog],.modal.show,.modal[style*="block"],.modal-dialog')].find(hvis);
      if (dlg) {
        const close = findBtn(/^(chiudi|indietro|torna indietro|annulla|ok|×|x)$/i, dlg) || dlg.querySelector('.close,.btn-close,[data-dismiss=modal],[data-bs-dismiss=modal]');
        if (close) { close.click(); await hsleep(800); }
      }
      if (listInfo()) { await hset({ phase: 'list', ts: Date.now() }); await hsleep(600); return; }
      // solo il link "Torna alla ricerca" (mai il tasto Indietro del browser: farebbe uscire dalla ricerca)
      const findBack = () => {
        const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let tn;
        while ((tn = tw.nextNode())) {
          if (!/^\s*torna alla ricerca\s*$/i.test(tn.nodeValue)) continue;
          const el = tn.parentElement;
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          return el.closest('a,button,[role=button],[role=link]') || el;
        }
        return findBtn(/^(torna alla ricerca|torna all'?\s*elenco|torna alla lista)$/i);
      };
      const tries = h.backTried || 0;
      if (elapsed > 1500 && tries < 3 && (tries === 0 || elapsed > 8000)) {
        const back = findBack();
        if (back) {
          await hset({ backTried: tries + 1, ts: Date.now(), msg: 'Clic su "Torna alla ricerca"' + (tries ? ' (nuovo tentativo)' : '') });
          back.scrollIntoView({ block: 'center' });
          realClick(back);
          return;
        }
      }
      if (elapsed > 30000) await hset({ active: false, msg: 'Non riesco a tornare all\'elenco con "Torna alla ricerca": raccolta fermata.' });
    }
  }

  const hTimer = setInterval(async () => {
    if (!chrome.runtime || !chrome.runtime.id) { clearInterval(hTimer); return; } // estensione ricaricata: questa pagina va aggiornata (F5)
    if (H.busy) return;
    H.busy = true;
    try { await hstep(); } catch (e) { try { await hset({ active: false, msg: 'Errore: ' + e.message }); } catch (e2) {} }
    finally { H.busy = false; }
  }, 700);

  window.PratikaHarvest = {
    start: async () => {
      const list = listInfo();
      if (!list) return { ok: false, msg: 'In questa pagina non vedo l\'elenco degli aggregati (colonna "Id. Richiesta").' };
      await chrome.storage.local.set({ harvest: { active: true, phase: 'list', done: [], found: 0, page: 0, ts: Date.now(), origin: location.origin, msg: 'Avviata' } });
      return { ok: true, n: list.rows.length };
    }
  };
})();
