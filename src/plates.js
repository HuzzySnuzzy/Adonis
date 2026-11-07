'use strict';
/**
 * Kentekens herkennen en netjes weergeven: Nederlands (geel, met streepjes volgens de sidecode)
 * of Duits (wit, "KLE JB 789" met keurmerken tussen stad en letters). Anders: zoals getypt.
 */

// Nederlandse sidecodes 1–14 (X = letter, 9 = cijfer).
const NL_SIDECODES = new Set([
  'XX-99-99', '99-99-XX', '99-XX-99', 'XX-99-XX', 'XX-XX-99', '99-XX-XX', '99-XXX-9',
  '9-XXX-99', 'XX-999-X', 'X-999-XX', 'XXX-99-X', 'X-99-XXX', '9-XX-999', '999-XX-9',
]);
const shape = (groups) => groups.map((g) => g.replace(/[A-Z]/g, 'X').replace(/\d/g, '9')).join('-');

/** "SB846S" -> ["SB", "846", "S"]: splitsen waar letters en cijfers wisselen (en een blok van 4 in tweeën). */
function splitTransitions(key) {
  let groups = key.match(/[A-Z]+|\d+/g) || [];
  if (groups.length === 2) groups = groups.flatMap((g) => (g.length === 4 ? [g.slice(0, 2), g.slice(2)] : [g]));
  return groups;
}

const DE_CITY = /^[A-ZÄÖÜ]{1,3}$/;
const DE_LETTERS = /^[A-Z]{1,2}$/;
const DE_DIGITS = /^\d{1,4}[EH]?$/;

/**
 * Kenteken -> { country: 'NL' | 'D' | '', text, parts, key }
 *  - NL: text "SB-846-S"
 *  - D:  parts [stad, letters, cijfers], text "KLE-JB 789"
 */
function plateInfo(input) {
  const raw = String(input || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const key = raw.replace(/[^A-Z0-9ÄÖÜ]/g, '');
  if (!key) return { country: '', text: raw, parts: [raw], key };
  const typed = raw.split(/[\s.-]+/).filter(Boolean);

  // Nederlands: precies 6 tekens in een bekende sidecode (zoals getypt, of afgeleid zonder streepjes).
  if (key.length === 6 && /^[A-Z0-9]+$/.test(key)) {
    for (const groups of [typed.length === 3 ? typed : null, splitTransitions(key)]) {
      if (groups && groups.length === 3 && NL_SIDECODES.has(shape(groups))) {
        return { country: 'NL', text: groups.join('-'), parts: groups, key };
      }
    }
  }
  // Duits: stad (1–3 letters), 1–2 letters, 1–4 cijfers (+ E/H), samen hooguit 8 tekens. Scheidingstekens nodig.
  let de = null;
  if (typed.length === 3) de = typed;
  else if (typed.length === 2) {
    const m = /^([A-Z]{1,2})(\d{1,4}[EH]?)$/.exec(typed[1]);
    if (m) de = [typed[0], m[1], m[2]];
  }
  if (de && DE_CITY.test(de[0]) && DE_LETTERS.test(de[1]) && DE_DIGITS.test(de[2]) && de.join('').length <= 8) {
    return { country: 'D', text: `${de[0]}-${de[1]} ${de[2]}`, parts: de, key };
  }
  return { country: '', text: raw, parts: [raw], key };
}

/** Voor opslaan: NL met streepjes volgens de sidecode, D als "KLE-JB-789", anders zoals getypt (hoofdletters). */
function formatPlate(input) {
  const info = plateInfo(input);
  if (info.country) return info.parts.join('-');
  return String(input || '').toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 20);
}

/** Alleen Nederlandse kentekens staan bij de RDW. */
function rdwApplicable(input) {
  const info = plateInfo(input);
  return info.country === 'NL' || (info.country === '' && /^[A-Z0-9]{6}$/.test(info.key));
}

// De twaalf sterren van de Europese vlag (als stipjes; op deze grootte zie je toch geen punten).
const STARS = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * 2 * Math.PI;
  return `<circle cx="${(Math.sin(a) * 6.6).toFixed(2)}" cy="${(-Math.cos(a) * 6.6).toFixed(2)}" r="1.45"/>`;
}).join('');
const STARS_SVG = `<svg class="plate-stars" viewBox="-10 -10 20 20" aria-hidden="true" focusable="false"><g fill="#ffcc00">${STARS}</g></svg>`;

module.exports = { plateInfo, formatPlate, rdwApplicable, STARS_SVG, NL_SIDECODES };
