'use strict';
/**
 * Foto-import: leest foto's van papieren werkopdrachten uit met Claude (vision) en zet de
 * tekst in de velden van een werkopdracht. Het resultaat wordt als concept opgeslagen, zodat
 * de gebruiker alles kan controleren voordat het een echte werkopdracht wordt.
 */
const { db } = require('./db');
const orders = require('./orders');

const MODEL = require('./ai').MODEL;
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
// Soort aanroep (foto, excel, aandachtspunten) en gekozen inspanning.
{
  const cols = db.prepare('PRAGMA table_info(import_log)').all().map((c) => c.name);
  if (!cols.includes('kind')) db.exec("ALTER TABLE import_log ADD COLUMN kind TEXT NOT NULL DEFAULT ''");
  if (!cols.includes('effort')) db.exec("ALTER TABLE import_log ADD COLUMN effort TEXT NOT NULL DEFAULT ''");
}
const ai = require('./ai');
// Alleen foto- en Excel-imports tellen mee voor de daglimiet (aandachtspunten worden vooraf met kosten bevestigd).
const LIMITED = "kind IN ('', 'foto', 'excel')";

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

function estimateUsd(row) {
  return ai.usdOf(row.model, row.input_tokens, row.output_tokens);
}

/** Verbruik vandaag en deze maand. */
function usage() {
  const today = orders.todayISO();
  const month = today.slice(0, 7);
  const todayCount = db.prepare(`SELECT COUNT(*) AS n FROM import_log WHERE day = ? AND ${LIMITED}`).get(today).n;
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

/* ---------- Compact JSON-schema ----------
 * Alleen ingevulde regels worden teruggegeven (geen 22 lege onderdeelregels, geen lege vakjes);
 * toWorkOrder() zet ze daarna op de juiste plek in het formulier. Een klein schema is nodig:
 * de API weigert te grote schema's ("compiled grammar is too large").
 */
const str = { type: 'string' };
const obj = (fields, extra = {}) => ({
  type: 'object',
  properties: Object.fromEntries(fields.map((f) => [f, extra[f] || str])),
  required: fields,
  additionalProperties: false,
});
const KOP = ['monteur', 'datum_gereed', 'klantnr', 'kenteken', 'merk_type', 'km_in', 'km_uit', 'datum_deel1', 'apk_datum',
  'naam', 'adres', 'plaats', 'tel_prive', 'tel_zaak', 'alle_reparaties', 'contact_boven', 'chassisnummer', 'alarmcode'];
const WERK = ['servicebeurt_km', 'check', 'omschrijving', 'code', 'tijd', 'faktuurnr', 'totaal_uren', 'tarief', 'bedrag'];
const DIVERSEN = ['servicewagen', 'leenauto', 'werk_derden', 'apk', 'afmeldkosten', 'testapparatuur', 'uitlijnen',
  'balanceren', 'kleinmateriaal', 'milieutoeslag', 'extra'];

const RESULT_SCHEMA = obj(
  ['nummer', 'datum_invoer', 'onzeker', 'kop', 'werk', 'onderdelen', 'vloeistoffen', 'diversen', 'banden', 'achterkant'],
  {
    onzeker: { type: 'array', items: str },
    kop: obj(KOP),
    werk: obj(WERK),
    onderdelen: { type: 'array', items: obj(['regel', 'nr', 'omschrijving', 'aantal', 'prijs'], { regel: { type: 'integer' } }) },
    vloeistoffen: {
      type: 'array',
      items: obj(['soort', 'liter', 'info', 'info2', 'prijs'], { soort: { type: 'string', enum: orders.FLUIDS.map((f) => f.key) } }),
    },
    diversen: { type: 'array', items: obj(['veld', 'tekst', 'prijs'], { veld: { type: 'string', enum: DIVERSEN } }) },
    banden: {
      type: 'array',
      items: obj(['band', 'profiel', 'maat', 'merk', 'dot'], { band: { type: 'string', enum: orders.TIRES.map((t) => t.key) } }),
    },
    achterkant: obj(['apk', 'aandachtspunten', 'notities']),
  }
);

/** Compact resultaat -> volledige werkopdracht in de vorm van het formulier. */
function toWorkOrder(r) {
  const d = orders.emptyOrderData();
  const get = (o, k) => (o && typeof o[k] === 'string' ? o[k] : o && typeof o[k] === 'number' ? String(o[k]) : '');
  for (const k of KOP) d[k] = get(r.kop, k);
  d.servicebeurt_km = get(r.werk, 'servicebeurt_km');
  d.werk_check = get(r.werk, 'check');
  d.werk_omschrijving = get(r.werk, 'omschrijving');
  d.werk_code = get(r.werk, 'code');
  d.werk_tijd = get(r.werk, 'tijd');
  for (const k of ['faktuurnr', 'totaal_uren', 'tarief', 'bedrag']) d[k] = get(r.werk, k);

  // Onderdelen op hun gedrukte regelnummer; zonder (geldig/vrij) nummer op de eerste lege regel.
  const free = () => d.onderdelen.findIndex((p) => !p.nr && !p.omschrijving && !p.aantal && !p.prijs);
  for (const p of Array.isArray(r.onderdelen) ? r.onderdelen : []) {
    let i = parseInt(p && p.regel, 10) - 1;
    if (!(i >= 0 && i < d.onderdelen.length) || d.onderdelen[i].nr || d.onderdelen[i].omschrijving) i = free();
    if (i < 0) break;
    d.onderdelen[i] = { nr: get(p, 'nr'), omschrijving: get(p, 'omschrijving'), aantal: get(p, 'aantal'), prijs: get(p, 'prijs') };
  }
  for (const v of Array.isArray(r.vloeistoffen) ? r.vloeistoffen : []) {
    if (v && d.vloeistoffen[v.soort]) {
      d.vloeistoffen[v.soort] = { liter: get(v, 'liter'), info: get(v, 'info'), info2: get(v, 'info2'), prijs: get(v, 'prijs') };
    }
  }
  const dv = d.diversen;
  for (const x of Array.isArray(r.diversen) ? r.diversen : []) {
    const tekst = get(x, 'tekst');
    const prijs = get(x, 'prijs');
    switch (x && x.veld) {
      case 'servicewagen': dv.servicewagen_km = tekst; dv.servicewagen_prijs = prijs; break;
      case 'leenauto': dv.leenauto_km = tekst; dv.leenauto_prijs = prijs; break;
      case 'werk_derden': dv.werk_derden = tekst; dv.werk_derden_prijs = prijs; break;
      case 'apk': dv.apk = true; dv.apk_prijs = prijs || dv.apk_prijs; break;
      case 'afmeldkosten': dv.afmeldkosten = true; dv.apk_prijs = prijs || dv.apk_prijs; break;
      case 'uitlijnen': dv.uitlijnen = true; dv.uitlijnen_prijs = prijs || dv.uitlijnen_prijs; break;
      case 'balanceren': dv.balanceren = true; dv.uitlijnen_prijs = prijs || dv.uitlijnen_prijs; break;
      case 'testapparatuur': dv.testapparatuur = tekst; dv.testapparatuur_prijs = prijs; break;
      case 'kleinmateriaal': dv.kleinmateriaal = tekst; dv.kleinmateriaal_prijs = prijs; break;
      case 'milieutoeslag': dv.milieutoeslag = tekst; dv.milieutoeslag_prijs = prijs; break;
      case 'extra': dv.extra = tekst; dv.extra_prijs = prijs; break;
      default: break;
    }
  }
  for (const b of Array.isArray(r.banden) ? r.banden : []) {
    if (b && d.achter.banden[b.band]) {
      d.achter.banden[b.band] = { profiel: get(b, 'profiel'), maat: get(b, 'maat'), merk: get(b, 'merk'), dot: get(b, 'dot') };
    }
  }
  d.achter.apk = get(r.achterkant, 'apk');
  d.achter.aandachtspunten = get(r.achterkant, 'aandachtspunten');
  d.achter.notities = get(r.achterkant, 'notities');
  return orders.normalizeOrderData(d);
}

const FLUID_KEYS = orders.FLUIDS.map((f) => `${f.key}${f.label ? ` (${f.label})` : ' (vrije regel)'}`).join(', ');
const TIRE_KEYS = orders.TIRES.map((t) => `${t.key} = ${t.label.toLowerCase()}`).join(', ');

const PROMPT = `Je krijgt een of meer foto's van een handgeschreven papieren werkopdracht van een Nederlandse autogarage
(voorkant en eventueel achterkant). Lees alle handgeschreven tekst en geef die terug als JSON.

Opbouw van het formulier en waar elk vak hoort:
- "nummer": het rode gedrukte getal rechtsboven (alleen cijfers).
- "datum_invoer": de datum in het vak "Datum invoer" (rechterhelft, linkerkolom, tweede regel onder Monteur).
  Dit is de datum van de werkopdracht zelf – NIET de datum van vandaag. Altijd invullen als er iets staat.
- "kop" (rechterhelft, bovenaan): Monteur, Datum gereed, Klantnr., Kenteken, Merk/Type,
  Km-stand (werkelijk) (in) -> km_in, Km-stand (teller) (uit) -> km_uit, Datum deel I -> datum_deel1,
  A.p.k.-datum -> apk_datum; Naam, Adres, Plaats, Tel. privé, Tel. zaak,
  "Alle noodzakelijke reparaties uitvoeren Ja/Nee" -> alle_reparaties ("ja" of "nee" als omcirkeld/aangestreept, anders ""),
  "Kontakt opnemen bij extra rep.kosten boven €" -> contact_boven, Chassisnummer, Alarmcode.
- "werk" (rechterhelft, "Omschrijving werkzaamheden"): kolom ✓ -> check, omschrijving -> omschrijving, Code -> code,
  Tijd -> tijd (bij meerdere regels: per regel gescheiden door \\n, zodat de regels gelijk lopen met de omschrijving).
  "Servicebeurt ... km" -> servicebeurt_km. Onderaan: Berekend op faktuurnr. -> faktuurnr, Totaal gewerkte uren,
  Tarief, Bedrag.
- "onderdelen" (linkerhelft, 22 genummerde regels Onderdeelnummer / Omschrijving / Aantal / Prijs p.eenh.):
  ALLEEN de ingevulde regels, elk met "regel" = het gedrukte regelnummer (1 t/m 22).
- "vloeistoffen" (linksonder, Liter / Omschrijving / Prijs p.eenh.): alleen ingevulde regels, "soort" is een van:
  ${FLUID_KEYS}. Bij Motorolie staat de viscositeit als "5 w 20": info = "5", info2 = "20". Anders extra tekst in info.
- "diversen" (linksonder): alleen ingevulde of aangekruiste regels. "veld" is een van: servicewagen of leenauto
  (tekst = km), werk_derden, apk / afmeldkosten / uitlijnen / balanceren (alleen opnemen als het hokje is aangekruist),
  testapparatuur, kleinmateriaal, milieutoeslag, extra (de lege vrije regel). Prijs uit de kolom Prijs p.eenh.
- "banden" (achterkant, bandenprofiel): alleen ingevulde banden, "band" is een van: ${TIRE_KEYS}; profiel in mm, maat, merk, DOT.
- "achterkant": A.p.k./afkeurpunten -> apk, aandachtspunten, en al het overige van de achterkant -> notities.

Regels:
- Neem de tekst letterlijk over zoals geschreven: zelfde woorden, geen samenvatting en geen spelling verbeteren
  ("Distrubutie" blijft "Distrubutie").
- Behoud de regelindeling van de werkzaamheden: elke geschreven regel is een regel (\\n). Een nieuw punt begint met "- ",
  een vervolgregel van hetzelfde punt begint met twee spaties. Laat een lege regel staan waar op papier een regel is overgeslagen.
- Datums als YYYY-MM-DD. Op papier staat vaak "28-9-26": dat is 2026-09-28. Onvolledige datum -> "".
- Bedragen zoals geschreven, met komma (bijv. "338,90"). Aantal zoals geschreven (bijv. "1X", "4,5L").
- Kenteken in hoofdletters met streepjes zoals geschreven (bijv. "43-XTT-9").
- Leeg of niet op de foto: "" (of de regel weglaten bij lijsten). Verzin niets.
- Twijfel je over een waarde (slecht leesbaar, cijfer kan ook iets anders zijn), vul je beste lezing in en noem het kort
  in "onzeker", bijv. "Km-stand in: 121665 of 121565?". Is de foto onscherp of niet van een werkopdracht, zeg dat in "onzeker".`;

/** Reserve als de API het schema toch weigert: dezelfde structuur, maar als instructie in de tekst. */
const PROMPT_PLAIN_JSON = PROMPT + `

Antwoord met uitsluitend één JSON-object (geen uitleg, geen markdown) dat precies voldoet aan dit JSON-schema:
${JSON.stringify(RESULT_SCHEMA)}`;

/** JSON uit een antwoord halen, ook als er toch tekst of \`\`\`json omheen staat. */
function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
    throw new Error('geen JSON');
  }
}

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

function apiError(err, kind = 'foto') {
  const excel = kind === 'excel';
  const status = err && err.status;
  if (status === 401 || status === 403) return new ImportError('De API-sleutel voor het uitlezen is ongeldig. Controleer anthropic-api-key in config.properties.');
  if (status === 429) return new ImportError('Te veel verzoeken of tegoed op. Probeer het over een minuut opnieuw.');
  if (status === 413) return new ImportError(excel ? 'Het bestand is te groot om te laten beoordelen. Importeer zonder Claude.' : 'De foto\'s zijn samen te groot. Probeer minder foto\'s tegelijk.');
  if (status === 400) {
    console.error(excel ? 'Excel-import' : 'Foto-import', ': API weigerde het verzoek:', err.message);
    const credit = /credit|balance|billing/i.test(err.message || '');
    return new ImportError(credit
      ? 'Het tegoed voor het uitlezen is op. Vul het tegoed aan in de Anthropic Console.'
      : (excel ? 'Het bestand kon niet worden beoordeeld' : 'De foto kon niet worden verwerkt') + '. Probeer het opnieuw; blijft dit gebeuren, meld het dan aan de beheerder (details staan in de console).');
  }
  if (status >= 500) return new ImportError('De uitleesdienst is tijdelijk niet beschikbaar. Probeer het later opnieuw.');
  return new ImportError('Geen verbinding met de uitleesdienst (is er internet?). ' + (err && err.message ? `(${err.message})` : ''));
}

/** Verbruik van een (gelukte, dus betaalde) aanroep. */
function usageOf(response) {
  return {
    model: response.model || MODEL,
    input: (response.usage?.input_tokens || 0) + (response.usage?.cache_read_input_tokens || 0) + (response.usage?.cache_creation_input_tokens || 0),
    output: response.usage?.output_tokens || 0,
  };
}

async function readWithClaude(images, effortKey = 'hoog') {
  const effort = ai.LEVELS[ai.level(effortKey, 'hoog')].effort;
  const client = clientFactory();
  const request = (structured) => client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    // Bij een (onterechte) weigering van het model automatisch een ander model laten proberen.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: structured
      ? { effort, format: { type: 'json_schema', schema: RESULT_SCHEMA } }
      : { effort }, // gekozen inspanning (handschrift lezen: standaard grondig)
    messages: [{
      role: 'user',
      content: [
        ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } })),
        { type: 'text', text: structured ? PROMPT : PROMPT_PLAIN_JSON },
      ],
    }],
  });
  let response;
  try {
    response = await request(true);
  } catch (err) {
    // Schema geweigerd (wordt niet in rekening gebracht): opnieuw zonder schema, met JSON-instructie.
    if (err && err.status === 400 && /grammar|schema|output_config|format/i.test(err.message || '')) {
      console.error('Foto-import: schema geweigerd, opnieuw zonder schema:', err.message);
      try {
        response = await request(false);
      } catch (err2) {
        throw apiError(err2);
      }
    } else {
      throw apiError(err);
    }
  }
  // Vanaf hier is de aanroep gelukt en dus betaald: verbruik altijd doorgeven, ook bij een fout.
  const used = usageOf(response);
  const billedError = (msg) => Object.assign(new ImportError(msg), { usage: used });
  if (response.stop_reason === 'refusal') throw billedError('De foto kon niet worden uitgelezen. Probeer een andere foto.');
  if (response.stop_reason === 'max_tokens') throw billedError('Het uitlezen werd afgebroken (te veel tekst). Probeer minder foto\'s tegelijk.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try {
    parsed = extractJson(text);
  } catch {
    throw billedError('Het resultaat kon niet worden gelezen. Probeer het opnieuw.');
  }
  const nummer = String(parsed.nummer || '').replace(/\D/g, '');
  const data = toWorkOrder(parsed);
  const rawDatum = String(parsed.datum_invoer || '').trim();
  let datum = orders.parseDate(rawDatum);
  let datumBron = datum ? 'invoer' : '';
  const onzeker = Array.isArray(parsed.onzeker) ? parsed.onzeker.map(String).slice(0, 30) : [];
  const fmt = (iso) => iso.split('-').reverse().join('-');
  if (!datum && data.datum_gereed) {
    // Datum invoer leeg of onduidelijk: Datum gereed gebruiken (staat er vaak wel).
    datum = data.datum_gereed;
    datumBron = 'gereed';
    onzeker.unshift(rawDatum
      ? `Datum invoer was onduidelijk ("${rawDatum}"), daarom is Datum gereed (${fmt(datum)}) gebruikt – controleer dit.`
      : `Datum invoer stond niet op het formulier, daarom is Datum gereed (${fmt(datum)}) gebruikt – controleer dit.`);
  } else if (!datum) {
    onzeker.unshift(rawDatum
      ? `Datum invoer gelezen als "${rawDatum}", maar dat is geen geldige datum (en Datum gereed is ook leeg) – vul de datum van de papieren werkopdracht in.`
      : 'Datum invoer en Datum gereed konden niet worden gelezen – vul de datum van de papieren werkopdracht in.');
  }
  return {
    usage: used,
    nummer,
    datum_invoer: datum,
    datum_bron: datumBron, // 'invoer', 'gereed' of '' (niet gevonden)
    onzeker,
    data,
  };
}

/**
 * Een betaalde aanroep met daglimiet en verbruikslog. fn() geeft { usage, ... } terug, of gooit een fout
 * met .usage als de aanroep wel is betaald. Wordt ook door de Excel-import gebruikt.
 */
async function metered(userId, fn, { kind = 'foto', effort = '', limited = true } = {}) {
  // Daglimiet: eerst een plek reserveren (zo kunnen twee gelijktijdige imports de limiet niet omzeilen).
  const limit = limited ? dailyLimit() : 0;
  const today = orders.todayISO();
  let logId;
  db.exec('BEGIN IMMEDIATE');
  try {
    const n = db.prepare(`SELECT COUNT(*) AS n FROM import_log WHERE day = ? AND ${LIMITED}`).get(today).n;
    if (limit > 0 && n >= limit) {
      db.exec('ROLLBACK');
      throw new ImportError(`De daglimiet van ${limit} imports is bereikt. Morgen kan het weer, of vraag de beheerder de limiet (import-limit-per-day) te verhogen.`);
    }
    logId = Number(db.prepare("INSERT INTO import_log (user_id, day, status, kind, effort) VALUES (?, ?, 'bezig', ?, ?)").run(userId, today, kind, effort).lastInsertRowid);
    db.exec('COMMIT');
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  }
  let result;
  try {
    result = await fn();
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
  result.usage.eur = ai.eur(ai.usdOf(result.usage.model, result.usage.input, result.usage.output));
  return result;
}

/** Foto's uitlezen en als concept opslaan. Geeft het concept-id terug. */
async function createDraft(imageUrls, userId, effortKey = 'hoog') {
  if (!isConfigured()) throw new ImportError('Foto-import is niet ingesteld: vul anthropic-api-key in config.properties in.');
  const images = parseImages(imageUrls);
  const effort = ai.level(effortKey, 'hoog');
  const result = await metered(userId, () => readWithClaude(images, effort), { kind: 'foto', effort });
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
  MODEL, metered, usageOf, apiError, getClient: () => clientFactory(),
  isConfigured, createDraft, usage, dailyLimit, toWorkOrder, getDraft, deleteDraft, setClientFactory, ImportError, RESULT_SCHEMA, MAX_IMAGES,
};
