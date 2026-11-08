'use strict';
/**
 * Gedeelde Claude-instellingen: de "inspanning" die de gebruiker kiest en een kostenschatting vooraf.
 *
 * Inspanning = hoe diep Claude nadenkt (API: output_config.effort). Meer inspanning kost meer tokens
 * (denken telt als uitvoer) en duurt langer, maar is grondiger. De schatting is bewust een bandbreedte:
 * hoeveel Claude nadenkt hangt af van de opdracht en is vooraf niet precies te weten.
 */
const MODEL = 'claude-opus-5-5';
// Prijzen per miljoen tokens in USD (invoer, uitvoer) – alleen voor schattingen en het verbruiksoverzicht.
const PRICES = { 'claude-opus-5-5': [4, 20] };
const DEFAULT_PRICE = [5, 25]; // voor een eventueel fallback-model: liever iets te hoog geschat
const EUR_PER_USD = Number(process.env.EUR_PER_USD) || 0.92;

/** Keuzes voor de gebruiker. think = geschatte denk-tokens per aanroep [min, max]. */
const LEVELS = {
  laag: { effort: 'low', label: 'Snel', uitleg: 'Weinig nadenken: snel en goedkoop. Prima voor eenvoudige gevallen.', think: [200, 2500] },
  normaal: { effort: 'medium', label: 'Normaal', uitleg: 'Goede balans tussen kosten en kwaliteit.', think: [1200, 7000] },
  hoog: { effort: 'high', label: 'Grondig', uitleg: 'Denkt het langst na: het beste resultaat, maar duurder en trager.', think: [3500, 18000] },
};
const LEVEL_KEYS = Object.keys(LEVELS);
function level(key, fallback = 'normaal') {
  return LEVELS[key] ? key : fallback;
}

/** Ruwe tokenschatting voor (Nederlandse) tekst. */
function tokensForText(text) {
  return Math.ceil(String(text || '').length / 3.2);
}
function usdOf(model, input, output) {
  const [inP, outP] = PRICES[model] || DEFAULT_PRICE;
  return (input * inP + output * outP) / 1e6;
}
const eur = (usd) => usd * EUR_PER_USD;

/**
 * Schatting per inspanningsniveau.
 * input: invoertokens per aanroep; answer: [min, max] antwoordtokens per aanroep; calls: aantal aanroepen.
 */
function estimate({ input, answer = [300, 1500], calls = 1 }) {
  return LEVEL_KEYS.map((key) => {
    const l = LEVELS[key];
    const lo = calls * usdOf(MODEL, input, answer[0] + l.think[0]);
    const hi = calls * usdOf(MODEL, input, answer[1] + l.think[1]);
    return { key, label: l.label, uitleg: l.uitleg, eurMin: eur(lo), eurMax: eur(hi), seconds: Math.round(calls * (key === 'laag' ? 8 : key === 'normaal' ? 20 : 45)) };
  });
}

/** "€ 0,03" (kleine bedragen met twee decimalen, "< € 0,01" als het minder is). */
function formatEur(n) {
  if (n < 0.005) return '< € 0,01';
  const d = n < 10 ? 2 : 0; // vanaf € 10 hele euro's (min mag nooit groter zijn dan max)
  return '€ ' + n.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function formatRange(a, b) {
  const x = formatEur(a); const y = formatEur(b);
  return x === y ? x : `${x} – ${y.replace('€ ', '')}`;
}

module.exports = { MODEL, PRICES, LEVELS, LEVEL_KEYS, level, tokensForText, usdOf, eur, estimate, formatEur, formatRange, EUR_PER_USD };
