'use strict';
/**
 * ADONIS-app: een eigen venster voor de ADONIS-website, zonder tabbladen of adresbalk.
 *
 * - Eerste start: vraagt het adres van de ADONIS-server (en controleert dat ADONIS daar antwoordt).
 * - Daarna: opent direct ADONIS. Adres, venstergrootte en -positie worden onthouden.
 * - Vooraf instellen: zet "adonis-app.json" met {"url": "https://adonis.voorbeeld.nl"} naast de .exe.
 * - Links naar andere websites openen in de gewone browser; dit venster blijft ADONIS.
 * - Ctrl+, = adres wijzigen, Ctrl+R = herladen, F11 = volledig scherm.
 * - Werkt zichzelf bij naar de versie van de server (zie updater.js).
 */
const { app, BrowserWindow, Menu, shell, ipcMain, net, session, dialog } = require('electron');
const updater = require('./updater');
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
    // webviewTag: websites uit het Portaal als venster op het ADONIS-bureaublad (zie will-attach-webview hieronder).
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true },
  });
  if (b.maximized) win.maximize();
  // Volledig scherm (F11) onthouden, net als gemaximaliseerd.
  if (b.fullscreen) win.setFullScreen(true);
  const rememberWindow = () => {
    if (!win || win.isDestroyed()) return;
    config.window = { ...win.getNormalBounds(), maximized: win.isMaximized(), fullscreen: win.isFullScreen() };
    saveConfig(config);
  };
  win.on('closed', () => { if (pendingRestart) updater.restartIntoNew(); });
  win.on('close', rememberWindow);
  // Ook meteen bij het wisselen (dan klopt het ook als de app niet netjes afsluit, bijv. bij een update of stroomstoring).
  for (const ev of ['enter-full-screen', 'leave-full-screen', 'maximize', 'unmaximize']) win.on(ev, rememberWindow);
  // Muisknoppen terug/vooruit (Windows).
  win.on('app-command', (e, cmd) => {
    if (cmd === 'browser-backward') goHistory(-1);
    else if (cmd === 'browser-forward') goHistory(1);
  });
  // Het update-hoekje schuift mee met het venster.
  for (const ev of ['move', 'resize', 'maximize', 'unmaximize', 'restore']) win.on(ev, () => placeToast());
  win.on('page-title-updated', (e, title) => {
    e.preventDefault();
    win.setTitle(title && title !== 'ADONIS' ? title.replace(/ · ADONIS$/, '') + ' – ADONIS' : 'ADONIS');
  });

  const wc = win.webContents;
  // Sluiten of opnieuw starten terwijl er nog iets niet is opgeslagen: vragen (anders gebeurt er stil niets).
  wc.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', title: 'ADONIS', buttons: ['Toch sluiten', 'Annuleren'], defaultId: 1, cancelId: 1, noLink: true,
      message: 'Er zijn wijzigingen die nog niet zijn opgeslagen.',
      detail: 'Een werkopdracht wordt op deze computer bewaard: de volgende keer vraagt ADONIS of hij teruggezet moet worden.',
    });
    if (choice === 0) e.preventDefault(); // toch doorgaan
    else if (pendingRestart) { // geannuleerd: niet later alsnog opnieuw starten, en de vraag weer tonen
      pendingRestart = false;
      if (lastState && lastState.state === 'klaar') showToast(lastState);
    }
  });
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

/* ---------------- websites uit het Portaal binnen ADONIS ----------------
 * Een site opent in een eigen ADONIS-venster (site.html: knoppen terug/vooruit/herladen/in browser) of, in de
 * bureaubladmodus, als venster op het ADONIS-bureaublad (<webview>). Die sites krijgen GEEN toegang tot de app:
 * geen preload, sandbox aan, een eigen opslag ("persist:portaal", zodat inloggen bij leveranciers bewaard blijft)
 * en geen rechten (camera e.d.). Alleen de eigen ADONIS-server en site.html mogen zo'n venster maken. */
const siteWindows = new Set();
const isWeb = (u) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };
function openSiteWindow(url, title) {
  if (!isWeb(url)) return;
  const w = new BrowserWindow({
    width: 1280, height: 860, minWidth: 600, minHeight: 400, title: title || 'ADONIS – website', icon: ICON, backgroundColor: '#14171c', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true },
  });
  siteWindows.add(w.webContents);
  w.on('closed', () => siteWindows.delete(w.webContents));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.loadFile(path.join(__dirname, 'site.html'), { query: { url, title: title || '' } });
}
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (ev, wp, params) => {
    const fromAdonis = win && contents === win.webContents && sameOrigin(contents.getURL());
    if (!(fromAdonis || siteWindows.has(contents)) || !isWeb(params.src)) { ev.preventDefault(); return; }
    delete wp.preload; delete params.preload;
    Object.assign(wp, { nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false });
    params.partition = 'persist:portaal';
  });
  if (contents.getType() === 'webview') {
    // Pop-ups (bijv. "inloggen" in een nieuw tabblad) in hetzelfde venster openen.
    contents.setWindowOpenHandler(({ url }) => { if (isWeb(url)) contents.loadURL(url); return { action: 'deny' }; });
  }
});
ipcMain.handle('adonis:open-site', (e, url, title) => {
  if (!win || e.sender !== win.webContents || !sameOrigin(e.senderFrame.url)) return;
  openSiteWindow(String(url || ''), String(title || '').slice(0, 120));
});
ipcMain.handle('adonis:open-external', (e, url) => {
  const ok = (win && e.sender === win.webContents && sameOrigin(e.senderFrame.url)) || siteWindows.has(e.sender);
  if (ok && isWeb(String(url || ''))) shell.openExternal(String(url));
});

/* ---------------- terug / vooruit (de app heeft geen adresbalk met knoppen) ---------------- */
function goHistory(dir) {
  const w = BrowserWindow.getFocusedWindow() || win;
  if (!w) return;
  const wc = w.webContents;
  if (dir < 0) {
    // De pagina weet zelf wat de vorige ADONIS-pagina was (ook na opslaan); anders de gewone geschiedenis.
    wc.executeJavaScript('window.adonisBack ? (window.adonisBack(), true) : false', true).then((done) => {
      if (!done) { const h = wc.navigationHistory || wc; if (h.canGoBack()) h.goBack(); }
    }).catch(() => {});
  } else {
    const h = wc.navigationHistory || wc;
    if (h.canGoForward()) h.goForward();
  }
}

/* ---------------- menu (verborgen; Alt toont het) ---------------- */
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'ADONIS',
      submenu: [
        { label: 'Startpagina', accelerator: 'Alt+Home', click: () => openAdonis() },
        { label: 'Terug', accelerator: 'Alt+Left', click: () => goHistory(-1) },
        { label: 'Vooruit', accelerator: 'Alt+Right', click: () => goHistory(1) },
        { label: 'Adres van de server wijzigen…', accelerator: 'CmdOrCtrl+,', click: () => showSetup('wijzigen') },
        { label: 'Controleren op updates', click: () => checkUpdate(true) },
        { type: 'separator' },
        { label: 'Afdrukken…', accelerator: 'CmdOrCtrl+P', click: () => { const w = BrowserWindow.getFocusedWindow() || win; if (w) printPreview(w); } },
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

/* ---------------- afdrukken met voorbeeld ----------------
 * Het afdrukscherm van Windows toont bij Electron geen voorbeeld, staat altijd op "Staand" en laat de grijze vakken weg.
 * Daarom: eerst een PDF maken zoals de pagina het vraagt (werkopdracht = A4 liggend, met achtergronden) en die tonen in
 * een voorbeeldvenster met de knoppen Afdrukken en Opslaan (de PDF-weergave van Chromium). */
async function printPreview(parent) {
  const wc = parent.webContents;
  let pdf;
  try {
    pdf = await wc.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: 'A4' });
  } catch {
    wc.print({ printBackground: true }); // valt terug op het gewone afdrukscherm
    return;
  }
  const title = (wc.getTitle() || 'ADONIS').replace(/ · ADONIS$/, '').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 80) || 'ADONIS';
  const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'adonis-afdruk-'));
  const file = path.join(dir, `${title}.pdf`); // deze naam krijgt de PDF ook bij "Opslaan"
  fs.writeFileSync(file, pdf);
  const v = new BrowserWindow({
    parent, width: 1100, height: 820, title: `Afdrukvoorbeeld – ${title}`, icon: ICON, autoHideMenuBar: true, backgroundColor: '#28292c',
    webPreferences: { plugins: true, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  v.on('page-title-updated', (e) => e.preventDefault());
  v.on('closed', () => fs.rm(dir, { recursive: true, force: true }, () => {}));
  v.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  v.loadFile(file);
}
ipcMain.handle('adonis:print', (e) => {
  if (!sameOrigin(e.senderFrame.url)) return;
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) return printPreview(w);
});

/* ---------------- zelf bijwerken ----------------
 * Een klein venster rechtsonder in ADONIS toont de voortgang van het downloaden en vraagt daarna om opnieuw te starten.
 * Het neemt de toetsenbordfocus niet over (je kunt gewoon doortypen) en schuift mee met het hoofdvenster. */
let toast = null;
let pendingRestart = false; // "Nu opnieuw starten": pas als het venster echt dicht is (niet-opgeslagen werk wordt eerst gevraagd)
let toastTimer = null;
let lastState = null;
const TOAST_W = 380;
function toastHeight(state) { return state === 'klaar' ? 132 : state === 'fout' ? 112 : 100; }
function placeToast() {
  if (!toast || toast.isDestroyed() || !win || win.isDestroyed()) return;
  const b = win.getContentBounds();
  const h = toastHeight(lastState && lastState.state);
  toast.setBounds({ x: Math.round(b.x + b.width - TOAST_W - 12), y: Math.round(b.y + b.height - h - 12), width: TOAST_W, height: h });
}
function showToast(state, { autoHide = 0 } = {}) {
  lastState = state;
  clearTimeout(toastTimer);
  if (!win || win.isDestroyed()) return;
  if (!toast || toast.isDestroyed()) {
    toast = new BrowserWindow({
      parent: win, width: TOAST_W, height: toastHeight(state.state), frame: false, transparent: true, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: false, show: false, hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    toast.loadFile(path.join(__dirname, 'update.html'));
    toast.webContents.once('did-finish-load', () => { if (lastState) toast.webContents.send('adonis:update-state', lastState); placeToast(); toast.showInactive(); });
    toast.on('closed', () => { toast = null; });
  } else {
    toast.webContents.send('adonis:update-state', state);
    placeToast();
    if (!toast.isVisible()) toast.showInactive();
  }
  // De vraag om opnieuw te starten moet je kunnen aanklikken (ook met het toetsenbord).
  toast.setFocusable(state.state === 'klaar');
  if (autoHide) toastTimer = setTimeout(hideToast, autoHide);
}
function hideToast() {
  clearTimeout(toastTimer);
  if (toast && !toast.isDestroyed()) toast.close();
}
async function checkUpdate(byHand = false) {
  if (byHand) showToast({ state: 'bezig' });
  const r = await updater.check(config.url, (m) => console.log('  ' + m), {
    onStart: (version, total) => showToast({ state: 'download', version, received: 0, total }),
    onProgress: (received, total) => { if (lastState && lastState.state === 'download') showToast({ ...lastState, received, total }); },
  });
  if (r.state === 'bijgewerkt' || (byHand && r.state === 'klaar')) {
    showToast({ state: 'klaar', version: r.version });
  } else if (r.state === 'fout') {
    console.log('  ADONIS-app bijwerken: ' + r.error);
    // Mislukt tijdens de download (of met de hand gevraagd): even laten zien; anders stil later opnieuw.
    if (byHand || (lastState && lastState.state === 'download')) showToast({ state: 'fout', error: r.error }, { autoHide: 12000 });
  } else if (byHand) {
    if (r.state === 'actueel') showToast({ state: 'actueel', version: app.getVersion() }, { autoHide: 4000 });
    else if (r.state === 'geen-portable') showToast({ state: 'fout', error: 'bijwerken kan alleen met ADONIS-app.exe' }, { autoHide: 6000 });
    else hideToast();
  }
}
ipcMain.handle('adonis:update-restart', (e) => {
  if (!toast || e.sender !== toast.webContents) return;
  pendingRestart = true;
  hideToast();
  win.close(); // vraagt eerst bij niet-opgeslagen werk; daarna 'closed' -> opnieuw starten met de nieuwe versie
});
// Vanuit de ADONIS-pagina (na een update van de server): nu even kijken. Alleen de eigen server, en niet te vaak.
let lastAsked = 0;
ipcMain.handle('adonis:update-check', (e) => {
  if (!win || e.sender !== win.webContents || !sameOrigin(e.senderFrame.url)) return;
  if (Date.now() - lastAsked < 10000) return;
  lastAsked = Date.now();
  setTimeout(() => checkUpdate(), 1500);
});
ipcMain.handle('adonis:update-hide', (e) => {
  if (!toast || e.sender !== toast.webContents) return;
  hideToast();
});

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
    // Websites uit het Portaal: geen camera, microfoon, locatie e.d.
    session.fromPartition('persist:portaal').setPermissionRequestHandler((wc, permission, callback) => callback(false));
    buildMenu();
    updater.cleanup();
    createWindow();
    // Een update die al klaarstaat (gedownload, nog niet geplaatst): meteen weer vragen.
    if (updater.pendingVersion()) setTimeout(() => showToast({ state: 'klaar', version: updater.pendingVersion() }), 2500);
    // Kort na het starten, daarna elke 30 seconden: de server werkt zichzelf live bij, en de app volgt die versie.
    // (Dat is alleen een klein vraagje aan de eigen server; downloaden gebeurt pas als er echt iets nieuws is.)
    setTimeout(() => checkUpdate(), Number(process.env.ADONIS_APP_UPDATE_DELAY || 6000));
    setInterval(() => checkUpdate(), Number(process.env.ADONIS_APP_UPDATE_EVERY || 30000));
  });
  app.on('window-all-closed', () => app.quit());
  // Bij het afsluiten: een klaargezette update op zijn plek zetten (pas dan is de .exe vrij).
  app.on('will-quit', () => { try { updater.applyOnExit(false); } catch (err) { console.log('  Bijwerken bij afsluiten: ' + err.message); } });
}

module.exports = { normalizeUrl }; // voor tests
