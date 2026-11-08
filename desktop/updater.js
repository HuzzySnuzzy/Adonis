'use strict';
/**
 * De ADONIS-app werkt zichzelf bij.
 *
 * - Vraagt de eigen ADONIS-server welke versie daar draait (/app-versie) en houdt de app op precies die versie:
 *   app en server passen dan altijd bij elkaar. Alleen omhoog, nooit terug.
 * - Downloadt ADONIS-app.exe van die versie, ALLEEN van de vaste GitHub-releases van ADONIS (de server geeft alleen
 *   het versienummer door, nooit een downloadadres).
 * - De draaiende .exe kan niet worden overschreven, maar wel hernoemd: oud -> "ADONIS-app.oud.exe", nieuw -> op
 *   zijn plek. De volgende keer dat ADONIS start is het de nieuwe versie; de oude wordt dan opgeruimd.
 * - Werkt alleen met de "portable" .exe (niet tijdens ontwikkelen), en alleen als de map beschrijfbaar is.
 */
const { app, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const REPO = 'huzzysnuzzy/adonis';
// Alleen voor tests: een ander downloadadres (wie de omgevingsvariabelen kan zetten, kan toch al alles op deze pc).
const BASE = process.env.ADONIS_APP_UPDATE_BASE || `https://github.com/${REPO}/releases/download`;
const MIN_SIZE = process.env.ADONIS_APP_UPDATE_BASE ? 1024 : 20 * 1024 * 1024; // een echte app-exe is veel groter

const num = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || ''));
  return m ? +m[1] * 1e6 + +m[2] * 1e3 + +m[3] : 0;
};

let busy = false;
let installed = null; // versie die klaarstaat voor de volgende start

function exePath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || null;
}
function oldPath(exe) {
  return path.join(path.dirname(exe), path.basename(exe).replace(/\.exe$/i, '') + '.oud.exe');
}

/** Bij het starten: de vorige versie (van een eerdere update) opruimen. */
function cleanup() {
  const exe = exePath();
  if (!exe) return;
  for (const f of [oldPath(exe), exe + '.download']) {
    try { fs.rmSync(f, { force: true }); } catch { /* nog in gebruik: volgende keer */ }
  }
}

/**
 * Controleer en installeer zo nodig. Geeft { state, version?, error? }:
 * 'geen-portable' | 'actueel' | 'klaar' (al geïnstalleerd, wacht op herstart) | 'bijgewerkt' | 'fout'
 */
async function check(serverUrl, log = () => {}) {
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
    const buf = Buffer.from(await dl.arrayBuffer());
    if (buf.length < MIN_SIZE || buf[0] !== 0x4d || buf[1] !== 0x5a) return { state: 'fout', error: 'download is geen geldig programma' };
    fs.writeFileSync(tmp, buf);

    const old = oldPath(exe);
    fs.rmSync(old, { force: true });
    fs.renameSync(exe, old); // mag, ook al draait hij
    try {
      fs.renameSync(tmp, exe);
    } catch (err) {
      fs.renameSync(old, exe); // terugzetten: alles blijft zoals het was
      throw err;
    }
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

/** Opnieuw starten met de nieuwe versie. */
function restartIntoNew() {
  const exe = exePath();
  if (!exe) return;
  app.relaunch({ execPath: exe, args: [] });
  app.quit();
}

module.exports = { check, cleanup, restartIntoNew, num };
