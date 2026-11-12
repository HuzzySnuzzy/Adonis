'use strict';
/**
 * Privacy (AVG): klantgegevens niet langer bewaren dan nodig.
 * De administratie (werkopdrachten, facturen) moet 7 jaar bewaard blijven (fiscale bewaarplicht), te rekenen vanaf
 * het einde van het jaar. Daarna mogen naam, adres en telefoon weg. Deze module vindt klanten zonder enige activiteit
 * sinds 1 januari van (dit jaar - 7) en kan ze anonimiseren (persoonsgegevens weg, werkgeschiedenis van de auto blijft)
 * of helemaal verwijderen. Klanten met banden die nog in het bandenhotel liggen, worden overgeslagen.
 */
const { db } = require('./db');
const settings = require('./settings');
const orders = require('./orders');

const YEARS = 7;
// Persoonsgegevens (kenteken, merk/type en chassisnummer horen bij de auto en blijven bij anonimiseren).
const PERSONAL = ['naam', 'adres', 'plaats', 'klantnr', 'tel_prive', 'tel_zaak', 'alarmcode'];

const hasTable = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);

/** Peildatum: alles vóór 1 januari van (dit jaar - 7) valt buiten de bewaarplicht. */
function cutoff(now = new Date()) {
  return `${now.getFullYear() - YEARS}-01-01`;
}

/** Klanten die in aanmerking komen, oudste eerst: [{ id, kenteken, naam, plaats, merk_type, last, orders, tyres }]. */
function candidates(now = new Date()) {
  const limit = cutoff(now);
  const ord = new Map(db.prepare(`SELECT customer_id AS id, MAX(datum_invoer) AS d, MAX(updated_at) AS u, COUNT(*) AS n
    FROM orders GROUP BY customer_id`).all().map((r) => [r.id, r]));
  const ty = hasTable('tyre_storage') ? new Map(db.prepare(`SELECT plate_key AS k, MAX(updated_at) AS u, MAX(datum_in) AS di, MAX(datum_uit) AS du, COUNT(*) AS n,
    SUM(CASE WHEN soort = 'klant' AND status = 'opgeslagen' THEN 1 ELSE 0 END) AS stored
    FROM tyre_storage WHERE plate_key <> '' GROUP BY plate_key`).all().map((r) => [r.k, r])) : new Map();
  const out = [];
  for (const c of db.prepare('SELECT id, plate_key, kenteken, naam, plaats, merk_type, created_at, bewerkt_at, anon_at FROM customers').all()) {
    const o = ord.get(c.id); const t = ty.get(c.plate_key);
    if (t && t.stored) continue; // banden liggen er nog
    // Het anonimiseren zelf (bewerkt_at = anon_at) telt niet als activiteit.
    const dates = [c.created_at, c.bewerkt_at !== c.anon_at && c.bewerkt_at, o && o.d, o && o.u, t && t.u, t && t.di, t && t.du]
      .filter(Boolean).map((s) => String(s).slice(0, 10)).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
    const last = dates.sort().pop() || '';
    if (!last || last >= limit) continue;
    if (c.anon_at && c.anon_at.slice(0, 10) >= last) continue; // al geanonimiseerd, sindsdien niets nieuws
    out.push({ id: c.id, kenteken: c.kenteken, naam: c.naam, plaats: c.plaats, merk_type: c.merk_type, last, orders: o ? o.n : 0, tyres: t ? t.n : 0 });
  }
  return out.sort((a, b) => a.last.localeCompare(b.last));
}

function log(entry) {
  const list = settings.get('privacy_log', []) || [];
  list.unshift({ at: new Date().toISOString().replace('T', ' ').slice(0, 19), ...entry });
  settings.set('privacy_log', list.slice(0, 50));
}
function history() { return settings.get('privacy_log', []) || []; }

/** Opnieuw controleren of een klant (nog) in aanmerking komt; anders niets doen. */
function eligibleIds(ids) {
  const ok = new Set(candidates().map((c) => c.id));
  return [...new Set(ids.map(Number))].filter((id) => ok.has(id));
}

function anonymize(ids, user) {
  const list = eligibleIds(ids);
  const blankOrder = db.prepare('UPDATE orders SET data = ?, search_text = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const id of list) {
      const c = db.prepare('SELECT plate_key FROM customers WHERE id = ?').get(id);
      db.prepare(`UPDATE customers SET ${PERSONAL.map((f) => `${f} = ''`).join(', ')}, status = 'weg', status_at = datetime('now'),
        status_by = ?, bewerkt_at = datetime('now'), anon_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(user ? user.name : '', id);
      for (const o of db.prepare('SELECT id, nummer, data FROM orders WHERE customer_id = ?').all(id)) {
        let d = {};
        try { d = JSON.parse(o.data) || {}; } catch { /* leeg */ }
        for (const f of PERSONAL) if (f in d) d[f] = '';
        blankOrder.run(JSON.stringify(d), [o.nummer, orders.fmtNr(o.nummer), ...orders.flattenText(d)].join(' \n '), o.id);
        if (hasTable('sticky_notes')) db.prepare('DELETE FROM sticky_notes WHERE order_id = ?').run(o.id);
      }
      if (hasTable('tyre_storage')) {
        const inv = require('./inventory');
        for (const t of db.prepare('SELECT * FROM tyre_storage WHERE plate_key = ?').all(c.plate_key)) {
          const next = { ...t, klant_naam: '', telefoon: '', extra: '{}' };
          db.prepare('UPDATE tyre_storage SET klant_naam = \'\', telefoon = \'\', extra = \'{}\', search_text = ? WHERE id = ?').run(inv.tyreSearchText(next), t.id);
        }
      }
      if (hasTable('customer_bulletins')) db.prepare('DELETE FROM customer_bulletins WHERE customer_id = ?').run(id);
    }
    db.exec('COMMIT');
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  }
  if (list.length) log({ action: 'anoniem', n: list.length, by: user ? user.name : '' });
  return list.length;
}

function remove(ids, user) {
  const list = eligibleIds(ids);
  const photos = require('./photos');
  const files = []; // foto's pas na de database-wijziging weghalen
  db.exec('BEGIN');
  try {
    for (const id of list) {
      const c = db.prepare('SELECT plate_key FROM customers WHERE id = ?').get(id);
      for (const o of db.prepare('SELECT id FROM orders WHERE customer_id = ?').all(id)) {
        files.push(['order', o.id]);
        if (hasTable('sticky_notes')) db.prepare('DELETE FROM sticky_notes WHERE order_id = ?').run(o.id);
        db.prepare('DELETE FROM orders WHERE id = ?').run(o.id);
      }
      if (hasTable('tyre_storage')) {
        for (const t of db.prepare('SELECT id FROM tyre_storage WHERE plate_key = ?').all(c.plate_key)) {
          files.push(['tyre', t.id]);
          db.prepare('DELETE FROM tyre_storage WHERE id = ?').run(t.id);
        }
      }
      if (hasTable('customer_bulletins')) db.prepare('DELETE FROM customer_bulletins WHERE customer_id = ?').run(id);
      if (hasTable('customer_analysis')) db.prepare('DELETE FROM customer_analysis WHERE customer_id = ?').run(id);
      if (hasTable('vehicle_analyses')) db.prepare('DELETE FROM vehicle_analyses WHERE key = ?').run(c.plate_key);
      db.prepare('DELETE FROM customers WHERE id = ?').run(id);
    }
    db.exec('COMMIT');
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  }
  for (const [type, id] of files) { try { photos.removeFor(type, id); } catch (err) { console.log('  Foto verwijderen mislukt: ' + err.message); } }
  if (list.length) log({ action: 'verwijderd', n: list.length, by: user ? user.name : '' });
  return list.length;
}

module.exports = { YEARS, PERSONAL, cutoff, candidates, anonymize, remove, history };
