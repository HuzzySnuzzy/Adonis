'use strict';
/**
 * "Mijn werk": wat een monteur heeft gedaan, volgens de werkopdrachten waar hij of zij als monteur op staat
 * (of die hij/zij heeft aangemaakt als het vak Monteur leeg is). Telt werkopdrachten, servicebeurten, APK's,
 * bandenwissels en de tijd uit de kolom Tijd.
 */
const { db } = require('./db');
const orders = require('./orders');

const SERVICE = /\b(service|servicebeurt|onderhoud(sbeurt)?|kleine beurt|grote beurt|inspectiebeurt|olie\s*(en\s*filter\s*)?verv)/i;
const TYRES = /\b(band(en)?\s*(wissel|verwissel|omzet|monter)|wing\b|zomo\b|winterbanden|zomerbanden|wisselen.*banden)/i;
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Tijd uit de kolom Tijd: 0,5 · 1.5 · 1:30 · 45m · 2u (onduidelijke tekst telt niet mee). */
function hoursOf(text) {
  let sum = 0;
  for (const raw of String(text || '').split('\n')) {
    const s = raw.trim().toLowerCase().replace(/\s+/g, '');
    if (!s) continue;
    let m;
    if ((m = /^(\d{1,2}):(\d{2})$/.exec(s))) sum += Number(m[1]) + Number(m[2]) / 60;
    else if ((m = /^(\d{1,3})m(in)?$/.exec(s))) sum += Number(m[1]) / 60;
    else if ((m = /^(\d{1,2}(?:[.,]\d{1,2})?)(u|uur|h)?$/.exec(s))) { const h = Number(m[1].replace(',', '.')); if (h <= 24) sum += h; }
  }
  return sum;
}

function forUser(user, today = orders.todayISO()) {
  const name = norm(user.name);
  const first = name.split(' ')[0];
  const rows = db.prepare(`SELECT o.id, o.nummer, o.status, o.datum_invoer, o.created_by,
      json_extract(o.data, '$.monteur') AS monteur, json_extract(o.data, '$.servicebeurt_km') AS sb,
      json_extract(o.data, '$.werk_omschrijving') AS werk, json_extract(o.data, '$.werk_tijd') AS tijd,
      json_extract(o.data, '$.diversen.apk') AS apk, json_extract(o.data, '$.kenteken') AS kenteken,
      json_extract(o.data, '$.merk_type') AS merk_type
    FROM orders o ORDER BY o.datum_invoer DESC, o.nummer DESC`).all();
  const mine = rows.filter((r) => {
    const m = norm(r.monteur);
    if (!m) return r.created_by === user.id;
    return m === name || m === first || (name.length >= 4 && m.includes(name));
  });

  const d = new Date(today + 'T00:00:00Z');
  const iso = (x) => x.toISOString().slice(0, 10);
  const weekStart = new Date(d); weekStart.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // maandag
  const periods = {
    week: iso(weekStart),
    maand: today.slice(0, 7) + '-01',
    jaar: today.slice(0, 4) + '-01-01',
  };
  const empty = () => ({ week: 0, maand: 0, jaar: 0, totaal: 0 });
  const t = { werkopdrachten: empty(), service: empty(), apk: empty(), banden: empty(), uren: empty(), afgerond: empty() };
  const add = (k, r, n = 1) => {
    t[k].totaal += n;
    for (const [p, from] of Object.entries(periods)) if (r.datum_invoer >= from && r.datum_invoer <= today) t[k][p] += n;
  };
  for (const r of mine) {
    add('werkopdrachten', r);
    if (r.status === 'gefactureerd') add('afgerond', r);
    if (String(r.sb || '').trim() || SERVICE.test(r.werk || '')) add('service', r);
    if (r.apk === 1 || r.apk === true || /\bapk\b/i.test(r.werk || '')) add('apk', r);
    if (TYRES.test(r.werk || '')) add('banden', r);
    const h = hoursOf(r.tijd);
    if (h) add('uren', r, h);
  }

  // Per maand, de laatste 12 maanden (oudste eerst).
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    months.push({ key: iso(m).slice(0, 7), werk: 0, service: 0 });
  }
  const byKey = Object.fromEntries(months.map((m) => [m.key, m]));
  for (const r of mine) {
    const m = byKey[String(r.datum_invoer).slice(0, 7)];
    if (!m) continue;
    m.werk++;
    if (String(r.sb || '').trim() || SERVICE.test(r.werk || '')) m.service++;
  }
  const recent = mine.slice(0, 8).map((r) => ({
    id: r.id, nummer: r.nummer, status: r.status, datum: r.datum_invoer, kenteken: r.kenteken, merk_type: r.merk_type,
    werk: String(r.werk || '').split('\n').map((l) => l.replace(/^[-–•*\s]+/, '').trim()).find(Boolean) || '',
  }));
  return { totals: t, months, recent, count: mine.length };
}

module.exports = { forUser, hoursOf };
