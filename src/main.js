'use strict';
/**
 * Startpunt van Werkopdrachten.
 *
 *   werkopdrachten                              server starten
 *   werkopdrachten --port 8080                  andere poort
 *   werkopdrachten create-user <gebruiker> "<naam>" [--admin]
 *   werkopdrachten reset-password <gebruiker>
 *   werkopdrachten users
 *
 * Bij de eerste start worden config.properties en de map data/ naast het programma aangemaakt.
 */

// node:sqlite geeft een "ExperimentalWarning" – onderdrukken, het werkt prima.
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  const type = typeof rest[0] === 'string' ? rest[0] : rest[0] && rest[0].type;
  if (type === 'ExperimentalWarning' || (warning && warning.name === 'ExperimentalWarning')) return;
  return emitWarning.call(process, warning, ...rest);
};

const os = require('node:os');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const config = require('./config');
const VERSION = require('./version');

const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith('--') ? argv[0] : null;
const cfg = config.load(argv);

// Doorgeven aan de rest van de app (db.js, orders.js, server.js lezen deze).
process.env.DATA_DIR = cfg.dataDir;
process.env.START_ORDER_NUMBER = String(cfg.startOrderNumber);
process.env.APP_TIMEZONE = cfg.timezone;
process.env.COOKIE_SECURE = cfg.secureCookies ? 'true' : 'false';
process.env.TRUST_PROXY = cfg.trustProxy ? 'true' : 'false';
process.env.IMPORT_LIMIT_PER_DAY = String(cfg.importLimitPerDay);
process.env.AUTO_UPDATE_ENABLED = cfg.autoUpdate ? 'true' : 'false';
process.env.APP_PORT = String(cfg.port);
if (cfg.anthropicApiKey) process.env.ANTHROPIC_API_KEY = cfg.anthropicApiKey;
else delete process.env.ANTHROPIC_API_KEY;

const isWindows = process.platform === 'win32';
const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

/** Bij dubbelklikken op Windows sluit het venster direct bij een fout – eerst op Enter laten drukken. */
function fatal(message) {
  console.error('\n  FOUT: ' + message + '\n');
  if (isWindows && interactive) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('  Druk op Enter om af te sluiten...', () => process.exit(1));
  } else {
    process.exit(1);
  }
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: interactive });
    if (interactive) rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); if (interactive) process.stdout.write('\n'); resolve(answer); });
  });
}

/* ------------------------------------------------------------------ */
/* Beheeropdrachten (zowel vanaf de opdrachtregel als in de console)  */
/* ------------------------------------------------------------------ */
async function runAdminCommand(cmd, args, { askPassword }) {
  const auth = require('./auth');
  const { db } = require('./db');
  const flags = args.filter((a) => a.startsWith('--'));
  const pos = args.filter((a) => !a.startsWith('--'));
  switch (cmd) {
    case 'users': {
      const rows = db.prepare('SELECT username, name, role, is_owner FROM users ORDER BY is_owner DESC, username').all();
      if (!rows.length) console.log('  Nog geen gebruikers.');
      for (const u of rows) console.log(`  ${u.username.padEnd(20)} ${u.name.padEnd(24)} ${u.is_owner ? 'ADONIS-beheerder (eigenaar)' : u.role}`);
      return true;
    }
    case 'create-user': {
      const [username, name, pw] = pos;
      if (!username) {
        console.log('  Gebruik: create-user <gebruikersnaam> "<naam>" [wachtwoord] [--admin]');
        return true;
      }
      const password = pw || (askPassword ? await askHidden('  Wachtwoord: ') : '');
      await auth.createUser({ username, name: name || username, password, isAdmin: flags.includes('--admin') });
      console.log(`  Gebruiker "${username}" aangemaakt${flags.includes('--admin') ? ' (beheerder)' : ''}.`);
      return true;
    }
    case 'reset-password': {
      const [username, pw] = pos;
      if (!username) {
        console.log('  Gebruik: reset-password <gebruikersnaam> [nieuw wachtwoord]');
        return true;
      }
      const row = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (!row) throw new Error(`Gebruiker "${username}" bestaat niet.`);
      const password = pw || (askPassword ? await askHidden('  Nieuw wachtwoord: ') : '');
      await auth.setPassword(row.id, password);
      console.log(`  Wachtwoord van "${username}" is gewijzigd.`);
      return true;
    }
    case 'make-admin':
    case 'set-role': {
      const role = cmd === 'make-admin' ? 'beheerder' : pos[1];
      if (!auth.ROLES[role]) {
        console.log('  Gebruik: set-role <gebruiker> <monteur|facturatie|beheerder>');
        return true;
      }
      const row = db.prepare('SELECT id, is_owner FROM users WHERE username = ?').get(pos[0] || '');
      if (!row) console.log('  Gebruiker niet gevonden.');
      else if (row.is_owner) console.log('  De ADONIS-beheerder is altijd beheerder.');
      else { auth.setRole(row.id, role); console.log(`  ${pos[0]} is nu ${auth.ROLES[role]}.`); }
      return true;
    }
    default:
      return false;
  }
}

const HELP = `
  Opdrachten:
    help                                      deze hulp
    users                                     gebruikers tonen
    create-user <gebruiker> "<naam>" [ww] [--admin]
                                              gebruiker aanmaken
    reset-password <gebruiker> [ww]           wachtwoord opnieuw instellen
    set-role <gebruiker> <rol>                rol: monteur, facturatie of beheerder
    update                                    nu naar een nieuwe versie zoeken
    stop                                      server netjes stoppen
`;

function splitArgs(line) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/* ------------------------------------------------------------------ */
/* Server                                                             */
/* ------------------------------------------------------------------ */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

function openBrowser(url) {
  try {
    if (isWindows) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* geen browser – geen probleem */
  }
}

function startServer() {
  let app;
  let auth;
  try {
    app = require('./server');
    auth = require('./auth');
  } catch (err) {
    return fatal(`Kan de database niet openen in "${cfg.dataDir}".\n  ${err.message}`);
  }

  const server = app.listen(cfg.port, cfg.host);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      fatal(`Poort ${cfg.port} is al in gebruik. Draait Werkopdrachten al?\n  Kies anders een andere poort in ${cfg.file}`);
    } else if (err.code === 'EACCES') {
      fatal(`Geen toestemming om poort ${cfg.port} te gebruiken. Kies een poort boven 1024 in ${cfg.file}`);
    } else {
      fatal(err.message);
    }
  });

  server.on('listening', () => {
    require('./update').startStatusChecks(cfg.updateRepo);
    // Cloudflare-tunnel weer starten als die is ingesteld.
    const cfSettings = require('./settings').get('cloudflare', null);
    if (cfSettings && cfSettings.enabled && cfSettings.token) {
      console.log(`  Online via Cloudflare: https://${cfSettings.hostname || '(tunnel)'}`);
      if (cfSettings.port && cfSettings.port !== cfg.port) {
        console.log(`  LET OP: de tunnel stuurt door naar poort ${cfSettings.port}, maar ADONIS draait nu op ${cfg.port}. Stel de tunnel opnieuw in via Systeem.`);
      }
      require('./tunnel').start({ token: cfSettings.token, hostname: cfSettings.hostname });
    }
    const local = `http://localhost:${cfg.port}`;
    console.log('');
    console.log(`  ADONIS Werkopdrachten v${VERSION}`);
    console.log('  ------------------------------------------------------------');
    console.log(`  Werkopdrachten draait op ${local}`);
    if (cfg.host === '0.0.0.0' || cfg.host === '::') {
      for (const ip of lanAddresses()) console.log(`  Andere apparaten in het netwerk:  http://${ip}:${cfg.port}`);
    }
    console.log(`  Instellingen: ${cfg.file}`);
    console.log(`  Database:     ${cfg.dataDir}`);
    console.log(`  Foto-import:  ${cfg.anthropicApiKey ? `aan (max. ${cfg.importLimitPerDay || 'onbeperkt'} per dag)` : 'uit (vul anthropic-api-key in config.properties in)'}`);
    if (cfg.created) console.log('  (config.properties is zojuist aangemaakt met standaardwaarden)');
    if (auth.userCount() === 0) {
      console.log('');
      console.log(`  Nog geen accounts! Open ${local}/setup om het eerste beheerdersaccount aan te maken,`);
      console.log('  of typ hier:  create-user <gebruikersnaam> "<naam>" <wachtwoord> --admin');
    }
    console.log('  ------------------------------------------------------------');
    console.log('  Typ "help" voor opdrachten, "stop" om af te sluiten. Laat dit venster open.');
    console.log('');
    if (cfg.openBrowser && interactive && (isWindows || process.platform === 'darwin')) {
      openBrowser(auth.userCount() === 0 ? local + '/setup' : local);
    }
  });

  let stopping = false;
  function stop() {
    if (stopping) return;
    stopping = true;
    console.log('  Server wordt gestopt...');
    try { require('./tunnel').stop(); } catch { /* geen tunnel */ }
    server.close(() => {
      try { require('./db').db.close(); } catch { /* al dicht */ }
      console.log('  Gestopt.');
      process.exit(0);
    });
    server.closeAllConnections?.();
    setTimeout(() => process.exit(0), 3000).unref();
  }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  // Console-opdrachten (werkt ook in de Pterodactyl-console).
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', async (line) => {
    const [cmd, ...args] = splitArgs(line.trim());
    if (!cmd) return;
    try {
      if (cmd === 'stop' || cmd === 'exit' || cmd === 'quit') return stop();
      if (cmd === 'help' || cmd === '?') return console.log(HELP);
      if (cmd === 'update') {
        const r = await require('./update').checkAndInstall({ repo: cfg.updateRepo, log: console.log });
        console.log('  ' + r.message + (r.updated ? ' Herstart om de nieuwe versie te gebruiken (typ "stop" en start opnieuw).' : ''));
        return;
      }
      if (!(await runAdminCommand(cmd, args, { askPassword: false }))) {
        console.log(`  Onbekende opdracht "${cmd}". Typ "help".`);
      }
    } catch (err) {
      console.log('  Fout: ' + err.message);
    }
  });
  // stdin gesloten (bijv. Docker zonder -i): server gewoon laten draaien.
  rl.on('close', () => {});
}

/* ------------------------------------------------------------------ */
(async () => {
  if (command === 'help' || argv.includes('--help') || argv.includes('-h')) {
    console.log(`\n  ADONIS Werkopdrachten v${VERSION}\n\n  Start zonder opdracht om de server te starten.\n  Opties: --port <poort>  --host <adres>  --data-dir <map>\n${HELP}`);
    return;
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(VERSION);
    return;
  }
  if (command === 'update') {
    try {
      const r = await require('./update').checkAndInstall({ repo: cfg.updateRepo, log: console.log });
      console.log('  ' + r.message);
    } catch (err) {
      console.error('  Bijwerken mislukt: ' + err.message);
      process.exitCode = 1;
    }
    return;
  }
  if (command) {
    try {
      if (!(await runAdminCommand(command, argv.slice(1), { askPassword: true }))) {
        console.log(`  Onbekende opdracht "${command}".\n${HELP}`);
        process.exitCode = 1;
      }
    } catch (err) {
      console.error('  Fout: ' + err.message);
      process.exitCode = 1;
    }
    return;
  }
  if (cfg.autoUpdate && config.isSea() && !process.env.WERKOPDRACHTEN_JUST_UPDATED) {
    try {
      console.log(`  Werkopdrachten v${VERSION} – zoeken naar updates...`);
      const r = await require('./update').checkAndInstall({ repo: cfg.updateRepo, log: console.log });
      console.log('  ' + r.message);
      if (r.updated) return relaunch();
    } catch (err) {
      console.log(`  Bijwerken overgeslagen: ${err.message}. De huidige versie wordt gestart.`);
    }
  }
  startServer();
})();

/** Na een update: de nieuwe versie starten in hetzelfde venster/dezelfde console. */
function relaunch() {
  console.log('  Nieuwe versie wordt gestart...');
  const child = spawn(process.execPath, process.argv.slice(2), {
    stdio: 'inherit',
    env: { ...process.env, WERKOPDRACHTEN_JUST_UPDATED: '1' },
  });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { try { child.kill(sig); } catch { /* al gestopt */ } });
  }
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  child.on('error', (err) => fatal('Kon de nieuwe versie niet starten: ' + err.message));
}
