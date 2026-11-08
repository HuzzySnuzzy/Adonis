'use strict';
/**
 * AI-analyse van één voertuig: Claude zoekt op internet alles over deze auto (generatie, motor, aandrijving,
 * rijgedrag/comfort, originele banden, onderhoud, bekende problemen, APK-punten…) en levert dat per "zone" aan
 * (motor, banden, remmen…), zodat de pagina er een röntgenbeeld/hologram van de auto mee kan tekenen.
 * Opgeslagen per kenteken (of omschrijving); opnieuw analyseren kan altijd.
 */
const { db, plateKey } = require('./db');
const ai = require('./ai');
const importer = require('./import');

db.exec(`
  CREATE TABLE IF NOT EXISTS vehicle_analyses (
    key TEXT PRIMARY KEY,              -- kenteken zonder streepjes, of "o:" + omschrijving
    kenteken TEXT NOT NULL DEFAULT '',
    label TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL,                -- JSON (zie SYSTEM)
    sources TEXT NOT NULL DEFAULT '[]',
    web INTEGER NOT NULL DEFAULT 1,
    effort TEXT NOT NULL DEFAULT '',
    eur REAL NOT NULL DEFAULT 0,
    by_user INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

class VehicleError extends Error {}
const SEARCHES = { laag: 4, normaal: 8, hoog: 12 };
const SEARCH_USD = 0.01;
const ZONES = {
  motor: 'Motor', aandrijving: 'Aandrijving en versnellingsbak', banden: 'Banden en wielen', remmen: 'Remmen',
  onderstel: 'Onderstel en sturen', carrosserie: 'Carrosserie en roest', interieur: 'Interieur en comfort',
  verlichting: 'Verlichting', elektronica: 'Elektronica',
};

const SYSTEM = `Je bent een zeer ervaren Nederlandse autotechnicus en autojournalist. Je onderzoekt één specifieke auto
(met de gegevens die je krijgt, o.a. van de RDW) en zoekt op internet alles op wat een garage over deze auto moet weten.

Zoek o.a.: generatie en bouwjaren, welke motor dit precies is (code, cilinders, vermogen), plaats en ligging van de motor,
aandrijving (voor/achter/4wd), versnellingsbak, hoe hij rijdt en hoe comfortabel hij is, verbruik, de ORIGINELE bandenmaten
en spanning, onderhoud (olie: specificatie en hoeveelheid, distributie: riem of ketting en interval, overige intervallen),
bekende problemen en zwakke plekken, APK-aandachtspunten (waar roest hij, gordels, ophanging…), lampen/verlichting
(soorten lampen of led/xenon), elektronica-eigenaardigheden.

Regels:
- Alleen wat bij DEZE auto/generatie/motor hoort. Verzin niets; zet onzekere dingen niet erin.
- Kort en concreet in het Nederlands, voor monteurs. Per zone hooguit 5 punten, belangrijkste eerst.
- ernst: "hoog" = veiligheid of vaak afkeur/duur; "let-op" = bekend aandachtspunt; "info" = handig om te weten.

Antwoord als laatste met alleen één JSON-object (geen markdown), precies in deze vorm:
{"voertuig":{"naam":"","generatie":"","bouwjaren":"","carrosserie":"hatchback|sedan|stationwagen|mpv|suv|bestelwagen|coupe|cabrio","motor":"","motor_plaats":"voor|midden|achter","motor_ligging":"dwars|langs","aandrijving":"voor|achter|4wd","versnellingsbak":""},
 "samenvatting":"",
 "rijden":{"rijgedrag":"","comfort":"","verbruik":""},
 "zones":{"motor":[{"kop":"","tekst":"","ernst":"info|let-op|hoog"}],"aandrijving":[],"banden":[],"remmen":[],"onderstel":[],"carrosserie":[],"interieur":[],"verlichting":[],"elektronica":[]},
 "onderhoud":[{"kop":"","tekst":""}],
 "apk":[{"kop":"","tekst":"","ernst":"info|let-op|hoog"}]}`;

/* ---------- welk voertuig? ---------- */
function keyFor({ kenteken, omschrijving }) {
  const pk = plateKey(kenteken || '');
  if (pk && pk.length >= 4) return pk;
  const o = String(omschrijving || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return o ? 'o:' + o.slice(0, 120) : null;
}
function get(key) {
  if (!key) return null;
  const row = db.prepare('SELECT v.*, u.name AS by_name FROM vehicle_analyses v LEFT JOIN users u ON u.id = v.by_user WHERE key = ?').get(key);
  if (!row) return null;
  try { return { ...row, data: JSON.parse(row.data), sources: JSON.parse(row.sources) }; } catch { return null; }
}
function recent(limit = 12) {
  return db.prepare('SELECT key, kenteken, label, created_at FROM vehicle_analyses ORDER BY created_at DESC LIMIT ?').all(limit);
}

/* ---------- schatting ---------- */
function estimate() {
  return ai.LEVEL_KEYS.map((key) => {
    const l = ai.LEVELS[key];
    const n = SEARCHES[key];
    const lo = ai.usdOf(ai.MODEL, 3000 + n * 2500, 2500 + l.think[0]) + Math.ceil(n / 2) * SEARCH_USD;
    const hi = ai.usdOf(ai.MODEL, 5000 + n * 9000, 6000 + l.think[1]) + n * SEARCH_USD;
    return { key, label: l.label, uitleg: l.uitleg + ` Hooguit ${n} zoekopdrachten op internet.`, eurMin: ai.eur(lo), eurMax: ai.eur(hi), seconds: key === 'laag' ? 45 : key === 'normaal' ? 90 : 180 };
  });
}

/* ---------- Claude met web search ---------- */
function parseLastJson(text) {
  const i = text.lastIndexOf('{"voertuig"');
  const a = i >= 0 ? i : text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('geen JSON');
  return JSON.parse(text.slice(a, b + 1));
}
const clean = (s, n = 400) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const pick = (v, allowed, dflt) => (allowed.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : dflt);

async function ask(facts, effortKey) {
  const lvl = ai.level(effortKey);
  const client = importer.getClient();
  const question = `Onderzoek deze auto:\n${JSON.stringify(facts)}`;
  const usage = { model: ai.MODEL, input: 0, output: 0, extraUsd: 0 };
  const run = async (withWeb) => {
    const user = { role: 'user', content: withWeb ? question : `${question}\n(Internet zoeken is niet beschikbaar: geef alleen wat je zeker weet.)` };
    let messages = [user];
    let response;
    const content = [];
    for (let i = 0; i < 5; i++) {
      response = await client.beta.messages.create({
        model: ai.MODEL,
        max_tokens: 20000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        output_config: { effort: ai.LEVELS[lvl].effort },
        ...(withWeb ? { tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: SEARCHES[lvl] }] } : {}),
        messages,
      });
      const u = importer.usageOf(response);
      usage.model = u.model; usage.input += u.input; usage.output += u.output;
      usage.extraUsd += ((response.usage && response.usage.server_tool_use && response.usage.server_tool_use.web_search_requests) || 0) * SEARCH_USD;
      content.push(...response.content);
      if (response.stop_reason !== 'pause_turn') break;
      messages = [user, { role: 'assistant', content: [...content] }];
    }
    return { ...response, content };
  };
  let response; let web = true;
  try {
    response = await run(true);
  } catch (err) {
    if (err && err.status === 400 && /web.?search|tool/i.test(err.message || '')) {
      web = false;
      try { response = await run(false); } catch (err2) { throw importer.apiError(err2, 'excel'); }
    } else {
      throw importer.apiError(err, 'excel');
    }
  }
  const billed = (msg) => Object.assign(new VehicleError(msg), { usage });
  if (response.stop_reason === 'refusal') throw billed('Claude kon deze auto niet onderzoeken.');
  if (response.stop_reason === 'max_tokens') throw billed('Het antwoord van Claude werd afgebroken. Probeer het met minder inspanning of opnieuw.');
  const found = new Map(); const cited = new Map();
  for (const block of response.content) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) for (const r of block.content) if (r && r.url) found.set(r.url, r.title || r.url);
    if (block.type === 'text' && Array.isArray(block.citations)) for (const c of block.citations) if (c && c.url) cited.set(c.url, c.title || c.url);
  }
  const lastTool = response.content.map((b) => b.type).lastIndexOf('web_search_tool_result');
  const text = response.content.slice(lastTool + 1).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let p;
  try { p = parseLastJson(text || response.content.filter((b) => b.type === 'text').map((b) => b.text).join('')); } catch { throw billed('Het antwoord van Claude kon niet worden gelezen. Probeer het opnieuw.'); }
  // Netjes maken: alleen bekende velden, vaste keuzes, beperkte lengtes.
  const v = p.voertuig || {};
  const points = (list, n = 5) => (Array.isArray(list) ? list : []).slice(0, n).map((x) => ({ kop: clean(x.kop, 90), tekst: clean(x.tekst, 500), ernst: pick(x.ernst, ['info', 'let-op', 'hoog'], 'info') })).filter((x) => x.kop || x.tekst);
  const data = {
    voertuig: {
      naam: clean(v.naam, 120), generatie: clean(v.generatie, 120), bouwjaren: clean(v.bouwjaren, 40),
      carrosserie: pick(v.carrosserie, ['hatchback', 'sedan', 'stationwagen', 'mpv', 'suv', 'bestelwagen', 'coupe', 'cabrio'], 'hatchback'),
      motor: clean(v.motor, 160), motor_plaats: pick(v.motor_plaats, ['voor', 'midden', 'achter'], 'voor'),
      motor_ligging: pick(v.motor_ligging, ['dwars', 'langs'], 'dwars'), aandrijving: pick(v.aandrijving, ['voor', 'achter', '4wd'], 'voor'),
      versnellingsbak: clean(v.versnellingsbak, 120),
    },
    samenvatting: clean(p.samenvatting, 900),
    rijden: { rijgedrag: clean(p.rijden && p.rijden.rijgedrag, 600), comfort: clean(p.rijden && p.rijden.comfort, 600), verbruik: clean(p.rijden && p.rijden.verbruik, 200) },
    zones: Object.fromEntries(Object.keys(ZONES).map((z) => [z, points(p.zones && p.zones[z])])),
    onderhoud: (Array.isArray(p.onderhoud) ? p.onderhoud : []).slice(0, 10).map((x) => ({ kop: clean(x.kop, 80), tekst: clean(x.tekst, 300) })).filter((x) => x.kop),
    apk: points(p.apk, 8),
  };
  const sources = [...(cited.size ? cited : found)].slice(0, 12).map(([url, title]) => ({ url, title: clean(title, 120) }));
  return { usage, result: { data, sources, web } };
}

/**
 * facts: wat we al weten (RDW of omschrijving). Slaat het resultaat op onder key.
 */
async function analyze({ key, kenteken, label, facts }, { effort = 'normaal', userId = null } = {}) {
  if (!importer.isConfigured()) throw new VehicleError('Claude is niet ingesteld: vul anthropic-api-key in config.properties in.');
  if (!key) throw new VehicleError('Vul een kenteken of een omschrijving van de auto in.');
  const lvl = ai.level(effort);
  const r = await importer.metered(userId, () => ask(facts, lvl), { kind: 'voertuig', effort: lvl, limited: false });
  const name = r.result.data.voertuig.naam || label;
  db.prepare(`INSERT INTO vehicle_analyses (key, kenteken, label, data, sources, web, effort, eur, by_user, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET kenteken = excluded.kenteken, label = excluded.label, data = excluded.data, sources = excluded.sources, web = excluded.web,
      effort = excluded.effort, eur = excluded.eur, by_user = excluded.by_user, created_at = excluded.created_at`)
    .run(key, kenteken || '', name, JSON.stringify(r.result.data), JSON.stringify(r.result.sources), r.result.web ? 1 : 0, lvl, r.usage.eur || 0, userId);
  return { eur: r.usage.eur || 0, web: r.result.web, label: name };
}

module.exports = { VehicleError, ZONES, keyFor, get, recent, estimate, analyze, SEARCHES };
