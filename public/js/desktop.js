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
  const iconFor = (url) => (/^https?:/.test(url) ? 'grid' : (ICON_FOR.find(([re]) => re.test(url)) || [null, 'grid'])[1]);

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
      <div class="dw-body">${st.site
    ? '<div class="dw-nav"><button type="button" class="dw-nb" data-nav="back" title="Terug" aria-label="Terug">←</button><button type="button" class="dw-nb" data-nav="fwd" title="Vooruit" aria-label="Vooruit">→</button><button type="button" class="dw-nb" data-nav="reload" title="Opnieuw laden" aria-label="Opnieuw laden">⟳</button><span class="dw-addr"></span><button type="button" class="dw-nb dw-ext" data-nav="ext" title="In de gewone browser openen">Browser ↗</button></div><webview partition="persist:portaal"></webview>'
    : '<iframe title="Venster" loading="eager"></iframe>'}<div class="dw-loading"><span class="spinner"></span></div></div>
      <i class="dw-grip" aria-hidden="true"></i>`;
    if (st.site) el.classList.add('dw-site');
    const frame = el.querySelector(st.site ? 'webview' : 'iframe');
    const task = document.createElement('button');
    task.type = 'button'; task.className = 'dt-task'; task.setAttribute('role', 'listitem');
    task.innerHTML = '<span class="dt-task-ico" aria-hidden="true"></span><span class="dt-task-title"></span>';
    tasks.append(task);
    layer.append(el);
    const w = { el, frame, task, st };
    wins.set(st.id, w);
    setTitle(w, st.title, st.url);
    place(w);
    if (st.site) siteView(w); else frame.addEventListener('load', () => onLoad(w));
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
  /* Website uit het Portaal (alleen in de ADONIS-app): een <webview> met eigen knoppen. */
  function siteView(w) {
    const v = w.frame; const addr = w.el.querySelector('.dw-addr');
    const show = () => { let u = ''; try { u = v.getURL(); } catch { return; } w.st.url = u; try { const x = new URL(u); addr.textContent = x.hostname.replace(/^www\./, '') + x.pathname; } catch { addr.textContent = u; } addr.title = u;
      try { w.el.querySelector('[data-nav=back]').disabled = !v.canGoBack(); w.el.querySelector('[data-nav=fwd]').disabled = !v.canGoForward(); } catch { /* nog niet klaar */ } save(); };
    v.addEventListener('did-stop-loading', () => { w.el.classList.add('is-loaded'); show(); });
    v.addEventListener('did-navigate', show);
    v.addEventListener('did-navigate-in-page', show);
    v.addEventListener('page-title-updated', (e) => setTitle(w, e.title, w.st.url));
    v.addEventListener('focus', () => focus(w));
    w.el.querySelector('.dw-nav').addEventListener('click', (e) => {
      const b = e.target.closest('[data-nav]'); if (!b) return;
      if (b.dataset.nav === 'back') v.goBack(); else if (b.dataset.nav === 'fwd') v.goForward(); else if (b.dataset.nav === 'reload') v.reload();
      else if (b.dataset.nav === 'ext' && window.adonisApp) window.adonisApp.openExternal(v.getURL() || w.st.url);
    });
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
    if (f && (f.tagName === 'IFRAME' || f.tagName === 'WEBVIEW')) { const w = [...wins.values()].find((o) => o.frame === f); if (w) focus(w); }
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
    b.addEventListener('dblclick', (e) => { if (!b.dataset.justMoved) launch(b.dataset.open, e.ctrlKey || e.shiftKey); });
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
  if (saved.length) saved.filter((st) => !st.site || (window.adonisApp && window.adonisApp.webview)).forEach((st) => open(st.url, { ...st, z: ++topZ }));
  if (params.get('open')) launch(params.get('open'));
  if (!wins.size && !saved.length) document.querySelector('[data-hint]').hidden = false; else document.querySelector('[data-hint]').hidden = true;
  // Het bovenste venster actief maken
  const top = [...wins.values()].filter((w) => !w.st.min).sort((a, b) => b.st.z - a.st.z)[0];
  if (top) focus(top);

  /* ---------- pictogrammen verslepen (vastklikken op een raster), sorteren ---------- */
  const iconList = desk.querySelector('.dt-icons');
  const ICON_KEY = KEY + '-icons';
  const LOOK_KEY = KEY + '-look';
  const IMG_KEY = KEY + '-img';
  const icons = [...desk.querySelectorAll('.dt-icon')];
  const defaultOrder = icons.map((b) => b.dataset.open);
  let look = { bg: 'theme', fit: 'cover', size: 'm' };
  try { look = Object.assign(look, JSON.parse(localStorage.getItem(LOOK_KEY)) || {}); } catch { /* standaard */ }
  const cell = () => ({ w: look.size === 'l' ? 112 : look.size === 's' ? 76 : 92, h: look.size === 'l' ? 118 : look.size === 's' ? 80 : 96 });
  let pos = {};
  try { pos = JSON.parse(localStorage.getItem(ICON_KEY)) || {}; } catch { /* standaard */ }
  const rowsFit = () => Math.max(1, Math.floor((area().height - 20) / cell().h));
  function layoutIcons(order) {
    const rows = rowsFit(); const taken = new Set();
    // Eerst de pictogrammen met een vaste plek, daarna de rest in de eerste vrije plekken.
    const list = order || icons.map((b) => b.dataset.open);
    for (const href of list) { const p = pos[href]; if (p && !order) taken.add(p.c + ',' + p.r); }
    let i = 0;
    for (const href of list) {
      let p = !order && pos[href];
      if (!p || p.r >= rows) { while (taken.has(Math.floor(i / rows) + ',' + (i % rows))) i++; p = { c: Math.floor(i / rows), r: i % rows }; i++; }
      pos[href] = p; taken.add(p.c + ',' + p.r);
    }
    applyIcons();
  }
  function applyIcons() {
    const c = cell();
    iconList.classList.add('is-free');
    desk.dataset.iconSize = look.size;
    for (const b of icons) { const p = pos[b.dataset.open]; const li = b.parentElement; li.style.left = (10 + p.c * (c.w + 6)) + 'px'; li.style.top = (14 + p.r * c.h) + 'px'; }
  }
  const saveIcons = () => { try { localStorage.setItem(ICON_KEY, JSON.stringify(pos)); } catch { /* geen opslag */ } };
  layoutIcons();
  addEventListener('resize', () => layoutIcons());
  for (const b of icons) {
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const li = b.parentElement; const sx = e.clientX; const sy = e.clientY; const ox = li.offsetLeft; const oy = li.offsetTop;
      let moved = false;
      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        if (!moved) { moved = true; li.classList.add('is-dragging'); document.documentElement.classList.add('dt-busy'); }
        li.style.left = (ox + ev.clientX - sx) + 'px'; li.style.top = (oy + ev.clientY - sy) + 'px';
      };
      const up = () => {
        removeEventListener('pointermove', move); removeEventListener('pointerup', up);
        if (!moved) return;
        li.classList.remove('is-dragging'); document.documentElement.classList.remove('dt-busy');
        const c = cell();
        const col = Math.max(0, Math.round((li.offsetLeft - 10) / (c.w + 6)));
        const row = Math.max(0, Math.min(rowsFit() - 1, Math.round((li.offsetTop - 14) / c.h)));
        // Bezet? Dan ruilen.
        const other = Object.keys(pos).find((h) => h !== b.dataset.open && pos[h].c === col && pos[h].r === row);
        if (other) pos[other] = pos[b.dataset.open];
        pos[b.dataset.open] = { c: col, r: row };
        applyIcons(); saveIcons();
        b.dataset.justMoved = '1'; setTimeout(() => { delete b.dataset.justMoved; }, 400);
      };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    });
  }
  function sortIcons(how) {
    let order = defaultOrder.slice();
    const name = (h) => icons.find((b) => b.dataset.open === h).querySelector('.dt-icon-name').textContent;
    if (how === 'naam') order = [defaultOrder[0], ...defaultOrder.slice(1).sort((a, b) => name(a).localeCompare(name(b), 'nl'))];
    pos = {}; layoutIcons(order); saveIcons();
  }

  /* ---------- rechtermuisknop op het bureaublad ---------- */
  const ctx = document.createElement('div');
  ctx.className = 'dt-menu dt-ctx no-print'; ctx.setAttribute('role', 'menu'); ctx.hidden = true;
  ctx.innerHTML = `<button type="button" class="dt-menu-item" data-c="new">Nieuwe werkopdracht</button><div class="dt-menu-sep"></div>
    <button type="button" class="dt-menu-item" data-c="naam">Pictogrammen sorteren op naam</button>
    <button type="button" class="dt-menu-item" data-c="standaard">Pictogrammen in de standaardvolgorde</button>
    <button type="button" class="dt-menu-item" data-c="schikken">Vensters schikken</button><div class="dt-menu-sep"></div>
    <button type="button" class="dt-menu-item" data-c="size-s">Kleine pictogrammen</button>
    <button type="button" class="dt-menu-item" data-c="size-m">Normale pictogrammen</button>
    <button type="button" class="dt-menu-item" data-c="size-l">Grote pictogrammen</button><div class="dt-menu-sep"></div>
    <button type="button" class="dt-menu-item" data-c="personal"><b>Personaliseren…</b></button>`;
  document.body.append(ctx);
  desk.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.dw, .sticky-note')) return;
    e.preventDefault();
    ctx.querySelectorAll('[data-c^="size-"]').forEach((b) => b.classList.toggle('is-on', b.dataset.c === 'size-' + look.size));
    ctx.hidden = false;
    const w = ctx.offsetWidth; const h = ctx.offsetHeight;
    ctx.style.left = Math.min(e.clientX, innerWidth - w - 6) + 'px'; ctx.style.top = Math.min(e.clientY, innerHeight - h - 50) + 'px';
    ctx.querySelector('button').focus();
  });
  document.addEventListener('pointerdown', (e) => { if (!ctx.hidden && !ctx.contains(e.target)) ctx.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ctx.hidden = true; });
  ctx.addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    ctx.hidden = true;
    const c = b.dataset.c;
    if (c === 'new') launch('/werkopdracht/nieuw', true);
    else if (c === 'naam' || c === 'standaard') sortIcons(c);
    else if (c === 'schikken') menu.querySelector('[data-arrange]').click();
    else if (c.startsWith('size-')) { look.size = c.slice(5); saveLook(); layoutIcons(); }
    else if (c === 'personal') personalize();
  });

  /* ---------- personaliseren: achtergrond en pictogrammen ---------- */
  const COLORS = ['#008080', '#1d3557', '#2f4f4f', '#5b2a86', '#7a1f2b', '#3a5a40', '#202124', '#c9c5bd'];
  const GRADS = {
    zonsondergang: 'linear-gradient(160deg, #2b1055 0%, #7597de 45%, #ff9a8b 100%)',
    oceaan: 'linear-gradient(160deg, #0f2027 0%, #203a43 45%, #2c5364 100%)',
    zomer: 'linear-gradient(160deg, #56ab2f 0%, #a8e063 100%)',
    werkplaats: 'repeating-linear-gradient(135deg, #2b2f36 0 22px, #30353d 22px 44px)',
    noorderlicht: 'radial-gradient(120% 80% at 20% 0%, #1fd1a1 0%, transparent 55%), radial-gradient(100% 70% at 90% 10%, #7f5af0 0%, transparent 60%), #0b1020',
  };
  let img = null;
  try { img = localStorage.getItem(IMG_KEY); } catch { /* geen opslag */ }
  function saveLook() { try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch { /* geen opslag */ } applyLook(); }
  function applyLook() {
    const st = desk.style;
    st.background = ''; desk.classList.toggle('has-bg', look.bg !== 'theme');
    if (look.bg.startsWith('#')) st.background = look.bg;
    else if (look.bg.startsWith('grad:')) st.background = GRADS[look.bg.slice(5)] || '';
    else if (look.bg === 'image' && img) {
      st.background = `#000 url("${img}") center / ${look.fit === 'tile' ? 'auto' : look.fit === 'center' ? 'auto' : look.fit} ${look.fit === 'tile' ? 'repeat' : 'no-repeat'}`;
    }
    desk.dataset.iconSize = look.size;
  }
  applyLook();
  let dlg = null;
  function personalize() {
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.className = 'swap-dialog dt-personal';
      dlg.innerHTML = `<form method="dialog" class="swap-form">
        <h1>Personaliseren</h1>
        <p class="muted small">Alleen voor u, op deze computer. Het thema (kleuren van de vensters) kiest u bij Instellingen.</p>
        <fieldset class="swap-step"><legend>Achtergrond</legend>
          <div class="dt-bgs">
            <button type="button" class="dt-bg dt-bg-theme" data-bg="theme" title="Van het thema">Thema</button>
            ${COLORS.map((c) => `<button type="button" class="dt-bg" data-bg="${c}" title="${c}"></button>`).join('')}
            ${Object.keys(GRADS).map((k) => `<button type="button" class="dt-bg" data-bg="grad:${k}" title="${k}"></button>`).join('')}
            <label class="dt-bg dt-bg-img" title="Eigen foto"><input type="file" accept="image/*" hidden data-img>Eigen foto…</label>
          </div>
        </fieldset>
        <fieldset class="swap-step" data-fitbox><legend>Foto</legend>
          <label class="swap-choice"><input type="radio" name="fit" value="cover"> <span>Vullen</span></label>
          <label class="swap-choice"><input type="radio" name="fit" value="contain"> <span>Passend</span></label>
          <label class="swap-choice"><input type="radio" name="fit" value="tile"> <span>Naast elkaar</span></label>
          <label class="swap-choice"><input type="radio" name="fit" value="center"> <span>In het midden</span></label>
        </fieldset>
        <fieldset class="swap-step"><legend>Pictogrammen</legend>
          <label class="swap-choice"><input type="radio" name="size" value="s"> <span>Klein</span></label>
          <label class="swap-choice"><input type="radio" name="size" value="m"> <span>Normaal</span></label>
          <label class="swap-choice"><input type="radio" name="size" value="l"> <span>Groot</span></label>
        </fieldset>
        <p class="alert" data-err hidden></p>
        <div class="swap-actions"><button class="btn btn-primary" value="ok" type="submit">Klaar</button></div>
      </form>`;
      document.body.append(dlg);
      // Kleuren via CSSOM (de beveiliging staat geen style-attributen toe).
      dlg.querySelectorAll('.dt-bg[data-bg]').forEach((b) => { const v = b.dataset.bg; if (v.startsWith('#')) b.style.background = v; else if (v.startsWith('grad:')) b.style.background = GRADS[v.slice(5)]; });
      dlg.addEventListener('click', (e) => {
        if (e.target === dlg) dlg.close();
        const b = e.target.closest('[data-bg]'); if (!b) return;
        look.bg = b.dataset.bg; saveLook(); mark();
      });
      dlg.addEventListener('change', (e) => {
        if (e.target.name === 'fit') { look.fit = e.target.value; saveLook(); }
        if (e.target.name === 'size') { look.size = e.target.value; saveLook(); layoutIcons(); }
      });
      dlg.querySelector('[data-img]').addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        const err = dlg.querySelector('[data-err]'); err.hidden = true;
        try {
          // Verkleinen tot schermformaat (scheelt opslag), als JPEG.
          const bmp = await createImageBitmap(f);
          const scale = Math.min(1, 2560 / bmp.width, 1600 / bmp.height);
          const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
          cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
          const data = cv.toDataURL('image/jpeg', 0.82);
          localStorage.setItem(IMG_KEY, data); img = data;
          look.bg = 'image'; saveLook(); mark();
        } catch { err.textContent = 'Deze foto kon niet worden gebruikt (te groot of geen afbeelding).'; err.hidden = false; }
        e.target.value = '';
      });
    }
    mark();
    dlg.showModal();
  }
  function mark() {
    dlg.querySelectorAll('[data-bg]').forEach((b) => b.classList.toggle('is-on', b.dataset.bg === look.bg));
    dlg.querySelector('.dt-bg-img').classList.toggle('is-on', look.bg === 'image');
    dlg.querySelector('[data-fitbox]').hidden = look.bg !== 'image';
    dlg.querySelectorAll('input[name=fit]').forEach((r) => { r.checked = r.value === look.fit; });
    dlg.querySelectorAll('input[name=size]').forEach((r) => { r.checked = r.value === look.size; });
  }
  menu.querySelector('[data-arrange]').insertAdjacentHTML('beforebegin', '<button type="button" role="menuitem" class="dt-menu-item" data-personal>Personaliseren…</button>');
  menu.querySelector('[data-personal]').addEventListener('click', () => { toggleMenu(false); personalize(); });
  /* Linker Ctrl los indrukken en loslaten = startmenu (ook als de cursor in een venster staat, zie common.js). */
  let ctrlAlone = false; let ctrlAt = 0;
  addEventListener('keydown', (e) => { if (e.code === 'ControlLeft' && !e.repeat) { ctrlAlone = true; ctrlAt = Date.now(); } else ctrlAlone = false; }, true);
  addEventListener('pointerdown', () => { ctrlAlone = false; }, true);
  addEventListener('keyup', (e) => { if (e.code === 'ControlLeft' && ctrlAlone && Date.now() - ctrlAt < 800) { ctrlAlone = false; toggleMenu(menu.hidden); } }, true);
  addEventListener('message', (e) => { if (e.origin === location.origin && e.data && e.data.adonisStart) toggleMenu(menu.hidden); });
  // Websites uit het Portaal (common.js): in de ADONIS-app als venster op het bureaublad.
  const openSite = (url, title) => {
    if (!window.adonisApp || !window.adonisApp.webview) { window.open(url, '_blank', 'noopener'); return; }
    if (!/^https?:\/\//i.test(url)) return;
    const same = [...wins.values()].find((o) => o.st.site && o.st.url === url);
    if (same) { minimize(same, false); focus(same); return; }
    open(url, { site: true, title: title || 'Website' });
  };
  window.adonisDesktop = { open: launch, openSite };
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
