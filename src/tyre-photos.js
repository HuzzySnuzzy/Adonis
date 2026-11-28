'use strict';
/**
 * Banden importeren met foto's: maak foto's van de labels op de banden (naam, kenteken, auto), Claude leest ze,
 * ADONIS zoekt de klanten erbij en u controleert alles op één scherm voordat het in het bandenhotel komt.
 * Per foto kunnen meerdere labels staan; hetzelfde label op meerdere foto's telt één keer.
 */
const { db, plateKey } = require('./db');
const ai = require('./ai');
const importer = require('./import');
const inv = require('./inventory');
const orders = require('./orders');

db.exec(`
  CREATE TABLE IF NOT EXISTS tyre_photo_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    status TEXT NOT NULL DEFAULT 'bezig',  -- bezig | klaar | mislukt | verwerkt
    images TEXT NOT NULL DEFAULT '[]',     -- [{ full, thumb, name }] (data:-adressen, JPEG)
    result TEXT NOT NULL DEFAULT '[]',     -- gevonden labels
    done INTEGER NOT NULL DEFAULT 0,       -- aantal verwerkte foto's
    error TEXT NOT NULL DEFAULT '',
    effort TEXT NOT NULL DEFAULT '',
    eur REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
// Na een herstart is er niets meer bezig; oude imports (een week) opruimen.
db.prepare("UPDATE tyre_photo_imports SET status = 'mislukt', error = 'Onderbroken door een herstart van ADONIS. Begin opnieuw.' WHERE status = 'bezig'").run();
db.prepare("DELETE FROM tyre_photo_imports WHERE created_at < datetime('now', '-7 days')").run();

class TyrePhotoError extends Error {}
const MAX_PHOTOS = 40;
const BATCH = 6; // foto's per aanroep van Claude

const SYSTEM = `Je leest labels op banden in een Nederlandse garage (bandenhotel). Op de foto's staan stapels banden met witte
stickers waarop met de hand de naam van de klant, het kenteken en de auto (merk/model) zijn geschreven, in willekeurige volgorde.
Geef voor elk label dat je ziet één regel. Hetzelfde label (zelfde klant) dat op meerdere banden van één stapel zit, telt één keer.
Regels:
- Lees precies wat er staat; verzin niets. Twijfel je over een letter of cijfer, zet "zeker" op false en noem het in "opmerking".
- Kenteken: Nederlands formaat met streepjes, bijv. 45-ZN-TF, NBH-37-N, PN-842-X, N-133-KT. Geen kenteken te zien: leeg laten.
- Naam: zoals geschreven, met hoofdletters netjes (bijv. "Rogier Boerboom", "Klutman"). Auto: merk en model (bijv. "Toyota Auris").
- Een label dat maar half in beeld is of onleesbaar: alleen opnemen als er iets bruikbaars op staat, met zeker=false.
- "foto": het nummer van de foto (1, 2, 3 …) waarop het label het best te lezen is.
- "seizoen": alleen invullen als het duidelijk is (op het label geschreven, of duidelijk winterbanden: lamellen + sneeuwvlok), anders leeg.
- "aantal": hoeveel banden met dit label je ziet (meestal 4, vaak niet allemaal in beeld: dan leeg laten).`;

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['labels'],
  properties: {
    labels: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['foto', 'naam', 'kenteken', 'auto', 'seizoen', 'aantal', 'zeker', 'opmerking'],
        properties: {
          foto: { type: 'integer' }, naam: { type: 'string' }, kenteken: { type: 'string' }, auto: { type: 'string' },
          seizoen: { type: 'string', enum: ['', 'zomer', 'winter', 'all season'] }, aantal: { type: ['integer', 'null'] },
          zeker: { type: 'boolean' }, opmerking: { type: 'string' },
        },
      },
    },
  },
};

function estimate(n) {
  const calls = Math.max(1, Math.ceil(n / BATCH));
  const per = Math.min(n, BATCH);
  return ai.estimate({ input: 900 + per * 1700, answer: [120 + per * 60, 400 + per * 180], calls })
    .map((l) => ({ ...l, seconds: Math.round(l.seconds * 1.5) }));
}

async function readBatch(images, effortKey) {
  const client = importer.getClient();
  let response;
  try {
    response = await client.beta.messages.create({
      model: ai.MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: ai.LEVELS[ai.level(effortKey)].effort, format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          ...images.flatMap((img, i) => [{ type: 'text', text: `Foto ${i + 1}:` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img.full.split(',')[1] } }]),
          { type: 'text', text: `Lees alle labels op deze ${images.length} foto${images.length === 1 ? '' : "'s"}.` },
        ],
      }],
    });
  } catch (err) {
    throw importer.apiError(err, 'claude');
  }
  const used = importer.usageOf(response);
  const billed = (msg) => Object.assign(new TyrePhotoError(msg), { usage: used });
  if (response.stop_reason === 'refusal') throw billed('Claude kon deze foto\'s niet lezen.');
  if (response.stop_reason === 'max_tokens') throw billed('Het antwoord van Claude werd afgebroken. Probeer minder foto\'s tegelijk.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { throw billed('Het antwoord van Claude kon niet worden gelezen. Probeer het opnieuw.'); }
  return { usage: used, labels: Array.isArray(parsed.labels) ? parsed.labels : [] };
}

const clean = (s, n = 120) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** Labels van alle foto's samenvoegen: zelfde kenteken (of zonder kenteken: zelfde naam) = één set. */
function mergeLabels(list) {
  const out = []; const byKey = new Map();
  for (const l of list) {
    const kenteken = clean(l.kenteken, 12).toUpperCase();
    const pk = plateKey(kenteken);
    const naam = clean(l.naam, 120);
    const key = pk ? 'k:' + pk : naam ? 'n:' + naam.toLowerCase() : null;
    if (!key) continue;
    const row = { foto: Number(l.foto) || 0, naam, kenteken: pk ? require('./plates').formatPlate(kenteken) : '', auto: clean(l.auto, 120),
      seizoen: ['zomer', 'winter', 'all season'].includes(l.seizoen) ? l.seizoen : '', aantal: Number.isInteger(l.aantal) && l.aantal > 0 && l.aantal <= 8 ? l.aantal : null,
      zeker: l.zeker !== false, opmerking: clean(l.opmerking, 200) };
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, row); out.push(row); continue; }
    // Tweede keer gezien: lege velden aanvullen; zeker als één van beide zeker was.
    for (const f of ['naam', 'kenteken', 'auto', 'seizoen']) if (!prev[f] && row[f]) prev[f] = row[f];
    if (!prev.aantal && row.aantal) prev.aantal = row.aantal;
    if (!prev.zeker && row.zeker) { prev.zeker = true; prev.foto = row.foto; }
    if (row.opmerking && !prev.opmerking) prev.opmerking = row.opmerking;
  }
  return out;
}

/** Wat ADONIS al weet: bekende klant (op kenteken, anders op naam) en of er al banden van in het bandenhotel liggen. */
function match(row) {
  const pk = plateKey(row.kenteken);
  let c = pk ? db.prepare("SELECT id, kenteken, naam, merk_type FROM customers WHERE plate_key = ?").get(pk) : null;
  let via = c ? 'kenteken' : '';
  if (!c && row.naam && !pk) {
    const hits = db.prepare("SELECT id, kenteken, naam, merk_type FROM customers WHERE plate_key <> '' AND naam = ? COLLATE NOCASE LIMIT 2").all(row.naam);
    if (hits.length === 1) { c = hits[0]; via = 'naam'; }
  }
  const key = pk || (c ? plateKey(c.kenteken) : '');
  const stored = key ? db.prepare("SELECT id, label, locatie FROM tyre_storage WHERE plate_key = ? AND soort = 'klant' AND status = 'opgeslagen' LIMIT 1").get(key) : null;
  return { klant: c ? { id: c.id, kenteken: c.kenteken, naam: c.naam, auto: c.merk_type, via } : null, opgeslagen: stored || null };
}

function create({ images, effort, userId }) {
  if (!Array.isArray(images) || !images.length) throw new TyrePhotoError('Kies eerst een of meer foto\'s.');
  if (images.length > MAX_PHOTOS) throw new TyrePhotoError(`Maximaal ${MAX_PHOTOS} foto's tegelijk.`);
  const clean = images.map((img, i) => {
    const ok = (u) => typeof u === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(u) && u.length < 7e6;
    if (!ok(img.full) || (img.thumb && !ok(img.thumb))) throw new TyrePhotoError(`Foto ${i + 1} kon niet worden gelezen.`);
    return { full: img.full, thumb: img.thumb || img.full, name: String(img.name || `foto ${i + 1}`).slice(0, 120) };
  });
  return Number(db.prepare('INSERT INTO tyre_photo_imports (user_id, images, effort) VALUES (?, ?, ?)').run(userId, JSON.stringify(clean), ai.level(effort)).lastInsertRowid);
}

/** Op de achtergrond: per groep foto's Claude laten lezen; voortgang in de tabel. */
async function run(id) {
  const row = db.prepare('SELECT * FROM tyre_photo_imports WHERE id = ?').get(id);
  if (!row) return;
  const images = JSON.parse(row.images);
  const found = []; let eur = 0;
  try {
    if (!importer.isConfigured()) throw new TyrePhotoError('Claude is niet ingesteld: vul anthropic-api-key in config.properties in.');
    for (let i = 0; i < images.length; i += BATCH) {
      const part = images.slice(i, i + BATCH);
      const r = await importer.metered(row.user_id, () => readBatch(part, row.effort), { kind: 'bandenfotos', effort: row.effort, limited: false });
      eur += r.usage.eur || 0;
      for (const l of r.labels) found.push({ ...l, foto: (Number(l.foto) || 1) + i }); // fotonummer over de hele import
      db.prepare('UPDATE tyre_photo_imports SET done = ?, eur = ? WHERE id = ?').run(Math.min(images.length, i + BATCH), eur, id);
    }
    const labels = mergeLabels(found).filter((l) => l.foto >= 1 && l.foto <= images.length);
    db.prepare("UPDATE tyre_photo_imports SET status = 'klaar', result = ?, eur = ? WHERE id = ?").run(JSON.stringify(labels), eur, id);
  } catch (err) {
    if (!(err instanceof TyrePhotoError || err instanceof importer.ImportError)) console.error('Banden-foto-import:', err);
    eur += (err.usage && err.usage.eur) || 0;
    // Wat al gelezen is, blijft bruikbaar.
    const labels = mergeLabels(found);
    db.prepare('UPDATE tyre_photo_imports SET status = ?, result = ?, error = ?, eur = ? WHERE id = ?')
      .run(labels.length ? 'klaar' : 'mislukt', JSON.stringify(labels), String(err.message || 'Er ging iets mis.').slice(0, 400), eur, id);
  }
}

function get(id) {
  const r = db.prepare('SELECT * FROM tyre_photo_imports WHERE id = ?').get(id);
  if (!r) return null;
  r.images = JSON.parse(r.images || '[]');
  r.result = JSON.parse(r.result || '[]').map((l) => ({ ...l, ...match(l) }));
  return r;
}
function status(id) {
  const r = db.prepare('SELECT id, status, done, images, error FROM tyre_photo_imports WHERE id = ?').get(id);
  return r ? { id: r.id, status: r.status, done: r.done, total: JSON.parse(r.images).length, error: r.error } : null;
}
function remove(id) { cache.delete(id); db.prepare('DELETE FROM tyre_photo_imports WHERE id = ?').run(id); }
// De foto's van een import (voor het controlescherm), even onthouden: anders wordt bij elke miniatuur alles opnieuw gelezen.
const cache = new Map();
function image(id, n, small) {
  if (!cache.has(id)) {
    const r = db.prepare('SELECT images FROM tyre_photo_imports WHERE id = ?').get(id);
    if (!r) return null;
    cache.clear(); cache.set(id, JSON.parse(r.images || '[]'));
  }
  const img = cache.get(id)[n - 1];
  if (!img) return null;
  const url = small ? img.thumb : img.full;
  return Buffer.from(url.split(',')[1], 'base64');
}

/** Gekozen sets in het bandenhotel zetten (klanten erbij), met de foto van het label. Geeft de nieuwe ids terug. */
function apply(id, rows, { locatie = '', userId } = {}) {
  const imp = db.prepare('SELECT * FROM tyre_photo_imports WHERE id = ?').get(id);
  if (!imp || imp.status === 'verwerkt') throw new TyrePhotoError('Deze import is al verwerkt of bestaat niet meer.');
  const images = JSON.parse(imp.images);
  const photos = require('./photos');
  const ids = []; let nieuw = 0;
  for (const r of rows) {
    const kenteken = clean(r.kenteken, 12); const naam = clean(r.naam, 120);
    if (!kenteken && !naam) continue;
    const m = match({ kenteken, naam });
    const data = inv.normalizeTyre({
      soort: 'klant', kenteken: kenteken || (m.klant ? m.klant.kenteken : ''), klant_naam: naam || (m.klant ? m.klant.naam : ''),
      auto: clean(r.auto, 120) || (m.klant ? m.klant.auto : ''), seizoen: r.seizoen || '', aantal: Number(r.aantal) || 4,
      locatie: clean(locatie, 100), status: 'opgeslagen', datum_in: orders.todayISO(), opmerkingen: 'Ingevoerd met foto-import',
    });
    const tid = inv.saveTyre({ data, userId });
    if (inv.ensureCustomer(data) === 'nieuw') nieuw++;
    const img = images[(Number(r.foto) || 1) - 1];
    if (img) { try { photos.add({ type: 'tyre', id: tid, full: img.full, thumb: img.thumb, name: img.name, userId }); } catch { /* foto is bijzaak */ } }
    ids.push(tid);
  }
  db.prepare("UPDATE tyre_photo_imports SET status = 'verwerkt', images = '[]' WHERE id = ?").run(id); // foto's niet langer bewaren
  cache.delete(id);
  return { ids, nieuw };
}

module.exports = { TyrePhotoError, MAX_PHOTOS, estimate, create, run, get, status, remove, apply, match, image };
