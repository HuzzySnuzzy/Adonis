'use strict';
/**
 * Zoekwoorden: woorden die bij elkaar horen, zodat zoeken op "light" of "lampen" ook "dagrijverlichting" vindt.
 * Er is een standaardlijst (garagetermen, Nederlands en Engels); de garage kan die aanvullen en eigen groepen
 * toevoegen ("ADONIS leren"). Zoeken gebeurt met "bevat", dus "licht" vindt ook "dagrijverlichting".
 */
const { db } = require('./db');

db.exec(`
  CREATE TABLE IF NOT EXISTS search_synonyms (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    words TEXT NOT NULL,           -- komma-gescheiden
    builtin TEXT,                  -- sleutel van een standaardgroep (NULL = eigen groep)
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const BUILTIN = {
  verlichting: ['Verlichting', 'licht, lamp, lampje, verlichting, light, lights, lighting, led, xenon, koplamp, achterlicht, dagrijverlichting, drl, mistlamp, mistlicht, knipperlicht, richtingaanwijzer, remlicht, kentekenverlichting, bulb, peertje, gloeilamp, headlight, taillight'],
  accu: ['Accu', 'accu, batterij, battery, startaccu, agm, efb, laadstroom, lege accu'],
  remmen: ['Remmen', 'rem, remmen, remblok, remschijf, remklauw, remvloeistof, handrem, parkeerrem, brake, brakes, pads, discs, caliper'],
  banden: ['Banden en wielen', 'band, banden, tyre, tire, wiel, wielen, velg, profiel, uitlijnen, balanceren, tpms, bandenspanning, wheel'],
  olie: ['Olie', 'olie, oil, motorolie, oliefilter, olieverversing, oliepeil, lekt olie'],
  distributie: ['Distributie', 'distributie, distributieriem, distributieketting, tandriem, timing belt, timing chain, spanrol, poly-v, multiriem, aandrijfriem'],
  koeling: ['Koeling', 'koelvloeistof, koeling, radiateur, koeler, thermostaat, waterpomp, coolant, oververhit, temperatuur, koelventilator'],
  airco: ['Airco', 'airco, aircon, klimaat, climate, koudemiddel, r134a, r1234yf, aircocompressor, a/c, condensor'],
  uitlaat: ['Uitlaat en emissie', 'uitlaat, exhaust, katalysator, roetfilter, dpf, fap, lambda, lambdasonde, egr, adblue, uitstoot'],
  ophanging: ['Ophanging en sturen', 'schokdemper, schokbreker, veer, veren, draagarm, stabilisator, fusee, ophanging, suspension, shock, wiellager, kogelgewricht, spoorstang, stuurhuis, stuurbekrachtiging, steering'],
  koppeling: ['Koppeling', 'koppeling, clutch, vliegwiel, dmf, drukgroep, koppelingsplaat, druklager'],
  versnellingsbak: ['Versnellingsbak', 'versnellingsbak, gearbox, transmission, dsg, automaat, cvt, bakolie, schakelen'],
  storing: ['Storingen en elektronica', 'storing, foutcode, fault, error, dtc, uitlezen, diagnose, vcds, odis, codering, coderen, module, ecu, bcm, can-bus, gateway, software, update'],
  ruiten: ['Ruiten en wissers', 'ruit, voorruit, achterruit, windscreen, windshield, glas, sterretje, ruitenwisser, wisser, wisserblad, wiper, sproeier'],
  apk: ['APK', 'apk, keuring, inspection, afkeur, afkeurpunt'],
  onderhoud: ['Onderhoud', 'onderhoud, servicebeurt, service, beurt, kleine beurt, grote beurt, inspectiebeurt, interval'],
  filters: ['Filters', 'luchtfilter, interieurfilter, pollenfilter, brandstoffilter, oliefilter, air filter, cabin filter, filter'],
  ontsteking: ['Ontsteking', 'bougie, spark plug, gloeibougie, glow plug, bobine, ignition, ontsteking, misfire, overslaan'],
  brandstof: ['Brandstof', 'brandstof, diesel, benzine, fuel, injector, verstuiver, brandstofpomp, tank, inspuiting, lpg'],
  turbo: ['Turbo', 'turbo, turbolader, intercooler, boost, wastegate, inlaat'],
  laden: ['Starten en laden', 'startmotor, starter, dynamo, alternator, laadstroom, start niet, startprobleem'],
  sloten: ['Sloten en sleutels', 'slot, deurslot, centrale vergrendeling, lock, sleutel, key, afstandsbediening, immobilizer, startonderbreker'],
  ramen: ['Ramen en spiegels', 'raammechaniek, elektrische ramen, window regulator, raammotor, spiegel, mirror, buitenspiegel'],
  sensoren: ['Sensoren en hulpsystemen', 'sensor, parkeersensor, pdc, abs, esp, asr, camera, radar, park assist, steer assist, lane assist'],
  lekkage: ['Lekkage', 'lekkage, lekken, lekt, leak, druppelt, zweet'],
  geluid: ['Geluiden', 'geluid, tikken, tikt, piepen, piept, rammel, rammelt, noise, rattle, squeak, zoemt, bromt'],
  veiligheid: ['Airbag en gordels', 'airbag, srs, gordel, gordelspanner, seat belt'],
  verwarming: ['Verwarming', 'verwarming, kachel, heater, blower, aanjager, ventilator, stoelverwarming'],
  trekhaak: ['Trekhaak', 'trekhaak, towbar, aanhanger, aanhangwagen, trailer, caravan'],
  carrosserie: ['Carrosserie', 'schade, deuk, kras, lakschade, carrosserie, bumper, roest, plaatwerk'],
};

/** Standaardgroepen toevoegen die er nog niet zijn (bestaande, aangepaste groepen blijven zoals ze zijn). */
function seed() {
  const have = new Set(db.prepare('SELECT builtin FROM search_synonyms WHERE builtin IS NOT NULL').all().map((r) => r.builtin));
  const ins = db.prepare('INSERT INTO search_synonyms (name, words, builtin) VALUES (?, ?, ?)');
  for (const [key, [name, words]] of Object.entries(BUILTIN)) if (!have.has(key)) ins.run(name, words, key);
}
seed();

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
function cleanWords(text) {
  return [...new Set(String(text || '').split(/[,;\n]+/).map((w) => norm(w).replace(/\s+/g, ' ')).filter((w) => w.length >= 2))].slice(0, 80);
}

let cache = null;
function groups() {
  if (!cache) cache = db.prepare('SELECT * FROM search_synonyms ORDER BY builtin IS NULL DESC, name COLLATE NOCASE').all().map((g) => ({ ...g, list: cleanWords(g.words) }));
  return cache;
}
function list() { return groups(); }
function saveGroup(id, { name, words }) {
  const list = cleanWords(words);
  const n = String(name || '').trim().slice(0, 60) || (list[0] ? list[0].charAt(0).toUpperCase() + list[0].slice(1) : '');
  if (list.length < 2) throw new Error('Vul minstens twee woorden in die hetzelfde betekenen, gescheiden door komma\'s.');
  if (id) db.prepare("UPDATE search_synonyms SET name = ?, words = ?, updated_at = datetime('now') WHERE id = ?").run(n, list.join(', '), id);
  else db.prepare('INSERT INTO search_synonyms (name, words) VALUES (?, ?)').run(n, list.join(', '));
  cache = null;
}
function deleteGroup(id) { db.prepare('DELETE FROM search_synonyms WHERE id = ?').run(id); cache = null; }
/** Standaardgroep terugzetten naar de oorspronkelijke woorden. */
function resetGroup(id) {
  const g = db.prepare('SELECT builtin FROM search_synonyms WHERE id = ?').get(id);
  if (g && BUILTIN[g.builtin]) db.prepare("UPDATE search_synonyms SET name = ?, words = ?, updated_at = datetime('now') WHERE id = ?").run(BUILTIN[g.builtin][0], BUILTIN[g.builtin][1], id);
  cache = null;
}

/** Enkelvoud-ish: "lampen" -> "lamp", "remmen" -> "rem", "lights" -> "light". */
function stems(w) {
  const out = new Set([w]);
  if (w.length > 4 && /en$/.test(w)) { out.add(w.slice(0, -2)); if (/(.)\1en$/.test(w)) out.add(w.slice(0, -3)); }
  if (w.length > 3 && /s$/.test(w)) out.add(w.slice(0, -1));
  if (w.length > 4 && /je$/.test(w)) out.add(w.slice(0, -2));
  return [...out];
}

/**
 * Zoekopdracht uitsplitsen: elk woord moet voorkomen (EN), en voor elk woord telt ook een woord uit dezelfde groep (OF).
 * Geeft [{ term, alts: [...], group }] terug. Woorden tussen aanhalingstekens worden niet uitgebreid.
 */
function expand(q) {
  const parts = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(q || ''))) && parts.length < 8) {
    const exact = m[1] !== undefined;
    const term = norm(m[1] !== undefined ? m[1] : m[2]);
    if (!term) continue;
    if (exact || term.length < 3) { parts.push({ term, alts: [term], group: null }); continue; }
    const forms = stems(term);
    const hit = groups().filter((g) => g.list.some((w) => forms.includes(w) || forms.some((f) => f.length >= 4 && w === f)));
    const alts = new Set(forms);
    for (const g of hit) for (const w of g.list) alts.add(w);
    parts.push({ term, alts: [...alts].slice(0, 60), group: hit.length ? hit.map((g) => g.name).join(', ') : null });
  }
  return parts;
}
/** SQL-voorwaarde (met parameters) voor een tekstkolom. */
function sqlFor(column, q, escapeLike) {
  const parts = expand(q);
  if (!parts.length) return { where: '1', params: [], parts };
  const where = parts.map((p) => '(' + p.alts.map(() => `${column} LIKE ? ESCAPE '\\'`).join(' OR ') + ')').join(' AND ');
  const params = parts.flatMap((p) => p.alts.map((a) => escapeLike(a)));
  return { where, params, parts };
}

module.exports = { list, saveGroup, deleteGroup, resetGroup, expand, sqlFor, BUILTIN };
