'use strict';
/** Verkenner: alle foto's in mappen (werkopdrachten, bandenhotel, voorraad), met waar ze vandaan komen. */
const { db } = require('./db');
const { parseOrderData } = require('./orders');

const FOLDERS = {
  order: { name: 'Werkopdrachten', feature: 'werkopdrachten', href: (id) => `/werkopdracht/${id}` },
  tyre: { name: 'Bandenhotel', feature: 'bandenhotel', href: (id) => `/bandenhotel/${id}` },
  stock: { name: 'Voorraad', feature: 'voorraad', href: (id) => `/voorraad/${id}` },
};

/** Per soort: welke records hebben foto's, met een naam en een voorbeeldfoto. */
function owners(type) {
  const rows = db.prepare(`SELECT owner_id, COUNT(*) AS n, MAX(created_at) AS last, MAX(id) AS cover FROM photos WHERE owner_type = ? GROUP BY owner_id`).all(type);
  const out = [];
  for (const r of rows) {
    let label = null; let sub = '';
    if (type === 'order') {
      const o = db.prepare('SELECT o.nummer, o.data, o.datum_invoer, c.kenteken, c.naam FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?').get(r.owner_id);
      if (o) { label = `Werkopdracht ${o.nummer}`; sub = [o.kenteken, o.naam || parseOrderData(o.data).naam].filter(Boolean).join(' · '); }
    } else if (type === 'tyre') {
      const t = db.prepare('SELECT kenteken, klant_naam, label, seizoen, maat FROM tyre_storage WHERE id = ?').get(r.owner_id);
      if (t) { label = t.kenteken || t.label || `Bandenset ${r.owner_id}`; sub = [t.klant_naam, t.seizoen, t.maat].filter(Boolean).join(' · '); }
    } else if (type === 'stock') {
      const s = db.prepare('SELECT type, merk, nummer, omschrijving FROM stock_items WHERE id = ?').get(r.owner_id);
      if (s) { label = [s.type, s.merk].filter(Boolean).join(' ') || s.omschrijving || `Item ${r.owner_id}`; sub = [s.nummer, s.omschrijving].filter(Boolean).join(' · '); }
    }
    if (label) out.push({ id: r.owner_id, label, sub, n: r.n, last: r.last, cover: r.cover, href: FOLDERS[type].href(r.owner_id) });
  }
  return out.sort((a, b) => (a.last < b.last ? 1 : -1));
}

function photosOf(type, id) {
  return db.prepare('SELECT p.*, u.name AS by_name FROM photos p LEFT JOIN users u ON u.id = p.created_by WHERE owner_type = ? AND owner_id = ? ORDER BY p.id').all(type, id);
}

/** Recentste foto's van alle soorten (alleen van records die nog bestaan). */
function recent(types, limit = 120) {
  const labels = {};
  for (const t of types) for (const o of owners(t)) labels[`${t}:${o.id}`] = o;
  const rows = db.prepare(`SELECT p.*, u.name AS by_name FROM photos p LEFT JOIN users u ON u.id = p.created_by
    WHERE owner_type IN (${types.map(() => '?').join(',') || "''"}) ORDER BY p.id DESC LIMIT 2000`).all(...types);
  return rows.filter((p) => labels[`${p.owner_type}:${p.owner_id}`]).slice(0, limit).map((p) => ({ ...p, from: labels[`${p.owner_type}:${p.owner_id}`], fromType: p.owner_type }));
}

module.exports = { FOLDERS, owners, photosOf, recent };
