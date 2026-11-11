'use strict';
/**
 * Sjablonen: voorgedrukte/voorgevulde werkopdrachten (bijv. "Bandenwissel"). Alleen de inhoud van het werk wordt
 * bewaard (onderdelen, vloeistoffen, diversen, werkzaamheden, tarief, aantekeningen op de achterkant, extra bladen) –
 * nooit klant, auto, datums of km-standen. Toepassen vult lege regels aan en verandert niets aan wat er al staat.
 */
const { db } = require('./db');
const orders = require('./orders');

db.exec(`
CREATE TABLE IF NOT EXISTS order_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  naam        TEXT NOT NULL,
  data        TEXT NOT NULL,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/** Alleen de werk-inhoud van een werkopdracht. */
function contentOf(data) {
  const d = orders.normalizeOrderData(data);
  const t = orders.emptyOrderData();
  for (const k of ['onderdelen', 'vloeistoffen', 'diversen', 'werk_check', 'werk_omschrijving', 'werk_code', 'werk_tijd', 'servicebeurt_km', 'tarief']) t[k] = d[k];
  t.achter.advies = d.achter.advies;
  t.paginas = d.paginas;
  return t;
}
function summary(t) {
  const parts = t.onderdelen.filter((p) => p.nr || p.omschrijving).length;
  const lines = String(t.werk_omschrijving || '').split('\n').filter((l) => l.trim()).length;
  return [parts && `${parts} onderdeel${parts === 1 ? '' : 'en'}`, lines && `${lines} regel${lines === 1 ? '' : 's'} werkzaamheden`].filter(Boolean).join(' · ') || 'leeg';
}
function list() {
  return db.prepare('SELECT t.*, u.name AS by_name FROM order_templates t LEFT JOIN users u ON u.id = t.created_by ORDER BY naam COLLATE NOCASE').all()
    .map((r) => { const data = orders.parseOrderData(r.data); return { id: r.id, naam: r.naam, by: r.by_name, updated_at: r.updated_at, summary: summary(data) }; });
}
function get(id) {
  const r = db.prepare('SELECT * FROM order_templates WHERE id = ?').get(id);
  return r ? { id: r.id, naam: r.naam, data: orders.parseOrderData(r.data) } : null;
}
const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 80);
function create(naam, data, userId) {
  const r = db.prepare('INSERT INTO order_templates (naam, data, created_by) VALUES (?, ?, ?)').run(cleanName(naam) || 'Sjabloon', JSON.stringify(contentOf(data)), userId || null);
  return Number(r.lastInsertRowid);
}
function update(id, data) {
  db.prepare("UPDATE order_templates SET data = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(contentOf(data)), id);
}
function rename(id, naam) { if (cleanName(naam)) db.prepare("UPDATE order_templates SET naam = ?, updated_at = datetime('now') WHERE id = ?").run(cleanName(naam), id); }
function remove(id) { db.prepare('DELETE FROM order_templates WHERE id = ?').run(id); }

/** Sjabloon over een (nieuwe) werkopdracht leggen: lege onderdeelregels opvullen, werkzaamheden erachter, lege vakken invullen. */
function applyTo(data, tpl) {
  const t = tpl.data;
  for (const p of t.onderdelen.filter((x) => x.nr || x.omschrijving || x.aantal || x.prijs)) {
    const i = data.onderdelen.findIndex((x) => !x.nr && !x.omschrijving && !x.aantal && !x.prijs);
    if (i < 0) break;
    data.onderdelen[i] = { ...p };
  }
  const cols = ['werk_check', 'werk_omschrijving', 'werk_code', 'werk_tijd'];
  const lines = (s) => String(s || '').replace(/\n+$/, '').split('\n');
  const used = Math.max(...cols.map((c) => (String(data[c] || '').trim() ? lines(data[c]).length : 0)));
  for (const c of cols) {
    if (!String(t[c] || '').trim()) continue;
    const mine = String(data[c] || '').trim() ? lines(data[c]) : [];
    while (mine.length < used) mine.push('');
    data[c] = [...mine, ...lines(t[c])].join('\n');
  }
  for (const [k, v] of Object.entries(t.vloeistoffen)) for (const [f, x] of Object.entries(v)) if (x && !data.vloeistoffen[k][f]) data.vloeistoffen[k][f] = x;
  for (const [k, x] of Object.entries(t.diversen)) if (x && !data.diversen[k]) data.diversen[k] = x;
  for (const k of ['servicebeurt_km', 'tarief']) if (t[k] && !data[k]) data[k] = t[k];
  for (const r of t.achter.advies.filter((x) => x.tekst)) {
    const i = data.achter.advies.findIndex((x) => !x.tekst && !x.kosten);
    if (i < 0) break;
    data.achter.advies[i] = { ...r };
  }
  if (t.paginas.length && data.paginas.length + t.paginas.length <= orders.MAX_PAGES) data.paginas = [...data.paginas, ...t.paginas];
  return data;
}

// Eenmalig een voorbeeld: de bandenwissel zoals op papier.
try {
  const settings = require('./settings');
  if (!settings.get('seed-tpl-bandenwissel') && !db.prepare('SELECT 1 FROM order_templates LIMIT 1').get()) {
    const d = orders.emptyOrderData();
    d.onderdelen[0] = { nr: 'WinG', omschrijving: 'Winterbanden gemonteerd', aantal: '4x', prijs: '' };
    d.onderdelen[1] = { nr: 'ZomO', omschrijving: 'Zomerbanden opgeslagen', aantal: '4x', prijs: '' };
    d.onderdelen[2] = { nr: 'Omw', omschrijving: 'Omwisseltarief', aantal: '1x', prijs: '' };
    d.werk_omschrijving = '- WinG - Winterbanden gebalanceerd\n  en gemonteerd.\n- ZomO - Zomerbanden opgeslagen\n\n- Opmerking: het profiel van de zomerbanden\n  is voor … mm en achter … mm.';
    create('Bandenwissel (naar winterbanden)', d, null);
    settings.set('seed-tpl-bandenwissel', true);
  }
} catch (err) { console.error('Voorbeeldsjabloon:', err.message); }

module.exports = { list, get, create, update, rename, remove, applyTo, contentOf };
