// Ciclo automatico di pagamento CBILL sull'home banking Sella.
// Per ogni versamento "da pagare": Tipologia CBILL → codice avviso → importo 1 → codice CBILL
// → Conferma e procedi → (verifica riepilogo) → Conferma e concludi → attesa esito → successivo.
(() => {
  if (window.__pratikaBank) return;
  window.__pratikaBank = true;

  const DEFAULTS = { cbillMCTC: 'BFYKB', cbillPRA: 'B041S', importoFisso: '1' };
  const T_FORM = 90000;          // attesa massima per trovare il modulo
  const T_RIEPILOGO = 60000;     // attesa massima per il riepilogo
  const T_ESITO = 6 * 60000;     // attesa massima per la conferma dall'app
  const T_ESITO_MUTO = 20000;    // esito senza parole chiave: attesa prima di "da verificare"

  const OK_RX = /(eseguit[oa]|effettuat[oa]|completat[oa]|a buon fine|con successo|correttamente|presa in carico|pres[oa] in carico)/i;
  const WAIT_RX = /(in attesa|attendere|in corso|autorizz|notifica|sull'?\s*app|tramite app|conferma (l'|la )?operazione|caricamento)/i;
  const ERR_RX = /(non\s+(?:è|e'|e)\s+(?:stato|stata|possibile)|non\s+eseguit|non\s+effettuat|non\s+valid|non\s+autorizzat|errore|rifiutat|impossibile|negat[oa]|annullat|fallit|scadut|già\s+pagat|gia'\s+pagat|respint|non\s+pagabile|inesistente|non\s+trovat)/i;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const now = () => Date.now();
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const digits = s => (s || '').replace(/\D/g, '');
  const vis = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const textOf = el => clean(el.innerText != null ? el.innerText : el.textContent);

  // ---------- ricerca elementi ----------
  function findText(rx, exclude) {
    const all = document.body ? document.body.querySelectorAll('*') : [];
    const hits = [];
    for (const e of all) {
      if (/^(SCRIPT|STYLE|NOSCRIPT|SVG|PATH|OPTION)$/i.test(e.tagName)) continue;
      const t = clean(e.textContent);
      if (!t || t.length > 80 || !rx.test(t)) continue;
      if (exclude && (e === exclude || exclude.contains(e))) continue;
      if (vis(e)) hits.push(e);
    }
    const deep = hits.filter(e => !hits.some(o => o !== e && e.contains(o)));
    return deep[0] || null;
  }

  const visibleInputs = () => [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea')].filter(vis);

  function findInput(rx) {
    const ins = visibleInputs();
    const direct = ins.find(i => rx.test(i.placeholder || '') || rx.test(i.getAttribute('aria-label') || '') || rx.test(i.name || '') || rx.test(i.id || ''));
    if (direct) return direct;
    const labels = [...document.querySelectorAll('label,span,div,p,legend')]
      .filter(e => e.children.length <= 2 && rx.test(clean(e.textContent)) && clean(e.textContent).length < 60 && vis(e));
    for (const lab of labels) {
      if (lab.htmlFor) { const t = document.getElementById(lab.htmlFor); if (t && vis(t)) return t; }
      const next = ins.find(i => lab.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (next) return next;
    }
    return null;
  }

  function after(ref, selector) {
    return [...document.querySelectorAll(selector)].filter(vis)
      .find(e => ref.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING && !ref.contains(e)) || null;
  }

  const clickTarget = el => el.closest('button,a,[role=button],[role=tab],[role=option],li,label,input[type=submit],input[type=button]') || el;
  function click(el) {
    const t = clickTarget(el);
    t.scrollIntoView({ block: 'center' });
    t.click();
  }
  function pressSequence(el) {
    const t = clickTarget(el);
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  }

  async function waitFor(fn, ms) {
    const end = now() + ms;
    while (now() < end) { if (fn()) return true; await sleep(250); }
    return !!fn();
  }

  async function typeInto(el, v) {
    el.scrollIntoView({ block: 'center' });
    el.focus();
    try { el.select(); } catch (e) {}
    let done = false;
    try { done = document.execCommand('insertText', false, v); } catch (e) {}
    if (!done || el.value !== v) {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(el, v);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: v, inputType: 'insertText' }));
    }
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: v.slice(-1) }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(200);
  }
  const blur = el => { el.dispatchEvent(new Event('blur', { bubbles: true })); el.blur(); };

  // ---------- riconoscimento pagine ----------
  const btnProcedi = () => findText(/^conferma e procedi$/i);
  const btnConcludi = () => findText(/^conferma e concludi$/i);
  function detectPage() {
    if (btnConcludi()) return 'riepilogo';
    if (btnProcedi() && findInput(/codice\s*avviso/i)) return 'compila';
    return 'altro';
  }
  const lines = () => new Set((document.body.innerText || '').split('\n').map(clean).filter(Boolean));
  let snapshot = null; // righe di testo prima dell'azione: servono a vedere solo i messaggi nuovi
  function newLines() {
    const cur = [...lines()];
    return snapshot ? cur.filter(l => !snapshot.has(l)) : cur;
  }
  // messaggio d'errore comparso dopo l'azione (solo righe nuove, mai testo già presente)
  function errorMessage(list) {
    list = list.filter(l => !WAIT_RX.test(l)); // "Caricamento in corso" ecc. non sono errori
    const bad = list.find(l => ERR_RX.test(l) && l.length < 300);
    if (bad) return bad;
    const fresh = new Set(list);
    const el = [...document.querySelectorAll('[class*=error],[class*=Error],[class*=invalid],[class*=danger],[role=alert]')]
      .find(e => vis(e) && clean(e.textContent).length > 3 && clean(e.textContent).length < 300 && fresh.has(textOf(e)) && !WAIT_RX.test(textOf(e)));
    return el ? textOf(el) : '';
  }

  // ---------- compilazione ----------
  const isCbill = () => !!findInput(/codice\s*cbill/i) || !!findText(/^beneficiario\s*\/\s*codice\s*cbill$/i);

  async function ensureCbill() {
    if (isCbill()) return true;
    const sel = [...document.querySelectorAll('select')].filter(vis).find(s => [...s.options].some(o => /cbill/i.test(o.text)));
    if (sel) {
      const opt = [...sel.options].find(o => /^\s*cbill\s*$/i.test(o.text)) || [...sel.options].find(o => /cbill/i.test(o.text));
      sel.value = opt.value;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return waitFor(isCbill, 5000);
    }
    const lab = findText(/^tipologia di bollettino$/i);
    // il menu mostra il valore attuale ("PagoPA"): si clicca quello
    const following = el => !lab || (lab.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    let trigger = null;
    const cands = [];
    for (const e of document.body.querySelectorAll('*')) {
      if (/^(SCRIPT|STYLE|OPTION)$/i.test(e.tagName)) continue;
      if (/^\s*pagopa\s*$/i.test(e.textContent || '') && vis(e) && following(e)) cands.push(e);
    }
    trigger = cands.find(e => !cands.some(o => o !== e && e.contains(o))) || null;
    if (!trigger && lab) trigger = after(lab, '[role=combobox],[aria-haspopup],mat-select,ng-select,.ng-select,.dropdown-toggle');
    if (!trigger || /conferma|procedi|concludi/i.test(trigger.textContent || '')) return false;
    if (!trigger) return false;
    const option = () => findText(/^\s*cbill\s*$/i, trigger);
    click(trigger);
    if (!(await waitFor(option, 1500))) { pressSequence(trigger); await waitFor(option, 1500); }
    const opt = option();
    if (!opt) return false;
    click(opt);
    if (!(await waitFor(isCbill, 3000))) { pressSequence(opt); }
    return waitFor(isCbill, 4000);
  }

  async function fillForm(it, s) {
    if (!(await ensureCbill())) return { ok: false, msg: 'Non riesco a scegliere "CBILL" nel menu Tipologia di bollettino' };
    await sleep(400);
    const fAvv = findInput(/codice\s*avviso/i);
    if (!fAvv) return { ok: false, msg: 'Campo "Codice avviso" non trovato' };
    await typeInto(fAvv, it.avviso); blur(fAvv);

    const fImp = findInput(/importo/i);
    if (!fImp) return { ok: false, msg: 'Campo "Importo" non trovato' };
    await typeInto(fImp, s.importoFisso); blur(fImp);

    const fBen = findInput(/codice\s*cbill|beneficiario|nome dell'?ente/i);
    if (!fBen) return { ok: false, msg: 'Campo "Beneficiario/Codice CBILL" non trovato' };
    const code = it.fonte === 'PRA' ? s.cbillPRA : s.cbillMCTC;
    await typeInto(fBen, code);
    await sleep(800);
    // se compare un suggerimento che inizia col codice, lo sceglie (innocuo se non serve)
    const sug = findText(new RegExp('^' + code + '\\b', 'i'), fBen);
    if (sug && sug !== fBen && !fBen.contains(sug)) { click(sug); await sleep(400); }
    blur(fBen);
    await sleep(300);

    if (digits(fAvv.value) !== it.avviso) return { ok: false, msg: 'Il codice avviso non risulta inserito correttamente' };
    if (!clean(fBen.value).toUpperCase().startsWith(code.toUpperCase())) return { ok: false, msg: 'Il codice CBILL non risulta inserito correttamente' };
    const btn = btnProcedi();
    if (!btn) return { ok: false, msg: 'Pulsante "Conferma e procedi" non trovato' };
    return { ok: true, btn };
  }

  async function gotoForm() {
    const tab = findText(/^paga cbill\s*\/\s*pagopa$/i);
    if (tab) { click(tab); await sleep(1500); if (detectPage() === 'compila') return; }
    const nuovo = findText(/^effettua nuovo pagamento$/i) || findText(/^(nuovo pagamento|altro pagamento|esegui (un )?(nuovo|altro) pagamento)$/i);
    if (nuovo) { click(nuovo); await sleep(1800); return; }
    const menu = findText(/^bollettini,?\s*mav\s*\/\s*rav,?\s*cbill\s*\/\s*pagopa$/i);
    if (menu) { click(menu); await sleep(2500); }
  }

  // ---------- stato condiviso ----------
  async function getState() {
    const st = await chrome.storage.local.get(['run', 'items', 'settings']);
    return { run: st.run || {}, items: st.items || [], settings: Object.assign({}, DEFAULTS, st.settings || {}) };
  }
  async function setRun(patch, logLine) {
    const { run = {} } = await chrome.storage.local.get('run');
    const next = Object.assign({}, run, patch);
    if (logLine) {
      const t = new Date().toLocaleTimeString('it-IT');
      next.log = [t + ' ' + logLine, ...(run.log || [])].slice(0, 300);
      next.msg = logLine;
    }
    await chrome.storage.local.set({ run: next });
    return next;
  }
  const upd = (iuv, patch) => chrome.runtime.sendMessage({ type: 'pratika-update', iuv, patch }).catch(() => {});
  const stillActive = async () => { const { run } = await chrome.storage.local.get('run'); return run && run.active; };
  const label = it => `${it.fonte || 'MCTC'} ${it.avviso}`;

  async function pause(run, reason) {
    if (run.iuv) {
      const unsure = run.phase === 'await_esito';
      await upd(run.iuv, unsure ? { stato: 'verificare', nota: reason } : { stato: 'da_pagare', nota: reason });
    }
    await setRun({ active: false, iuv: null, phase: 'pausa' }, '⏸ ' + reason);
  }
  async function finish(run, it, patch, logLine) {
    // primo errore: riprovo lo stesso versamento una volta
    if (patch.stato === 'errore' && !(it.retry > 0)) {
      patch = { stato: 'da_pagare', retry: 1, nota: 'Riprovo dopo: ' + patch.nota };
      logLine = logLine + ' → riprovo';
    }
    await upd(it.iuv, patch);
    await setRun({ phase: 'nuovo', iuv: null, ts: now(), reset: patch.stato !== 'pagato', done: (run.done || 0) + (patch.stato === 'pagato' ? 1 : 0) }, logLine);
  }

  // ---------- macchina a stati ----------
  async function step() {
    const { run, items, settings } = await getState();
    if (!run.active) return;
    const it = items.find(i => i.iuv === run.iuv);
    const elapsed = now() - (run.ts || now());
    const page = detectPage();

    switch (run.phase) {
      case 'pick': {
        const next = items.find(i => i.stato === 'da_pagare');
        if (!next) { await setRun({ active: false, phase: 'fine', iuv: null }, `✔ Finito: pagati ${run.done || 0} versamenti in questo giro.`); return; }
        await upd(next.iuv, { stato: 'in_corso', nota: '' });
        await setRun({ phase: 'fill', iuv: next.iuv, ts: now(), tries: 0 }, '▶ ' + label(next));
        return;
      }
      case 'fill': {
        if (!it) { await setRun({ phase: 'pick', iuv: null }); return; }
        if (page === 'riepilogo') { await pause(run, 'Mi trovo su un riepilogo inatteso: controlla la pagina della banca e riavvia.'); return; }
        if (page !== 'compila') {
          if (elapsed > T_FORM) { await pause(run, 'Non trovo il modulo "Paga CBILL/PagoPA". Aprilo e riavvia.'); return; }
          await gotoForm();
          return;
        }
        const r = await fillForm(it, settings);
        if (!r.ok) {
          if ((run.tries || 0) >= 2) { await finish(run, it, { stato: 'errore', nota: r.msg }, '✖ ' + label(it) + ': ' + r.msg); return; }
          await setRun({ tries: (run.tries || 0) + 1 }, '… nuovo tentativo: ' + r.msg);
          return;
        }
        if (!(await stillActive())) return;
        snapshot = lines();
        await setRun({ phase: 'await_riepilogo', ts: now() }, 'Dati inseriti → Conferma e procedi');
        click(r.btn);
        return;
      }
      case 'await_riepilogo': {
        if (!it) { await setRun({ phase: 'pick', iuv: null }); return; }
        if (page === 'riepilogo') {
          await sleep(600);
          const body = document.body.innerText || '';
          const compact = body.replace(/\s/g, '');
          const code = it.fonte === 'PRA' ? settings.cbillPRA : settings.cbillMCTC;
          if (!compact.includes(it.avviso)) { await pause(run, `Il riepilogo non riporta il codice avviso ${it.avviso}: mi fermo.`); return; }
          if (!compact.toUpperCase().includes(code.toUpperCase())) { await pause(run, `Il riepilogo non riporta il codice CBILL ${code}: mi fermo.`); return; }
          const m = body.match(/importo\s+totale\s*([\d.]+,\d{2})/i) || body.match(/importo\s*([\d.]+,\d{2})/i);
          const imp = m ? m[1] : '';
          if (imp) await upd(it.iuv, { importo_pagato: imp });
          if (!(await stillActive())) return;
          const btn = btnConcludi();
          snapshot = lines();
          await setRun({ phase: 'await_esito', ts: now(), leftAt: 0 }, `Riepilogo OK${imp ? ' (€ ' + imp + ')' : ''} → Conferma e concludi`);
          click(btn);
          return;
        }
        const loading = newLines().some(l => WAIT_RX.test(l));
        if (page === 'compila' && elapsed > 4000 && !loading) {
          const err = errorMessage(newLines());
          if (err) { await finish(run, it, { stato: 'errore', nota: err }, '✖ ' + label(it) + ': ' + err); return; }
        }
        if (elapsed > T_RIEPILOGO) { await finish(run, it, { stato: 'errore', nota: 'La banca non ha mostrato il riepilogo' }, '✖ ' + label(it) + ': nessun riepilogo'); }
        return;
      }
      case 'await_esito': {
        if (!it) { await setRun({ phase: 'pick', iuv: null }); return; }
        if (page === 'riepilogo') {
          const err = newLines().find(l => ERR_RX.test(l) && l.length < 300);
          if (err) { await finish(run, it, { stato: 'errore', nota: err }, '✖ ' + label(it) + ': ' + err); return; }
          if (elapsed > T_ESITO) await pause(run, 'Attendo da 6 minuti la conferma dall\'app della banca: mi fermo.');
          return; // in attesa della conferma sull'app
        }
        const fresh = newLines();
        const err = fresh.find(l => ERR_RX.test(l));
        if (err) { await finish(run, it, { stato: 'errore', nota: err }, '✖ ' + label(it) + ': ' + err); return; }
        const ok = fresh.find(l => OK_RX.test(l) && !WAIT_RX.test(l));
        if (ok) { await finish(run, it, { stato: 'pagato', nota: ok, pagato_il: new Date().toLocaleString('it-IT') }, '✔ ' + label(it) + ' pagato'); return; }
        if (fresh.some(l => WAIT_RX.test(l))) {
          if (elapsed > T_ESITO) await pause(run, 'Attendo da 6 minuti la conferma dall\'app della banca: mi fermo.');
          return; // pagina di attesa conferma
        }
        if (!run.leftAt) { await setRun({ leftAt: now() }); return; }
        if (now() - run.leftAt > T_ESITO_MUTO) {
          await finish(run, it, { stato: 'verificare', nota: 'Esito non riconosciuto: controlla in banca' }, '? ' + label(it) + ': esito da verificare');
        }
        return;
      }
      case 'nuovo': {
        if (page === 'compila' && run.reset) {
          // dopo un errore: ricarico il modulo pulito cliccando "Paga CBILL/PagoPA"
          const tab = findText(/^paga cbill\s*\/\s*pagopa$/i);
          if (tab) { click(tab); await sleep(1500); }
          await setRun({ phase: 'pick', reset: false });
          return;
        }
        if (page === 'compila') { await setRun({ phase: 'pick' }); return; }
        if (elapsed < 2500) return; // lascia leggere l'esito
        if (elapsed > T_FORM) { await pause(run, 'Non riesco a tornare al modulo di pagamento. Aprilo e riavvia.'); return; }
        await gotoForm();
        return;
      }
      default:
        await setRun({ phase: 'pick', iuv: null });
    }
  }

  let busy = false;
  const timer = setInterval(async () => {
    if (!chrome.runtime || !chrome.runtime.id) { clearInterval(timer); return; } // estensione ricaricata
    if (busy) return;
    busy = true;
    try { await step(); }
    catch (e) {
      try { const { run } = await getState(); await pause(run, 'Errore: ' + e.message); } catch (e2) {}
    }
    finally { busy = false; }
  }, 1000);

  // per la diagnostica dal pannello
  window.PratikaBank = { detectPage, fillTest: async () => ({ cbill: await ensureCbill(), avviso: !!findInput(/codice\s*avviso/i), importo: !!findInput(/importo/i), beneficiario: !!findInput(/codice\s*cbill|beneficiario/i) }) };
})();
