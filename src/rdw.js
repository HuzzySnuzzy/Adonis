'use strict';
/**
 * Voertuiggegevens van de RDW (Open Data, gratis en zonder sleutel): APK-vervaldatum, merk/type,
 * brandstof, terugroepacties enz. Resultaten worden per klant bewaard en hooguit één keer per dag
 * opnieuw opgevraagd.
 */
const { db, plateKey } = require('./db');

const API = process.env.WERKOPDRACHTEN_RDW_API || 'https://opendata.rdw.nl/resource';
const VOERTUIGEN = 'm9d7-ebf2'; // Open Data RDW: Gekentekende voertuigen
const BRANDSTOF = '8ys7-d773'; //  Open Data RDW: Gekentekende voertuigen brandstof
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

{
  const cols = db.prepare('PRAGMA table_info(customers)').all().map((c) => c.name);
  if (!cols.includes('rdw_json')) db.exec('ALTER TABLE customers ADD COLUMN rdw_json TEXT');
  if (!cols.includes('rdw_at')) db.exec('ALTER TABLE customers ADD COLUMN rdw_at TEXT');
  if (!cols.includes('apk_vervaldatum')) db.exec('ALTER TABLE customers ADD COLUMN apk_vervaldatum TEXT');
}

/** RDW-datum ("20270312" of "2027-03-12T00:00:00.000") -> "2027-03-12". */
function rdwDate(row, field) {
  const dt = row[field + '_dt'];
  if (typeof dt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dt)) return dt.slice(0, 10);
  const v = String(row[field] || '');
  return /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : '';
}
const num = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const yes = (v) => String(v || '').toLowerCase() === 'ja';
const cap = (s) => String(s || '').toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());

async function getJson(dataset, kenteken) {
  const res = await fetch(`${API}/${dataset}.json?kenteken=${encodeURIComponent(kenteken)}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'ADONIS-Werkopdrachten' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`RDW antwoordde met ${res.status}`);
  return res.json();
}

/** Gegevens rechtstreeks bij de RDW opvragen (10 minuten in het geheugen bewaard). */
const memo = new Map();
async function lookup(kenteken) {
  const key = plateKey(kenteken);
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < 10 * 60 * 1000) return hit.info;
  const info = await lookupFresh(key);
  memo.set(key, { t: Date.now(), info });
  if (memo.size > 500) memo.delete(memo.keys().next().value);
  return info;
}

async function lookupFresh(kenteken) {
  const key = plateKey(kenteken);
  if (!/^[A-Z0-9]{4,8}$/.test(key)) return { found: false, kenteken: key, reason: 'ongeldig kenteken' };
  const [voertuigen, brandstoffen] = await Promise.all([
    getJson(VOERTUIGEN, key),
    getJson(BRANDSTOF, key).catch(() => []),
  ]);
  const v = Array.isArray(voertuigen) && voertuigen[0];
  if (!v) return { found: false, kenteken: key };
  const b = Array.isArray(brandstoffen) ? brandstoffen : [];
  const kw = b.map((x) => num(x.nettomaximumvermogen)).find((x) => x);
  return {
    found: true,
    kenteken: key,
    merk: cap(v.merk),
    handelsbenaming: cap(v.handelsbenaming),
    voertuigsoort: v.voertuigsoort || '',
    inrichting: v.inrichting || '',
    kleur: [v.eerste_kleur, v.tweede_kleur].filter((k) => k && k !== 'Niet geregistreerd').map(cap).join(' / '),
    apk: rdwDate(v, 'vervaldatum_apk'),
    eersteToelating: rdwDate(v, 'datum_eerste_toelating'),
    eersteToelatingNL: rdwDate(v, 'datum_eerste_tenaamstelling_in_nederland'),
    tenaamstelling: rdwDate(v, 'datum_tenaamstelling'),
    brandstof: [...new Set(b.map((x) => x.brandstof_omschrijving).filter(Boolean))].join(' / '),
    vermogenKw: kw || null,
    vermogenPk: kw ? Math.round(kw * 1.36) : null,
    emissie: (b.find((x) => x.uitlaatemissieniveau) || {}).uitlaatemissieniveau || '',
    cilinderinhoud: num(v.cilinderinhoud),
    massaLeeg: num(v.massa_ledig_voertuig),
    zitplaatsen: num(v.aantal_zitplaatsen),
    catalogusprijs: num(v.catalogusprijs),
    tellerstand: v.tellerstandoordeel || '',
    verzekerd: v.wam_verzekerd ? yes(v.wam_verzekerd) : null,
    terugroepactie: yes(v.openstaande_terugroepactie_indicator),
    export: yes(v.export_indicator),
    wachtOpKeuring: v.wacht_op_keuren && v.wacht_op_keuren !== 'Geen verstrekking in Open Data' ? v.wacht_op_keuren : '',
  };
}

/** "Merk/Type" zoals op het formulier, bijv. "Peugeot 208". */
function merkType(info) {
  if (!info || !info.found) return '';
  const h = info.handelsbenaming || '';
  return h.toLowerCase().startsWith(info.merk.toLowerCase()) ? h : `${info.merk} ${h}`.trim();
}

/** Bewaarde RDW-gegevens van een klant (en zo nodig verversen). */
const inFlight = new Map();
async function forCustomer(customer, { force = false } = {}) {
  const cached = customer.rdw_json ? JSON.parse(customer.rdw_json) : null;
  const fresh = customer.rdw_at && Date.now() - new Date(customer.rdw_at.replace(' ', 'T') + 'Z').getTime() < MAX_AGE_MS;
  if (cached && fresh && !force) return { info: cached, at: customer.rdw_at, cached: true };
  const key = plateKey(customer.kenteken);
  if (force) memo.delete(key);
  if (!inFlight.has(key)) {
    inFlight.set(key, lookup(key).finally(() => inFlight.delete(key)));
  }
  try {
    const info = await inFlight.get(key);
    db.prepare("UPDATE customers SET rdw_json = ?, rdw_at = datetime('now'), apk_vervaldatum = ? WHERE id = ?")
      .run(JSON.stringify(info), info.apk || null, customer.id);
    return { info, at: new Date().toISOString().replace('T', ' ').slice(0, 19), cached: false };
  } catch (err) {
    // RDW niet bereikbaar: oude gegevens tonen als die er zijn.
    return { info: cached, at: customer.rdw_at, cached: true, error: err.message };
  }
}

/** Op de achtergrond verversen (bijv. na het opslaan van een werkopdracht). */
function refreshInBackground(kenteken) {
  if (!require('./plates').rdwApplicable(kenteken)) return;
  const c = db.prepare('SELECT * FROM customers WHERE plate_key = ?').get(plateKey(kenteken));
  if (c) forCustomer(c).catch(() => {});
}

/**
 * Op de achtergrond RDW-gegevens aanvullen voor klanten die ze nog niet hebben (bijv. uit het bandenhotel)
 * of waarvan ze ouder zijn dan 30 dagen, zodat de APK-lijst compleet is. Rustig: één kenteken per 3 seconden.
 */
let filling = false;
function startBackgroundFill() {
  const plates = require('./plates');
  const run = async () => {
    if (filling) return;
    filling = true;
    try {
      const rows = db.prepare(
        `SELECT * FROM customers WHERE rdw_at IS NULL OR rdw_at < datetime('now', '-30 days')
         ORDER BY rdw_at IS NOT NULL, rdw_at LIMIT 300`
      ).all().filter((c) => plates.rdwApplicable(c.kenteken));
      for (const c of rows) {
        const r = await forCustomer(c, { force: true });
        if (r.error) break; // RDW niet bereikbaar: later opnieuw
        await new Promise((ok) => setTimeout(ok, 3000));
      }
    } catch { /* volgende keer */ } finally { filling = false; }
  };
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, 6 * 3600 * 1000).unref();
}

/** Link naar de officiële RDW-pagina met alle gegevens van dit kenteken. */
function rdwUrl(kenteken) {
  return `https://ovi.rdw.nl/default.aspx?kenteken=${encodeURIComponent(plateKey(kenteken))}`;
}

module.exports = { lookup, merkType, forCustomer, refreshInBackground, rdwUrl, startBackgroundFill };
