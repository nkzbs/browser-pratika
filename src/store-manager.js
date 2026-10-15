// Catalogo dei moduli, descrizione dei permessi e installazione sicura da archivio .zip.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const ID_RX = /^[a-z0-9][a-z0-9-]{1,40}$/;
const MAX_ZIP = 60 * 1024 * 1024;
const MAX_UNPACKED = 200 * 1024 * 1024;

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

// versione "1.2.3" -> confronto numerico; >0 se a è più recente di b
function cmpVersion(a, b) {
  const p = v => String(v || '0').split('.').map(n => parseInt(n, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
}

// unisce catalogo incluso e catalogo remoto (il remoto vince per id)
function mergeCatalog(local, remote) {
  const map = new Map((local.modules || []).map(m => [m.id, m]));
  for (const m of (remote && remote.modules) || []) if (m && ID_RX.test(m.id)) map.set(m.id, { ...map.get(m.id), ...m });
  return [...map.values()];
}

const HOST_LABEL = h => h.replace(/^\*\./, '');
// permessi del manifest in frasi comprensibili
function describePermissions(manifest, nameOf) {
  const out = [];
  const pp = manifest.pratika_permissions || [];
  if (pp.includes('shared')) out.push('Leggere e scrivere clienti, pratiche e scadenze condivisi con gli altri moduli');
  pp.filter(p => p.startsWith('send:')).forEach(p => out.push(`Inviare messaggi tramite il modulo ${nameOf(p.slice(5))}`));
  pp.filter(p => p.startsWith('read:')).forEach(p => out.push(`Leggere i dati del modulo ${nameOf(p.slice(5))}`));
  const hosts = new Set();
  [...(manifest.host_permissions || []), ...(manifest.content_scripts || []).flatMap(c => c.matches || [])].forEach(p => {
    const m = /^(?:\*|https?):\/\/([^/]+)/.exec(p);
    if (m) hosts.add(m[1] === '*' ? 'tutti i siti' : HOST_LABEL(m[1]));
  });
  if (hosts.size) out.push('Leggere e agire sulle pagine di: ' + [...hosts].join(', '));
  const perms = manifest.permissions || [];
  if (perms.includes('notifications')) out.push('Mostrare notifiche');
  if (perms.includes('alarms')) out.push('Eseguire controlli periodici in background');
  if (perms.includes('clipboardWrite')) out.push('Copiare testo negli appunti');
  if (perms.includes('tabs')) out.push('Vedere e gestire le schede aperte');
  if (perms.includes('scripting')) out.push('Eseguire script sulle pagine consentite');
  if (manifest.action && manifest.action.default_popup || manifest.side_panel) out.push('Mostrare un pannello laterale');
  return out;
}

// legge e controlla un archivio, senza estrarre nulla. Restituisce { id, manifest, files:[{rel,data}] }
function inspectZip(buf, wantedId) {
  if (buf.length > MAX_ZIP) throw new Error('Archivio troppo grande');
  const zip = new AdmZip(buf);
  const entries = zip.getEntries().filter(e => !e.isDirectory);
  if (!entries.length) throw new Error('Archivio vuoto');
  // il manifest deve stare alla radice oppure in un'unica cartella di primo livello
  const names = entries.map(e => e.entryName.replace(/\\/g, '/'));
  const tops = new Set(names.map(n => n.split('/')[0]));
  let prefix = '';
  if (!names.includes('manifest.json')) {
    if (tops.size !== 1 || !names.includes([...tops][0] + '/manifest.json')) throw new Error('manifest.json non trovato nell\'archivio');
    prefix = [...tops][0] + '/';
  }
  let total = 0;
  const files = [];
  for (const e of entries) {
    const name = e.entryName.replace(/\\/g, '/');
    const rel = name.slice(prefix.length);
    if (!rel) continue;
    if (rel.startsWith('/') || rel.split('/').includes('..') || /^[a-zA-Z]:/.test(rel)) throw new Error('Percorso non valido nell\'archivio: ' + name);
    const data = e.getData();
    total += data.length;
    if (total > MAX_UNPACKED) throw new Error('Contenuto troppo grande');
    files.push({ rel, data });
  }
  const mf = files.find(f => f.rel === 'manifest.json');
  const manifest = JSON.parse(mf.data.toString('utf8'));
  if (manifest.manifest_version !== 3) throw new Error('Il modulo deve usare Manifest V3');
  const id = wantedId || (manifest.name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!ID_RX.test(id)) throw new Error('Identificativo del modulo non valido');
  return { id, manifest, files };
}

function writeModule(destRoot, id, files) {
  const dir = path.join(destRoot, id);
  const tmp = dir + '.nuovo-' + process.pid;
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const f of files) {
    const target = path.resolve(tmp, f.rel);
    if (!target.startsWith(path.resolve(tmp) + path.sep)) throw new Error('Percorso non valido: ' + f.rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.data);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
  return dir;
}

module.exports = { sha256, cmpVersion, mergeCatalog, describePermissions, inspectZip, writeModule, ID_RX };
