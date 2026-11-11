'use strict';
/**
 * Feestelijke achtergronden: sneeuw met Kerst, pepernoten met Sinterklaas, vuurwerk met Oud en Nieuw, enz.
 * De ADONIS-beheerder zet ze aan/uit en kiest per feest van wanneer tot wanneer (Systeem → Feestdagen).
 * Elke gebruiker kan ze voor zichzelf uitzetten (Instellingen → Effecten). Het effect zelf: public/js/festive.js.
 */
const settings = require('./settings');

const FESTIVALS = [
  { key: 'sinterklaas', name: 'Sinterklaas en pakjesavond', desc: 'Vallende pepernoten en cadeautjes', van: '15-11', tot: '05-12' },
  { key: 'kerst', name: 'Kerst', desc: 'Sneeuw achter de knoppen', van: '06-12', tot: '27-12' },
  { key: 'oudnieuw', name: 'Oud en Nieuw', desc: 'Vuurwerk', van: '28-12', tot: '02-01' },
  { key: 'valentijn', name: 'Valentijnsdag', desc: 'Opstijgende hartjes', van: '12-02', tot: '14-02' },
  { key: 'pasen', name: 'Pasen', desc: 'Bloesem en paaseitjes', auto: true },
  { key: 'koningsdag', name: 'Koningsdag', desc: 'Oranje confetti', van: '25-04', tot: '27-04' },
  { key: 'halloween', name: 'Halloween', desc: 'Vleermuizen en herfstbladeren', van: '24-10', tot: '31-10' },
];
const KEYS = FESTIVALS.map((f) => f.key);

/** Paaszondag (gregoriaans, "anonieme" berekening). */
function easter(year) {
  const a = year % 19; const b = Math.floor(year / 100); const c = year % 100;
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25); const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30; const i = Math.floor(c / 4); const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7; const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
const dm = (d) => `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
/** Pasen automatisch: Goede Vrijdag t/m Tweede Paasdag. */
function easterRange(year) {
  const e = easter(year);
  const add = (n) => new Date(e.getTime() + n * 864e5);
  return { van: dm(add(-2)), tot: dm(add(1)) };
}

/** "dd-mm" netjes maken (ook 1-5, 01/05, 1.5); ongeldig = null. */
function parseDm(v) {
  const m = /^\s*(\d{1,2})\s*[-/. ]\s*(\d{1,2})\s*$/.exec(String(v || ''));
  if (!m) return null;
  const d = Number(m[1]); const mo = Number(m[2]);
  const max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  if (!max || d < 1 || d > max) return null;
  return `${String(d).padStart(2, '0')}-${String(mo).padStart(2, '0')}`;
}
const num = (s) => { const [d, m] = s.split('-').map(Number); return m * 100 + d; };

function state() {
  const raw = settings.get('feesten', {}) || {};
  const items = {};
  for (const f of FESTIVALS) {
    const r = (raw.items && raw.items[f.key]) || {};
    items[f.key] = {
      aan: r.aan !== false,
      auto: f.auto ? r.auto !== false : false,
      van: parseDm(r.van) || f.van || null,
      tot: parseDm(r.tot) || f.tot || null,
    };
  }
  return { aan: raw.aan !== false, items };
}
function save(input) {
  const items = {};
  for (const f of FESTIVALS) {
    const i = input.items && input.items[f.key] || {};
    items[f.key] = { aan: !!i.aan, auto: f.auto ? !!i.auto : undefined, van: parseDm(i.van), tot: parseDm(i.tot) };
    if (f.auto && !items[f.key].auto && (!items[f.key].van || !items[f.key].tot)) items[f.key].auto = true; // geen geldige data: automatisch
  }
  settings.set('feesten', { aan: !!input.aan, items });
  return state();
}

/** Van/tot voor dit jaar (Pasen automatisch berekend). */
function rangeOf(f, it, year) {
  if (f.auto && it.auto) return easterRange(year);
  return it.van && it.tot ? { van: it.van, tot: it.tot } : null;
}
function inRange(md, r) {
  const x = num(md); const a = num(r.van); const b = num(r.tot);
  return a <= b ? x >= a && x <= b : x >= a || x <= b; // over de jaarwisseling (bijv. 28-12 t/m 02-01)
}
const lengthOf = (r) => { const a = num(r.van); const b = num(r.tot); return a <= b ? b - a : 1231 - a + b; };

/** Welk feest is het vandaag (in Nederland)? Overlappen er twee, dan wint het kortste (meest specifieke). */
function today(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: process.env.APP_TIMEZONE || 'Europe/Amsterdam', day: '2-digit', month: '2-digit', year: 'numeric' })
    .formatToParts(date).map((p) => [p.type, p.value]));
  const md = `${parts.day}-${parts.month}`; const year = Number(parts.year);
  const st = state();
  if (!st.aan) return null;
  let best = null;
  for (const f of FESTIVALS) {
    const it = st.items[f.key];
    if (!it.aan) continue;
    const r = rangeOf(f, it, year);
    if (r && inRange(md, r) && (!best || lengthOf(r) < best.len)) best = { key: f.key, len: lengthOf(r) };
  }
  return best ? best.key : null;
}
/** Voor Systeem → Feestdagen: elk feest met de data van dit jaar. */
function overview(date = new Date()) {
  const year = Number(new Intl.DateTimeFormat('en-GB', { timeZone: process.env.APP_TIMEZONE || 'Europe/Amsterdam', year: 'numeric' }).format(date));
  const st = state(); const now = today(date);
  return {
    aan: st.aan, now,
    list: FESTIVALS.map((f) => ({ ...f, ...st.items[f.key], canAuto: !!f.auto, easter: f.auto ? easterRange(year) : null, actief: now === f.key })),
  };
}

module.exports = { FESTIVALS, KEYS, state, save, today, overview, parseDm, easter };
