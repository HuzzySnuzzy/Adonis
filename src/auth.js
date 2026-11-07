'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { db } = require('./db');

const MIN_PASSWORD = 8;
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);

function userCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

// Persoonlijke voorkeuren (thema enz.) per gebruiker.
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'preferences')) {
  db.exec("ALTER TABLE users ADD COLUMN preferences TEXT NOT NULL DEFAULT '{}'");
}

const PREF_OPTIONS = {
  theme: ['system', 'light', 'dark', 'oled', 'neon', 'ice'],
  fx: ['full', 'calm'],
  ink: ['hand', 'plain'],
  start: ['/start', '/', '/werkopdrachten', '/importeren', '/werkopdracht/nieuw', '/bandenhotel', '/voorraad'],
  secret: ['off', 'on'],
  mscale: ['100', '90', '80', '70', '60'], // weergave op telefoon (procent)
  simple: ['off', 'on'], // eenvoudige weergave: grote knoppen, alleen het belangrijkste, geen animaties
  carimg: ['on', 'off'], // foto van het automodel op de klantpagina (Wikipedia)
  partimg: ['on', 'off'], // voorbeeldfoto van de soort onderdeel in de voorraad (Wikipedia)
};
const PREF_DEFAULTS = { theme: 'system', ink: 'hand', start: '/', fx: 'full', secret: 'off', mscale: '90', simple: 'off', carimg: 'on', partimg: 'on' };
/** Thema's die alleen zichtbaar zijn met de voorkeur "Geheime thema's". */
const SECRET_THEMES = ['neon', 'ice'];
/** Thema's die iemand met deze voorkeuren kan kiezen (in volgorde van het menu). */
function visibleThemes(prefs) {
  return PREF_OPTIONS.theme.filter((t) => prefs.secret === 'on' || !SECRET_THEMES.includes(t));
}

function parsePrefs(json) {
  let raw = {};
  try { raw = JSON.parse(json || '{}'); } catch { /* standaard */ }
  const out = {};
  for (const [k, opts] of Object.entries(PREF_OPTIONS)) out[k] = opts.includes(raw[k]) ? raw[k] : PREF_DEFAULTS[k];
  // Wie al een geheim thema gebruikte (van vóór deze voorkeur), houdt het: geheime thema's staan dan aan.
  if (raw.secret === undefined && SECRET_THEMES.includes(out.theme)) out.secret = 'on';
  if (out.secret !== 'on' && SECRET_THEMES.includes(out.theme)) out.theme = 'system';
  return out;
}

function savePrefs(userId, changes) {
  const row = db.prepare('SELECT preferences FROM users WHERE id = ?').get(userId);
  const prefs = parsePrefs(row && row.preferences);
  const before = prefs.theme;
  for (const [k, v] of Object.entries(changes)) if (PREF_OPTIONS[k] && PREF_OPTIONS[k].includes(v)) prefs[k] = v;
  // Geheime thema's uit: een geheim thema kan niet worden gekozen (het huidige thema blijft),
  // en wie de voorkeur uitzet terwijl een geheim thema actief is, gaat naar Systeem.
  if (prefs.secret !== 'on' && SECRET_THEMES.includes(prefs.theme)) prefs.theme = SECRET_THEMES.includes(before) ? 'system' : before;
  db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(JSON.stringify(prefs), userId);
  return prefs;
}

// Eigenaar ("ADONIS-beheerder"): het eerste account. Kan niet worden verwijderd of gedegradeerd
// en is de enige die de systeeminstellingen (zoals Cloudflare) ziet.
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'is_owner')) {
  db.exec('ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0');
}
if (!db.prepare('SELECT 1 FROM users WHERE is_owner = 1').get()) {
  // Bestaande installatie: de eerst aangemaakte beheerder wordt eigenaar.
  const first = db.prepare('SELECT id FROM users ORDER BY is_admin DESC, id ASC LIMIT 1').get();
  if (first) db.prepare('UPDATE users SET is_owner = 1, is_admin = 1 WHERE id = ?').run(first.id);
}

/* ---------- Rollen ----------
 * monteur:    werkopdrachten maken/wijzigen en naar facturatie sturen
 * facturatie: daarnaast werkopdrachten afronden (factuurnummer) en heropenen
 * beheerder:  alles, plus gebruikers beheren en werkopdrachten verwijderen
 * De eigenaar (ADONIS-beheerder) is altijd beheerder.
 */
const ROLES = {
  monteur: 'Monteur',
  facturatie: 'Facturatie',
  beheerder: 'Beheerder',
};
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'monteur'");
  db.exec("UPDATE users SET role = 'beheerder' WHERE is_admin = 1 OR is_owner = 1");
}

function findUserById(id) {
  const row = db.prepare('SELECT id, username, name, is_admin, is_owner, role, preferences FROM users WHERE id = ?').get(id);
  if (!row) return row;
  const { preferences, ...user } = row;
  if (user.is_owner) user.role = 'beheerder';
  if (!ROLES[user.role]) user.role = 'monteur';
  user.is_admin = user.role === 'beheerder' ? 1 : 0;
  user.can_invoice = user.role === 'facturatie' || user.role === 'beheerder';
  return { ...user, prefs: parsePrefs(preferences) };
}

function setRole(userId, role) {
  if (!ROLES[role]) throw new Error('Onbekende rol.');
  db.prepare('UPDATE users SET role = ?, is_admin = ? WHERE id = ? AND is_owner = 0').run(role, role === 'beheerder' ? 1 : 0, userId);
}

async function verifyLogin(username, password) {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  // Always run bcrypt so response time doesn't reveal whether the user exists.
  const hash = row ? row.password_hash : DUMMY_HASH;
  const ok = await bcrypt.compare(String(password || ''), hash);
  return ok && row ? findUserById(row.id) : null;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return `Wachtwoord moet minimaal ${MIN_PASSWORD} tekens lang zijn.`;
  }
  if (password.length > 200) return 'Wachtwoord is te lang.';
  return null;
}

async function createUser({ username, name, password, isAdmin, role }) {
  username = String(username || '').trim();
  name = String(name || '').trim() || username;
  if (!/^[A-Za-z0-9._-]{2,40}$/.test(username)) {
    throw new Error('Gebruikersnaam mag alleen letters, cijfers, punt, streepje en underscore bevatten (2–40 tekens).');
  }
  const pwError = validatePassword(password);
  if (pwError) throw new Error(pwError);
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    throw new Error('Deze gebruikersnaam bestaat al.');
  }
  const hash = await bcrypt.hash(password, 12);
  const first = userCount() === 0; // het allereerste account wordt eigenaar
  let r = ROLES[role] ? role : isAdmin ? 'beheerder' : 'monteur';
  if (first) r = 'beheerder';
  db.prepare('INSERT INTO users (username, name, password_hash, is_admin, is_owner, role) VALUES (?, ?, ?, ?, ?, ?)').run(
    username, name.slice(0, 80), hash, r === 'beheerder' ? 1 : 0, first ? 1 : 0, r
  );
}

async function setPassword(userId, password) {
  const pwError = validatePassword(password);
  if (pwError) throw new Error(pwError);
  const hash = await bcrypt.hash(password, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
  // Log the user out everywhere else.
  db.prepare("DELETE FROM sessions WHERE json_extract(data, '$.userId') = ?").run(userId);
}

async function checkPassword(userId, password) {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  return row ? bcrypt.compare(String(password || ''), row.password_hash) : false;
}

/* ---------- middleware ---------- */

function loadUser(req, res, next) {
  req.user = req.session.userId ? findUserById(req.session.userId) : null;
  if (req.session.userId && !req.user) delete req.session.userId; // user was deleted
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.user = req.user;
  // Thema: van de gebruiker, of (op de inlogpagina) van de laatst gekozen instelling op dit apparaat.
  const cookieTheme = /(?:^|;\s*)wo_theme=(light|dark|system|oled|neon|ice)/.exec(req.headers.cookie || '');
  res.locals.prefs = req.user ? req.user.prefs : { ...PREF_DEFAULTS, theme: cookieTheme ? cookieTheme[1] : 'system' };
  res.locals.csrf = req.session.csrf;
  next();
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  if (userCount() === 0) return res.redirect('/setup');
  const target = req.method === 'GET' ? req.originalUrl : '/';
  res.redirect('/login?next=' + encodeURIComponent(target));
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.is_admin) return next();
  res.status(403).render('error', { title: 'Geen toegang', message: 'Alleen beheerders hebben toegang tot deze pagina.' });
}

function requireOwner(req, res, next) {
  if (req.user && req.user.is_owner) return next();
  res.status(403).render('error', { title: 'Geen toegang', message: 'Alleen de ADONIS-beheerder (eigenaar) heeft toegang tot deze pagina.' });
}

function csrfProtection(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const token = (req.body && req.body._csrf) || req.get('x-csrf-token');
  const expected = req.session.csrf;
  if (
    typeof token === 'string' && expected &&
    token.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  ) {
    return next();
  }
  // Meestal: te lang niet gebruikt en daardoor uitgelogd. Leg het rustig uit; een werkopdracht die werd ingevuld
  // is op dit apparaat bewaard en wordt na het inloggen teruggezet (zie order.js).
  const loggedOut = !req.session.userId;
  res.status(403).render('error', {
    title: loggedOut ? 'U bent uitgelogd' : 'De pagina was verlopen',
    message: loggedOut
      ? 'Omdat ADONIS een tijd niet is gebruikt, bent u automatisch uitgelogd. Log opnieuw in. Was u een werkopdracht aan het invullen? Die is op dit apparaat bewaard: open hem opnieuw en kies "Terugzetten".'
      : 'Deze pagina stond te lang open. Ga terug, laad de pagina opnieuw en probeer het nog eens. Een werkopdracht die u aan het invullen was, is op dit apparaat bewaard.',
    action: loggedOut ? { href: '/login', label: 'Opnieuw inloggen' } : null,
  });
}

/* Simple in-memory brute-force protection for the login form. */
const attempts = new Map();
const WINDOW = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function loginBlocked(key) {
  const a = attempts.get(key);
  if (!a || a.reset < Date.now()) return false;
  return a.count >= MAX_ATTEMPTS;
}
function loginFailed(key) {
  const a = attempts.get(key);
  if (!a || a.reset < Date.now()) attempts.set(key, { count: 1, reset: Date.now() + WINDOW });
  else a.count += 1;
}
function loginSucceeded(key) {
  attempts.delete(key);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, a] of attempts) if (a.reset < now) attempts.delete(k);
}, WINDOW).unref();

module.exports = {
  PREF_OPTIONS, SECRET_THEMES, visibleThemes, savePrefs, ROLES, setRole,
  userCount, findUserById, verifyLogin, createUser, setPassword, checkPassword,
  loadUser, requireLogin, requireAdmin, requireOwner, csrfProtection,
  loginBlocked, loginFailed, loginSucceeded,
};
