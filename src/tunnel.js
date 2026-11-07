'use strict';
/**
 * Beheert cloudflared (het verbindingsprogramma van Cloudflare): downloaden, starten, bewaken
 * en automatisch herstarten. cloudflared maakt een uitgaande verbinding met Cloudflare, dus er
 * hoeven geen poorten open te staan.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const BIN_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'bin');
const BIN = path.join(BIN_DIR, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');

function assetName() {
  if (process.platform === 'linux' && process.arch === 'x64') return 'cloudflared-linux-amd64';
  if (process.platform === 'linux' && process.arch === 'arm64') return 'cloudflared-linux-arm64';
  if (process.platform === 'win32' && process.arch === 'x64') return 'cloudflared-windows-amd64.exe';
  return null;
}

const state = {
  status: 'uit', // uit | downloaden | starten | verbonden | verbinding verbroken | fout
  message: '',
  connections: 0,
  hostname: '',
  log: [],
};
let child = null;
let wanted = false;
let restartDelay = 5000;
let restartTimer = null;

function addLog(line) {
  state.log.push(`${new Date().toLocaleTimeString('nl-NL')}  ${line}`);
  if (state.log.length > 30) state.log.shift();
}

async function ensureBinary() {
  if (fs.existsSync(BIN)) return BIN;
  const name = process.env.WERKOPDRACHTEN_CLOUDFLARED_URL ? 'cloudflared' : assetName();
  if (!name) throw new Error(`Cloudflare Tunnel wordt op ${process.platform}-${process.arch} niet automatisch ondersteund.`);
  state.status = 'downloaden';
  state.message = 'cloudflared downloaden (± 40 MB)...';
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const url = process.env.WERKOPDRACHTEN_CLOUDFLARED_URL || `https://github.com/cloudflare/cloudflared/releases/latest/download/${name}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60 * 1000) });
  if (!res.ok || !res.body) throw new Error(`Downloaden van cloudflared mislukt (${res.status}).`);
  const tmp = BIN + '.download';
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp, { mode: 0o755 }));
  fs.chmodSync(tmp, 0o755);
  try {
    execFileSync(tmp, ['--version'], { timeout: 30000, stdio: 'ignore' });
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw new Error('Het gedownloade cloudflared-programma start niet: ' + err.message);
  }
  fs.renameSync(tmp, BIN);
  return BIN;
}

function handleOutput(chunk) {
  for (const raw of String(chunk).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/Registered tunnel connection/i.test(line)) {
      state.connections += 1;
      state.status = 'verbonden';
      state.message = '';
      restartDelay = 5000;
      if (state.connections === 1) console.log(`  [cloudflare] Verbonden: https://${state.hostname}`);
      addLog('Verbinding met Cloudflare gemaakt');
    } else if (/Unregistered tunnel connection|Connection terminated/i.test(line)) {
      state.connections = Math.max(0, state.connections - 1);
      if (state.connections === 0 && state.status === 'verbonden') state.status = 'verbinding verbroken';
      addLog('Verbinding verbroken, opnieuw verbinden...');
    } else if (/\bERR\b|error/i.test(line)) {
      const msg = line.replace(/^\S+\s+ERR\s+/, '').slice(0, 300);
      addLog(msg);
      if (/Unauthorized|invalid token|token.*invalid/i.test(line)) {
        state.status = 'fout';
        state.message = 'Cloudflare weigert de tunnelsleutel. Stel de tunnel opnieuw in.';
      }
    }
  }
}

/** Start cloudflared met de tunnelsleutel en houdt het draaiend. */
async function start({ token, hostname }) {
  wanted = true;
  state.hostname = hostname || '';
  clearTimeout(restartTimer);
  if (child) return;
  try {
    await ensureBinary();
  } catch (err) {
    state.status = 'fout';
    state.message = err.message;
    addLog(err.message);
    console.log(`  [cloudflare] ${err.message}`);
    if (wanted) restartTimer = setTimeout(() => start({ token, hostname }), 60000);
    return;
  }
  if (!wanted || child) return;
  state.status = 'starten';
  state.message = '';
  state.connections = 0;
  addLog('cloudflared starten...');
  child = spawn(BIN, ['tunnel', '--no-autoupdate', 'run'], {
    env: { ...process.env, TUNNEL_TOKEN: token }, // via de omgeving, zodat de sleutel niet in de proceslijst staat
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', handleOutput);
  child.stderr.on('data', handleOutput);
  child.on('error', (err) => {
    state.status = 'fout';
    state.message = 'cloudflared kon niet starten: ' + err.message;
    addLog(state.message);
  });
  child.on('exit', (code) => {
    child = null;
    state.connections = 0;
    if (!wanted) {
      state.status = 'uit';
      return;
    }
    if (state.status !== 'fout') state.status = 'verbinding verbroken';
    addLog(`cloudflared gestopt (code ${code}); opnieuw starten over ${Math.round(restartDelay / 1000)} s`);
    restartTimer = setTimeout(() => start({ token, hostname }), restartDelay);
    restartDelay = Math.min(restartDelay * 2, 5 * 60 * 1000);
  });
}

function stop() {
  wanted = false;
  clearTimeout(restartTimer);
  if (child) {
    try { child.kill(); } catch { /* al gestopt */ }
  }
  state.status = 'uit';
  state.connections = 0;
  state.message = '';
}

/** Wacht (max. ms) tot de tunnel verbonden is. */
function waitConnected(ms) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (state.status === 'verbonden' || state.status === 'fout' || Date.now() - t0 > ms) {
        clearInterval(iv);
        resolve(state.status === 'verbonden');
      }
    }, 300);
  });
}

function getState() {
  return state;
}

module.exports = { start, stop, getState, waitConnected, ensureBinary, assetName };
