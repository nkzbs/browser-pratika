// Badge sull'icona: scadenze già scadute o entro 15 giorni (non ancora segnate come avvisate).
const OGGI = () => new Date().toISOString().slice(0, 10);
async function aggiorna() {
  const { scadenze = [] } = await chrome.pratika.shared.get('scadenze');
  const oggi = new Date(OGGI() + 'T00:00:00');
  const n = scadenze.filter(s => !s.avvisata && (new Date(s.data + 'T00:00:00') - oggi) / 86400000 <= 15).length;
  await chrome.action.setBadgeText({ text: n ? String(n) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#e8710a' });
}
chrome.pratika.onSharedChanged.addListener(ch => { if (ch.scadenze) aggiorna(); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'ricalcola') aggiorna(); });
chrome.alarms.create('ricalcola', { delayInMinutes: 0.1, periodInMinutes: 60 });
aggiorna();
