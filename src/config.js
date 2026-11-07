'use strict';
/**
 * Instellingen uit config.properties (naast de executable), zoals server.properties bij Minecraft.
 * Volgorde: opdrachtregel (--port 8080) > omgevingsvariabelen > config.properties > standaard.
 */
const fs = require('node:fs');
const path = require('node:path');

function isSea() {
  try {
    return require('node:sea').isSea();
  } catch {
    return false;
  }
}

/** Map waar config.properties en data/ staan: naast de .exe, of de projectmap tijdens ontwikkeling. */
const BASE_DIR = process.env.WERKOPDRACHTEN_HOME
  ? path.resolve(process.env.WERKOPDRACHTEN_HOME)
  : isSea() ? path.dirname(process.execPath) : path.join(__dirname, '..');

const CONFIG_FILE = path.join(BASE_DIR, 'config.properties');

const DEFAULTS = [
  ['port', '3000', 'Poort waarop de website draait. Open daarna http://localhost:<poort> in de browser.'],
  ['host', '0.0.0.0', '0.0.0.0 = ook bereikbaar vanaf andere pc\'s/tablets in de werkplaats. 127.0.0.1 = alleen deze pc.'],
  ['data-dir', 'data', 'Map voor de database (relatief t.o.v. deze map). Maak hier regelmatig een back-up van!'],
  ['start-order-number', '1', 'Eerste werkopdrachtnummer, bijv. 4449 om door te tellen na de papieren boekjes.'],
  ['open-browser', 'true', 'Browser automatisch openen bij opstarten (alleen Windows/macOS met scherm).'],
  ['secure-cookies', 'false', 'Zet op true als de site via HTTPS wordt bereikt (bijv. achter een reverse proxy).'],
  ['trust-proxy', 'false', 'Zet op true als de site achter een reverse proxy draait (nginx, Caddy, Cloudflare...).'],
  ['timezone', 'Europe/Amsterdam', 'Tijdzone voor "Datum invoer".'],
  ['anthropic-api-key', '', 'API-sleutel voor foto-import (handschrift uitlezen met Claude). Aanmaken op https://console.anthropic.com – leeg = foto-import uit. Vereist internet.'],
];

const ENV_NAMES = {
  port: ['SERVER_PORT', 'PORT'], // SERVER_PORT = Pterodactyl
  host: ['SERVER_IP', 'HOST'],
  'data-dir': ['DATA_DIR'],
  'start-order-number': ['START_ORDER_NUMBER'],
  'open-browser': ['OPEN_BROWSER'],
  'secure-cookies': ['COOKIE_SECURE'],
  'trust-proxy': ['TRUST_PROXY'],
  'anthropic-api-key': ['ANTHROPIC_API_KEY'],
  timezone: ['APP_TIMEZONE'], // bewust niet TZ: Pterodactyl/Docker zetten die vaak op UTC
};

function parseProperties(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const m = /^([^=:\s]+)\s*[=:]\s*(.*)$/.exec(line);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

function writeDefaultConfig() {
  const lines = [
    '# Werkopdrachten – instellingen',
    '# Pas waarden aan en start het programma opnieuw.',
    '',
  ];
  for (const [key, value, help] of DEFAULTS) lines.push(`# ${help}`, `${key}=${value}`, '');
  fs.writeFileSync(CONFIG_FILE, lines.join('\n'), 'utf8');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) continue;
    if (m[2] !== undefined) out[m[1]] = m[2];
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[m[1]] = argv[++i];
    else out[m[1]] = 'true';
  }
  return out;
}

function load(argv = []) {
  let created = false;
  if (!fs.existsSync(CONFIG_FILE)) {
    try {
      writeDefaultConfig();
      created = true;
    } catch {
      /* map niet schrijfbaar: gewoon standaardwaarden gebruiken */
    }
  }
  let fileValues = {};
  try {
    fileValues = parseProperties(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    /* geen bestand */
  }
  // Nieuwe instellingen (na een update) onderaan een bestaand bestand toevoegen.
  if (!created && fs.existsSync(CONFIG_FILE)) {
    const missing = DEFAULTS.filter(([key]) => !(key in fileValues));
    if (missing.length) {
      try {
        const lines = ['', ...missing.flatMap(([key, value, help]) => [`# ${help}`, `${key}=${value}`, ''])];
        fs.appendFileSync(CONFIG_FILE, lines.join('\n'), 'utf8');
      } catch {
        /* niet schrijfbaar: standaardwaarden gebruiken */
      }
    }
  }
  const args = parseArgs(argv);
  const cfg = {};
  for (const [key, def] of DEFAULTS) {
    const env = (ENV_NAMES[key] || []).map((n) => process.env[n]).find((v) => v !== undefined && v !== '');
    cfg[key] = args[key] ?? env ?? fileValues[key] ?? def;
  }
  const bool = (v) => /^(true|1|yes|ja|on)$/i.test(String(v));
  return {
    created,
    file: CONFIG_FILE,
    baseDir: BASE_DIR,
    port: parseInt(cfg.port, 10) || 3000,
    host: cfg.host,
    dataDir: path.resolve(BASE_DIR, cfg['data-dir']),
    startOrderNumber: parseInt(cfg['start-order-number'], 10) || 1,
    openBrowser: bool(cfg['open-browser']),
    secureCookies: bool(cfg['secure-cookies']),
    trustProxy: bool(cfg['trust-proxy']),
    timezone: cfg.timezone,
    anthropicApiKey: cfg['anthropic-api-key'],
  };
}

module.exports = { load, isSea, BASE_DIR };
