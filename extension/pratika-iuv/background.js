// Pannello laterale + unico "scrittore" della tabella versamenti.
const enablePanel = () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(enablePanel);
chrome.runtime.onStartup.addListener(enablePanel);

let queue = Promise.resolve();
const serial = fn => (queue = queue.then(fn, fn));

async function addItems(items, source) {
  const { items: saved = [] } = await chrome.storage.local.get('items');
  const byKey = new Map(saved.map(i => [i.iuv, i]));
  let added = 0;
  for (const it of items || []) {
    if (!it || !it.iuv) continue;
    const prev = byKey.get(it.iuv);
    if (prev) {
      for (const k of ['avviso', 'importo', 'causale', 'data', 'ente', 'rif', 'fonte']) {
        if (!prev[k] && it[k]) prev[k] = it[k];
      }
      // il portale dice che è già pagato
      if (it.pagatoFonte && prev.stato !== 'pagato') {
        prev.stato = 'pagato';
        prev.nota = 'Risulta pagato sul portale';
      }
      continue;
    }
    byKey.set(it.iuv, {
      iuv: it.iuv,
      avviso: it.avviso || '',
      importo: it.importo || '',
      causale: it.causale || '',
      data: it.data || '',
      ente: it.ente || '',
      rif: it.rif || '',
      fonte: it.fonte || 'MCTC',
      stato: it.pagatoFonte ? 'pagato' : 'da_pagare',
      nota: it.pagatoFonte ? 'Risulta già pagato sul portale' : '',
      catturato: new Date().toISOString(),
      origine: source || ''
    });
    added++;
  }
  await chrome.storage.local.set({ items: [...byKey.values()] });
  return added;
}

async function updateItem(iuv, patch) {
  const { items = [] } = await chrome.storage.local.get('items');
  const it = items.find(i => i.iuv === iuv);
  if (it) Object.assign(it, patch);
  await chrome.storage.local.set({ items });
  return !!it;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'pratika-add') {
    serial(() => addItems(msg.items, msg.source)).then(n => sendResponse({ ok: true, added: n }), e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === 'pratika-update') {
    serial(() => updateItem(msg.iuv, msg.patch)).then(ok => sendResponse({ ok }), e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});
