'use strict';
/**
 * Prullenbak: verwijderde werkopdrachten, bandensets en voorraaditems worden hier eerst bewaard (30 dagen),
 * zodat "per ongeluk verwijderd" terug te zetten is. Foto's blijven staan tot de prullenbak echt wordt geleegd.
 */
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS trash (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,              -- 'order', 'tyre' of 'stock'
  ref_id      INTEGER NOT NULL,           -- oorspronkelijke id
  label       TEXT NOT NULL DEFAULT '',
  data        TEXT NOT NULL,              -- de oorspronkelijke rij (+ klant en logboek bij een werkopdracht), JSON
  deleted_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_name TEXT NOT NULL DEFAULT '',
  deleted_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS trash_kind ON trash(kind, ref_id);
`);

const KEEP_DAYS = 30;
const TABLE = { order: 'orders', tyre: 'tyre_storage', stock: 'stock_items' };
const KIND_LABEL = { order: 'Werkopdracht', tyre: 'Bandenset', stock: 'Voorraad' };

/** Bewaar een rij in de prullenbak (vóór het echte DELETE aanroepen). */
function put(kind, row, { label = '', user = null, extra = {} } = {}) {
  db.prepare('INSERT INTO trash (kind, ref_id, label, data, deleted_by, deleted_name) VALUES (?, ?, ?, ?, ?, ?)')
    .run(kind, row.id, String(label).slice(0, 200), JSON.stringify({ row, ...extra }), user ? user.id : null, user ? user.name : '');
}

function list() {
  return db.prepare('SELECT id, kind, ref_id, label, deleted_name, deleted_at FROM trash ORDER BY deleted_at DESC, id DESC').all()
    .map((t) => ({ ...t, kindLabel: KIND_LABEL[t.kind] || t.kind }));
}
function count() { return db.prepare('SELECT COUNT(*) AS n FROM trash').get().n; }
function get(id) { return db.prepare('SELECT * FROM trash WHERE id = ?').get(id); }

/** Een rij met dezelfde kolommen terugzetten (zelfde id als die nog vrij is). */
function insertRow(table, row, keepId) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name).filter((c) => c in row && (keepId || c !== 'id'));
  const r = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => row[c]));
  return keepId ? row.id : Number(r.lastInsertRowid);
}
const idFree = (table, id) => !db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id);

/** Terugzetten. Geeft { kind, id, note } terug (note: bijv. een ander werkopdrachtnummer). */
function restore(trashId) {
  const t = get(trashId);
  if (!t) return null;
  const { row, customer, log } = JSON.parse(t.data);
  let note = '';
  let newId;
  db.exec('BEGIN');
  try {
    if (t.kind === 'order') {
      const orders = require('./orders');
      // Klant: nog aanwezig (op kenteken)? Anders de bewaarde klant terugzetten.
      let cust = customer && customer.plate_key ? db.prepare('SELECT id FROM customers WHERE plate_key = ?').get(customer.plate_key) : null;
      if (!cust && customer) cust = { id: insertRow('customers', customer, idFree('customers', customer.id)) };
      if (!cust) throw new Error('De klant van deze werkopdracht bestaat niet meer.');
      const r = { ...row, customer_id: cust.id };
      if (db.prepare('SELECT 1 FROM orders WHERE nummer = ?').get(r.nummer)) {
        const nr = orders.nextOrderNumber();
        note = `Nummer ${require('./orders').fmtNr(r.nummer)} was intussen in gebruik; de werkopdracht heeft nu nummer ${require('./orders').fmtNr(nr)}.`;
        r.nummer = nr;
      }
      newId = insertRow('orders', r, idFree('orders', r.id));
      for (const l of log || []) insertRow('order_log', { ...l, order_id: newId }, false);
      if (newId !== row.id) db.prepare("UPDATE photos SET owner_id = ? WHERE owner_type = 'order' AND owner_id = ?").run(newId, row.id);
      orders.refreshCustomer(cust.id);
    } else {
      const table = TABLE[t.kind];
      newId = insertRow(table, row, idFree(table, row.id));
      if (newId !== row.id) db.prepare('UPDATE photos SET owner_id = ? WHERE owner_type = ? AND owner_id = ?').run(newId, t.kind, row.id);
      if (t.kind === 'tyre') { try { require('./inventory').ensureCustomer(row); } catch { /* geen klant nodig */ } }
    }
    db.prepare('DELETE FROM trash WHERE id = ?').run(t.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { kind: t.kind, id: newId, note };
}

/** Definitief weg (met de foto's). */
function purge(trashId) {
  const t = get(trashId);
  if (!t) return false;
  const photos = require('./photos');
  // Alleen foto's weggooien als er niet intussen een nieuw record met dit id is.
  if (idFree(TABLE[t.kind], t.ref_id)) photos.removeFor(t.kind, t.ref_id);
  db.prepare('DELETE FROM trash WHERE id = ?').run(t.id);
  return true;
}
function purgeAll() { const ids = db.prepare('SELECT id FROM trash').all().map((r) => r.id); ids.forEach(purge); return ids.length; }
function purgeOld() {
  const ids = db.prepare(`SELECT id FROM trash WHERE deleted_at < datetime('now', '-${KEEP_DAYS} days')`).all().map((r) => r.id);
  ids.forEach(purge);
  return ids.length;
}

module.exports = { put, list, count, get, restore, purge, purgeAll, purgeOld, KEEP_DAYS, KIND_LABEL };
