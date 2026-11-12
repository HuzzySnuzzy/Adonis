'use strict';
/**
 * Backups: één ZIP-bestand met de database en alle foto's.
 *  - Elke dag op een vast tijdstip (wordt ingehaald als de computer uit stond), of met de hand.
 *  - Naar één of meer mappen naar keuze: USB-schijf, netwerkschijf, of de OneDrive/Google Drive/Dropbox-map
 *    op deze computer (die zet hem dan zelf in de cloud). Of direct downloaden in de browser.
 *  - Oude backups in die mappen worden na het ingestelde aantal dagen opgeruimd (alleen ADONIS-backups).
 *  - Terugzetten: eerst een veiligheidsbackup van de huidige situatie, dan klaarzetten en ADONIS herstarten;
 *    restore-apply.js zet de bestanden op hun plek voordat de database wordt geopend.
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Zip, ZipPassThrough, ZipDeflate, unzipSync, strFromU8 } = require('fflate');
const { db, DATA_DIR } = require('./db');
const settings = require('./settings');
const buildinfo = require('./buildinfo');

const NAME = /^adonis-backup-(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(-[a-z-]+)?\.zip$/;
const TMP = path.join(DATA_DIR, 'backup-tmp');
const PENDING = path.join(DATA_DIR, 'restore-pending');
const DEFAULT_DIR = path.join(DATA_DIR, 'backups');
const tz = () => process.env.APP_TIMEZONE || 'Europe/Amsterdam';

class BackupError extends Error {}

/* ---------- instellingen ---------- */
function config() {
  const c = settings.get('backup', null) || {};
  return {
    time: /^\d{2}:\d{2}$/.test(c.time || '') ? c.time : '12:30', // middag: de computer staat dan meestal aan
    keepDays: [7, 14, 30, 60, 90, 365].includes(c.keepDays) ? c.keepDays : 30,
    folders: Array.isArray(c.folders) ? c.folders.filter((f) => typeof f === 'string' && f.trim()) : [DEFAULT_DIR],
    last: c.last || null,         // { at, ok, size, file, error, results: [{ folder, ok, error }] }
    lastOk: c.lastOk || null,     // ISO-tijd van de laatste geslaagde automatische of handmatige backup
  };
}
function saveConfig(changes) {
  const c = { ...config(), ...changes };
  settings.set('backup', { time: c.time, keepDays: c.keepDays, folders: c.folders, last: c.last, lastOk: c.lastOk });
  return config();
}

/** Lokale datum/tijd in de tijdzone van de garage. */
function localParts(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}
function fileName(suffix = '') {
  const { date, time } = localParts();
  return `adonis-backup-${date}_${time.replace(':', '')}${suffix}.zip`;
}

/**
 * Een map op een USB- of netwerkschijf kan traag zijn of niet antwoorden (NAS uit, schijf losgekoppeld).
 * Daarom alles asynchroon en met een tijdslimiet: ADONIS blijft voor iedereen gewoon werken.
 */
function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, reject) => { t = setTimeout(() => reject(new BackupError(`${what} reageert niet (na ${Math.round(ms / 1000)} seconden). Is de schijf aangesloten en bereikbaar?`)), ms); }),
  ]);
}
/** Kan ADONIS in deze map schrijven? Maakt alleen de map zelf aan (niet de schijf of bovenliggende mappen). */
async function checkFolder(folder) {
  const dir = String(folder || '').trim();
  if (!dir) throw new BackupError('Vul een map in.');
  if (!path.isAbsolute(dir)) throw new BackupError('Vul de volledige map in, bijvoorbeeld D:\\ADONIS-backups of C:\\Users\\Naam\\OneDrive\\ADONIS-backups.');
  const full = path.resolve(dir);
  return withTimeout((async () => {
    try {
      await fsp.access(path.dirname(full));
    } catch {
      throw new BackupError(`"${path.dirname(full)}" bestaat niet. Bestaat de schijf en is hij aangesloten?`);
    }
    try {
      await fsp.mkdir(full).catch((err) => { if (err.code !== 'EEXIST') throw err; });
      const probe = path.join(full, `.adonis-schrijftest-${process.pid}`);
      await fsp.writeFile(probe, 'ok');
      await fsp.rm(probe, { force: true });
    } catch (err) {
      throw new BackupError(`ADONIS kan niet schrijven in "${full}" (${err.code || err.message}).`);
    }
    return full;
  })(), 20000, `"${full}"`);
}

/**
 * Staat een backupmap op dezelfde schijf als de gegevens van ADONIS? Dan bent u bij een kapotte schijf (of diefstal)
 * de backup ook kwijt. Een map van OneDrive, Google Drive, Dropbox of iCloud telt niet: die gaat ook naar de cloud.
 */
const CLOUD = /onedrive|google ?drive|googledrive|my drive|mijn drive|dropbox|icloud|nextcloud|owncloud|pcloud|mega/i;
async function placeOf(folder) {
  const cloud = CLOUD.test(folder);
  if (cloud) return { cloud: true, local: false };
  try {
    const [a, b] = await withTimeout(Promise.all([fsp.stat(folder), fsp.stat(DATA_DIR)]), 3000, `"${folder}"`);
    return { cloud: false, local: a.dev === b.dev };
  } catch {
    return { cloud: false, local: false }; // niet bereikbaar: geen uitspraak
  }
}

// Voor de waarschuwing op het startscherm: hooguit één keer per uur opnieuw kijken (zonder te wachten).
let localCache = { at: 0, value: false };
function onlyLocal() {
  if (Date.now() - localCache.at > 3600e3) {
    localCache.at = Date.now();
    const { folders } = config();
    Promise.all(folders.map(placeOf)).then((p) => { localCache.value = p.length > 0 && p.every((x) => x.local); }).catch(() => {});
  }
  return localCache.value;
}
function forgetPlaces() { localCache = { at: 0, value: false }; }

/* ---------- backup maken ---------- */
function counts() {
  const n = (sql) => { try { return db.prepare(sql).get().n; } catch { return 0; } };
  return {
    klanten: n('SELECT COUNT(*) AS n FROM customers'), werkopdrachten: n('SELECT COUNT(*) AS n FROM orders'),
    bandensets: n('SELECT COUNT(*) AS n FROM tyre_storage'), voorraad: n('SELECT COUNT(*) AS n FROM stock_items'),
    fotos: n('SELECT COUNT(*) AS n FROM photos'), gebruikers: n('SELECT COUNT(*) AS n FROM users'),
  };
}
function listFiles(dir, base = '') {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

/** Maakt een ZIP in de tijdelijke map en geeft { file, size, manifest } terug. */
async function createZip(suffix = '') {
  fs.mkdirSync(TMP, { recursive: true });
  const snapshot = path.join(TMP, `snapshot-${Date.now()}.db`);
  // Een consistente kopie van de database, ook terwijl er mensen werken.
  db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
  const manifest = {
    app: 'ADONIS', soort: 'backup', versie: buildinfo.version, gemaakt: new Date().toISOString(), aantallen: counts(),
  };
  const target = path.join(TMP, fileName(suffix));
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(target);
    out.on('error', reject);
    out.on('finish', resolve);
    const zip = new Zip((err, chunk, final) => {
      if (err) { reject(err); return; }
      out.write(Buffer.from(chunk));
      if (final) out.end();
    });
    const addFile = (name, buf, compress) => {
      const f = compress ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
      zip.add(f);
      f.push(new Uint8Array(buf), true);
    };
    try {
      addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)), true);
      addFile('werkopdrachten.db', fs.readFileSync(snapshot), true);
      // Foto's van bandensets en voorraad (al gecomprimeerd: niet opnieuw inpakken).
      for (const rel of listFiles(path.join(DATA_DIR, 'fotos'))) addFile('fotos/' + rel, fs.readFileSync(path.join(DATA_DIR, 'fotos', rel)), false);
      zip.end();
    } catch (err) {
      reject(err);
    }
  }).finally(() => fs.rmSync(snapshot, { force: true }));
  return { file: target, size: fs.statSync(target).size, manifest };
}

/** Backups in een map (nieuwste eerst). Asynchroon met tijdslimiet; een onbereikbare map geeft een lege lijst. */
async function listBackups(folder) {
  try {
    return await withTimeout((async () => {
      const names = (await fsp.readdir(folder)).filter((n) => NAME.test(n));
      const out = [];
      for (const n of names) { const st = await fsp.stat(path.join(folder, n)); out.push({ name: n, size: st.size, mtime: st.mtimeMs }); }
      return out.sort((a, b) => b.name.localeCompare(a.name));
    })(), 8000, 'De map');
  } catch { return []; }
}
async function prune(folder, keepDays) {
  const limit = Date.now() - keepDays * 864e5;
  const all = await listBackups(folder);
  // Altijd minstens de 3 nieuwste houden, ook als ze oud zijn (bijv. na een lange vakantie).
  for (const b of all.slice(3)) {
    const m = NAME.exec(b.name);
    const when = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    if (when < limit) { try { await fsp.rm(path.join(folder, b.name), { force: true }); } catch { /* volgende keer */ } }
  }
}

let running = null;
/** Backup maken en naar alle mappen kopiëren. */
function runBackup({ reason = 'handmatig' } = {}) {
  if (running) return running;
  running = (async () => {
    const c = config();
    const at = new Date().toISOString();
    let zip;
    try {
      zip = await createZip(reason === 'voor-terugzetten' ? '-voor-terugzetten' : '');
    } catch (err) {
      const last = { at, ok: false, error: 'De backup kon niet worden gemaakt: ' + err.message, results: [], reason };
      saveConfig({ last });
      return last;
    }
    const results = [];
    for (const folder of c.folders) {
      try {
        const dir = await checkFolder(folder);
        await withTimeout(fsp.copyFile(zip.file, path.join(dir, path.basename(zip.file))), 10 * 60 * 1000, `"${dir}"`);
        await prune(dir, c.keepDays);
        results.push({ folder, ok: true });
      } catch (err) {
        results.push({ folder, ok: false, error: err.message });
      }
    }
    fs.rmSync(zip.file, { force: true });
    const ok = results.length > 0 && results.every((r) => r.ok);
    const last = { at, ok, size: zip.size, file: path.basename(zip.file), results, reason, aantallen: zip.manifest.aantallen,
      error: !results.length ? 'Er is geen map ingesteld om de backup in te bewaren.' : ok ? '' : 'Niet alle mappen waren bereikbaar.' };
    saveConfig({ last, lastOk: results.some((r) => r.ok) ? at : c.lastOk });
    if (!ok) console.log('  Backup: ' + last.error + ' ' + results.filter((r) => !r.ok).map((r) => `${r.folder}: ${r.error}`).join('; '));
    return last;
  })().finally(() => { running = null; });
  return running;
}

/* ---------- automatisch ---------- */
function isDue(now = new Date()) {
  const c = config();
  const { date, time } = localParts(now);
  const lastOk = c.lastOk ? new Date(c.lastOk) : null;
  if (!lastOk) return true; // nog nooit een backup: meteen
  const lastDate = localParts(lastOk).date;
  if (lastDate === date) return false; // vandaag al gedaan
  // Na het tijdstip van vandaag, of langer dan 26 uur geleden (computer stond uit op het tijdstip).
  return time >= c.time || now - lastOk > 26 * 3600e3;
}
/** Na het terugzetten: de backupinstellingen van vóór het terugzetten weer gebruiken (eenmalig). */
function carryOverAfterRestore() {
  const file = path.join(DATA_DIR, 'laatst-teruggezet.json');
  try {
    const info = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!info.backupConfig || info.configApplied) return;
    settings.set('backup', info.backupConfig);
    delete info.backupConfig;
    fs.writeFileSync(file, JSON.stringify({ ...info, configApplied: true }));
  } catch { /* geen terugzetting */ }
}
let timer = null; let firstTick = null;
function startSchedule() {
  if (timer) return;
  carryOverAfterRestore();
  // Nooit de hele server laten vallen om een automatische backup (bijv. database al gesloten tijdens een herstart).
  const tick = () => { try { if (isDue()) runBackup({ reason: 'automatisch' }).catch(() => {}); } catch (err) { console.log('  Automatische backup overgeslagen: ' + err.message); } };
  firstTick = setTimeout(tick, 90 * 1000); firstTick.unref(); // even na het starten
  timer = setInterval(tick, 10 * 60 * 1000);
  timer.unref();
}

/** Status voor waarschuwingen: 'ok', 'mislukt', 'te-oud' of 'nooit'. */
function health() {
  const c = config();
  if (!c.last) return { state: 'nooit', c };
  if (!c.last.ok && c.last.reason !== 'download') return { state: 'mislukt', c };
  const age = c.lastOk ? Date.now() - new Date(c.lastOk) : Infinity;
  if (age > 2.5 * 864e5) return { state: 'te-oud', c };
  return { state: 'ok', c };
}

/* ---------- terugzetten ---------- */
/** Controleer een backupbestand en geef de inhoud terug ({ manifest, files }). */
function readBackup(buffer) {
  let files;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new BackupError('Dit is geen geldig backupbestand (het ZIP-bestand is beschadigd of onvolledig).');
  }
  let manifest = null;
  try { manifest = JSON.parse(strFromU8(files['manifest.json'])); } catch { /* geen manifest */ }
  const dbFile = files['werkopdrachten.db'];
  if (!manifest || manifest.app !== 'ADONIS' || !dbFile) throw new BackupError('Dit is geen ADONIS-backup.');
  if (Buffer.from(dbFile.subarray(0, 15)).toString() !== 'SQLite format 3') throw new BackupError('De database in deze backup is beschadigd.');
  return { manifest, files };
}
/** Backup klaarzetten voor terugzetten (wordt bij de volgende start toegepast). Maakt eerst een veiligheidsbackup. */
async function stageRestore(buffer) {
  const { manifest, files } = readBackup(buffer);
  const safety = await runBackup({ reason: 'voor-terugzetten' });
  if (!safety.results.some((r) => r.ok)) {
    throw new BackupError('Er kon eerst geen veiligheidsbackup van de huidige gegevens worden gemaakt, daarom is er niets teruggezet. ' + (safety.error || ''));
  }
  fs.rmSync(PENDING, { recursive: true, force: true });
  fs.mkdirSync(PENDING, { recursive: true });
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/') || name === 'manifest.json') continue;
    const rel = path.posix.normalize(name);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !(rel === 'werkopdrachten.db' || rel.startsWith('fotos/'))) continue;
    const dest = path.join(PENDING, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
  // De backupinstellingen staan in de database; die van nu meenemen, anders komen de oude mappen en status terug.
  fs.writeFileSync(path.join(PENDING, 'READY.json'), JSON.stringify({ manifest, staged: new Date().toISOString(), backupConfig: settings.get('backup', null) }));
  return manifest;
}
async function backupPath(folder, name) {
  if (!NAME.test(name) || !folder) return null;
  const c = config();
  if (!c.folders.map((f) => path.resolve(f)).includes(path.resolve(folder))) return null;
  const p = path.join(folder, name);
  try { await withTimeout(fsp.access(p), 8000, 'De map'); return p; } catch { return null; }
}

function isRunning() { return !!running; }
function stopSchedule() { if (timer) clearInterval(timer); timer = null; if (firstTick) clearTimeout(firstTick); firstTick = null; }

module.exports = {
  placeOf, onlyLocal, forgetPlaces,
  isRunning, stopSchedule, BackupError, DEFAULT_DIR, config, saveConfig, checkFolder, createZip, runBackup, listBackups, startSchedule, health,
  readBackup, stageRestore, backupPath, isDue,
};
