'use strict';
/* Thema Neon (stijl gelijk aan DiscordLinked "2049"):
 *  - opstartreeks: sluiters + typend logboek, eenmaal per tabblad (early.js zet data-boot="1")
 *  - zijrails: klok en scroll-"diepte" (alleen op brede schermen)
 *  - paginatitel "decodeert" bij binnenkomst of paginawissel */
(function () {
  var root = document.documentElement;
  if (root.getAttribute('data-theme') !== 'neon') return;
  var still = function () {
    return root.getAttribute('data-fx') === 'calm'
      || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  };

  /* ---------- opstartreeks ---------- */
  var LINES = ['ADONIS/OS 2.049 koude start', 'werkplaats-link .. vergrendeld', 'klantenbestand ... nominaal', 'optiek ........... online'];
  var timers = [];
  function reveal() {
    if (root.getAttribute('data-boot') !== '1') return;
    root.setAttribute('data-boot', '2');
  }
  function end() {
    timers.forEach(clearTimeout);
    timers = [];
    reveal();
    var box = document.querySelector('.hud-boot');
    if (box) box.remove();
    root.removeAttribute('data-boot');
    removeEventListener('keydown', end, true);
    removeEventListener('pointerdown', end, true);
  }
  function boot() {
    if (root.getAttribute('data-boot') !== '1') return;
    var box = document.createElement('div');
    box.className = 'hud-boot';
    box.setAttribute('aria-hidden', 'true');
    var line = document.createElement('i');
    line.className = 'hud-boot-line';
    var log = document.createElement('div');
    log.className = 'hud-boot-log';
    LINES.forEach(function (text, i) {
      var p = document.createElement('p');
      p.textContent = text;
      p.style.setProperty('--i', i);
      p.style.setProperty('--n', text.length);
      log.append(p);
    });
    box.append(line, log);
    document.body.append(box);
    timers.push(setTimeout(reveal, 560), setTimeout(end, 1400));
    // Nooit blokkeren: een toets of klik beëindigt de reeks meteen.
    addEventListener('keydown', end, true);
    addEventListener('pointerdown', end, true);
  }

  /* ---------- zijrails ---------- */
  function rails() {
    var clock = document.querySelector('[data-hud-clock]');
    var depth = document.querySelector('[data-hud-depth]');
    var mark = document.querySelector('.hud-rail-mark');
    var right = document.querySelector('.hud-rail-r');
    if (!clock || !depth) return;
    var wide = window.matchMedia('(min-width: 1400px)');
    var tick = function () {
      if (document.visibilityState === 'visible' && wide.matches) clock.textContent = 'T ' + new Date().toISOString().slice(11, 19) + 'Z';
    };
    var frame = 0;
    var onScroll = function () {
      if (frame || !wide.matches) return;
      frame = requestAnimationFrame(function () {
        frame = 0;
        var max = document.documentElement.scrollHeight - window.innerHeight;
        var p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
        depth.textContent = 'DIEPTE ' + String(Math.round(p * 100)).padStart(3, '0');
        if (mark && right) mark.style.transform = 'translateY(' + Math.round(p * Math.max(0, right.clientHeight - 2)) + 'px)';
      });
    };
    tick();
    onScroll();
    setInterval(tick, 1000);
    addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- titel decoderen ---------- */
  var GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&/<>_=+';
  function decode(node, ms) {
    var text = node && node.firstChild;
    if (!text || text.nodeType !== 3 || !text.data.trim()) return;
    var orig = text.data;
    var start = performance.now();
    var last = 0;
    node.setAttribute('aria-label', orig.trim());
    node.classList.add('hud-decoding');
    var step = function (now) {
      var t = now - start;
      if (t >= ms) {
        text.data = orig;
        node.removeAttribute('aria-label');
        node.classList.remove('hud-decoding');
        return;
      }
      if (now - last >= 33) {
        last = now;
        var out = '';
        for (var i = 0; i < orig.length; i++) {
          var c = orig[i];
          out += (t / ms > i / orig.length || /\s/.test(c)) ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0];
        }
        text.data = out;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function init() {
    boot();
    rails();
    if (!still()) {
      // Paginawissel binnen ADONIS (of eerste binnenkomst): korte scanstraal + titel decoderen.
      root.classList.add('hud-entering');
      setTimeout(function () { root.classList.remove('hud-entering'); }, 900);
      var h1 = document.querySelector('main h1');
      if (h1) decode(h1, 420);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
