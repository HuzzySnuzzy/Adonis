'use strict';
/**
 * APK-vraag: een monteur vraagt of iets afkeur is, bijv. "Zijn stabilisatorstangetjes met speling afkeur?".
 * Claude zoekt het antwoord op in de regels van de RDW (het online APK-handboek op apk-handboek.rdw.nl en rdw.nl):
 * alleen die websites mag hij doorzoeken en lezen. Het antwoord bevat een oordeel, de uitleg, de eis zelf en de bron.
 * Vragen en antwoorden worden bewaard: teruglezen is gratis, een nieuwe vraag stellen kost (zoals elke Claude-taak).
 */
const { db } = require('./db');
const ai = require('./ai');
const importer = require('./import');

db.exec(`
  CREATE TABLE IF NOT EXISTS apk_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vraag TEXT NOT NULL,
    soort TEXT NOT NULL DEFAULT 'personenauto',
    status TEXT NOT NULL DEFAULT 'bezig',       -- bezig | klaar | mislukt
    oordeel TEXT NOT NULL DEFAULT '',           -- afkeur | advies | goedkeur | afhankelijk | onbekend
    data TEXT NOT NULL DEFAULT '{}',
    sources TEXT NOT NULL DEFAULT '[]',
    error TEXT NOT NULL DEFAULT '',
    effort TEXT NOT NULL DEFAULT '',
    eur REAL NOT NULL DEFAULT 0,
    by_user INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

class ApkVraagError extends Error {}
const SOORTEN = {
  personenauto: 'Personenauto (M1)',
  'bedrijfsauto-licht': 'Lichte bedrijfsauto (N1, tot 3500 kg)',
  'bedrijfsauto-zwaar': 'Zware bedrijfsauto (N2/N3, M2/M3)',
  aanhangwagen: 'Aanhangwagen (O2)',
  driewieler: 'Driewieler / quad (L)',
};
const OORDELEN = {
  afkeur: { label: 'Afkeur', uitleg: 'Dit is een afkeurpunt: zo komt de auto niet door de APK.' },
  advies: { label: 'Geen afkeur, wel advies', uitleg: 'Geen reden om af te keuren, maar wel een adviespunt voor de klant.' },
  goedkeur: { label: 'Mag door de APK', uitleg: 'Geen afkeurpunt volgens de keuringseisen.' },
  afhankelijk: { label: 'Hangt ervan af', uitleg: 'Afkeur of niet hangt af van de situatie; zie de voorwaarden.' },
  onbekend: { label: 'Niet zeker', uitleg: 'Claude kon de eis niet met zekerheid in de regels van de RDW vinden.' },
};
const SEARCHES = { laag: 3, normaal: 5, hoog: 8 };
const FETCHES = { laag: 3, normaal: 5, hoog: 8 };
const SEARCH_USD = 0.01;
const DOMAINS = ['rdw.nl']; // ook apk-handboek.rdw.nl (subdomeinen tellen mee)

const SYSTEM = `Je bent een ervaren Nederlandse APK-keurmeester. Een monteur stelt een vraag over een APK-punt: is dit afkeur of mag het door?

Beantwoord de vraag uitsluitend op basis van de officiële keuringseisen van de RDW: het online APK-handboek (apk-handboek.rdw.nl)
en de overige APK-regelgeving op rdw.nl. Werkwijze:
1. Zoek met web_search de keuringseis die over dit onderdeel gaat (zoek in het Nederlands, met de vaktermen uit het handboek,
   bijv. "wielophanging speling", "stabilisatorstang", "fusee", "kogelgewricht").
2. Open met web_fetch de pagina van het APK-handboek met die eis en lees de precieze tekst (eisen, afkeurcriteria, toelichting).
3. Pas de eis toe op de vraag, voor de opgegeven voertuigsoort.

Regels:
- Baseer het oordeel alleen op wat er in de eisen staat. Verzin geen eisen, artikelnummers of citaten. Citeer letterlijk.
- Kun je de eis niet vinden of is het niet eenduidig, zeg dat eerlijk: oordeel "onbekend" of "afhankelijk", met wat er wel staat.
- "afkeur" = afkeurpunt; "advies" = geen afkeur maar wel een adviespunt/opmerking; "goedkeur" = geen gebrek volgens de eisen;
  "afhankelijk" = hangt af van de situatie (noem de voorwaarden concreet, bijv. hoeveel speling, welk onderdeel, welk bouwjaar).
- Schrijf kort, duidelijk Nederlands voor monteurs. Gebruik "u" als je de lezer aanspreekt.
- Bronnen: alleen pagina's die je echt hebt geopend of gevonden op rdw.nl / apk-handboek.rdw.nl, met de echte URL.

Antwoord als laatste met alleen één JSON-object (geen markdown), precies in deze vorm:
{"oordeel":"afkeur|advies|goedkeur|afhankelijk|onbekend",
 "kort":"één zin met het antwoord",
 "uitleg":"waarom, in 2 tot 5 zinnen",
 "eis":{"titel":"naam/nummer van de keuringseis of het artikel","tekst":"letterlijk citaat van de relevante eis of het afkeurcriterium"},
 "voorwaarden":["wanneer wel/niet afkeur, concreet"],
 "tips":["praktische tip voor het controleren, hooguit 3"],
 "bronnen":[{"titel":"","url":""}]}`;

function estimate() {
  return ai.LEVEL_KEYS.map((key) => {
    const l = ai.LEVELS[key];
    const n = SEARCHES[key]; const f = FETCHES[key];
    const lo = ai.usdOf(ai.MODEL, 3000 + 2 * 2500 + 6000, 900 + l.think[0]) + 2 * SEARCH_USD;
    const hi = ai.usdOf(ai.MODEL, 6000 + n * 6000 + f * 12000, 2000 + l.think[1]) + n * SEARCH_USD;
    return { key, label: l.label, uitleg: l.uitleg + ` Hooguit ${n} zoekopdrachten en ${f} pagina's van de RDW.`, eurMin: ai.eur(lo), eurMax: ai.eur(hi), seconds: key === 'laag' ? 30 : key === 'normaal' ? 60 : 120 };
  });
}

const clean = (s, n = 600) => String(s || '').replace(/[ \t]+/g, ' ').trim().slice(0, n);
const isRdw = (u) => { try { const h = new URL(u).hostname.toLowerCase(); return h === 'rdw.nl' || h.endsWith('.rdw.nl'); } catch { return false; } };
function parseLastJson(text) {
  const i = text.lastIndexOf('{"oordeel"');
  const a = i >= 0 ? i : text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('geen JSON');
  return JSON.parse(text.slice(a, b + 1));
}

async function ask(vraag, soort, effortKey) {
  const lvl = ai.level(effortKey);
  const client = importer.getClient();
  const usage = { model: ai.MODEL, input: 0, output: 0, extraUsd: 0 };
  const user = { role: 'user', content: `Voertuigsoort: ${SOORTEN[soort] || SOORTEN.personenauto}\nVraag van de monteur: ${vraag}` };
  let messages = [user];
  let response;
  const content = [];
  let searched = 0; let fetched = 0;
  for (let i = 0; i < 6; i++) {
    try {
      response = await client.beta.messages.create({
        model: ai.MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        output_config: { effort: ai.LEVELS[lvl].effort },
        tools: [
          { type: 'web_search_20260209', name: 'web_search', max_uses: Math.max(1, SEARCHES[lvl] - searched), allowed_domains: DOMAINS },
          { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: Math.max(1, FETCHES[lvl] - fetched), allowed_domains: DOMAINS },
        ],
        messages,
      });
    } catch (err) {
      if (usage.input) throw Object.assign(importer.apiError(err, 'claude'), { usage });
      throw importer.apiError(err, 'claude');
    }
    const u = importer.usageOf(response);
    usage.model = u.model; usage.input += u.input; usage.output += u.output;
    const st = (response.usage && response.usage.server_tool_use) || {};
    usage.extraUsd += (st.web_search_requests || 0) * SEARCH_USD;
    searched += st.web_search_requests || 0; fetched += st.web_fetch_requests || 0;
    content.push(...response.content);
    if (response.stop_reason !== 'pause_turn') break;
    messages = [user, { role: 'assistant', content: [...content] }];
  }
  const billed = (msg) => Object.assign(new ApkVraagError(msg), { usage });
  if (response.stop_reason === 'refusal') throw billed('Claude kon deze vraag niet beantwoorden.');
  if (response.stop_reason === 'max_tokens') throw billed('Het antwoord van Claude werd afgebroken. Probeer het opnieuw.');

  // Wat Claude echt gevonden en geopend heeft (alleen rdw.nl): daarmee controleren we de bronnen in het antwoord.
  const seen = new Map();
  for (const block of content) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) if (r && r.url && isRdw(r.url)) seen.set(r.url, r.title || r.url);
    }
    if (block.type === 'web_fetch_tool_result' && block.content && block.content.url && isRdw(block.content.url)) {
      const doc = block.content.content || {};
      seen.set(block.content.url, (doc.title || block.content.url));
    }
    if (block.type === 'text' && Array.isArray(block.citations)) {
      for (const c of block.citations) if (c && c.url && isRdw(c.url)) seen.set(c.url, c.title || c.url);
    }
  }
  const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let p;
  try { p = parseLastJson(text); } catch { throw billed('Het antwoord van Claude kon niet worden gelezen. Probeer het opnieuw.'); }
  const norm = (u) => String(u || '').replace(/[#?].*$/, '').replace(/\/$/, '');
  const seenNorm = new Map([...seen].map(([u, t]) => [norm(u), { u, t }]));
  const bronnen = [];
  for (const b of Array.isArray(p.bronnen) ? p.bronnen : []) {
    const hit = seenNorm.get(norm(b && b.url));
    if (hit && !bronnen.some((x) => x.url === hit.u)) bronnen.push({ url: hit.u, title: clean((b && b.titel) || hit.t, 160) });
  }
  // Genoemde bron niet echt bezocht? Dan de geopende/gevonden RDW-pagina's laten zien (nooit een verzonnen link).
  if (!bronnen.length) for (const [u, t] of seen) { if (bronnen.length >= 4) break; bronnen.push({ url: u, title: clean(t, 160) }); }
  const oordeel = OORDELEN[String(p.oordeel || '').toLowerCase()] ? String(p.oordeel).toLowerCase() : 'onbekend';
  const list = (v, n, len) => (Array.isArray(v) ? v : []).slice(0, n).map((x) => clean(x, len)).filter(Boolean);
  const data = {
    kort: clean(p.kort, 300),
    uitleg: clean(p.uitleg, 1500),
    eis: { titel: clean(p.eis && p.eis.titel, 200), tekst: clean(p.eis && p.eis.tekst, 1500) },
    voorwaarden: list(p.voorwaarden, 6, 300),
    tips: list(p.tips, 3, 300),
  };
  // Zonder één echte RDW-bron geen stellig oordeel.
  const finalOordeel = bronnen.length ? oordeel : 'onbekend';
  return { usage, result: { oordeel: finalOordeel, data, sources: bronnen.slice(0, 6) } };
}

function create({ vraag, soort, effort, userId }) {
  const v = String(vraag || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (v.length < 8) throw new ApkVraagError('Typ een vraag, bijvoorbeeld: "Is speling in een stabilisatorstangetje afkeur?"');
  const s = SOORTEN[soort] ? soort : 'personenauto';
  return Number(db.prepare('INSERT INTO apk_questions (vraag, soort, effort, by_user) VALUES (?, ?, ?, ?)').run(v, s, ai.level(effort), userId).lastInsertRowid);
}

/** Vraag beantwoorden (op de achtergrond); werkt de rij bij. */
async function answer(id, userId) {
  const q = db.prepare('SELECT * FROM apk_questions WHERE id = ?').get(id);
  if (!q) return;
  try {
    if (!importer.isConfigured()) throw new ApkVraagError('Claude is niet ingesteld: vul anthropic-api-key in config.properties in.');
    const r = await importer.metered(userId, () => ask(q.vraag, q.soort, q.effort), { kind: 'apkvraag', effort: q.effort, limited: false });
    db.prepare("UPDATE apk_questions SET status = 'klaar', oordeel = ?, data = ?, sources = ?, eur = ? WHERE id = ?")
      .run(r.result.oordeel, JSON.stringify(r.result.data), JSON.stringify(r.result.sources), r.usage.eur || 0, id);
  } catch (err) {
    if (!(err instanceof ApkVraagError || err instanceof importer.ImportError)) console.error('APK-vraag:', err);
    db.prepare("UPDATE apk_questions SET status = 'mislukt', error = ?, eur = ? WHERE id = ?")
      .run(String(err.message || 'Er ging iets mis.').slice(0, 500), (err.usage && err.usage.eur) || 0, id);
  }
}

function get(id) {
  const r = db.prepare('SELECT q.*, u.name AS by_name FROM apk_questions q LEFT JOIN users u ON u.id = q.by_user WHERE q.id = ?').get(id);
  if (!r) return null;
  try { r.data = JSON.parse(r.data); } catch { r.data = {}; }
  try { r.sources = JSON.parse(r.sources); } catch { r.sources = []; }
  return r;
}
function recent(q = '', limit = 40) {
  const term = String(q || '').trim();
  const where = term ? 'WHERE vraag LIKE ?' : '';
  return db.prepare(`SELECT q.id, q.vraag, q.soort, q.status, q.oordeel, q.created_at, u.name AS by_name FROM apk_questions q
    LEFT JOIN users u ON u.id = q.by_user ${where} ORDER BY q.id DESC LIMIT ?`).all(...(term ? [`%${term}%`, limit] : [limit]));
}
function remove(id) { db.prepare('DELETE FROM apk_questions WHERE id = ?').run(id); }
// Na een herstart kan een vraag niet meer "bezig" zijn.
db.prepare("UPDATE apk_questions SET status = 'mislukt', error = 'Onderbroken door een herstart van ADONIS. Stel de vraag opnieuw.' WHERE status = 'bezig'").run();

module.exports = { ApkVraagError, SOORTEN, OORDELEN, estimate, create, answer, get, recent, remove };
