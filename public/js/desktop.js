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
  const ICON_FOR = [[/^\/werkopdrachten\?status=klaar/, 'euro'], [/^\/werkopdracht\/nieuw/, 'plus'], [/^\/werkopdracht/, 'list'], [/^\/(instellingen|systeem)/, 'gear'], [/^\/gebruikers/, 'people'], [/^\/zoekwoorden/, 'list'], [/^\/klant/, 'people'], [/^\/apk/, 'calendar'], [/^\/bandenhotel\/wissellijst/, 'swap'],
    [/^\/bandenhotel/, 'tyre'], [/^\/voorraad/, 'box'], [/^\/portaal/, 'grid'], [/^\/rekenhulp/, 'calc'], [/^\/verkenner/, 'folder'], [/^\/prullenbak/, 'bin'], [/^\/ai-analyse/, 'ai'], [/^\/importeren/, 'camera'], [/^\/hulp/, 'help'], [/^\/$/, 'people']];
  const iconFor = (url) => (/^https?:/.test(url) ? 'globe' : (ICON_FOR.find(([re]) => re.test(url)) || [null, 'grid'])[1]);
  const localPath = (u) => typeof u === 'string' && u.startsWith('/') && !u.startsWith('//'); // alleen eigen pagina's in een venster
  const INTERNET_HOME = 'https://duckduckgo.com/';
  const inApp = () => !!(window.adonisApp && window.adonisApp.webview);
  /** Wat iemand in de adresbalk typt: een adres (met of zonder https://) of anders een zoekopdracht. */
  function toUrl(t) {
    t = String(t || '').trim();
    if (!t) return null;
    if (/^https?:\/\//i.test(t)) return t;
    if (!/\s/.test(t) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(t)) return 'https://' + t;
    return 'https://duckduckgo.com/?q=' + encodeURIComponent(t);
  }

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
    for (const k of ['x', 'y', 'w', 'h']) st[k] = Number.isFinite(Number(st[k])) ? Number(st[k]) : 100; // bewaarde indeling kan oud/raar zijn
    st.z = Number(st.z) || ++topZ; st.max = !!st.max; st.min = !!st.min;
    const el = document.createElement('section');
    el.className = 'dw';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', st.title);
    el.innerHTML = `<header class="dw-bar"><span class="dw-ico" aria-hidden="true"></span><span class="dw-title"></span>
        <span class="dw-btns"><button type="button" class="dw-btn dw-min" title="Minimaliseren" aria-label="Minimaliseren"><i></i></button><button type="button" class="dw-btn dw-max" title="Maximaliseren" aria-label="Maximaliseren"><i></i></button><button type="button" class="dw-btn dw-close" title="Sluiten" aria-label="Sluiten"><i></i></button></span></header>
      <div class="dw-body">${st.site
    ? '<div class="dw-nav"><button type="button" class="dw-nb" data-nav="back" title="Terug" aria-label="Terug">←</button><button type="button" class="dw-nb" data-nav="fwd" title="Vooruit" aria-label="Vooruit">→</button><button type="button" class="dw-nb" data-nav="reload" title="Opnieuw laden" aria-label="Opnieuw laden">⟳</button><form class="dw-addr-form" data-addr-form><input class="dw-addr" type="text" spellcheck="false" autocomplete="off" enterkeyhint="go" aria-label="Adres of zoekterm" placeholder="Zoek op internet of typ een adres"></form><button type="button" class="dw-nb dw-ext" data-nav="ext" title="In de gewone browser openen">Browser ↗</button></div><div class="dw-view"><webview partition="persist:portaal"></webview></div>'
    : '<iframe title="Venster" loading="eager"></iframe>'}<div class="dw-loading"><span class="spinner"></span></div></div>
      <i class="dw-grip" aria-hidden="true"></i>`;
    if (st.site) el.classList.add('dw-site');
    const frame = el.querySelector(st.site ? 'webview' : 'iframe');
    const task = document.createElement('button');
    task.type = 'button'; task.className = 'dt-task';
    task.innerHTML = '<span class="dt-task-ico" aria-hidden="true"></span><span class="dt-task-title"></span>';
    tasks.append(task);
    layer.append(el);
    const w = { el, frame, task, st };
    wins.set(st.id, w);
    setTitle(w, st.title, st.url);
    place(w, true); maxLabel(w);
    if (st.site) siteView(w); else { frame.name = st.id; frame.addEventListener('load', () => onLoad(w)); } // naam: eigen "terug"-spoor per venster
    frame.src = st.url;
    // Bediening
    el.querySelector('.dw-close').addEventListener('click', () => close(w));
    el.querySelector('.dw-min').addEventListener('click', () => minimize(w, true));
    el.querySelector('.dw-max').addEventListener('click', () => maximize(w, !st.max));
    el.querySelector('.dw-bar').addEventListener('dblclick', (e) => { if (!e.target.closest('.dw-btn')) maximize(w, !st.max); });
    el.addEventListener('pointerdown', () => focus(w), true);
    task.addEventListener('click', () => { if (active === w && !st.min) minimize(w, true); else { minimize(w, false); focus(w); } });
    task.addEventListener('auxclick', (e) => { if (e.button === 1) close(w); });
    task.addEventListener('contextmenu', (e) => { e.preventDefault(); winMenu(w, e.clientX, e.clientY, true); });
    el.querySelector('.dw-bar').addEventListener('contextmenu', (e) => { if (e.target.closest('.dw-btn')) return; e.preventDefault(); winMenu(w, e.clientX, e.clientY); });
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
    // Altijd een vaste maat in pixels geven die het venster volgt: zonder vaste hoogte bleef de pagina in de
    // ADONIS-app soms maar een strook van ~150px hoog (de standaardhoogte van een frame).
    const box = v.parentElement;
    const fitView = () => { v.style.width = box.clientWidth + 'px'; v.style.height = box.clientHeight + 'px'; };
    if (window.ResizeObserver) new ResizeObserver(fitView).observe(box);
    v.addEventListener('did-attach', fitView); v.addEventListener('dom-ready', fitView);
    fitView();
    const short = (u) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + (x.pathname === '/' ? '' : x.pathname) + x.search; } catch { return u; } };
    addr.addEventListener('focus', () => { addr.value = w.st.url; addr.select(); });
    addr.addEventListener('blur', () => { addr.value = short(w.st.url); });
    w.el.querySelector('[data-addr-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      const u = toUrl(addr.value);
      if (!u) return;
      w.st.url = u; addr.blur();
      try { v.loadURL(u); } catch { v.src = u; }
    });
    const show = () => { let u = ''; try { u = v.getURL(); } catch { return; } w.st.url = u; if (document.activeElement !== addr) addr.value = short(u); addr.title = u;
      try { w.el.querySelector('[data-nav=back]').disabled = !v.canGoBack(); w.el.querySelector('[data-nav=fwd]').disabled = !v.canGoForward(); } catch { /* nog niet klaar */ } save(); };
    v.addEventListener('did-stop-loading', () => { w.el.classList.add('is-loaded'); show(); applyScale(w); });
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
  /* Schaal van de inhoud van de vensters (Personaliseren): alles kleiner of groter, zodat er meer in past. */
  function applyScale(w) {
    const z = (typeof look !== 'undefined' && look.scale) || 100;
    try {
      if (w.st.site) w.frame.setZoomFactor(z / 100);
      else { const d = w.frame.contentDocument; if (d) d.documentElement.style.zoom = z === 100 ? '' : String(z / 100); }
    } catch { /* nog niet klaar */ }
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
    applyScale(w);
    // Titelwijzigingen in het venster volgen (bijv. na live bijwerken).
    try { new MutationObserver(() => setTitle(w, doc.title, w.st.url)).observe(doc.querySelector('title'), { childList: true }); } catch { /* geen titel */ }
    save();
  }
  /* fit: het venster helemaal in beeld zetten (bij openen/terugzetten/ander scherm); tijdens slepen mag een rand buiten beeld. */
  function place(w, fit) {
    const { el, st } = w;
    el.classList.toggle('is-max', st.max);
    el.classList.toggle('is-snap', !st.max && !!st.snap);
    if (st.max) { el.style.left = '0px'; el.style.top = '0px'; el.style.width = '100%'; el.style.height = '100%'; return; }
    const a = area();
    // Vastgezet tegen de linker- of rechterrand (zoals Windows): de helft van het scherm. st.x/y/w/h blijven bewaard.
    if (st.snap) { const half = Math.round(a.width / 2); el.style.left = (st.snap === 'right' ? a.width - half : 0) + 'px'; el.style.top = '0px'; el.style.width = half + 'px'; el.style.height = '100%'; return; }
    st.w = Math.max(320, Math.min(st.w, a.width)); st.h = Math.max(200, Math.min(st.h, a.height));
    if (fit) { st.x = Math.min(st.x, Math.max(0, a.width - st.w)); st.y = Math.min(st.y, Math.max(0, a.height - st.h)); }
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
  function maxLabel(w) { const b = w.el.querySelector('.dw-max'); if (!b) return; b.title = w.st.max ? 'Herstellen' : 'Maximaliseren'; b.setAttribute('aria-label', b.title); }
  function maximize(w, yes) { w.st.max = yes; if (yes) w.st.snap = null; place(w); maxLabel(w); focus(w); save(); }
  function snap(w, side) { w.st.max = false; w.st.snap = side; minimize(w, false); place(w); maxLabel(w); focus(w); save(); }
  function dirty(w) {
    try { const cw = w.frame.contentWindow; return (cw.adonisOrderDirty && cw.adonisOrderDirty()) || (cw.adonisFormDirty && cw.adonisFormDirty()); } catch { return false; }
  }
  // Bezig in een venster (venster open, Claude aan het werk, aan het typen): dan niet zomaar alles herladen na een serverupdate.
  function busyIn(w) {
    try {
      const d = w.frame.contentDocument; if (!d) return false;
      if (d.querySelector('dialog[open], .ai-busy:not([hidden])')) return true;
      const el = d.activeElement;
      return !!(el && el.matches && el.matches('textarea, input:not([type=checkbox], [type=radio], [type=button], [type=submit])') && el.value !== el.defaultValue);
    } catch { return false; }
  }
  function close(w, force) {
    if (!force && dirty(w) && !confirm(`"${w.st.title}" heeft wijzigingen die nog niet zijn opgeslagen. Venster toch sluiten?`)) return false;
    try { w.frame.contentWindow.adonisLeaving = true; } catch { /* al weg */ }
    w.el.remove(); w.task.remove(); wins.delete(w.st.id);
    if (active === w) { active = null; const next = [...wins.values()].filter((o) => !o.st.min).sort((a, b) => b.st.z - a.st.z)[0]; if (next) focus(next); }
    save();
    return true;
  }

  /* Voorbeeld van waar het venster komt bij loslaten tegen een rand */
  const preview = document.createElement('div');
  preview.className = 'dt-snap no-print'; preview.hidden = true;
  layer.append(preview);
  function snapPreview(zone) {
    preview.hidden = !zone;
    if (!zone) return;
    preview.style.left = zone === 'right' ? '50%' : '0'; preview.style.top = '0';
    preview.style.width = zone === 'max' ? '100%' : '50%'; preview.style.height = '100%';
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
      let ox = w.st.x; let oy = w.st.y;
      let tearing = w.st.max || !!w.st.snap; // gemaximaliseerd/vastgezet: pas lostrekken als er echt gesleept wordt
      let zone = null;
      track(e, (ev) => {
        if (tearing) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
          tearing = false;
          const ratio = Math.min(1, Math.max(0, (sx - w.el.getBoundingClientRect().left) / w.el.offsetWidth)); // het venster blijft onder de muis
          w.st.max = false; w.st.snap = null; w.st.x = Math.round(ev.clientX - a.left - w.st.w * ratio); w.st.y = 0; maxLabel(w);
          sx = ev.clientX; sy = ev.clientY; ox = w.st.x; oy = 0;
        }
        w.st.x = ox + ev.clientX - sx; w.st.y = oy + ev.clientY - sy; place(w);
        // Tegen een rand: bovenaan = maximaliseren, links/rechts = halve scherm (met een voorbeeld, zoals in Windows).
        zone = ev.clientY - a.top < 4 ? 'max' : ev.clientX - a.left < 6 ? 'left' : a.right - ev.clientX < 6 ? 'right' : null;
        snapPreview(zone);
      }, () => {
        snapPreview(null);
        if (tearing) return;
        if (zone === 'max') { w.st.y = 0; maximize(w, true); } else if (zone) snap(w, zone); else save();
      });
    });
  }
  function resize(w) {
    w.el.querySelector('.dw-grip').addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || w.st.max) return;
      e.preventDefault();
      if (w.st.snap) { // vastgezet venster vergroten: vanaf hoe het nu is
        const r = w.el.getBoundingClientRect(); const a = area();
        Object.assign(w.st, { snap: null, x: r.left - a.left, y: r.top - a.top, w: r.width, h: r.height });
      }
      const sx = e.clientX; const sy = e.clientY; const ow = w.st.w; const oh = w.st.h;
      track(e, (ev) => { w.st.w = ow + ev.clientX - sx; w.st.h = oh + ev.clientY - sy; place(w); }, save);
    });
  }
  // Klik in een venster (iframe) haalt dat venster naar voren.
  addEventListener('blur', () => setTimeout(() => {
    const f = document.activeElement;
    if (f && (f.tagName === 'IFRAME' || f.tagName === 'WEBVIEW')) { const w = [...wins.values()].find((o) => o.frame === f); if (w) focus(w); }
  }, 0));
  addEventListener('resize', () => wins.forEach((w) => place(w, true)));

  /* ---------- pictogrammen, startmenu, taakbalk ---------- */
  function launch(url, newOne) {
    // Internet: een eigen browservenster (in de ADONIS-app); in een gewone browser een nieuw tabblad.
    if (url === 'internet') {
      if (!inApp()) { window.open(INTERNET_HOME, '_blank', 'noopener'); return; }
      open(INTERNET_HOME, { site: true, title: 'Internet' });
      return;
    }
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
  /* Rechtermuisknop op een taakbalkknop of titelbalk: het vertrouwde venstermenu */
  const wmenu = document.createElement('div');
  wmenu.className = 'dt-menu dt-ctx dt-wmenu no-print'; wmenu.setAttribute('role', 'menu'); wmenu.hidden = true;
  document.body.append(wmenu);
  function winMenu(w, x, y, fromTaskbar) {
    const st = w.st;
    const items = [
      ['restore', 'Herstellen', st.min || st.max || st.snap], ['min', 'Minimaliseren', !st.min], ['max', 'Maximaliseren', !st.max],
      ['left', 'Links op het scherm', true], ['right', 'Rechts op het scherm', true], ['-'], ['close', 'Sluiten', true],
    ];
    wmenu.innerHTML = items.map(([k, label, on]) => (k === '-' ? '<div class="dt-menu-sep" role="separator"></div>'
      : `<button type="button" role="menuitem" class="dt-menu-item" data-w="${k}"${on ? '' : ' disabled'}>${label}</button>`)).join('');
    wmenu.hidden = false;
    const mw = wmenu.offsetWidth; const mh = wmenu.offsetHeight;
    wmenu.style.left = Math.max(4, Math.min(x, innerWidth - mw - 6)) + 'px';
    wmenu.style.top = Math.max(4, fromTaskbar ? y - mh - 6 : Math.min(y, innerHeight - mh - 50)) + 'px';
    wmenu.onclick = (e) => {
      const b = e.target.closest('[data-w]'); if (!b) return;
      wmenu.hidden = true;
      const k = b.dataset.w;
      if (k === 'restore') { st.snap = null; minimize(w, false); maximize(w, false); }
      else if (k === 'min') minimize(w, true);
      else if (k === 'max') { minimize(w, false); maximize(w, true); }
      else if (k === 'left' || k === 'right') snap(w, k);
      else if (k === 'close') close(w);
    };
    const first = wmenu.querySelector('button:not(:disabled)'); if (first) first.focus();
  }
  document.addEventListener('pointerdown', (e) => { if (!wmenu.hidden && !wmenu.contains(e.target)) wmenu.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !wmenu.hidden) wmenu.hidden = true; });
  // Bureaublad weergeven (knopje helemaal rechts in de taakbalk): alles minimaliseren, nog eens klikken zet het terug.
  let hiddenByShow = [];
  const showDesk = document.querySelector('[data-showdesk]');
  if (showDesk) showDesk.addEventListener('click', () => {
    const open = [...wins.values()].filter((o) => !o.st.min);
    if (open.length) { hiddenByShow = open.map((o) => o.st.id); open.forEach((o) => minimize(o, true, true)); }
    else { hiddenByShow.map((id) => wins.get(id)).filter(Boolean).forEach((o) => { minimize(o, false); focus(o); }); hiddenByShow = []; }
  });
  // Vanuit een venster: Ctrl+klik of middelste muisknop -> nieuw venster.
  addEventListener('message', (e) => { if (e.origin === location.origin && e.data && localPath(e.data.adonisOpen)) open(e.data.adonisOpen); });
  // Klok
  const clock = document.querySelector('[data-clock]');
  const tick = () => { const d = new Date(); clock.textContent = d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }); clock.title = d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); };
  tick(); setInterval(tick, 15000);

  /* ---------- terugzetten ---------- */
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(KEY)) || []; } catch { /* niets */ }
  if (!Array.isArray(saved)) saved = [];
  saved = saved.filter((st) => st && typeof st === 'object' && typeof st.url === 'string' && (st.site ? /^https?:\/\//.test(st.url) : localPath(st.url)));
  const params = new URLSearchParams(location.search);
  if (saved.length) saved.filter((st) => !st.site || (window.adonisApp && window.adonisApp.webview)).forEach((st) => open(st.url, { ...st, z: ++topZ }));
  if (localPath(params.get('open'))) launch(params.get('open'));
  if (params.has('open')) history.replaceState(null, '', '/bureaublad');
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
  let look = { bg: 'theme', fit: 'cover', size: 'm', scale: 100 };
  try { look = Object.assign(look, JSON.parse(localStorage.getItem(LOOK_KEY)) || {}); } catch { /* standaard */ }
  const cell = () => ({ w: look.size === 'l' ? 112 : look.size === 's' ? 76 : 92, h: look.size === 'l' ? 118 : look.size === 's' ? 80 : 96 });
  let pos = {};
  try { pos = JSON.parse(localStorage.getItem(ICON_KEY)) || {}; } catch { /* standaard */ }
  const rowsFit = () => Math.max(1, Math.floor((area().height - 20) / cell().h));
  const ICON_X0 = 60; // linkerkantlijn: de notitieknop (42px) staat links daarvan
  let shown = {}; // waar elk pictogram nú staat; kan tijdelijk afwijken van de bewaarde plek (bijv. in een klein venster) zonder die te overschrijven
  function layoutIcons(order) {
    const rows = rowsFit(); const taken = new Set();
    // Eerst de pictogrammen met een vaste plek die past, daarna de rest in de eerste vrije plekken.
    const list = order || icons.map((b) => b.dataset.open);
    if (order) pos = {};
    for (const href of list) { const p = pos[href]; if (p && p.r < rows) taken.add(p.c + ',' + p.r); }
    let i = 0; shown = {};
    for (const href of list) {
      let p = pos[href];
      if (!p || p.r >= rows) {
        while (taken.has(Math.floor(i / rows) + ',' + (i % rows))) i++;
        p = { c: Math.floor(i / rows), r: i % rows }; i++;
        if (!pos[href]) pos[href] = p; // nieuw pictogram: deze plek wordt zijn vaste plek
      }
      shown[href] = p; taken.add(p.c + ',' + p.r);
    }
    applyIcons();
  }
  function applyIcons() {
    const c = cell();
    iconList.classList.add('is-free');
    desk.dataset.iconSize = look.size;
    for (const b of icons) { const p = shown[b.dataset.open]; const li = b.parentElement; li.style.left = (ICON_X0 + p.c * (c.w + 6)) + 'px'; li.style.top = (14 + p.r * c.h) + 'px'; }
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
        removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
        if (!moved) return;
        li.classList.remove('is-dragging'); document.documentElement.classList.remove('dt-busy');
        const c = cell();
        const col = Math.max(0, Math.round((li.offsetLeft - ICON_X0) / (c.w + 6)));
        const row = Math.max(0, Math.min(rowsFit() - 1, Math.round((li.offsetTop - 14) / c.h)));
        // Bezet? Dan ruilen.
        const other = Object.keys(shown).find((h) => h !== b.dataset.open && shown[h].c === col && shown[h].r === row);
        if (other) pos[other] = shown[b.dataset.open];
        pos[b.dataset.open] = { c: col, r: row };
        layoutIcons(); saveIcons();
        b.dataset.justMoved = '1'; setTimeout(() => { delete b.dataset.justMoved; }, 400);
      };
      addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
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
  ctx.innerHTML = `<button type="button" role="menuitem" class="dt-menu-item" data-c="new">Nieuwe werkopdracht</button><div class="dt-menu-sep" role="separator"></div>
    <button type="button" role="menuitem" class="dt-menu-item" data-c="naam">Pictogrammen sorteren op naam</button>
    <button type="button" role="menuitem" class="dt-menu-item" data-c="standaard">Pictogrammen in de standaardvolgorde</button>
    <button type="button" role="menuitem" class="dt-menu-item" data-c="schikken">Vensters schikken</button><div class="dt-menu-sep" role="separator"></div>
    <button type="button" role="menuitemradio" class="dt-menu-item" data-c="size-s">Kleine pictogrammen</button>
    <button type="button" role="menuitemradio" class="dt-menu-item" data-c="size-m">Normale pictogrammen</button>
    <button type="button" role="menuitemradio" class="dt-menu-item" data-c="size-l">Grote pictogrammen</button><div class="dt-menu-sep" role="separator"></div>
    <button type="button" role="menuitem" class="dt-menu-item" data-c="personal"><b>Personaliseren…</b></button>`;
  document.body.append(ctx);
  // Pijltjestoetsen, Home en End lopen door een menu heen (startmenu en rechtermuisknopmenu).
  const menuKeys = (m) => m.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = [...m.querySelectorAll('.dt-menu-item')].filter((x) => !x.hidden && x.offsetParent !== null);
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement);
    items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length].focus();
  });
  menuKeys(menu); menuKeys(ctx); menuKeys(wmenu);
  let ctxOpener = null;
  desk.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.dw, .sticky-note')) return;
    e.preventDefault();
    ctxOpener = document.activeElement;
    ctx.querySelectorAll('[data-c^="size-"]').forEach((b) => { const on = b.dataset.c === 'size-' + look.size; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
    ctx.hidden = false;
    const w = ctx.offsetWidth; const h = ctx.offsetHeight;
    ctx.style.left = Math.min(e.clientX, innerWidth - w - 6) + 'px'; ctx.style.top = Math.min(e.clientY, innerHeight - h - 50) + 'px';
    ctx.querySelector('button').focus();
  });
  document.addEventListener('pointerdown', (e) => { if (!ctx.hidden && !ctx.contains(e.target)) ctx.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ctx.hidden) { ctx.hidden = true; if (ctxOpener && ctxOpener.focus) ctxOpener.focus(); } });
  ctx.addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    ctx.hidden = true;
    const c = b.dataset.c;
    if (c === 'new') { const n = desk.querySelector('.dt-icon-new'); if (n) launch(n.dataset.open, true); }
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
  function saveLook() { try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch { /* geen opslag */ } window.adonisDesktopScale = look.scale || 100; applyLook(); }
  window.adonisDesktopScale = look.scale || 100; // early.js in elk venster leest dit vóór de eerste tekening
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
            <button type="button" class="dt-bg dt-bg-img" data-pick-img title="Eigen foto">Eigen foto…</button><input type="file" accept="image/*" hidden data-img>
          </div>
        </fieldset>
        <fieldset class="swap-step" data-fitbox><legend>Foto</legend>
          <label class="swap-choice"><input type="radio" name="fit" value="cover"> <span>Vullen</span></label>
          <label class="swap-choice"><input type="radio" name="fit" value="contain"> <span>Passend</span></label>
          <label class="swap-choice"><input type="radio" name="fit" value="tile"> <span>Naast elkaar</span></label>
          <label class="swap-choice"><input type="radio" name="fit" value="center"> <span>In het midden</span></label>
        </fieldset>
        <fieldset class="swap-step"><legend>Grootte van de vensterinhoud</legend>
          <div class="dt-scale"><input type="range" name="scale" min="60" max="120" step="5" aria-label="Grootte van de vensterinhoud"><output data-scale-out></output></div>
          <p class="muted small">Kleiner = meer past in een venster. Geldt voor alle vensters, ook websites.</p>
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
        if (e.target.closest('[data-pick-img]')) { dlg.querySelector('[data-img]').click(); return; }
        const b = e.target.closest('[data-bg]'); if (!b) return;
        look.bg = b.dataset.bg; saveLook(); mark();
      });
      dlg.addEventListener('change', (e) => {
        if (e.target.name === 'fit') { look.fit = e.target.value; saveLook(); }
        if (e.target.name === 'size') { look.size = e.target.value; saveLook(); layoutIcons(); }
      });
      dlg.addEventListener('input', (e) => {
        if (e.target.name !== 'scale') return;
        look.scale = Number(e.target.value); dlg.querySelector('[data-scale-out]').textContent = look.scale + '%';
        saveLook(); wins.forEach(applyScale);
      });
      dlg.querySelector('[data-img]').addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        const err = dlg.querySelector('[data-err]'); err.hidden = true;
        try {
          // Verkleinen tot schermformaat (scheelt opslag), als JPEG.
          const bmp = await createImageBitmap(f);
          // Verkleinen tot hij in de opslag van de browser past (die is ~5 MB voor alles samen): steeds kleiner tot < 900 kB.
          let data = null;
          for (const [maxW, maxH, q] of [[1920, 1200, 0.82], [1600, 1000, 0.75], [1280, 800, 0.7], [1024, 640, 0.6]]) {
            const scale = Math.min(1, maxW / bmp.width, maxH / bmp.height);
            const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
            cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
            data = cv.toDataURL('image/jpeg', q);
            if (data.length < 900000) break;
          }
          try { localStorage.setItem(IMG_KEY, data); } catch { err.textContent = 'Niet genoeg opslagruimte in de browser voor deze foto. Probeer een kleinere foto, of kies een kleur of verloop.'; err.hidden = false; return; }
          img = data;
          look.bg = 'image'; saveLook(); mark();
        } catch { err.textContent = 'Deze foto kon niet worden gebruikt (geen afbeelding, of te groot om te verwerken).'; err.hidden = false; }
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
    dlg.querySelector('input[name=scale]').value = look.scale || 100;
    dlg.querySelector('[data-scale-out]').textContent = (look.scale || 100) + '%';
  }
  menu.querySelector('[data-arrange]').insertAdjacentHTML('beforebegin', '<button type="button" role="menuitem" class="dt-menu-item" data-personal>Personaliseren…</button>');
  menu.querySelector('[data-personal]').addEventListener('click', () => { toggleMenu(false); personalize(); });
  /* Linker Ctrl los indrukken en loslaten = startmenu (ook als de cursor in een venster staat, zie common.js). */
  let ctrlAlone = false; let ctrlAt = 0;
  addEventListener('keydown', (e) => { if (e.code === 'ControlLeft' && !e.repeat) { ctrlAlone = true; ctrlAt = Date.now(); } else ctrlAlone = false; }, true);
  addEventListener('pointerdown', () => { ctrlAlone = false; }, true);
  addEventListener('wheel', () => { ctrlAlone = false; }, { capture: true, passive: true });
  addEventListener('blur', () => { ctrlAlone = false; });
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
  window.adonisDesktopDirty = () => [...wins.values()].some((w) => dirty(w) || busyIn(w)); // voor live.js (niet zomaar herladen na een update)
  // Bij herladen/weggaan: waarschuwen als een venster nog niet-opgeslagen wijzigingen heeft.
  addEventListener('beforeunload', (e) => { if (!window.adonisLeaving && [...wins.values()].some(dirty)) { e.preventDefault(); e.returnValue = ''; } });
})();
