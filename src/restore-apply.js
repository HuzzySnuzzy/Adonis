'use strict';
/**
 * Terugzetten van een backup, bij het starten (vóórdat de database wordt geopend).
 * backup.js zet de backup klaar in <datamap>/restore-pending. Hier gaan de huidige gegevens opzij
 * (naar <datamap>/voor-terugzetten-<tijd>, niets wordt weggegooid) en komen de backupbestanden op hun plek.
 * Bewust zonder andere ADONIS-modules: de database mag nog niet open zijn.
 */
const fs = require('node:fs');
const path = require('node:path');

function applyPendingRestore(dataDir, log = console.log) {
  const pending = path.join(dataDir, 'restore-pending');
  const marker = path.join(pending, 'READY.json');
  if (!fs.existsSync(marker)) return false;
  let info = {};
  try { info = JSON.parse(fs.readFileSync(marker, 'utf8')); } catch { /* geen info */ }
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const aside = path.join(dataDir, `voor-terugzetten-${stamp}`);
  fs.mkdirSync(aside, { recursive: true });
  const move = (from, to) => { if (fs.existsSync(from)) fs.renameSync(from, to); };
  // Huidige gegevens opzij
  for (const f of ['werkopdrachten.db', 'werkopdrachten.db-wal', 'werkopdrachten.db-shm']) move(path.join(dataDir, f), path.join(aside, f));
  move(path.join(dataDir, 'fotos'), path.join(aside, 'fotos'));
  // Backup op zijn plek
  move(path.join(pending, 'werkopdrachten.db'), path.join(dataDir, 'werkopdrachten.db'));
  if (fs.existsSync(path.join(pending, 'fotos'))) move(path.join(pending, 'fotos'), path.join(dataDir, 'fotos'));
  fs.rmSync(pending, { recursive: true, force: true });
  const made = info.manifest && info.manifest.gemaakt ? new Date(info.manifest.gemaakt).toLocaleString('nl-NL') : 'onbekend';
  log(`  Backup teruggezet (gemaakt op ${made}). De vorige gegevens staan in ${aside}.`);
  // Alleen de 3 nieuwste 'voor-terugzetten'-mappen houden (met foto's kunnen ze groot zijn).
  try {
    const old = fs.readdirSync(dataDir).filter((n) => /^voor-terugzetten-\d/.test(n)).sort().reverse().slice(3);
    for (const n of old) fs.rmSync(path.join(dataDir, n), { recursive: true, force: true });
  } catch { /* niet erg */ }
  try { fs.writeFileSync(path.join(dataDir, 'laatst-teruggezet.json'), JSON.stringify({ at: new Date().toISOString(), manifest: info.manifest || null, aside, backupConfig: info.backupConfig || null })); } catch { /* niet erg */ }
  return true;
}

module.exports = { applyPendingRestore };
