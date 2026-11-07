'use strict';
/**
 * Automatisch bijwerken: kijkt bij GitHub of er een nieuwere release is en vervangt dan het
 * eigen programmabestand. Alleen actief in de losse executable (niet bij `npm start`).
 *
 * Veiligheid: het nieuwe bestand moet de juiste grootte hebben én met `--version` het verwachte
 * versienummer teruggeven voordat het oude wordt vervangen. Bij elke fout blijft de huidige
 * versie gewoon draaien.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { isSea } = require('./config');
const VERSION = require('./version');

const DEFAULT_REPO = 'huzzysnuzzy/adonis';

function assetName() {
  if (process.platform === 'win32' && process.arch === 'x64') return 'werkopdrachten.exe';
  if (process.platform === 'linux' && process.arch === 'x64') return 'werkopdrachten-linux-x64';
  if (process.platform === 'linux' && process.arch === 'arm64') return 'werkopdrachten-linux-arm64';
  return null;
}

/** Vergelijk "1.2.3" met "1.10.0": >0 als a nieuwer is. */
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** Hernoemen, met nieuwe pogingen: op Windows houdt de virusscanner een net gedownload bestand even vast (EBUSY). */
async function renameRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      if (attempt >= 20 || !['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/** Oude bestanden van een vorige update opruimen (Windows kan een draaiend .exe niet verwijderen). */
function cleanupOld() {
  for (const suffix of ['.old', '.download']) {
    try { fs.rmSync(process.execPath + suffix, { force: true }); } catch { /* nog in gebruik */ }
  }
}

async function latestRelease(repo) {
  const url = process.env.WERKOPDRACHTEN_UPDATE_API || `https://api.github.com/repos/${repo}/releases/latest`;
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'werkopdrachten-updater' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`GitHub antwoordde met ${res.status}`);
  return res.json();
}

/**
 * Zoek naar een update en installeer die.
 * @returns {Promise<{updated: boolean, version?: string, message: string}>}
 */
async function checkAndInstall({ repo = DEFAULT_REPO, log = () => {} } = {}) {
  if (!isSea()) return { updated: false, message: 'Bijwerken werkt alleen in het losse programma (niet vanuit de broncode).' };
  const name = assetName();
  if (!name) return { updated: false, message: `Geen updates beschikbaar voor ${process.platform}-${process.arch}.` };
  cleanupOld();

  const release = await latestRelease(repo);
  const latest = String(release.tag_name || '').replace(/^v/, '');
  if (!latest || compareVersions(latest, VERSION) <= 0) {
    return { updated: false, message: `Up-to-date (v${VERSION}).` };
  }
  const asset = (release.assets || []).find((a) => a.name === name);
  if (!asset) return { updated: false, message: `Release v${latest} heeft geen ${name}.` };

  log(`  Nieuwe versie gevonden: v${latest} (nu v${VERSION}). Downloaden...`);
  const exe = process.execPath;
  const tmp = exe + '.download';
  const res = await fetch(asset.browser_download_url, {
    headers: { 'User-Agent': 'werkopdrachten-updater' },
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!res.ok || !res.body) throw new Error(`download mislukt (${res.status})`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp, { mode: 0o755 }));

  try {
    const size = fs.statSync(tmp).size;
    if (asset.size && size !== asset.size) throw new Error(`onvolledige download (${size} van ${asset.size} bytes)`);
    fs.chmodSync(tmp, 0o755);
    // Controleren dat het nieuwe programma echt start en de verwachte versie is.
    const reported = execFileSync(tmp, ['--version'], {
      timeout: 60000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, WERKOPDRACHTEN_HOME: path.dirname(exe) },
    }).trim();
    if (reported !== latest) throw new Error(`nieuw programma meldt versie "${reported}" in plaats van ${latest}`);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }

  if (process.platform === 'win32') {
    // Een draaiend .exe mag wel hernoemd worden, niet overschreven.
    fs.rmSync(exe + '.old', { force: true });
    await renameRetry(exe, exe + '.old');
    try {
      await renameRetry(tmp, exe);
    } catch (err) {
      await renameRetry(exe + '.old', exe); // terugzetten
      throw err;
    }
  } else {
    await renameRetry(tmp, exe); // het draaiende proces houdt het oude bestand tot het stopt
  }
  return { updated: true, version: latest, message: `Bijgewerkt naar v${latest}.` };
}

/* ---------- Updatestatus voor de voettekst ---------- */
const status = { state: 'onbekend', latest: null, latestDate: null, checkedAt: null };

/** Alleen kijken of er een nieuwere versie is (niets downloaden). */
async function checkStatus(repo = DEFAULT_REPO) {
  try {
    const release = await latestRelease(repo);
    const latest = String(release.tag_name || '').replace(/^v/, '');
    status.latest = latest || null;
    status.latestDate = release.published_at ? String(release.published_at).slice(0, 10) : null;
    status.state = latest && compareVersions(latest, VERSION) > 0 ? 'update' : 'actueel';
  } catch {
    status.state = 'offline';
  }
  status.checkedAt = new Date();
  return status;
}

/** Bij het starten en daarna elke 6 uur controleren. */
function startStatusChecks(repo) {
  if (!isSea()) {
    status.state = 'ontwikkel';
    return;
  }
  checkStatus(repo);
  setInterval(() => checkStatus(repo), 6 * 60 * 60 * 1000).unref();
}

function getStatus() {
  return status;
}

module.exports = { checkAndInstall, compareVersions, assetName, DEFAULT_REPO, checkStatus, startStatusChecks, getStatus };
