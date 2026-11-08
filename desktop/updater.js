'use strict';
/**
 * De ADONIS-app werkt zichzelf bij.
 *
 * - Vraagt de eigen ADONIS-server welke versie daar draait (/app-versie) en houdt de app op precies die versie:
 *   app en server passen dan altijd bij elkaar. Alleen omhoog, nooit terug.
 * - Downloadt ADONIS-app.exe van die versie, ALLEEN van de vaste GitHub-releases van ADONIS (de server geeft alleen
 *   het versienummer door, nooit een downloadadres).
 * - Windows houdt de draaiende .exe vast (niet te overschrijven of te hernoemen). Daarom komt de nieuwe versie eerst
 *   ernaast te staan ("ADONIS-app.exe.nieuw"); zodra de app sluit, zet een klein hulpje hem op zijn plek
 *   (en start hem meteen bij "Nu opnieuw starten").
 * - Werkt alleen met de "portable" .exe (niet tijdens ontwikkelen), en alleen als de map beschrijfbaar is.
 */
const { app, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const REPO = 'huzzysnuzzy/adonis';
// Alleen voor tests: een ander downloadadres (wie de omgevingsvariabelen kan zetten, kan toch al alles op deze pc).
const BASE = process.env.ADONIS_APP_UPDATE_BASE || `https://github.com/${REPO}/releases/download`;
const MIN_SIZE = process.env.ADONIS_APP_UPDATE_BASE ? 1024 : 20 * 1024 * 1024; // een echte app-exe is veel groter

const num = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || ''));
  return m ? +m[1] * 1e6 + +m[2] * 1e3 + +m[3] : 0;
};

let busy = false;
let installed = null; // versie die klaarstaat (naast de .exe) en bij het sluiten wordt geplaatst
let applied = false;

function exePath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || null;
}
const stagedPath = (exe) => exe + '.nieuw';
const stateFile = () => path.join(app.getPath('userData'), 'update-klaar.json');

/** Bij het starten: oude resten opruimen; een eerder gedownloade versie die nog wacht, weer klaarzetten. */
function cleanup() {
  const exe = exePath();
  if (!exe) return;
  for (const f of [path.join(path.dirname(exe), path.basename(exe).replace(/\.exe$/i, '') + '.oud.exe'), exe + '.download']) {
    try { fs.rmSync(f, { force: true }); } catch { /* nog in gebruik: volgende keer */ }
  }
  try {
    const st = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (fs.existsSync(stagedPath(exe)) && num(st.version) > num(app.getVersion())) installed = st.version;
    else { fs.rmSync(stagedPath(exe), { force: true }); fs.rmSync(stateFile(), { force: true }); }
  } catch { /* niets klaar */ }
}
function pendingVersion() { return installed; }

/**
 * De klaargezette versie op zijn plek zetten zodra deze app is afgesloten (en de .exe dus vrij is).
 * relaunch: daarna de nieuwe versie starten.
 */
function applyOnExit(relaunch) {
  const exe = exePath();
  if (!exe || !installed || applied) return false;
  applied = true;
  const src = stagedPath(exe);
  try { fs.rmSync(stateFile(), { force: true }); } catch { /* niets */ }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adonis-update-'));
  if (process.platform === 'win32') {
    const bat = path.join(dir, 'bijwerken.cmd');
    fs.writeFileSync(bat, [
      '@echo off',
      `set "SRC=${src}"`,
      `set "DST=${exe}"`,
      'set /a N=0',
      ':retry',
      'move /y "%SRC%" "%DST%" >nul 2>&1',
      'if not errorlevel 1 goto done',
      'set /a N+=1',
      'if %N% geq 180 goto end',
      'ping -n 2 127.0.0.1 >nul',
      'goto retry',
      ':done',
      relaunch ? 'start "" "%DST%"' : 'rem niet opnieuw starten',
      ':end',
      '(goto) 2>nul & del "%~f0"',
    ].join('\r\n'));
    spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', bat], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else {
    const sh = path.join(dir, 'bijwerken.sh');
    const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
    fs.writeFileSync(sh, [
      `n=0; until mv -f ${q(src)} ${q(exe)} 2>/dev/null; do n=$((n+1)); [ $n -ge 180 ] && exit 1; sleep 1; done`,
      relaunch && !process.env.ADONIS_APP_TEST_NORELAUNCH ? `chmod +x ${q(exe)}; ${q(exe)} >/dev/null 2>&1 &` : ':',
      `rm -rf ${q(dir)}`,
    ].join('\n'));
    spawn('/bin/sh', [sh], { detached: true, stdio: 'ignore' }).unref();
  }
  return true;
}

/**
 * Controleer en installeer zo nodig. Geeft { state, version?, error? }:
 * 'geen-portable' | 'actueel' | 'klaar' (al geïnstalleerd, wacht op herstart) | 'bijgewerkt' | 'fout'
 */
async function check(serverUrl, log = () => {}, hooks = {}) {
  const exe = exePath();
  if (!exe) return { state: 'geen-portable' };
  if (installed) return { state: 'klaar', version: installed };
  if (busy || !serverUrl) return { state: 'bezig' };
  busy = true;
  const tmp = exe + '.download';
  try {
    const res = await net.fetch(serverUrl + '/app-versie', { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!res.ok) return { state: 'fout', error: `server antwoordt ${res.status}` };
    const { version } = await res.json();
    if (!num(version)) return { state: 'fout', error: 'onbekende versie' };
    if (num(version) <= num(app.getVersion())) return { state: 'actueel', version };

    log(`ADONIS-app: versie ${version} downloaden (nu ${app.getVersion()})…`);
    const dl = await net.fetch(`${BASE}/v${version}/ADONIS-app.exe`, { signal: AbortSignal.timeout(15 * 60 * 1000) });
    if (!dl.ok) return { state: 'fout', error: `download mislukt (${dl.status})` };
    // In stukjes naar schijf, met voortgang (voor het hoekje rechtsonder).
    const total = Number(dl.headers.get('content-length')) || 0;
    if (hooks.onStart) hooks.onStart(version, total);
    const out = fs.openSync(tmp, 'w');
    let received = 0;
    let head = null;
    let lastTick = 0;
    try {
      const reader = dl.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!head) head = Buffer.from(value.subarray(0, 2));
        fs.writeSync(out, value);
        received += value.length;
        if (hooks.onProgress && Date.now() - lastTick > 150) { lastTick = Date.now(); hooks.onProgress(received, total); }
      }
    } finally {
      fs.closeSync(out);
    }
    if (hooks.onProgress) hooks.onProgress(received, total);
    if (received < MIN_SIZE || !head || head[0] !== 0x4d || head[1] !== 0x5a || (total && received !== total)) {
      fs.rmSync(tmp, { force: true });
      return { state: 'fout', error: 'de download is onvolledig of geen geldig programma' };
    }

    fs.rmSync(stagedPath(exe), { force: true });
    fs.renameSync(tmp, stagedPath(exe));
    fs.writeFileSync(stateFile(), JSON.stringify({ version, at: new Date().toISOString() }));
    installed = version;
    log(`ADONIS-app: versie ${version} staat klaar voor de volgende start.`);
    return { state: 'bijgewerkt', version };
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* niets */ }
    return { state: 'fout', error: err.code === 'EPERM' || err.code === 'EACCES' ? 'de map van ADONIS-app.exe is niet beschrijfbaar' : err.message };
  } finally {
    busy = false;
  }
}

/** Opnieuw starten met de nieuwe versie: na het sluiten zet het hulpje hem op zijn plek en start hem. */
function restartIntoNew() {
  const exe = exePath();
  if (!exe) return;
  if (process.env.ADONIS_APP_TEST_NORELAUNCH) console.log('  (test) opnieuw starten met ' + exe);
  applyOnExit(true);
  app.quit();
}

module.exports = { check, cleanup, restartIntoNew, applyOnExit, pendingVersion, num };
