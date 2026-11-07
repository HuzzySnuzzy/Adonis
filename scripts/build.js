'use strict';
/**
 * Bouwt Werkopdrachten als één los uitvoerbaar bestand (Node.js "Single Executable Application").
 *
 *   npm run build                 -> alle doelen
 *   npm run build -- win-x64      -> alleen Windows (.exe)
 *   npm run build -- linux-x64    -> alleen Linux x64 (ook Pterodactyl / Docker)
 *
 * Werkt vanaf Windows, Linux en macOS. Benodigde Node.js-binaries worden automatisch gedownload
 * (zelfde versie als de Node waarmee je bouwt) en gecontroleerd met de officiële SHA-256 sommen.
 * Resultaat staat in dist/.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

// fetch() in Node gebruikt standaard geen HTTPS_PROXY; zo nodig opnieuw starten met proxy-ondersteuning.
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, [__filename, ...process.argv.slice(2)], {
    stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1', NODE_NO_WARNINGS: '1' },
  });
  process.exit(r.status ?? 1);
}

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const WORK = path.join(DIST, '.build');
const CACHE = path.join(ROOT, '.cache', 'node');
const VERSION = process.version; // bijv. v22.23.4
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
// Versie in het programma: uit de release-tag (RELEASE_VERSION=v1.2.0) of anders package.json.
const BUILD_VERSION = (process.env.RELEASE_VERSION || '').replace(/^v/, '') || require('../package.json').version;

const TARGETS = {
  'win-x64': { out: 'werkopdrachten.exe', remote: 'win-x64/node.exe' },
  'linux-x64': { out: 'werkopdrachten-linux-x64', remote: `node-${VERSION}-linux-x64.tar.xz` },
  'linux-arm64': { out: 'werkopdrachten-linux-arm64', remote: `node-${VERSION}-linux-arm64.tar.xz` },
};

const [major, minor] = VERSION.slice(1).split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Node ${VERSION} is te oud om te bouwen; gebruik Node 22.13 of nieuwer.`);
  process.exit(1);
}

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const targets = wanted.length ? wanted : Object.keys(TARGETS);
for (const t of targets) {
  if (!TARGETS[t]) {
    console.error(`Onbekend doel "${t}". Kies uit: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(1);
  }
}

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

/* 1. Alle views/ en public/ bestanden verzamelen om in te bakken. */
function collectAssets() {
  const assets = {};
  for (const dir of ['views', 'public']) {
    for (const file of listFiles(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      assets[rel] = fs.readFileSync(file).toString('base64');
    }
  }
  return assets;
}

/* 2. Alle code + afhankelijkheden + assets bundelen tot één JavaScript-bestand. */
async function bundle() {
  const esbuild = require('esbuild');
  const assets = collectAssets();
  console.log(`• ${Object.keys(assets).length} bestanden (templates, css, js, lettertype) ingebakken`);
  const outfile = path.join(WORK, 'app.cjs');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'main.js')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile,
    legalComments: 'none',
    define: {
      'process.env.WERKOPDRACHTEN_BUILD_VERSION': JSON.stringify(BUILD_VERSION),
      'process.env.WERKOPDRACHTEN_BUILD_DATE': JSON.stringify(new Date().toISOString().slice(0, 10)),
    },
    logLevel: 'warning',
    plugins: [{
      name: 'embedded-assets',
      setup(build) {
        build.onResolve({ filter: /^werkopdrachten:assets$/ }, () => ({ path: 'assets', namespace: 'wo-assets' }));
        build.onLoad({ filter: /.*/, namespace: 'wo-assets' }, () => ({
          contents: 'module.exports = ' + JSON.stringify(assets) + ';',
          loader: 'js',
        }));
      },
    }],
  });
  console.log(`• Gebundeld: ${(fs.statSync(outfile).size / 1024).toFixed(0)} kB JavaScript`);
  return outfile;
}

/* 3. SEA-blob maken. */
function makeBlob(mainFile) {
  const blob = path.join(WORK, 'sea-prep.blob');
  const seaConfig = path.join(WORK, 'sea-config.json');
  fs.writeFileSync(seaConfig, JSON.stringify({
    main: mainFile,
    output: blob,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false, // false = blob werkt op elk platform (cross-build)
  }, null, 2));
  execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });
  return blob;
}

/* 4. Officiële Node-binary voor het doelplatform ophalen (met controle). */
let shasums = null;
async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download mislukt (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
async function nodeBinary(target) {
  const { remote } = TARGETS[target];
  const dir = path.join(CACHE, `${VERSION}-${target}`);
  const bin = path.join(dir, target.startsWith('win') ? 'node.exe' : 'node');
  if (fs.existsSync(bin)) return bin;
  fs.mkdirSync(dir, { recursive: true });
  const base = `https://nodejs.org/dist/${VERSION}/`;
  if (!shasums) shasums = (await download(base + 'SHASUMS256.txt')).toString('utf8');
  const line = shasums.split('\n').find((l) => l.trim().endsWith('  ' + remote));
  if (!line) throw new Error(`Geen controlesom gevonden voor ${remote}`);
  console.log(`• Downloaden: ${base}${remote}`);
  const data = await download(base + remote);
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  if (hash !== line.split(/\s+/)[0]) throw new Error(`Controlesom klopt niet voor ${remote}`);
  if (remote.endsWith('.tar.xz')) {
    const archive = path.join(dir, path.basename(remote));
    fs.writeFileSync(archive, data);
    const inner = `${path.basename(remote, '.tar.xz')}/bin/node`;
    execFileSync('tar', ['-xJf', archive, '-C', dir, '--strip-components=2', inner], { stdio: 'inherit' });
    fs.rmSync(archive);
  } else {
    fs.writeFileSync(bin, data);
  }
  return bin;
}

/* 5. Blob in een kopie van de Node-binary injecteren. */
async function buildTarget(target, blob) {
  const { inject } = require('postject');
  const src = await nodeBinary(target);
  const out = path.join(DIST, TARGETS[target].out);
  fs.rmSync(out, { force: true });
  fs.copyFileSync(src, out);
  fs.chmodSync(out, 0o755);
  await inject(out, 'NODE_SEA_BLOB', fs.readFileSync(blob), { sentinelFuse: FUSE });
  console.log(`✔ ${path.relative(ROOT, out)}  (${(fs.statSync(out).size / 1048576).toFixed(0)} MB)`);
}

(async () => {
  console.log(`Werkopdrachten v${BUILD_VERSION} bouwen met Node ${VERSION} voor: ${targets.join(', ')}`);
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  const main = await bundle();
  const blob = makeBlob(main);
  for (const t of targets) await buildTarget(t, blob);
  fs.rmSync(WORK, { recursive: true, force: true });
  console.log('\nKlaar. Kopieer het bestand uit dist/ naar een eigen map en start het.');
})().catch((err) => {
  console.error('\nBouwen mislukt: ' + err.message);
  process.exit(1);
});
