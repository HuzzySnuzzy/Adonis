'use strict';
/**
 * Hulp bij het invullen van een werkopdracht: wat weten we al van deze auto (klant, vorige werkopdrachten,
 * bandenhotel), en suggesties tijdens het typen (onderdelen, werkzaamheden, banden) uit eerdere werkopdrachten
 * en de voorraad. Alles alleen-lezen; de monteur kiest zelf wat er wordt overgenomen.
 */
const { db, plateKey } = require('./db');
const orders = require('./orders');
const inv = require('./inventory');

const num = (v) => { const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : null; };
const txt = (v) => String(v ?? '').trim();
const fold = (s) => txt(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/* ---------- index van alle werkopdrachten (opnieuw opgebouwd als er iets veranderde) ---------- */
let cache = { stamp: null, parts: [], work: [], tyreSizes: [], tyreBrands: [], tarief: '' };
function index() {
  const s = db.prepare('SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM orders').get();
  const stamp = `${s.n}|${s.u}`;
  if (cache.stamp === stamp) return cache;
  const parts = new Map(); const work = new Map(); const sizes = new Map(); const brands = new Map();
  let tarief = ''; let tariefAt = '';
  for (const row of db.prepare('SELECT data, datum_invoer, updated_at FROM orders ORDER BY datum_invoer, id').iterate()) {
    let d; try { d = JSON.parse(row.data); } catch { continue; }
    const pages = (Array.isArray(d.paginas) ? d.paginas : []).filter((pg) => pg && pg.soort === 'voor');
    for (const p of [...(d.onderdelen || []), ...pages.flatMap((pg) => pg.onderdelen || [])]) {
      const nr = txt(p.nr); const oms = txt(p.omschrijving);
      if (!nr && !oms) continue;
      const key = (inv.numberKey(nr) || '') + '|' + fold(oms);
      const e = parts.get(key) || { nr, omschrijving: oms, prijs: '', n: 0, last: '' };
      e.n++; e.last = row.datum_invoer; if (txt(p.prijs)) e.prijs = txt(p.prijs);
      parts.set(key, e);
    }
    for (const line of [d.werk_omschrijving, ...pages.map((pg) => pg.werk_omschrijving)].join('\n').split('\n')) {
      const l = txt(line); if (l.length < 3) continue;
      const k = fold(l); const e = work.get(k) || { text: l, n: 0 }; e.n++; e.text = l; work.set(k, e);
    }
    const back = d.achter || {};
    for (const b of [...Object.values(back.banden || {}), { maat: back.band_maat, merk: back.band_merk }]) {
      const m = inv.normalizeSize(b.maat); if (m && /\d{3}\/\d{2}/.test(m)) sizes.set(m, (sizes.get(m) || 0) + 1);
      const br = txt(b.merk); if (br) brands.set(fold(br), { text: br, n: ((brands.get(fold(br)) || {}).n || 0) + 1 });
    }
    if (txt(d.tarief) && row.updated_at >= tariefAt) { tarief = txt(d.tarief); tariefAt = row.updated_at; }
  }
  cache = {
    stamp,
    parts: [...parts.values()].sort((a, b) => b.n - a.n),
    work: [...work.values()].sort((a, b) => b.n - a.n),
    tyreSizes: [...sizes.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ text: t, n })),
    tyreBrands: [...brands.values()].sort((a, b) => b.n - a.n),
    tarief,
  };
  return cache;
}
function lastTarief() { return index().tarief; }

/** Past de tekst bij de zoekterm? Elk woord moet voorkomen (nummers ook zonder spaties/punten). */
function matcher(q) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  return (...fields) => {
    const hay = fold(fields.join(' ')); const keys = fields.map(inv.numberKey).join(' ');
    return words.every((w) => hay.includes(w) || (inv.numberKey(w) && keys.includes(inv.numberKey(w))));
  };
}

/** Suggesties tijdens het typen. kind: onderdeel | werk | bandmaat | bandmerk */
function suggest(kind, q, { stock = true, eigen = null } = {}) {
  q = txt(q).slice(0, 60);
  if (q.length < 2) return [];
  const ok = matcher(q);
  const out = [];
  // Eigen lijst van de ADONIS-beheerder (Systeem → Automatisch invullen) eerst.
  if (eigen && kind === 'werk') for (const t of eigen.werk) { if (out.length >= 4) break; if (ok(t)) out.push({ text: t, note: 'eigen lijst' }); }
  if (eigen && kind === 'onderdeel') {
    for (const l of eigen.onderdelen) {
      if (out.length >= 4) break;
      const p = require('./autofill').parsePart(l);
      if (ok(p.nr, p.omschrijving)) out.push({ nr: p.nr, omschrijving: p.omschrijving, prijs: p.prijs, note: 'eigen lijst' });
    }
  }
  const mine = out.length;
  if (kind === 'onderdeel') {
    // Eerst wat al eens op een werkopdracht stond (met de prijs van toen), dan de voorraad.
    for (const p of index().parts) {
      if (out.length >= 5 + mine) break;
      if (out.some((o) => fold(o.omschrijving) === fold(p.omschrijving))) continue;
      if (ok(p.nr, p.omschrijving)) out.push({ nr: p.nr, omschrijving: p.omschrijving, prijs: p.prijs, note: `${p.n}× gebruikt` });
    }
    if (stock) {
      for (const s of inv.searchStock({ soort: 'onderdeel', q }).slice(0, 10 - out.length)) {
        if (out.some((o) => inv.numberKey(o.nr) && inv.numberKey(o.nr) === inv.numberKey(s.nummer || s.oe_nummer))) continue;
        out.push({
          nr: s.nummer || s.oe_nummer, omschrijving: [s.type, s.merk, s.omschrijving].filter(Boolean).join(' ').trim(), prijs: s.prijs,
          note: `voorraad: ${s.beschikbaar && s.aantal > 0 ? s.aantal + ' st.' : 'op'}${s.locatie ? ' · ' + s.locatie : ''}`,
        });
      }
    }
  } else if (kind === 'werk') {
    for (const w of index().work) { if (out.length >= 8 + mine) break; if (ok(w.text) && !out.some((o) => fold(o.text) === fold(w.text))) out.push({ text: w.text, note: `${w.n}×` }); }
  } else if (kind === 'bandmaat') {
    const seen = new Set();
    const add = (t0, note) => { const t = inv.normalizeSize(t0).toUpperCase(); if (t && !seen.has(t.toUpperCase()) && (seen.add(t.toUpperCase()), true) && ok(t, inv.sizeKey(t))) out.push({ text: t, note }); };
    for (const s of index().tyreSizes) { add(s.text, `${s.n}×`); if (out.length >= 8) break; }
    if (out.length < 8) for (const r of db.prepare("SELECT maat, COUNT(*) AS n FROM tyre_storage WHERE maat <> '' GROUP BY maat ORDER BY n DESC LIMIT 200").all()) { add(r.maat, 'bandenhotel'); if (out.length >= 8) break; }
  } else if (kind === 'bandmerk') {
    for (const b of index().tyreBrands) { if (ok(b.text)) out.push({ text: b.text, note: `${b.n}×` }); if (out.length >= 8) break; }
  }
  return out;
}

/** Wat weten we al van deze auto? */
function vehicle(kenteken, { exceptOrderId = null, tyres = true } = {}) {
  const pk = plateKey(kenteken);
  if (!pk) return { found: false };
  const c = db.prepare('SELECT * FROM customers WHERE plate_key = ?').get(pk);
  const res = { found: !!c, kenteken };
  if (c) {
    res.customer = Object.fromEntries(orders.CUSTOMER_FIELDS.filter((f) => f !== 'kenteken').map((f) => [f, c[f] || '']));
    res.customer.id = c.id;
    res.customer.apk = c.apk_vervaldatum || '';
    const rows = db.prepare('SELECT id, nummer, datum_invoer, data FROM orders WHERE customer_id = ? AND id <> ? ORDER BY datum_invoer DESC, id DESC LIMIT 50')
      .all(c.id, exceptOrderId || 0);
    res.orders = rows.length;
    if (rows.length) {
      const last = rows[0];
      res.last = { id: last.id, nummer: last.nummer, datum: last.datum_invoer };
      let km = null; let oil = null; let banden = null; let service = null;
      for (const r of rows) {
        let d; try { d = JSON.parse(r.data); } catch { continue; }
        const k = Math.max(num(d.km_in) || 0, num(d.km_uit) || 0);
        if (k && (!km || k > km.km)) km = { km: k, datum: r.datum_invoer, nummer: r.nummer };
        const mo = d.vloeistoffen && d.vloeistoffen.motorolie;
        if (!oil && mo && (txt(mo.info) || txt(mo.liter))) oil = { visc: txt(mo.info) && txt(mo.info2) ? `${txt(mo.info)}w${txt(mo.info2)}` : txt(mo.info), info: txt(mo.info), info2: txt(mo.info2), liter: txt(mo.liter), nummer: r.nummer };
        // Banden van vorige keer: maat/merk (achterkant sinds 1.47), anders van het eerste wiel (oudere werkopdrachten).
        const back = d.achter || {}; const w = Object.values(back.banden || {}).find((x) => txt(x.maat) || txt(x.merk)) || {};
        const bm = txt(back.band_maat) || txt(w.maat); const bb = txt(back.band_merk) || txt(w.merk);
        if (!banden && (bm || bb)) banden = { maat: bm, merk: bb, type: txt(back.band_type) };
        if (!service && num(d.servicebeurt_km)) service = { km: num(d.servicebeurt_km), datum: r.datum_invoer };
      }
      Object.assign(res, { km, oil, banden, service });
    }
  }
  if (tyres) {
    const ts = inv.tyresForPlate(pk);
    const onCar = ts.find((t) => t.status === 'op_auto');
    const stored = ts.filter((t) => t.status === 'opgeslagen');
    res.tyres = {
      onCar: onCar ? { maat: onCar.maat, merk: onCar.merk, seizoen: onCar.seizoen, id: onCar.id } : null,
      stored: stored.map((t) => ({ id: t.id, maat: t.maat, merk: t.merk, seizoen: t.seizoen, label: t.label, locatie: t.locatie })),
    };
  }
  return res;
}

module.exports = { suggest, vehicle, lastTarief };
