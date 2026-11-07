'use strict';

const { db, plateKey } = require('./db');

const PART_ROWS = 22;
const WORK_LINES = 19;

/** Header fields that belong to the customer/vehicle (copied onto new orders). */
const CUSTOMER_FIELDS = [
  'kenteken', 'naam', 'adres', 'plaats', 'klantnr', 'tel_prive', 'tel_zaak',
  'merk_type', 'chassisnummer', 'alarmcode',
];

const FLUIDS = [
  { key: 'motorolie', label: 'Motorolie', kind: 'visc' },
  { key: 'cardanolie', label: 'Cardanolie/versn.bakolie' },
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
      banden: tires,
      apk: '',
      aandachtspunten: '',
      notities: '',
    },
  };
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

function normalizeOrderData(input) {
  const data = shape(emptyOrderData(), input);
  data.kenteken = data.kenteken.toUpperCase().trim();
  if (!['ja', 'nee'].includes(data.alle_reparaties)) data.alle_reparaties = '';
  for (const f of ['datum_gereed', 'datum_deel1', 'apk_datum']) data[f] = parseDate(data[f]);
  return data;
}

/** Load stored JSON and fill in fields that may have been added later. */
function parseOrderData(json) {
  let raw = {};
  try { raw = JSON.parse(json); } catch { /* keep empty */ }
  return shape(emptyOrderData(), raw);
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

/** Customer details = most recent non-empty value of each field across their orders. */
function refreshCustomer(customerId) {
  const orders = db.prepare('SELECT data FROM orders WHERE customer_id = ? ORDER BY nummer DESC').all(customerId);
  if (orders.length === 0) {
    db.prepare('DELETE FROM customers WHERE id = ?').run(customerId);
    return;
  }
  const values = {};
  for (const o of orders) {
    const d = parseOrderData(o.data);
    for (const f of CUSTOMER_FIELDS) {
      if (values[f] === undefined && d[f] && d[f].trim()) values[f] = d[f].trim();
    }
  }
  const sets = CUSTOMER_FIELDS.map((f) => `${f} = ?`).join(', ');
  db.prepare(`UPDATE customers SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(
    ...CUSTOMER_FIELDS.map((f) => values[f] || ''),
    customerId
  );
}

function saveOrder({ id, nummer, data, userId, datumInvoer }) {
  const customer = getOrCreateCustomer(data.kenteken);
  const searchText = [nummer, ...flattenText(data)].join(' \n ');
  let orderId = id;
  let oldCustomerId = null;
  db.exec('BEGIN');
  try {
    if (id) {
      oldCustomerId = db.prepare('SELECT customer_id FROM orders WHERE id = ?').get(id).customer_id;
      db.prepare(
        `UPDATE orders SET nummer = ?, customer_id = ?, data = ?, search_text = ?, updated_by = ?,
         datum_invoer = COALESCE(?, datum_invoer), updated_at = datetime('now') WHERE id = ?`
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

function deleteOrder(id) {
  const row = db.prepare('SELECT customer_id FROM orders WHERE id = ?').get(id);
  if (!row) return null;
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM orders WHERE id = ?').run(id);
    refreshCustomer(row.customer_id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return row.customer_id;
}

module.exports = {
  PART_ROWS, WORK_LINES, FLUIDS, TIRES, CUSTOMER_FIELDS,
  emptyOrderData, normalizeOrderData, parseOrderData,
  nextOrderNumber, saveOrder, deleteOrder, todayISO, parseDate,
};
