'use strict';
/**
 * Toegang tot views/ en public/.
 * - In de losse executable zitten alle bestanden ingebakken (virtuele module "werkopdrachten:assets",
 *   aangemaakt door scripts/build.js).
 * - Tijdens ontwikkeling (npm start) worden ze gewoon van schijf gelezen.
 */
const fs = require('node:fs');
const path = require('node:path');

let embedded = null;
try {
  // eslint-disable-next-line global-require
  embedded = require('werkopdrachten:assets');
} catch {
  embedded = null;
}

const ROOT = path.join(__dirname, '..');
const cache = new Map();

/** Bestand als Buffer, of null. `rel` bijv. "views/order.ejs" of "public/css/app.css". */
function get(rel) {
  rel = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (rel.split('/').includes('..')) return null;
  if (cache.has(rel)) return cache.get(rel);
  let buf = null;
  if (embedded) {
    if (Object.prototype.hasOwnProperty.call(embedded, rel)) buf = Buffer.from(embedded[rel], 'base64');
  } else {
    try {
      buf = fs.readFileSync(path.join(ROOT, rel));
    } catch {
      buf = null;
    }
    // Tijdens ontwikkeling niet cachen, zodat wijzigingen direct zichtbaar zijn.
    return buf;
  }
  cache.set(rel, buf);
  return buf;
}

module.exports = { get, isEmbedded: () => embedded !== null };
