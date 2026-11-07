'use strict';
/* Wordt als eerste geladen (in <head>), vóór de pagina getekend wordt.
 * --clock: gedeelde klok voor doorlopende animaties, zodat ze na het wisselen van pagina verdergaan
 *          waar ze waren in plaats van opnieuw te beginnen.
 * nav-internal: binnen ADONIS genavigeerd -> geen opstartanimatie (die is alleen voor de eerste keer). */
(function () {
  var d = document.documentElement;
  d.style.setProperty('--clock', ((Date.now() / 1000) % 86400).toFixed(3));
  try {
    if (document.referrer && new URL(document.referrer).origin === location.origin) d.classList.add('nav-internal');
  } catch (e) { /* geen verwijzer */ }
})();
