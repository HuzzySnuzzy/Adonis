'use strict';

const { db, plateKey } = require('./db');

const PART_ROWS = 22;
const WORK_LINES = 19;
const UREN_ROWS = 6;
const ADVIES_ROWS = 16;
const ADVIES_SOORT = ['garantie', 'noodzaak', 'geen'];
const ADVIES_BESLUIT = ['uitvoeren', 'niet', 'afspraak'];

/** Header fields that belong to the customer/vehicle (copied onto new orders). */
const CUSTOMER_FIELDS = [
  'kenteken', 'naam', 'adres', 'plaats', 'klantnr', 'tel_prive', 'tel_zaak',
  'merk_type', 'chassisnummer', 'alarmcode',
];

const FLUIDS = [
  { key: 'motorolie', label: 'Motorolie', kind: 'visc' },
  { key: 'cardanolie', label: 'Cardan-/versnellingsbakolie' },
  { key: 'atf', label: 'ATF-olie' },
  { key: 'koelvloeistof', label: 'Koelvloeistof', suffix: '°C' },
  { key: 'remvloeistof', label: 'Remvloeistof' },
  { key: 'ruitensproeier', label: 'Ruitensproeiervloeistof' },
  { key: 'koudemiddel', label: 'Koudemiddel (airco)' },
  { key: 'extra1', label: '' },
  { key: 'extra2', label: '' },
];

const TIRES = [
  { key: 'lv', label: 'Linksvoor' },
  { key: 'rv', label: 'Rechtsvoor' },
  { key: 'la', label: 'Linksachter' },
  { key: 'ra', label: 'Rechtsachter' },
  { key: 'reserve', label: 'Reservewiel' },
];

/** The full shape of a work order. Every field the form can send is listed here. */
function emptyOrderData() {
  const fluids = {};
  for (const f of FLUIDS) fluids[f.key] = { liter: '', info: '', info2: '', prijs: '' };
  const tires = {};
  for (const t of TIRES) tires[t.key] = { profiel: '', maat: '', merk: '', dot: '' };
  return {
    // kop rechts
    monteur: '', datum_gereed: '', klantnr: '', kenteken: '', merk_type: '',
    km_in: '', km_uit: '', datum_deel1: '', apk_datum: '',
    naam: '', adres: '', plaats: '', tel_prive: '', tel_zaak: '',
    alle_reparaties: '', contact_boven: '', chassisnummer: '', alarmcode: '',
    // Soort voorkant: '' = oorspronkelijk (werkzaamheden als vier grote tekstvakken), '2' = regel voor regel.
    // De gegevens zijn bij allebei hetzelfde (tekst met een regel per werkzaamheid); alleen het formulier verschilt.
    voorkant: '',
    // werkzaamheden
    servicebeurt_km: '',
    werk_check: '', werk_omschrijving: '', werk_code: '', werk_tijd: '',
    // voet rechts
    faktuurnr: '', totaal_uren: '', tarief: '', bedrag: '',
    // onderdelen links
    onderdelen: Array.from({ length: PART_ROWS }, () => ({ nr: '', omschrijving: '', aantal: '', prijs: '' })),
    vloeistoffen: fluids,
    diversen: {
      servicewagen_km: '', servicewagen_prijs: '',
      leenauto_km: '', leenauto_prijs: '',
      werk_derden: '', werk_derden_prijs: '',
      apk: false, afmeldkosten: false, apk_prijs: '',
      testapparatuur: '', testapparatuur_prijs: '',
      extra: '', extra_prijs: '',
      uitlijnen: false, balanceren: false, uitlijnen_prijs: '',
      kleinmateriaal: '', kleinmateriaal_prijs: '',
      milieutoeslag: '', milieutoeslag_prijs: '',
    },
    // achterzijde
    achter: {
      banden: tires, // profiel per wiel (+ oude velden maat/merk/dot per wiel)
      band_merk: '', band_type: '', band_maat: '',
      // Uren per monteur
      uren: Array.from({ length: UREN_ROWS }, () => ({ datum: '', naam: '', van: '', tot: '', uren: '', tarief: '', bedrag: '' })),
      // Aantekeningen van de werkplaats / APK-advies, met keuze per regel
      advies: Array.from({ length: ADVIES_ROWS }, () => ({ check: false, tekst: '', soort: '', kosten: '', besluit: '' })),
      begroot: '',
      keuring: { apk: false, goed: false, af: false, roet: false, viergas: false, motorcode: '', olie_min: '', olie_test: '',
        stationair: '', stationair_tot: '', afregel: '', afregel_tot: '', k_waarde: '' },
      leenauto: { getankt: '', merk_type: '', kenteken: '', retour_km: '', retour_dd: '', retour_om: '', vertrek_km: '', vertrek_dd: '', vertrek_om: '', tarief: '', per: '' },
      // Oude achterkant (vóór 1.47): wordt bij openen omgezet naar de aantekeningen hierboven
      apk: '',
      aandachtspunten: '',
      notities: '',
    },
  };
}

/* Extra bladen achter de werkopdracht: een vervolgblad voorkant (onderdelen + werkzaamheden),
 * een vervolgblad achterkant (APK/afkeurpunten, aandachtspunten, notities) of een leeg blad. */
const PAGE_TYPES = {
  voor: { label: 'Voorkant', template: () => ({
    onderdelen: Array.from({ length: PART_ROWS }, () => ({ nr: '', omschrijving: '', aantal: '', prijs: '' })),
    werk_check: '', werk_omschrijving: '', werk_code: '', werk_tijd: '',
  }) },
  achter: { label: 'Achterkant', template: () => ({ apk: '', aandachtspunten: '', notities: '' }) },
  blanco: { label: 'Leeg blad', template: () => ({ titel: '', tekst: '' }) },
};
const MAX_PAGES = 12;
function emptyPage(soort) { return { soort, ...PAGE_TYPES[soort].template() }; }
function normalizePages(input) {
  const list = Array.isArray(input) ? input
    : input && typeof input === 'object' ? Object.keys(input).sort((a, b) => Number(a) - Number(b)).map((k) => input[k]) : [];
  return list.filter((p) => p && PAGE_TYPES[p.soort]).slice(0, MAX_PAGES)
    .map((p) => ({ soort: p.soort, ...shape(PAGE_TYPES[p.soort].template(), joinWorkRows(p)) }));
}

/** Copy `input` into the shape of `template`, keeping only known keys and coercing types. */
function shape(template, input) {
  if (Array.isArray(template)) {
    const arr = Array.isArray(input) ? input : input && typeof input === 'object' ? Object.values(input) : [];
    return template.map((t, i) => shape(t, arr[i]));
  }
  if (template && typeof template === 'object') {
    const src = input && typeof input === 'object' ? input : {};
    const out = {};
    for (const key of Object.keys(template)) out[key] = shape(template[key], src[key]);
    return out;
  }
  if (typeof template === 'boolean') {
    return input === true || input === 'on' || input === 'true' || input === '1';
  }
  if (input === undefined || input === null) return '';
  if (Array.isArray(input)) input = input[input.length - 1];
  return String(input).replace(/\r\n/g, '\n').slice(0, 5000);
}

/* ---------- Werkzaamheden regel voor regel (voorkant 2) ----------
 * Opgeslagen als vier teksten (één regel per werkzaamheid), getoond als losse regels met vier vakjes. */
const WORK_COLS = ['check', 'omschrijving', 'code', 'tijd'];
function workRows(src, min = WORK_LINES) {
  const cols = WORK_COLS.map((c) => String((src && src['werk_' + c]) || '').split('\n'));
  const used = Math.max(0, ...cols.map((l) => (l.length === 1 && l[0] === '' ? 0 : l.length)));
  return Array.from({ length: Math.max(min, used) }, (_, i) => Object.fromEntries(WORK_COLS.map((c, k) => [c, cols[k][i] ?? ''])));
}
/** Regels uit het formulier (werk_regels) terug naar de vier teksten. */
function joinWorkRows(obj) {
  if (!obj || typeof obj !== 'object' || !obj.werk_regels || typeof obj.werk_regels !== 'object') return obj;
  const src = obj.werk_regels;
  const rows = Array.isArray(src) ? Array.from(src) : Object.keys(src).sort((a, b) => Number(a) - Number(b)).map((k) => src[k]);
  const out = { ...obj };
  delete out.werk_regels;
  for (const c of WORK_COLS) {
    out['werk_' + c] = rows.map((r) => String((r && r[c]) ?? '').replace(/[\r\n]+/g, ' ')).join('\n').replace(/(\n[ \t]*)+$/, '');
  }
  return out;
}
/** Voor het formulier en live bijwerken: bij voorkant 2 de werkzaamheden als regels. */
function withWorkRows(data) {
  const view = JSON.parse(JSON.stringify(data));
  if (view.voorkant !== '2') return view;
  const swap = (o, min) => { o.werk_regels = workRows(o, min); for (const c of WORK_COLS) delete o['werk_' + c]; };
  swap(view, WORK_LINES);
  for (const pg of view.paginas || []) if (pg.soort === 'voor') swap(pg, WORK_LINES + 3);
  return view;
}

function normalizeOrderData(input) {
  input = joinWorkRows(input);
  const data = shape(emptyOrderData(), input);
  if (data.voorkant !== '2') data.voorkant = '';
  data.kenteken = data.kenteken.toUpperCase().trim();
  if (!['ja', 'nee'].includes(data.alle_reparaties)) data.alle_reparaties = '';
  for (const f of ['datum_gereed', 'datum_deel1', 'apk_datum']) data[f] = parseDate(data[f]);
  data.paginas = normalizePages(input && input.paginas);
  fixBack(data);
  return data;
}
/** Keuzes op de achterkant: alleen bekende waarden. */
function fixBack(data) {
  const a = data.achter;
  for (const r of a.advies) {
    if (!ADVIES_SOORT.includes(r.soort)) r.soort = '';
    if (!ADVIES_BESLUIT.includes(r.besluit)) r.besluit = '';
  }
  if (!['ja', 'nee'].includes(a.leenauto.getankt)) a.leenauto.getankt = '';
  if (!['halve', 'dag'].includes(a.leenauto.per)) a.leenauto.per = '';
}
/** Oude werkopdrachten (achterkant van vóór 1.47) netjes tonen op de nieuwe achterkant. */
function migrateBack(data) {
  const a = data.achter;
  const wheels = Object.values(a.banden);
  if (!a.band_maat) a.band_maat = (wheels.find((w) => w.maat) || {}).maat || '';
  if (!a.band_merk) a.band_merk = (wheels.find((w) => w.merk) || {}).merk || '';
  const old = [['APK', a.apk], ['', a.aandachtspunten], ['', a.notities]].filter(([, t]) => t && t.trim());
  if (old.length && a.advies.every((r) => !r.tekst.trim())) {
    const lines = old.flatMap(([pre, t]) => t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => (pre && !/^apk/i.test(l) ? `${pre}: ${l}` : l)));
    lines.slice(0, a.advies.length).forEach((l, i) => { a.advies[i].tekst = l; });
    // Past het niet allemaal, dan de rest achter de laatste regel zetten (er gaat niets verloren).
    if (lines.length > a.advies.length) a.advies[a.advies.length - 1].tekst += ' · ' + lines.slice(a.advies.length).join(' · ');
    a.apk = ''; a.aandachtspunten = ''; a.notities = '';
  }
  return data;
}

/** Load stored JSON and fill in fields that may have been added later. */
function parseOrderData(json) {
  let raw = {};
  try { raw = JSON.parse(json); } catch { /* keep empty */ }
  const data = shape(emptyOrderData(), raw);
  data.paginas = normalizePages(raw && raw.paginas);
  if (data.voorkant !== '2') data.voorkant = '';
  fixBack(data);
  return migrateBack(data);
}

function flattenText(value, out = []) {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) flattenText(v, out);
  } else if (typeof value === 'string' && value.trim()) {
    out.push(value.trim());
  }
  return out;
}

function todayISO() {
  // Datum in Nederlandse tijd, als YYYY-MM-DD
  return new Intl.DateTimeFormat('sv-SE', { timeZone: process.env.APP_TIMEZONE || 'Europe/Amsterdam' }).format(new Date());
}

/**
 * Datum zoals op papier of door de foto-import gelezen -> "YYYY-MM-DD", of "" als het geen geldige datum is.
 * Begrijpt o.a. 28-9-26, 28/09/2026, 28.9.26, 28 9 26 en 2026-09-28. Tweecijferig jaar: 26 -> 2026.
 */
function parseDate(value) {
  const s = String(value || '').trim();
  let y; let m; let d;
  let r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (r) {
    [, y, m, d] = r.map(Number);
  } else {
    r = /^(\d{1,2})\s*[-/. ]\s*(\d{1,2})\s*[-/. ]\s*(\d{2}|\d{4})$/.exec(s);
    if (!r) return '';
    [, d, m, y] = r.map(Number);
    if (r[3].length === 2) {
      const thisYear = Number(todayISO().slice(2, 4));
      y += y <= thisYear + 1 ? 2000 : 1900; // 26 -> 2026, 98 -> 1998
    }
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (y < 1950 || y > 2100 || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/* ---------- Status: open -> klaar (voor facturatie) -> gefactureerd ---------- */
const STATUSES = {
  open: 'Open',
  klaar: 'Klaar voor facturatie',
  gefactureerd: 'Gefactureerd',
};
{
  const cols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
  if (!cols.includes('status')) db.exec("ALTER TABLE orders ADD COLUMN status TEXT NOT NULL DEFAULT 'open'");
  if (!cols.includes('status_at')) db.exec('ALTER TABLE orders ADD COLUMN status_at TEXT');
  if (!cols.includes('status_by')) db.exec('ALTER TABLE orders ADD COLUMN status_by INTEGER REFERENCES users(id) ON DELETE SET NULL');
  // Volgnummer van elke opslag (ook automatisch opslaan, vaker dan eens per seconde): zo merkt een scherm dat het iets heeft gemist.
  if (!cols.includes('rev')) db.exec('ALTER TABLE orders ADD COLUMN rev INTEGER NOT NULL DEFAULT 0');
  db.exec(`
    CREATE INDEX IF NOT EXISTS orders_status ON orders(status);
    CREATE TABLE IF NOT EXISTS order_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      user_name  TEXT NOT NULL DEFAULT '',
      action     TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/** Wie mag de inhoud van een werkopdracht wijzigen? */
function canEdit(user, order) {
  const status = order ? order.status : 'open';
  if (status === 'open') return true;
  if (status === 'klaar') return Boolean(user.can_invoice);
  return false; // gefactureerd: eerst heropenen
}

/** Welke statuswijzigingen mag deze gebruiker doen vanuit de huidige status? */
function allowedTransitions(user, order) {
  switch (order.status) {
    case 'open': return user.can_invoice ? ['klaar', 'gefactureerd'] : ['klaar']; // facturatie mag direct afronden
    case 'klaar': return user.can_invoice ? ['open', 'gefactureerd'] : ['open'];
    case 'gefactureerd': return user.can_invoice ? ['klaar'] : [];
    default: return [];
  }
}

const LOG_TEXT = {
  open: 'teruggezet naar Open', klaar: 'naar facturatie gestuurd', gefactureerd: 'gefactureerd (afgerond)',
};

function setStatus(orderId, status, user) {
  if (!STATUSES[status]) throw new Error('Onbekende status');
  const prev = (db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId) || {}).status;
  db.prepare("UPDATE orders SET status = ?, status_at = datetime('now'), status_by = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, user.id, orderId);
  logAction(orderId, user, prev === 'gefactureerd' && status === 'klaar' ? 'heropend'
    : prev === 'klaar' && status === 'open' ? 'teruggezet naar Open (terug naar monteur)'
      : prev === 'open' && status === 'gefactureerd' ? 'direct gefactureerd (afgerond)' : LOG_TEXT[status]);
}

function logAction(orderId, user, action) {
  db.prepare('INSERT INTO order_log (order_id, user_id, user_name, action) VALUES (?, ?, ?, ?)')
    .run(orderId, user ? user.id : null, user ? user.name : '', action);
}

function history(orderId) {
  return db.prepare('SELECT * FROM order_log WHERE order_id = ? ORDER BY id DESC LIMIT 50').all(orderId);
}

function statusCounts() {
  const counts = { open: 0, klaar: 0, gefactureerd: 0 };
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all()) counts[r.status] = r.n;
  return counts;
}

/** Werkopdrachtnummer zoals op het papieren formulier: minstens 4 cijfers (0001, 0100, 1234; daarna gewoon 10000). */
function fmtNr(n) {
  const s = String(n ?? '').trim();
  return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '').padStart(4, '0') : s;
}

function nextOrderNumber() {
  const row = db.prepare('SELECT MAX(nummer) AS max FROM orders').get();
  const start = parseInt(process.env.START_ORDER_NUMBER || '1', 10) || 1;
  return Math.max(row.max ? row.max + 1 : start, start);
}

function getOrCreateCustomer(kenteken) {
  const key = plateKey(kenteken);
  let row = db.prepare('SELECT * FROM customers WHERE plate_key = ?').get(key);
  if (!row) {
    db.prepare('INSERT INTO customers (plate_key, kenteken) VALUES (?, ?)').run(key, kenteken.toUpperCase());
    row = db.prepare('SELECT * FROM customers WHERE plate_key = ?').get(key);
  }
  return row;
}

/**
 * Klantgegevens = de laatst ingevulde waarde van elk veld over de werkopdrachten.
 * Zijn de gegevens met de hand gewijzigd (bewerkt_at), dan tellen alleen werkopdrachten die daarna
 * zijn aangemaakt: een oude werkopdracht (ook als die opnieuw wordt opgeslagen) overschrijft een correctie niet.
 */
function refreshCustomer(customerId) {
  const orders = db.prepare('SELECT data, created_at FROM orders WHERE customer_id = ? ORDER BY nummer DESC').all(customerId);
  if (orders.length === 0) {
    // Klant blijft bestaan als er nog banden van hem in het bandenhotel liggen.
    let hasTyres = false;
    try {
      hasTyres = Boolean(db.prepare(
        "SELECT 1 FROM tyre_storage t JOIN customers c ON c.plate_key = t.plate_key WHERE c.id = ? AND t.soort = 'klant' LIMIT 1"
      ).get(customerId));
    } catch { /* tabel bestaat (nog) niet */ }
    if (!hasTyres) db.prepare('DELETE FROM customers WHERE id = ?').run(customerId);
    return;
  }
  const values = {};
  const cust = db.prepare('SELECT bewerkt_at FROM customers WHERE id = ?').get(customerId);
  const since = cust && cust.bewerkt_at;
  for (const o of orders) {
    if (since && !(o.created_at > since)) continue;
    const d = parseOrderData(o.data);
    for (const f of CUSTOMER_FIELDS) {
      if (values[f] === undefined && d[f] && d[f].trim()) values[f] = d[f].trim();
    }
  }
  // Velden die op geen enkele werkopdracht staan, blijven zoals ze waren (bijv. naam uit het bandenhotel).
  const sets = CUSTOMER_FIELDS.map((f) => `${f} = COALESCE(NULLIF(?, ''), ${f})`).join(', ');
  db.prepare(`UPDATE customers SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(
    ...CUSTOMER_FIELDS.map((f) => values[f] || ''),
    customerId
  );
}

function saveOrder({ id, nummer, data, userId, datumInvoer }) {
  const customer = getOrCreateCustomer(data.kenteken);
  const searchText = [nummer, fmtNr(nummer), ...flattenText(data)].join(' \n ');
  let orderId = id;
  let oldCustomerId = null;
  db.exec('BEGIN');
  try {
    if (id) {
      oldCustomerId = db.prepare('SELECT customer_id FROM orders WHERE id = ?').get(id).customer_id;
      db.prepare(
        `UPDATE orders SET nummer = ?, customer_id = ?, data = ?, search_text = ?, updated_by = ?,
         datum_invoer = COALESCE(?, datum_invoer), updated_at = datetime('now'), rev = rev + 1 WHERE id = ?`
      ).run(nummer, customer.id, JSON.stringify(data), searchText, userId, datumInvoer || null, id);
    } else {
      const res = db.prepare(
        `INSERT INTO orders (nummer, customer_id, datum_invoer, data, search_text, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(nummer, customer.id, datumInvoer || todayISO(), JSON.stringify(data), searchText, userId, userId);
      orderId = Number(res.lastInsertRowid);
    }
    refreshCustomer(customer.id);
    if (oldCustomerId && oldCustomerId !== customer.id) refreshCustomer(oldCustomerId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return orderId;
}

/**
 * Klantgegevens met de hand wijzigen. Een ander kenteken gaat ook door naar de werkopdrachten van deze klant
 * (en naar het bandenhotel); bestaat er al een klant met dat kenteken, dan gebeurt er niets (fout).
 */
function updateCustomer(customerId, fields, formatPlate = (k) => k.toUpperCase()) {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!c) throw new Error('Deze klant bestaat niet.');
  const kenteken = formatPlate(String(fields.kenteken || '').trim());
  const key = plateKey(kenteken);
  if (!key) throw new Error('Vul een kenteken in.');
  const clash = key !== c.plate_key && db.prepare('SELECT id FROM customers WHERE plate_key = ?').get(key);
  if (clash) throw Object.assign(new Error(`Er bestaat al een klant met kenteken ${kenteken}.`), { clashId: clash.id });
  const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const vals = {};
  for (const f of CUSTOMER_FIELDS) vals[f] = f === 'kenteken' ? kenteken : clean(fields[f]);
  db.exec('BEGIN');
  try {
    const sets = CUSTOMER_FIELDS.map((f) => `${f} = ?`).join(', ');
    db.prepare(`UPDATE customers SET ${sets}, plate_key = ?, bewerkt_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(...CUSTOMER_FIELDS.map((f) => vals[f]), key, customerId);
    if (key !== c.plate_key) {
      // Ander kenteken: RDW-gegevens horen bij het oude kenteken.
      try { db.prepare('UPDATE customers SET rdw_json = NULL, rdw_at = NULL, apk_vervaldatum = NULL WHERE id = ?').run(customerId); } catch { /* kolommen ontbreken */ }
      for (const o of db.prepare('SELECT id, nummer, data FROM orders WHERE customer_id = ?').all(customerId)) {
        const d = parseOrderData(o.data);
        d.kenteken = kenteken;
        db.prepare('UPDATE orders SET data = ?, search_text = ? WHERE id = ?').run(JSON.stringify(d), [o.nummer, ...flattenText(d)].join(' \n '), o.id);
      }
      try {
        db.prepare("UPDATE tyre_storage SET plate_key = ?, kenteken = ?, updated_at = datetime('now') WHERE plate_key = ?").run(key, kenteken, c.plate_key);
      } catch { /* geen bandenhotel */ }
    }
    db.exec('COMMIT');
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  }
  return { plateChanged: key !== c.plate_key, oldKenteken: c.kenteken, kenteken };
}

function deleteOrder(id) {
  const row = db.prepare('SELECT customer_id FROM orders WHERE id = ?').get(id);
  if (!row) return null;
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM orders WHERE id = ?').run(id);
    // Plaknotities op deze werkopdracht niet onzichtbaar laten worden: ze komen op het scherm van de maker.
    try { db.prepare('UPDATE sticky_notes SET order_id = NULL WHERE order_id = ?').run(id); } catch { /* geen notities-tabel */ }
    refreshCustomer(row.customer_id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return row.customer_id;
}

/* ---------- Live samen bewerken ----------
 * Het formulier gebruikt namen als d[achter][uren][2][van]: precies het pad in de opgeslagen gegevens.
 * formFields() zet de gegevens om naar die namen (met de waarde zoals in het formulier: vinkjes "on" of leeg),
 * applyPatch() zet gewijzigde velden terug in de gegevens. Zo kunnen schermen per veld bijwerken. */
function formFields(data, { nummer, datumInvoer } = {}) {
  const out = {};
  const walk = (v, name) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${name}[${i}]`));
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], `${name}[${k}]`);
    else out[name] = typeof v === 'boolean' ? (v ? 'on' : '') : String(v ?? '');
  };
  walk(withWorkRows(data), 'd');
  if (nummer !== undefined) out.nummer = fmtNr(nummer);
  if (datumInvoer !== undefined) out.datum_invoer = String(datumInvoer ?? '');
  return out;
}
const pathOf = (name) => {
  if (!/^d(\[[A-Za-z0-9_]{1,40}\]){1,7}$/.test(name)) return null;
  return name.slice(2, -1).split('][');
};
/** Gewijzigde formuliervelden ({ naam: waarde }) in de gegevens zetten. pages: de extra bladen komen in hun geheel mee. */
function applyPatch(data, patch, { pages = false } = {}) {
  const raw = withWorkRows(data); // bij voorkant 2: werkzaamheden als regels, zodat één regel kan worden bijgewerkt
  if (pages) raw.paginas = {};
  for (const [name, value] of Object.entries(patch)) {
    const path = pathOf(name);
    if (!path || path.some((k) => k === '__proto__' || k === 'constructor' || k === 'prototype')) continue;
    if (path[0] === 'paginas' && !pages) {
      // Alleen een veld van een bestaand blad (de bladen zelf toevoegen/verwijderen gaat met pages).
      const pg = raw.paginas[Number(path[1])];
      if (!pg || path.length < 3 || path[2] === 'soort') continue;
    }
    let obj = raw;
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i];
      if (obj[k] === null || typeof obj[k] !== 'object') obj[k] = {};
      obj = obj[k];
    }
    obj[path[path.length - 1]] = typeof value === 'string' ? value : String(value ?? '');
  }
  return normalizeOrderData(raw);
}
/** Welke velden zijn anders? (en: is de indeling van de extra bladen veranderd?) */
function diffFields(before, after) {
  const changed = {};
  for (const [k, v] of Object.entries(after)) if (before[k] !== v && !k.startsWith('d[paginas]')) changed[k] = v;
  const pagesOf = (f) => Object.keys(f).filter((k) => /^d\[paginas\]\[\d+\]\[soort\]$/.test(k)).map((k) => f[k]).join(',');
  const structure = pagesOf(before) !== pagesOf(after);
  if (!structure) for (const [k, v] of Object.entries(after)) if (k.startsWith('d[paginas]') && before[k] !== v) changed[k] = v;
  return { changed, structure };
}

module.exports = {
  workRows, WORK_COLS, fmtNr,
  formFields, applyPatch, diffFields,
  PART_ROWS, WORK_LINES, FLUIDS, TIRES, CUSTOMER_FIELDS, PAGE_TYPES, MAX_PAGES, emptyPage, UREN_ROWS, ADVIES_ROWS, migrateBack,
  emptyOrderData, normalizeOrderData, parseOrderData,
  nextOrderNumber, saveOrder, deleteOrder, todayISO, parseDate, updateCustomer, refreshCustomer,
  STATUSES, canEdit, allowedTransitions, setStatus, logAction, history, statusCounts,
};
