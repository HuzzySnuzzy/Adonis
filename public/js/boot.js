'use strict';
/* Opstartanimatie voor Systeem, Licht, Donker, OLED en VCDS (Neon en Black Ice hebben een eigen reeks).
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
    var box = document.querySelector('.app-boot, .vcds-boot, .w98-boot, .olympus-boot, .aero-boot');
    if (box) box.remove();
    root.removeAttribute('data-boot');
    removeEventListener('keydown', end, true);
    removeEventListener('pointerdown', end, true);
  }

  /* VCDS: een klassiek "verbinding maken"-venster met een blokjesbalk. */
  function startVcds(w98) {
    var mark = document.querySelector('.logo .logo-mark');
    var box = document.createElement('div');
    var pre = w98 ? 'w98-boot' : 'vcds-boot';
    box.className = pre;
    box.setAttribute('aria-hidden', 'true');
    var win = document.createElement('div');
    win.className = pre + '-win';
    var title = document.createElement('div');
    title.className = pre + '-title';
    if (mark) title.append(mark.cloneNode(true));
    title.append(w98 ? 'ADONIS 98' : 'ADONIS \u2013 Verbinden');
    var body = document.createElement('div');
    body.className = pre + '-body';
    if (mark) body.append(mark.cloneNode(true));
    (w98 ? [['ADONIS wordt gestart\u2026', ''], ['Instellingen laden: ', 'OK'], ['Werkplaats-database: ', 'OK']] : [['Interface zoeken\u2026', ''], ['Interface: ', 'gevonden!'], ['Werkplaats-database: ', 'OK']]).forEach(function (l, i) {
      var p = document.createElement('p');
      p.style.setProperty('--i', i);
      p.append(l[0]);
      if (l[1]) { var b = document.createElement('b'); b.textContent = l[1]; p.append(b); }
      body.append(p);
    });
    var bar = document.createElement('div');
    bar.className = pre + '-bar';
    bar.append(document.createElement('i'));
    body.append(bar);
    win.append(title, body);
    box.append(win);
    document.body.append(box);
    timer = setTimeout(end, 1350);
    addEventListener('keydown', end, true);
    addEventListener('pointerdown', end, true);
  }

  /* ADONIS: de zon komt op, de lauwerkrans groeit, de letters worden verguld. */
  function startAdonis() {
    var mark = document.querySelector('.logo .logo-mark');
    var box = document.createElement('div');
    box.className = 'olympus-boot';
    box.setAttribute('aria-hidden', 'true');
    var c = document.createElement('div');
    c.className = 'olympus-boot-c';
    var laurel = document.createElement('img');
    laurel.className = 'olympus-boot-laurel';
    laurel.src = '/static/img/fx/laurel-adonis-v1.svg';
    laurel.alt = '';
    c.append(laurel);
    if (mark) { var m = mark.cloneNode(true); m.setAttribute('class', 'logo-mark olympus-boot-mark'); c.append(m); }
    var word = document.createElement('div');
    word.className = 'olympus-boot-word';
    'ADONIS'.split('').forEach(function (ch, i) {
      var s = document.createElement('span');
      s.textContent = ch;
      s.style.setProperty('--i', i);
      word.append(s);
    });
    var rule = document.createElement('div');
    rule.className = 'olympus-boot-rule';
    var sub = document.createElement('div');
    sub.className = 'olympus-boot-sub';
    sub.textContent = 'Werkopdrachten';
    c.append(word, rule, sub);
    box.append(c);
    document.body.append(box);
    timer = setTimeout(end, 2650);
    addEventListener('keydown', end, true);
    addEventListener('pointerdown', end, true);
  }

  /* Aero: een glazen paneel met "Welkom" en een draaiend ringetje. */
  function startAero() {
    var mark = document.querySelector('.logo .logo-mark');
    var box = document.createElement('div');
    box.className = 'aero-boot';
    box.setAttribute('aria-hidden', 'true');
    var pane = document.createElement('div');
    pane.className = 'aero-boot-pane';
    if (mark) pane.append(mark.cloneNode(true));
    var word = document.createElement('div');
    word.className = 'aero-boot-word';
    word.textContent = 'ADONIS';
    var busy = document.createElement('div');
    busy.className = 'aero-boot-busy';
    var ring = document.createElement('i');
    ring.className = 'aero-boot-ring';
    busy.append(ring, 'Welkom');
    pane.append(word, busy);
    box.append(pane);
    document.body.append(box);
    timer = setTimeout(end, 2300);
    addEventListener('keydown', end, true);
    addEventListener('pointerdown', end, true);
  }

  function start() {
    if (root.getAttribute('data-boot') !== '1') return;
    if (theme === 'vcds') return startVcds(false);
    if (theme === 'w98') return startVcds(true);
    if (theme === 'adonis') return startAdonis();
    if (theme === 'aero') return startAero();
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
