'use strict';
/**
 * Bandenhotel (opgeslagen banden van klanten) en voorraad (onderdelen en banden die op de zaak liggen).
 */
const { db, plateKey } = require('./db');
const orders = require('./orders');

db.exec(`
CREATE TABLE IF NOT EXISTS tyre_storage (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  soort          TEXT NOT NULL DEFAULT 'klant', -- 'klant' (bandenhotel, hoort bij een klant) of 'opslag' (overige banden/noodbanden)
  label          TEXT NOT NULL DEFAULT '',   -- nummer op het label/sticker (Key ID)
  klant_naam     TEXT NOT NULL DEFAULT '',
  kenteken       TEXT NOT NULL DEFAULT '',
  plate_key      TEXT NOT NULL DEFAULT '',   -- koppeling met klanten (customers.plate_key)
  telefoon       TEXT NOT NULL DEFAULT '',
  auto           TEXT NOT NULL DEFAULT '',   -- merk/type van de auto
  seizoen        TEXT NOT NULL DEFAULT '',
  maat           TEXT NOT NULL DEFAULT '',
  merk           TEXT NOT NULL DEFAULT '',   -- merk van de banden
  aantal         INTEGER NOT NULL DEFAULT 4,
  velg           TEXT NOT NULL DEFAULT '',   -- '', 'staal', 'alu', 'zonder'
  profiel_voor   REAL,                       -- mm
  profiel_achter REAL,                       -- mm
  profiel_tekst  TEXT NOT NULL DEFAULT '',   -- zoals genoteerd (bijv. "Nieuw")
  dot            TEXT NOT NULL DEFAULT '',
  locatie        TEXT NOT NULL DEFAULT '',
  opmerkingen    TEXT NOT NULL DEFAULT '',
  extra          TEXT NOT NULL DEFAULT '{}', -- overige gegevens uit een import (JSON)
  status         TEXT NOT NULL DEFAULT 'opgeslagen', -- 'opgeslagen' of 'uitgegeven'
  datum_in       TEXT NOT NULL DEFAULT '',
  datum_uit      TEXT NOT NULL DEFAULT '',
  search_text    TEXT NOT NULL DEFAULT '',
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS tyre_storage_plate ON tyre_storage(plate_key);

CREATE TABLE IF NOT EXISTS stock_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  soort        TEXT NOT NULL DEFAULT 'onderdeel', -- 'onderdeel' of 'band'
  beschikbaar  INTEGER NOT NULL DEFAULT 1,
  aantal       INTEGER NOT NULL DEFAULT 1,
  merk         TEXT NOT NULL DEFAULT '',
  nummer       TEXT NOT NULL DEFAULT '',   -- artikelnummer
  oe_nummer    TEXT NOT NULL DEFAULT '',   -- origineel (OE) nummer
  type         TEXT NOT NULL DEFAULT '',   -- soort onderdeel (BOUGIE, RIEM…) of bandtype
  omschrijving TEXT NOT NULL DEFAULT '',
  maat         TEXT NOT NULL DEFAULT '',
  profiel      TEXT NOT NULL DEFAULT '',
  snelheid     TEXT NOT NULL DEFAULT '',   -- last-/snelheidsindex
  seizoen      TEXT NOT NULL DEFAULT '',
  locatie      TEXT NOT NULL DEFAULT '',
  prijs        TEXT NOT NULL DEFAULT '',
  datum        TEXT NOT NULL DEFAULT '',
  extra        TEXT NOT NULL DEFAULT '{}',
  search_key   TEXT NOT NULL DEFAULT '',   -- nummers zonder spaties/punten/streepjes
  search_text  TEXT NOT NULL DEFAULT '',
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS stock_items_soort ON stock_items(soort);
`);
if (!db.prepare('PRAGMA table_info(tyre_storage)').all().some((c) => c.name === 'soort')) {
  db.exec("ALTER TABLE tyre_storage ADD COLUMN soort TEXT NOT NULL DEFAULT 'klant'");
}
// Wanneer de klant is gebeld/uitgenodigd om te komen wisselen (wordt gewist zodra er gewisseld is).
if (!db.prepare('PRAGMA table_info(tyre_storage)').all().some((c) => c.name === 'uitgenodigd_at')) {
  db.exec('ALTER TABLE tyre_storage ADD COLUMN uitgenodigd_at TEXT');
}

/* ---------- gedeelde hulpjes ---------- */
const clean = (v, max = 500) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanMulti = (v, max = 4000) => String(v ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
function likeTerm(q) {
  return '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}
/** "1 493 001", "A003.159.26.03" -> "1493001", "A0031592603": zo vind je een nummer hoe het ook is getypt. */
function numberKey(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
/** Bandenmaat als alleen cijfers: "205/55R16 91V" -> "2055516" (zo vind je "2055516" en "205 55 16"). */
function sizeKey(v) {
  const m = /(\d{3})\D{0,3}(\d{2})\D{0,3}(\d{2})/.exec(String(v || ''));
  return m ? m[1] + m[2] + m[3] : '';
}
function parseIntSafe(v, fallback) {
  const n = parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : fallback;
}
/** "5,3" / "5.3mm" / 5.3 -> 5.3; leeg/ongeldig -> null. */
function parseMm(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 && v <= 30 ? Math.round(v * 10) / 10 : null;
  const m = /(\d+(?:[.,]\d+)?)/.exec(String(v));
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return n >= 0 && n <= 30 ? Math.round(n * 10) / 10 : null;
}
function fmtMm(n) {
  return n === null || n === undefined ? '' : String(n).replace('.', ',');
}
/** Bandenmaat netjes: "205/55.16", "205 55 r16" -> "205/55R16". Anders ongewijzigd. */
function normalizeSize(v) {
  const s = clean(v, 60);
  const m = /^(\d{3})\s*[/ ]\s*(\d{2})\s*(Z?R|[-. ]|)\s*(\d{2}(?:[.,]5)?)\s*(C)?(?:\s+(\d{2,3}(?:\/\d{2,3})?\s?[A-Z]{1,2}|XL|RF))?$/i.exec(s);
  if (!m) return s === '?' ? '' : s;
  const r = /zr/i.test(m[3]) ? 'ZR' : 'R';
  return `${m[1]}/${m[2]}${r}${m[4].replace(',', '.')}${m[5] ? 'C' : ''}${m[6] ? ' ' + m[6].replace(/\s/g, '').toUpperCase() : ''}`;
}
/** Seizoen netjes: winter/zomer/all season (combinaties blijven zoals ze zijn). */
function normalizeSeason(v) {
  const s = clean(v, 60);
  const l = s.toLowerCase();
  if (!l) return '';
  const w = /winter/.test(l);
  const z = /zomer|summer/.test(l);
  if (/all\s*-?\s*season|4\s*seizoen|vierseizoen|^all$|allweather|all weather/.test(l)) return 'All season';
  if (w && !z && /^winter(band(en)?)?$/.test(l)) return 'Winter';
  if (z && !w && /^(zomer|summer)(band(en)?)?$/.test(l)) return 'Zomer';
  return s;
}
const SEASONS = ['Zomer', 'Winter', 'All season'];
/** Kleur van het profiel: < 1,6 mm wettelijk te weinig, < 3 mm (winter < 4 mm) bijna op. */
function treadClass(mm, seizoen) {
  if (mm === null || mm === undefined) return '';
  const warn = /winter/i.test(seizoen || '') ? 4 : 3;
  return mm < 1.6 ? 'tread-bad' : mm < warn ? 'tread-warn' : 'tread-ok';
}

function extraJson(v) {
  if (!v || typeof v !== 'object') return '{}';
  const out = {};
  for (const [k, val] of Object.entries(v)) if (val !== null && val !== undefined && String(val).trim() !== '') out[clean(k, 60)] = clean(val, 500);
  return JSON.stringify(out);
}
function parseExtra(json) {
  try { return JSON.parse(json || '{}'); } catch { return {}; }
}

/* ---------- bandenhotel ---------- */
const TYRE_STATUSES = { opgeslagen: 'In opslag', op_auto: 'Op de auto', uitgegeven: 'Uitgegeven' };
const STATUS_ORDER = "CASE status WHEN 'op_auto' THEN 0 WHEN 'opgeslagen' THEN 1 ELSE 2 END";
const TYRE_SOORTEN = { klant: 'Klantenbanden', opslag: 'Overige opslag' };

const { formatPlate } = require('./plates');
const VELGEN = { '': '—', staal: 'Stalen velg', alu: 'Lichtmetalen velg', zonder: 'Zonder velg' };

/** Formulier/import -> nette gegevens voor tyre_storage. */
function normalizeTyre(input) {
  const d = input || {};
  const kenteken = formatPlate(d.kenteken);
  const t = {
    soort: TYRE_SOORTEN[d.soort] ? d.soort : 'klant',
    label: clean(d.label, 60),
    klant_naam: clean(d.klant_naam, 200),
    kenteken,
    plate_key: plateKey(kenteken),
    telefoon: clean(d.telefoon, 60),
    auto: clean(d.auto, 200),
    seizoen: normalizeSeason(d.seizoen),
    maat: normalizeSize(d.maat),
    merk: clean(d.merk, 100),
    aantal: Math.max(0, Math.min(12, parseIntSafe(d.aantal, 4))),
    velg: Object.hasOwn(VELGEN, d.velg) ? d.velg : '',
    profiel_voor: parseMm(d.profiel_voor),
    profiel_achter: parseMm(d.profiel_achter),
    profiel_tekst: clean(d.profiel_tekst, 200),
    dot: clean(d.dot, 200),
    locatie: clean(d.locatie, 100),
    opmerkingen: cleanMulti(d.opmerkingen),
    extra: typeof d.extra === 'string' ? d.extra : extraJson(d.extra),
    status: TYRE_STATUSES[d.status] ? d.status : 'opgeslagen',
    datum_in: orders.parseDate(d.datum_in) || '',
    datum_uit: orders.parseDate(d.datum_uit) || '',
  };
  if (t.profiel_achter === null && t.profiel_voor !== null && d.profiel_achter === undefined) t.profiel_achter = t.profiel_voor;
  return t;
}
function tyreSearchText(t) {
  return [t.label, t.klant_naam, t.kenteken, t.plate_key, t.telefoon, t.auto, t.seizoen, t.maat, numberKey(t.maat), sizeKey(t.maat), t.merk, t.profiel_tekst, t.dot,
    t.locatie, t.opmerkingen, Object.values(parseExtra(t.extra)).join(' ')].join(' ').toLowerCase();
}
const TYRE_COLS = ['soort', 'label', 'klant_naam', 'kenteken', 'plate_key', 'telefoon', 'auto', 'seizoen', 'maat', 'merk', 'aantal', 'velg',
  'profiel_voor', 'profiel_achter', 'profiel_tekst', 'dot', 'locatie', 'opmerkingen', 'extra', 'status', 'datum_in', 'datum_uit'];

function saveTyre({ id, data, userId }) {
  const t = { ...data, search_text: tyreSearchText(data) };
  const cols = [...TYRE_COLS, 'search_text'];
  if (id) {
    db.prepare(`UPDATE tyre_storage SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(...cols.map((c) => t[c]), userId, id);
    return Number(id);
  }
  const r = db.prepare(`INSERT INTO tyre_storage (${cols.join(', ')}, created_by, updated_by) VALUES (${cols.map(() => '?').join(', ')}, ?, ?)`)
    .run(...cols.map((c) => t[c]), userId, userId);
  return Number(r.lastInsertRowid);
}
function getTyre(id) {
  return db.prepare(
    `SELECT t.*, c.id AS customer_id, uu.name AS updated_by_name FROM tyre_storage t
     LEFT JOIN customers c ON c.plate_key = t.plate_key AND t.plate_key <> ''
     LEFT JOIN users uu ON uu.id = t.updated_by WHERE t.id = ?`
  ).get(id);
}
function searchTyres({ soort = 'klant', q = '', status = 'opgeslagen', seizoen = '', locatie = '' } = {}) {
  const where = ['t.soort = ?'];
  const params = [soort];
  if (q) {
    const pk = plateKey(q);
    where.push(`(t.search_text LIKE ? ESCAPE '\\' OR (? <> '' AND t.plate_key LIKE ? ESCAPE '\\'))`);
    params.push(likeTerm(q.toLowerCase()), pk, likeTerm(pk));
  }
  if (TYRE_STATUSES[status]) { where.push('t.status = ?'); params.push(status); }
  if (seizoen) { where.push('t.seizoen = ? COLLATE NOCASE'); params.push(seizoen); }
  if (locatie) { where.push('t.locatie = ? COLLATE NOCASE'); params.push(locatie); }
  return db.prepare(
    `SELECT t.*, c.id AS customer_id FROM tyre_storage t
     LEFT JOIN customers c ON c.plate_key = t.plate_key AND t.plate_key <> ''
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY CASE t.status WHEN 'op_auto' THEN 0 WHEN 'opgeslagen' THEN 1 ELSE 2 END, t.klant_naam COLLATE NOCASE, t.kenteken LIMIT 3000`
  ).all(...params);
}
function tyresForPlate(pk) {
  if (!pk) return [];
  return db.prepare(`SELECT * FROM tyre_storage WHERE plate_key = ? ORDER BY ${STATUS_ORDER}, datum_in DESC, id DESC`).all(pk);
}
function tyreCounts(soort = 'klant') {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM tyre_storage WHERE soort = ? GROUP BY status').all(soort);
  const out = { opgeslagen: 0, op_auto: 0, uitgegeven: 0 };
  for (const r of rows) out[r.status] = r.n;
  out.alle = out.opgeslagen + out.op_auto + out.uitgegeven;
  out.perSoort = Object.fromEntries(Object.keys(TYRE_SOORTEN).map((k) => [k, 0]));
  for (const r of db.prepare("SELECT soort, COUNT(*) AS n FROM tyre_storage WHERE status = 'opgeslagen' GROUP BY soort").all()) out.perSoort[r.soort] = r.n;
  return out;
}

/**
 * Banden van een klant: zorg dat de klant op de Klantenpagina staat (op kenteken). Een bestaande klant
 * houdt zijn gegevens; alleen lege velden (naam, auto, telefoon) worden aangevuld. Geeft 'nieuw', 'aangevuld' of null.
 */
function ensureCustomer(t) {
  if (t.soort !== 'klant' || !t.plate_key) return null;
  const c = db.prepare('SELECT * FROM customers WHERE plate_key = ?').get(t.plate_key);
  if (!c) {
    db.prepare('INSERT INTO customers (plate_key, kenteken, naam, merk_type, tel_prive) VALUES (?, ?, ?, ?, ?)')
      .run(t.plate_key, t.kenteken, t.klant_naam, t.auto, t.telefoon);
    return 'nieuw';
  }
  const fill = { naam: t.klant_naam, merk_type: t.auto, tel_prive: t.telefoon };
  const sets = Object.entries(fill).filter(([k, v]) => v && !String(c[k] || '').trim() && !(k === 'tel_prive' && c.tel_zaak));
  if (!sets.length) return null;
  db.prepare(`UPDATE customers SET ${sets.map(([k]) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...sets.map(([, v]) => v), c.id);
  return 'aangevuld';
}
/** Wat ensureCustomer zou doen (voor het voorbeeld van de import). */
function customerAction(t) {
  if (t.soort !== 'klant' || !t.plate_key) return null;
  return db.prepare('SELECT 1 FROM customers WHERE plate_key = ?').get(t.plate_key) ? 'bestaand' : 'nieuw';
}
/** Waarden die al voorkomen (voor keuzelijsten en filters), meest gebruikt eerst. */
function distinct(table, col, where = '') {
  if (!/^[a-z_]+$/.test(table + col)) throw new Error('ongeldige kolom');
  return db.prepare(`SELECT ${col} AS v, COUNT(*) AS n FROM ${table} WHERE ${col} <> '' ${where} GROUP BY ${col} COLLATE NOCASE ORDER BY n DESC LIMIT 200`)
    .all().map((r) => r.v);
}
function setTyreStatus(id, status, userId) {
  if (!TYRE_STATUSES[status]) return;
  const today = orders.todayISO();
  const cur = db.prepare('SELECT status FROM tyre_storage WHERE id = ?').get(id);
  if (!cur) return;
  if (status === 'opgeslagen') {
    // Van de auto af (of terug) de opslag in: vanaf vandaag in opslag.
    db.prepare(`UPDATE tyre_storage SET status = 'opgeslagen', datum_uit = '', uitgenodigd_at = NULL,
                datum_in = CASE WHEN ? = 'op_auto' OR datum_in = '' THEN ? ELSE datum_in END,
                updated_by = ?, updated_at = datetime('now') WHERE id = ?`).run(cur.status, today, userId, id);
  } else {
    db.prepare(`UPDATE tyre_storage SET status = ?, datum_uit = ?, uitgenodigd_at = NULL, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(status, today, userId, id);
  }
}

/* ---------- wisselen: welke banden staan op de auto ---------- */
/** Seizoen in één woord: 'winter', 'zomer', 'all' of '' (onbekend of gemengd). */
function seasonClass(s) {
  const l = String(s || '').toLowerCase();
  if (/all\s*-?\s*season|4\s*seizoen|vierseizoen|all\s*weather/.test(l)) return 'all';
  const w = /winter/.test(l);
  const z = /zomer|summer/.test(l);
  return w && !z ? 'winter' : z && !w ? 'zomer' : '';
}
const SEASON_LABEL = { winter: 'Winter', zomer: 'Zomer', all: 'All season', '': 'Onbekend' };
/** Welke kant het op gaat: van half september t/m januari naar winterbanden, anders naar zomerbanden. */
function swapTarget(iso = orders.todayISO()) {
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return m >= 10 || m === 1 || (m === 9 && d >= 15) ? 'winter' : 'zomer';
}
function onCarFor(pk, exceptId) {
  if (!pk) return null;
  return db.prepare("SELECT * FROM tyre_storage WHERE plate_key = ? AND soort = 'klant' AND status = 'op_auto' AND id <> ? ORDER BY datum_uit DESC, id DESC").get(pk, exceptId || 0);
}
/**
 * Wisselen: deze opgeslagen set gaat op de auto. Wat eraf komt (opties.eraf):
 *   (niet opgegeven) de set die volgens ADONIS op de auto staat, als die bekend is;
 *   <id>    een bepaalde set van deze klant (bijv. een set die als "in opslag" stond maar eigenlijk op de auto zat);
 *   'nieuw' banden die ADONIS nog niet kent (daarna invullen);
 *   'geen'  niets de opslag in (de klant neemt ze mee / ze gaan weg).
 * De set die eraf komt gaat naar opties.locatie, anders naar de plek die net vrijkwam.
 * Wat verder nog als "op de auto" stond, klopt niet meer en wordt uitgegeven.
 */
function swapOnto(id, userId, opts = {}) {
  const t = db.prepare('SELECT * FROM tyre_storage WHERE id = ?').get(id);
  if (!t || t.status !== 'opgeslagen') return { error: 'Deze set staat niet in de opslag.' };
  const eraf = opts.eraf === undefined || opts.eraf === null || opts.eraf === '' ? 'auto' : String(opts.eraf);
  let off = null;
  if (eraf === 'auto') off = onCarFor(t.plate_key, t.id);
  else if (/^\d+$/.test(eraf)) {
    off = db.prepare('SELECT * FROM tyre_storage WHERE id = ?').get(Number(eraf));
    if (!off || off.id === t.id || off.plate_key !== t.plate_key || !t.plate_key) return { error: 'Die set hoort niet bij deze auto.' };
  } else if (!['nieuw', 'geen'].includes(eraf)) return { error: 'Kies welke banden eraf komen.' };
  const locatie = String(opts.locatie || '').trim().slice(0, 80) || t.locatie || (off && off.locatie) || '';
  db.exec('BEGIN');
  try {
    setTyreStatus(t.id, 'op_auto', userId);
    if (off) {
      setTyreStatus(off.id, 'opgeslagen', userId);
      db.prepare('UPDATE tyre_storage SET locatie = ? WHERE id = ?').run(locatie, off.id);
    }
    // Wat verder nog als "op de auto" stond, klopt niet meer (bij "nieuw"/"geen" ook de oude registratie).
    db.prepare("UPDATE tyre_storage SET status = 'uitgegeven', datum_uit = ? WHERE plate_key = ? AND soort = 'klant' AND status = 'op_auto' AND id NOT IN (?, ?)")
      .run(orders.todayISO(), t.plate_key, t.id, off ? off.id : 0);
    db.exec('COMMIT');
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  }
  return { tyre: t, eraf: off ? 'set' : eraf === 'auto' ? 'nieuw' : eraf, locatie, off: off ? { ...off, locatie } : null };
}
/** Vastleggen wat er nu op de auto staat (snel, vanaf de klantpagina). Werkt de bekende set bij of maakt er een. */
function setOnCar(customer, fields, userId) {
  const cur = onCarFor(customer.plate_key);
  const base = cur || {};
  const data = normalizeTyre({
    ...base, soort: 'klant', status: 'op_auto', kenteken: customer.kenteken, klant_naam: base.klant_naam || customer.naam,
    telefoon: base.telefoon || customer.tel_prive || customer.tel_zaak, auto: base.auto || customer.merk_type,
    seizoen: fields.seizoen, maat: fields.maat, profiel_voor: fields.profiel_voor, profiel_achter: fields.profiel_achter,
    datum_uit: base.datum_uit || orders.todayISO(), extra: base.extra || '{}',
  });
  return saveTyre({ id: cur && cur.id, data, userId });
}
function toggleInvited(id, userId) {
  const t = db.prepare('SELECT uitgenodigd_at FROM tyre_storage WHERE id = ?').get(id);
  if (!t) return null;
  const next = t.uitgenodigd_at ? null : orders.todayISO();
  db.prepare("UPDATE tyre_storage SET uitgenodigd_at = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?").run(next, userId, id);
  return next;
}
function minTread(t) {
  const v = [t && t.profiel_voor, t && t.profiel_achter].filter((x) => x !== null && x !== undefined);
  return v.length ? Math.min(...v) : null;
}
/**
 * Wissellijst: per klant (kenteken) in het bandenhotel of er gewisseld moet worden naar het doelseizoen.
 *  - wisselen:    er ligt een set van het doelseizoen in opslag, en op de auto staat iets anders (of onbekend)
 *  - klaar:       op de auto staat al het doelseizoen (of all season), of de set in opslag is van het andere seizoen
 *  - controleren: seizoen in opslag of op de auto is onbekend/gemengd
 */
function swapList(target) {
  const rows = db.prepare(
    `SELECT t.*, c.id AS customer_id, c.naam AS c_naam, c.tel_prive AS c_tel_prive, c.tel_zaak AS c_tel_zaak
     FROM tyre_storage t LEFT JOIN customers c ON c.plate_key = t.plate_key AND t.plate_key <> ''
     WHERE t.soort = 'klant' AND t.status IN ('opgeslagen', 'op_auto')`
  ).all();
  const groups = new Map();
  for (const r of rows) {
    const key = r.plate_key || 'naam:' + r.klant_naam.toLowerCase() + ':' + r.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const out = { target, wisselen: [], klaar: [], controleren: [] };
  for (const list of groups.values()) {
    const onCar = list.filter((r) => r.status === 'op_auto').sort((a, b) => (b.datum_uit || '').localeCompare(a.datum_uit || ''))[0] || null;
    const stored = list.filter((r) => r.status === 'opgeslagen');
    if (!stored.length) continue; // niets in opslag: niets te wisselen
    const first = onCar || stored[0];
    const carClass = onCar ? seasonClass(onCar.seizoen) : null;
    const match = stored.find((r) => seasonClass(r.seizoen) === target);
    const item = {
      plate_key: first.plate_key, kenteken: first.kenteken, customer_id: first.customer_id,
      naam: first.c_naam || first.klant_naam, telefoon: first.telefoon || first.c_tel_prive || first.c_tel_zaak || '',
      auto: first.auto, onCar, carClass, stored, match, tread: minTread(onCar), matchTread: minTread(match),
    };
    if (carClass === target || carClass === 'all') { item.reden = `Staat al op ${SEASON_LABEL[carClass].toLowerCase()}banden`; out.klaar.push(item); continue; }
    if (match) {
      item.reden = onCar ? `Rijdt op ${SEASON_LABEL[carClass || ''].toLowerCase()}banden` : 'Wat er op de auto staat is niet vastgelegd (waarschijnlijk het andere seizoen)';
      out.wisselen.push(item);
      continue;
    }
    const classes = stored.map((r) => seasonClass(r.seizoen));
    if (!onCar && classes.every((c) => c && c !== target)) {
      item.reden = `In opslag: ${SEASON_LABEL[classes[0]].toLowerCase()}banden, dus waarschijnlijk al gewisseld`;
      out.klaar.push(item);
      continue;
    }
    item.reden = classes.includes('') ? 'Seizoen van de set in opslag is onbekend of gemengd' : 'Op de auto staat iets onbekends';
    out.controleren.push(item);
  }
  const byName = (a, b) => String(a.naam || a.kenteken).localeCompare(String(b.naam || b.kenteken), 'nl');
  // Eerst wie nog niet is gebeld, dan wie het slechtste profiel op de auto heeft, dan op naam.
  out.wisselen.sort((a, b) => (a.match.uitgenodigd_at ? 1 : 0) - (b.match.uitgenodigd_at ? 1 : 0)
    || (a.tread ?? 99) - (b.tread ?? 99) || byName(a, b));
  out.klaar.sort(byName);
  out.controleren.sort(byName);
  return out;
}

function deleteTyre(id) {
  db.prepare('DELETE FROM tyre_storage WHERE id = ?').run(id);
}

/* ---------- voorraad ---------- */
const SOORTEN = { onderdeel: 'Onderdelen', band: 'Banden' };

function normalizeStock(input, soort) {
  const d = input || {};
  const s = SOORTEN[soort || d.soort] ? soort || d.soort : 'onderdeel';
  const out = {
    soort: s,
    beschikbaar: d.beschikbaar === false || d.beschikbaar === 0 || d.beschikbaar === '0' ? 0 : 1,
    aantal: Math.max(0, Math.min(100000, parseIntSafe(d.aantal, 1))),
    merk: clean(d.merk, 100),
    nummer: clean(d.nummer, 100),
    oe_nummer: clean(d.oe_nummer, 200),
    type: clean(d.type, 100),
    omschrijving: cleanMulti(d.omschrijving, 2000),
    maat: s === 'band' ? normalizeSize(d.maat) : clean(d.maat, 60),
    profiel: clean(d.profiel, 60),
    snelheid: clean(d.snelheid, 30),
    seizoen: s === 'band' ? normalizeSeason(d.seizoen) : '',
    locatie: clean(d.locatie, 100),
    prijs: clean(d.prijs, 30),
    datum: orders.parseDate(d.datum) || '',
    extra: typeof d.extra === 'string' ? d.extra : extraJson(d.extra),
  };
  return out;
}
const STOCK_COLS = ['soort', 'beschikbaar', 'aantal', 'merk', 'nummer', 'oe_nummer', 'type', 'omschrijving', 'maat', 'profiel', 'snelheid',
  'seizoen', 'locatie', 'prijs', 'datum', 'extra'];
function stockSearch(s) {
  return {
    search_key: ' ' + [...[s.nummer, s.oe_nummer, s.maat].map(numberKey), sizeKey(s.maat)].filter(Boolean).join(' ') + ' ',
    search_text: [s.merk, s.nummer, s.oe_nummer, s.type, s.omschrijving, s.maat, s.profiel, s.snelheid, s.seizoen, s.locatie,
      Object.values(parseExtra(s.extra)).join(' ')].join(' ').toLowerCase(),
  };
}
function saveStock({ id, data, userId }) {
  const s = { ...data, ...stockSearch(data) };
  const cols = [...STOCK_COLS, 'search_key', 'search_text'];
  if (id) {
    db.prepare(`UPDATE stock_items SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(...cols.map((c) => s[c]), userId, id);
    return Number(id);
  }
  const r = db.prepare(`INSERT INTO stock_items (${cols.join(', ')}, created_by, updated_by) VALUES (${cols.map(() => '?').join(', ')}, ?, ?)`)
    .run(...cols.map((c) => s[c]), userId, userId);
  return Number(r.lastInsertRowid);
}
function getStock(id) {
  return db.prepare('SELECT s.*, uu.name AS updated_by_name FROM stock_items s LEFT JOIN users uu ON uu.id = s.updated_by WHERE s.id = ?').get(id);
}
function searchStock({ soort = 'onderdeel', q = '', type = '', locatie = '', alleen = false } = {}) {
  const where = ['soort = ?'];
  const params = [soort];
  if (q) {
    // Elk woord moet ergens voorkomen; nummers ook zonder spaties/punten ("1493001" vindt "1 493 001").
    const conds = [];
    const p = [];
    for (const word of q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)) {
      const nk = numberKey(word);
      conds.push(`(search_text LIKE ? ESCAPE '\\' OR (? <> '' AND search_key LIKE ? ESCAPE '\\'))`);
      p.push(likeTerm(word), nk, likeTerm(nk));
    }
    const whole = numberKey(q);
    if (whole.length >= 4 && /\s/.test(q.trim())) {
      // "1 493 001" als geheel zoeken, ook als de losse delen niet apart voorkomen.
      where.push(`(search_key LIKE ? ESCAPE '\\' OR (${conds.join(' AND ')}))`);
      params.push(likeTerm(whole), ...p);
    } else if (conds.length) {
      where.push(...conds);
      params.push(...p);
    }
  }
  if (type) { where.push('type = ? COLLATE NOCASE'); params.push(type); }
  if (locatie) { where.push('locatie = ? COLLATE NOCASE'); params.push(locatie); }
  if (alleen) where.push('beschikbaar = 1 AND aantal > 0');
  return db.prepare(
    `SELECT * FROM stock_items WHERE ${where.join(' AND ')}
     ORDER BY ${soort === 'band' ? "maat = '', maat COLLATE NOCASE, merk COLLATE NOCASE" : "type = '', type COLLATE NOCASE, merk COLLATE NOCASE, nummer COLLATE NOCASE"} LIMIT 3000`
  ).all(...params);
}
function stockCounts() {
  const out = { onderdeel: 0, band: 0 };
  for (const r of db.prepare('SELECT soort, COUNT(*) AS n FROM stock_items GROUP BY soort').all()) out[r.soort] = r.n;
  return out;
}
function adjustStock(id, delta, userId) {
  db.prepare(`UPDATE stock_items SET aantal = MAX(0, aantal + ?), beschikbaar = CASE WHEN aantal + ? > 0 THEN 1 ELSE beschikbaar END,
              updated_by = ?, updated_at = datetime('now') WHERE id = ?`).run(delta, delta, userId, id);
  return getStock(id);
}
function deleteStock(id) {
  db.prepare('DELETE FROM stock_items WHERE id = ?').run(id);
}

module.exports = {
  TYRE_SOORTEN, formatPlate, ensureCustomer, customerAction,
  seasonClass, SEASON_LABEL, swapTarget, onCarFor, swapOnto, setOnCar, toggleInvited, swapList, minTread,
  TYRE_STATUSES, VELGEN, SEASONS, SOORTEN,
  normalizeTyre, saveTyre, getTyre, searchTyres, tyresForPlate, tyreCounts, setTyreStatus, deleteTyre,
  normalizeStock, saveStock, getStock, searchStock, stockCounts, adjustStock, deleteStock,
  distinct, parseExtra, parseMm, fmtMm, treadClass, normalizeSize, normalizeSeason, numberKey, sizeKey, clean,
};
