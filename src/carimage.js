'use strict';
/**
 * Foto van het automodel (bijv. "Nissan Note") op de klantpagina, om de auto snel te herkennen.
 * Gratis en zonder sleutel: het Wikipedia-artikel over het model en de hoofdfoto daarvan (Wikimedia Commons,
 * vrije licentie). Alleen merk en model worden opgevraagd, nooit het kenteken of de klant.
 * De foto wordt één keer opgehaald en daarna vanaf deze computer getoond (ook zonder internet).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, DATA_DIR } = require('./db');
const buildinfo = require('./buildinfo');

const API = process.env.WERKOPDRACHTEN_WIKI_API || 'https://en.wikipedia.org/w/api.php';
const DIR = path.join(DATA_DIR, 'autofotos');
fs.mkdirSync(DIR, { recursive: true });
const OK_DAYS = 90;
const NONE_DAYS = 30;
const ERROR_MINUTES = 60;
const MAX_BYTES = 2 * 1024 * 1024;
const UA = `ADONIS-werkopdrachten/${buildinfo.version || 'dev'} (garage work orders; https://github.com/HuzzySnuzzy/Adonis)`;

db.exec(`
CREATE TABLE IF NOT EXISTS car_images (
  key        TEXT PRIMARY KEY,         -- "nissan note"
  status     TEXT NOT NULL,            -- 'ok', 'none' (niets gevonden) of 'error' (tijdelijk niet bereikbaar)
  id         TEXT NOT NULL DEFAULT '', -- bestandsnaam in de map autofotos (zonder .jpg)
  title      TEXT NOT NULL DEFAULT '', -- titel van het Wikipedia-artikel
  page_url   TEXT NOT NULL DEFAULT '',
  file_url   TEXT NOT NULL DEFAULT '', -- pagina van de foto op Wikimedia Commons (licentie en maker)
  fetched_at INTEGER NOT NULL
);
`);

// Motoraanduidingen en dergelijke horen niet in de zoekvraag ("Golf Variant 1.6 TDI" -> "Golf Variant").
const NOISE = /^(\d[.,]\d|\d+(kw|pk|v)|tdi|tsi|tfsi|fsi|cdi|crdi|hdi|dci|tdci|cdti|vti|vtec|gti|gtd|gt|turbo|diesel|benzine|hybrid|aut|automaat|automatic|cvt|dsg|abt|business|edition|comfort|style|plus|sport|base|lpg|cng|4x4|4wd|awd|\d+d|\d+i|l\d|h\d|l\dh\d)$/i;
// Typecodes zoals "639" (Mercedes W639) of "111" (motorvariant): alleen een hint, geen modelnaam.
const CODE = /^[a-z]?\d{3,}[a-z]?$/i;
/**
 * Merk en model uit de RDW-gegevens of het veld Merk/Type -> zoekterm, bijv. "Nissan Note" of
 * "Mercedes-Benz Vito (639 111)" (tussen haakjes: typecodes die alleen helpen kiezen).
 */
function queryFor(merk, model) {
  const m = String(merk || '').trim();
  let words = String(model || '').replace(/[()]/g, ' ').split(/\s+/).filter(Boolean);
  if (m && words[0] && words[0].toLowerCase() === m.toLowerCase()) words = words.slice(1);
  words = words.filter((w) => !NOISE.test(w));
  let names = words.filter((w) => !CODE.test(w));
  let codes = words.filter((w) => CODE.test(w));
  if (!names.length && codes.length) { names = [codes[0]]; codes = codes.slice(1); } // Peugeot 206
  names = names.slice(0, 2);
  if (!names.length || (!m && names.length < 2)) return ''; // alleen een merk: geen herkenbaar model
  return [m, ...names].join(' ').replace(/\s+/g, ' ').trim() + (codes.length ? ` (${codes.slice(0, 3).join(' ')})` : '');
}
/** Zoekterm -> { brand, names, codes, label } */
function parseQuery(q) {
  const codes = ((/\(([^)]*)\)/.exec(q) || [])[1] || '').split(/\s+/).filter(Boolean);
  const words = q.replace(/\([^)]*\)/, '').trim().split(/\s+/);
  return { brand: words[0] || '', names: words.slice(1), codes, label: words.join(' ') };
}
const VERSION = 'v2|'; // andere zoekregels: oude (mogelijk verkeerde) resultaten niet meer gebruiken
const keyOf = (q) => VERSION + String(q || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function cachedKey(key) {
  if (!key || key === VERSION) return null;
  const row = db.prepare('SELECT * FROM car_images WHERE key = ?').get(key);
  if (!row) return null;
  const age = Date.now() - row.fetched_at;
  const fresh = row.status === 'blocked' ? true
    : row.status === 'ok' ? age < OK_DAYS * 864e5 && fs.existsSync(path.join(DIR, row.id + '.jpg'))
    : row.status === 'none' ? age < NONE_DAYS * 864e5 : age < ERROR_MINUTES * 6e4;
  return fresh ? row : null;
}
const cached = (q) => cachedKey(keyOf(q));
function publicInfo(row) {
  if (!row || row.status !== 'ok') return { ok: false, blocked: Boolean(row && row.status === 'blocked') };
  return { ok: true, img: `/autofoto/img/${row.id}`, title: row.title, pageUrl: row.page_url, fileUrl: row.file_url };
}

async function getJson(params) {
  const url = API + '?' + new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('Wikipedia antwoordde met ' + res.status);
  return res.json();
}

/**
 * Beste artikel voor het model. Het merk én het model moeten in de titel staan ("Mercedes-Benz Vito ..."), anders
 * liever geen foto dan een verkeerde. Een titel met de typecode (bijv. "W639") gaat voor.
 */
function pick(pages, q) {
  const { brand, names, codes } = parseQuery(q);
  const b = squash(brand.split('-')[0]); // "Mercedes-Benz" -> "mercedes"
  const main = squash(names[0]);
  const scored = (pages || [])
    .filter((p) => p.thumbnail && p.thumbnail.source)
    .map((p) => ({ p, t: squash(p.title), tokens: p.title.toLowerCase().split(/[^a-z0-9]+/) }))
    // Het model als heel woord ("Up" niet in "Group"), of direct achter het merk ("Mercedes-Benz Vito").
    .filter(({ t, tokens }) => t.includes(b) && main && (tokens.includes(main) || t.includes(squash(brand) + main)))
    .map(({ p, t }) => {
      let score = 100 - (p.index || 50);
      for (const w of names.slice(1)) if (t.includes(squash(w))) score += 40;
      for (const c of codes) if (t.includes(squash(c))) score += 60;
      if (/\(disambiguation\)|list of|logo|concept/i.test(p.title)) score -= 300;
      if (/\.svg$/i.test(p.pageimage || '')) score -= 300; // meestal een logo, geen auto
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b2) => b2.score - a.score);
  return scored.length ? scored[0].p : null;
}

/** "Verkeerde auto": nooit meer een foto tonen voor dit model. */
function block(q) {
  const key = keyOf(q);
  if (!key || key === VERSION) return;
  db.prepare(`INSERT INTO car_images (key, status, fetched_at) VALUES (?, 'blocked', ?)
              ON CONFLICT(key) DO UPDATE SET status = 'blocked', fetched_at = excluded.fetched_at`).run(key, Date.now());
}

const inFlight = new Map();
/**
 * Gedeeld door auto's en onderdelen: in de cache kijken, anders finder() laten zoeken (geeft een Wikipedia-pagina
 * met thumbnail, of null), de foto downloaden en lokaal bewaren.
 */
async function resolve(key, finder) {
  if (!key) return { ok: false };
  const hit = cachedKey(key);
  if (hit) return publicInfo(hit);
  if (inFlight.has(key)) return inFlight.get(key);
  const job = (async () => {
    const save = (row) => {
      db.prepare(`INSERT INTO car_images (key, status, id, title, page_url, file_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(key) DO UPDATE SET status = excluded.status, id = excluded.id, title = excluded.title,
                  page_url = excluded.page_url, file_url = excluded.file_url, fetched_at = excluded.fetched_at`)
        .run(key, row.status, row.id || '', row.title || '', row.page_url || '', row.file_url || '', Date.now());
      return db.prepare('SELECT * FROM car_images WHERE key = ?').get(key);
    };
    try {
      const page = await finder();
      if (!page) return publicInfo(save({ status: 'none' }));
      const imgRes = await fetch(page.thumbnail.source, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
      if (!imgRes.ok) throw new Error('foto niet bereikbaar');
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
      const isPng = buf.subarray(0, 4).toString('hex') === '89504e47';
      if ((!isJpeg && !isPng) || buf.length > MAX_BYTES) return publicInfo(save({ status: 'none' }));
      const id = crypto.createHash('sha1').update(key).digest('hex').slice(0, 20) + (isPng ? 'p' : '');
      fs.writeFileSync(path.join(DIR, id + '.jpg'), buf);
      return publicInfo(save({
        status: 'ok', id, title: page.title,
        page_url: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
        file_url: page.pageimage ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(page.pageimage)}` : '',
      }));
    } catch (err) {
      save({ status: 'error' });
      return { ok: false, offline: true };
    }
  })();
  inFlight.set(key, job);
  try { return await job; } finally { inFlight.delete(key); }
}

/* ---------- auto's ---------- */
async function lookup(q) {
  return resolve(keyOf(q), async () => {
    const { brand, names, codes } = parseQuery(q);
    const search = (term) => getJson({
      action: 'query', generator: 'search', gsrsearch: term, gsrlimit: '10', gsrnamespace: '0',
      prop: 'pageimages|info', piprop: 'thumbnail|name', pithumbsize: '640', inprop: 'url',
    }).then((d) => (d && d.query && d.query.pages) || []);
    // Wikipedia zoekt met EN: eerst merk + model, en apart met de typecode (vindt bijv. "Vito (W639)").
    const terms = [`intitle:"${names[0]}" ${brand}`];
    if (codes[0]) terms.push(`intitle:"${names[0]}" ${codes[0]}`);
    const seen = new Map();
    for (const term of terms) for (const p of await search(term)) if (!seen.has(p.title)) seen.set(p.title, p);
    let page = pick([...seen.values()], q);
    if (!page) page = pick(await search(`${brand} ${names.join(' ')}`), q);
    return page;
  });
}

/* ---------- onderdelen: een voorbeeldfoto van de soort onderdeel ----------
 * Geen zoekopdracht maar een vaste artikeltitel: zo kan er geen willekeurig verkeerd artikel uitkomen.
 * Woorden zoals ze in een Nederlandse garage worden gebruikt -> Engelse Wikipedia-titel (meer en betere foto's). */
const PART_TITLES = {
  bougie: 'Spark plug', gloeibougie: 'Glowplug', oliefilter: 'Oil filter', luchtfilter: 'Air filter',
  brandstoffilter: 'Fuel filter', dieselfilter: 'Fuel filter', interieurfilter: 'Cabin air filter', pollenfilter: 'Cabin air filter',
  riem: 'Serpentine belt', microv: 'Serpentine belt', polyvriem: 'Serpentine belt', vriem: 'Serpentine belt', multiriem: 'Serpentine belt',
  distributieriem: 'Timing belt (camshaft)', tandriem: 'Timing belt (camshaft)', powergrip: 'Timing belt (camshaft)', distributieketting: 'Timing chain',
  remblokken: 'Brake pad', remblok: 'Brake pad', remschijf: 'Disc brake', remschijven: 'Disc brake', remschoenen: 'Drum brake', remtrommel: 'Drum brake',
  remklauw: 'Disc brake', remtang: 'Disc brake', pakking: 'Gasket', koppakking: 'Head gasket', kleppendekselpakking: 'Gasket',
  thermostaat: 'Thermostat', waterpomp: 'Water pump', radiateur: 'Radiator (engine cooling)', koelvloeistof: 'Antifreeze',
  bobine: 'Ignition coil', penbobine: 'Ignition coil', stroomverdelerkap: 'Distributor', stroomverdeler: 'Distributor', rotor: 'Distributor', distrotor: 'Distributor',
  dynamo: 'Alternator (automotive)', startmotor: 'Starter (engine)', accu: 'Automotive battery',
  lambdasonde: 'Oxygen sensor', lambdasensor: 'Oxygen sensor', abssensor: 'Wheel speed sensor', abs: 'Anti-lock braking system',
  krukassensor: 'Crankshaft position sensor', nokkenassensor: 'Camshaft position sensor', luchtmassasensor: 'Mass flow sensor', mapsensor: 'MAP sensor',
  injector: 'Fuel injection', verstuiver: 'Fuel injection', brandstofpomp: 'Fuel pump', turbo: 'Turbocharger', turbochargerkit: 'Turbocharger',
  ashoes: 'Constant-velocity joint', ashoezen: 'Constant-velocity joint', ashoesset: 'Constant-velocity joint', homokineteas: 'Constant-velocity joint',
  fuzeekogel: 'Ball joint', fuseekogel: 'Ball joint', keerring: 'Radial shaft seal', keering: 'Radial shaft seal',
  schokbreker: 'Shock absorber', veer: 'Coil spring', stabilisatorstang: 'Anti-roll bar', antirollbar: 'Anti-roll bar',
  koppeling: 'Clutch', koppelingsplaat: 'Clutch', gasklep: 'Throttle', relais: 'Relay', zekering: 'Fuse (electrical)',
  ruitenwisser: 'Windscreen wiper', wisserblad: 'Windscreen wiper', lamp: 'Automotive lighting', uitlaat: 'Exhaust system',
  katalysator: 'Catalytic converter', roetfilter: 'Diesel particulate filter', aircodroger: 'Automobile air conditioning', condensator: 'Capacitor',
  wikkelveer: 'Clockspring', bougiekabels: 'Spark plug', bobinekabel: 'Ignition coil', antenne: 'Antenna (radio)', spiegelkap: 'Wing mirror',
};
const squashNl = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
/** Soort onderdeel -> vaste artikeltitel ({ lang, title }) of null. */
function partTarget(type) {
  const t = squashNl(type);
  if (t.length < 3) return null;
  if (PART_TITLES[t]) return { lang: 'en', title: PART_TITLES[t] };
  // "Olie Filter, Olie, Interieur Filter" -> begint met "oliefilter"; langste passende sleutel wint.
  const keys = Object.keys(PART_TITLES).filter((k) => k.length >= 4 && t.startsWith(k)).sort((a, b) => b.length - a.length);
  if (keys.length) return { lang: 'en', title: PART_TITLES[keys[0]] };
  // Onbekend woord: alleen één los woord, en alleen als dat precies een Nederlands artikel is (bijv. "Stofzuigzak").
  const first = String(type).trim().split(/[,/(]/)[0].trim();
  if (!/^[a-zà-ÿ-]{4,30}$/i.test(first)) return null;
  return { lang: 'nl', title: first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() };
}
async function lookupPart(type) {
  const target = partTarget(type);
  if (!target) return { ok: false };
  const key = VERSION + `part|${target.lang}|${target.title.toLowerCase()}`;
  return resolve(key, async () => {
    const api = target.lang === 'nl' ? API.replace('//en.', '//nl.') : API;
    const url = api + '?' + new URLSearchParams({
      format: 'json', formatversion: '2', action: 'query', titles: target.title, redirects: '1',
      prop: 'pageimages|info|pageprops', piprop: 'thumbnail|name', pithumbsize: '480', inprop: 'url', ppprop: 'disambiguation',
    });
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('Wikipedia antwoordde met ' + res.status);
    const d = await res.json();
    const page = d && d.query && d.query.pages && d.query.pages[0];
    if (!page || page.missing || (page.pageprops && 'disambiguation' in page.pageprops)) return null;
    if (!page.thumbnail || /\.svg$/i.test(page.pageimage || '')) return null; // geen foto of alleen een tekening/logo
    return page;
  });
}
function blockPart(type) {
  const target = partTarget(type);
  if (!target) return;
  const key = VERSION + `part|${target.lang}|${target.title.toLowerCase()}`;
  db.prepare(`INSERT INTO car_images (key, status, fetched_at) VALUES (?, 'blocked', ?)
              ON CONFLICT(key) DO UPDATE SET status = 'blocked', fetched_at = excluded.fetched_at`).run(key, Date.now());
}
/** Voor de lijst: bekende foto's per soort (zonder te zoeken). */
function cachedPart(type) {
  const target = partTarget(type);
  if (!target) return null;
  const row = cachedKey(VERSION + `part|${target.lang}|${target.title.toLowerCase()}`);
  return row ? publicInfo(row) : null;
}

function imagePath(id) {
  if (!/^[a-f0-9]{20}p?$/.test(String(id))) return null;
  const file = path.join(DIR, id + '.jpg');
  return fs.existsSync(file) ? { file, type: id.endsWith('p') ? 'image/png' : 'image/jpeg' } : null;
}

module.exports = { queryFor, parseQuery, pick, block, cached, publicInfo, lookup, imagePath, partTarget, lookupPart, cachedPart, blockPart };
