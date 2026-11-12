'use strict';
/**
 * Foto's bij een bandenset (bandenhotel/overige opslag) of een voorraaditem.
 * De bestanden staan in <datamap>/fotos (een grote en een kleine versie, verkleind in de browser);
 * de database onthoudt bij welk record ze horen.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, DATA_DIR } = require('./db');

const DIR = path.join(DATA_DIR, 'fotos');
fs.mkdirSync(DIR, { recursive: true });
const MAX_FULL = 8 * 1024 * 1024;
const MAX_THUMB = 1024 * 1024;
const MAX_PER_RECORD = 40;
const OWNERS = { tyre: 'tyre_storage', stock: 'stock_items', order: 'orders' };

db.exec(`
CREATE TABLE IF NOT EXISTS photos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type  TEXT NOT NULL,              -- 'tyre' of 'stock'
  owner_id    INTEGER NOT NULL,
  file        TEXT NOT NULL,              -- bestandsnaam in de map fotos (zonder extensie)
  media_type  TEXT NOT NULL DEFAULT 'image/jpeg',
  bytes       INTEGER NOT NULL DEFAULT 0,
  width       INTEGER NOT NULL DEFAULT 0,
  height      INTEGER NOT NULL DEFAULT 0,
  name        TEXT NOT NULL DEFAULT '',   -- oorspronkelijke bestandsnaam
  ref         TEXT NOT NULL DEFAULT '',   -- verwijzing uit een Excel-import (kleine letters), bijv. azx1.foto.143052.jpg
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS photos_owner ON photos(owner_type, owner_id);
`);

class PhotoError extends Error {}

/** Is dit JPEG XL? (kale codestream FF 0A, of de container met "JXL ") */
function isJxl(buf) {
  return (buf[0] === 0xff && buf[1] === 0x0a) || (buf.length > 12 && buf.subarray(4, 8).toString('latin1') === 'JXL ');
}
/** data:image/jpeg;base64,... -> { type, buf } (alleen JPEG XL/JPEG/PNG/WebP, gecontroleerd op de inhoud). */
function decodeDataUrl(url, max) {
  const m = /^data:(image\/(?:jxl|jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(url || ''));
  if (!m) throw new PhotoError('Ongeldige afbeelding.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > max) throw new PhotoError('De foto is te groot.');
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf.subarray(0, 4).toString('hex') === '89504e47';
  const isWebp = buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  const jxl = isJxl(buf);
  if (!isJpeg && !isPng && !isWebp && !jxl) throw new PhotoError('Dit bestand is geen foto.');
  return { type: jxl ? 'image/jxl' : isJpeg ? 'image/jpeg' : isPng ? 'image/png' : 'image/webp', buf };
}

function ownerExists(type, id) {
  if (!OWNERS[type]) return false;
  return Boolean(db.prepare(`SELECT 1 FROM ${OWNERS[type]} WHERE id = ?`).get(id));
}

function refKey(name) {
  return path.posix.basename(String(name || '').replace(/\\/g, '/')).trim().toLowerCase();
}

function add({ type, id, full, thumb, name, ref, width, height, userId }) {
  if (!ownerExists(type, id)) throw new PhotoError('Dit record bestaat niet (meer).');
  const n = db.prepare('SELECT COUNT(*) AS n FROM photos WHERE owner_type = ? AND owner_id = ?').get(type, id).n;
  if (n >= MAX_PER_RECORD) throw new PhotoError(`Maximaal ${MAX_PER_RECORD} foto's per record.`);
  const big = decodeDataUrl(full, MAX_FULL);
  const small = thumb ? decodeDataUrl(thumb, MAX_THUMB) : big;
  const key = refKey(ref);
  if (key) {
    const dup = db.prepare('SELECT id FROM photos WHERE owner_type = ? AND owner_id = ? AND ref = ?').get(type, id, key);
    if (dup) return { id: dup.id, existed: true };
  }
  const file = crypto.randomBytes(12).toString('hex');
  fs.writeFileSync(path.join(DIR, file + '.full'), big.buf);
  fs.writeFileSync(path.join(DIR, file + '.thumb'), small.buf);
  const r = db.prepare(
    `INSERT INTO photos (owner_type, owner_id, file, media_type, bytes, width, height, name, ref, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(type, id, file, big.type, big.buf.length, Number(width) || 0, Number(height) || 0, String(name || '').slice(0, 200), key, userId);
  return { id: Number(r.lastInsertRowid), existed: false };
}

function get(id) {
  return db.prepare('SELECT p.*, u.name AS created_by_name FROM photos p LEFT JOIN users u ON u.id = p.created_by WHERE p.id = ?').get(id);
}
function filePath(photo, size) {
  return path.join(DIR, photo.file + (size === 'thumb' ? '.thumb' : '.full'));
}
function list(type, id) {
  return db.prepare('SELECT * FROM photos WHERE owner_type = ? AND owner_id = ? ORDER BY id').all(type, id);
}
/** Eerste foto en aantal per record (voor lijsten): Map(ownerId -> { id, n }). */
function firstPhotos(type) {
  const out = new Map();
  for (const r of db.prepare('SELECT owner_id, MIN(id) AS id, COUNT(*) AS n FROM photos WHERE owner_type = ? GROUP BY owner_id').all(type)) {
    out.set(r.owner_id, { id: r.id, n: r.n });
  }
  return out;
}
function remove(id) {
  const p = get(id);
  if (!p) return null;
  db.prepare('DELETE FROM photos WHERE id = ?').run(id);
  for (const size of ['full', 'thumb']) fs.rmSync(filePath(p, size), { force: true });
  return p;
}
function removeFor(type, id) {
  for (const p of list(type, id)) remove(p.id);
}

/* ---------- foto's uit een Excel-import koppelen ---------- */
const IMAGE_NAME = /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i;
/**
 * Alle fotoverwijzingen in de "overige gegevens" van geïmporteerde records:
 * Map(bestandsnaam in kleine letters -> [{ type, id, title }]), plus hoeveel er al gekoppeld zijn.
 */
function references() {
  const refs = new Map();
  const add = (key, item) => { if (!refs.has(key)) refs.set(key, []); refs.get(key).push(item); };
  const scan = (type, rows, title) => {
    for (const r of rows) {
      let extra = {};
      try { extra = JSON.parse(r.extra || '{}'); } catch { /* leeg */ }
      for (const v of Object.values(extra)) {
        for (const part of String(v).split(/[;,\n]/)) {
          const key = refKey(part);
          if (IMAGE_NAME.test(key) && !/nophoto/.test(key)) add(key, { type, id: r.id, title: title(r) });
        }
      }
    }
  };
  scan('tyre', db.prepare("SELECT id, extra, kenteken, klant_naam, label FROM tyre_storage WHERE extra <> '{}'").all(),
    (r) => [r.kenteken, r.klant_naam].filter(Boolean).join(' · ') || r.label || 'set ' + r.id);
  scan('stock', db.prepare("SELECT id, extra, merk, nummer, oe_nummer, type, maat FROM stock_items WHERE extra <> '{}'").all(),
    (r) => [r.type, r.merk, r.nummer || r.oe_nummer || r.maat].filter(Boolean).join(' · ') || 'item ' + r.id);
  const linked = new Set(db.prepare("SELECT owner_type || ':' || owner_id || ':' || ref AS k FROM photos WHERE ref <> ''").all().map((r) => r.k));
  let total = 0;
  let done = 0;
  const result = {};
  for (const [key, owners] of refs) {
    result[key] = owners.map((o) => ({ ...o, linked: linked.has(`${o.type}:${o.id}:${key}`) }));
    total += owners.length;
    done += result[key].filter((o) => o.linked).length;
  }
  return { refs: result, total, done };
}

function stats() {
  const r = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM photos').get();
  return { count: r.n, mb: Math.round((r.bytes / 1024 / 1024) * 10) / 10 };
}

/* ---------- omzetten naar JPEG XL (Systeem → Foto's) ---------- */
if (!db.prepare('PRAGMA table_info(photos)').all().some((c) => c.name === 'jxl_skip')) {
  db.exec('ALTER TABLE photos ADD COLUMN jxl_skip INTEGER NOT NULL DEFAULT 0'); // 1 = als JPEG XL niet kleiner: zo laten
}
function sizeOf(p, size) { try { return fs.statSync(filePath(p, size)).size; } catch { return 0; } }
function jxlStats() {
  const rows = db.prepare('SELECT * FROM photos').all();
  const out = { total: rows.length, jxl: 0, todo: 0, skipped: 0, bytes: 0 };
  for (const p of rows) {
    out.bytes += sizeOf(p, 'full') + sizeOf(p, 'thumb');
    if (p.media_type === 'image/jxl') out.jxl++; else if (p.jxl_skip) out.skipped++; else out.todo++;
  }
  return out;
}
function jxlTodo() {
  return db.prepare("SELECT id FROM photos WHERE media_type <> 'image/jxl' AND jxl_skip = 0 ORDER BY id").all().map((r) => r.id);
}
/** Een foto vervangen door de JPEG XL-versie (groot en klein). Alleen als hij er kleiner van wordt. */
function replaceWithJxl(id, full, thumb) {
  const p = get(id);
  if (!p) throw new PhotoError('Deze foto bestaat niet (meer).');
  if (p.media_type === 'image/jxl') return { id, already: true };
  const big = decodeDataUrl(full, MAX_FULL); const small = decodeDataUrl(thumb, MAX_THUMB);
  if (big.type !== 'image/jxl' || small.type !== 'image/jxl') throw new PhotoError('Dit is geen JPEG XL.');
  const before = sizeOf(p, 'full') + sizeOf(p, 'thumb');
  const after = big.buf.length + small.buf.length;
  if (after >= before) { db.prepare('UPDATE photos SET jxl_skip = 1 WHERE id = ?').run(id); return { id, skipped: true, before, after }; }
  // Eerst naast het origineel schrijven, dan pas vervangen (een onderbreking laat nooit een halve foto achter).
  for (const [size, b] of [['full', big.buf], ['thumb', small.buf]]) {
    fs.writeFileSync(filePath(p, size) + '.new', b);
    fs.renameSync(filePath(p, size) + '.new', filePath(p, size));
  }
  db.prepare("UPDATE photos SET media_type = 'image/jxl', bytes = ? WHERE id = ?").run(big.buf.length, id);
  return { id, before, after };
}

module.exports = {
  jxlStats, jxlTodo, replaceWithJxl, isJxl, PhotoError, OWNERS, MAX_PER_RECORD, add, get, filePath, list, firstPhotos, remove, removeFor, references, refKey, stats, DIR };
