'use strict';
/**
 * ADONIS-app: een eigen venster voor de ADONIS-website, zonder tabbladen of adresbalk.
 *
 * - Eerste start: vraagt het adres van de ADONIS-server (en controleert dat ADONIS daar antwoordt).
 * - Daarna: opent direct ADONIS. Adres, venstergrootte en -positie worden onthouden.
 * - Vooraf instellen: zet "adonis-app.json" met {"url": "https://adonis.voorbeeld.nl"} naast de .exe.
 * - Links naar andere websites openen in de gewone browser; dit venster blijft ADONIS.
 * - Ctrl+, = adres wijzigen, Ctrl+R = herladen, F11 = volledig scherm.
 */
const { app, BrowserWindow, Menu, shell, ipcMain, net, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ICON = path.join(__dirname, 'build', 'icon.png');
const CONFIG_FILE = () => path.join(app.getPath('userData'), 'config.json');
// Bij de "portable" .exe pakt Windows de app uit in een tijdelijke map; dit is de map van de echte .exe.
const EXE_DIR = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);

/* ---------------- instellingen ---------------- */
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function loadConfig() {
  const own = readJson(CONFIG_FILE()) || {};
  if (!own.url) {
    // Vooraf ingesteld door de beheerder (bestand naast de .exe)
    const preset = readJson(path.join(EXE_DIR, 'adonis-app.json'));
    if (preset && typeof preset.url === 'string') own.url = normalizeUrl(preset.url) || undefined;
  }
  return own;
}
function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify(cfg, null, 2));
}
let config = {};

/** "adonis.revnet.nl" -> "https://adonis.revnet.nl" (alleen het begin: schema + host + poort). */
function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/.test(s) ? 'http://' : 'https://') + s;
  try {
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol) || !u.hostname) return null;
    return u.origin;
  } catch {
    return null;
  }
}
function sameOrigin(url) {
  try { return config.url && new URL(url).origin === config.url; } catch { return false; }
}

/** Controleer dat er op dit adres echt een ADONIS-server antwoordt. Probeert bij een kaal domein ook http. */
async function probe(input) {
  const first = normalizeUrl(input);
  if (!first) return { ok: false, error: 'Dat is geen geldig adres.' };
  const candidates = [first];
  if (!/^https?:\/\//i.test(String(input).trim()) && first.startsWith('https://')) candidates.push(first.replace('https://', 'http://'));
  let lastError = '';
  for (const base of candidates) {
    try {
      const res = await net.fetch(base + '/login', { signal: AbortSignal.timeout(8000) });
      const html = await res.text();
      if (/ADONIS/.test(html)) {
        let final = base;
        try { if (res.url) final = new URL(res.url).origin; } catch { /* geen eindadres bekend */ }
        return { ok: true, url: final };
      }
      lastError = `Er draait op ${base} wel iets, maar het is geen ADONIS.`;
    } catch (err) {
      lastError = `Geen verbinding met ${base} (${err.message}).`;
    }
  }
  return { ok: false, error: lastError };
}

/* ---------------- venster ---------------- */
let win = null;
function localPage(name, query = {}) {
  return { file: path.join(__dirname, name), query };
}
function showSetup(reason) {
  const p = localPage('setup.html', { current: config.url || '', reason: reason || '' });
  win.loadFile(p.file, { query: p.query });
}
function showOffline(url, error) {
  win.loadFile(path.join(__dirname, 'offline.html'), { query: { url, error: error || '' } });
}
function openAdonis() {
  if (!config.url) return showSetup();
  win.loadURL(config.url + '/');
}

function createWindow() {
  const b = config.window || {};
  win = new BrowserWindow({
    width: b.width || 1400, height: b.height || 900, x: b.x, y: b.y,
    minWidth: 900, minHeight: 600,
    title: 'ADONIS', icon: ICON, backgroundColor: '#14171c',
    autoHideMenuBar: true,
    // Meteen tonen (met de donkere achtergrond) in plaats van te wachten tot de pagina geladen is:
    // anders is de opstartanimatie op een trage pc al voorbij voordat het venster verschijnt.
    show: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (b.maximized) win.maximize();
  win.on('close', () => {
    config.window = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    saveConfig(config);
  });
  win.on('page-title-updated', (e, title) => {
    e.preventDefault();
    win.setTitle(title && title !== 'ADONIS' ? title.replace(/ · ADONIS$/, '') + ' – ADONIS' : 'ADONIS');
  });

  const wc = win.webContents;
  // Andere websites (bijv. rdw.nl) in de gewone browser; dit venster blijft bij ADONIS.
  wc.on('will-navigate', (e, url) => {
    if (url.startsWith('file:') || sameOrigin(url)) return;
    e.preventDefault();
    // "Wijzigen" bij het serveradres op het inlogscherm: het scherm om een ander adres te kiezen.
    // (Doet verder niets: je moet daar zelf een adres invullen.)
    if (url === 'adonis-app:server-wijzigen') return showSetup('wijzigen');
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: ICON, backgroundColor: '#14171c' } };
    }
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* afgebroken, bijv. door doorsturen */ || url.startsWith('file:')) return;
    showOffline(config.url || url, desc);
  });
  openAdonis();
}

/* ---------------- menu (verborgen; Alt toont het) ---------------- */
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'ADONIS',
      submenu: [
        { label: 'Startpagina', accelerator: 'Alt+Home', click: () => openAdonis() },
        { label: 'Adres van de server wijzigen…', accelerator: 'CmdOrCtrl+,', click: () => showSetup('wijzigen') },
        { type: 'separator' },
        { label: 'Afdrukken…', accelerator: 'CmdOrCtrl+P', click: () => win && win.webContents.print() },
        { type: 'separator' },
        { role: 'quit', label: 'Afsluiten' },
      ],
    },
    {
      label: 'Beeld',
      submenu: [
        { role: 'reload', label: 'Herladen' },
        { role: 'forceReload', label: 'Volledig herladen' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Ware grootte' },
        { role: 'zoomIn', label: 'Inzoomen' },
        { role: 'zoomOut', label: 'Uitzoomen' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Volledig scherm' },
        { role: 'toggleDevTools', label: 'Ontwikkelaarshulpmiddelen' },
      ],
    },
  ]));
}

/* ---------------- communicatie met de lokale pagina's (setup/offline) ---------------- */
ipcMain.handle('adonis:get-config', () => ({ url: config.url || '' }));
ipcMain.handle('adonis:save-url', async (e, input) => {
  if (!e.senderFrame.url.startsWith('file:')) return { ok: false, error: 'Niet toegestaan.' };
  const r = await probe(input);
  if (!r.ok) return r;
  config.url = r.url;
  saveConfig(config);
  setTimeout(openAdonis, 50);
  return r;
});
ipcMain.handle('adonis:open', (e) => {
  if (!e.senderFrame.url.startsWith('file:')) return;
  openAdonis();
});
ipcMain.handle('adonis:setup', (e) => {
  if (!e.senderFrame.url.startsWith('file:')) return;
  showSetup('wijzigen');
});

/* ---------------- start ---------------- */
// Voor tests: aparte instellingenmap.
if (process.env.ADONIS_APP_DATA) app.setPath('userData', process.env.ADONIS_APP_DATA);
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.setAppUserModelId('nl.adonis.werkopdrachten'); // eigen icoon/groep in de Windows-taakbalk
  app.whenReady().then(() => {
    config = loadConfig();
    // Laat de server weten dat dit de ADONIS-app is (Instellingen toont dan geen downloadknop).
    session.defaultSession.setUserAgent(`${session.defaultSession.getUserAgent()} ADONIS-app/${app.getVersion()}`);
    // Rechten (camera, meldingen…) alleen voor de eigen ADONIS-server.
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
      callback(sameOrigin(details.requestingUrl || wc.getURL()));
    });
    buildMenu();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}

module.exports = { normalizeUrl }; // voor tests
