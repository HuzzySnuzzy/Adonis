'use strict';
/**
 * Excel-import voor bandenhotel en voorraad, met Claude als meekijker.
 *
 * 1. Het bestand wordt ingelezen (alle bladen).
 * 2. Een eerste indeling wordt gemaakt op basis van de kolomkoppen (werkt ook zonder API-sleutel).
 * 3. Claude bekijkt de bladen: wat is elk blad, welke kolom hoort bij welk veld, welke schrijfwijzen
 *    moeten worden samengevoegd ("Blauwe Container" = "Blauwe container"), hoe lees je een profiel als
 *    "Voor 5,3 achter 48", en welke rijen moet een mens even bekijken.
 * 4. De gebruiker controleert en past alles aan op de controlepagina, en bevestigt pas daarna.
 */
const { db } = require('./db');
const inv = require('./inventory');
const importer = require('./import');
const ai = require('./ai');
const { readXlsx, readCsv } = require('./xlsx');

const MAX_ROWS = 10000;
const MAX_FILE = 15 * 1024 * 1024;

db.exec(`
CREATE TABLE IF NOT EXISTS sheet_drafts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  filename   TEXT NOT NULL DEFAULT '',
  sheets     TEXT NOT NULL,   -- JSON: ingelezen bladen
  plan       TEXT NOT NULL,   -- JSON: indeling (aanpasbaar op de controlepagina)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
function cleanupDrafts() {
  db.prepare("DELETE FROM sheet_drafts WHERE created_at < datetime('now', '-3 days')").run();
}
setInterval(cleanupDrafts, 6 * 60 * 60 * 1000).unref();
cleanupDrafts();

class SheetImportError extends Error {}

/* ---------- doelen en velden ---------- */
const TYRE_FIELDS = {
  label: 'Label / Key ID', klant_naam: 'Klant (naam)', kenteken: 'Kenteken', telefoon: 'Telefoon', auto: 'Auto (merk/type)',
  seizoen: 'Seizoen', maat: 'Bandenmaat', merk: 'Merk banden', aantal: 'Aantal banden', velg: 'Velgen',
  profiel: 'Profiel (vrije tekst, wordt uitgelezen)', profiel_voor: 'Profiel voor (mm)', profiel_achter: 'Profiel achter (mm)',
  dot: 'DOT-nummer', locatie: 'Opslaglocatie', opmerkingen: 'Opmerkingen', datum_in: 'Datum ingeslagen', status: 'Status (opgeslagen/uitgegeven)',
  foto: 'Foto (bestandsnaam)',
};
const TARGETS = {
  bandenhotel: { label: 'Bandenhotel – klantenbanden (klanten worden toegevoegd aan Klanten)', fields: TYRE_FIELDS },
  bandenopslag: { label: 'Overige bandenopslag (noodbanden, gemengd)', fields: TYRE_FIELDS },
  onderdelen: {
    label: 'Voorraad onderdelen',
    fields: {
      aantal: 'Aantal', beschikbaar: 'Beschikbaar (ja/nee)', merk: 'Merk', nummer: 'Artikelnummer', oe_nummer: 'Origineel (OE) nummer',
      type: 'Soort onderdeel', omschrijving: 'Omschrijving / opmerking', locatie: 'Locatie', prijs: 'Prijs', datum: 'Datum',
      foto: 'Foto (bestandsnaam)',
    },
  },
  banden: {
    label: 'Voorraad banden (op de zaak, te koop)',
    fields: {
      aantal: 'Aantal', beschikbaar: 'Beschikbaar (ja/nee)', merk: 'Merk', type: 'Bandtype / model', maat: 'Bandenmaat',
      profiel: 'Profiel (mm of "nieuw")', snelheid: 'Last-/snelheidsindex', seizoen: 'Seizoen', locatie: 'Locatie',
      omschrijving: 'Opmerking', prijs: 'Prijs', datum: 'Datum binnen', foto: 'Foto (bestandsnaam)',
    },
  },
};
/** Bandenhotel en overige opslag gebruiken dezelfde velden en tabel (tyre_storage). */
const isTyre = (doel) => doel === 'bandenhotel' || doel === 'bandenopslag';
const DOELEN = { ...Object.fromEntries(Object.entries(TARGETS).map(([k, t]) => [k, t.label])), overslaan: 'Niet importeren' };
const SPECIAL = { extra: 'Bewaren bij "overige gegevens"', overslaan: 'Overslaan' };
const ALL_FIELDS = [...new Set(Object.values(TARGETS).flatMap((t) => Object.keys(t.fields)))];
/** Velden waarvan de schrijfwijzen worden gelijkgetrokken (keuzelijsten en filters). */
const VALUE_FIELDS = ['seizoen', 'locatie', 'type', 'merk', 'velg', 'status'];

/* ---------- bestand inlezen ---------- */
function colLetter(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
/** Celwaarde als tekst zoals een Nederlander hem zou typen. */
function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'ja' : 'nee';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6).replace('.', ',');
  return String(v).replace(/\s+/g, ' ').trim();
}

/** Bladen -> { name, headerRow, columns: [{ i, letter, header }], rows: [{ n (Excel-rijnummer), cells: [] }] } */
function structure(rawSheets) {
  const out = [];
  for (const sh of rawSheets) {
    const rows = sh.rows;
    // Kopregel: de eerste rij met minstens twee teksten (binnen de eerste 15 rijen).
    let h = rows.findIndex((r, i) => i < 15 && r.filter((v) => typeof v === 'string' && v.trim()).length >= 2);
    if (h < 0) h = rows.findIndex((r) => r.some((v) => v !== null && v !== undefined));
    if (h < 0) continue;
    const data = [];
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      if (r.some((v) => v !== null && v !== undefined && cellText(v) !== '')) data.push({ n: i + 1, cells: r });
    }
    if (data.length > MAX_ROWS) throw new SheetImportError(`Blad "${sh.name}" heeft meer dan ${MAX_ROWS} rijen. Splits het bestand op.`);
    // Alleen kolommen waar onder de kop ook iets in staat.
    const width = Math.max(rows[h].length, ...data.map((d) => d.cells.length), 0);
    const columns = [];
    for (let c = 0; c < width; c++) {
      const filled = data.filter((d) => cellText(d.cells[c]) !== '').length;
      if (!filled) continue;
      columns.push({ i: c, letter: colLetter(c), header: cellText(rows[h][c]) || `Kolom ${colLetter(c)}`, filled });
    }
    out.push({ name: sh.name, headerRow: h + 1, columns, rows: data.map((d) => ({ n: d.n, cells: columns.map((col) => d.cells[col.i] ?? null) })) });
  }
  return out;
}

function readFile(buffer, filename) {
  if (!buffer || !buffer.length) throw new SheetImportError('Geen bestand ontvangen.');
  if (buffer.length > MAX_FILE) throw new SheetImportError('Het bestand is te groot (max. 15 MB).');
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  let raw;
  if (isZip) {
    try { raw = readXlsx(buffer); } catch (err) { throw new SheetImportError(err.message); }
  } else if (/\.(csv|txt)$/i.test(filename || '')) {
    raw = readCsv(buffer.toString('utf8').replace(/^﻿/, ''));
  } else if (buffer[0] === 0xd0 && buffer[1] === 0xcf) {
    throw new SheetImportError('Dit is een oud Excel-bestand (.xls). Open het in Excel en kies Opslaan als → Excel-werkmap (.xlsx).');
  } else {
    throw new SheetImportError('Kies een Excel-bestand (.xlsx) of een CSV-bestand.');
  }
  const sheets = structure(raw).filter((s) => s.rows.length && s.columns.length);
  if (!sheets.length) throw new SheetImportError('Er staan geen gegevens in dit bestand.');
  return sheets;
}

/* ---------- eerste indeling op basis van de koppen ---------- */
const SYNONYMS = [
  ['label', /^(key\s*-?\s*id|label|sticker|labelnr|labelnummer|code|uuid|id)$/],
  ['kenteken', /kenteken|^kent\.?$|plate/],
  ['auto', /^auto|voertuig|merk\s*\/\s*type|^wagen/],
  ['klant_naam', /klant|^naam|eigenaar/],
  ['telefoon', /^tel|telefoon|mobiel|gsm/],
  ['seizoen', /seizoen|season|^s$/],
  ['maat', /maat|afmeting|size/],
  ['profiel', /profiel|^mm$|tread/],
  ['dot', /\bdot\b/],
  ['snelheid', /snelheid|index|li\s*\/\s*si/],
  ['aantal', /aantal|stuks|^qty$|^#$/],
  ['beschikbaar', /beschikbaar|voorradig|op voorraad/],
  ['oe_nummer', /orig|org[ie]?ne?le|^oe\b|oem/],
  ['nummer', /^(nummer|nr\.?|nmr|artikel(nummer|nr)?|art\.?\s*nr\.?|onderdeelnummer)$/],
  ['locatie', /locatie|opslag|^rek|positie|plek/],
  ['opmerkingen', /opmerking|notitie|^info|bijzonderheden/],
  ['omschrijving', /omschrijving/],
  ['prijs', /prijs|price|€/],
  ['datum', /datum|date/],
  ['type', /^type$|soort|categorie/],
  ['merk', /^merk$|brand/],
  ['velg', /velg/],
  ['foto', /foto|afbeelding|image|photo|plaatje/],
  ['status', /^status$/],
];
function guessField(header, doel) {
  const h = header.toLowerCase().trim();
  const fields = TARGETS[doel].fields;
  for (const [f, re] of SYNONYMS) {
    if (!re.test(h)) continue;
    let field = f;
    if (isTyre(doel)) {
      if (f === 'merk') field = 'auto'; // in een bandenhotellijst is "Merk" meestal het merk van de auto
      if (f === 'datum') field = 'datum_in';
      if (f === 'omschrijving') field = 'opmerkingen';
      if (f === 'type') field = 'auto';
    } else {
      if (f === 'opmerkingen') field = 'omschrijving';
      if (doel === 'banden' && f === 'nummer') field = 'type';
    }
    if (fields[field]) return field;
  }
  return 'extra';
}
function guessDoel(sheet) {
  const heads = sheet.columns.map((c) => c.header.toLowerCase()).join(' | ');
  const name = sheet.name.toLowerCase();
  if (/kenteken|klant/.test(heads)) return 'bandenhotel';
  if (/band/.test(name) || (/maat/.test(heads) && /snelheid|seizoen|\bmm\b|profiel/.test(heads))) return 'banden';
  if (/nummer|nmr|type|artikel|onderdeel/.test(heads)) return 'onderdelen';
  return 'overslaan';
}

/** Ruwe waarde van een veld in een rij (meerdere kolommen voor hetzelfde veld worden samengevoegd). */
function rawFields(sheet, plan, row) {
  const out = {};
  const extra = {};
  sheet.columns.forEach((col, ci) => {
    const f = plan.kolommen[ci] || 'extra';
    const v = row.cells[ci];
    if (f === 'overslaan' || v === null || v === undefined) return;
    if (f === 'extra' || f === 'foto') {
      const t = cellText(v);
      if (t && !/nophoto/i.test(t)) extra[f === 'foto' ? 'Foto' : col.header] = t;
      return;
    }
    if (out[f] === undefined) out[f] = v;
    else out[f] = [cellText(out[f]), cellText(v)].filter(Boolean).join(f === 'opmerkingen' || f === 'omschrijving' ? '; ' : ' ');
  });
  return { values: out, extra };
}

function distinctValues(sheet, plan, field) {
  const counts = new Map();
  for (const row of sheet.rows) {
    const t = cellText(rawFields(sheet, plan, row).values[field]);
    if (t) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return counts;
}

/** Schrijfwijzen gelijktrekken: hoofdletters/spaties, en seizoen in vaste woorden. */
function heuristicValueMaps(sheet, plan) {
  const maps = {};
  const used = new Set(Object.values(plan.kolommen));
  for (const field of VALUE_FIELDS) {
    if (!used.has(field)) continue;
    const counts = distinctValues(sheet, plan, field);
    const map = {};
    const byKey = new Map();
    for (const [v, n] of counts) {
      const key = v.toLowerCase().replace(/\s+/g, ' ');
      const best = byKey.get(key);
      if (!best || n > counts.get(best)) byKey.set(key, v);
    }
    for (const v of counts.keys()) {
      let to = byKey.get(v.toLowerCase().replace(/\s+/g, ' '));
      if (field === 'seizoen') to = inv.normalizeSeason(to);
      if (field === 'status') to = /uit|weg|terug|opgehaald|mee/i.test(v) ? 'uitgegeven' : 'opgeslagen';
      if (to !== v) map[v] = to;
    }
    maps[field] = map;
  }
  return maps;
}

/**
 * Profiel uit vrije tekst: "Voor 5,3 achter 48" -> voor 5,3 / achter 4,8 (48 is vrijwel zeker 4,8 mm).
 * "zeker" = false als een mens moet kijken (bijv. "3,2 > 5mm": wat is voor en wat achter?).
 * Bij twijfel of extra informatie blijft de oorspronkelijke tekst bewaard in "tekst".
 */
const QUALITY = /^(nieuw|new|goed|zeer|slecht|matig|kaal|als|bijna|redelijk|prima|oud|op|versleten|alle|keer|x|en)$/;
function parseProfiel(raw) {
  const s = cellText(raw);
  if (!s) return { voor: '', achter: '', tekst: '', zeker: true };
  let fixed = false;
  const num = (x) => {
    let n = Number(String(x).replace(',', '.'));
    if (Number.isInteger(n) && n >= 13 && n <= 99) { n /= 10; fixed = true; }
    return n;
  };
  const fmt = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
  const N = '(\\d+(?:[.,]\\d+)?)';
  // "4x", "4*keer", "2 goed 2 kaal": aantallen, geen profieldiepte
  const body = s.replace(/\b\d\s*(?:x|\*\s*keer|keer)\b/gi, ' ').replace(/\b\d\s+(?=goed|slecht|kaal|matig)/gi, ' ');
  const nums = [...body.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0]);
  const words = body.toLowerCase().replace(/\d+(?:[.,]\d+)?/g, ' ').replace(/mm|[~+\-–>|&/:,*().]/g, ' ').split(/\s+/).filter(Boolean);
  const other = words.filter((w) => w !== 'voor' && w !== 'achter');
  const onlyQuality = other.every((w) => QUALITY.test(w));
  // "voor 5" gaat voor "5 voor" (anders leest "Voor 2,2 Achter 1,5" de 2,2 als achter).
  // Behalve als de tekst begint met "6,5 voor 2,3 achter" (getal eerst).
  const suffix = new RegExp(`^\\s*${N}\\s*(?:mm)?\\s*voor`, 'i').test(body);
  const pre = (word) => new RegExp(`${word}\\s*:?\\s*${N}`, 'i').exec(body);
  const post = (word) => new RegExp(`${N}\\s*(?:mm)?\\s*${word}`, 'i').exec(body);
  const find = (word) => ((suffix ? post(word) || pre(word) : pre(word) || post(word)) || [])[1];
  const v = find('voor');
  const a = find('achter');
  if (a && (v || nums.length === 2)) {
    const voor = num(v || nums[0]);
    const achter = num(a);
    const plain = !other.length && !fixed;
    return { voor: fmt(voor), achter: fmt(achter), tekst: plain ? '' : s, zeker: !fixed && onlyQuality };
  }
  if (nums.length === 1) {
    const n = num(nums[0]);
    return { voor: fmt(n), achter: fmt(n), tekst: !other.length && !/[~>]|\+-/.test(s) && !fixed ? '' : s, zeker: !fixed && onlyQuality };
  }
  if (!nums.length) {
    const nieuw = /^(nieuw|new)$/i.test(s.trim());
    return { voor: '', achter: '', tekst: nieuw ? 'Nieuw' : s, zeker: onlyQuality };
  }
  if (nums.length === 2) {
    // Twee getallen zonder voor/achter: waarschijnlijk voor en achter, maar het kan ook een bereik zijn.
    return { voor: fmt(num(nums[0])), achter: fmt(num(nums[1])), tekst: s, zeker: false };
  }
  return { voor: '', achter: '', tekst: s, zeker: false };
}
function heuristicProfielen(sheet, plan) {
  if (!Object.values(plan.kolommen).includes('profiel') || !isTyre(plan.doel)) return {};
  const out = {};
  for (const v of distinctValues(sheet, plan, 'profiel').keys()) {
    const p = parseProfiel(v);
    out[v] = { voor: p.voor, achter: p.achter, tekst: p.tekst, zeker: p.zeker };
  }
  return out;
}

function heuristicSheetPlan(sheet, doel = guessDoel(sheet)) {
  const plan = { doel, reden: '', kolommen: {}, waarden: {}, profielen: {}, rijen: {}, opmerkingen: [], gekozen: null };
  if (doel !== 'overslaan') {
    const taken = new Set();
    sheet.columns.forEach((col, ci) => {
      let f = guessField(col.header, doel);
      // Hetzelfde veld twee keer is meestal fout (bijv. twee "datum"-kolommen): de tweede naar overige gegevens.
      if (f !== 'extra' && taken.has(f) && !['opmerkingen', 'omschrijving'].includes(f)) f = 'extra';
      taken.add(f);
      plan.kolommen[ci] = f;
    });
  }
  refreshDerived(sheet, plan);
  return plan;
}
/** Na een andere kolomindeling: waardenlijsten en profielen opnieuw opbouwen (eerdere keuzes blijven staan). */
function refreshDerived(sheet, plan, keep = {}) {
  const maps = heuristicValueMaps(sheet, plan);
  for (const [field, map] of Object.entries(maps)) {
    const counts = distinctValues(sheet, plan, field);
    const old = (keep.waarden || {})[field] || {};
    for (const v of counts.keys()) if (Object.hasOwn(old, v)) map[v] = old[v];
    maps[field] = map;
  }
  plan.waarden = maps;
  const prof = heuristicProfielen(sheet, plan);
  for (const k of Object.keys(prof)) if (keep.profielen && keep.profielen[k]) prof[k] = keep.profielen[k];
  plan.profielen = prof;
}

/* ---------- Claude laten meekijken ---------- */
const sstr = { type: 'string' };
const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['samenvatting', 'bladen'],
  properties: {
    samenvatting: sstr,
    bladen: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['blad', 'doel', 'reden', 'kolommen', 'waarden', 'profielen', 'rijen', 'opmerkingen'],
        properties: {
          blad: sstr,
          doel: { type: 'string', enum: Object.keys(DOELEN) },
          reden: sstr,
          kolommen: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false, required: ['kolom', 'veld'],
              properties: { kolom: sstr, veld: { type: 'string', enum: [...ALL_FIELDS, 'extra', 'overslaan'] } },
            },
          },
          waarden: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false, required: ['veld', 'van', 'naar'],
              properties: { veld: { type: 'string', enum: VALUE_FIELDS }, van: sstr, naar: sstr },
            },
          },
          profielen: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false, required: ['van', 'voor', 'achter', 'tekst'],
              properties: { van: sstr, voor: sstr, achter: sstr, tekst: sstr },
            },
          },
          rijen: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false, required: ['rij', 'advies', 'reden'],
              properties: { rij: { type: 'integer' }, advies: { type: 'string', enum: ['controleren', 'overslaan'] }, reden: sstr },
            },
          },
          opmerkingen: { type: 'array', items: sstr },
        },
      },
    },
  },
};

function fieldList() {
  return Object.entries(TARGETS).map(([k, t]) =>
    `- ${k} (${t.label}): ${Object.entries(t.fields).map(([f, l]) => `${f} = ${l}`).join('; ')}`).join('\n');
}

const MAX_PROMPT_CHARS = 160000;
/** Bladen als tekst voor Claude: koppen, alle rijen (of een flinke steekproef bij hele grote bestanden). */
function describeSheets(sheets) {
  const parts = [];
  const totalRows = sheets.reduce((n, s) => n + s.rows.length, 0);
  let budget = MAX_PROMPT_CHARS;
  for (const s of sheets) {
    const head = `### Blad "${s.name}" (kopregel op rij ${s.headerRow}, ${s.rows.length} rijen met gegevens)\nKolommen: ${s.columns.map((c) => `${c.letter} = "${c.header}"`).join(', ')}\n`;
    const share = Math.floor((MAX_PROMPT_CHARS * s.rows.length) / Math.max(1, totalRows));
    const lines = [];
    let used = 0;
    let shown = 0;
    for (const r of s.rows) {
      const line = `r${r.n}: ` + s.columns.map((c, ci) => {
        const t = cellText(r.cells[ci]);
        return t ? `${c.letter}=${t.slice(0, 80)}` : '';
      }).filter(Boolean).join(' | ');
      if (used + line.length > share) break;
      lines.push(line);
      used += line.length + 1;
      shown++;
    }
    let tail = '';
    if (shown < s.rows.length) {
      // Niet alles past: per kolom de voorkomende waarden erbij, zodat schrijfwijzen toch compleet zijn.
      tail = `(Alleen de eerste ${shown} rijen getoond. Voorkomende waarden per kolom:)\n` + s.columns.map((c, ci) => {
        const counts = new Map();
        for (const r of s.rows) { const t = cellText(r.cells[ci]); if (t) counts.set(t, (counts.get(t) || 0) + 1); }
        if (counts.size > 150) return `${c.letter}: ${counts.size} verschillende waarden`;
        return `${c.letter}: ` + [...counts].map(([v, n]) => `${v.slice(0, 60)} (${n}×)`).join('; ');
      }).join('\n') + '\n';
    }
    const block = head + lines.join('\n') + '\n' + tail;
    parts.push(block.slice(0, Math.max(2000, budget)));
    budget -= block.length;
  }
  return parts.join('\n');
}

function buildPrompt(sheets, filename) {
  return `Je helpt een Nederlandse autogarage hun Excel-lijsten over te zetten naar hun garageprogramma (ADONIS).
Bestand: "${filename}". Er zijn drie mogelijke bestemmingen per blad, met deze velden:
${fieldList()}
Daarnaast kan elke kolom naar "extra" (bewaren als overige gegevens bij het record, met de kolomkop als naam) of "overslaan".

Bekijk elk blad en geef per blad terug:
- "blad": de naam van het blad, precies zoals hieronder.
- "doel": bandenhotel (het echte bandenhotel: sets VAN VASTE KLANTEN die de garage voor ze opslaat, één set per klant/kenteken;
  de klanten worden daarbij aan het klantenbestand toegevoegd), bandenopslag (overige opgeslagen banden: een gemengde lijst
  met noodbanden, oude klantbanden en losse sets, niet duidelijk van één klant), onderdelen (onderdelen op voorraad),
  banden (nieuwe/losse banden op voorraad om te verkopen, meestal met aantal en merk/type) of overslaan
  (geen bruikbare gegevens, of dubbel met een ander blad – leg dat dan uit). Twijfel je tussen bandenhotel en bandenopslag,
  zeg dat dan in "reden"; de gebruiker kiest.
- "reden": in één zin waarom (Nederlands, voor de gebruiker).
- "kolommen": voor ELKE kolom (letter) het veld. Kijk naar de inhoud, niet alleen naar de kop: in een bandenhotellijst
  is "Merk" vaak het merk van de auto (veld auto) en niet van de band. Gebruik voor het bandenhotel bij een vrije-tekstkolom
  met profieldiepte het veld "profiel". Kolommen met fotobestanden/-paden naar "foto" (de foto's kunnen daarna worden gekoppeld); QR-codes e.d. naar "extra". Onbekende betekenis: "extra".
- "waarden": schrijfwijzen gelijktrekken voor de velden ${VALUE_FIELDS.join(', ')}: alleen waarden die moeten veranderen,
  met "van" precies zoals in de lijst. Voeg hoofdlettervarianten en duidelijke synoniemen samen ("Blauwe Container" en
  "Blauwe container"; "ZOMER" -> "Zomer"; "All" -> "All season"). Seizoen als "Zomer", "Winter" of "All season"; laat
  gemengde sets (bijv. "1x zomer 3x winter") staan zoals ze zijn. Status als "opgeslagen" of "uitgegeven".
  Twijfel je of twee waarden hetzelfde betekenen (bijv. "Buiten" en "Buiten op pallet"), voeg ze dan NIET samen maar noem het in opmerkingen.
- "profielen" (alleen bij bandenhotel/bandenopslag met een profielkolom): voor ELKE voorkomende profielwaarde: "voor" en "achter" in mm
  met komma (bijv. "5,3"), of "" als het niet te zeggen is, en "tekst" = wat de lezer extra moet weten (leeg als voor/achter
  alles zegt; anders de oorspronkelijke tekst of een korte uitleg). Eén getal geldt voor alle banden (voor = achter).
  Een getal als "48" bij profiel is vrijwel zeker 4,8 mm. Bij iets als "3,2 > 5mm" weet je niet zeker wat voor/achter is:
  vul je beste lezing in en zet de oorspronkelijke tekst in "tekst".
- "rijen": rijen die een mens moet bekijken (Excel-rijnummer zoals "r12" -> 12) met "advies": "overslaan" voor rijen die geen
  echte gegevensrij zijn (tussenkop, totaal, leeg op wat rommel na, dubbel) en "controleren" voor bijvoorbeeld een waarde
  in de verkeerde kolom, een onmogelijk kenteken of tegenstrijdige gegevens. Geef een korte reden. Niet elke kleinigheid;
  maximaal 80 rijen per blad.
- "opmerkingen": korte opmerkingen voor de gebruiker over dit blad (bijv. wat "EX" voor een klantnaam lijkt te betekenen,
  of welke kolom onduidelijk is). Maximaal 6.
En "samenvatting": in twee of drie zinnen wat er in het bestand staat en hoe het wordt geïmporteerd.

Verzin geen gegevens. De gebruiker controleert alles voordat er iets wordt opgeslagen.

${describeSheets(sheets)}`;
}

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

async function askClaude(sheets, filename, effortKey = 'hoog') {
  const effort = ai.LEVELS[ai.level(effortKey, 'hoog')].effort;
  const client = importer.getClient();
  const prompt = buildPrompt(sheets, filename);
  const request = (structured) => client.beta.messages.create({
    model: importer.MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: structured
      ? { effort, format: { type: 'json_schema', schema: ANALYSIS_SCHEMA } }
      : { effort },
    messages: [{
      role: 'user',
      content: structured ? prompt
        : prompt + `\n\nAntwoord met uitsluitend één JSON-object (geen uitleg, geen markdown) volgens dit JSON-schema:\n${JSON.stringify(ANALYSIS_SCHEMA)}`,
    }],
  });
  let response;
  try {
    response = await request(true);
  } catch (err) {
    if (err && err.status === 400 && /grammar|schema|output_config|format/i.test(err.message || '')) {
      console.error('Excel-import: schema geweigerd, opnieuw zonder schema:', err.message);
      try { response = await request(false); } catch (err2) { throw importer.apiError(err2, 'excel'); }
    } else {
      throw importer.apiError(err, 'excel');
    }
  }
  const usage = importer.usageOf(response);
  const billed = (msg) => Object.assign(new SheetImportError(msg), { usage });
  if (response.stop_reason === 'refusal') throw billed('Claude kon dit bestand niet beoordelen. U kunt het zonder Claude importeren.');
  if (response.stop_reason === 'max_tokens') throw billed('Het bestand is te groot om in één keer te laten beoordelen. Importeer zonder Claude of splits het bestand.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return { usage, result: extractJson(text) };
  } catch {
    throw billed('Het antwoord van Claude kon niet worden gelezen. Probeer het opnieuw of importeer zonder Claude.');
  }
}

/** Claudes antwoord over de eerste indeling heen leggen (alleen geldige velden). */
function applyAnalysis(sheets, plans, analysis) {
  const byName = new Map((analysis.bladen || []).map((b) => [String(b.blad || '').trim(), b]));
  sheets.forEach((sheet, si) => {
    const a = byName.get(sheet.name.trim());
    if (!a || !DOELEN[a.doel]) return;
    const plan = a.doel === plans[si].doel ? plans[si] : heuristicSheetPlan(sheet, a.doel);
    plan.reden = String(a.reden || '').slice(0, 400);
    plan.door = 'claude';
    if (a.doel !== 'overslaan') {
      const fields = TARGETS[a.doel].fields;
      for (const k of a.kolommen || []) {
        const ci = sheet.columns.findIndex((c) => c.letter === String(k.kolom || '').trim().toUpperCase());
        if (ci < 0) continue;
        plan.kolommen[ci] = fields[k.veld] || k.veld === 'extra' || k.veld === 'overslaan' ? k.veld : 'extra';
      }
      refreshDerived(sheet, plan);
      for (const w of a.waarden || []) {
        const map = plan.waarden[w.veld];
        if (map && distinctValues(sheet, plan, w.veld).has(String(w.van))) map[String(w.van)] = String(w.naar).trim();
      }
      for (const p of a.profielen || []) {
        if (plan.profielen[p.van]) plan.profielen[p.van] = { voor: p.voor, achter: p.achter, tekst: String(p.tekst || '').trim(), zeker: !p.tekst, claude: true };
      }
      const rowNumbers = new Set(sheet.rows.map((r) => r.n));
      for (const r of (a.rijen || []).slice(0, 200)) {
        if (rowNumbers.has(r.rij)) plan.rijen[r.rij] = { advies: r.advies === 'overslaan' ? 'overslaan' : 'controleren', reden: String(r.reden || '').slice(0, 300) };
      }
    }
    plan.opmerkingen = (a.opmerkingen || []).map(String).slice(0, 10);
    plans[si] = plan;
  });
  return { samenvatting: String(analysis.samenvatting || '').slice(0, 1500), plans };
}

/* ---------- concept maken ---------- */
async function createDraft({ buffer, filename, userId, useClaude, effort = 'hoog' }) {
  const sheets = readFile(buffer, filename);
  let plans = sheets.map((s) => heuristicSheetPlan(s));
  let samenvatting = '';
  let claude = 'nee';
  let claudeFout = '';
  if (useClaude && importer.isConfigured()) {
    try {
      const lvl = ai.level(effort, 'hoog');
      const r = await importer.metered(userId, () => askClaude(sheets, filename, lvl), { kind: 'excel', effort: lvl });
      ({ samenvatting, plans } = applyAnalysis(sheets, plans, r.result));
      claude = 'ja';
    } catch (err) {
      // Claude niet bereikbaar of limiet bereikt: gewoon doorgaan met de indeling op basis van de koppen.
      if (!(err instanceof SheetImportError || err instanceof importer.ImportError)) console.error('Excel-import:', err);
      claudeFout = err.message || 'onbekende fout';
      claude = 'mislukt';
    }
  }
  const plan = { samenvatting, claude, claudeFout, sheets: plans };
  const res = db.prepare('INSERT INTO sheet_drafts (user_id, filename, sheets, plan) VALUES (?, ?, ?, ?)')
    .run(userId, String(filename || 'bestand').slice(0, 200), JSON.stringify(sheets), JSON.stringify(plan));
  return Number(res.lastInsertRowid);
}
function getDraft(id) {
  const row = db.prepare('SELECT * FROM sheet_drafts WHERE id = ?').get(id);
  if (!row) return null;
  return { id: row.id, userId: row.user_id, filename: row.filename, createdAt: row.created_at, sheets: JSON.parse(row.sheets), plan: JSON.parse(row.plan) };
}
function savePlan(id, plan) {
  db.prepare('UPDATE sheet_drafts SET plan = ? WHERE id = ?').run(JSON.stringify(plan), id);
}
function deleteDraft(id) {
  db.prepare('DELETE FROM sheet_drafts WHERE id = ?').run(id);
}

/* ---------- aanpassingen van de controlepagina verwerken ---------- */
function expandRanges(str) {
  const out = [];
  for (const part of String(str).split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Math.min(Number(m[2]), a + MAX_ROWS) : a;
    for (let i = a; i <= b; i++) out.push(i);
  }
  return out;
}
function updatePlanFromForm(draft, body) {
  const plan = draft.plan;
  const b = body.blad || {};
  draft.sheets.forEach((sheet, si) => {
    const f = b[si];
    if (!f) return;
    let p = plan.sheets[si];
    if (DOELEN[f.doel] && f.doel !== p.doel) {
      // Ander doel: kolommen opnieuw indelen; rijkeuzes vervallen.
      const old = p;
      p = heuristicSheetPlan(sheet, f.doel);
      p.opmerkingen = old.opmerkingen;
      p.rijen = old.rijen;
      plan.sheets[si] = p;
      return;
    }
    if (p.doel === 'overslaan') return;
    const fields = TARGETS[p.doel].fields;
    let changed = false;
    for (const [ci, v] of Object.entries(f.kolom || {})) {
      if (!(Number(ci) < sheet.columns.length)) continue;
      const val = fields[v] || SPECIAL[v] ? v : 'extra';
      if (p.kolommen[ci] !== val) { p.kolommen[ci] = val; changed = true; }
    }
    // Waarden en profielen zoals de gebruiker ze heeft aangepast.
    const keep = { waarden: {}, profielen: {} };
    for (const [field, list] of Object.entries(f.w || {})) {
      keep.waarden[field] = {};
      for (const item of Object.values(list || {})) {
        if (item && typeof item.van === 'string') keep.waarden[field][item.van] = String(item.naar ?? '').trim();
      }
    }
    for (const item of Object.values(f.p || {})) {
      if (item && typeof item.van === 'string') {
        keep.profielen[item.van] = { voor: String(item.voor ?? ''), achter: String(item.achter ?? ''), tekst: String(item.tekst ?? '').trim(), zeker: true };
      }
    }
    // Waarden die niet op het formulier stonden (niet gewijzigd) blijven zoals ze waren.
    for (const [field, map] of Object.entries(p.waarden)) keep.waarden[field] = { ...map, ...(keep.waarden[field] || {}) };
    keep.profielen = { ...p.profielen, ...keep.profielen };
    if (changed) refreshDerived(sheet, p, keep);
    else { p.waarden = keep.waarden; p.profielen = keep.profielen; }
    if (f.rijen_getoond === '1') {
      // Compact ("2,3,5-9", door de pagina zelf ingevuld) of losse vinkjes (zonder JavaScript).
      const chosen = typeof f.keuze === 'string' ? expandRanges(f.keuze) : [].concat(f.rij || []).map(Number).filter(Number.isInteger);
      p.gekozen = chosen;
    }
  });
  return plan;
}

/* ---------- voorbeeld: elke rij omzetten naar een record ---------- */
const PLATE_OK = /^[A-Z0-9]{4,8}$/; // ook buitenlandse kentekens
function existingIndex(doel) {
  if (isTyre(doel)) {
    const rows = db.prepare('SELECT * FROM tyre_storage WHERE soort = ?').all(doel === 'bandenopslag' ? 'opslag' : 'klant');
    return {
      byLabel: new Map(rows.filter((r) => r.label).map((r) => [r.label.toLowerCase(), r])),
      prints: new Set(rows.map((r) => fingerprint(doel, r))),
    };
  }
  const soort = doel === 'banden' ? 'band' : 'onderdeel';
  const rows = db.prepare('SELECT * FROM stock_items WHERE soort = ?').all(soort);
  return { byLabel: new Map(), prints: new Set(rows.map((r) => fingerprint(doel, r))) };
}
const PRINT_FIELDS = {
  bandenhotel: ['label', 'klant_naam', 'plate_key', 'auto', 'seizoen', 'maat', 'locatie', 'opmerkingen', 'profiel_voor', 'profiel_achter', 'profiel_tekst'],
  bandenopslag: ['label', 'klant_naam', 'plate_key', 'auto', 'seizoen', 'maat', 'locatie', 'opmerkingen', 'profiel_voor', 'profiel_achter', 'profiel_tekst'],
  onderdelen: ['merk', 'nummer', 'oe_nummer', 'type', 'omschrijving', 'locatie', 'aantal'],
  banden: ['merk', 'type', 'maat', 'profiel', 'snelheid', 'seizoen', 'locatie', 'aantal', 'omschrijving'],
};
function fingerprint(doel, r) {
  return PRINT_FIELDS[doel].map((f) => String(r[f] ?? '').toLowerCase()).join('|');
}

function toBool(v) {
  if (typeof v === 'boolean') return v;
  const t = cellText(v).toLowerCase();
  if (!t) return null;
  if (/^(ja|j|yes|y|true|waar|x|1|v|✓|op voorraad)$/.test(t)) return true;
  if (/^(nee|n|no|false|onwaar|0|-|weg|verkocht)$/.test(t)) return false;
  return null;
}

/** Eén rij -> { record, warnings, empty } */
function convertRow(sheet, plan, row, filename) {
  const { values, extra } = rawFields(sheet, plan, row);
  const warnings = [];
  const text = (f) => {
    const t = cellText(values[f]);
    const map = plan.waarden[f];
    return map && Object.hasOwn(map, t) ? map[t] : t;
  };
  const hasValue = Object.keys(values).some((f) => f !== 'beschikbaar' && cellText(values[f]) !== '');
  extra.Bron = `${filename} · ${sheet.name} · rij ${row.n}`;
  if (isTyre(plan.doel)) {
    const d = { soort: plan.doel === 'bandenopslag' ? 'opslag' : 'klant' };
    for (const f of ['label', 'klant_naam', 'kenteken', 'telefoon', 'auto', 'seizoen', 'maat', 'merk', 'dot', 'locatie', 'opmerkingen', 'status']) d[f] = text(f);
    if (/^(onbekend|geen|nvt|n\.v\.t\.?|\?+|-+|x+)$/i.test(d.kenteken)) d.kenteken = '';
    d.aantal = values.aantal ?? 4;
    d.datum_in = values.datum_in ? cellText(values.datum_in) : '';
    const velg = text('velg').toLowerCase();
    d.velg = /alu|lichtmetaal|lm/.test(velg) ? 'alu' : /staal|stalen/.test(velg) ? 'staal' : /zonder|geen|los/.test(velg) ? 'zonder' : '';
    d.profiel_voor = values.profiel_voor;
    d.profiel_achter = values.profiel_achter;
    if (values.profiel !== undefined) {
      const raw = cellText(values.profiel);
      const p = plan.profielen[raw] || parseProfiel(raw);
      if (d.profiel_voor === undefined) d.profiel_voor = p.voor;
      if (d.profiel_achter === undefined) d.profiel_achter = p.achter;
      d.profiel_tekst = p.tekst;
      if (raw && !p.zeker && !p.claude) warnings.push(`Profiel "${raw}" niet zeker uitgelezen`);
    }
    if (d.profiel_achter === undefined || d.profiel_achter === '') d.profiel_achter = d.profiel_voor;
    d.extra = extra;
    const rec = inv.normalizeTyre(d);
    if (!rec.klant_naam && !rec.kenteken) warnings.push('Geen klant en geen kenteken');
    if (rec.kenteken && !PLATE_OK.test(rec.plate_key)) warnings.push(`Kenteken "${rec.kenteken}" lijkt niet te kloppen`);
    if (rec.soort === 'klant' && !rec.kenteken) warnings.push('Geen kenteken: wordt niet aan een klant gekoppeld');
    if (values.datum_in && !rec.datum_in) warnings.push(`Datum "${cellText(values.datum_in)}" niet herkend`);
    return { record: rec, warnings, empty: !hasValue };
  }
  const soort = plan.doel === 'banden' ? 'band' : 'onderdeel';
  const d = {};
  for (const f of ['merk', 'nummer', 'oe_nummer', 'type', 'omschrijving', 'maat', 'profiel', 'snelheid', 'seizoen', 'locatie', 'prijs']) d[f] = text(f);
  const aantalRaw = values.aantal;
  if (aantalRaw === undefined || cellText(aantalRaw) === '') {
    d.aantal = 1;
    if (hasValue) warnings.push('Aantal ontbreekt (1 aangenomen)');
  } else {
    d.aantal = aantalRaw;
    if (!/\d/.test(cellText(aantalRaw))) warnings.push(`Aantal "${cellText(aantalRaw)}" is geen getal`);
  }
  const b = values.beschikbaar === undefined ? null : toBool(values.beschikbaar);
  d.beschikbaar = b === null ? 1 : b ? 1 : 0;
  d.datum = values.datum ? cellText(values.datum) : '';
  d.extra = extra;
  const rec = inv.normalizeStock(d, soort);
  // Alleen een aantal of datum, maar niets wat zegt wat het is: telt als lege rij.
  const describes = rec.nummer || rec.oe_nummer || rec.type || rec.omschrijving || rec.maat || rec.merk;
  if (!describes) return { record: rec, warnings: [], empty: true };
  if (!rec.nummer && !rec.oe_nummer && !rec.type && !rec.omschrijving && !rec.maat) warnings.push('Alleen een merk: geen nummer, soort, maat of omschrijving');
  if (soort === 'band' && d.maat && rec.maat === d.maat && !/^\d{3}\/\d{2}Z?R\d{2}/.test(rec.maat)) warnings.push(`Maat "${d.maat}" niet herkend`);
  return { record: rec, warnings, empty: !hasValue };
}

/** Alles wat de controlepagina nodig heeft. */
function preview(draft) {
  return draft.sheets.map((sheet, si) => {
    const plan = draft.plan.sheets[si];
    const base = { sheet, plan, si, rows: [], counts: { totaal: sheet.rows.length, gekozen: 0, nieuw: 0, bijwerken: 0, bestaat: 0, leeg: 0, letop: 0 } };
    if (plan.doel === 'overslaan') return base;
    base.distinct = {};
    for (const field of Object.keys(plan.waarden)) {
      base.distinct[field] = [...distinctValues(sheet, plan, field)].sort((a, b) => b[1] - a[1]);
    }
    base.profielCounts = distinctValues(sheet, plan, 'profiel');
    const idx = existingIndex(plan.doel);
    const seenLabels = new Map();
    const newPlates = new Set();
    const chosen = plan.gekozen ? new Set(plan.gekozen) : null;
    for (const row of sheet.rows) {
      const { record, warnings, empty } = convertRow(sheet, plan, row, draft.filename);
      let status = 'nieuw';
      let existing = null;
      if (empty) status = 'leeg';
      else if (idx.prints.has(fingerprint(plan.doel, record))) status = 'bestaat';
      else if (record.label && idx.byLabel.has(record.label.toLowerCase())) { status = 'bijwerken'; existing = idx.byLabel.get(record.label.toLowerCase()); }
      if (record.label && !empty) {
        const k = record.label.toLowerCase();
        if (seenLabels.has(k)) warnings.push(`Label ${record.label} komt ook voor in rij ${seenLabels.get(k)}`);
        else seenLabels.set(k, row.n);
      }
      const flag = plan.rijen[row.n] || null;
      const defaultOn = status !== 'leeg' && status !== 'bestaat' && !(flag && flag.advies === 'overslaan');
      const on = chosen ? chosen.has(row.n) : defaultOn;
      const klant = !empty && plan.doel === 'bandenhotel' ? inv.customerAction(record) : null;
      base.rows.push({ n: row.n, record, warnings, flag, status, existingId: existing && existing.id, on, klant });
      if (on && klant === 'nieuw') newPlates.add(record.plate_key);
      base.counts[status]++;
      if (on) base.counts.gekozen++;
      if (warnings.length || flag) base.counts.letop++;
    }
    base.counts.nieuweKlanten = newPlates.size;
    return base;
  });
}

/* ---------- bevestigen ---------- */
function commit(draft, userId) {
  const sheetsPreview = preview(draft);
  const result = { bandenhotel: 0, bandenopslag: 0, bijgewerkt: 0, onderdelen: 0, banden: 0, klantenNieuw: 0, klantenAangevuld: 0 };
  db.exec('BEGIN');
  try {
    for (const sp of sheetsPreview) {
      if (sp.plan.doel === 'overslaan') continue;
      const mapped = new Set(Object.values(sp.plan.kolommen));
      for (const r of sp.rows) {
        if (!r.on || r.status === 'leeg') continue;
        if (isTyre(sp.plan.doel)) {
          if (r.existingId) {
            // Bestaand label: alleen de velden uit het bestand bijwerken, de rest (bijv. status) blijft.
            const cur = inv.getTyre(r.existingId);
            const merged = { ...cur };
            for (const [k, v] of Object.entries(r.record)) {
              const from = k === 'plate_key' ? 'kenteken' : ['profiel_voor', 'profiel_achter', 'profiel_tekst'].includes(k) ? 'profiel' : k;
              if (mapped.has(from) || mapped.has(k) || k === 'extra') merged[k] = v;
            }
            if (!mapped.has('status')) merged.status = cur.status;
            inv.saveTyre({ id: r.existingId, data: merged, userId });
            result.bijgewerkt++;
          } else {
            inv.saveTyre({ data: r.record, userId });
            result[sp.plan.doel]++;
          }
          const c = inv.ensureCustomer(r.record);
          if (c === 'nieuw') result.klantenNieuw++;
          else if (c === 'aangevuld') result.klantenAangevuld++;
        } else {
          inv.saveStock({ data: r.record, userId });
          result[sp.plan.doel]++;
        }
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  }
  return result;
}

module.exports = {
  TARGETS, DOELEN, SPECIAL, VALUE_FIELDS, SheetImportError, MAX_FILE,
  readFile, heuristicSheetPlan, parseProfiel, createDraft, getDraft, savePlan, deleteDraft, updatePlanFromForm, preview, commit,
  buildPrompt, applyAnalysis, ANALYSIS_SCHEMA, cellText,
};
