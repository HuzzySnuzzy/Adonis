'use strict';
/* Bureaubladmodus: ADONIS-pagina's als vensters die je kunt verslepen, vergroten/verkleinen, minimaliseren en
 * maximaliseren, met een taakbalk, een startmenu en een klok. Elk venster is een gewone ADONIS-pagina in een
 * <iframe> (die verbergt zelf zijn menubalk, zie early.js), dus alles werkt daarin zoals altijd.
 * Welke vensters open staan en waar, onthoudt deze computer (localStorage). */
(function () {
  const desk = document.querySelector('[data-desktop]');
  if (!desk) return;
  // In een venster genest, of op een telefoon/tablet: gewone weergave.
  if (window.top !== window) { location.replace('/start'); return; }
  if (matchMedia('(max-width: 900px), (pointer: coarse) and (max-width: 1200px)').matches) { location.replace('/start?klassiek=1'); return; }

  const layer = desk.querySelector('[data-windows]');
  const tasks = document.querySelector('[data-tasks]');
  const menu = document.querySelector('[data-menu]');
  const startBtn = document.querySelector('[data-start]');
  const KEY = 'adonis-desktop-' + desk.dataset.user;
  const svgs = {};
  document.getElementById('dt-icon-svgs').content.querySelectorAll('[data-k]').forEach((s) => { svgs[s.dataset.k] = s.innerHTML; });
  const ICON_FOR = [[/^\/werkopdracht\/nieuw/, 'plus'], [/^\/werkopdracht/, 'list'], [/^\/klant/, 'people'], [/^\/apk/, 'calendar'], [/^\/bandenhotel\/wissellijst/, 'swap'],
    [/^\/bandenhotel/, 'tyre'], [/^\/voorraad/, 'box'], [/^\/portaal/, 'grid'], [/^\/ai-analyse/, 'ai'], [/^\/importeren/, 'camera'], [/^\/hulp/, 'help'], [/^\/$/, 'people']];
  const iconFor = (url) => (ICON_FOR.find(([re]) => re.test(url)) || [null, 'grid'])[1];

  const wins = new Map(); // id -> { el, frame, task, st }
  let topZ = 10; let seq = 0; let active = null;

  /* ---------- opslaan / terugzetten ---------- */
  let saveT = null;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      const list = [...wins.values()].sort((a, b) => a.st.z - b.st.z).map((w) => w.st);
      try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* geen opslag */ }
    }, 200);
  }
  const area = () => desk.getBoundingClientRect();

  /* ---------- een venster ---------- */
  function open(url, opts = {}) {
    url = url || '/start';
    const a = area();
    const n = wins.size;
    const st = Object.assign({
      id: 'w' + (++seq) + '-' + Date.now().toString(36), url, title: 'ADONIS',
      // Rechts van de pictogrammen beginnen (die blijven zo bereikbaar), elk volgend venster iets verschoven.
      w: Math.min(1100, Math.round((a.width - 120) * 0.8)), h: Math.min(760, Math.round(a.height * 0.82)),
      x: 120 + (n % 6) * 34, y: 20 + (n % 6) * 30, max: false, min: false, z: ++topZ,
    }, opts);
    const el = document.createElement('section');
    el.className = 'dw';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', st.title);
    el.innerHTML = `<header class="dw-bar"><span class="dw-ico" aria-hidden="true"></span><span class="dw-title"></span>
        <span class="dw-btns"><button type="button" class="dw-btn dw-min" title="Minimaliseren" aria-label="Minimaliseren"><i></i></button><button type="button" class="dw-btn dw-max" title="Maximaliseren" aria-label="Maximaliseren"><i></i></button><button type="button" class="dw-btn dw-close" title="Sluiten" aria-label="Sluiten"><i></i></button></span></header>
      <div class="dw-body"><iframe title="Venster" loading="eager"></iframe><div class="dw-loading"><span class="spinner"></span></div></div>
      <i class="dw-grip" aria-hidden="true"></i>`;
    const frame = el.querySelector('iframe');
    const task = document.createElement('button');
    task.type = 'button'; task.className = 'dt-task'; task.setAttribute('role', 'listitem');
    task.innerHTML = '<span class="dt-task-ico" aria-hidden="true"></span><span class="dt-task-title"></span>';
    tasks.append(task);
    layer.append(el);
    const w = { el, frame, task, st };
    wins.set(st.id, w);
    setTitle(w, st.title, st.url);
    place(w);
    frame.addEventListener('load', () => onLoad(w));
    frame.src = st.url;
    // Bediening
    el.querySelector('.dw-close').addEventListener('click', () => close(w));
    el.querySelector('.dw-min').addEventListener('click', () => minimize(w, true));
    el.querySelector('.dw-max').addEventListener('click', () => maximize(w, !st.max));
    el.querySelector('.dw-bar').addEventListener('dblclick', (e) => { if (!e.target.closest('.dw-btn')) maximize(w, !st.max); });
    el.addEventListener('pointerdown', () => focus(w), true);
    task.addEventListener('click', () => { if (active === w && !st.min) minimize(w, true); else { minimize(w, false); focus(w); } });
    task.addEventListener('auxclick', (e) => { if (e.button === 1) close(w); });
    drag(w); resize(w);
    if (st.min) minimize(w, true, true); else focus(w);
    save();
    return w;
  }
  function setTitle(w, title, url) {
    const t = (title || 'ADONIS').replace(/\s*·\s*ADONIS$/, '');
    w.st.title = t;
    w.el.querySelector('.dw-title').textContent = t;
    w.el.setAttribute('aria-label', t);
    w.task.querySelector('.dt-task-title').textContent = t;
    w.task.title = t;
    const ico = svgs[iconFor(url || w.st.url)] || '';
    w.el.querySelector('.dw-ico').innerHTML = ico;
    w.task.querySelector('.dt-task-ico').innerHTML = ico;
  }
  function onLoad(w) {
    w.el.classList.add('is-loaded');
    let doc = null;
    try { doc = w.frame.contentDocument; } catch { /* ander adres */ }
    if (!doc) return;
    const loc = w.frame.contentWindow.location;
    // Uitgelogd of iets dat geen venster mag zijn (het bureaublad zelf): opvangen.
    if (loc.pathname === '/bureaublad') { w.frame.src = '/start'; return; }
    w.st.url = loc.pathname + loc.search + loc.hash;
    setTitle(w, doc.title, w.st.url);
    // Titelwijzigingen in het venster volgen (bijv. na live bijwerken).
    try { new MutationObserver(() => setTitle(w, doc.title, w.st.url)).observe(doc.querySelector('title'), { childList: true }); } catch { /* geen titel */ }
    save();
  }
  function place(w) {
    const { el, st } = w;
    el.classList.toggle('is-max', st.max);
    if (st.max) { el.style.left = '0px'; el.style.top = '0px'; el.style.width = '100%'; el.style.height = '100%'; return; }
    const a = area();
    st.w = Math.max(320, Math.min(st.w, a.width)); st.h = Math.max(200, Math.min(st.h, a.height));
    st.x = Math.max(-st.w + 120, Math.min(st.x, a.width - 120)); st.y = Math.max(0, Math.min(st.y, a.height - 40));
    el.style.left = st.x + 'px'; el.style.top = st.y + 'px'; el.style.width = st.w + 'px'; el.style.height = st.h + 'px';
  }
  function focus(w) {
    if (active === w && w.st.z === topZ) return;
    w.st.z = ++topZ;
    w.el.style.zIndex = w.st.z;
    wins.forEach((o) => { o.el.classList.toggle('is-active', o === w); o.task.classList.toggle('is-active', o === w); });
    active = w;
    save();
  }
  function minimize(w, yes, quiet) {
    w.st.min = yes;
    w.el.hidden = yes;
    w.task.classList.toggle('is-min', yes);
    if (yes && active === w) {
      active = null; w.el.classList.remove('is-active'); w.task.classList.remove('is-active');
      const next = [...wins.values()].filter((o) => !o.st.min).sort((a, b) => b.st.z - a.st.z)[0];
      if (next && !quiet) focus(next);
    }
    save();
  }
  function maximize(w, yes) { w.st.max = yes; place(w); focus(w); save(); }
  function dirty(w) {
    try { const cw = w.frame.contentWindow; return (cw.adonisOrderDirty && cw.adonisOrderDirty()) || (cw.adonisFormDirty && cw.adonisFormDirty()); } catch { return false; }
  }
  function close(w, force) {
    if (!force && dirty(w) && !confirm(`"${w.st.title}" heeft wijzigingen die nog niet zijn opgeslagen. Venster toch sluiten?`)) return false;
    try { w.frame.contentWindow.adonisLeaving = true; } catch { /* al weg */ }
    w.el.remove(); w.task.remove(); wins.delete(w.st.id);
    if (active === w) { active = null; const next = [...wins.values()].filter((o) => !o.st.min).sort((a, b) => b.st.z - a.st.z)[0]; if (next) focus(next); }
    save();
    return true;
  }

  /* ---------- slepen en vergroten (iframes vangen anders de muis af) ---------- */
  function track(e, onMove, onEnd) {
    document.documentElement.classList.add('dt-busy');
    const move = (ev) => onMove(ev);
    const up = () => { document.documentElement.classList.remove('dt-busy'); removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); onEnd(); };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }
  function drag(w) {
    const bar = w.el.querySelector('.dw-bar');
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.dw-btn')) return;
      e.preventDefault();
      const a = area();
      let sx = e.clientX; let sy = e.clientY;
      if (w.st.max) { // gemaximaliseerd venster lostrekken: het blijft onder de muis
        const ratio = (e.clientX - a.left) / a.width;
        w.st.max = false; w.st.x = Math.round(e.clientX - a.left - w.st.w * ratio); w.st.y = 0; place(w);
      }
      const ox = w.st.x; const oy = w.st.y;
      track(e, (ev) => { w.st.x = ox + ev.clientX - sx; w.st.y = oy + ev.clientY - sy; place(w); },
        save);
      // Bovenrand = maximaliseren (zoals in Windows)
      const snap = (ev) => { if (ev.clientY - a.top < 4) { w.st.y = 0; maximize(w, true); } removeEventListener('pointerup', snap); };
      addEventListener('pointerup', snap);
    });
  }
  function resize(w) {
    w.el.querySelector('.dw-grip').addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || w.st.max) return;
      e.preventDefault();
      const sx = e.clientX; const sy = e.clientY; const ow = w.st.w; const oh = w.st.h;
      track(e, (ev) => { w.st.w = ow + ev.clientX - sx; w.st.h = oh + ev.clientY - sy; place(w); }, save);
    });
  }
  // Klik in een venster (iframe) haalt dat venster naar voren.
  addEventListener('blur', () => setTimeout(() => {
    const f = document.activeElement;
    if (f && f.tagName === 'IFRAME') { const w = [...wins.values()].find((o) => o.frame === f); if (w) focus(w); }
  }, 0));
  addEventListener('resize', () => wins.forEach(place));

  /* ---------- pictogrammen, startmenu, taakbalk ---------- */
  function launch(url, newOne) {
    // Al open (zelfde pagina)? Dan dat venster naar voren, tenzij Ctrl/Shift.
    const same = !newOne && [...wins.values()].find((o) => o.st.url.split('#')[0] === url);
    if (same) { minimize(same, false); focus(same); return; }
    open(url);
  }
  desk.querySelectorAll('.dt-icon').forEach((b) => {
    b.addEventListener('dblclick', (e) => launch(b.dataset.open, e.ctrlKey || e.shiftKey));
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); launch(b.dataset.open, e.ctrlKey || e.shiftKey); } });
    b.addEventListener('click', () => { desk.querySelectorAll('.dt-icon.is-sel').forEach((x) => x.classList.remove('is-sel')); b.classList.add('is-sel'); });
  });
  desk.addEventListener('pointerdown', (e) => { if (!e.target.closest('.dt-icon')) desk.querySelectorAll('.dt-icon.is-sel').forEach((x) => x.classList.remove('is-sel')); });
  const toggleMenu = (show) => { menu.hidden = !show; startBtn.setAttribute('aria-expanded', String(show)); startBtn.classList.toggle('is-open', show); if (show) { const f = menu.querySelector('.dt-menu-item'); if (f) f.focus(); } };
  startBtn.addEventListener('click', () => toggleMenu(menu.hidden));
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && !startBtn.contains(e.target)) toggleMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { toggleMenu(false); startBtn.focus(); } });
  menu.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', (e) => { toggleMenu(false); launch(b.dataset.open, e.ctrlKey || e.shiftKey); }));
  menu.querySelector('[data-closeall]').addEventListener('click', () => { toggleMenu(false); [...wins.values()].forEach((w) => close(w)); });
  menu.querySelector('[data-arrange]').addEventListener('click', () => {
    toggleMenu(false);
    const list = [...wins.values()].filter((w) => !w.st.min);
    if (!list.length) return;
    const a = area(); const cols = Math.ceil(Math.sqrt(list.length)); const rows = Math.ceil(list.length / cols);
    list.forEach((w, i) => { Object.assign(w.st, { max: false, w: Math.floor(a.width / cols), h: Math.floor(a.height / rows), x: (i % cols) * Math.floor(a.width / cols), y: Math.floor(i / cols) * Math.floor(a.height / rows) }); place(w); });
    save();
  });
  // Vanuit een venster: Ctrl+klik of middelste muisknop -> nieuw venster.
  addEventListener('message', (e) => { if (e.origin === location.origin && e.data && typeof e.data.adonisOpen === 'string' && e.data.adonisOpen.startsWith('/')) open(e.data.adonisOpen); });
  // Klok
  const clock = document.querySelector('[data-clock]');
  const tick = () => { const d = new Date(); clock.textContent = d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }); clock.title = d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); };
  tick(); setInterval(tick, 15000);

  /* ---------- terugzetten ---------- */
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(KEY)) || []; } catch { /* niets */ }
  const params = new URLSearchParams(location.search);
  if (saved.length) saved.forEach((st) => open(st.url, { ...st, z: ++topZ }));
  if (params.get('open')) launch(params.get('open'));
  if (!wins.size && !saved.length) document.querySelector('[data-hint]').hidden = false; else document.querySelector('[data-hint]').hidden = true;
  // Het bovenste venster actief maken
  const top = [...wins.values()].filter((w) => !w.st.min).sort((a, b) => b.st.z - a.st.z)[0];
  if (top) focus(top);
  window.adonisDesktop = { open: launch };
  // Links op het bureaublad zelf (bijv. "Bekijken" bij de backupwaarschuwing) openen in een venster.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('.backup-warn a[href], .live-toast a[href]');
    if (!a) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin) return;
    e.preventDefault();
    launch(u.pathname + u.search + u.hash);
  });
  // De tip alleen tonen als er geen vensters open zijn.
  const hint = document.querySelector('[data-hint]');
  new MutationObserver(() => { hint.hidden = wins.size > 0; }).observe(layer, { childList: true });
  window.adonisDesktopDirty = () => [...wins.values()].some(dirty); // voor live.js (niet zomaar herladen na een update)
  // Bij herladen/weggaan: waarschuwen als een venster nog niet-opgeslagen wijzigingen heeft.
  addEventListener('beforeunload', (e) => { if (!window.adonisLeaving && [...wins.values()].some(dirty)) { e.preventDefault(); e.returnValue = ''; } });
})();
