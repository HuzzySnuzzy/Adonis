'use strict';
/**
 * Test voor automatisch bijwerken (gebruikt in CI op Windows en Linux).
 *
 *   node scripts/test-update.js <oud-programma> <nieuw-programma> <nieuwe-versie>
 *
 * Start een nep-GitHub die <nieuw-programma> als nieuwste release aanbiedt, start <oud-programma>
 * en controleert dat het zichzelf bijwerkt en daarna als de nieuwe versie draait.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');

const [oldBin, newBin, newVersion] = process.argv.slice(2);
if (!oldBin || !newBin || !newVersion) {
  console.error('Gebruik: node scripts/test-update.js <oud> <nieuw> <versie>');
  process.exit(2);
}
const assetName = path.basename(newBin);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-update-'));
const exe = path.join(dir, path.basename(oldBin));
fs.copyFileSync(oldBin, exe);
fs.chmodSync(exe, 0o755);
fs.writeFileSync(path.join(dir, 'config.properties'), 'port=3611\nopen-browser=false\n');

const gh = http.createServer((req, res) => {
  if (req.url === '/latest') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({
      tag_name: 'v' + newVersion,
      assets: [{ name: assetName, size: fs.statSync(newBin).size, browser_download_url: 'http://127.0.0.1:3998/asset' }],
    }));
  }
  if (req.url === '/asset') {
    res.setHeader('content-length', fs.statSync(newBin).size);
    return fs.createReadStream(newBin).pipe(res);
  }
  res.statusCode = 404;
  res.end();
}).listen(3998, '127.0.0.1');

let out = '';
const child = spawn(exe, [], {
  cwd: dir,
  env: { ...process.env, WERKOPDRACHTEN_UPDATE_API: 'http://127.0.0.1:3998/latest' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
child.stderr.on('data', (d) => { out += d; process.stderr.write(d); });

function fail(msg) {
  console.error('\nTEST MISLUKT: ' + msg);
  try { child.kill(); } catch { /* */ }
  process.exit(1);
}

const deadline = setTimeout(() => fail('server kwam niet op binnen 120 s'), 120000);
const timer = setInterval(async () => {
  if (!out.includes('draait op')) return;
  clearInterval(timer);
  clearTimeout(deadline);
  try {
    const res = await fetch('http://127.0.0.1:3611/login');
    if (res.status !== 200) fail('site gaf status ' + res.status);
    if (!out.includes(`Bijgewerkt naar v${newVersion}`)) fail('geen update-melding');
    if (!out.includes(`Werkopdrachten v${newVersion}\n`) && !out.includes(`Werkopdrachten v${newVersion}\r\n`)) fail('nieuwe versie draait niet');
  } catch (err) {
    fail(err.message);
  }
  child.stdin.write('stop\n');
}, 500);

child.on('exit', (code) => {
  gh.close();
  clearInterval(timer);
  const reported = execFileSync(exe, ['--version'], { cwd: dir, encoding: 'utf8' }).trim();
  if (reported !== newVersion) fail(`bestand meldt ${reported}, verwacht ${newVersion}`);
  if (code !== 0) fail('afgesloten met code ' + code);
  console.log(`\nTEST GESLAAGD: bijgewerkt naar v${newVersion} en netjes gestopt.`);
  process.exit(0);
});
