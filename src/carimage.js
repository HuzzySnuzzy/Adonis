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
const NOISE = /^(\d[.,]\d|\d+(kw|pk|v)|tdi|tsi|tfsi|fsi|cdi|crdi|hdi|dci|tdci|cdti|vti|vtec|gti|gtd|gt|turbo|diesel|benzine|hybrid|aut|automaat|automatic|cvt|dsg|abt|business|edition|comfort|style|plus|sport|base|lpg|cng|4x4|4wd|awd|\d+d|\d+i)$/i;
/** Merk en model uit de RDW-gegevens of het veld Merk/Type -> zoekterm, bijv. "Nissan Note". */
function queryFor(merk, model) {
  const m = String(merk || '').trim();
  let words = String(model || '').replace(/[()]/g, ' ').split(/\s+/).filter(Boolean);
  if (m && words[0] && words[0].toLowerCase() === m.toLowerCase()) words = words.slice(1);
  words = words.filter((w) => !NOISE.test(w)).slice(0, 2);
  if (!words.length || (!m && words.length < 2)) return ''; // alleen een merk: geen herkenbaar model
  return [m, ...words].join(' ').replace(/\s+/g, ' ').trim();
}
const keyOf = (q) => String(q || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);

function cached(q) {
  const key = keyOf(q);
  if (!key) return null;
  const row = db.prepare('SELECT * FROM car_images WHERE key = ?').get(key);
  if (!row) return null;
  const age = Date.now() - row.fetched_at;
  const fresh = row.status === 'ok' ? age < OK_DAYS * 864e5 && fs.existsSync(path.join(DIR, row.id + '.jpg'))
    : row.status === 'none' ? age < NONE_DAYS * 864e5 : age < ERROR_MINUTES * 6e4;
  return fresh ? row : null;
}
function publicInfo(row) {
  if (!row || row.status !== 'ok') return { ok: false };
  return { ok: true, img: `/autofoto/img/${row.id}`, title: row.title, pageUrl: row.page_url, fileUrl: row.file_url };
}

async function getJson(params) {
  const url = API + '?' + new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('Wikipedia antwoordde met ' + res.status);
  return res.json();
}

/** Beste artikel voor het model: het merk moet in de titel staan, het model liefst ook; met foto. */
function pick(pages, q) {
  const [brand, ...model] = q.toLowerCase().split(' ');
  const scored = (pages || [])
    .filter((p) => p.thumbnail && p.thumbnail.source && p.title.toLowerCase().includes(brand))
    .map((p) => {
      const t = p.title.toLowerCase();
      let score = 100 - (p.index || 50);
      for (const w of model) if (t.includes(w)) score += 50;
      if (/\(disambiguation\)|list of|logo/i.test(p.title)) score -= 200;
      if (/\.svg$/i.test(p.pageimage || '')) score -= 80; // meestal een logo, geen auto
      return { p, score };
    })
    .filter((x) => x.score > 0 || !model.length)
    .sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].p : null;
}

const inFlight = new Map();
async function lookup(q) {
  const key = keyOf(q);
  if (!key) return { ok: false };
  const hit = cached(q);
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
      const data = await getJson({
        action: 'query', generator: 'search', gsrsearch: q, gsrlimit: '8', gsrnamespace: '0',
        prop: 'pageimages|info', piprop: 'thumbnail|name', pithumbsize: '640', inprop: 'url',
      });
      const page = pick(data && data.query && data.query.pages, key);
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

function imagePath(id) {
  if (!/^[a-f0-9]{20}p?$/.test(String(id))) return null;
  const file = path.join(DIR, id + '.jpg');
  return fs.existsSync(file) ? { file, type: id.endsWith('p') ? 'image/png' : 'image/jpeg' } : null;
}

module.exports = { queryFor, cached, publicInfo, lookup, imagePath };
