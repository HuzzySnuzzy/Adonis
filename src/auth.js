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
  theme: ['system', 'light', 'dark'],
  ink: ['hand', 'plain'],
  start: ['/', '/werkopdrachten', '/importeren', '/werkopdracht/nieuw'],
};
const PREF_DEFAULTS = { theme: 'system', ink: 'hand', start: '/' };

function parsePrefs(json) {
  let raw = {};
  try { raw = JSON.parse(json || '{}'); } catch { /* standaard */ }
  const out = {};
  for (const [k, opts] of Object.entries(PREF_OPTIONS)) out[k] = opts.includes(raw[k]) ? raw[k] : PREF_DEFAULTS[k];
  return out;
}

function savePrefs(userId, changes) {
  const row = db.prepare('SELECT preferences FROM users WHERE id = ?').get(userId);
  const prefs = parsePrefs(row && row.preferences);
  for (const [k, v] of Object.entries(changes)) if (PREF_OPTIONS[k] && PREF_OPTIONS[k].includes(v)) prefs[k] = v;
  db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(JSON.stringify(prefs), userId);
  return prefs;
}

function findUserById(id) {
  const row = db.prepare('SELECT id, username, name, is_admin, preferences FROM users WHERE id = ?').get(id);
  if (!row) return row;
  const { preferences, ...user } = row;
  return { ...user, prefs: parsePrefs(preferences) };
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

async function createUser({ username, name, password, isAdmin }) {
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
  db.prepare('INSERT INTO users (username, name, password_hash, is_admin) VALUES (?, ?, ?, ?)').run(
    username, name.slice(0, 80), hash, isAdmin ? 1 : 0
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
  const cookieTheme = /(?:^|;\s*)wo_theme=(light|dark|system)/.exec(req.headers.cookie || '');
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
  res.status(403).render('error', {
    title: 'Sessie verlopen',
    message: 'De pagina was verlopen. Ga terug, herlaad de pagina en probeer het opnieuw.',
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
  PREF_OPTIONS, savePrefs,
  userCount, findUserById, verifyLogin, createUser, setPassword, checkPassword,
  loadUser, requireLogin, requireAdmin, csrfProtection,
  loginBlocked, loginFailed, loginSucceeded,
};
