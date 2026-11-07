'use strict';
/** Systeeminstellingen die via de website worden beheerd (bijv. Cloudflare), opgeslagen in de database. */
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function get(key, fallback = null) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}

function set(key, value) {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(key, JSON.stringify(value));
}

function remove(key) {
  db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
}

module.exports = { get, set, remove };
