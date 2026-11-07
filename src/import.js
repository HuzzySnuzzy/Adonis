'use strict';
/**
 * Foto-import: leest foto's van papieren werkopdrachten uit met Claude (vision) en zet de
 * tekst in de velden van een werkopdracht. Het resultaat wordt als concept opgeslagen, zodat
 * de gebruiker alles kan controleren voordat het een echte werkopdracht wordt.
 */
const { db } = require('./db');
const orders = require('./orders');

const MODEL = 'claude-opus-5-5';
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // limiet per afbeelding van de API

db.exec(`
CREATE TABLE IF NOT EXISTS import_drafts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  result     TEXT NOT NULL,      -- JSON: { nummer, datum_invoer, onzeker, data }
  images     TEXT NOT NULL,      -- JSON: [{ media_type, data(base64) }]
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Elke (betaalde) uitleespoging, voor de daglimiet en het verbruiksoverzicht.
db.exec(`
CREATE TABLE IF NOT EXISTS import_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  day           TEXT NOT NULL,              -- YYYY-MM-DD (Nederlandse tijd)
  status        TEXT NOT NULL,              -- 'bezig', 'ok', 'mislukt'
  model         TEXT NOT NULL DEFAULT '',
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS import_log_day ON import_log(day);
`);

function cleanupDrafts() {
  db.prepare("DELETE FROM import_drafts WHERE created_at < datetime('now', '-3 days')").run();
}
setInterval(cleanupDrafts, 6 * 60 * 60 * 1000).unref();
cleanupDrafts();

/** Daglimiet uit config.properties (import-limit-per-day). 0 = geen limiet. */
function dailyLimit() {
  const n = parseInt(process.env.IMPORT_LIMIT_PER_DAY ?? '30', 10);
  return Number.isFinite(n) && n >= 0 ? n : 30;
}

// Prijzen per miljoen tokens (USD) – alleen voor de schatting in het overzicht.
const PRICES = { 'claude-opus-5-5': [4, 20] };
const DEFAULT_PRICE = [5, 25]; // voor een eventueel fallback-model: liever iets te hoog geschat

function estimateUsd(row) {
  const [inP, outP] = PRICES[row.model] || DEFAULT_PRICE;
  return (row.input_tokens * inP + row.output_tokens * outP) / 1e6;
}

/** Verbruik vandaag en deze maand. */
function usage() {
  const today = orders.todayISO();
  const month = today.slice(0, 7);
  const todayCount = db.prepare("SELECT COUNT(*) AS n FROM import_log WHERE day = ?").get(today).n;
  const rows = db.prepare("SELECT model, input_tokens, output_tokens FROM import_log WHERE day LIKE ?").all(month + '%');
  const monthUsd = rows.reduce((sum, r) => sum + estimateUsd(r), 0);
  const limit = dailyLimit();
  return {
    today: todayCount,
    limit,
    remaining: limit === 0 ? Infinity : Math.max(0, limit - todayCount),
    monthCount: rows.length,
    monthUsd,
  };
}

function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/* ---------- JSON-schema, automatisch afgeleid van de werkopdracht-velden ---------- */
function schemaFor(value) {
  if (Array.isArray(value)) return { type: 'array', items: schemaFor(value[0]) };
  if (value && typeof value === 'object') {
    const properties = {};
    for (const [k, v] of Object.entries(value)) properties[k] = schemaFor(v);
    return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
  }
  if (typeof value === 'boolean') return { type: 'boolean' };
  return { type: 'string' };
}

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    nummer: { type: 'string', description: 'Het rode werkopdrachtnummer, alleen cijfers, of leeg.' },
    datum_invoer: { type: 'string', description: 'Datum invoer als YYYY-MM-DD, of leeg.' },
    onzeker: {
      type: 'array',
      items: { type: 'string' },
      description: 'Korte Nederlandse opmerkingen over moeilijk leesbare of twijfelachtige waarden.',
    },
    werkopdracht: schemaFor(orders.emptyOrderData()),
  },
  required: ['nummer', 'datum_invoer', 'onzeker', 'werkopdracht'],
  additionalProperties: false,
};

const FLUID_KEYS = orders.FLUIDS.map((f) => `${f.key}${f.label ? ` (${f.label})` : ' (lege regel)'}`).join(', ');

const PROMPT = `Je krijgt een of meer foto's van een handgeschreven papieren werkopdracht van een Nederlandse autogarage
(voorkant en eventueel achterkant). Lees alle handgeschreven tekst en zet die in de juiste velden van het JSON-schema.

Opbouw van het formulier:
- Rechterhelft, kop: Monteur, Datum invoer, Datum gereed, Klantnr., Kenteken, Merk/Type, Km-stand (werkelijk) (in) -> km_in,
  Km-stand (teller) (uit) -> km_uit, Datum deel I, A.p.k.-datum; daarnaast Naam, Adres, Plaats, Tel. privé, Tel. zaak,
  "Alle noodzakelijke reparaties uitvoeren Ja/Nee" (omcirkeld of aangestreept -> "ja"/"nee", anders leeg),
  "Kontakt opnemen bij extra rep.kosten boven €" -> contact_boven, Chassisnummer, Alarmcode.
  Het rode gedrukte getal rechtsboven is het werkopdrachtnummer.
- Rechterhelft, "Omschrijving werkzaamheden" met kolommen ✓ (werk_check), omschrijving (werk_omschrijving), Code (werk_code),
  Tijd (werk_tijd). De regel "Servicebeurt ... km" -> servicebeurt_km. Onderaan: Berekend op faktuurnr. (faktuurnr),
  Totaal gewerkte uren, Tarief, Bedrag.
- Linkerhelft: tabel "Onderdeelnummer / Omschrijving / Aantal / Prijs p.eenh." met 22 genummerde regels.
  Geef altijd precies 22 items in "onderdelen", op de positie van het gedrukte regelnummer (regel 1 = index 0,
  regel 21 = index 20). Lege regels als lege strings.
- Linksonder "Liter / Omschrijving / Prijs p.eenh." voor vloeistoffen: ${FLUID_KEYS}.
  Bij Motorolie staat een viscositeit als "5 w 20": info = "5", info2 = "20". Andere extra tekst in "info".
- Linksonder "Diversen": servicewagen/leenauto (km en prijs), werk derden, aankruisvakjes A.p.k., Afmeldkosten,
  Uitlijnen, Balanceren (true als aangekruist), testapparatuur, kleinmateriaal, milieutoeslag; een vrije regel -> extra.
- Achterkant (achter): bandenprofiel per band (lv = linksvoor, rv = rechtsvoor, la = linksachter, ra = rechtsachter,
  reserve) met profiel in mm, maat, merk, DOT; A.p.k./afkeurpunten -> achter.apk; aandachtspunten; overige notities.
  Staat iets op de achterkant dat niet in een vak past, zet het in achter.notities.

Regels:
- Neem de tekst letterlijk over zoals geschreven: zelfde woorden, geen samenvatting en geen spelling verbeteren
  ("Distrubutie" blijft "Distrubutie").
- Behoud de regelindeling van de werkzaamheden: elke geschreven regel is een regel (\\n). Een nieuw punt begint met "- ",
  een vervolgregel van hetzelfde punt begint met twee spaties. Laat een lege regel staan waar op papier een regel is overgeslagen.
- Datums als YYYY-MM-DD. Op papier staat vaak "28-9-26": dat is 2026-09-28. Onvolledige datum -> leeg laten.
- Bedragen zoals geschreven, met komma (bijv. "338,90"). Aantal zoals geschreven (bijv. "1X", "4,5L").
- Kenteken in hoofdletters met streepjes zoals geschreven (bijv. "43-XTT-9").
- Een veld dat leeg is of niet op de foto staat: lege string (of false). Verzin niets.
- Twijfel je over een waarde (slecht leesbaar, cijfer kan ook iets anders zijn), vul je beste lezing in en noem het kort
  in "onzeker", bijv. "Km-stand in: 121665 of 121565?". Is de foto onscherp of niet van een werkopdracht, zeg dat in "onzeker".`;

/* ---------- Claude aanroepen ---------- */
let clientFactory = () => {
  const Anthropic = require('@anthropic-ai/sdk');
  const Client = Anthropic.default || Anthropic;
  return new Client({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 3 * 60 * 1000, maxRetries: 2 });
};
/** Alleen voor tests: eigen client injecteren. */
function setClientFactory(fn) {
  clientFactory = fn;
}

class ImportError extends Error {}

function parseImages(list) {
  if (!Array.isArray(list) || list.length === 0) throw new ImportError('Geen foto ontvangen.');
  if (list.length > MAX_IMAGES) throw new ImportError(`Maximaal ${MAX_IMAGES} foto's per werkopdracht.`);
  return list.map((url) => {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(url || ''));
    if (!m) throw new ImportError('Ongeldig afbeeldingsformaat (gebruik JPG, PNG of WebP).');
    if (Buffer.byteLength(m[2], 'base64') > MAX_IMAGE_BYTES) throw new ImportError('Een foto is te groot (max. 5 MB).');
    return { media_type: m[1], data: m[2] };
  });
}

async function readWithClaude(images) {
  const client = clientFactory();
  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // Bij een (onterechte) weigering van het model automatisch een ander model laten proberen.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'high', // handschrift lezen: liever grondig dan snel
        format: { type: 'json_schema', schema: RESULT_SCHEMA },
      },
      messages: [{
        role: 'user',
        content: [
          ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } })),
          { type: 'text', text: PROMPT },
        ],
      }],
    });
  } catch (err) {
    const status = err && err.status;
    if (status === 401 || status === 403) throw new ImportError('De API-sleutel voor het uitlezen is ongeldig. Controleer anthropic-api-key in config.properties.');
    if (status === 429) throw new ImportError('Te veel verzoeken of tegoed op. Probeer het over een minuut opnieuw.');
    if (status === 400) throw new ImportError('De foto kon niet worden verwerkt: ' + (err.message || 'ongeldig verzoek'));
    if (status >= 500) throw new ImportError('De uitleesdienst is tijdelijk niet beschikbaar. Probeer het later opnieuw.');
    throw new ImportError('Geen verbinding met de uitleesdienst (is er internet?). ' + (err && err.message ? `(${err.message})` : ''));
  }
  // Vanaf hier is de aanroep gelukt en dus betaald: verbruik altijd doorgeven, ook bij een fout.
  const used = {
    model: response.model || MODEL,
    input: (response.usage?.input_tokens || 0) + (response.usage?.cache_read_input_tokens || 0) + (response.usage?.cache_creation_input_tokens || 0),
    output: response.usage?.output_tokens || 0,
  };
  const billedError = (msg) => Object.assign(new ImportError(msg), { usage: used });
  if (response.stop_reason === 'refusal') throw billedError('De foto kon niet worden uitgelezen. Probeer een andere foto.');
  if (response.stop_reason === 'max_tokens') throw billedError('Het uitlezen werd afgebroken (te veel tekst). Probeer minder foto\'s tegelijk.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw billedError('Het resultaat kon niet worden gelezen. Probeer het opnieuw.');
  }
  const nummer = String(parsed.nummer || '').replace(/\D/g, '');
  const datum = /^\d{4}-\d{2}-\d{2}$/.test(parsed.datum_invoer || '') ? parsed.datum_invoer : '';
  return {
    usage: used,
    nummer,
    datum_invoer: datum,
    onzeker: Array.isArray(parsed.onzeker) ? parsed.onzeker.map(String).slice(0, 30) : [],
    data: orders.normalizeOrderData(parsed.werkopdracht || {}),
  };
}

/** Foto's uitlezen en als concept opslaan. Geeft het concept-id terug. */
async function createDraft(imageUrls, userId) {
  if (!isConfigured()) throw new ImportError('Foto-import is niet ingesteld: vul anthropic-api-key in config.properties in.');
  const images = parseImages(imageUrls);

  // Daglimiet: eerst een plek reserveren (zo kunnen twee gelijktijdige imports de limiet niet omzeilen).
  const limit = dailyLimit();
  const today = orders.todayISO();
  let logId;
  db.exec('BEGIN IMMEDIATE');
  try {
    const n = db.prepare("SELECT COUNT(*) AS n FROM import_log WHERE day = ?").get(today).n;
    if (limit > 0 && n >= limit) {
      db.exec('ROLLBACK');
      throw new ImportError(`De daglimiet van ${limit} imports is bereikt. Morgen kan het weer, of vraag de beheerder de limiet (import-limit-per-day) te verhogen.`);
    }
    logId = Number(db.prepare("INSERT INTO import_log (user_id, day, status) VALUES (?, ?, 'bezig')").run(userId, today).lastInsertRowid);
    db.exec('COMMIT');
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  }

  let result;
  try {
    result = await readWithClaude(images);
  } catch (err) {
    if (err.usage) {
      // Wel betaald: meetellen.
      db.prepare("UPDATE import_log SET status = 'mislukt', model = ?, input_tokens = ?, output_tokens = ? WHERE id = ?")
        .run(err.usage.model, err.usage.input, err.usage.output, logId);
    } else {
      // Geen antwoord van de API (dus niet betaald): telt niet mee voor de limiet.
      db.prepare('DELETE FROM import_log WHERE id = ?').run(logId);
    }
    throw err;
  }
  db.prepare("UPDATE import_log SET status = 'ok', model = ?, input_tokens = ?, output_tokens = ? WHERE id = ?")
    .run(result.usage.model, result.usage.input, result.usage.output, logId);
  delete result.usage;
  const res = db.prepare('INSERT INTO import_drafts (user_id, result, images) VALUES (?, ?, ?)').run(
    userId, JSON.stringify(result), JSON.stringify(images)
  );
  return Number(res.lastInsertRowid);
}

function getDraft(id) {
  const row = db.prepare('SELECT * FROM import_drafts WHERE id = ?').get(id);
  if (!row) return null;
  const images = JSON.parse(row.images);
  return { id: row.id, userId: row.user_id, createdAt: row.created_at, result: JSON.parse(row.result), imageCount: images.length, images };
}

function deleteDraft(id) {
  db.prepare('DELETE FROM import_drafts WHERE id = ?').run(id);
}

module.exports = {
  isConfigured, createDraft, usage, dailyLimit, getDraft, deleteDraft, setClientFactory, ImportError, RESULT_SCHEMA, MAX_IMAGES,
};
