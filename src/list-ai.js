'use strict';
/**
 * Lijsten opschonen met Claude: bandenhotel, overige bandenopslag (o.a. noodbanden) en de voorraad (banden en onderdelen).
 * Claude stelt per regel verbeteringen voor (schrijfwijze, merk, bandenmaat, seizoen, soort onderdeel…) en wijst mogelijke
 * dubbele regels aan. Niets wordt vanzelf veranderd: de gebruiker vinkt aan wat hij wil en klikt op Toepassen.
 * Het resultaat wordt bewaard, zodat bekijken later niets kost.
 */
const { db } = require('./db');
const ai = require('./ai');
const importer = require('./import');
const inv = require('./inventory');

db.exec(`
CREATE TABLE IF NOT EXISTS list_ai_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lijst      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  by_user    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  effort     TEXT NOT NULL DEFAULT '',
  eur        REAL NOT NULL DEFAULT 0,
  n_rows     INTEGER NOT NULL DEFAULT 0,
  result     TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS list_ai_runs_lijst ON list_ai_runs(lijst, id);
`);

const FIELD_LABEL = {
  klant_naam: 'Naam', telefoon: 'Telefoon', auto: 'Auto', seizoen: 'Seizoen', maat: 'Maat', merk: 'Merk', velg: 'Velg',
  type: 'Type / soort', snelheid: 'Last-/snelheidsindex', omschrijving: 'Omschrijving',
};
const LISTS = {
  klantbanden: { label: 'Bandenhotel (klantenbanden)', kind: 'tyre', soort: 'klant', back: '/bandenhotel', area: 'banden',
    fields: ['klant_naam', 'telefoon', 'auto', 'seizoen', 'maat', 'merk', 'velg'], context: ['label', 'kenteken'] },
  opslagbanden: { label: 'Overige bandenopslag (o.a. noodbanden)', kind: 'tyre', soort: 'opslag', back: '/bandenhotel?soort=opslag', area: 'banden',
    fields: ['auto', 'seizoen', 'maat', 'merk', 'velg'], context: ['label', 'opmerkingen'] },
  voorraadbanden: { label: 'Voorraad: banden', kind: 'stock', soort: 'band', back: '/voorraad?soort=band', area: 'voorraad',
    fields: ['merk', 'type', 'maat', 'snelheid', 'seizoen', 'omschrijving'], context: ['nummer'] },
  onderdelen: { label: 'Voorraad: onderdelen', kind: 'stock', soort: 'onderdeel', back: '/voorraad?soort=onderdeel', area: 'voorraad',
    fields: ['merk', 'type', 'omschrijving'], context: ['nummer', 'oe_nummer'] },
};
const CHUNK = 120; // regels per aanroep
const MAX_ROWS = 2400;

class ListAiError extends Error {}

function rowsOf(key) {
  const L = LISTS[key];
  if (L.kind === 'tyre') {
    return db.prepare("SELECT * FROM tyre_storage WHERE soort = ? AND status <> 'uitgegeven' ORDER BY id").all(L.soort);
  }
  return db.prepare('SELECT * FROM stock_items WHERE soort = ? ORDER BY id').all(L.soort);
}
function compact(L, r) {
  const o = { id: r.id };
  for (const f of [...L.context, ...L.fields]) if (r[f] !== '' && r[f] !== null && r[f] !== undefined) o[f] = String(r[f]).slice(0, 160);
  return o;
}

const SYSTEM = `Je bent een zorgvuldige data-assistent voor een Nederlandse autogarage. Je maakt lijsten netjes en consequent,
zonder iets te verzinnen. Je antwoordt alleen met JSON volgens het schema.`;
function prompt(L, rows) {
  return `Lijst: ${L.label}. Hieronder de regels als JSON (één object per regel, met id).

Stel verbeteringen voor zodat de lijst netjes en consequent is. Alleen voor deze velden: ${L.fields.join(', ')}.
- Schrijfwijze gelijktrekken: merken (michelin → Michelin, Contintental → Continental, vw → Volkswagen), typefouten, hoofdletters in namen (jan de vries → Jan de Vries).
- Bandenmaat als 205/55R16, eventueel met last-/snelheidsindex erachter (205/55R16 91V). C voor bestelbusbanden (195/70R15C).
- Seizoen alleen "Zomer", "Winter" of "All season". Leid het alleen af uit een bekend bandenmodel (bijv. Michelin Alpin = Winter, Michelin CrossClimate = All season, Continental WinterContact = Winter); anders niet invullen.
- Velg alleen: staal, alu of zonder.
- Telefoonnummers als 06-12345678 of 0316-123456.
- Auto: merk en model zoals gebruikelijk (vw golf → Volkswagen Golf, OPEL CORSA → Opel Corsa).
- Onderdelen: soort (veld type) in hoofdletters en overal hetzelfde woord (BOUGIE, REMBLOKKEN, OLIEFILTER…); omschrijving kort en duidelijk.
- Een leeg veld alleen invullen als het uit de rest van de regel zeker volgt (bijv. merk uit de omschrijving).
- Nooit artikelnummers, labels, kentekens of aantallen veranderen. Niets verzinnen. Twijfel = niet voorstellen.
- Geef per wijziging een korte reden in het Nederlands.
Meld ook regels die waarschijnlijk dubbel zijn (dezelfde banden of hetzelfde onderdeel twee keer), met hun id's.

${JSON.stringify(rows)}`;
}
function schemaFor(L) {
  return {
    type: 'object',
    properties: {
      wijzigingen: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'veld', 'nieuw', 'reden'],
        properties: { id: { type: 'integer' }, veld: { type: 'string', enum: L.fields }, nieuw: { type: 'string' }, reden: { type: 'string' } } } },
      dubbel: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['ids', 'reden'],
        properties: { ids: { type: 'array', items: { type: 'integer' } }, reden: { type: 'string' } } } },
    },
    required: ['wijzigingen', 'dubbel'],
    additionalProperties: false,
  };
}
function parseJson(text) {
  try { return JSON.parse(text); } catch {
    const a = text.indexOf('{'); const b = text.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
    throw new Error('geen JSON');
  }
}
async function ask(L, rows, effortKey) {
  const effort = ai.LEVELS[ai.level(effortKey)].effort;
  const schema = schemaFor(L);
  const client = importer.getClient();
  const input = prompt(L, rows);
  const request = (structured) => client.beta.messages.create({
    model: ai.MODEL, max_tokens: 16000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', system: SYSTEM,
    output_config: structured ? { effort, format: { type: 'json_schema', schema } } : { effort },
    messages: [{ role: 'user', content: structured ? input : `${input}\n\nAntwoord met uitsluitend één JSON-object volgens dit JSON-schema:\n${JSON.stringify(schema)}` }],
  });
  let response;
  try { response = await request(true); } catch (err) {
    if (err && err.status === 400 && /grammar|schema|output_config|format/i.test(err.message || '')) {
      try { response = await request(false); } catch (err2) { throw importer.apiError(err2, 'claude'); }
    } else throw importer.apiError(err, 'claude');
  }
  const usage = importer.usageOf(response);
  const billed = (msg) => Object.assign(new ListAiError(msg), { usage });
  if (response.stop_reason === 'refusal') throw billed('Claude kon deze lijst niet beoordelen.');
  if (response.stop_reason === 'max_tokens') throw billed('Het antwoord van Claude werd afgebroken. Probeer het opnieuw.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return { usage, result: parseJson(text) }; } catch { throw billed('Het antwoord van Claude kon niet worden gelezen. Probeer het opnieuw.'); }
}

/** Wat zou de regel worden met deze waarde? (zelfde controle als bij het opslaan van het formulier) */
function normalized(L, row, field, value) {
  const merged = { ...row, [field]: value };
  if (L.kind === 'tyre') return inv.normalizeTyre({ ...merged, profiel_voor: row.profiel_voor, profiel_achter: row.profiel_achter })[field];
  return inv.normalizeStock(merged, L.soort)[field];
}

/** Kostenschatting vooraf (voor het venster "Hoeveel moeite mag Claude doen?"). */
function estimateFor(key) {
  const L = LISTS[key];
  const rows = rowsOf(key).slice(0, MAX_ROWS);
  const calls = Math.max(1, Math.ceil(rows.length / CHUNK));
  const perCall = ai.tokensForText(JSON.stringify(rows.slice(0, CHUNK).map((r) => compact(L, r)))) + 900;
  return { n: rows.length, levels: ai.estimate({ input: perCall, answer: [600, 5000], calls }) };
}

/* ---------- achtergrondtaak per lijst ---------- */
const jobs = new Map(); // lijst -> { running, done, total, eur, error, runId }
function jobStatus(key) { const j = jobs.get(key); return j ? { ...j } : null; }
function start(key, { effort = 'normaal', userId = null, onDone = () => {} } = {}) {
  const L = LISTS[key];
  if (!L) throw new ListAiError('Onbekende lijst.');
  if (!importer.isConfigured()) throw new ListAiError('Claude is niet ingesteld: vul anthropic-api-key in config.properties in.');
  const cur = jobs.get(key);
  if (cur && cur.running) throw new ListAiError('Deze lijst wordt al gecontroleerd. Even geduld.');
  const rows = rowsOf(key).slice(0, MAX_ROWS);
  if (!rows.length) throw new ListAiError('Deze lijst is leeg.');
  const lvl = ai.level(effort);
  const job = { running: true, done: 0, total: rows.length, eur: 0, error: null, runId: null };
  jobs.set(key, job);
  (async () => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const changes = []; const dubbel = [];
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const part = rows.slice(i, i + CHUNK);
        const r = await importer.metered(userId, () => ask(L, part.map((x) => compact(L, x)), lvl), { kind: 'lijst', effort: lvl, limited: false });
        job.eur += r.usage.eur || 0;
        const ids = new Set(part.map((x) => x.id));
        for (const c of Array.isArray(r.result.wijzigingen) ? r.result.wijzigingen : []) {
          const row = byId.get(Number(c.id));
          if (!row || !ids.has(row.id) || !L.fields.includes(c.veld)) continue;
          const oud = String(row[c.veld] ?? '');
          const nieuw = String(normalized(L, row, c.veld, String(c.nieuw ?? '').slice(0, 200)) ?? '');
          if (nieuw === oud || (!nieuw && oud)) continue; // niets veranderd, of iets leegmaken: niet voorstellen
          if (changes.some((x) => x.id === row.id && x.veld === c.veld)) continue;
          changes.push({ id: row.id, veld: c.veld, oud, nieuw, reden: String(c.reden || '').slice(0, 200) });
        }
        for (const d of Array.isArray(r.result.dubbel) ? r.result.dubbel : []) {
          const dIds = [...new Set((d.ids || []).map(Number).filter((x) => byId.has(x)))];
          if (dIds.length >= 2) dubbel.push({ ids: dIds, reden: String(d.reden || '').slice(0, 200) });
        }
        job.done = Math.min(rows.length, i + CHUNK);
      }
      const runId = Number(db.prepare('INSERT INTO list_ai_runs (lijst, by_user, effort, eur, n_rows, result) VALUES (?, ?, ?, ?, ?, ?)')
        .run(key, userId, lvl, job.eur, rows.length, JSON.stringify({ changes, dubbel, applied: [] })).lastInsertRowid);
      job.runId = runId;
    } catch (err) {
      if (!(err instanceof ListAiError || err instanceof importer.ImportError)) console.error('Lijst optimaliseren:', err);
      job.error = err.message || 'Er ging iets mis.';
    } finally {
      job.running = false;
      onDone(job);
    }
  })();
  return jobStatus(key);
}

/** Laatste resultaat van een lijst, met de huidige waarden erbij (is het intussen al gewijzigd?). */
function latest(key) {
  const L = LISTS[key];
  const run = db.prepare(`SELECT r.*, u.name AS by_name FROM list_ai_runs r LEFT JOIN users u ON u.id = r.by_user
    WHERE r.lijst = ? ORDER BY r.id DESC LIMIT 1`).get(key);
  if (!run) return null;
  let res = {};
  try { res = JSON.parse(run.result); } catch { /* leeg */ }
  const table = L.kind === 'tyre' ? 'tyre_storage' : 'stock_items';
  const getRow = db.prepare(`SELECT * FROM ${table} WHERE id = ?`);
  const applied = new Set(res.applied || []);
  const rows = new Map();
  const changes = (res.changes || []).map((c) => {
    if (!rows.has(c.id)) rows.set(c.id, getRow.get(c.id) || null);
    const row = rows.get(c.id);
    const nu = row ? String(row[c.veld] ?? '') : null;
    const k = `${c.id}:${c.veld}`;
    return { ...c, key: k, nu, gone: !row, applied: applied.has(k) || (row && nu === c.nieuw), stale: row && nu !== c.oud && nu !== c.nieuw };
  });
  const title = (row) => !row ? '(verwijderd)' : L.kind === 'tyre'
    ? [row.label && '#' + row.label, row.kenteken, row.klant_naam, row.maat].filter(Boolean).join(' · ')
    : [row.merk, row.type, row.nummer, row.maat].filter(Boolean).join(' · ') || row.omschrijving || '#' + row.id;
  const groups = [];
  for (const c of changes) {
    let g = groups.find((x) => x.id === c.id);
    if (!g) { g = { id: c.id, title: title(rows.get(c.id)), href: (L.kind === 'tyre' ? '/bandenhotel/' : '/voorraad/') + c.id, changes: [] }; groups.push(g); }
    g.changes.push(c);
  }
  const dubbel = (res.dubbel || []).map((d) => ({ ...d, rows: d.ids.map((id) => ({ id, title: title(getRow.get(id)), href: (L.kind === 'tyre' ? '/bandenhotel/' : '/voorraad/') + id })) }));
  return { run: { id: run.id, created_at: run.created_at, by_name: run.by_name, effort: run.effort, eur: run.eur, n_rows: run.n_rows }, groups, dubbel,
    open: changes.filter((c) => !c.applied && !c.gone).length };
}

/** Aangevinkte wijzigingen ("id:veld") doorvoeren. Geeft de gewijzigde id's terug. */
function apply(key, runId, keys, userId) {
  const L = LISTS[key];
  const run = db.prepare('SELECT * FROM list_ai_runs WHERE id = ? AND lijst = ?').get(runId, key);
  if (!run) throw new ListAiError('Dit voorstel bestaat niet meer. Laat de lijst opnieuw controleren.');
  const res = JSON.parse(run.result || '{}');
  const want = new Set(keys);
  const byRow = new Map();
  for (const c of res.changes || []) if (want.has(`${c.id}:${c.veld}`)) { if (!byRow.has(c.id)) byRow.set(c.id, []); byRow.get(c.id).push(c); }
  const done = [];
  const applied = new Set(res.applied || []);
  db.exec('BEGIN');
  try {
    for (const [id, cs] of byRow) {
      if (L.kind === 'tyre') {
        const row = inv.getTyre(id);
        if (!row) continue;
        const data = inv.normalizeTyre({ ...row, ...Object.fromEntries(cs.map((c) => [c.veld, c.nieuw])) });
        inv.saveTyre({ id, data, userId });
      } else {
        const row = inv.getStock(id);
        if (!row) continue;
        const data = inv.normalizeStock({ ...row, ...Object.fromEntries(cs.map((c) => [c.veld, c.nieuw])) }, L.soort);
        inv.saveStock({ id, data, userId });
      }
      for (const c of cs) applied.add(`${c.id}:${c.veld}`);
      done.push(id);
    }
    db.prepare('UPDATE list_ai_runs SET result = ? WHERE id = ?').run(JSON.stringify({ ...res, applied: [...applied] }), runId);
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return done;
}

module.exports = { LISTS, FIELD_LABEL, ListAiError, estimateFor, start, jobStatus, latest, apply };
