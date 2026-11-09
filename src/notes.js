'use strict';
/**
 * Plaknotities (zoals gele memoblaadjes): per gebruiker, of zichtbaar voor iedereen op deze ADONIS.
 * De plek op het scherm onthoudt elke browser zelf (schermen verschillen in grootte).
 */
const { db } = require('./db');
const events = require('./events');

db.exec(`
CREATE TABLE IF NOT EXISTS sticky_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  text       TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT 'geel',
  shared     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER
);`);
// Een notitie hangt op het scherm (overal zichtbaar) of op één werkopdracht.
if (!db.prepare('PRAGMA table_info(sticky_notes)').all().some((c) => c.name === 'order_id')) db.exec('ALTER TABLE sticky_notes ADD COLUMN order_id INTEGER');
db.exec('CREATE INDEX IF NOT EXISTS sticky_notes_order ON sticky_notes(order_id)');

const COLORS = ['geel', 'roze', 'blauw', 'groen', 'oranje', 'paars'];
const MAX_TEXT = 4000;

// Op het scherm: notities zonder werkopdracht; op een werkopdracht komen die van die werkopdracht erbij.
function visibleTo(user, orderId = null) {
  return db.prepare(`SELECT n.id, n.user_id, n.text, n.color, n.shared, n.order_id, n.created_at, n.updated_at, u.name AS owner, e.name AS editor, o.nummer AS order_nummer
    FROM sticky_notes n LEFT JOIN users u ON u.id = n.user_id LEFT JOIN users e ON e.id = n.updated_by LEFT JOIN orders o ON o.id = n.order_id
    WHERE (n.user_id = ? OR n.shared = 1) AND (n.order_id IS NULL OR n.order_id = ?) ORDER BY n.id`).all(user.id, orderId == null ? -1 : orderId)
    .map((n) => ({ ...n, shared: !!n.shared, mine: n.user_id === user.id, canDelete: n.user_id === user.id || !!user.is_admin }));
}
const canSee = (n, user) => n && (n.user_id === user.id || n.shared);
const orderOf = (v) => { const id = parseInt(v, 10); return id > 0 && db.prepare('SELECT id FROM orders WHERE id = ?').get(id) ? id : null; };
// Voor de lijsten: hoeveel notities (die deze gebruiker mag zien) er op een werkopdracht zitten.
const countStmt = () => db.prepare('SELECT COUNT(*) AS n FROM sticky_notes WHERE order_id = ? AND (user_id = ? OR shared = 1)');
let countQ = null;
function countOnOrder(user, orderId) {
  if (!user) return 0;
  countQ = countQ || countStmt();
  return countQ.get(orderId, user.id).n;
}
// Voor een hele lijst in één keer: Map werkopdracht-id -> aantal notities (i.p.v. één query per rij).
let countAllQ = null;
function countOnOrders(user) {
  if (!user) return new Map();
  countAllQ = countAllQ || db.prepare('SELECT order_id, COUNT(*) AS n FROM sticky_notes WHERE order_id IS NOT NULL AND (user_id = ? OR shared = 1) GROUP BY order_id');
  return new Map(countAllQ.all(user.id).map((r) => [r.order_id, r.n]));
}

module.exports = function register(app) {
  app.locals.notesOnOrder = countOnOrder;
  app.locals.notesOnOrders = countOnOrders;
  const notify = (req, note) => events.broadcast({ type: 'notes', byId: req.user.id, id: note && note.id });
  app.get('/notities', (req, res) => res.json({ notes: visibleTo(req.user, orderOf(req.query.werkopdracht)), colors: COLORS }));
  app.post('/notities', (req, res) => {
    const color = COLORS.includes(req.body.color) ? req.body.color : 'geel';
    const shared = req.body.shared === '1' ? 1 : 0;
    const text = typeof req.body.text === 'string' ? req.body.text.slice(0, MAX_TEXT) : '';
    const count = db.prepare('SELECT COUNT(*) AS n FROM sticky_notes WHERE user_id = ?').get(req.user.id).n;
    if (count >= 100) return res.status(400).json({ error: 'U heeft al 100 notities. Gooi er eerst een paar weg.' });
    const orderId = orderOf(req.body.werkopdracht);
    const r = db.prepare('INSERT INTO sticky_notes (user_id, text, color, shared, order_id, updated_by) VALUES (?, ?, ?, ?, ?, ?)').run(req.user.id, text, color, shared, orderId, req.user.id);
    const note = visibleTo(req.user, orderId).find((n) => n.id === Number(r.lastInsertRowid));
    if (shared) events.broadcast({ type: 'notes', byId: req.user.id, id: note.id, cat: 'notities',
      msg: `Nieuwe plaknotitie van ${req.user.name}${note.order_nummer ? ' op werkopdracht ' + note.order_nummer : ''}${text.trim() ? ': “' + text.trim().slice(0, 60) + (text.trim().length > 60 ? '…' : '') + '”' : ''}`,
      href: note.order_id ? `/werkopdracht/${note.order_id}` : null });
    res.json({ note });
  });
  app.post('/notities/:id', (req, res) => {
    const n = db.prepare('SELECT * FROM sticky_notes WHERE id = ?').get(req.params.id);
    if (!canSee(n, req.user)) return res.status(404).json({ error: 'Deze notitie bestaat niet (meer).' });
    const sets = []; const vals = [];
    if (typeof req.body.text === 'string') { sets.push('text = ?'); vals.push(req.body.text.slice(0, MAX_TEXT)); }
    if (req.body.color !== undefined && COLORS.includes(req.body.color)) { sets.push('color = ?'); vals.push(req.body.color); }
    // Alleen de maker bepaalt wie de notitie ziet.
    if (req.body.shared !== undefined && n.user_id === req.user.id) { sets.push('shared = ?'); vals.push(req.body.shared === '1' ? 1 : 0); }
    // Verplaatsen: van het scherm naar een werkopdracht of terug ("werkopdracht" leeg = op het scherm).
    if (req.body.werkopdracht !== undefined) { sets.push('order_id = ?'); vals.push(orderOf(req.body.werkopdracht)); }
    if (sets.length) {
      db.prepare(`UPDATE sticky_notes SET ${sets.join(', ')}, updated_at = datetime('now'), updated_by = ? WHERE id = ?`).run(...vals, req.user.id, n.id);
      if (n.shared || req.body.shared === '1') notify(req, n);
    }
    const after = db.prepare('SELECT order_id FROM sticky_notes WHERE id = ?').get(n.id);
    res.json({ note: visibleTo(req.user, after.order_id).find((x) => x.id === n.id) || null });
  });
  app.post('/notities/:id/weg', (req, res) => {
    const n = db.prepare('SELECT * FROM sticky_notes WHERE id = ?').get(req.params.id);
    if (!canSee(n, req.user)) return res.json({ ok: true });
    if (n.user_id !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: 'Alleen de maker of een beheerder kan deze notitie weggooien.' });
    db.prepare('DELETE FROM sticky_notes WHERE id = ?').run(n.id);
    if (n.shared) notify(req, n);
    res.json({ ok: true });
  });
};
