'use strict';
/* Thema Black Ice (ICE·XVIII):
 *  - opstarten: het ijs ontdooit van binnen naar buiten, eenmaal per tabblad (early.js zet data-boot="1")
 *  - glinstering onder de muis (alleen transform, alleen met muis, niet bij Rustig/minder beweging)
 *  - bij binnenkomst via een link "kristalliseren" de rijen en de titel (kort .ice-entering) */
(function () {
  var root = document.documentElement;
  if (root.getAttribute('data-theme') !== 'ice') return;
  var still = function () {
    return root.getAttribute('data-fx') === 'calm'
      || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  };

  /* ---------- opstarten ---------- */
  var LINES = ['ICE·XVIII', 'druk 190 GPa · stabiel', 'ionenstroom · actief'];
  var timers = [];
  function reveal() { if (root.getAttribute('data-boot') === '1') root.setAttribute('data-boot', '2'); }
  function end() {
    timers.forEach(clearTimeout);
    timers = [];
    reveal();
    var box = document.querySelector('.ice-boot');
    if (box) box.remove();
    root.removeAttribute('data-boot');
    removeEventListener('keydown', end, true);
    removeEventListener('pointerdown', end, true);
  }
  function boot() {
    if (root.getAttribute('data-boot') !== '1') return;
    var box = document.createElement('div');
    box.className = 'ice-boot';
    box.setAttribute('aria-hidden', 'true');
    var ring = document.createElement('i');
    ring.className = 'ice-boot-ring';
    var log = document.createElement('div');
    log.className = 'ice-boot-log';
    LINES.forEach(function (text, i) {
      var p = document.createElement('p');
      p.textContent = text;
      p.style.setProperty('--i', i);
      log.append(p);
    });
    box.append(ring, log);
    document.body.append(box);
    timers.push(setTimeout(reveal, 620), setTimeout(end, 1300));
    addEventListener('keydown', end, true);
    addEventListener('pointerdown', end, true);
  }

  /* ---------- glinstering onder de muis ---------- */
  function glint() {
    var el = document.querySelector('.ice-field .ice-glint');
    if (!el || !window.matchMedia || !window.matchMedia('(pointer: fine)').matches) return;
    var x = 0, y = 0, queued = false;
    function draw() {
      queued = false;
      el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    }
    addEventListener('pointermove', function (e) {
      if (still()) return;
      x = e.clientX; y = e.clientY;
      if (!root.hasAttribute('data-glint')) root.setAttribute('data-glint', '');
      if (!queued) { queued = true; requestAnimationFrame(draw); }
    }, { passive: true });
    document.addEventListener('pointerleave', function () { root.removeAttribute('data-glint'); });
  }

  /* ---------- binnenkomst ---------- */
  function entering() {
    if (still() || root.hasAttribute('data-boot') || !root.classList.contains('nav-internal')) return;
    root.classList.add('ice-entering');
    setTimeout(function () { root.classList.remove('ice-entering'); }, 1000);
  }

  function start() { boot(); glint(); entering(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
