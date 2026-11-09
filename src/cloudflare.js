'use strict';
/**
 * Cloudflare Tunnel automatisch instellen via de Cloudflare API:
 * zone opzoeken, tunnel aanmaken (of hergebruiken), doorsturen naar deze server instellen
 * en een DNS-record (CNAME naar de tunnel) aanmaken. De API-token wordt alleen hiervoor
 * gebruikt en niet opgeslagen.
 */
const API = process.env.WERKOPDRACHTEN_CF_API || 'https://api.cloudflare.com/client/v4';

class CloudflareError extends Error {}

const PERMISSIONS_HELP =
  'De API-token heeft deze rechten nodig: Account → Cloudflare Tunnel → Bewerken, ' +
  'Zone → DNS → Bewerken en Zone → Zone → Lezen (voor de zone van uw domein).';

async function cf(token, method, path, body) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new CloudflareError(`Geen verbinding met Cloudflare (${err.message}). Is er internet?`);
  }
  let json = {};
  try { json = await res.json(); } catch { /* geen JSON */ }
  if (!res.ok || json.success === false) {
    const msg = (json.errors || []).map((e) => `${e.message} (${e.code})`).join('; ') || `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403 || /authenticat|permission|unauthori/i.test(msg)) {
      throw new CloudflareError(`Cloudflare weigert de API-token: ${msg}. ${PERMISSIONS_HELP}`);
    }
    throw new CloudflareError(`Cloudflare gaf een fout: ${msg}`);
  }
  return json.result;
}

function validHostname(h) {
  return /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h);
}

/** Zoek de Cloudflare-zone waar de hostnaam onder valt (adonis.revnet.nl -> revnet.nl). */
async function findZone(token, hostname) {
  const parts = hostname.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const name = parts.slice(i).join('.');
    const zones = await cf(token, 'GET', `/zones?name=${encodeURIComponent(name)}`);
    if (zones && zones.length) return zones[0];
  }
  throw new CloudflareError(
    `Het domein van ${hostname} staat niet in dit Cloudflare-account (of de token mag de zone niet lezen). ` +
    'Voeg het domein eerst toe aan Cloudflare en zet de nameservers bij uw domeinregistrar om.'
  );
}

/**
 * Alles instellen. Geeft { tunnelId, tunnelToken, accountId, zoneId, zoneName } terug.
 * @param {{apiToken: string, hostname: string, port: number, log?: (s: string) => void}} opts
 */
async function setup({ apiToken, hostname, port, log = () => {} }) {
  hostname = String(hostname || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const token = String(apiToken || '').trim();
  if (!validHostname(hostname)) throw new CloudflareError('Vul een geldig (sub)domein in, bijvoorbeeld adonis.revnet.nl.');
  if (!token) throw new CloudflareError('Vul de Cloudflare API-token in.');

  log(`Zone zoeken voor ${hostname}...`);
  const zone = await findZone(token, hostname);
  const accountId = zone.account && zone.account.id;
  if (!accountId) throw new CloudflareError('Kon het Cloudflare-account van deze zone niet bepalen.');

  const name = `adonis-${hostname}`;
  log(`Tunnel "${name}" aanmaken...`);
  const existing = await cf(token, 'GET', `/accounts/${accountId}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`);
  let tunnel = existing && existing[0];
  if (!tunnel) {
    tunnel = await cf(token, 'POST', `/accounts/${accountId}/cfd_tunnel`, { name, config_src: 'cloudflare' });
  }
  const tunnelId = tunnel.id;

  log('Doorsturen naar deze server instellen...');
  await cf(token, 'PUT', `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, {
    config: {
      ingress: [
        // 127.0.0.1 i.p.v. localhost: de server luistert standaard alleen op IPv4.
        { hostname, service: `http://127.0.0.1:${port}`, originRequest: {} },
        { service: 'http_status:404' },
      ],
    },
  });

  log(`DNS-record ${hostname} instellen...`);
  const target = `${tunnelId}.cfargotunnel.com`;
  const records = await cf(token, 'GET', `/zones/${zone.id}/dns_records?name=${encodeURIComponent(hostname)}`);
  const cname = (records || []).find((r) => r.type === 'CNAME');
  const other = (records || []).find((r) => r.type !== 'CNAME');
  if (other) {
    throw new CloudflareError(
      `Er bestaat al een ${other.type}-record voor ${hostname} in Cloudflare. ` +
      'Verwijder dat record of kies een ander subdomein (bijv. werkplaats.revnet.nl).'
    );
  }
  const record = { type: 'CNAME', name: hostname, content: target, proxied: true, comment: 'ADONIS Werkopdrachten (tunnel)' };
  if (cname) await cf(token, 'PUT', `/zones/${zone.id}/dns_records/${cname.id}`, record);
  else await cf(token, 'POST', `/zones/${zone.id}/dns_records`, record);

  const tunnelToken = await cf(token, 'GET', `/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`);
  if (typeof tunnelToken !== 'string' || !tunnelToken) throw new CloudflareError('Kon de tunnelsleutel niet ophalen.');
  return { tunnelId, tunnelToken, accountId, zoneId: zone.id, zoneName: zone.name, hostname };
}

module.exports = { setup, CloudflareError, PERMISSIONS_HELP, validHostname };
