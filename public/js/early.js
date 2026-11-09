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
  // Zijbalk smal (alleen pictogrammen), zoals de vorige keer gekozen.
  try { if (localStorage.getItem('adonis-side-narrow') === '1') d.classList.add('side-narrow'); } catch (e) { /* geen opslag */ }

  // In een venster van de bureaubladmodus: geen menubalk/voettekst (zie app.css) en geen zware effecten
  // (elk venster is een eigen pagina; anders draaien de achtergronden van het thema tien keer tegelijk).
  var inWin = false;
  try { inWin = window.top !== window && window.top.location.origin === location.origin; } catch (e) { /* ander adres */ }
  if (inWin) {
    d.classList.add('in-window');
    // Geen zijbalk-indeling in een venster (er is daar geen menu); anders schuiven o.a. de notitieknop en de letters mee.
    d.removeAttribute('data-layout');
    d.setAttribute('data-fx', 'calm');
    // Grootte van de vensterinhoud (Personaliseren) meteen toepassen, niet pas als alles geladen is.
    try { var sc = window.top.adonisDesktopScale; if (sc && sc !== 100) d.style.zoom = String(sc / 100); } catch (e) { /* geen bureaublad */ }
    // Uitgelogd: het hele bureaublad naar het inlogscherm, niet alleen dit venster.
    if (location.pathname === '/login' || location.pathname === '/setup') { window.top.location.href = location.pathname; }
  }
  var still = d.getAttribute('data-fx') === 'calm'
    || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // Opstartanimatie: eenmaal per tabblad, bij elk thema (Neon/Black Ice hebben een eigen reeks).
  var fxTheme = d.getAttribute('data-theme') || 'system';
  // Net ingelogd: de eerste pagina daarna speelt hem (opnieuw) af, ook als het inlogscherm hem al liet zien.
  // Bij een fout wachtwoord (terug op /login) niet nog eens.
  var afterLogin = false;
  try {
    if (sessionStorage.getItem('adonis-boot-after-login') && location.pathname !== '/login') {
      sessionStorage.removeItem('adonis-boot-after-login');
      afterLogin = true;
    }
  } catch (e) { /* opslag geblokkeerd */ }
  if (!still) {
    var seen = '1';
    var bootKey = 'adonis-' + fxTheme + '-boot';
    try { seen = sessionStorage.getItem(bootKey); } catch (e) { /* opslag geblokkeerd */ }
    if (!seen || afterLogin) {
      try { sessionStorage.setItem(bootKey, '1'); } catch (e) { /* opslag geblokkeerd */ }
      d.setAttribute('data-boot', '1');
    }
  }
})();
