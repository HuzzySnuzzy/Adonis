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
  // Opzijgezette oude versies van eerdere live updates (Windows): zie installRelease.
  try {
    const dir = path.dirname(process.execPath); const base = path.basename(process.execPath) + '.old-';
    for (const f of fs.readdirSync(dir)) if (f.startsWith(base)) { try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* nog in gebruik */ } }
  } catch { /* map niet leesbaar */ }
}

class RateLimited extends Error {}
/* GitHub staat zonder account 60 vragen per uur toe. Met de ETag van het vorige antwoord krijgen we
 * "304: niets veranderd" terug, en dat telt níet mee. Zo kan er elke paar seconden gekeken worden. */
const cache = { url: null, etag: null, body: null };
async function latestRelease(repo) {
  const url = process.env.WERKOPDRACHTEN_UPDATE_API || `https://api.github.com/repos/${repo}/releases/latest`;
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'werkopdrachten-updater' };
  if (cache.url === url && cache.etag) headers['If-None-Match'] = cache.etag;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (res.status === 304 && cache.body) return cache.body;
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = parseInt(res.headers.get('x-ratelimit-reset'), 10);
    throw Object.assign(new RateLimited('GitHub-limiet bereikt'), { until: reset ? reset * 1000 : Date.now() + 15 * 60 * 1000 });
  }
  if (!res.ok) throw new Error(`GitHub antwoordde met ${res.status}`);
  const body = await res.json();
  Object.assign(cache, { url, etag: res.headers.get('etag'), body });
  return body;
}

/*
 * De nieuwste versie opvragen ZONDER de GitHub-API: github.com/<repo>/releases/latest stuurt door naar
 * .../releases/tag/vX.Y.Z. Daar geldt de API-limiet van 60 per uur niet (die op een gedeeld serveradres,
 * zoals bij Pterodactyl, snel vol zit). Het downloadadres van een bestand ligt vast:
 * github.com/<repo>/releases/download/vX.Y.Z/<bestand>. Lukt de doorverwijzing niet, dan alsnog de API.
 */
async function latestTag(repo) {
  const res = await fetch(`https://github.com/${repo}/releases/latest`, {
    method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': 'werkopdrachten-updater' }, signal: AbortSignal.timeout(8000),
  });
  if (res.status === 429) {
    const wait = (parseInt(res.headers.get('retry-after'), 10) || 300) * 1000;
    throw Object.assign(new RateLimited('GitHub vraagt even te wachten'), { until: Date.now() + wait });
  }
  const m = /\/releases\/tag\/v?(\d+\.\d+\.\d+)\b/.exec(res.headers.get('location') || '');
  if (!m) throw new Error(`GitHub gaf geen versie terug (${res.status})`);
  return m[1];
}
async function getLatest(repo) {
  if (process.env.WERKOPDRACHTEN_UPDATE_API) return latestRelease(repo); // tests
  let version;
  try { version = await latestTag(repo); } catch (err) {
    if (err instanceof RateLimited) throw err;
    return latestRelease(repo); // terugval: de API
  }
  const name = assetName();
  return {
    tag_name: 'v' + version, published_at: null,
    assets: name ? [{ name, size: 0, browser_download_url: `https://github.com/${repo}/releases/download/v${version}/${name}` }] : [],
  };
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

  const release = await getLatest(repo);
  return installRelease(release, { log });
}

/** De nieuwe versie downloaden en controleren terwijl de huidige gewoon blijft draaien; pas daarna het bestand vervangen. */
async function installRelease(release, { log = () => {} } = {}) {
  const name = assetName();
  const latest = String(release.tag_name || '').replace(/^v/, '');
  if (!latest || compareVersions(latest, VERSION) <= 0) {
    return { updated: false, message: `Up-to-date (v${VERSION}).` };
  }
  // Net uitgebracht: de bestanden worden soms nog geüpload. Dan de volgende keer opnieuw.
  const asset = (release.assets || []).find((a) => a.name === name && (!a.state || a.state === 'uploaded'));
  if (!asset) return { updated: false, waiting: true, message: `Release v${latest} heeft (nog) geen ${name}.` };

  log(`  Nieuwe versie gevonden: v${latest} (nu v${VERSION}). Downloaden...`);
  const exe = process.execPath;
  const tmp = exe + '.download';
  const res = await fetch(asset.browser_download_url, {
    headers: { 'User-Agent': 'werkopdrachten-updater' },
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  // Net uitgebracht en het bestand staat er nog niet: gewoon de volgende keer opnieuw (geen fout).
  if (res.status === 404) return { updated: false, waiting: true, message: `v${latest} wordt nog geüpload.` };
  if (!res.ok || !res.body) throw new Error(`download mislukt (${res.status})`);
  const expected = asset.size || Number(res.headers.get('content-length')) || 0;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp, { mode: 0o755 }));

  try {
    const size = fs.statSync(tmp).size;
    if (expected && size !== expected) throw new Error(`onvolledige download (${size} van ${expected} bytes)`);
    if (size < 10 * 1024 * 1024 && !process.env.WERKOPDRACHTEN_UPDATE_API) throw new Error(`download te klein (${size} bytes)`);
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
    // Een draaiend .exe mag wel hernoemd worden, niet overschreven of verwijderd. Na een eerdere live update draait de
    // bewaker nog uit het .old-bestand: dat kan dan niet weg en gaat opzij (cleanupOld ruimt het bij de volgende start op).
    try { fs.rmSync(exe + '.old', { force: true }); } catch { await renameRetry(exe + '.old', `${exe}.old-${Date.now()}`); }
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
    const release = await getLatest(repo);
    const latest = String(release.tag_name || '').replace(/^v/, '');
    status.latest = latest || null;
    status.latestDate = release.published_at ? String(release.published_at).slice(0, 10) : status.latestDate;
    status.state = latest && compareVersions(latest, VERSION) > 0 ? 'update' : 'actueel';
  } catch {
    status.state = 'offline';
  }
  status.checkedAt = new Date();
  return status;
}

/** Bij het starten en daarna elke 6 uur controleren (als er niet automatisch wordt bijgewerkt). */
function startStatusChecks(repo) {
  if (!isSea()) {
    status.state = 'ontwikkel';
    return;
  }
  checkStatus(repo);
  setInterval(() => checkStatus(repo), 6 * 60 * 60 * 1000).unref();
}

/**
 * Terwijl de server draait elke paar seconden kijken of er een nieuwe versie is. Zo ja: eerst downloaden
 * en controleren (de server blijft gewoon werken), daarna onReady(versie) – dan pas herstarten.
 * Zo is ADONIS maar een paar seconden weg in plaats van de hele download lang.
 */
function startLiveUpdates({ repo = DEFAULT_REPO, seconds = 15, log = console.log, onReady }) {
  if (!isSea() || !assetName()) { status.state = isSea() ? status.state : 'ontwikkel'; return null; }
  const every = Math.max(5, seconds) * 1000;
  let lastError = ''; let failedVersion = null; let failedAt = 0; let busy = false; let stopped = false; let timer = null;
  const next = (ms) => { if (!stopped) timer = setTimeout(tick, ms); timer.unref?.(); };
  async function tick() {
    if (busy) return next(every);
    busy = true;
    let wait = every;
    try {
      const release = await getLatest(repo);
      const latest = String(release.tag_name || '').replace(/^v/, '');
      status.latest = latest || null;
      status.latestDate = release.published_at ? String(release.published_at).slice(0, 10) : status.latestDate;
      status.state = latest && compareVersions(latest, VERSION) > 0 ? 'update' : 'actueel';
      status.checkedAt = new Date();
      lastError = '';
      if (status.state === 'update' && !(failedVersion === latest && Date.now() - failedAt < 10 * 60 * 1000)) {
        try {
          const r = await installRelease(release, { log });
          if (r.updated) { stopped = true; busy = false; log(`  v${r.version} staat klaar. ADONIS herstart nu (een paar seconden)...`); return onReady(r.version); }
        } catch (err) {
          failedVersion = latest; failedAt = Date.now();
          log(`  Bijwerken naar v${latest} mislukt: ${err.message}. Over 10 minuten nog een keer; de huidige versie blijft draaien.`);
        }
      }
    } catch (err) {
      if (err instanceof RateLimited) {
        wait = Math.max(every, err.until - Date.now() + 1000);
        if (lastError !== 'limit') log(`  Updates: GitHub-limiet bereikt, weer kijken om ${new Date(err.until).toLocaleTimeString('nl-NL')}.`);
        lastError = 'limit';
      } else {
        status.state = 'offline'; status.checkedAt = new Date();
        if (lastError !== err.message) log(`  Updates: kon niet kijken (${err.message}). Blijft het proberen.`);
        lastError = err.message;
        wait = Math.max(every, 60 * 1000);
      }
    }
    busy = false;
    next(wait);
  }
  next(1000);
  return { stop() { stopped = true; clearTimeout(timer); } };
}

function getStatus() {
  return status;
}

module.exports = { checkAndInstall, installRelease, getLatest, compareVersions, assetName, DEFAULT_REPO, checkStatus, startStatusChecks, startLiveUpdates, getStatus };
