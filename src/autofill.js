'use strict';
/**
 * Automatisch invullen op de werkopdracht (Systeem → Automatisch invullen, alleen de ADONIS-beheerder):
 * elk hulpje aan/uit, eigen suggesties voor werkzaamheden en onderdelen, en vaste waarden voor nieuwe werkopdrachten.
 */
const settings = require('./settings');

const OPTIONS = [
  ['rdw', 'Kenteken opzoeken bij de RDW', 'Merk/type, APK-datum en datum deel I invullen zodra er een kenteken staat. (De knop RDW blijft altijd werken.)'],
  ['klant', 'Klantgegevens van een bekende auto', 'Naam, adres, telefoon, chassisnummer en alarmcode overnemen van de vorige werkopdracht met dit kenteken.'],
  ['suggesties', 'Suggesties tijdens het typen', 'Onderdelen, werkzaamheden, bandenmaat en -merk uit eerdere werkopdrachten, de voorraad en uw eigen lijst hieronder.'],
  ['waarschuwingen', 'Hints en waarschuwingen', 'Bekende klant, vorige km-stand, APK verloopt, te weinig profiel, servicebeurt lang geleden.'],
  ['monteur', 'Monteur invullen', 'Bij een nieuwe werkopdracht de naam van wie hem maakt.'],
  ['tarief', 'Uurtarief van de vorige werkopdracht', 'Alleen als er hieronder geen vast uurtarief staat.'],
  ['rekenen', 'Uren en begroting voorrekenen', 'Op de achterkant: uren uit van–tot, het bedrag en het totaal van de aantekeningen (als voorstel in de lege vakken).'],
];
const KEYS = OPTIONS.map(([k]) => k);
const MAX_LINES = 300;

function clean(lines) {
  return String(lines || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, MAX_LINES).map((l) => l.slice(0, 160));
}
/** "Omschrijving ; prijs ; onderdeelnummer" (prijs en nummer mogen weg). */
function parsePart(line) {
  const [omschrijving, prijs = '', nr = ''] = line.split(';').map((s) => s.trim());
  return { omschrijving, prijs, nr };
}

function state() {
  const raw = settings.get('autofill', {}) || {};
  const on = Object.fromEntries(KEYS.map((k) => [k, !(raw.on && raw.on[k] === false)]));
  const vast = raw.vast || {};
  return {
    on,
    werk: Array.isArray(raw.werk) ? raw.werk : [],
    onderdelen: Array.isArray(raw.onderdelen) ? raw.onderdelen : [],
    vast: {
      tarief: String(vast.tarief || '').slice(0, 20),
      contact_boven: String(vast.contact_boven || '').slice(0, 20),
      alle_reparaties: ['ja', 'nee'].includes(vast.alle_reparaties) ? vast.alle_reparaties : '',
    },
  };
}
function save(body) {
  settings.set('autofill', {
    on: Object.fromEntries(KEYS.map((k) => [k, body['af_' + k] === 'on'])),
    werk: clean(body.werk),
    onderdelen: clean(body.onderdelen),
    vast: { tarief: String(body.tarief || '').trim(), contact_boven: String(body.contact_boven || '').trim(), alle_reparaties: body.alle_reparaties },
  });
  return state();
}
/** Welke hulpjes staan aan (voor de pagina: data-autofill="rdw klant …"). */
const flags = () => { const s = state(); return KEYS.filter((k) => s.on[k]).join(' ') || 'geen'; };

module.exports = { OPTIONS, KEYS, state, save, flags, parsePart };
