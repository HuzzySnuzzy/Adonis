'use strict';
/**
 * Onderdelen van ADONIS die de beheerder aan of uit kan zetten (Systeem → Onderdelen).
 * Zo kan ADONIS bijvoorbeeld alleen als bandenhotel of alleen voor de voorraad worden gebruikt.
 * Klanten staan altijd aan. Een onderdeel dat uit staat verdwijnt uit menu's en startscherm, en
 * de pagina's ervan zijn niet meer te openen. Er wordt niets verwijderd: weer aanzetten en alles is terug.
 */
const settings = require('./settings');

const FEATURES = [
  { key: 'werkopdrachten', name: 'Werkopdrachten', help: 'Werkopdrachten maken en bijhouden, facturatie, zoekwoorden en het overnemen van papieren werkopdrachten met een foto.' },
  { key: 'bandenhotel', name: 'Bandenhotel', help: 'Banden in opslag, de wissellijst en "op de auto" bij de klant.' },
  { key: 'voorraad', name: 'Voorraad', help: 'Onderdelen en losse banden op voorraad.' },
  { key: 'apk', name: 'APK-lijst', help: 'Wie moet binnenkort naar de APK, met "Gebeld" en een dagelijkse herinnering.' },
  { key: 'portaal', name: 'Portaal', help: 'Websites en leveranciers op één pagina, en "Opzoeken met …" bij een kenteken.' },
  { key: 'rekenhulp', name: 'Rekenhulp', help: 'Band omrekenen, last-/snelheidsindex, DOT-leeftijd, bar/psi, Nm, kW/pk, verbruik, BTW en meer.' },
  { key: 'ai', name: 'AI (Claude)', help: 'AI-analyse van een auto, aandachtspunten en APK-aandachtspunten per model.' },
];
const KEYS = FEATURES.map((f) => f.key);

/** { werkopdrachten: true, bandenhotel: true, ... } – alles staat standaard aan. */
function state() {
  const saved = settings.get('features', {}) || {};
  return Object.fromEntries(KEYS.map((k) => [k, saved[k] !== false]));
}
function save(on) {
  settings.set('features', Object.fromEntries(KEYS.map((k) => [k, !!on[k]])));
}

/**
 * Bij welk onderdeel hoort deze pagina? Geeft een lijst sleutels die ALLEMAAL aan moeten staan,
 * een lijst met { any: [...] } als één ervan genoeg is, of null (altijd bereikbaar).
 */
function required(p) {
  if (/^\/werkopdracht(en)?(\/|$)/.test(p) || /^\/(zoekwoorden|sjablonen)(\/|$)/.test(p)) return ['werkopdrachten'];
  // Importeren: /importeren(/:id) = foto van een werkopdracht; excel en foto's koppelen = bandenhotel/voorraad.
  if (/^\/importeren\/(excel|fotos)(\/|$)/.test(p)) return { any: ['bandenhotel', 'voorraad'] };
  if (/^\/importeren(\/|$)/.test(p)) return ['werkopdrachten'];
  if (/^\/bandenhotel(\/|$)/.test(p) || /^\/klant\/[^/]+\/op-auto$/.test(p)) return ['bandenhotel'];
  if (/^\/voorraad(\/|$)/.test(p) || /^\/onderdeelfoto(\/|$)/.test(p)) return ['voorraad'];
  if (/^\/apk\/modelpunten(\/|$)/.test(p) || /^\/klant\/[^/]+\/apk-model$/.test(p)) return ['ai'];
  if (/^\/apk(\/|$)/.test(p)) return ['apk'];
  if (/^\/portaal(\/|$)/.test(p)) return ['portaal'];
  if (/^\/rekenhulp(\/|$)/.test(p)) return ['rekenhulp'];
  if (/^\/(ai-analyse|ai|aandachtspunt|aandachtspunten)(\/|$)/.test(p) || /^\/klant\/[^/]+\/aandachtspunten$/.test(p)) return ['ai'];
  return null;
}
function allowed(p, on = state()) {
  const r = required(p);
  if (!r) return true;
  return Array.isArray(r) ? r.every((k) => on[k]) : r.any.some((k) => on[k]);
}

/** De "+ Nieuw"-knop: de eerste die aan staat. */
function newAction(on) {
  if (on.werkopdrachten) return { href: '/werkopdracht/nieuw', long: 'Nieuwe werkopdracht', sub: 'Een nieuwe klus invullen' };
  if (on.bandenhotel) return { href: '/bandenhotel/nieuw', long: 'Banden inslaan', sub: 'Een set banden in het bandenhotel zetten' };
  if (on.voorraad) return { href: '/voorraad/nieuw', long: 'Nieuw onderdeel', sub: 'Iets aan de voorraad toevoegen' };
  return null;
}

module.exports = { FEATURES, KEYS, state, save, required, allowed, newAction };
