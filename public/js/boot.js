'use strict';
/* Opstartanimatie voor Systeem, Licht, Donker en OLED (Neon en Black Ice hebben een eigen reeks).
 * early.js zet data-boot="1" op de eerste pagina van een tabblad (niet bij Effecten: Rustig of "minder beweging").
 * Het ADONIS-logo bouwt zich op, daarna komt de pagina omhoog. Een klik of toets slaat alles over.
 * De pagina zelf verschijnt via CSS ook zonder dit script (de animatie eindigt altijd zichtbaar). */
(function () {
  var root = document.documentElement;
  var theme = root.getAttribute('data-theme');
  if (theme === 'neon' || theme === 'ice') return;
  if (root.getAttribute('data-boot') !== '1') return;
  var timer = null;

  function end() {
    clearTimeout(timer);
    var box = document.querySelector('.app-boot');
    if (box) box.remove();
    root.removeAttribute('data-boot');
    removeEventListener('keydown', end, true);
    removeEventListener('pointerdown', end, true);
  }

  function start() {
    if (root.getAttribute('data-boot') !== '1') return;
    var box = document.createElement('div');
    box.className = 'app-boot';
    box.setAttribute('aria-hidden', 'true');
    var logo = document.createElement('div');
    logo.className = 'app-boot-logo';
    var mark = document.querySelector('.logo .logo-mark');
    if (mark) logo.append(mark.cloneNode(true));
    var text = document.createElement('div');
    text.className = 'app-boot-text';
    var word = document.createElement('div');
    word.className = 'app-boot-word';
    'ADONIS'.split('').forEach(function (ch, i) {
      var s = document.createElement('span');
      s.textContent = ch;
      s.style.setProperty('--i', i);
      word.append(s);
    });
    var sub = document.createElement('div');
    sub.className = 'app-boot-sub';
    sub.textContent = 'Werkopdrachten';
    text.append(word, sub);
    logo.append(text);
    box.append(logo);
    document.body.append(box);
    timer = setTimeout(end, 1400);
    addEventListener('keydown', end, true);
    addEventListener('pointerdown', end, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
