'use strict';
/**
 * APK-aandachtspunten per automodel: bekende zwakke plekken van dat model en bouwjaar (roestplekken, gordels,
 * ophanging, remleidingen…), opgezocht door Claude op internet (web search) met bronnen.
 * Eén keer per model + bouwjaar: alle klanten met dezelfde auto delen het resultaat (en de kosten).
 */
const { db } = require('./db');
const ai = require('./ai');
const importer = require('./import');

db.exec(`
  CREATE TABLE IF NOT EXISTS model_bulletins (
    key TEXT PRIMARY KEY,               -- merk|model|jaar (kleine letters)
    label TEXT NOT NULL,                -- "Peugeot 107 (2011)"
    items TEXT NOT NULL DEFAULT '[]',
    sources TEXT NOT NULL DEFAULT '[]',
    web INTEGER NOT NULL DEFAULT 1,     -- 1 = met internetbronnen, 0 = alleen uit Claudes eigen kennis
    effort TEXT NOT NULL DEFAULT '',
    eur REAL NOT NULL DEFAULT 0,
    by_user INTEGER,
    analyzed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

class ModelBulletinError extends Error {}
const SEARCHES = { laag: 3, normaal: 5, hoog: 8 };
const SEARCH_USD = 0.01; // web search: $10 per 1000 zoekopdrachten

/* ---------- welk model? ---------- */
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
function modelOf(customer) {
  let rdw = null;
  try { rdw = customer.rdw_json ? JSON.parse(customer.rdw_json) : null; } catch { /* geen RDW */ }
  let merk = clean(rdw && rdw.merk);
  let model = clean(rdw && rdw.handelsbenaming);
  if (merk && model.toLowerCase().startsWith(merk.toLowerCase())) model = clean(model.slice(merk.length));
  if (!merk || !model) {
    // Zonder RDW-gegevens: merk/type zoals ingevuld (bijv. "Mercedes-Benz 639 Vito 111 Cdi").
    const mt = clean(customer.merk_type);
    if (!mt) return null;
    [merk, ...model] = mt.split(' ');
    model = model.join(' ');
  }
  const jaar = rdw && /^\d{4}/.test(rdw.eersteToelating || '') ? rdw.eersteToelating.slice(0, 4) : '';
  return {
    key: [merk, model, jaar].join('|').toLowerCase(),
    label: `${merk} ${model}`.trim() + (jaar ? ` (${jaar})` : ''),
    merk, model, jaar,
    brandstof: (rdw && rdw.brandstof) || '',
    inrichting: (rdw && rdw.inrichting) || '',
  };
}
function get(customer) {
  const m = modelOf(customer);
  if (!m) return { model: null, data: null };
  const row = db.prepare('SELECT b.*, u.name AS by_name FROM model_bulletins b LEFT JOIN users u ON u.id = b.by_user WHERE key = ?').get(m.key);
  if (!row) return { model: m, data: null };
  let items = []; let sources = [];
  try { items = JSON.parse(row.items); } catch { /* leeg */ }
  try { sources = JSON.parse(row.sources); } catch { /* leeg */ }
  return { model: m, data: { ...row, items, sources } };
}

/* ---------- schatting ---------- */
function estimate() {
  // Zoekresultaten tellen als invoer; met "dynamic filtering" blijft dat beperkt, maar het blijft een bandbreedte.
  return ai.LEVEL_KEYS.map((key) => {
    const l = ai.LEVELS[key];
    const n = SEARCHES[key];
    const lo = ai.usdOf(ai.MODEL, 2500 + n * 2500, 800 + l.think[0]) + Math.ceil(n / 2) * SEARCH_USD;
    const hi = ai.usdOf(ai.MODEL, 4000 + n * 9000, 2500 + l.think[1]) + n * SEARCH_USD;
    return { key, label: l.label, uitleg: l.uitleg + ` Hooguit ${n} zoekopdrachten op internet.`, eurMin: ai.eur(lo), eurMax: ai.eur(hi), seconds: key === 'laag' ? 30 : key === 'normaal' ? 60 : 120 };
  });
}

/* ---------- Claude met web search ---------- */
const SYSTEM = `Je bent een ervaren APK-keurmeester in Nederland. Je zoekt voor één automodel (en bouwjaar/generatie) op internet
uit welke zwakke plekken en APK-afkeurpunten bij dit model bekend zijn, zodat de monteur weet waar hij extra goed moet kijken.

Denk aan: roest (precies waar: dorpels, wielkasten, subframe, veerpoten, bodem, remleidingen), gordels en gordelsloten,
ophanging en fusees, stuurinrichting, remmen, uitlaat en ophangrubbers, verlichting, airbags, lekkages, typische storingen.

Regels:
- Alleen wat SPECIFIEK voor dit model/deze generatie bekend is. Niets algemeens dat voor elke auto geldt.
- Alleen wat je in bronnen terugvindt; verzin niets. Liever minder punten dan onzekere punten.
- Hooguit 8 punten, belangrijkste (meest voorkomend of gevaarlijkst) eerst.
- Kort en concreet in het Nederlands, voor monteurs.

Antwoord als laatste met alleen één JSON-object (geen uitleg, geen markdown), precies zo:
{"apk_punten":[{"onderdeel":"...","waar_kijken":"...","tekst":"...","categorie":"roest|gordels|ophanging|remmen|uitlaat|verlichting|stuur|elektrisch|motor|overig","ernst":"hoog|normaal","bronnen":["https://..."]}]}`;

function parseLastJson(text) {
  const b = text.lastIndexOf('}');
  // Zoek het begin van het laatste JSON-object met "apk_punten".
  const a = text.lastIndexOf('{"apk_punten"') >= 0 ? text.lastIndexOf('{"apk_punten"') : text.indexOf('{');
  if (a < 0 || b <= a) throw new Error('geen JSON');
  return JSON.parse(text.slice(a, b + 1));
}

async function ask(m, effortKey) {
  const lvl = ai.level(effortKey);
  const effort = ai.LEVELS[lvl].effort;
  const client = importer.getClient();
  const question = `Automodel: ${m.label}${m.brandstof ? `, brandstof ${m.brandstof}` : ''}${m.inrichting ? `, carrosserie ${m.inrichting}` : ''}.
Merk: ${m.merk}. Model: ${m.model}. Bouwjaar: ${m.jaar || 'onbekend'}.
Zoek de bekende zwakke plekken / APK-afkeurpunten van dit model en deze generatie.`;
  const usage = { model: ai.MODEL, input: 0, output: 0, extraUsd: 0 };
  const add = (r) => {
    const u = importer.usageOf(r);
    usage.model = u.model; usage.input += u.input; usage.output += u.output;
    usage.extraUsd += ((r.usage && r.usage.server_tool_use && r.usage.server_tool_use.web_search_requests) || 0) * SEARCH_USD;
  };
  const run = async (withWeb) => {
    const user = { role: 'user', content: withWeb ? question : `${question}\n(Internet zoeken is niet beschikbaar: geef alleen punten die je zeker weet, en laat "bronnen" leeg.)` };
    let messages = [user];
    let response;
    const content = []; // alles wat Claude in deze beurt heeft gedaan (ook vóór een pauze)
    for (let i = 0; i < 4; i++) {
      response = await client.beta.messages.create({
        model: ai.MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        output_config: { effort },
        ...(withWeb ? { tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: SEARCHES[lvl] }] } : {}),
        messages,
      });
      add(response);
      content.push(...response.content);
      // Lange zoektocht gepauzeerd: alles tot nu toe terugsturen, dan gaat de server verder waar hij was.
      if (response.stop_reason !== 'pause_turn') break;
      messages = [user, { role: 'assistant', content: [...content] }];
    }
    return { ...response, content };
  };
  let response; let web = true;
  try {
    response = await run(true);
  } catch (err) {
    // Web search niet ingeschakeld voor deze organisatie/sleutel: dan zonder internet (wordt duidelijk gemeld).
    if (err && err.status === 400 && /web.?search|tool/i.test(err.message || '')) {
      web = false;
      try { response = await run(false); } catch (err2) { throw importer.apiError(err2, 'excel'); }
    } else {
      throw importer.apiError(err, 'excel');
    }
  }
  const billed = (msg) => Object.assign(new ModelBulletinError(msg), { usage });
  if (response.stop_reason === 'refusal') throw billed('Claude kon dit niet opzoeken.');
  if (response.stop_reason === 'max_tokens') throw billed('Het antwoord van Claude werd afgebroken. Probeer het opnieuw.');
  // Gevonden pagina's (alleen die mogen als bron worden genoemd) en de tekst van het eindantwoord.
  const found = new Map();
  const cited = new Map();
  for (const block of response.content) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) if (r && r.url) found.set(r.url, r.title || r.url);
    }
    if (block.type === 'text' && Array.isArray(block.citations)) {
      for (const c of block.citations) if (c && c.url) cited.set(c.url, c.title || c.url);
    }
  }
  const lastTool = response.content.map((b) => b.type).lastIndexOf('web_search_tool_result');
  const text = response.content.slice(lastTool + 1).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try { parsed = parseLastJson(text || response.content.filter((b) => b.type === 'text').map((b) => b.text).join('')); } catch { throw billed('Het antwoord van Claude kon niet worden gelezen. Probeer het opnieuw.'); }
  const known = (u) => found.has(u) || cited.has(u);
  const items = (Array.isArray(parsed.apk_punten) ? parsed.apk_punten : []).slice(0, 8).map((p) => ({
    onderdeel: clean(p.onderdeel).slice(0, 80),
    waar: clean(p.waar_kijken).slice(0, 240),
    tekst: clean(p.tekst).slice(0, 400),
    categorie: clean(p.categorie).toLowerCase().slice(0, 20),
    ernst: p.ernst === 'hoog' ? 'hoog' : 'normaal',
    bronnen: (Array.isArray(p.bronnen) ? p.bronnen : []).filter((u) => typeof u === 'string' && /^https?:\/\//.test(u) && (!web || known(u))).slice(0, 3),
  })).filter((p) => p.onderdeel);
  const sources = [...(cited.size ? cited : found)].slice(0, 8).map(([url, title]) => ({ url, title: clean(title).slice(0, 120) }));
  return { usage, result: { items, sources, web } };
}

async function analyze(customer, { effort = 'normaal', userId = null } = {}) {
  if (!importer.isConfigured()) throw new ModelBulletinError('Claude is niet ingesteld: vul anthropic-api-key in config.properties in.');
  const m = modelOf(customer);
  if (!m) throw new ModelBulletinError('Het merk en model van deze auto zijn niet bekend. Vul Merk/Type in of haal de RDW-gegevens op.');
  const lvl = ai.level(effort);
  const r = await importer.metered(userId, () => ask(m, lvl), { kind: 'apk-model', effort: lvl, limited: false });
  db.prepare(`INSERT INTO model_bulletins (key, label, items, sources, web, effort, eur, by_user, analyzed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET label = excluded.label, items = excluded.items, sources = excluded.sources, web = excluded.web,
      effort = excluded.effort, eur = excluded.eur, by_user = excluded.by_user, analyzed_at = excluded.analyzed_at`)
    .run(m.key, m.label, JSON.stringify(r.result.items), JSON.stringify(r.result.sources), r.result.web ? 1 : 0, lvl, r.usage.eur || 0, userId);
  return { count: r.result.items.length, eur: r.usage.eur || 0, web: r.result.web, label: m.label };
}

/** Hoeveel klanten hebben dit model (zelfde merk, model en jaar)? */
function customersWith(key) {
  return db.prepare('SELECT id, kenteken, merk_type, rdw_json FROM customers').all().filter((c) => { const m = modelOf(c); return m && m.key === key; }).length;
}

module.exports = { ModelBulletinError, modelOf, get, estimate, analyze, customersWith, SEARCHES };
