'use strict';
/**
 * Aandachtspunten per klant (auto), gemaakt door Claude uit alle werkopdrachten van die auto.
 * Alleen wat er echt toe doet voor een volgend bezoek: tijdelijke oplossingen, geadviseerd maar niet gedaan,
 * slijtage die bijna op is, wijzigingen in codering, terugkerende storingen. Geen samenvatting van gewoon onderhoud.
 * Een monteur kan een punt afvinken ("afgehandeld"); dat punt komt bij een nieuwe analyse niet terug.
 */
const crypto = require('node:crypto');
const { db } = require('./db');
const ai = require('./ai');
const importer = require('./import');

db.exec(`
  CREATE TABLE IF NOT EXISTS customer_bulletins (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    titel TEXT NOT NULL,
    tekst TEXT NOT NULL DEFAULT '',
    actie TEXT NOT NULL DEFAULT '',
    ernst TEXT NOT NULL DEFAULT 'normaal',     -- hoog | normaal
    order_nummer TEXT NOT NULL DEFAULT '',
    datum TEXT NOT NULL DEFAULT '',
    done_at TEXT,
    done_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS customer_bulletins_customer ON customer_bulletins(customer_id);
  CREATE TABLE IF NOT EXISTS customer_analysis (
    customer_id INTEGER PRIMARY KEY,
    analyzed_at TEXT NOT NULL,
    orders_sig TEXT NOT NULL,
    effort TEXT NOT NULL DEFAULT '',
    eur REAL NOT NULL DEFAULT 0,
    n_orders INTEGER NOT NULL DEFAULT 0,
    by_user INTEGER
  );
`);

class BulletinError extends Error {}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['aandachtspunten'],
  properties: {
    aandachtspunten: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['titel', 'tekst', 'actie', 'ernst', 'werkopdracht', 'datum'],
        properties: {
          titel: { type: 'string', description: 'Kort, max. 60 tekens, bijv. "Gebruikte accu geplaatst"' },
          tekst: { type: 'string', description: 'Wat er aan de hand is, max. 2 korte zinnen' },
          actie: { type: 'string', description: 'Wat de monteur bij een volgend bezoek moet doen of controleren' },
          ernst: { type: 'string', enum: ['hoog', 'normaal'] },
          werkopdracht: { type: 'string', description: 'Nummer van de werkopdracht waar het uit komt' },
          datum: { type: 'string', description: 'Datum van die werkopdracht, JJJJ-MM-DD' },
        },
      },
    },
  },
};

const SYSTEM = `Je bent een ervaren chef-werkplaats in een Nederlandse autogarage. Je krijgt alle werkopdrachten van één auto.
Schrijf de aandachtspunten die een monteur moet weten als deze auto de volgende keer binnenkomt.

Neem ALLEEN iets op als het later echt verschil maakt, bijvoorbeeld:
- tijdelijke, provisorische of goedkope oplossingen (gebruikt onderdeel geplaatst, "voorlopig", "moet nog");
- geadviseerd of afgekeurd maar niet uitgevoerd (klant wilde niet, later doen, onderdeel besteld);
- slijtage die bijna op is (remmen, banden onder ca. 3 mm, lekkages die terugkomen);
- gewijzigde codering of instellingen die later werk beïnvloeden (bijv. een byte in een module aangepast, een functie uitgezet);
- storingen of klachten die terugkomen of niet zijn opgelost;
- alles wat de veiligheid raakt.

Neem NIET op: gewoon onderhoud dat goed is afgerond, olie/filters vervangen zonder bijzonderheden, algemene adviezen,
dingen die volledig zijn opgelost en geen opvolging nodig hebben, en dingen die je niet uit de werkopdrachten kunt halen.
Verzin niets en geef geen algemene kennis over het model tenzij het direct aansluit op iets uit de werkopdrachten.

Hooguit 6 punten, belangrijkste eerst. Liever geen punt dan een onbelangrijk punt: een lege lijst is een goed antwoord.
Schrijf kort en concreet in het Nederlands, voor monteurs. Noem bij elk punt de werkopdracht (nummer) en de datum daarvan.
Een punt dat als "al afgehandeld" is gemeld, neem je niet opnieuw op (tenzij een latere werkopdracht laat zien dat het terugkomt).`;

/* ---------- invoer voor Claude ---------- */
// Persoonsgegevens en prijzen gaan niet naar Claude: die zijn voor aandachtspunten niet nodig.
const SKIP = /^(naam|adres|plaats|tel_prive|tel_zaak|alarmcode|klantnr|chassisnummer|faktuurnr|tarief|bedrag|kenteken|monteur|contact_boven)$|prijs/i;
function compact(v) {
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v || undefined;
  if (Array.isArray(v)) { const a = v.map(compact).filter((x) => x !== undefined); return a.length ? a : undefined; }
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) { if (SKIP.test(k)) continue; const c = compact(x); if (c !== undefined) o[k] = c; }
    return Object.keys(o).length ? o : undefined;
  }
  return undefined;
}
function ordersOf(customerId) {
  return db.prepare('SELECT id, nummer, datum_invoer, status, data, updated_at FROM orders WHERE customer_id = ? ORDER BY datum_invoer, nummer').all(customerId);
}
function signature(rows) {
  return crypto.createHash('sha1').update(rows.map((r) => `${r.id}:${r.updated_at}`).join('|')).digest('hex').slice(0, 16);
}
function buildInput(customer) {
  const rows = ordersOf(customer.id);
  let rdw = null;
  try { rdw = customer.rdw_json ? JSON.parse(customer.rdw_json) : null; } catch { /* geen RDW */ }
  const auto = {
    merk_type: customer.merk_type || (rdw && rdw.merkType) || '',
    eerste_toelating: (rdw && rdw.eersteToelating) || '',
    brandstof: (rdw && rdw.brandstof) || '',
    apk_vervaldatum: customer.apk_vervaldatum || '',
  };
  const done = db.prepare('SELECT titel, order_nummer FROM customer_bulletins WHERE customer_id = ? AND done_at IS NOT NULL ORDER BY done_at DESC LIMIT 30').all(customer.id);
  const orders = rows.map((r) => {
    let d = {};
    try { d = JSON.parse(r.data); } catch { /* leeg */ }
    return { werkopdracht: String(r.nummer), datum: r.datum_invoer, status: r.status, ...(compact(d) || {}) };
  });
  const text = [
    `Auto: ${JSON.stringify(compact(auto) || {})}`,
    done.length ? `Al afgehandeld (niet opnieuw melden): ${done.map((b) => `"${b.titel}" (werkopdracht ${b.order_nummer})`).join('; ')}` : '',
    `Werkopdrachten (${orders.length}, oudste eerst):`,
    ...orders.map((o) => JSON.stringify(o)),
  ].filter(Boolean).join('\n');
  return { text, rows, sig: signature(rows) };
}

/* ---------- lezen ---------- */
function forCustomer(customerId) {
  const all = db.prepare("SELECT * FROM customer_bulletins WHERE customer_id = ? ORDER BY done_at IS NOT NULL, CASE ernst WHEN 'hoog' THEN 0 ELSE 1 END, datum DESC, id").all(customerId);
  const analysis = db.prepare('SELECT a.*, u.name AS by_name FROM customer_analysis a LEFT JOIN users u ON u.id = a.by_user WHERE customer_id = ?').get(customerId) || null;
  let stale = false;
  if (analysis) stale = analysis.orders_sig !== signature(ordersOf(customerId));
  return { open: all.filter((b) => !b.done_at), done: all.filter((b) => b.done_at), analysis, stale };
}
function toggleDone(id, userId) {
  const b = db.prepare('SELECT * FROM customer_bulletins WHERE id = ?').get(id);
  if (!b) return null;
  if (b.done_at) db.prepare('UPDATE customer_bulletins SET done_at = NULL, done_by = NULL WHERE id = ?').run(id);
  else db.prepare("UPDATE customer_bulletins SET done_at = datetime('now'), done_by = ? WHERE id = ?").run(userId, id);
  return b.customer_id;
}

/* ---------- schatting ---------- */
const SYSTEM_TOKENS = ai.tokensForText(SYSTEM) + 250; // + schema
const ANSWER = [120, 1100];
function estimateFor(customers) {
  let input = 0;
  for (const c of customers) input += SYSTEM_TOKENS + ai.tokensForText(buildInput(c).text);
  const calls = customers.length || 1;
  return ai.estimate({ input: Math.round(input / calls), answer: ANSWER, calls: customers.length });
}
/** Klanten met werkopdrachten die nog niet (of niet meer actueel) zijn geanalyseerd. */
function staleCustomers() {
  const rows = db.prepare(
    `SELECT c.*, a.orders_sig FROM customers c LEFT JOIN customer_analysis a ON a.customer_id = c.id
     WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id) ORDER BY c.id`
  ).all();
  return rows.filter((c) => !c.orders_sig || c.orders_sig !== signature(ordersOf(c.id)));
}

/* ---------- Claude ---------- */
function parseJson(text) {
  try { return JSON.parse(text); } catch {
    const a = text.indexOf('{'); const b = text.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
    throw new Error('geen JSON');
  }
}
async function ask(input, effortKey) {
  const effort = ai.LEVELS[ai.level(effortKey)].effort;
  const client = importer.getClient();
  const request = (structured) => client.beta.messages.create({
    model: ai.MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    output_config: structured ? { effort, format: { type: 'json_schema', schema: SCHEMA } } : { effort },
    messages: [{
      role: 'user',
      content: structured ? input
        : `${input}\n\nAntwoord met uitsluitend één JSON-object (geen uitleg, geen markdown) volgens dit JSON-schema:\n${JSON.stringify(SCHEMA)}`,
    }],
  });
  let response;
  try {
    response = await request(true);
  } catch (err) {
    if (err && err.status === 400 && /grammar|schema|output_config|format/i.test(err.message || '')) {
      try { response = await request(false); } catch (err2) { throw importer.apiError(err2, 'excel'); }
    } else {
      throw importer.apiError(err, 'excel');
    }
  }
  const usage = importer.usageOf(response);
  const billed = (msg) => Object.assign(new BulletinError(msg), { usage });
  if (response.stop_reason === 'refusal') throw billed('Claude kon deze werkopdrachten niet beoordelen.');
  if (response.stop_reason === 'max_tokens') throw billed('Het antwoord van Claude werd afgebroken. Probeer het opnieuw.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return { usage, result: parseJson(text) };
  } catch {
    throw billed('Het antwoord van Claude kon niet worden gelezen. Probeer het opnieuw.');
  }
}

/** Eén klant analyseren. Vervangt de open punten; afgehandelde blijven bewaard. */
async function analyze(customerId, { effort = 'normaal', userId = null } = {}) {
  if (!importer.isConfigured()) throw new BulletinError('Claude is niet ingesteld: vul anthropic-api-key in config.properties in.');
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!customer) throw new BulletinError('Deze klant bestaat niet (meer).');
  const input = buildInput(customer);
  if (!input.rows.length) throw new BulletinError('Deze klant heeft nog geen werkopdrachten om te analyseren.');
  const lvl = ai.level(effort);
  const r = await importer.metered(userId, () => ask(input.text, lvl), { kind: 'aandachtspunten', effort: lvl, limited: false });
  const numbers = new Set(input.rows.map((o) => String(o.nummer)));
  const items = (Array.isArray(r.result && r.result.aandachtspunten) ? r.result.aandachtspunten : []).slice(0, 6).map((b) => ({
    titel: String(b.titel || '').trim().slice(0, 80),
    tekst: String(b.tekst || '').trim().slice(0, 400),
    actie: String(b.actie || '').trim().slice(0, 300),
    ernst: b.ernst === 'hoog' ? 'hoog' : 'normaal',
    nummer: numbers.has(String(b.werkopdracht || '').replace(/\D/g, '')) ? String(b.werkopdracht).replace(/\D/g, '') : '',
    datum: /^\d{4}-\d{2}-\d{2}$/.test(String(b.datum || '')) ? b.datum : '',
  })).filter((b) => b.titel);
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM customer_bulletins WHERE customer_id = ? AND done_at IS NULL').run(customer.id);
    const ins = db.prepare('INSERT INTO customer_bulletins (customer_id, titel, tekst, actie, ernst, order_nummer, datum) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const b of items) ins.run(customer.id, b.titel, b.tekst, b.actie, b.ernst, b.nummer, b.datum);
    db.prepare(`INSERT INTO customer_analysis (customer_id, analyzed_at, orders_sig, effort, eur, n_orders, by_user) VALUES (?, datetime('now'), ?, ?, ?, ?, ?)
      ON CONFLICT(customer_id) DO UPDATE SET analyzed_at = excluded.analyzed_at, orders_sig = excluded.orders_sig, effort = excluded.effort,
        eur = excluded.eur, n_orders = excluded.n_orders, by_user = excluded.by_user`)
      .run(customer.id, input.sig, lvl, r.usage.eur || 0, input.rows.length, userId);
    db.exec('COMMIT');
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  }
  return { count: items.length, eur: r.usage.eur || 0 };
}

/* ---------- alle klanten (op de achtergrond) ---------- */
let job = null;
function jobStatus() {
  return job ? { ...job, errors: job.errors.slice(-5) } : null;
}
function startAll({ effort = 'normaal', userId = null, onProgress = () => {} } = {}) {
  if (job && job.running) throw new BulletinError('Er loopt al een analyse van alle klanten.');
  if (!importer.isConfigured()) throw new BulletinError('Claude is niet ingesteld: vul anthropic-api-key in config.properties in.');
  const todo = staleCustomers().map((c) => c.id);
  job = { running: true, total: todo.length, done: 0, failed: 0, points: 0, eur: 0, effort: ai.level(effort), startedAt: new Date().toISOString(), errors: [], stop: false };
  const current = job;
  const worker = async () => {
    while (todo.length && !current.stop) {
      const id = todo.shift();
      try {
        const r = await analyze(id, { effort: current.effort, userId });
        current.points += r.count; current.eur += r.eur;
      } catch (err) {
        current.failed++;
        current.errors.push(`Klant ${id}: ${err.message}`);
        if (err.usage) current.eur += ai.eur(ai.usdOf(err.usage.model, err.usage.input, err.usage.output));
        // Sleutel ongeldig of tegoed op: stoppen in plaats van alles te laten mislukken.
        if (/API-sleutel|tegoed/i.test(err.message)) current.stop = true;
      }
      current.done++;
      onProgress(current);
    }
  };
  Promise.all([worker(), worker()]).finally(() => { current.running = false; current.finishedAt = new Date().toISOString(); onProgress(current); });
  return jobStatus();
}
function stopAll() { if (job && job.running) job.stop = true; }

module.exports = { BulletinError, forCustomer, toggleDone, analyze, estimateFor, staleCustomers, startAll, stopAll, jobStatus, buildInput, SCHEMA };
