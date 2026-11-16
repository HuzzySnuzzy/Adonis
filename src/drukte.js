'use strict';
/**
 * Drukte: hoeveel werk er per dag binnenkomt, als jaarkalender, plus een verwachting voor de komende weken.
 *  - Per dag: werkopdrachten (datum van invoer), waarvan APK, en bandensets in/uit het bandenhotel.
 *  - Verwachting voor een dag in de toekomst: het gemiddelde van dezelfde weekdag rond dezelfde datum in eerdere jaren
 *    (52 weken terug, zodat de weekdag gelijk blijft; drie weken samen tegen toeval).
 *  - APK's die verlopen (volgens de RDW) bij actieve klanten: die komen er waarschijnlijk aan.
 */
const { db } = require('./db');

const DAY = 864e5;
const iso = (d) => d.toISOString().slice(0, 10);
const parse = (s) => new Date(s + 'T00:00:00Z');
const add = (s, n) => iso(new Date(parse(s).getTime() + n * DAY));
const hasTable = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const hasCol = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c);

/** Alle tellingen per dag: Map(datum -> { n, apk, banden }) */
function perDay() {
  const m = new Map();
  const get = (d) => { if (!m.has(d)) m.set(d, { n: 0, apk: 0, banden: 0 }); return m.get(d); };
  for (const r of db.prepare(`SELECT datum_invoer AS d, COUNT(*) AS n,
      SUM(CASE WHEN json_extract(data, '$.achter.keuring.apk') IN (1, 'true') THEN 1 ELSE 0 END) AS apk
      FROM orders WHERE datum_invoer GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' GROUP BY datum_invoer`).all()) {
    const x = get(r.d); x.n += r.n; x.apk += r.apk || 0;
  }
  if (hasTable('tyre_storage')) {
    for (const col of ['datum_in', 'datum_uit']) {
      for (const r of db.prepare(`SELECT ${col} AS d, COUNT(*) AS n FROM tyre_storage WHERE soort = 'klant' AND ${col} GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' GROUP BY ${col}`).all()) {
        get(r.d).banden += r.n;
      }
    }
  }
  return m;
}

/** APK-vervaldatums van actieve klanten per dag (vanaf vandaag). */
function apkDue(from) {
  if (!hasCol('customers', 'apk_vervaldatum')) return new Map();
  const statusCol = hasCol('customers', 'status') ? "AND COALESCE(status, '') = ''" : '';
  return new Map(db.prepare(`SELECT apk_vervaldatum AS d, COUNT(*) AS n FROM customers
    WHERE apk_vervaldatum >= ? ${statusCol} GROUP BY apk_vervaldatum`).all(from).map((r) => [r.d, r.n]));
}

function today() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Europe/Amsterdam' }).format(new Date());
  return p; // YYYY-MM-DD
}

function build(year) {
  const days = perDay();
  const now = today();
  const thisYear = Number(now.slice(0, 4));
  const allDates = [...days.keys()].sort();
  const firstYear = allDates.length ? Math.min(Number(allDates[0].slice(0, 4)), thisYear) : thisYear;
  const y = Math.min(Math.max(Number(year) || thisYear, firstYear), thisYear + 1);
  const first = allDates[0] || now;

  // Verwachting voor een datum: dezelfde weekdag 52 weken terug (per eerder jaar), gemiddeld over 3 weken.
  function forecast(d) {
    const vals = [];
    for (let k = 1; k <= 6; k++) {
      const base = add(d, -364 * k);
      if (base < first) break;
      const w = [-7, 0, 7].map((o) => (days.get(add(base, o)) || { n: 0 }).n);
      vals.push(w.reduce((a, b) => a + b, 0) / w.length);
    }
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }

  // Kleurstappen: verdeling van drukke dagen over alles wat er is (zo zijn jaren onderling te vergelijken).
  const counts = [...days.values()].map((v) => v.n).filter((n) => n > 0).sort((a, b) => a - b);
  const q = (p) => (counts.length ? counts[Math.min(counts.length - 1, Math.floor(p * counts.length))] : 1);
  const steps = [q(0.25), q(0.5), q(0.75), q(0.92)];
  const level = (n) => (n <= 0 ? 0 : n <= steps[0] ? 1 : n <= steps[1] ? 2 : n <= steps[2] ? 3 : 4);

  const apk = apkDue(now);
  const months = [];
  let total = 0; let apkTotal = 0; let workdays = 0; let busiest = null;
  const weekday = Array.from({ length: 7 }, () => ({ sum: 0, days: 0 }));
  for (let m = 0; m < 12; m++) {
    const cells = [];
    let mTotal = 0;
    for (let d = 1; d <= 31; d++) {
      const dt = new Date(Date.UTC(y, m, d));
      if (dt.getUTCMonth() !== m) break;
      const ds = iso(dt);
      const wd = (dt.getUTCDay() + 6) % 7; // 0 = maandag
      const v = days.get(ds) || { n: 0, apk: 0, banden: 0 };
      const future = ds > now;
      const cell = { d, ds, wd, n: v.n, apk: v.apk, banden: v.banden, future, today: ds === now, lvl: future ? 0 : level(v.n) };
      if (future) {
        const f = forecast(ds);
        cell.verwacht = f === null ? null : Math.round(f * 10) / 10;
        cell.flvl = f === null ? 0 : level(Math.round(f));
        cell.apkDue = apk.get(ds) || 0;
      } else if (ds >= first) {
        mTotal += v.n; total += v.n; apkTotal += v.apk;
        if (wd < 6) { workdays++; }
        weekday[wd].sum += v.n; weekday[wd].days++;
        if (!busiest || v.n > busiest.n) busiest = { ds, n: v.n };
      }
      cells.push(cell);
    }
    months.push({ m, cells, total: mTotal });
  }

  // Vorig jaar per maand (ter vergelijking).
  const prevMonths = Array.from({ length: 12 }, (_, m) => {
    let s = 0;
    for (const [ds, v] of days) if (ds.startsWith(`${y - 1}-${String(m + 1).padStart(2, '0')}`)) s += v.n;
    return s;
  });

  // Komende 8 weken (vanaf maandag van deze week).
  const wdNow = (parse(now).getUTCDay() + 6) % 7;
  const monday = add(now, -wdNow);
  const weeks = [];
  for (let w = 0; w < 8; w++) {
    const start = add(monday, w * 7);
    let verwacht = 0; let hasF = false; let vorigJaar = 0; let apkN = 0; let gedaan = 0;
    for (let i = 0; i < 7; i++) {
      const ds = add(start, i);
      const f = forecast(ds);
      if (f !== null) { verwacht += f; hasF = true; }
      vorigJaar += (days.get(add(ds, -364)) || { n: 0 }).n;
      apkN += apk.get(ds) || 0;
      if (ds <= now) gedaan += (days.get(ds) || { n: 0 }).n;
    }
    weeks.push({ start, end: add(start, 6), week: isoWeek(start), verwacht: hasF ? Math.round(verwacht) : null, vorigJaar, apk: apkN, gedaan, current: w === 0 });
  }

  const busiestMonth = months.reduce((a, b) => (b.total > a.total ? b : a), months[0]);
  return {
    year: y, thisYear, firstYear, now, months, steps, weeks, prevMonths,
    stats: {
      total, apk: apkTotal,
      perDag: workdays ? Math.round((total / workdays) * 10) / 10 : 0,
      busiest: busiest && busiest.n > 0 ? busiest : null,
      busiestMonth: busiestMonth && busiestMonth.total > 0 ? busiestMonth : null,
    },
    weekday: weekday.map((w) => (w.days ? Math.round((w.sum / w.days) * 10) / 10 : 0)),
    hasHistory: allDates.some((d) => d < `${thisYear}-01-01`),
  };
}

function isoWeek(ds) {
  const d = parse(ds);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - firstThu) / DAY - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
}

module.exports = { build };
