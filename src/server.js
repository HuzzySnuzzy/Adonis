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

const app = express();
// HTTPS (achter een reverse proxy): alleen dan beveiligde cookies en HSTS.
const SECURE = process.env.COOKIE_SECURE === 'true';

/* ---------- session secret ---------- */
function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(DATA_DIR, 'session-secret');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

/* ---------- app setup ---------- */
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  });
  if (SECURE) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});

/* ---------- statische bestanden (ingebakken in de executable) ---------- */
const MIME = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};
const STARTED = Date.now().toString(36);
app.get('/static/*file', (req, res, next) => {
  const rel = [].concat(req.params.file).join('/');
  const type = MIME[path.extname(rel)];
  const buf = type && assets.get('public/' + rel);
  if (!buf) return next();
  const etag = `"${STARTED}-${buf.length}"`;
  res.set({ 'Content-Type': type, 'Cache-Control': 'public, max-age=3600', ETag: etag });
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
      secure: SECURE,
      maxAge: 12 * 60 * 60 * 1000, // 12 uur na laatste activiteit
    },
  })
);
app.use(auth.loadUser);
app.use((req, res, next) => {
  res.locals.path = req.path;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});
app.use(auth.csrfProtection);

/* ---------- view helpers ---------- */
function fmtDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1].slice(2)}` : iso;
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
app.locals.esc = esc;
app.locals.inp = inp;
app.locals.fmtDate = fmtDate;
app.locals.fmtDateTime = fmtDateTime;
app.locals.FLUIDS = orders.FLUIDS;
app.locals.TIRES = orders.TIRES;
app.locals.WORK_LINES = orders.WORK_LINES;
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
    res.redirect(next);
  });
}));
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('wo.sid');
    res.redirect('/login');
  });
});

/* ---------- alles hieronder vereist inloggen ---------- */
app.use(auth.requireLogin);

/* Klantenoverzicht op kenteken */
app.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  let rows;
  const base = `
    SELECT c.*, COUNT(o.id) AS aantal, MAX(o.datum_invoer) AS laatste
    FROM customers c LEFT JOIN orders o ON o.customer_id = c.id`;
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
    rows = db.prepare(`${base} GROUP BY c.id ORDER BY c.plate_key LIMIT 2000`).all();
  }
  res.render('customers', { title: 'Klanten', q, customers: rows });
});

/* Eén klant met alle werkopdrachten */
app.get('/klant/:id', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).render('error', { title: 'Niet gevonden', message: 'Deze klant bestaat niet.' });
  const q = String(req.query.q || '').trim();
  const rows = q
    ? db.prepare(
        `SELECT * FROM orders WHERE customer_id = ? AND search_text LIKE ? ESCAPE '\\' ORDER BY datum_invoer DESC, nummer DESC`
      ).all(customer.id, likeTerm(q))
    : db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY datum_invoer DESC, nummer DESC').all(customer.id);
  res.render('customer', { title: customer.kenteken, customer, q, orders: rows.map(withSummary) });
});

/* Alle werkopdrachten doorzoeken */
app.get('/werkopdrachten', (req, res) => {
  const q = String(req.query.q || '').trim();
  const sql = `SELECT o.*, c.kenteken AS c_kenteken FROM orders o JOIN customers c ON c.id = o.customer_id`;
  const rows = q
    ? db.prepare(`${sql} WHERE o.search_text LIKE ? ESCAPE '\\' OR c.plate_key LIKE ? ESCAPE '\\'
                  ORDER BY o.nummer DESC LIMIT 500`).all(likeTerm(q), likeTerm(plateKey(q) || q))
    : db.prepare(`${sql} ORDER BY o.nummer DESC LIMIT 200`).all();
  res.render('orders', { title: 'Werkopdrachten', q, orders: rows.map(withSummary) });
});

function withSummary(row) {
  const data = orders.parseOrderData(row.data);
  const firstLine = data.werk_omschrijving.split('\n').map((l) => l.replace(/^[-–\s]+/, '').trim()).find(Boolean) || '';
  return { ...row, d: data, summary: firstLine };
}

/* ---------- werkopdracht formulier ---------- */
function renderOrder(res, { order, data, nummer, error, status, draft, datumInvoer }) {
  res.status(status || 200).render('order', {
    title: draft ? 'Import controleren' : order ? `Werkopdracht ${order.nummer}` : 'Nieuwe werkopdracht',
    order, data, nummer, error, draft: draft || null,
    datumInvoer: datumInvoer || (order ? order.datum_invoer : orders.todayISO()),
  });
}

app.get('/werkopdracht/nieuw', (req, res) => {
  const data = orders.emptyOrderData();
  data.monteur = req.user.name;
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
  if (clash && clash.id !== existingId) return `Werkopdrachtnummer ${nummer} bestaat al.`;
  return null;
}

app.post('/werkopdracht', (req, res) => {
  const data = orders.normalizeOrderData(req.body.d);
  const nummer = parseNummer(req.body.nummer);
  const error = validateOrder(data, nummer, null);
  if (error) return renderOrder(res, { order: null, data, nummer: req.body.nummer, error, status: 400 });
  const id = orders.saveOrder({ nummer, data, userId: req.user.id });
  flash(req, 'ok', `Werkopdracht ${nummer} is opgeslagen.`);
  res.redirect(`/werkopdracht/${id}`);
});

function loadOrder(id) {
  return db.prepare(
    `SELECT o.*, cu.name AS created_by_name, uu.name AS updated_by_name
     FROM orders o LEFT JOIN users cu ON cu.id = o.created_by LEFT JOIN users uu ON uu.id = o.updated_by
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
  const data = orders.normalizeOrderData(req.body.d);
  const nummer = parseNummer(req.body.nummer);
  let error = validateOrder(data, nummer, order.id);
  if (!error && req.body.versie !== order.updated_at) {
    error = `Iemand anders (${order.updated_by_name || 'onbekend'}) heeft deze werkopdracht intussen gewijzigd ` +
      `(${fmtDateTime(order.updated_at)}). Open de werkopdracht opnieuw om de laatste versie te zien – ` +
      'jouw wijzigingen staan hieronder nog ingevuld, maar zijn NIET opgeslagen.';
  }
  if (error) return renderOrder(res, { order, data, nummer: req.body.nummer, error, status: 400 });
  orders.saveOrder({ id: order.id, nummer, data, userId: req.user.id });
  flash(req, 'ok', `Werkopdracht ${nummer} is opgeslagen.`);
  res.redirect(`/werkopdracht/${order.id}`);
});

app.post('/werkopdracht/:id/verwijderen', auth.requireAdmin, (req, res) => {
  const order = loadOrder(req.params.id);
  if (!order) return res.redirect('/');
  const customerId = orders.deleteOrder(order.id);
  flash(req, 'ok', `Werkopdracht ${order.nummer} is verwijderd.`);
  const stillExists = db.prepare('SELECT 1 FROM customers WHERE id = ?').get(customerId);
  res.redirect(stillExists ? `/klant/${customerId}` : '/');
});

/* ---------- foto-import ---------- */
app.get('/importeren', (req, res) => {
  res.render('import', { title: 'Foto importeren', configured: importer.isConfigured(), maxImages: importer.MAX_IMAGES });
});

app.post('/importeren', express.json({ limit: '30mb' }), wrap(async (req, res) => {
  try {
    const id = await importer.createDraft(req.body && req.body.images, req.user.id);
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
  const onzeker = clash ? [`Werkopdrachtnummer ${nr} bestaat al – kies een ander nummer.`, ...r.onzeker] : r.onzeker;
  renderOrder(res, {
    order: null, data: r.data, nummer: nr || orders.nextOrderNumber(),
    draft: { ...draft, onzeker }, datumInvoer: r.datum_invoer || orders.todayISO(),
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
  const datumInvoer = /^\d{4}-\d{2}-\d{2}$/.test(req.body.datum_invoer || '') ? req.body.datum_invoer : orders.todayISO();
  const error = validateOrder(data, nummer, null);
  if (error) {
    return renderOrder(res, { order: null, data, nummer: req.body.nummer, error, status: 400, draft, datumInvoer });
  }
  const id = orders.saveOrder({ nummer, data, userId: req.user.id, datumInvoer });
  importer.deleteDraft(draft.id);
  flash(req, 'ok', `Import bevestigd: werkopdracht ${nummer} is opgeslagen.`);
  res.redirect(`/werkopdracht/${id}`);
});

app.post('/importeren/:id/annuleren', (req, res) => {
  importer.deleteDraft(req.params.id);
  flash(req, 'ok', 'Import geannuleerd – er is niets opgeslagen.');
  res.redirect('/importeren');
});

/* ---------- eigen account ---------- */
app.get('/account', (req, res) => res.render('account', { title: 'Mijn account', error: null }));
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
    flash(req, 'ok', 'Je wachtwoord is gewijzigd.');
    res.redirect('/account');
  });
}));

/* ---------- gebruikersbeheer (beheerder) ---------- */
function renderUsers(req, res, error, status) {
  const users = db.prepare('SELECT id, username, name, is_admin, created_at FROM users ORDER BY name').all();
  res.status(status || 200).render('users', { title: 'Gebruikers', users, error });
}
app.get('/gebruikers', auth.requireAdmin, (req, res) => renderUsers(req, res, null));
app.post('/gebruikers', auth.requireAdmin, wrap(async (req, res) => {
  try {
    await auth.createUser({
      username: req.body.username, name: req.body.name, password: req.body.password, isAdmin: req.body.is_admin === 'on',
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
  try {
    await auth.setPassword(target.id, req.body.password);
  } catch (err) {
    return renderUsers(req, res, err.message, 400);
  }
  if (target.id === req.user.id) return res.redirect('/login');
  flash(req, 'ok', `Wachtwoord van ${target.username} is gewijzigd.`);
  res.redirect('/gebruikers');
}));
app.post('/gebruikers/:id/beheerder', auth.requireAdmin, (req, res) => {
  const target = auth.findUserById(req.params.id);
  if (target && target.id !== req.user.id) {
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(target.is_admin ? 0 : 1, target.id);
    flash(req, 'ok', `${target.username} is ${target.is_admin ? 'geen' : 'nu'} beheerder.`);
  }
  res.redirect('/gebruikers');
});
app.post('/gebruikers/:id/verwijderen', auth.requireAdmin, (req, res) => {
  const target = auth.findUserById(req.params.id);
  if (target && target.id !== req.user.id) {
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
