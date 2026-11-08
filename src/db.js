'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'werkopdrachten.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  sid     TEXT PRIMARY KEY,
  data    TEXT NOT NULL,
  expires INTEGER NOT NULL
);

-- Eén klant/voertuig per kenteken. Wordt automatisch bijgewerkt
-- met de gegevens van de laatst opgeslagen werkopdracht.
CREATE TABLE IF NOT EXISTS customers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  plate_key     TEXT NOT NULL UNIQUE,      -- kenteken zonder streepjes, hoofdletters
  kenteken      TEXT NOT NULL,             -- kenteken zoals weergegeven
  naam          TEXT NOT NULL DEFAULT '',
  adres         TEXT NOT NULL DEFAULT '',
  plaats        TEXT NOT NULL DEFAULT '',
  klantnr       TEXT NOT NULL DEFAULT '',
  tel_prive     TEXT NOT NULL DEFAULT '',
  tel_zaak      TEXT NOT NULL DEFAULT '',
  merk_type     TEXT NOT NULL DEFAULT '',
  chassisnummer TEXT NOT NULL DEFAULT '',
  alarmcode     TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nummer        INTEGER NOT NULL UNIQUE,
  customer_id   INTEGER NOT NULL REFERENCES customers(id),
  datum_invoer  TEXT NOT NULL,             -- YYYY-MM-DD, automatisch bij aanmaken
  data          TEXT NOT NULL,             -- alle formuliervelden als JSON
  search_text   TEXT NOT NULL DEFAULT '',  -- platte tekst om in te zoeken
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS orders_customer ON orders(customer_id);
`);

// Handmatig gewijzigde klantgegevens: tot wanneer ze voorgaan op de gegevens uit (oudere) werkopdrachten.
if (!db.prepare('PRAGMA table_info(customers)').all().some((c) => c.name === 'bewerkt_at')) {
  db.exec('ALTER TABLE customers ADD COLUMN bewerkt_at TEXT');
}

// APK-lijst: wanneer de klant is gebeld, en voor welke APK-datum (bij een nieuwe datum begint het opnieuw).
for (const col of ['apk_gebeld', 'apk_gebeld_voor']) {
  if (!db.prepare('PRAGMA table_info(customers)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE customers ADD COLUMN ${col} TEXT`);
}

function plateKey(kenteken) {
  return String(kenteken || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

module.exports = { db, plateKey, DATA_DIR };
