'use strict';
/**
 * Portaal: mappen met snelkoppelingen naar websites (leveranciers, RDW, bank...), voor de hele garage.
 * Bij het toevoegen haalt ADONIS zelf de naam en het pictogram van de website op en bewaart dat pictogram
 * in <datamap>/portaal-iconen (zodat de pagina geen externe afbeeldingen hoeft te laden).
 */
const fs = require('node:fs');
const path = require('node:path');
const { db, DATA_DIR } = require('./db');
const buildinfo = require('./buildinfo');

const ICON_DIR = path.join(DATA_DIR, 'portaal-iconen');
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 ADONIS/${buildinfo.version || 'dev'}`;
const MAX_HTML = 512 * 1024;
const MAX_ICON = 512 * 1024;

db.exec(`
  CREATE TABLE IF NOT EXISTS portal_folders (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS portal_links (
    id INTEGER PRIMARY KEY,
    folder_id INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '',          -- bestandsnaam in portaal-iconen ('' = nog geen)
    icon_status TEXT NOT NULL DEFAULT '',   -- '' (nog ophalen) | ok | geen
    sort INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS portal_links_folder ON portal_links(folder_id, sort);
`);
// Zoekadres met kenteken, bijv. https://site.nl/zoek?licensePlate={kenteken-klein}
if (!db.prepare('PRAGMA table_info(portal_links)').all().some((c) => c.name === 'search_url')) {
  db.exec("ALTER TABLE portal_links ADD COLUMN search_url TEXT NOT NULL DEFAULT ''");
}
const plates = require('./plates');

class PortalError extends Error {}

/* ---------- adressen ---------- */
/** "rdw.nl" -> "https://rdw.nl/". Alleen http(s). */
function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new PortalError('Vul een internetadres in.');
  if (/^(javascript|data|file|vbscript):/i.test(s)) throw new PortalError('Dat is geen internetadres.');
  if (!/^https?:\/\//i.test(s)) s = (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(s) ? 'http://' : 'https://') + s.replace(/^\/+/, '');
  let u;
  try { u = new URL(s); } catch { throw new PortalError(`"${String(input).slice(0, 60)}" is geen geldig internetadres.`); }
  if (!['http:', 'https:'].includes(u.protocol) || !u.hostname || !/[.:]|^localhost$/i.test(u.host)) throw new PortalError(`"${String(input).slice(0, 60)}" is geen geldig internetadres.`);
  return u.href.slice(0, 2000);
}
function hostTitle(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\d?\./i, '');
    const base = h.split('.').slice(0, -1).join('.') || h;
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch { return url; }
}
/** Kleur voor het lettertegeltje (als er geen pictogram is), vast per website. */
function colorIndex(url) {
  let h = 0;
  for (const c of (() => { try { return new URL(url).hostname; } catch { return url; } })()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 8;
}

/* ---------- lezen ---------- */
function listAll() {
  const folders = db.prepare('SELECT * FROM portal_folders ORDER BY sort, id').all();
  const links = db.prepare('SELECT * FROM portal_links ORDER BY sort, id').all();
  for (const f of folders) f.links = links.filter((l) => l.folder_id === f.id);
  return folders;
}
function getLink(id) { return db.prepare('SELECT * FROM portal_links WHERE id = ?').get(id); }
function getFolder(id) { return db.prepare('SELECT * FROM portal_folders WHERE id = ?').get(id); }

/* ---------- mappen ---------- */
function cleanName(name, fallback = '') {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!n && !fallback) throw new PortalError('Geef de map een naam.');
  return n || fallback;
}
function addFolder(name) {
  const n = cleanName(name);
  const max = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM portal_folders').get().m;
  return Number(db.prepare('INSERT INTO portal_folders (name, sort) VALUES (?, ?)').run(n, max + 1).lastInsertRowid);
}
function findOrAddFolder(name) {
  const n = cleanName(name, 'Websites');
  const hit = db.prepare('SELECT id FROM portal_folders WHERE name = ? COLLATE NOCASE').get(n);
  return hit ? hit.id : addFolder(n);
}
function renameFolder(id, name) {
  db.prepare('UPDATE portal_folders SET name = ? WHERE id = ?').run(cleanName(name), id);
}
function deleteFolder(id) {
  for (const l of db.prepare('SELECT icon FROM portal_links WHERE folder_id = ?').all(id)) removeIcon(l.icon);
  db.prepare('DELETE FROM portal_links WHERE folder_id = ?').run(id);
  db.prepare('DELETE FROM portal_folders WHERE id = ?').run(id);
}
/** Map een plek naar voren (-1) of naar achteren (+1). */
function moveFolder(id, dir) {
  const all = db.prepare('SELECT id FROM portal_folders ORDER BY sort, id').all().map((r) => r.id);
  const i = all.indexOf(Number(id));
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  const upd = db.prepare('UPDATE portal_folders SET sort = ? WHERE id = ?');
  all.forEach((fid, k) => upd.run(k + 1, fid));
}

/* ---------- snelkoppelingen ---------- */
function addLink(folderId, { url, title }, userId) {
  if (!getFolder(folderId)) throw new PortalError('Die map bestaat niet (meer).');
  const href = normalizeUrl(url);
  const dup = db.prepare('SELECT id FROM portal_links WHERE folder_id = ? AND url = ?').get(folderId, href);
  if (dup) return { id: dup.id, duplicate: true };
  const max = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM portal_links WHERE folder_id = ?').get(folderId).m;
  const t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const id = Number(db.prepare('INSERT INTO portal_links (folder_id, title, url, sort, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(folderId, t, href, max + 1, userId || null).lastInsertRowid);
  return { id, duplicate: false };
}
function updateLink(id, { title, url, folderId }) {
  const l = getLink(id);
  if (!l) throw new PortalError('Deze snelkoppeling bestaat niet (meer).');
  const href = url !== undefined ? normalizeUrl(url) : l.url;
  const fid = folderId && getFolder(folderId) ? Number(folderId) : l.folder_id;
  const t = title !== undefined ? String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80) : l.title;
  const sort = fid !== l.folder_id ? db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM portal_links WHERE folder_id = ?').get(fid).m + 1 : l.sort;
  const urlChanged = href !== l.url;
  db.prepare("UPDATE portal_links SET title = ?, url = ?, folder_id = ?, sort = ?, updated_at = datetime('now')" + (urlChanged ? ", icon_status = ''" : '') + ' WHERE id = ?')
    .run(t, href, fid, sort, id);
  return { urlChanged };
}
function deleteLink(id) {
  const l = getLink(id);
  if (!l) return;
  removeIcon(l.icon);
  db.prepare('DELETE FROM portal_links WHERE id = ?').run(id);
}
/** Volgorde na slepen: { folderId: [linkId, ...], ... } (een snelkoppeling kan zo ook naar een andere map). */
function reorder(map) {
  const upd = db.prepare('UPDATE portal_links SET folder_id = ?, sort = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const [fid, ids] of Object.entries(map || {})) {
      if (!getFolder(fid) || !Array.isArray(ids)) continue;
      ids.slice(0, 2000).forEach((lid, k) => { if (/^\d+$/.test(String(lid))) upd.run(Number(fid), k + 1, Number(lid)); });
    }
    db.exec('COMMIT');
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  }
}

/* ---------- naam en pictogram ophalen ---------- */
function removeIcon(name) {
  if (name && /^[\w.-]+$/.test(name)) fs.rm(path.join(ICON_DIR, name), { force: true }, () => {});
}
function iconPath(link) {
  if (!link || !link.icon || !/^[\w.-]+$/.test(link.icon)) return null;
  const p = path.join(ICON_DIR, link.icon);
  return fs.existsSync(p) ? p : null;
}
const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? '');
  return out;
}
async function readLimited(res, max) {
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
    if (n > max) { try { await reader.cancel(); } catch { /* klaar */ } break; }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}
/** Welke soort afbeelding is dit (of null)? */
function imageType(buf, contentType = '') {
  if (buf.length < 8) return null;
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString() === 'PNG') return 'png';
  if (buf.readUInt32BE(0) === 0x00000100) return 'ico';
  if (buf.subarray(0, 3).toString() === 'GIF') return 'gif';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  const text = buf.subarray(0, 2048).toString('utf8');
  if (/<svg[\s>]/i.test(text) || /svg/i.test(contentType)) return /<svg[\s>]/i.test(buf.toString('utf8')) ? 'svg' : null;
  return null;
}
/* De server haalt titel en pictogram op namens de gebruiker. Dat mag niet bij zichzelf of bij interne adressen uitkomen
 * (localhost, 169.254.x.x zoals cloud-metadata, "0.0.0.0"): zo'n link blijft gewoon werken, alleen zonder pictogram.
 * Adressen in het eigen netwerk (10.x, 192.168.x) mogen wél: een garage heeft daar bijv. een NAS of printer staan. */
const dns = require('node:dns').promises;
function isInternalIp(ip) {
  if (!ip) return true;
  const v4 = ip.replace(/^::ffff:/i, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) { const [a, b] = v4.split('.').map(Number); return a === 127 || a === 0 || (a === 169 && b === 254); }
  return /^(::1|::|fe80:|fc|fd)/i.test(ip);
}
async function blocked(url) {
  let host;
  try { host = new URL(url).hostname.replace(/^\[|\]$/g, ''); } catch { return true; }
  if (/^localhost$/i.test(host) || /\.localhost$/i.test(host)) return true;
  try {
    const addrs = await dns.lookup(host, { all: true, verbatim: true });
    return !addrs.length || addrs.some((x) => isInternalIp(x.address));
  } catch { return true; } // onbekende naam: er is toch niets op te halen
}
async function get(url, accept) {
  if (await blocked(url)) throw new PortalError('intern adres');
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'nl,en;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
  if (res.url && res.url !== url && await blocked(res.url)) throw new PortalError('intern adres'); // ook na doorsturen
  return res;
}
/** Pagina lezen: titel en pictogram-kandidaten (beste eerst). */
async function inspect(url) {
  const out = { title: '', icons: [], finalUrl: url };
  try {
    const res = await get(url, 'text/html,application/xhtml+xml');
    out.finalUrl = res.url || url;
    if (res.ok && /html/i.test(res.headers.get('content-type') || 'text/html')) {
      const html = (await readLimited(res, MAX_HTML)).toString('utf8');
      const head = html.slice(0, html.search(/<\/head>/i) > 0 ? html.search(/<\/head>/i) : MAX_HTML);
      const og = /<meta[^>]+property=["']og:site_name["'][^>]*>/i.exec(head);
      const t = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(head);
      out.title = decode((og && attrs(og[0]).content) || (t && t[1]) || '').replace(/\s+/g, ' ').trim();
      const cands = [];
      for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
        const a = attrs(m[0]);
        const rel = (a.rel || '').toLowerCase();
        if (!a.href || !/(^|\s)(icon|apple-touch-icon|apple-touch-icon-precomposed|mask-icon)(\s|$)/.test(rel) || /mask-icon/.test(rel)) continue;
        let size = 0;
        const s = /(\d+)x(\d+)/.exec(a.sizes || '');
        if (s) size = +s[1]; else if (/any/i.test(a.sizes || '') || /\.svg(\?|$)/i.test(a.href) || /svg/i.test(a.type || '')) size = 150;
        if (/apple-touch-icon/.test(rel)) size = Math.max(size, 180);
        if (!size) size = 32;
        try { cands.push({ href: new URL(a.href, out.finalUrl).href, score: size > 256 ? 256 - (size - 256) / 10 : size }); } catch { /* ongeldig */ }
      }
      out.icons = cands.sort((x, y) => y.score - x.score).map((c) => c.href);
    }
  } catch { /* site niet bereikbaar: dan alleen de standaardplekken */ }
  try { out.icons.push(new URL('/favicon.ico', out.finalUrl).href); } catch { /* niets */ }
  try { out.icons.push(`https://icons.duckduckgo.com/ip3/${new URL(out.finalUrl).hostname}.ico`); } catch { /* niets */ }
  out.icons = [...new Set(out.icons)].filter((u) => /^https?:/i.test(u));
  return out;
}
async function download(url) {
  try {
    const res = await get(url, 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5');
    if (!res.ok) return null;
    const buf = await readLimited(res, MAX_ICON + 1);
    if (buf.length > MAX_ICON) return null;
    const type = imageType(buf, res.headers.get('content-type') || '');
    return type ? { buf, type } : null;
  } catch { return null; }
}
const running = new Set();
/** Naam (als die nog leeg is) en pictogram ophalen en bewaren. */
async function fetchMeta(id, { force = false } = {}) {
  if (running.has(id)) return;
  running.add(id);
  try {
    const l = getLink(id);
    if (!l || (!force && l.icon_status && l.title)) return;
    const info = await inspect(l.url);
    const now = getLink(id);
    if (!now) return;
    if (!now.title) db.prepare('UPDATE portal_links SET title = ? WHERE id = ?').run((info.title || hostTitle(now.url)).slice(0, 80), id);
    if (now.icon_status === 'ok' && !force && iconPath(now)) return;
    let got = null;
    for (const u of info.icons.slice(0, 6)) { got = await download(u); if (got) break; }
    if (got) {
      fs.mkdirSync(ICON_DIR, { recursive: true });
      const name = `${id}-${Date.now().toString(36)}.${got.type}`;
      fs.writeFileSync(path.join(ICON_DIR, name), got.buf);
      removeIcon(now.icon);
      db.prepare("UPDATE portal_links SET icon = ?, icon_status = 'ok', updated_at = datetime('now') WHERE id = ?").run(name, id);
    } else {
      db.prepare("UPDATE portal_links SET icon_status = 'geen', updated_at = datetime('now') WHERE id = ?").run(id);
    }
  } finally {
    running.delete(id);
  }
}
/** Een rij snelkoppelingen op de achtergrond afwerken (bijv. na een import), drie tegelijk. */
const queue = [];
let active = 0;
let onIdle = null;
function enqueue(ids, done) {
  queue.push(...ids);
  if (done) onIdle = done;
  pump();
}
function pump() {
  while (active < 3 && queue.length) {
    const id = queue.shift();
    active++;
    fetchMeta(id).catch(() => {}).finally(() => {
      active--;
      if (!queue.length && !active && onIdle) { const f = onIdle; onIdle = null; f(); } else pump();
    });
  }
}
/** Pictogrammen die er (bijv. na het terugzetten van een backup) niet meer zijn: opnieuw ophalen. */
function repairMissing() {
  const missing = db.prepare("SELECT id, icon FROM portal_links WHERE icon_status = 'ok'").all().filter((l) => !iconPath(l)).map((l) => l.id);
  const todo = db.prepare("SELECT id FROM portal_links WHERE icon_status = ''").all().map((l) => l.id);
  if (missing.length) db.prepare(`UPDATE portal_links SET icon_status = '' WHERE id IN (${missing.map(() => '?').join(',')})`).run(...missing);
  return [...missing, ...todo];
}

/* ---------- zoeken met het kenteken van de klant ---------- */
const PLACEHOLDERS = ['{kenteken}', '{kenteken-klein}', '{kenteken-streepjes}', '{kenteken-streepjes-klein}'];
/**
 * Van een voorbeeldadres (een zoekresultaat op die website voor een willekeurig kenteken) een sjabloon maken:
 * het kenteken in het adres wordt vervangen door {kenteken…}, in dezelfde schrijfwijze (hoofd/klein, met/zonder streepjes).
 * Een adres waar al {kenteken} in staat, wordt zo overgenomen.
 */
function plateTemplate(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (PLACEHOLDERS.some((p) => raw.includes(p))) return normalizeUrl(raw.replace(/\{/g, '%7B').replace(/\}/g, '%7D')).replace(/%7B/gi, '{').replace(/%7D/gi, '}');
  const href = normalizeUrl(raw);
  let decoded = href;
  try { decoded = decodeURI(href); } catch { /* laat staan */ }
  const u = new URL(href);
  const hostLen = u.origin.length;
  // Kandidaten: stukjes van 6–8 tekens met letters en cijfers (en eventueel streepjes), na de domeinnaam.
  let best = null;
  for (const m of decoded.matchAll(/[A-Za-z0-9]{1,3}-?[A-Za-z0-9]{1,3}-?[A-Za-z0-9]{1,3}/g)) {
    const t = m[0];
    if (m.index < hostLen || t.replace(/-/g, '').length !== 6 || !/\d/.test(t) || !/[a-z]/i.test(t)) continue;
    const before = decoded[m.index - 1] || ''; const after = decoded[m.index + t.length] || '';
    if (/[A-Za-z0-9]/.test(before) || /[A-Za-z0-9]/.test(after)) continue; // midden in een langer woord
    const info = plates.plateInfo(t);
    if (info.country !== 'NL') continue;
    best = { t, index: m.index, dashes: t.includes('-'), lower: t === t.toLowerCase() };
  }
  if (!best) throw new PortalError('In dit adres staat geen (Nederlands) kenteken. Zoek op die website eerst een kenteken op en kopieer dan het adres uit de adresbalk.');
  const ph = `{kenteken${best.dashes ? '-streepjes' : ''}${best.lower ? '-klein' : ''}}`;
  return decoded.slice(0, best.index) + ph + decoded.slice(best.index + best.t.length);
}
/** Het sjabloon invullen met een kenteken. */
function fillPlate(template, kenteken) {
  const info = plates.plateInfo(kenteken);
  const key = info.key || String(kenteken || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const text = info.country === 'NL' ? info.text : key;
  const v = { '{kenteken}': key, '{kenteken-klein}': key.toLowerCase(), '{kenteken-streepjes}': text, '{kenteken-streepjes-klein}': text.toLowerCase() };
  return template.replace(/\{kenteken(-streepjes)?(-klein)?\}/g, (m) => encodeURIComponent(v[m] || key));
}
function setSearchUrl(id, input) {
  const tpl = plateTemplate(input);
  db.prepare("UPDATE portal_links SET search_url = ?, updated_at = datetime('now') WHERE id = ?").run(tpl, id);
  return tpl;
}
/** Websites waarop met een kenteken kan worden gezocht, ingevuld voor dit kenteken. */
function plateLinks(kenteken) {
  if (!kenteken) return [];
  return db.prepare("SELECT l.*, f.name AS folder FROM portal_links l JOIN portal_folders f ON f.id = l.folder_id WHERE l.search_url <> '' ORDER BY f.sort, l.sort, l.id").all()
    .map((l) => ({ id: l.id, title: l.title || hostTitle(l.url), icon: l.icon_status === 'ok' ? l.id : null, updated_at: l.updated_at, color: colorIndex(l.url), href: fillPlate(l.search_url, kenteken) }));
}

module.exports = {
  plateTemplate, fillPlate, setSearchUrl, plateLinks,
  PortalError, ICON_DIR, normalizeUrl, hostTitle, colorIndex, listAll, getLink, getFolder,
  addFolder, findOrAddFolder, renameFolder, deleteFolder, moveFolder,
  addLink, updateLink, deleteLink, reorder, fetchMeta, enqueue, iconPath, repairMissing, imageType,
};
