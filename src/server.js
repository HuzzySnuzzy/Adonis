'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const ejs = require('ejs');
const session = require('express-session');

const { db, plateKey, DATA_DIR } = require('./db');
const SqliteStore = require('./session-store');
const auth = require('./auth');
const orders = require('./orders');
const assets = require('./assets');
const importer = require('./import');
const buildinfo = require('./buildinfo');
const updater = require('./update');
const events = require('./events');
const synonyms = require('./synonyms');
const bulletins = require('./bulletins');
const settings = require('./settings');
const tunnel = require('./tunnel');
const cloudflare = require('./cloudflare');
const rdw = require('./rdw');
const inv = require('./inventory');
const plates = require('./plates');
const carimage = require('./carimage');
const backup = require('./backup');
const registerInventory = require('./inventory-routes');
const features = require('./features');
const assist = require('./order-assist');
const trash = require('./trash');
const templates = require('./templates');
const presence = require('./presence');
const branding = require('./branding');
const mywork = require('./mywork');
const festive = require('./festive');
const autofill = require('./autofill');

const app = express();
// Beveiligde cookies: altijd als COOKIE_SECURE=true, anders automatisch zodra het verzoek via HTTPS
// binnenkomt (bijv. via de Cloudflare-tunnel). Zo blijft gewoon http in het eigen netwerk ook werken.
const FORCE_SECURE = process.env.COOKIE_SECURE === 'true';

/* ---------- session secret ---------- */
function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(DATA_DIR, 'session-secret');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

/* ---------- app setup ---------- */
app.disable('x-powered-by');
// Proxy-headers (X-Forwarded-Proto/For) alleen vertrouwen van deze computer zelf (cloudflared),
// of van één proxy ervoor als trust-proxy=true.
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : 'loopback');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN', // alleen ADONIS zelf mag pagina's in een venster tonen (bureaubladmodus)
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'self'; base-uri 'none'",
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});

/* ---------- statische bestanden (ingebakken in de executable) ---------- */
const MIME = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};
const STARTED = Date.now().toString(36);
let festiveMemo = { at: 0, key: null };
function festiveToday() { // hooguit eens per minuut uitrekenen
  if (Date.now() - festiveMemo.at > 60000) festiveMemo = { at: Date.now(), key: festive.today() };
  return festiveMemo.key;
}
// Versie in de links naar css/js: na een update (of herstart) haalt de browser meteen de nieuwe bestanden op.
app.locals.assetVersion = `${buildinfo.version}-${STARTED}`;
app.get('/static/*file', (req, res, next) => {
  const rel = [].concat(req.params.file).join('/');
  const type = MIME[path.extname(rel)];
  const buf = type && assets.get('public/' + rel);
  if (!buf) return next();
  const etag = `"${STARTED}-${buf.length}"`;
  // Met ?v=... in de link mag de browser het bestand lang bewaren; zonder: altijd even navragen.
  res.set({ 'Content-Type': type, 'Cache-Control': req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache', ETag: etag });
  if (req.get('if-none-match') === etag) return res.status(304).end();
  res.send(buf);
});
app.get('/favicon.ico', (req, res) => res.status(204).end());

/* ---------- templates (EJS, ingebakken) ---------- */
const templateCache = new Map();
function compileTemplate(file) {
  if (assets.isEmbedded() && templateCache.has(file)) return templateCache.get(file);
  const src = assets.get(file.replace(/^\//, ''));
  if (!src) throw new Error('Template niet gevonden: ' + file);
  const fn = ejs.compile(src.toString('utf8'), {
    filename: file,
    root: '/views', // includes zijn absoluut: include('/partials/head')
    includer: (original, resolved) => {
      const rel = path.posix.normalize(resolved.replace(/\\/g, '/').replace(/^[A-Za-z]:/, ''));
      const inc = assets.get((rel.endsWith('.ejs') ? rel : rel + '.ejs').replace(/^\//, ''));
      if (!inc) throw new Error('Include niet gevonden: ' + original);
      return { template: inc.toString('utf8') };
    },
  });
  templateCache.set(file, fn);
  return fn;
}
app.use((req, res, next) => {
  res.render = (name, locals = {}) => {
    try {
      const html = compileTemplate(`/views/${name}.ejs`)({ ...app.locals, ...res.locals, ...locals });
      res.type('html').send(html);
    } catch (err) {
      if (name === 'error') {
        console.error(err);
        return res.status(500).type('text').send('Er ging iets mis.');
      }
      next(err);
    }
  };
  next();
});

app.use(express.urlencoded({ extended: true, limit: '1mb', parameterLimit: 5000 }));
app.use(
  session({
    name: 'wo.sid',
    secret: sessionSecret(),
    store: new SqliteStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: FORCE_SECURE ? true : 'auto',
      maxAge: 12 * 60 * 60 * 1000, // 12 uur na laatste activiteit
    },
  })
);
app.use(auth.loadUser);
app.use((req, res, next) => {
  res.locals.path = req.path;
  // De ADONIS-app (Windows) zet "ADONIS-app/<versie>" in de user-agent.
  res.locals.inApp = /ADONIS-app\//.test(req.get('user-agent') || '');
  { // Versie van de ADONIS-app (gelijk aan de release); de knop "Wijzigen" bij het serveradres kan het vanaf 1.24.1.
    const v = ((req.get('user-agent') || '').match(/ADONIS-app\/(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number);
    res.locals.appCanChangeServer = v.length === 3 && (v[0] * 1e6 + v[1] * 1e3 + v[2]) >= 1024001;
  }
  res.locals.url = req.originalUrl;
  // Eerste pagina van deze sessie (app gestart / browser geopend)? Zie de startpagina hieronder.
  // Het koekje verdwijnt als de app of browser sluit, dus F5 of "Klanten" stuurt je daarna niet terug.
  req.firstPage = !!req.user && req.method === 'GET' && !/(?:^|;\s*)wo_in=1/.test(req.headers.cookie || '') && !req.get('X-Live-Refresh');
  if (req.firstPage) res.cookie('wo_in', '1', { httpOnly: true, sameSite: 'lax', secure: req.secure });
  res.locals.serverUrl = `${req.protocol}://${req.get('host') || ''}`;
  // Lange lijsten: eerst PAGE regels, met "Meer tonen" (?n=...).
  res.locals.shownLimit = Math.min(Math.max(parseInt(req.query.n, 10) || PAGE, PAGE), 10000);
  res.locals.appInfo = {
    ...buildinfo,
    update: updater.getStatus(),
    autoUpdate: process.env.AUTO_UPDATE_ENABLED === 'true',
    liveUpdate: process.env.AUTO_UPDATE_LIVE === 'true',
  };
  res.locals.brand = branding.get(); // huisstijl: eigen naam, logo, banner, achtergrond
  // Feestelijke achtergrond van vandaag (Kerst, Sinterklaas…), tenzij de gebruiker die heeft uitgezet.
  res.locals.feest = req.user && req.user.prefs.feest === 'off' ? null : festiveToday();
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});
app.use(auth.csrfProtection);

/* ---------- view helpers ---------- */
function fmtDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}
/** Kilometerstand netjes: "123000" -> "123.000" (tekst die geen getal is blijft zoals hij is). */
function fmtKm(v) {
  const s = String(v ?? '').trim();
  return /^\d{4,7}$/.test(s) ? Number(s).toLocaleString('nl-NL') : s;
}
function fmtDateTime(sqlDate) {
  if (!sqlDate) return '';
  const d = new Date(sqlDate.replace(' ', 'T') + 'Z');
  return new Intl.DateTimeFormat('nl-NL', {
    timeZone: process.env.APP_TIMEZONE || 'Europe/Amsterdam', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(d);
}
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
/** <input> for a work-order field; `path` like "onderdelen.3.nr" becomes name="d[onderdelen][3][nr]". */
function inp(pathStr, value, attrs = '') {
  const name = 'd' + pathStr.split('.').map((p) => `[${p}]`).join('');
  const cls = /\bclass=/.test(attrs) ? '' : 'class="ink" ';
  return `<input ${cls}name="${name}" value="${esc(value)}" autocomplete="off" ${attrs}>`;
}
/** APK-status voor weergave: verlopen (rood), binnen 2 maanden (oranje) of in orde (groen). */
function apkStatus(iso) {
  if (!iso) return null;
  const today = new Date(orders.todayISO() + 'T00:00:00Z');
  const d = new Date(iso + 'T00:00:00Z');
  const days = Math.round((d - today) / 86400000);
  const rel = days < 0 ? (days > -31 ? `${-days} dagen geleden verlopen` : `${Math.round(-days / 30.4)} maanden geleden verlopen`)
    : days === 0 ? 'verloopt vandaag' : days < 31 ? `over ${days} dagen` : days < 365 ? `over ${Math.round(days / 30.4)} maanden`
      : `over ${(days / 365).toFixed(1).replace('.', ',')} jaar`;
  return { cls: days < 0 ? 'expired' : days <= 60 ? 'soon' : 'ok', days, rel };
}
const PAGE = 100;
/** Link naar dezelfde lijst met meer regels (n). */
app.locals.moreUrl = (url, n) => {
  const u = new URL(url, 'http://x');
  u.searchParams.set('n', String(n));
  return u.pathname + u.search;
};
app.locals.apkStatus = apkStatus;
app.locals.rdwUrl = rdw.rdwUrl;
app.locals.rdwMerkType = rdw.merkType;
app.locals.esc = esc;
app.locals.inp = inp;
app.locals.workRows = orders.workRows;
app.locals.fmtNr = orders.fmtNr;
app.locals.avatarHtml = auth.avatarHtml;
app.locals.AVATAR_ICONS = auth.AVATAR_ICONS;
app.locals.AVATAR_COLORS = auth.AVATAR_COLORS;
app.locals.fmtDate = fmtDate;
app.locals.fmtKm = fmtKm;
/** Kopje per dag in de lijst met werkopdrachten: Vandaag, Gisteren, daarna de weekdag (deze week) of de volledige datum. */
app.locals.dayLabel = (iso) => {
  if (!iso) return 'Zonder datum';
  const today = new Date(orders.todayISO() + 'T00:00:00Z');
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
  if (isNaN(d)) return iso;
  const days = Math.round((today - d) / 864e5);
  const opts = { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' };
  if (d.getUTCFullYear() !== today.getUTCFullYear()) opts.year = 'numeric';
  const full = new Intl.DateTimeFormat('nl-NL', opts).format(d);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  if (days === 0) return 'Vandaag · ' + full;
  if (days === 1) return 'Gisteren · ' + full;
  if (days === 2) return 'Eergisteren · ' + full;
  if (days < 0) return cap(full);
  return cap(full);
};
app.locals.fmtDateTime = fmtDateTime;
app.locals.FLUIDS = orders.FLUIDS;
app.locals.TIRES = orders.TIRES;
app.locals.WORK_LINES = orders.WORK_LINES;
app.locals.fmtMm = inv.fmtMm;
app.locals.plateInfo = plates.plateInfo;
app.locals.PLATE_STARS = plates.STARS_SVG;
app.locals.treadClass = inv.treadClass;
app.locals.seasonClass = inv.seasonClass;
app.locals.SEASONS = inv.SEASONS;
function flash(req, type, text) {
  req.session.flash = { type, text };
}
function likeTerm(q) {
  return '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------- eerste gebruiker ---------- */
app.get('/setup', (req, res) => {
  if (auth.userCount() > 0) return res.redirect('/login');
  res.render('setup', { title: 'Eerste account aanmaken', error: null, values: {} });
});
app.post('/setup', wrap(async (req, res) => {
  if (auth.userCount() > 0) return res.redirect('/login');
  const { username, name, password, password2 } = req.body;
  try {
    if (password !== password2) throw new Error('De wachtwoorden komen niet overeen.');
    await auth.createUser({ username, name, password, isAdmin: true });
  } catch (err) {
    return res.status(400).render('setup', { title: 'Eerste account aanmaken', error: err.message, values: { username, name } });
  }
  flash(req, 'ok', 'Account aangemaakt. Log nu in.');
  res.redirect('/login');
}));

/* ---------- inloggen ---------- */
function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}
app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  if (auth.userCount() === 0) return res.redirect('/setup');
  res.render('login', { title: 'Inloggen', error: null, username: '', next: safeNext(req.query.next) });
});
app.post('/login', wrap(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const next = safeNext(req.body.next);
  const key = req.ip + '|' + username.toLowerCase();
  const fail = (msg) => res.status(401).render('login', { title: 'Inloggen', error: msg, username, next });
  if (auth.loginBlocked(key) || auth.loginBlocked(req.ip)) {
    return fail('Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw.');
  }
  const user = await auth.verifyLogin(username, req.body.password);
  if (!user) {
    auth.loginFailed(key);
    auth.loginFailed(req.ip); // ook per IP-adres, over alle gebruikersnamen heen
    return fail('Onjuiste gebruikersnaam of wachtwoord.');
  }
  auth.loginSucceeded(key);
  req.session.regenerate((err) => {
    if (err) return res.status(500).send('Sessiefout');
    req.session.userId = user.id;
    req.session.csrf = crypto.randomBytes(24).toString('hex');
    // "Ingelogd blijven op dit apparaat" (standaard aan): 30 dagen na het laatste gebruik, anders 12 uur.
    if (req.body.remember === '1') req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
    // Startpagina uit de persoonlijke instellingen, tenzij er naar een specifieke pagina werd gevraagd.
    const prefs = auth.findUserById(user.id).prefs;
    setThemeCookie(res, prefs.theme);
    res.redirect(next === '/' ? (prefs.desktop === 'on' ? '/bureaublad' : prefs.start) : next);
  });
}));
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('wo.sid');
    res.redirect('/login');
  });
});

// Voor de ADONIS-app: welke versie draait de server? De app werkt zichzelf bij naar precies deze versie
// (en downloadt die alleen van de vaste GitHub-releases van ADONIS, nooit van een adres dat de server noemt).
app.get('/app-versie', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ version: buildinfo.version });
});

/* Huisstijl: logo, banner en achtergrond (ook op de inlogpagina, dus zonder inloggen). */
app.get('/huisstijl.css', (req, res) => {
  res.set({ 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache' });
  res.send(branding.css());
});
app.get('/huisstijl/:slot', (req, res) => {
  const f = branding.file(req.params.slot);
  if (!f) return res.status(404).end();
  res.set({ 'Content-Type': f.mime, 'Cache-Control': req.query.v === f.hash ? 'public, max-age=31536000, immutable' : 'no-cache' });
  res.send(f.data);
});

/* ---------- alles hieronder vereist inloggen ---------- */
// Even kijken of ADONIS (weer) draait, bijv. na het terugzetten van een backup – zonder in te loggen, zegt niets meer dan /app-versie.
app.get('/status', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ok: true }); });
app.use(auth.requireLogin);

/* Onderdelen die de beheerder heeft uitgezet (Systeem → Onderdelen): weg uit menu's en niet te openen. */
app.use((req, res, next) => {
  const on = features.state();
  res.locals.feat = on;
  res.locals.newAction = features.newAction(on);
  res.locals.newActions = features.newActions(on);
  if (features.allowed(req.path, on)) return next();
  // Importeren zonder werkopdrachten: meteen naar de Excel-import (bandenhotel/voorraad), als die er is.
  if (req.method === 'GET' && req.path === '/importeren' && req.user.is_admin && features.allowed('/importeren/excel', on)) return res.redirect('/importeren/excel');
  const msg = 'Dit onderdeel van ADONIS staat uit.';
  if (req.method !== 'GET' || req.xhr || (req.get('accept') || '').includes('application/json')) return res.status(404).json({ error: msg });
  res.status(404).render('error', {
    title: 'Onderdeel staat uit',
    message: msg + (req.user.is_owner ? ' U kunt het weer aanzetten bij Systeem → Onderdelen.' : ' De beheerder kan het weer aanzetten.'),
    action: req.user.is_owner ? { href: '/systeem#onderdelen', label: 'Naar Onderdelen' } : null,
  });
});

// Backup-waarschuwing voor de ADONIS-beheerder (mislukt, te oud of nog nooit gemaakt).
app.use((req, res, next) => {
  if (req.user && req.user.is_owner && !req.path.startsWith('/systeem')) {
    const h = backup.health();
    if (h.state !== 'ok') res.locals.backupWarn = { state: h.state, lastOk: h.c.lastOk, error: h.c.last && h.c.last.error };
  }
  next();
});

// Teller "Facturatie" in het menu voor wie mag factureren.
app.use((req, res, next) => {
  if (req.user && req.user.can_invoice && res.locals.feat.werkopdrachten) res.locals.invoiceCount = orders.statusCounts().klaar;
  next();
});

/* Live bijwerken: open verbinding per scherm */
app.get('/events', (req, res) => events.subscribe(req, res));
function announce(req, action, order) {
  events.broadcast({
    type: 'order', action, id: order.id, nummer: orders.fmtNr(order.nummer), kenteken: order.kenteken || '', status: order.status || null,
    customerId: order.customerId || null, by: req.user.name, byId: req.user.id,
  });
}

/* Klantenoverzicht op kenteken */
app.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  // ADONIS (de app of de browser) wordt geopend: naar de gekozen startpagina.
  if (req.firstPage && !q && req.user.prefs.desktop === 'on') return res.redirect('/bureaublad');
  if (req.firstPage && !q && req.user.prefs.start && req.user.prefs.start !== '/' && features.allowed(req.user.prefs.start, res.locals.feat)) return res.redirect(req.user.prefs.start);
  let rows;
  const base = `
    SELECT c.*, COUNT(o.id) AS aantal, MAX(o.datum_invoer) AS laatste,
      (SELECT COUNT(*) FROM tyre_storage t WHERE t.plate_key = c.plate_key AND t.soort = 'klant' AND t.status = 'opgeslagen') AS banden
    FROM customers c LEFT JOIN orders o ON o.customer_id = c.id`;
  // Tabbladen: actieve klanten (standaard), inactief, geen herinneringen, alle. Zoeken vindt altijd iedereen.
  const toon = ['actief', 'weg', 'genegeerd', 'alle'].includes(req.query.toon) ? req.query.toon : 'actief';
  const statusWhere = q || toon === 'alle' ? '1' : toon === 'actief' ? "COALESCE(c.status, '') = ''" : 'c.status = ?';
  const statusParams = !q && (toon === 'weg' || toon === 'genegeerd') ? [toon] : [];
  if (q) {
    const term = likeTerm(q);
    const pkey = plateKey(q);
    rows = db.prepare(
      `${base}
       WHERE (? <> '' AND c.plate_key LIKE ? ESCAPE '\\') OR c.naam LIKE ? ESCAPE '\\' OR c.merk_type LIKE ? ESCAPE '\\'
          OR c.klantnr LIKE ? ESCAPE '\\' OR c.plaats LIKE ? ESCAPE '\\' OR c.chassisnummer LIKE ? ESCAPE '\\'
       GROUP BY c.id ORDER BY c.plate_key LIMIT 500`
    ).all(pkey, likeTerm(pkey), term, term, term, term, term);
  } else {
    rows = db.prepare(`${base} WHERE ${statusWhere} GROUP BY c.id ORDER BY c.plate_key LIMIT 2000`).all(...statusParams);
  }
  const statusCounts = Object.fromEntries(db.prepare("SELECT COALESCE(status, '') AS s, COUNT(*) AS n FROM customers GROUP BY s").all().map((r) => [r.s || 'actief', r.n]));
  // Precies één klant met dit kenteken? Dan meteen naar die klant (niet bij live zoeken tijdens het typen).
  if (q && !req.get('X-Live-Refresh')) {
    const exact = rows.filter((c) => c.plate_key && c.plate_key === plateKey(q));
    if (exact.length === 1) return res.redirect(`/klant/${exact[0].id}`);
  }
  res.render('customers', { title: 'Klanten', q, customers: rows, toon, statusCounts, CUSTOMER_STATUS: orders.CUSTOMER_STATUS });
});

/* Zoeken vanaf het startscherm: kies waarin (klanten, werkopdrachten, banden, onderdelen); per soort de beste treffers. */
const SEARCH_SCOPES = [
  ['klanten', 'Klanten', () => true], ['werkopdrachten', 'Werkopdrachten', (F) => F.werkopdrachten],
  ['banden', 'Banden', (F) => F.bandenhotel || F.voorraad], ['onderdelen', 'Onderdelen', (F) => F.voorraad],
];
app.locals.SEARCH_SCOPES = SEARCH_SCOPES;
app.get('/zoeken', (req, res) => {
  const q = String(req.query.q || '').trim();
  const F = res.locals.feat;
  const avail = SEARCH_SCOPES.filter(([, , ok]) => ok(F)).map(([k]) => k);
  let scope = [].concat(req.query.in || []).filter((k) => avail.includes(k));
  if (!scope.length) scope = ['klanten'];
  const R = {};
  const LIM = 8;
  if (q) {
    const term = likeTerm(q); const pkey = plateKey(q);
    if (scope.includes('klanten')) {
      R.klanten = db.prepare(`SELECT c.* FROM customers c WHERE (? <> '' AND c.plate_key LIKE ? ESCAPE '\\') OR c.naam LIKE ? ESCAPE '\\'
        OR c.merk_type LIKE ? ESCAPE '\\' OR c.klantnr LIKE ? ESCAPE '\\' OR c.plaats LIKE ? ESCAPE '\\' OR c.chassisnummer LIKE ? ESCAPE '\\'
        ORDER BY c.updated_at DESC LIMIT ${LIM + 1}`).all(pkey, likeTerm(pkey), term, term, term, term, term);
    }
    if (scope.includes('werkopdrachten')) {
      const sq = synonyms.sqlFor('o.search_text', q, likeTerm);
      const asNr = /^\d{1,9}$/.test(q) ? Number(q) : -1;
      R.werkopdrachten = db.prepare(`SELECT o.*, c.kenteken AS c_kenteken FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE ((${sq.where}) OR c.plate_key LIKE ? ESCAPE '\\' OR o.nummer = ?) ORDER BY o.datum_invoer DESC, o.nummer DESC LIMIT ${LIM + 1}`)
        .all(...sq.params, likeTerm(pkey || q), asNr).map(withSummary);
    }
    if (scope.includes('banden')) {
      R.banden = [
        ...(F.bandenhotel ? [...inv.searchTyres({ soort: 'klant', q, status: 'alle' }), ...inv.searchTyres({ soort: 'opslag', q, status: 'alle' })] : []).map((t) => ({ t })),
        ...(F.voorraad ? inv.searchStock({ soort: 'band', q }) : []).map((s) => ({ s })),
      ].slice(0, LIM + 1);
    }
    if (scope.includes('onderdelen')) R.onderdelen = inv.searchStock({ soort: 'onderdeel', q }).slice(0, LIM + 1);
  }
  // Enter met alleen Klanten aan en precies één klant met dit kenteken: meteen naar die klant (zoals op de klantenlijst).
  if (q && !req.get('X-Live-Refresh') && scope.length === 1 && scope[0] === 'klanten') {
    const exact = (R.klanten || []).filter((c) => c.plate_key && c.plate_key === plateKey(q));
    if (exact.length === 1) return res.redirect(`/klant/${exact[0].id}`);
  }
  res.render('search', { title: q ? `Zoeken: ${q}` : 'Zoeken', q, scope, avail, R, LIM });
});

/* Startscherm: grote knoppen naar de belangrijkste onderdelen (standaard bij Eenvoudige weergave) */
app.get('/start', (req, res) => {
  const counts = orders.statusCounts();
  // Alleen de werkopdrachten van vandaag (datum invoer), nieuwste eerst.
  const recent = db.prepare(
    `SELECT o.*, c.kenteken AS c_kenteken FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE o.datum_invoer = ? ORDER BY o.nummer DESC LIMIT 200`
  ).all(orders.todayISO()).map(withSummary);
  let swaps = 0;
  try { swaps = inv.swapList(inv.swapTarget()).wisselen.filter((i) => !i.match.uitgenodigd_at).length; } catch { /* geen bandenhotel */ }
  const hour = Number(new Intl.DateTimeFormat('nl-NL', { hour: 'numeric', hour12: false, timeZone: process.env.APP_TIMEZONE || 'Europe/Amsterdam' }).format(new Date()));
  const apkSoon = apkRows().filter((r) => r.days <= 60 && r.days >= -7 && !r.called).length;
  res.render('start', {
    title: 'Start', counts, recent, swaps, swapTarget: inv.swapTarget(), apkSoon,
    greeting: hour < 6 ? 'Goedenacht' : hour < 12 ? 'Goedemorgen' : hour < 18 ? 'Goedemiddag' : 'Goedenavond',
    today: new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: process.env.APP_TIMEZONE || 'Europe/Amsterdam' }).format(new Date()),
    importOn: importer.isConfigured(),
  });
});
app.get('/hulp', (req, res) => res.render('help', { title: 'Hulp' }));
app.get('/rekenhulp', (req, res) => res.render('calc', { title: 'Rekenhulp', tarief: assist.lastTarief() }));
// Bureaubladmodus: pagina's als vensters die je kunt verslepen (zie public/js/desktop.js).
app.get('/bureaublad', (req, res) => res.render('desktop', { title: 'Bureaublad', desktopShell: true, importOn: importer.isConfigured(), aiOn: importer.isConfigured(), trashCount: req.user.is_admin ? trash.count() : 0 }));
// Herinneringen (één keer per dag, zie live.js): wie moet er gebeld worden?
app.get('/meldingen/herinneringen', (req, res) => {
  const items = [];
  const on = res.locals.feat;
  if (on.apk) try {
    const rows = apkRows().filter((r) => !r.called);
    const soon = rows.filter((r) => r.days >= 0 && r.days <= 14).length;
    const late = rows.filter((r) => r.days < 0 && r.days >= -7).length;
    if (soon || late) items.push({ text: `APK: ${[soon ? `${soon} klant${soon === 1 ? '' : 'en'} binnen 2 weken` : '', late ? `${late} net verlopen` : ''].filter(Boolean).join(' en ')} – nog niet gebeld.`, href: '/apk' });
  } catch { /* geen APK-gegevens */ }
  if (on.bandenhotel) try {
    const target = inv.swapTarget();
    const n = inv.swapList(target).wisselen.filter((i) => !i.match.uitgenodigd_at).length;
    if (n) items.push({ text: `Bandenwissel: ${n} klant${n === 1 ? '' : 'en'} met ${target === 'winter' ? 'winter' : 'zomer'}banden in het bandenhotel nog bellen.`, href: '/bandenhotel/wissellijst' });
  } catch { /* geen bandenhotel */ }
  res.json({ items });
});

/* APK-lijst: wie moet binnenkort (of al) naar de APK? Met telefoonnummer en "Gebeld". */
function apkRows() {
  const today = orders.todayISO();
  const rows = db.prepare(
    `SELECT c.*, MAX(o.datum_invoer) AS laatste FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
     WHERE c.apk_vervaldatum IS NOT NULL AND c.apk_vervaldatum <> '' AND COALESCE(c.status, '') = '' GROUP BY c.id`
  ).all();
  return rows.map((c) => {
    const days = Math.round((new Date(c.apk_vervaldatum + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 864e5);
    return { ...c, days, called: c.apk_gebeld_voor === c.apk_vervaldatum ? c.apk_gebeld : null };
  });
}
app.set('apkRows', apkRows); // ook voor "APK-aandachtspunten opzoeken" (ai-routes)
app.get('/apk', (req, res) => {
  const show = ['verlopen', 'binnenkort', 'alles'].includes(req.query.toon) ? req.query.toon : 'binnenkort';
  const all = apkRows();
  const pick = { verlopen: (r) => r.days < 0, binnenkort: (r) => r.days <= 60 && r.days >= -7, alles: () => true }[show];
  const list = all.filter(pick).sort((a, b) => (a.called ? 1 : 0) - (b.called ? 1 : 0) || a.days - b.days);
  const waiting = db.prepare('SELECT kenteken FROM customers WHERE rdw_at IS NULL').all().filter((c) => plates.rdwApplicable(c.kenteken)).length;
  res.render('apk', {
    title: 'APK-lijst', show, list, waiting, aiConfigured: importer.isConfigured(),
    // Per klant: zijn de APK-aandachtspunten van dit model al opgezocht?
    modelPoints: Object.fromEntries(list.map((r) => { const g = require('./model-bulletins').get(r); return [r.id, g.data ? g.data.items : null]; })),
    counts: { verlopen: all.filter((r) => r.days < 0).length, binnenkort: all.filter((r) => r.days <= 60 && r.days >= -7).length, alles: all.length },
  });
});
app.post('/apk/:id/gebeld', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  let at = null;
  if (c) {
    const already = c.apk_gebeld_voor === c.apk_vervaldatum && c.apk_gebeld;
    at = already ? null : orders.todayISO();
    db.prepare('UPDATE customers SET apk_gebeld = ?, apk_gebeld_voor = ? WHERE id = ?').run(at, at ? c.apk_vervaldatum : null, c.id);
    events.broadcast({ type: 'data', area: 'apk', by: req.user.name, byId: req.user.id,
      ...(at ? { cat: 'klanten', msg: `${c.kenteken}${c.naam ? ' (' + c.naam + ')' : ''}: gebeld voor de APK`, href: `/klant/${c.id}` } : {}) });
  }
  if ((req.get('accept') || '').includes('application/json')) return res.json({ ok: true, uitgenodigd_at: at });
  res.redirect('/apk');
});

/* Eén klant met alle werkopdrachten */
// Klantstatus: actief / inactief / geen herinneringen (geen APK-herinneringen en wissellijst meer).
app.post('/klant/:id/status', (req, res) => {
  const c = db.prepare('SELECT id, kenteken FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.redirect('/');
  const status = ['', 'weg', 'genegeerd'].includes(req.body.status) ? req.body.status : '';
  orders.setCustomerStatus(c.id, status, req.user);
  events.broadcast({ type: 'data', area: 'klanten', id: c.id, by: req.user.name, byId: req.user.id });
  flash(req, 'ok', status === 'weg' ? `${c.kenteken} staat nu op Inactief: geen APK-herinneringen en niet op de wissellijst. Werkopdrachten en gegevens blijven bewaard.`
    : status ? `${c.kenteken}: geen herinneringen meer (APK-lijst en wissellijst). Werkopdrachten en gegevens blijven bewaard.`
      : `${c.kenteken} is weer actief.`);
  const back = String(req.body.terug || '');
  res.redirect(back.startsWith('/') && !back.startsWith('//') ? back : `/klant/${c.id}`);
});
app.get('/klant/:id', wrap(async (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).render('error', { title: 'Niet gevonden', message: 'Deze klant bestaat niet.' });
  const q = String(req.query.q || '').trim();
  // Zoeken met zoekwoorden: "lampen" vindt ook "dagrijverlichting".
  const sq = q ? synonyms.sqlFor('search_text', q, likeTerm) : null;
  const rows = q
    ? db.prepare(
        `SELECT * FROM orders WHERE customer_id = ? AND (${sq.where}) ORDER BY datum_invoer DESC, nummer DESC`
      ).all(customer.id, ...sq.params)
    : db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY datum_invoer DESC, nummer DESC').all(customer.id);
  // Alleen Nederlandse kentekens staan bij de RDW (niet bijv. een Duits kenteken).
  const rdwData = plates.rdwApplicable(customer.kenteken) ? await rdw.forCustomer(customer) : { foreign: true, country: plates.plateInfo(customer.kenteken).country };
  res.render('customer', {
    title: customer.kenteken, customer, q, searchParts: sq ? sq.parts : [], orders: rows.map(withSummary), rdwData,
    bulletinData: bulletins.forCustomer(customer.id), aiConfigured: importer.isConfigured(),
    plateLinks: require('./portal').plateLinks(customer.kenteken),
    modelApk: require('./model-bulletins').get(customer), tyres: inv.tyresForPlate(customer.plate_key), fotos: require('./photos').firstPhotos('tyre'),
    ...carPhoto(req, customer, rdwData),
    editing: req.query.bewerken === '1', editError: null, editValues: null, swapTarget: inv.swapTarget(),
  });
}));

/** Foto van het automodel (als de gebruiker dat wil): zoekterm, en de foto als die al bekend is. */
function carPhoto(req, customer, rdwData) {
  if (req.user.prefs.carimg === 'off') return { carQ: '', carImg: null };
  const info = rdwData && rdwData.info && rdwData.info.found ? rdwData.info : null;
  const carQ = info ? carimage.queryFor(info.merk, info.handelsbenaming) : carimage.queryFor('', customer.merk_type);
  const hit = carQ ? carimage.cached(carQ) : null;
  return { carQ, carImg: hit ? carimage.publicInfo(hit) : null, carYear: info && info.eersteToelating ? info.eersteToelating.slice(0, 4) : '' };
}
// Foto van een automodel opzoeken (Wikipedia, gratis) en van deze computer tonen.
app.get('/autofoto', wrap(async (req, res) => {
  const q = String(req.query.q || '').slice(0, 80);
  res.json(q ? await carimage.lookup(q) : { ok: false });
}));
// "Verkeerde auto": voor dit model nooit meer een foto tonen.
app.post('/autofoto/fout', (req, res) => {
  const q = String((req.body && req.body.q) || req.query.q || '').slice(0, 80);
  if (q) carimage.block(q);
  res.json({ ok: true });
});
// Voorbeeldfoto van een soort onderdeel (bijv. BOUGIE -> een bougie), ook via Wikipedia.
app.get('/onderdeelfoto', wrap(async (req, res) => {
  const type = String(req.query.type || '').slice(0, 80);
  res.json(type ? await carimage.lookupPart(type) : { ok: false });
}));
app.post('/onderdeelfoto/fout', (req, res) => {
  const type = String((req.body && req.body.type) || '').slice(0, 80);
  if (type) carimage.blockPart(type);
  res.json({ ok: true });
});
app.get('/autofoto/img/:id', (req, res) => {
  const f = carimage.imagePath(req.params.id);
  if (!f) return res.status(404).end();
  res.set({ 'Content-Type': f.type, 'Cache-Control': 'private, max-age=2592000' }).send(fs.readFileSync(f.file));
});

// Klantgegevens wijzigen (naam, adres, telefoon, kenteken, ...).
app.post('/klant/:id/bewerken', wrap(async (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.redirect('/');
  try {
    const r = orders.updateCustomer(customer.id, req.body.c || {}, plates.formatPlate);
    events.broadcast({ type: 'data', area: 'klanten', id: customer.id, by: req.user.name, byId: req.user.id,
      cat: 'klanten', msg: r.plateChanged ? `Kenteken gewijzigd: ${r.oldKenteken} → ${r.kenteken}` : `Klantgegevens gewijzigd: ${customer.kenteken}${customer.naam ? ' (' + customer.naam + ')' : ''}`, href: `/klant/${customer.id}` });
    if (r.plateChanged) rdw.refreshInBackground(r.kenteken);
    flash(req, 'ok', r.plateChanged
      ? `Klantgegevens opgeslagen. Het kenteken is gewijzigd van ${r.oldKenteken} naar ${r.kenteken}, ook op de werkopdrachten en in het bandenhotel.`
      : 'Klantgegevens opgeslagen.');
    res.redirect(`/klant/${customer.id}`);
  } catch (err) {
    const rows = db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY datum_invoer DESC, nummer DESC').all(customer.id);
    const rdwData = plates.rdwApplicable(customer.kenteken) ? await rdw.forCustomer(customer) : { foreign: true, country: plates.plateInfo(customer.kenteken).country };
    res.status(400).render('customer', {
      title: customer.kenteken, customer, q: '', orders: rows.map(withSummary), rdwData, tyres: inv.tyresForPlate(customer.plate_key),
      fotos: require('./photos').firstPhotos('tyre'), editing: true, editError: err.message, editValues: req.body.c || {}, clashId: err.clashId || null,
      ...carPhoto(req, customer, rdwData),
      swapTarget: inv.swapTarget(),
    });
  }
}));

// Vastleggen welke banden er nu op de auto staan (klantpagina, bandenhotel).
app.post('/klant/:id/op-auto', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.redirect('/');
  inv.setOnCar(customer, req.body.op || {}, req.user.id);
  events.broadcast({ type: 'data', area: 'bandenhotel', by: req.user.name, byId: req.user.id });
  flash(req, 'ok', 'Vastgelegd welke banden er op de auto staan.');
  res.redirect(`/klant/${customer.id}#banden`);
});

// RDW-gegevens opnieuw ophalen (knop op de klantpagina).
app.post('/klant/:id/rdw', wrap(async (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.redirect('/');
  const r = await rdw.forCustomer(customer, { force: true });
  flash(req, r.error ? 'err' : 'ok', r.error ? `RDW niet bereikbaar: ${r.error}` : 'RDW-gegevens bijgewerkt.');
  res.redirect(`/klant/${customer.id}`);
}));

// RDW opzoeken vanuit het werkopdrachtformulier (JSON).
app.get('/rdw/:kenteken', wrap(async (req, res) => {
  const key = plateKey(req.params.kenteken);
  if (!plates.rdwApplicable(req.params.kenteken)) {
    return res.status(400).json({ ok: false, foreign: true, error: 'Geen Nederlands kenteken: de RDW heeft alleen gegevens van Nederlandse kentekens.' });
  }
  try {
    const customer = db.prepare('SELECT * FROM customers WHERE plate_key = ?').get(key);
    const info = customer ? (await rdw.forCustomer(customer)).info : await rdw.lookup(key);
    if (!info) throw new Error('niet bereikbaar');
    res.json({ ok: true, info, merkType: rdw.merkType(info), url: rdw.rdwUrl(key), apk: apkStatus(info.apk) });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'De RDW is op dit moment niet bereikbaar.' });
  }
}));

/* Alle werkopdrachten doorzoeken */
app.get('/werkopdrachten', (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = orders.STATUSES[req.query.status] ? req.query.status : '';
  const where = [];
  const params = [];
  let sq = null;
  if (q) {
    // Elk woord moet voorkomen; voor elk woord tellen ook woorden uit dezelfde zoekwoordengroep.
    sq = synonyms.sqlFor('o.search_text', q, likeTerm);
    // Een nummer (ook 0100 voor werkopdracht 100) vindt altijd die werkopdracht.
    const asNr = /^\d{1,9}$/.test(q) ? Number(q) : -1;
    where.push(`((${sq.where}) OR c.plate_key LIKE ? ESCAPE '\\' OR o.nummer = ?)`);
    params.push(...sq.params, likeTerm(plateKey(q) || q), asNr);
  }
  if (status) { where.push('o.status = ?'); params.push(status); }
  // Te factureren: oudste eerst (wie het langst wacht, staat bovenaan).
  const order = status === 'klaar' ? 'o.status_at ASC, o.nummer ASC' : 'o.datum_invoer DESC, o.nummer DESC';
  const rows = db.prepare(
    `SELECT o.*, c.kenteken AS c_kenteken, su.name AS status_by_name
     FROM orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN users su ON su.id = o.status_by
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ${q || status ? 500 : 200}`
  ).all(...params);
  res.render('orders', {
    title: status === 'klaar' ? 'Facturatie' : 'Werkopdrachten', q, status, counts: orders.statusCounts(), searchParts: sq ? sq.parts : [], aiConfigured: importer.isConfigured(),
    STATUSES: orders.STATUSES, orders: rows.map(withSummary),
  });
});

// Auto in lijsten: merk/type van de werkopdracht (anders van de klant of de RDW) en de kleur volgens de RDW.
const carStmt = db.prepare('SELECT merk_type, rdw_json FROM customers WHERE id = ?');
const KLEUR_CLS = { grijs: 'grijs', zwart: 'zwart', wit: 'wit', blauw: 'blauw', rood: 'rood', groen: 'groen', geel: 'geel', oranje: 'oranje', bruin: 'bruin',
  beige: 'beige', paars: 'paars', roze: 'roze', creme: 'creme', 'crème': 'creme', brons: 'brons', zilver: 'grijs', goud: 'geel' };
// "VOLKSWAGEN GOLF" (zoals de RDW het schrijft) -> "Volkswagen Golf"; afkortingen (BMW, GTI, TDI…) blijven hoofdletters.
const KEEP_UPPER = new Set(['BMW', 'VW', 'MG', 'DS', 'GT', 'GTI', 'GTD', 'TDI', 'TSI', 'TFSI', 'CDI', 'HDI', 'AMG', 'RS', 'SUV', 'DAF', 'MAN', 'XC', 'CX', 'ID', 'EV', 'BYD', 'KTM']);
function niceCase(s) {
  if (!s || s !== s.toUpperCase() || !/[A-Z]{3}/.test(s)) return s;
  return s.split(/(\s+|-)/).map((w) => (KEEP_UPPER.has(w) || /\d/.test(w) || w.length < 2 ? w : w.charAt(0) + w.slice(1).toLowerCase())).join('');
}
function carOf(row, data) {
  const c = row.customer_id ? carStmt.get(row.customer_id) : null;
  let info = null;
  try { info = c && c.rdw_json ? JSON.parse(c.rdw_json) : null; } catch { /* geen */ }
  const merk = niceCase((data.merk_type || (c && c.merk_type) || rdw.merkType(info) || '').trim());
  const kleur = info && info.found !== false ? String(info.kleur || '').trim() : '';
  const first = kleur.split('/')[0].trim().toLowerCase();
  return { merk, kleur, cls: KLEUR_CLS[first] || (kleur ? 'anders' : '') };
}
function withSummary(row) {
  const data = orders.parseOrderData(row.data);
  const firstLine = data.werk_omschrijving.split('\n').map((l) => l.replace(/^[-–\s]+/, '').trim()).find(Boolean) || '';
  return { ...row, d: data, summary: firstLine, car: carOf(row, data) };
}

/* ---------- werkopdracht formulier ---------- */
function renderOrder(res, { order, data, nummer, error, status, draft, datumInvoer }) {
  const user = res.locals.user;
  res.status(status || 200).render('order', {
    title: draft ? 'Import controleren' : order ? `Werkopdracht ${orders.fmtNr(order.nummer)}` : 'Nieuwe werkopdracht',
    order, data, nummer, error, draft: draft || null,
    STATUSES: orders.STATUSES, PAGE_TYPES: orders.PAGE_TYPES, MAX_PAGES: orders.MAX_PAGES, emptyPage: orders.emptyPage,
    photoList: order ? require('./photos').list('order', order.id) : [],
    templates: templates.list(),
    editable: draft ? true : orders.canEdit(user, order),
    transitions: orders.allowedTransitions(user, order || { status: 'open' }),
    history: order ? orders.history(order.id) : [],
    datumInvoer: draft ? (datumInvoer || '') : datumInvoer || (order ? order.datum_invoer : orders.todayISO()),
    // Aandachtspunten van deze auto bovenaan de werkopdracht (zodat de monteur ze ziet tijdens het werk).
    orderBulletins: (() => {
      const cust = order && order.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id)
        : data && data.kenteken && plateKey(data.kenteken) ? db.prepare('SELECT * FROM customers WHERE plate_key = ?').get(plateKey(data.kenteken)) : null;
      if (!cust) return null;
      const bl = bulletins.forCustomer(cust.id);
      const modelApk = require('./model-bulletins').get(cust);
      return bl.open.length || (modelApk.data && modelApk.data.items.length) ? { bl, customer: cust, modelApk } : null;
    })(),
    autofillFlags: autofill.flags(),
    // Portaal-websites die met het kenteken zoeken (bijv. onderdelen of olie opzoeken tijdens het werk).
    plateLinks: data && data.kenteken ? require('./portal').plateLinks(data.kenteken) : [],
  });
}

/* Hulp bij het invullen (JSON): wat weten we al van dit kenteken, en suggesties tijdens het typen. */
app.get('/werkopdracht/hulp', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(assist.vehicle(String(req.query.kenteken || ''), { exceptOrderId: Number(req.query.id) || null, tyres: res.locals.feat.bandenhotel }));
});
app.get('/werkopdracht/suggesties', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const kind = ['onderdeel', 'werk', 'bandmaat', 'bandmerk', 'klant'].includes(req.query.soort) ? req.query.soort : null;
  const af = autofill.state();
  if (!af.on.suggesties) return res.json({ items: [] }); // uitgezet bij Systeem → Automatisch invullen
  res.json({ items: kind ? assist.suggest(kind, String(req.query.q || ''), { stock: res.locals.feat.voorraad, eigen: af }) : [] });
});

app.get('/werkopdracht/nieuw', (req, res) => {
  const data = orders.emptyOrderData();
  const af = autofill.state(); // Systeem → Automatisch invullen
  if (af.on.monteur) data.monteur = req.user.name;
  data.voorkant = '2'; // nieuwe werkopdrachten: werkzaamheden regel voor regel
  data.tarief = af.vast.tarief || (af.on.tarief ? assist.lastTarief() : ''); // vast tarief, of dat van de laatste werkopdracht
  if (af.vast.contact_boven) data.contact_boven = af.vast.contact_boven;
  if (af.vast.alle_reparaties) data.alle_reparaties = af.vast.alle_reparaties;
  // Nieuwe werkopdracht vanuit een sjabloon (bijv. "Bandenwissel").
  const tpl = req.query.sjabloon ? templates.get(Number(req.query.sjabloon)) : null;
  if (tpl) templates.applyTo(data, tpl);
  if (req.query.klant) {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.query.klant);
    if (c) for (const f of orders.CUSTOMER_FIELDS) data[f] = c[f];
  }
  renderOrder(res, { order: null, data, nummer: orders.nextOrderNumber() });
});

function parseNummer(v) {
  const n = parseInt(String(v || '').trim(), 10);
  return Number.isInteger(n) && n > 0 && n < 1e9 ? n : null;
}

function validateOrder(data, nummer, existingId) {
  if (!nummer) return 'Vul een geldig werkopdrachtnummer in.';
  if (!plateKey(data.kenteken)) return 'Vul een kenteken in – werkopdrachten worden per kenteken opgeslagen.';
  const clash = db.prepare('SELECT id FROM orders WHERE nummer = ?').get(nummer);
  if (clash && clash.id !== existingId) return `Werkopdrachtnummer ${orders.fmtNr(nummer)} bestaat al.`;
  return null;
}

/** Status meteen bij het aanmaken (nieuw of import): 'klaar' mag iedereen, 'gefactureerd' alleen facturatie/beheer. */
function initialStatusError(req, data) {
  const next = req.body.next_status;
  if (!next) return null;
  if (!orders.allowedTransitions(req.user, { status: 'open' }).includes(next)) return 'Deze statuswijziging is niet toegestaan.';
  return factuurnrError(req, data, next);
}
/** Gefactureerd zonder factuurnummer kan, maar alleen na bevestiging (bijv. oude papieren werkopdrachten). */
function factuurnrError(req, data, next) {
  if (next === 'gefactureerd' && !data.faktuurnr.trim() && req.body.zonder_factuurnr !== '1') {
    return 'Vul het factuurnummer in (onderaan het formulier: "Factuurnummer") of bevestig dat u zonder factuurnummer wilt afronden.';
  }
  return null;
}
const DONE_MSG = { klaar: 'naar facturatie gestuurd', gefactureerd: 'als gefactureerd afgerond' };

app.post('/werkopdracht', (req, res) => {
  const data = orders.normalizeOrderData(req.body.d);
  const nummer = parseNummer(req.body.nummer);
  const error = validateOrder(data, nummer, null) || initialStatusError(req, data);
  if (error) return renderOrder(res, { order: null, data, nummer: req.body.nummer, error, status: 400 });
  const id = orders.saveOrder({ nummer, data, userId: req.user.id });
  orders.logAction(id, req.user, 'aangemaakt');
  const next = req.body.next_status;
  let msg = `Werkopdracht ${orders.fmtNr(nummer)} is opgeslagen.`;
  if (next) {
    orders.setStatus(id, next, req.user);
    msg = `Werkopdracht ${orders.fmtNr(nummer)} is opgeslagen en ${DONE_MSG[next]}.`;
  }
  announce(req, 'created', { id, nummer, kenteken: data.kenteken, status: next || 'open' });
  rdw.refreshInBackground(data.kenteken);
  flash(req, 'ok', msg);
  res.redirect(`/werkopdracht/${id}`);
});

function loadOrder(id) {
  return db.prepare(
    `SELECT o.*, cu.name AS created_by_name, uu.name AS updated_by_name, su.name AS status_by_name
     FROM orders o LEFT JOIN users cu ON cu.id = o.created_by LEFT JOIN users uu ON uu.id = o.updated_by
     LEFT JOIN users su ON su.id = o.status_by
     WHERE o.id = ?`
  ).get(id);
}

app.get('/werkopdracht/:id', (req, res) => {
  const order = loadOrder(req.params.id);
  if (!order) return res.status(404).render('error', { title: 'Niet gevonden', message: 'Deze werkopdracht bestaat niet.' });
  renderOrder(res, { order, data: orders.parseOrderData(order.data), nummer: order.nummer });
});

app.post('/werkopdracht/:id', (req, res) => {
  const order = loadOrder(req.params.id);
  if (!order) return res.status(404).render('error', { title: 'Niet gevonden', message: 'Deze werkopdracht bestaat niet.' });
  if (!orders.canEdit(req.user, order)) {
    flash(req, 'err', order.status === 'gefactureerd'
      ? 'Deze werkopdracht is gefactureerd en kan niet meer worden gewijzigd. Facturatie of een beheerder kan hem heropenen.'
      : 'Deze werkopdracht ligt bij facturatie. Haal hem eerst terug naar Open om hem te wijzigen.');
    return res.redirect(`/werkopdracht/${order.id}`);
  }
  const data = orders.normalizeOrderData(req.body.d);
  const nummer = parseNummer(req.body.nummer);
  const next = req.body.next_status;
  let error = validateOrder(data, nummer, order.id);
  if (!error && next && !orders.allowedTransitions(req.user, order).includes(next)) error = 'Deze statuswijziging is niet toegestaan.';
  if (!error) error = factuurnrError(req, data, next);
  if (!error && req.body.versie !== order.updated_at) {
    error = `Iemand anders (${order.updated_by_name || 'onbekend'}) heeft deze werkopdracht intussen gewijzigd ` +
      `(${fmtDateTime(order.updated_at)}). Open de werkopdracht opnieuw om de laatste versie te zien – ` +
      'uw wijzigingen staan hieronder nog ingevuld, maar zijn NIET opgeslagen.';
  }
  if (error) return renderOrder(res, { order, data, nummer: req.body.nummer, error, status: 400 });
  // Datum invoer is bij een bestaande werkopdracht aan te passen (bijv. een verkeerd geïmporteerde datum).
  orders.saveOrder({ id: order.id, nummer, data, userId: req.user.id, datumInvoer: orders.parseDate(req.body.datum_invoer) || null });
  orders.logAction(order.id, req.user, 'gewijzigd');
  let msg = `Werkopdracht ${orders.fmtNr(nummer)} is opgeslagen.`;
  if (next) {
    orders.setStatus(order.id, next, req.user);
    msg = next === 'klaar' ? `Werkopdracht ${orders.fmtNr(nummer)} is naar facturatie gestuurd.`
      : next === 'gefactureerd' ? `Werkopdracht ${orders.fmtNr(nummer)} is afgerond${data.faktuurnr ? ` (factuur ${data.faktuurnr})` : ' (zonder factuurnummer)'}.` : msg;
  }
  announce(req, next ? 'status' : 'updated', { id: order.id, nummer, kenteken: data.kenteken, status: next || order.status });
  flash(req, 'ok', msg);
  res.redirect(`/werkopdracht/${order.id}`);
});

/* ---------- Automatisch opslaan en live samen bewerken ----------
 * Het scherm stuurt alleen de velden die zijn veranderd (per veld: wie het laatst typt, wint). De server zet ze in de
 * nieuwste versie, slaat op en stuurt de wijziging live naar iedereen die deze werkopdracht open heeft. */
function recentlyLogged(orderId, user) {
  return !!db.prepare(`SELECT 1 FROM order_log WHERE id = (SELECT MAX(id) FROM order_log WHERE order_id = ?)
    AND user_id = ? AND action = 'gewijzigd' AND created_at > datetime('now', '-15 minutes')`).get(orderId, user.id);
}
app.get('/werkopdracht/:id/live', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const order = loadOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Deze werkopdracht bestaat niet (meer).' });
  res.json({
    rev: order.rev, versie: order.updated_at, status: order.status, editable: orders.canEdit(req.user, order),
    fields: orders.formFields(orders.parseOrderData(order.data), { nummer: order.nummer, datumInvoer: order.datum_invoer }),
    people: presence.list(order.id),
  });
});
app.post('/werkopdracht/:id/live', express.json({ limit: '2mb' }), (req, res) => {
  const body = req.body || {};
  const patch = body.patch && typeof body.patch === 'object' && !Array.isArray(body.patch) ? body.patch : null;
  if (!patch || Object.keys(patch).length > 4000) return res.status(400).json({ error: 'Ongeldige wijziging.' });
  const tab = String(body.tab || '').slice(0, 40);
  if (req.params.id === 'nieuw') {
    // Nieuwe werkopdracht: aanmaken zodra er genoeg op staat (het scherm stuurt dan alle velden mee).
    const data = orders.applyPatch(orders.emptyOrderData(), patch, { pages: true });
    let nummer = parseNummer(patch.nummer);
    // Voorgevuld nummer (niet zelf getypt) intussen door een collega gebruikt: dan het volgende vrije nummer.
    if (body.autoNummer === true && nummer && db.prepare('SELECT 1 FROM orders WHERE nummer = ?').get(nummer)) nummer = orders.nextOrderNumber();
    const error = validateOrder(data, nummer, null);
    if (error) return res.status(422).json({ error });
    const id = orders.saveOrder({ nummer, data, userId: req.user.id });
    orders.logAction(id, req.user, 'aangemaakt');
    announce(req, 'created', { id, nummer, kenteken: data.kenteken, status: 'open' });
    rdw.refreshInBackground(data.kenteken);
    const order = loadOrder(id);
    return res.json({ ok: true, id, nummer: orders.fmtNr(nummer), rev: order.rev, versie: order.updated_at,
      fields: orders.formFields(data, { nummer, datumInvoer: order.datum_invoer }) });
  }
  const order = loadOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Deze werkopdracht bestaat niet (meer).', gone: true });
  if (!orders.canEdit(req.user, order)) {
    return res.status(409).json({ error: 'Deze werkopdracht kan nu niet worden gewijzigd (de status is veranderd).', locked: true });
  }
  const before = orders.parseOrderData(order.data);
  const beforeFields = orders.formFields(before, { nummer: order.nummer, datumInvoer: order.datum_invoer });
  const data = orders.applyPatch(before, patch, { pages: body.pages === true });
  const nummer = 'nummer' in patch ? parseNummer(patch.nummer) : order.nummer;
  const datumInvoer = 'datum_invoer' in patch ? orders.parseDate(patch.datum_invoer) || order.datum_invoer : order.datum_invoer;
  const error = validateOrder(data, nummer, order.id);
  if (error) return res.status(422).json({ error, rev: order.rev });
  const afterFields = orders.formFields(data, { nummer, datumInvoer });
  const diff = orders.diffFields(beforeFields, afterFields);
  const { changed } = diff;
  const structure = diff.structure || before.voorkant !== data.voorkant; // andere voorkant: andere vakjes, dus herladen
  // De opgeslagen waarde van de gestuurde velden (bijv. kenteken in hoofdletters) gaat terug naar het scherm.
  const echo = {};
  for (const k of Object.keys(patch)) if (k in afterFields) echo[k] = afterFields[k];
  // Bladen toegevoegd/verwijderd: de server nummert ze opnieuw, dus alle bladvelden gaan terug.
  if (body.pages === true) for (const k of Object.keys(afterFields)) if (k.startsWith('d[paginas]')) echo[k] = afterFields[k];
  if (!Object.keys(changed).length && !structure) return res.json({ ok: true, rev: order.rev, versie: order.updated_at, fields: echo });
  orders.saveOrder({ id: order.id, nummer, data, userId: req.user.id, datumInvoer });
  if (!recentlyLogged(order.id, req.user)) orders.logAction(order.id, req.user, 'gewijzigd');
  const fresh = db.prepare('SELECT rev, updated_at FROM orders WHERE id = ?').get(order.id);
  events.broadcast({
    type: 'order-live', id: order.id, rev: fresh.rev, prev: order.rev, versie: fresh.updated_at, fields: changed, structure, tab,
    nummer: orders.fmtNr(nummer), kenteken: data.kenteken, by: req.user.name, byId: req.user.id,
  });
  res.json({ ok: true, rev: fresh.rev, versie: fresh.updated_at, fields: echo, structure });
});
// Wie heeft deze werkopdracht open (en in welk veld)? Elk scherm meldt zich elke 20 seconden.
app.post('/werkopdracht/:id/aanwezig', (req, res) => {
  const people = presence.update(req.params.id, req.user, { tab: req.body.tab, field: req.body.field, gone: req.body.weg === '1' });
  res.json({ people });
});

// Status wijzigen zonder het formulier op te slaan (terughalen, terugsturen, heropenen).
app.post('/werkopdracht/:id/status', (req, res) => {
  const order = loadOrder(req.params.id);
  if (!order) return res.redirect('/');
  const next = req.body.status;
  if (!orders.allowedTransitions(req.user, order).includes(next) || next === 'gefactureerd') {
    flash(req, 'err', 'Deze statuswijziging is niet toegestaan.');
    return res.redirect(`/werkopdracht/${order.id}`);
  }
  orders.setStatus(order.id, next, req.user);
  announce(req, 'status', { id: order.id, nummer: order.nummer, status: next });
  flash(req, 'ok', next === 'open'
    ? `Werkopdracht ${orders.fmtNr(order.nummer)} staat weer op Open en kan worden gewijzigd.`
    : `Werkopdracht ${orders.fmtNr(order.nummer)} is heropend en staat weer bij facturatie.`);
  res.redirect(`/werkopdracht/${order.id}`);
});

app.post('/werkopdracht/:id/verwijderen', auth.requireAdmin, (req, res) => {
  const order = loadOrder(req.params.id);
  if (!order) return res.redirect('/');
  // Eerst in de prullenbak (met klant en logboek), zodat hij terug te zetten is. Foto's blijven bewaard.
  trash.put('order', db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id), {
    label: `Werkopdracht ${orders.fmtNr(order.nummer)}${orders.parseOrderData(order.data).kenteken ? ' · ' + orders.parseOrderData(order.data).kenteken : ''}`, user: req.user,
    extra: { customer: db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id), log: db.prepare('SELECT * FROM order_log WHERE order_id = ?').all(order.id) },
  });
  const customerId = orders.deleteOrder(order.id);
  announce(req, 'deleted', { id: order.id, nummer: order.nummer, customerId });
  flash(req, 'ok', `Werkopdracht ${orders.fmtNr(order.nummer)} staat in de prullenbak (${trash.KEEP_DAYS} dagen terug te zetten).`);
  const stillExists = db.prepare('SELECT 1 FROM customers WHERE id = ?').get(customerId);
  res.redirect(stillExists ? `/klant/${customerId}` : '/');
});

/* ---------- Verkenner: alle foto's in mappen ---------- */
app.get('/verkenner', (req, res) => {
  const explorer = require('./explorer');
  const on = res.locals.feat;
  const types = Object.keys(explorer.FOLDERS).filter((t) => on[explorer.FOLDERS[t].feature]);
  const map = types.includes(req.query.map) ? req.query.map : null;
  const id = map && Number(req.query.id) ? Number(req.query.id) : null;
  const q = String(req.query.q || '').trim().toLowerCase();
  const folders = types.map((t) => ({ type: t, name: explorer.FOLDERS[t].name, owners: explorer.owners(t) }));
  let view;
  if (map && id) {
    const owner = folders.find((f) => f.type === map).owners.find((o) => o.id === id);
    view = owner ? { kind: 'photos', owner, photos: explorer.photosOf(map, id) } : { kind: 'missing' };
  } else if (map) {
    const f = folders.find((x) => x.type === map);
    view = { kind: 'owners', folder: f, owners: q ? f.owners.filter((o) => (o.label + ' ' + o.sub).toLowerCase().includes(q)) : f.owners };
  } else {
    view = { kind: 'home', recent: explorer.recent(types, 60) };
  }
  res.render('explorer', { title: 'Verkenner', folders, map, id, q, view });
});

/* ---------- sjablonen: voorgevulde werkopdrachten ---------- */
app.get('/sjablonen', (req, res) => res.render('templates', { title: 'Sjablonen', list: templates.list() }));
app.get('/sjablonen/:id.json', (req, res) => {
  const t = templates.get(Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'Sjabloon niet gevonden.' });
  res.json({ id: t.id, naam: t.naam, data: t.data });
});
// Opslaan vanaf een werkopdracht (de gegevens van het formulier; klant/auto/datums worden niet bewaard).
app.post('/sjablonen', (req, res) => {
  const naam = String(req.body.naam || '').trim();
  if (!naam) return res.status(400).json({ error: 'Geef het sjabloon een naam.' });
  const existing = templates.list().find((t) => t.naam.toLowerCase() === naam.toLowerCase());
  let id;
  if (existing && req.body.vervangen === '1') { templates.update(existing.id, req.body.d || {}); id = existing.id; }
  else if (existing) return res.status(409).json({ error: `Er bestaat al een sjabloon "${existing.naam}".`, exists: true });
  else id = templates.create(naam, req.body.d || {}, req.user.id);
  res.json({ ok: true, id });
});
app.post('/sjablonen/:id/naam', (req, res) => { templates.rename(Number(req.params.id), req.body.naam); res.redirect('/sjablonen'); });
app.post('/sjablonen/:id/verwijderen', (req, res) => {
  const t = templates.get(Number(req.params.id));
  if (t) { templates.remove(t.id); flash(req, 'ok', `Sjabloon "${t.naam}" verwijderd.`); }
  res.redirect('/sjablonen');
});

/* ---------- prullenbak (beheerders: zij mogen ook verwijderen) ---------- */
setInterval(() => { try { trash.purgeOld(); } catch (err) { console.error('Prullenbak opruimen:', err.message); } }, 6 * 3600 * 1000).unref();
app.get('/prullenbak', auth.requireAdmin, (req, res) => {
  trash.purgeOld();
  res.render('trash', { title: 'Prullenbak', items: trash.list(), keepDays: trash.KEEP_DAYS });
});
app.post('/prullenbak/leegmaken', auth.requireAdmin, (req, res) => {
  const n = trash.purgeAll();
  flash(req, 'ok', n ? `Prullenbak geleegd (${n} ${n === 1 ? 'item' : 'items'} definitief verwijderd).` : 'De prullenbak was al leeg.');
  res.redirect('/prullenbak');
});
app.post('/prullenbak/:id/terugzetten', auth.requireAdmin, (req, res) => {
  let r;
  try { r = trash.restore(Number(req.params.id)); } catch (err) {
    console.error(err); flash(req, 'err', 'Terugzetten lukte niet: ' + err.message); return res.redirect('/prullenbak');
  }
  if (!r) return res.redirect('/prullenbak');
  if (r.kind === 'order') {
    const o = db.prepare('SELECT o.id, o.nummer, o.customer_id, c.kenteken FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?').get(r.id);
    orders.logAction(r.id, req.user, 'teruggezet uit de prullenbak');
    announce(req, 'created', { id: o.id, nummer: o.nummer, kenteken: o.kenteken, customerId: o.customer_id, status: null });
  } else {
    events.broadcast({ type: 'data', area: r.kind === 'tyre' ? 'bandenhotel' : 'voorraad', by: req.user.name, byId: req.user.id });
  }
  flash(req, 'ok', 'Teruggezet.' + (r.note ? ' ' + r.note : ''));
  res.redirect({ order: '/werkopdracht/', tyre: '/bandenhotel/', stock: '/voorraad/' }[r.kind] + r.id);
});
app.post('/prullenbak/:id/verwijderen', auth.requireAdmin, (req, res) => {
  if (trash.purge(Number(req.params.id))) flash(req, 'ok', 'Definitief verwijderd.');
  res.redirect('/prullenbak');
});

/* ---------- bandenhotel, voorraad en Excel-import ---------- */
// Vóór de foto-import: anders vangt /importeren/:id ook /importeren/excel af.
registerInventory(app, { flash, wrap });
require('./portal-routes')(app, { flash, wrap });
require('./notes')(app);
require('./ai-routes')(app, { flash, wrap });

/* ---------- foto-import ---------- */
app.get('/importeren', (req, res) => {
  res.render('import', {
    title: 'Werkopdracht importeren', configured: importer.isConfigured(), maxImages: importer.MAX_IMAGES, usage: importer.usage(),
  });
});

app.post('/importeren', auth.requireAi, express.json({ limit: '30mb' }), wrap(async (req, res) => {
  try {
    const id = await importer.createDraft(req.body && req.body.images, req.user.id, req.body && req.body.effort);
    res.json({ redirect: `/importeren/${id}` });
  } catch (err) {
    if (!(err instanceof importer.ImportError)) console.error(err);
    res.status(400).json({ error: err instanceof importer.ImportError ? err.message : 'Er ging iets mis bij het importeren.' });
  }
}));

function loadDraft(req, res) {
  const draft = importer.getDraft(req.params.id);
  if (!draft) {
    res.status(404).render('error', { title: 'Niet gevonden', message: 'Deze import bestaat niet (meer). Misschien is hij al bevestigd of geannuleerd.' });
    return null;
  }
  return draft;
}

app.get('/importeren/:id', (req, res) => {
  const draft = loadDraft(req, res);
  if (!draft) return;
  const r = draft.result;
  const nr = parseNummer(r.nummer);
  const clash = nr && db.prepare('SELECT 1 FROM orders WHERE nummer = ?').get(nr);
  const onzeker = clash ? [`Werkopdrachtnummer ${orders.fmtNr(nr)} bestaat al – kies een ander nummer.`, ...r.onzeker] : r.onzeker;
  renderOrder(res, {
    order: null, data: r.data, nummer: nr || orders.nextOrderNumber(),
    draft: { ...draft, onzeker }, datumInvoer: orders.parseDate(r.datum_invoer), // leeg = niet gelezen: gebruiker moet invullen
  });
});

app.get('/importeren/:id/foto/:n', (req, res) => {
  const draft = importer.getDraft(req.params.id);
  const img = draft && draft.images[parseInt(req.params.n, 10)];
  if (!img) return res.status(404).end();
  res.set({ 'Content-Type': img.media_type, 'Cache-Control': 'private, max-age=3600' }).send(Buffer.from(img.data, 'base64'));
});

app.post('/importeren/:id/bevestigen', (req, res) => {
  const draft = loadDraft(req, res);
  if (!draft) return;
  const data = orders.normalizeOrderData(req.body.d);
  const nummer = parseNummer(req.body.nummer);
  const datumInvoer = orders.parseDate(req.body.datum_invoer);
  const error = datumInvoer ? validateOrder(data, nummer, null) || initialStatusError(req, data)
    : 'Vul de Datum invoer in: de datum die op de papieren werkopdracht staat.';
  if (error) {
    return renderOrder(res, { order: null, data, nummer: req.body.nummer, error, status: 400, draft, datumInvoer });
  }
  const id = orders.saveOrder({ nummer, data, userId: req.user.id, datumInvoer });
  orders.logAction(id, req.user, 'aangemaakt (foto-import)');
  if (req.body.next_status) orders.setStatus(id, req.body.next_status, req.user);
  rdw.refreshInBackground(data.kenteken);
  announce(req, 'created', { id, nummer, kenteken: data.kenteken, status: req.body.next_status || 'open' });
  importer.deleteDraft(draft.id);
  flash(req, 'ok', `Import bevestigd: werkopdracht ${orders.fmtNr(nummer)} is opgeslagen${req.body.next_status ? ' en ' + DONE_MSG[req.body.next_status] : ''}.`);
  res.redirect(`/werkopdracht/${id}`);
});

app.post('/importeren/:id/annuleren', (req, res) => {
  importer.deleteDraft(req.params.id);
  flash(req, 'ok', 'Import geannuleerd – er is niets opgeslagen.');
  res.redirect('/importeren');
});

/* ---------- instellingen (persoonlijke voorkeuren + wachtwoord) ---------- */
function setThemeCookie(res, theme) {
  // Onthoudt het thema op dit apparaat, zodat ook de inlogpagina in het gekozen thema verschijnt.
  res.cookie('wo_theme', theme, { maxAge: 365 * 24 * 3600 * 1000, httpOnly: true, sameSite: 'lax', secure: FORCE_SECURE || res.req.secure });
}
function serverOrigin(req) {
  return `${req.protocol}://${req.get('host')}`;
}
function renderSettings(res, { error = null, status = 200 } = {}) {
  const repo = process.env.UPDATE_REPO || updater.DEFAULT_REPO;
  res.status(status).render('settings', {
    title: 'Instellingen', error, OPTIONS: auth.PREF_OPTIONS, NOTIFY_KINDS: auth.NOTIFY_KINDS, SECRET_THEMES: auth.SECRET_THEMES, changelog: require('./changelog'),
    serverUrl: serverOrigin(res.req),
    // De ADONIS-app zet "ADONIS-app/<versie>" in de user-agent.
    inApp: /ADONIS-app\//.test(res.req.get('user-agent') || ''),
    inAppVersion: ((res.req.get('user-agent') || '').match(/ADONIS-app\/([\d.]+)/) || [])[1] || '',
    appDownload: `https://github.com/${repo}/releases/latest/download/ADONIS-app.exe`,
    // Oudere app dan de server? Dan mist de app verbeteringen (de app werkt zichzelf niet bij).
    appOutdated: (() => {
      const num = (v) => { const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v || ''); return m ? +m[1] * 1e6 + +m[2] * 1e3 + +m[3] : 0; };
      const app = num(((res.req.get('user-agent') || '').match(/ADONIS-app\/([\d.]+)/) || [])[1]);
      return app > 0 && app < num(res.locals.appInfo && res.locals.appInfo.version);
    })(),
    // Vanaf 1.24.4 werkt de app zichzelf bij.
    appSelfUpdates: (() => {
      const m = /ADONIS-app\/(\d+)\.(\d+)\.(\d+)/.exec(res.req.get('user-agent') || '');
      return !!m && (+m[1] * 1e6 + +m[2] * 1e3 + +m[3]) >= 1024004;
    })(),
  });
}
// Instellingenbestand voor de ADONIS-app: naast ADONIS-app.exe zetten, dan vraagt de app niets.
app.get('/instellingen/adonis-app.json', (req, res) => {
  res.set('Content-Disposition', 'attachment; filename="adonis-app.json"');
  res.json({ url: serverOrigin(req) });
});
app.get('/instellingen', (req, res) => renderSettings(res));
app.get('/account', (req, res) => res.redirect('/instellingen'));

/* Profielfoto: eerste letter, een pictogram met kleur, of een eigen foto (in de browser verkleind tot 256 × 256). */
app.get('/profielfoto/:id', (req, res) => {
  const f = auth.avatarImage(Number(req.params.id));
  if (!f) return res.status(404).end();
  res.set({ 'Content-Type': f.mime, 'Cache-Control': req.query.v === f.hash ? 'private, max-age=31536000, immutable' : 'no-cache' });
  res.send(f.data);
});
app.post('/instellingen/profiel', (req, res) => {
  const look = String(req.body.look || 'letter');
  auth.setAvatar(req.user.id, { type: look === 'letter' || look === 'img' ? look : 'icon', icon: look, color: req.body.kleur });
  flash(req, 'ok', 'Profiel opgeslagen.');
  res.redirect('/instellingen#profiel');
});
app.post('/instellingen/profielfoto', express.json({ limit: '3mb' }), (req, res) => {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.data || ''));
  const buf = m ? Buffer.from(m[2], 'base64') : null;
  const okType = buf && ((m[1] === 'image/png' && buf.readUInt32BE(0) === 0x89504e47) || (m[1] === 'image/jpeg' && buf[0] === 0xff && buf[1] === 0xd8)
    || (m[1] === 'image/webp' && buf.toString('ascii', 8, 12) === 'WEBP'));
  if (!okType) return res.status(400).json({ error: 'Kies een foto (PNG, JPG of WebP).' });
  if (buf.length > 1.5 * 1024 * 1024) return res.status(400).json({ error: 'De foto is te groot.' });
  auth.setAvatarImage(req.user.id, m[1], buf);
  res.json({ ok: true });
});

app.post('/instellingen', (req, res) => {
  const prefs = auth.savePrefs(req.user.id, {
    // Eerst de geheime thema's (aan/uit), dan het thema: zo kan beide in één keer.
    secret: [].concat(req.body.secret || []).includes('on') ? 'on' : 'off',
    theme: req.body.theme, ink: req.body.ink, start: req.body.start, fx: req.body.fx, mscale: req.body.mscale,
    simple: [].concat(req.body.simple || []).includes('on') ? 'on' : 'off',
    carimg: [].concat(req.body.carimg || []).includes('on') ? 'on' : 'off',
    partimg: [].concat(req.body.partimg || []).includes('on') ? 'on' : 'off',
    desktop: [].concat(req.body.desktop || []).includes('on') ? 'on' : 'off',
    feest: [].concat(req.body.feest || []).includes('on') ? 'on' : 'off',
    links: req.body.links,
    layout: req.body.layout,
    ...Object.fromEntries(auth.NOTIFY_KINDS.map(([k]) => ['n_' + k, [].concat(req.body['n_' + k] || []).includes('on') ? 'on' : 'off'])),
  });
  setThemeCookie(res, prefs.theme);
  flash(req, 'ok', 'Uw instellingen zijn opgeslagen.');
  res.redirect('/instellingen');
});

// Thema kiezen via het menu in de menubalk (JSON), of zonder JavaScript: naar het volgende thema.
app.post('/instellingen/thema', (req, res) => {
  const changes = {};
  if (auth.PREF_OPTIONS.theme.includes(req.body.theme)) changes.theme = req.body.theme;
  if (auth.PREF_OPTIONS.fx.includes(req.body.fx)) changes.fx = req.body.fx;
  if (!Object.keys(changes).length) {
    const order = auth.visibleThemes(req.user.prefs);
    changes.theme = order[(order.indexOf(req.user.prefs.theme) + 1) % order.length];
  }
  const prefs = auth.savePrefs(req.user.id, changes);
  setThemeCookie(res, prefs.theme);
  if ((req.get('accept') || '').includes('application/json')) return res.json({ ok: true, theme: prefs.theme, fx: prefs.fx });
  res.redirect(safeNext(req.body.next));
});

app.post('/instellingen/wachtwoord', wrap(async (req, res) => {
  const { current, password, password2 } = req.body;
  try {
    if (!(await auth.checkPassword(req.user.id, current))) throw new Error('Huidig wachtwoord is onjuist.');
    if (password !== password2) throw new Error('De nieuwe wachtwoorden komen niet overeen.');
    await auth.setPassword(req.user.id, password);
  } catch (err) {
    return renderSettings(res, { error: err.message, status: 400 });
  }
  // setPassword logt alle sessies uit; maak een nieuwe sessie voor deze gebruiker.
  const userId = req.user.id;
  req.session.regenerate(() => {
    req.session.userId = userId;
    req.session.csrf = crypto.randomBytes(24).toString('hex');
    flash(req, 'ok', 'Uw wachtwoord is gewijzigd.');
    res.redirect('/instellingen');
  });
}));
app.post('/account/wachtwoord', wrap(async (req, res) => {
  const { current, password, password2 } = req.body;
  try {
    if (!(await auth.checkPassword(req.user.id, current))) throw new Error('Huidig wachtwoord is onjuist.');
    if (password !== password2) throw new Error('De nieuwe wachtwoorden komen niet overeen.');
    await auth.setPassword(req.user.id, password);
  } catch (err) {
    return res.status(400).render('account', { title: 'Mijn account', error: err.message });
  }
  // setPassword logt alle sessies uit; maak een nieuwe sessie voor deze gebruiker.
  const userId = req.user.id;
  req.session.regenerate(() => {
    req.session.userId = userId;
    req.session.csrf = crypto.randomBytes(24).toString('hex');
    flash(req, 'ok', 'Uw wachtwoord is gewijzigd.');
    res.redirect('/account');
  });
}));

/* ---------- systeem (alleen ADONIS-beheerder): online bereikbaar via Cloudflare ---------- */
async function renderSystem(res, { error = null, status = 200, values = {} } = {}) {
  const bk = await backupView();
  const cf = settings.get('cloudflare', null);
  res.status(status).render('system', {
    title: 'Systeem', error, values, cf, tunnelState: tunnel.getState(),
    port: Number(process.env.APP_PORT) || null, supported: Boolean(tunnel.assetName()),
    permissionsHelp: cloudflare.PERMISSIONS_HELP,
    bk, FEATURES: features.FEATURES, feesten: festive.overview(), af: autofill.state(), AF_OPTIONS: autofill.OPTIONS,
  });
}
async function backupView() {
  const c = backup.config();
  const folders = await Promise.all(c.folders.map(async (f, i) => ({ i, path: f, files: await backup.listBackups(f), result: c.last && (c.last.results || []).find((r) => r.folder === f) })));
  let restored = null;
  try { restored = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'laatst-teruggezet.json'), 'utf8')); } catch { /* nooit */ }
  return { c, folders, health: backup.health().state, defaultDir: backup.DEFAULT_DIR, restored, isWindows: process.platform === 'win32' };
}
app.get('/systeem', auth.requireOwner, wrap((req, res) => renderSystem(res)));

/* Onderdelen aan/uit (alleen ADONIS-beheerder). Er wordt niets verwijderd. */
app.post('/systeem/onderdelen', auth.requireOwner, (req, res) => {
  const on = Object.fromEntries(features.KEYS.map((k) => [k, req.body['f_' + k] === 'on']));
  features.save(on);
  const off = features.FEATURES.filter((f) => !on[f.key]).map((f) => f.name);
  flash(req, 'ok', off.length ? `Opgeslagen. Uit: ${off.join(', ')}.` : 'Opgeslagen. Alle onderdelen staan aan.');
  events.broadcast({ type: 'features', byId: req.user.id });
  res.redirect('/systeem#onderdelen');
});

/* ---------- Mijn werk: wat heeft een monteur gedaan (beheerders kunnen iedereen bekijken) ---------- */
app.get('/mijn-werk', (req, res) => {
  let target = req.user;
  if (req.user.is_admin && req.query.gebruiker) target = auth.findUserById(req.query.gebruiker) || req.user;
  res.render('mywork', {
    title: target.id === req.user.id ? 'Mijn werk' : `Werk van ${target.name}`, target,
    users: req.user.is_admin ? db.prepare('SELECT id, name FROM users ORDER BY name').all() : [],
    w: mywork.forUser(target), STATUSES: orders.STATUSES,
  });
});

/* ---------- automatisch invullen (alleen ADONIS-beheerder) ---------- */
app.post('/systeem/invullen', auth.requireOwner, (req, res) => {
  autofill.save(req.body);
  flash(req, 'ok', 'Automatisch invullen opgeslagen.');
  res.redirect('/systeem#invullen');
});

/* ---------- feestdagen (alleen ADONIS-beheerder) ---------- */
app.post('/systeem/feestdagen', auth.requireOwner, (req, res) => {
  const items = {};
  for (const k of festive.KEYS) {
    items[k] = { aan: req.body[`f_${k}`] === 'on', auto: req.body[`f_${k}_auto`] === 'on', van: req.body[`f_${k}_van`], tot: req.body[`f_${k}_tot`] };
  }
  festive.save({ aan: req.body.feesten === 'on', items });
  festiveMemo.at = 0;
  const bad = festive.KEYS.filter((k) => (req.body[`f_${k}_van`] && !festive.parseDm(req.body[`f_${k}_van`])) || (req.body[`f_${k}_tot`] && !festive.parseDm(req.body[`f_${k}_tot`])));
  flash(req, bad.length ? 'err' : 'ok', bad.length ? 'Opgeslagen, maar niet alle datums klopten (schrijf ze als dag-maand, bijv. 06-12). Die zijn teruggezet.' : 'Feestdagen opgeslagen.');
  res.redirect('/systeem#feestdagen');
});

/* ---------- huisstijl (alleen ADONIS-beheerder) ---------- */
app.post('/systeem/huisstijl', auth.requireOwner, (req, res) => {
  branding.saveSettings({
    naam: req.body.naam, sub: req.body.sub, blur: req.body.blur, zicht: req.body.zicht, bannerInMenu: req.body.bannerInMenu === 'on',
    kleur1: req.body.eigenKleuren === 'on' ? req.body.kleur1 : '', kleur2: req.body.eigenKleuren === 'on' ? req.body.kleur2 : '',
  });
  events.broadcast({ type: 'branding', byId: req.user.id });
  if ((req.get('accept') || '').includes('application/json')) return res.json({ ok: true, brand: branding.get() });
  flash(req, 'ok', 'Huisstijl opgeslagen.');
  res.redirect('/systeem#huisstijl');
});
app.post('/systeem/huisstijl/afbeelding', auth.requireOwner, express.json({ limit: '12mb' }), (req, res) => {
  try {
    const b = branding.saveFile(String(req.body.slot || ''), req.body.data);
    events.broadcast({ type: 'branding', byId: req.user.id });
    res.json({ ok: true, brand: b });
  } catch (err) {
    if (!(err instanceof branding.BrandingError)) console.error('Huisstijl:', err);
    res.status(400).json({ error: err instanceof branding.BrandingError ? err.message : 'Opslaan lukte niet.' });
  }
});
app.post('/systeem/huisstijl/:slot/verwijderen', auth.requireOwner, (req, res) => {
  if (branding.SLOTS[req.params.slot]) branding.removeFile(req.params.slot);
  events.broadcast({ type: 'branding', byId: req.user.id });
  flash(req, 'ok', `${(branding.SLOTS[req.params.slot] || { label: 'Afbeelding' }).label} verwijderd.`);
  res.redirect('/systeem#huisstijl');
});

/* ---------- backups (alleen ADONIS-beheerder) ---------- */
app.post('/systeem/backup/nu', auth.requireOwner, wrap(async (req, res) => {
  const r = await backup.runBackup({ reason: 'handmatig' });
  flash(req, r.ok ? 'ok' : 'err', r.ok
    ? `Backup gemaakt (${(r.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB) en bewaard in ${r.results.length === 1 ? 'de map' : r.results.length + ' mappen'}.`
    : 'De backup is (deels) mislukt: ' + r.error + ' ' + (r.results || []).filter((x) => !x.ok).map((x) => x.error).join(' '));
  res.redirect('/systeem#backup');
}));
app.get('/systeem/backup/download', auth.requireOwner, wrap(async (req, res) => {
  const z = await backup.createZip('-download');
  res.download(z.file, path.basename(z.file).replace('-download', ''), () => fs.rmSync(z.file, { force: true }));
}));
app.post('/systeem/backup/instellingen', auth.requireOwner, (req, res) => {
  const keepDays = parseInt(req.body.keepDays, 10);
  backup.saveConfig({
    time: /^\d{2}:\d{2}$/.test(req.body.time || '') ? req.body.time : undefined,
    keepDays: [7, 14, 30, 60, 90, 365].includes(keepDays) ? keepDays : undefined,
  });
  flash(req, 'ok', 'Backup-instellingen opgeslagen.');
  res.redirect('/systeem#backup');
});
app.post('/systeem/backup/map', auth.requireOwner, wrap(async (req, res) => {
  try {
    const dir = await backup.checkFolder(req.body.folder);
    const c = backup.config();
    if (!c.folders.map((f) => path.resolve(f)).includes(dir)) backup.saveConfig({ folders: [...c.folders, dir] });
    flash(req, 'ok', `Map toegevoegd: ${dir}. Vanaf nu komt elke backup ook daar te staan.`);
  } catch (err) {
    if (!(err instanceof backup.BackupError)) console.error(err);
    flash(req, 'err', err.message);
  }
  res.redirect('/systeem#backup');
}));
app.post('/systeem/backup/map/verwijderen', auth.requireOwner, (req, res) => {
  const c = backup.config();
  const i = parseInt(req.body.i, 10);
  if (c.folders[i] !== undefined) {
    backup.saveConfig({ folders: c.folders.filter((_, k) => k !== i) });
    flash(req, 'ok', 'Map verwijderd uit de lijst. De backups die daar al staan, blijven staan.');
  }
  res.redirect('/systeem#backup');
});
app.get('/systeem/backup/bestand', auth.requireOwner, wrap(async (req, res) => {
  const c = backup.config();
  const file = await backup.backupPath(c.folders[parseInt(req.query.map, 10)] || '', String(req.query.naam || ''));
  if (!file) return res.status(404).render('error', { title: 'Niet gevonden', message: 'Deze backup bestaat niet (meer), of de map is niet bereikbaar.' });
  res.download(file);
}));
// Terugzetten: uit een map (map + naam) of een geüpload bestand. Daarna herstart ADONIS.
app.post('/systeem/backup/terugzetten', auth.requireOwner, express.raw({ type: 'application/octet-stream', limit: '1gb' }), wrap(async (req, res) => {
  const json = !Buffer.isBuffer(req.body) ? false : true;
  try {
    let buffer;
    if (json) {
      buffer = req.body;
    } else {
      const c = backup.config();
      const file = await backup.backupPath(c.folders[parseInt(req.body.map, 10)] || '', String(req.body.naam || ''));
      if (!file) throw new backup.BackupError('Deze backup bestaat niet (meer), of de map is niet bereikbaar.');
      buffer = await fs.promises.readFile(file);
    }
    const manifest = await backup.stageRestore(buffer);
    const when = new Date(manifest.gemaakt).toLocaleString('nl-NL', { timeZone: process.env.APP_TIMEZONE || 'Europe/Amsterdam' });
    console.log(`  Backup van ${when} wordt teruggezet (door ${req.user.name}).`);
    setTimeout(() => (global.adonisRestart ? global.adonisRestart() : process.exit(0)), 600);
    if (json) return res.json({ ok: true, when });
    res.render('restoring', { title: 'Backup terugzetten', when });
  } catch (err) {
    if (!(err instanceof backup.BackupError)) console.error(err);
    if (json) return res.status(400).json({ error: err.message });
    flash(req, 'err', err.message);
    res.redirect('/systeem#backup');
  }
}));

app.post('/systeem/cloudflare/installeren', auth.requireOwner, wrap(async (req, res) => {
  const port = Number(process.env.APP_PORT) || 3000;
  const hostname = String(req.body.hostname || '').trim().toLowerCase();
  const log = [];
  try {
    const r = await cloudflare.setup({ apiToken: req.body.api_token, hostname, port, log: (l) => log.push(l) });
    settings.set('cloudflare', {
      enabled: true, hostname: r.hostname, tunnelId: r.tunnelId, accountId: r.accountId, zoneId: r.zoneId,
      token: r.tunnelToken, port, installedAt: new Date().toISOString(), installedBy: req.user.name,
    });
    tunnel.stop();
    await tunnel.start({ token: r.tunnelToken, hostname: r.hostname });
    const ok = await tunnel.waitConnected(25000);
    flash(req, 'ok', ok
      ? `Klaar! ADONIS is nu online bereikbaar op https://${r.hostname} (het kan een minuutje duren voordat het overal werkt).`
      : `Ingesteld voor https://${r.hostname}. De verbinding wordt nog opgebouwd; ververs deze pagina over een minuut.`);
    res.redirect('/systeem');
  } catch (err) {
    if (!(err instanceof cloudflare.CloudflareError)) console.error(err);
    return renderSystem(res, { error: err.message, status: 400, values: { hostname } });
  }
}));

// Alternatief: zelf een tunnel aangemaakt in het Cloudflare-dashboard en alleen de sleutel plakken.
app.post('/systeem/cloudflare/sleutel', auth.requireOwner, wrap(async (req, res) => {
  const token = String(req.body.tunnel_token || '').trim().replace(/^.*--token\s+/, '').replace(/^.*\s/, '');
  const hostname = String(req.body.hostname || '').trim().toLowerCase();
  if (!/^[A-Za-z0-9+/=_-]{40,}$/.test(token)) {
    return renderSystem(res, { error: 'Dat lijkt geen geldige tunnelsleutel. Kopieer de sleutel (of het hele installatiecommando) uit het Cloudflare-dashboard.', status: 400, values: { hostname } });
  }
  if (hostname && !cloudflare.validHostname(hostname)) {
    return renderSystem(res, { error: 'Vul een geldig (sub)domein in, bijvoorbeeld adonis.revnet.nl.', status: 400, values: { hostname } });
  }
  settings.set('cloudflare', {
    enabled: true, hostname, token, manual: true, port: Number(process.env.APP_PORT) || 3000,
    installedAt: new Date().toISOString(), installedBy: req.user.name,
  });
  tunnel.stop();
  await tunnel.start({ token, hostname });
  const ok = await tunnel.waitConnected(25000);
  flash(req, 'ok', ok ? 'Tunnel verbonden.' : 'Tunnel ingesteld; de verbinding wordt nog opgebouwd.');
  res.redirect('/systeem');
}));

app.post('/systeem/cloudflare/aan', auth.requireOwner, wrap(async (req, res) => {
  const cf = settings.get('cloudflare', null);
  if (cf) {
    settings.set('cloudflare', { ...cf, enabled: true });
    await tunnel.start({ token: cf.token, hostname: cf.hostname });
    await tunnel.waitConnected(15000);
    flash(req, 'ok', 'Cloudflare-tunnel ingeschakeld.');
  }
  res.redirect('/systeem');
}));

app.post('/systeem/cloudflare/uit', auth.requireOwner, (req, res) => {
  const cf = settings.get('cloudflare', null);
  if (cf) settings.set('cloudflare', { ...cf, enabled: false });
  tunnel.stop();
  flash(req, 'ok', 'Cloudflare-tunnel uitgeschakeld. ADONIS is nu alleen nog in het eigen netwerk bereikbaar.');
  res.redirect('/systeem');
});

app.post('/systeem/cloudflare/vergeten', auth.requireOwner, (req, res) => {
  tunnel.stop();
  settings.remove('cloudflare');
  flash(req, 'ok', 'Cloudflare-instellingen verwijderd. De tunnel en het DNS-record bestaan nog in uw Cloudflare-account; verwijder die daar eventueel.');
  res.redirect('/systeem');
});

/* ---------- gebruikersbeheer (beheerder) ---------- */
function renderUsers(req, res, error, status) {
  const users = db.prepare('SELECT id, username, name, is_admin, is_owner, role, created_at FROM users ORDER BY is_owner DESC, name').all()
    .map((u) => ({ ...u, ...auth.findUserById(u.id) }));
  res.status(status || 200).render('users', { title: 'Gebruikers', users, error, ROLES: auth.ROLES });
}
app.get('/gebruikers', auth.requireAdmin, (req, res) => renderUsers(req, res, null));
app.post('/gebruikers', auth.requireAdmin, wrap(async (req, res) => {
  try {
    await auth.createUser({
      username: req.body.username, name: req.body.name, password: req.body.password, role: req.body.role,
      simple: req.body.eenvoudig === 'on', // standaard aangevinkt op het formulier
      ai: req.body.ai === 'on', // standaard uit: AI kost geld
    });
  } catch (err) {
    return renderUsers(req, res, err.message, 400);
  }
  flash(req, 'ok', `Gebruiker ${req.body.username} is aangemaakt.`);
  res.redirect('/gebruikers');
}));
app.post('/gebruikers/:id/wachtwoord', auth.requireAdmin, wrap(async (req, res) => {
  const target = auth.findUserById(req.params.id);
  if (!target) return res.redirect('/gebruikers');
  if (target.is_owner && target.id !== req.user.id) {
    return renderUsers(req, res, 'Het wachtwoord van de ADONIS-beheerder kan alleen door die persoon zelf worden gewijzigd.', 403);
  }
  try {
    await auth.setPassword(target.id, req.body.password);
  } catch (err) {
    return renderUsers(req, res, err.message, 400);
  }
  if (target.id === req.user.id) return res.redirect('/login');
  flash(req, 'ok', `Wachtwoord van ${target.username} is gewijzigd.`);
  res.redirect('/gebruikers');
}));
app.post('/gebruikers/:id/rol', auth.requireAdmin, (req, res) => {
  const target = auth.findUserById(req.params.id);
  if (!target || target.is_owner) return res.redirect('/gebruikers');
  if (target.id === req.user.id) {
    flash(req, 'err', 'U kunt uw eigen rol niet wijzigen; vraag een andere beheerder.');
    return res.redirect('/gebruikers');
  }
  if (!auth.ROLES[req.body.role]) return res.redirect('/gebruikers');
  auth.setRole(target.id, req.body.role);
  flash(req, 'ok', `${target.name} is nu ${auth.ROLES[req.body.role]}.`);
  res.redirect('/gebruikers');
});
// Eenvoudige weergave aan/uit voor een gebruiker (bijv. voor iemand die niet zo handig is met computers).
app.post('/gebruikers/:id/eenvoudig', auth.requireAdmin, (req, res) => {
  const target = auth.findUserById(req.params.id);
  if (!target) return res.redirect('/gebruikers');
  const on = req.body.simple === 'on';
  auth.savePrefs(target.id, on ? { simple: 'on', start: '/start' } : { simple: 'off' });
  flash(req, 'ok', `Eenvoudige weergave staat ${on ? 'aan' : 'uit'} voor ${target.name}.${on ? ' Bij het inloggen opent het startscherm met grote knoppen.' : ''}`);
  res.redirect('/gebruikers');
});
// AI-toegang aan/uit: Claude-functies kosten geld, dus de beheerder bepaalt wie ze mag starten.
// Beheerders hebben altijd toegang; opgeslagen resultaten bekijken mag iedereen.
app.post('/gebruikers/:id/ai', auth.requireAdmin, (req, res) => {
  const target = auth.findUserById(req.params.id);
  if (!target) return res.redirect('/gebruikers');
  if (target.is_admin) { flash(req, 'ok', `${target.name} is beheerder en mag AI-functies altijd gebruiken.`); return res.redirect('/gebruikers'); }
  const on = req.body.ai === 'on';
  auth.setAiAccess(target.id, on);
  flash(req, 'ok', on ? `${target.name} mag nu AI-functies gebruiken (dit kost geld per keer).` : `${target.name} kan geen AI-functies meer starten. Opgeslagen resultaten blijven zichtbaar.`);
  res.redirect('/gebruikers');
});
// De rol ADONIS-beheerder overdragen (alleen de huidige eigenaar), met bevestiging en het eigen wachtwoord.
app.post('/gebruikers/eigenaar-overdragen', auth.requireOwner, wrap(async (req, res) => {
  const target = auth.findUserById(req.body.naar);
  const key = 'overdragen|' + req.user.id;
  const back = (msg) => { flash(req, 'err', msg); res.redirect('/gebruikers#overdragen'); };
  if (!target || target.id === req.user.id) return back('Kies aan wie u de rol ADONIS-beheerder wilt overdragen.');
  if (req.body.bevestig !== 'on') return back('Vink aan dat u begrijpt wat er gebeurt.');
  if (auth.loginBlocked(key)) return back('Te veel verkeerde wachtwoorden. Probeer het over 15 minuten opnieuw.');
  if (!(await auth.checkPassword(req.user.id, req.body.wachtwoord))) { auth.loginFailed(key); return back('Uw wachtwoord klopt niet. Er is niets veranderd.'); }
  auth.loginSucceeded(key);
  auth.transferOwnership(req.user.id, target.id);
  console.log(`Rol ADONIS-beheerder overgedragen van ${req.user.username} naar ${target.username}.`);
  flash(req, 'ok', `${target.name} is nu de ADONIS-beheerder. U bent gewoon beheerder gebleven.`);
  res.redirect('/gebruikers');
}));
app.post('/gebruikers/:id/verwijderen', auth.requireAdmin, (req, res) => {
  const target = auth.findUserById(req.params.id);
  if (target && target.id !== req.user.id && !target.is_owner) {
    db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
    db.prepare("DELETE FROM sessions WHERE json_extract(data, '$.userId') = ?").run(target.id);
    flash(req, 'ok', `Gebruiker ${target.username} is verwijderd.`);
  }
  res.redirect('/gebruikers');
});

/* ---------- fouten ---------- */
app.use((req, res) => res.status(404).render('error', { title: 'Niet gevonden', message: 'Deze pagina bestaat niet.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Er ging iets mis', message: 'Er is een onverwachte fout opgetreden.' });
});

module.exports = app;
