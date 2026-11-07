'use strict';
/* Wordt als eerste geladen (in <head>), vóór de pagina getekend wordt.
 * --clock:      gedeelde klok voor doorlopende animaties, zodat ze na het wisselen van pagina verdergaan
 *               waar ze waren in plaats van opnieuw te beginnen.
 * nav-internal: binnen ADONIS genavigeerd (geen opstartanimatie; wel de korte "pagina-wissel"-effecten).
 * data-hidden:  tabblad niet zichtbaar -> alle animaties pauzeren (scheelt rekenkracht).
 * data-boot:    opstartanimatie (Effecten: Volledig), eenmaal per tabblad; boot.js, neon.js of ice.js speelt hem af. */
(function () {
  var d = document.documentElement;
  d.style.setProperty('--clock', ((Date.now() / 1000) % 86400).toFixed(3));
  try {
    if (document.referrer && new URL(document.referrer).origin === location.origin) d.classList.add('nav-internal');
  } catch (e) { /* geen verwijzer */ }
  document.addEventListener('visibilitychange', function () { d.toggleAttribute('data-hidden', document.hidden); });

  var still = d.getAttribute('data-fx') === 'calm'
    || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // Opstartanimatie: eenmaal per tabblad, bij elk thema (Neon/Black Ice hebben een eigen reeks).
  var fxTheme = d.getAttribute('data-theme') || 'system';
  if (!still) {
    var seen = '1';
    var bootKey = 'adonis-' + fxTheme + '-boot';
    try { seen = sessionStorage.getItem(bootKey); } catch (e) { /* opslag geblokkeerd */ }
    if (!seen) {
      try { sessionStorage.setItem(bootKey, '1'); } catch (e) { /* opslag geblokkeerd */ }
      d.setAttribute('data-boot', '1');
    }
  }
})();
