'use strict';
/**
 * Huisstijl van het bedrijf (alleen de ADONIS-beheerder): eigen naam in plaats van "ADONIS", eigen logo (vierkant),
 * banner (breed logo) en een achtergrondafbeelding met instelbare vervaging en zichtbaarheid (alleen bij de
 * thema's Systeem, Licht en Donker). De afbeeldingen staan in de database, dus ze gaan mee in elke backup.
 */
const crypto = require('crypto');
const { db } = require('./db');
const settings = require('./settings');

db.exec(`
CREATE TABLE IF NOT EXISTS branding_files (
  slot       TEXT PRIMARY KEY,
  mime       TEXT NOT NULL,
  data       BLOB NOT NULL,
  hash       TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const SLOTS = {
  logo: { label: 'Logo', max: 2 * 1024 * 1024 },
  banner: { label: 'Banner', max: 3 * 1024 * 1024 },
  achtergrond: { label: 'Achtergrond', max: 8 * 1024 * 1024 },
};
const MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/jxl'];
// Het logo blijft PNG/JPEG/WebP: het is ook het pictogram van het tabblad en van het beginscherm (telefoon), en daar kan
// ADONIS een JPEG XL niet zelf omzetten in browsers die het niet kennen.
const JXL_SLOTS = ['banner', 'achtergrond'];
const DEFAULTS = { naam: '', sub: '', blur: 6, zicht: 35, bannerInMenu: false, kleur1: '', kleur2: '' };
const HEX = /^#[0-9a-f]{6}$/i;

let cache = null;
function get() {
  if (cache) return cache;
  const s = { ...DEFAULTS, ...(settings.get('branding', {}) || {}) };
  const files = Object.fromEntries(db.prepare('SELECT slot, hash FROM branding_files').all().map((r) => [r.slot, r.hash]));
  const naam = String(s.naam || '').trim();
  cache = {
    naam, // leeg = ADONIS
    sub: String(s.sub || '').trim(),
    name: naam || 'ADONIS',
    custom: !!naam,
    blur: clamp(s.blur, 0, 40, DEFAULTS.blur),
    zicht: clamp(s.zicht, 5, 100, DEFAULTS.zicht),
    bannerInMenu: !!s.bannerInMenu && !!files.banner,
    kleur1: HEX.test(s.kleur1 || '') ? s.kleur1.toLowerCase() : '', // hoofdkleur (standaard ADONIS-blauw)
    kleur2: HEX.test(s.kleur2 || '') ? s.kleur2.toLowerCase() : '', // tweede kleur (standaard ADONIS-goud)
    logo: files.logo ? `/huisstijl/logo?v=${files.logo}` : null,
    banner: files.banner ? `/huisstijl/banner?v=${files.banner}` : null,
    achtergrond: files.achtergrond ? `/huisstijl/achtergrond?v=${files.achtergrond}` : null,
  };
  cache.css = !!(cache.achtergrond || cache.kleur1 || cache.kleur2); // is /huisstijl.css nodig?
  // Eén versie voor het stylesheet met de achtergrond (verandert bij elke wijziging).
  cache.v = crypto.createHash('sha1').update(JSON.stringify(cache)).digest('hex').slice(0, 10);
  return cache;
}
function clamp(v, min, max, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;
}

function saveSettings(input) {
  const cur = { ...DEFAULTS, ...(settings.get('branding', {}) || {}) };
  const next = { ...cur };
  if ('naam' in input) next.naam = String(input.naam || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if ('sub' in input) next.sub = String(input.sub || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if ('blur' in input) next.blur = clamp(input.blur, 0, 40, DEFAULTS.blur);
  if ('zicht' in input) next.zicht = clamp(input.zicht, 5, 100, DEFAULTS.zicht);
  if ('bannerInMenu' in input) next.bannerInMenu = !!input.bannerInMenu;
  if ('kleur1' in input) next.kleur1 = HEX.test(input.kleur1 || '') ? input.kleur1 : '';
  if ('kleur2' in input) next.kleur2 = HEX.test(input.kleur2 || '') ? input.kleur2 : '';
  settings.set('branding', next);
  cache = null;
  return get();
}

class BrandingError extends Error {}
/** Afbeelding opslaan (al verkleind in de browser). dataUrl: "data:image/png;base64,...". */
function saveFile(slot, dataUrl) {
  if (!SLOTS[slot]) throw new BrandingError('Onbekend soort afbeelding.');
  const m = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m || !MIMES.includes(m[1]) || (m[1] === 'image/jxl' && !JXL_SLOTS.includes(slot))) throw new BrandingError('Kies een afbeelding (PNG, JPG of WebP).');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw new BrandingError('De afbeelding is leeg.');
  if (buf.length > SLOTS[slot].max) throw new BrandingError(`De afbeelding is te groot (maximaal ${SLOTS[slot].max / 1024 / 1024} MB).`);
  if (!looksLike(m[1], buf)) throw new BrandingError('Dit bestand is geen geldige afbeelding.');
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
  db.prepare(`INSERT INTO branding_files (slot, mime, data, hash) VALUES (?, ?, ?, ?)
    ON CONFLICT(slot) DO UPDATE SET mime = excluded.mime, data = excluded.data, hash = excluded.hash, updated_at = datetime('now')`)
    .run(slot, m[1], buf, hash);
  cache = null;
  return get();
}
// Kloppen de eerste bytes bij het soort afbeelding? (geen HTML of script als "plaatje")
function looksLike(mime, b) {
  if (mime === 'image/png') return b.length > 8 && b.readUInt32BE(0) === 0x89504e47;
  if (mime === 'image/jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8;
  if (mime === 'image/jxl') return (b.length > 2 && b[0] === 0xff && b[1] === 0x0a) || (b.length > 12 && b.toString('ascii', 4, 8) === 'JXL ');
  if (mime === 'image/webp') return b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
  return false;
}
/** Banner en achtergrond die nog geen JPEG XL zijn (Systeem → Foto's (JPEG XL) zet ze om). */
function jxlTodo() {
  const skip = settings.get('branding_jxl_skip', {}) || {};
  return db.prepare('SELECT slot, mime, hash FROM branding_files').all()
    .filter((r) => JXL_SLOTS.includes(r.slot) && r.mime !== 'image/jxl' && skip[r.slot] !== r.hash).map((r) => r.slot);
}
/** Omgezette versie alleen bewaren als hij kleiner is; anders onthouden dat het niet hoeft. */
function replaceWithJxl(slot, dataUrl) {
  const cur = file(slot);
  if (!cur || !JXL_SLOTS.includes(slot)) throw new BrandingError('Onbekend soort afbeelding.');
  const m = /^data:image\/jxl;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  const size = m ? Buffer.byteLength(m[1], 'base64') : Infinity;
  if (size >= cur.data.length) {
    settings.set('branding_jxl_skip', { ...(settings.get('branding_jxl_skip', {}) || {}), [slot]: cur.hash });
    return { skipped: true };
  }
  saveFile(slot, dataUrl);
  return { before: cur.data.length, after: size };
}
function removeFile(slot) {
  db.prepare('DELETE FROM branding_files WHERE slot = ?').run(slot);
  if (slot === 'banner') saveSettings({ bannerInMenu: false });
  cache = null;
  return get();
}
function file(slot) {
  return SLOTS[slot] ? db.prepare('SELECT mime, data, hash FROM branding_files WHERE slot = ?').get(slot) : null;
}

/** Stylesheet met de achtergrond (alleen bij de thema's Systeem, Licht en Donker). */
/** Leesbare tekstkleur op een achtergrondkleur: donker op licht (bijv. geel), wit op donker. */
function textOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.36 ? '#14171c' : '#ffffff';
}
function colorCss(b) {
  if (!b.kleur1 && !b.kleur2) return '';
  const P = b.kleur1; const A = b.kleur2;
  const light = [P && `--primary: ${P}; --primary-hover: color-mix(in srgb, ${P} 82%, #000); --brand: ${P}; --on-primary: ${textOn(P)};`, A && `--accent: ${A};`].filter(Boolean).join(' ');
  const dark = [P && `--primary: color-mix(in srgb, ${P} 80%, #fff); --primary-hover: ${P}; --brand: color-mix(in srgb, ${P} 85%, #fff); --on-primary: ${textOn(P)};`, A && `--accent: ${A};`].filter(Boolean).join(' ');
  return `/* Eigen kleuren (Systeem → Huisstijl), alleen bij Systeem, Licht en Donker */
:root:is(:not([data-theme]), [data-theme="light"]) { ${light} }
:root[data-theme="dark"] { ${dark} }
@media (prefers-color-scheme: dark) { :root:not([data-theme]) { ${dark} } }
:root:is(:not([data-theme]), [data-theme="light"], [data-theme="dark"]) .btn-primary { color: var(--on-primary, #fff); }
`;
}
function css() {
  const b = get();
  const colors = colorCss(b);
  if (!b.achtergrond) return colors || '/* geen eigen huisstijl */\n';
  const sys = ':root:is(:not([data-theme]), [data-theme="light"], [data-theme="dark"])';
  return colors + `${sys} { --brand-bg-blur: ${b.blur}px; --brand-bg-zicht: ${b.zicht / 100}; }
${sys}:not(.in-window) { background: var(--bg); }
${sys}:not(.in-window) body { background: transparent; }
${sys}:not(.in-window) .brand-bg { display: block; background-image: url("${b.achtergrond}"); }
`;
}

module.exports = { jxlTodo, replaceWithJxl, get, saveSettings, saveFile, removeFile, file, css, SLOTS, BrandingError };
