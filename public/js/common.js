'use strict';
// Inlogscherm: het echte adres zoals dit apparaat het gebruikt (ook achter Cloudflare of een proxy).
document.querySelectorAll('[data-server-url]').forEach((el) => { el.textContent = location.origin; });
// Instellingen → Effecten: laten zien als het apparaat om minder beweging vraagt, en de opstartanimatie opnieuw afspelen.
(function () {
  const note = document.querySelector('[data-fx-reduced]');
  const replay = document.querySelector('[data-replay-boot]');
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (note) note.hidden = !reduced;
  if (!replay) return;
  if (reduced) replay.disabled = true;
  replay.addEventListener('click', () => {
    const fx = document.querySelector('input[name="fx"]:checked');
    if (fx && fx.value === 'calm') { window.alert('Kies eerst "Volledig" en klik op "Instellingen opslaan".'); return; }
    try { Object.keys(sessionStorage).filter((k) => /^adonis-.*-boot$/.test(k)).forEach((k) => sessionStorage.removeItem(k)); } catch { /* geen opslag */ }
    window.adonisLeaving = true;
    location.reload();
  });
})();
// Inloggen: de opstartanimatie hoort bij het binnenkomen, dus de eerste pagina na het inloggen speelt hem af.
document.querySelectorAll('form[action="/login"]').forEach((f) => f.addEventListener('submit', () => {
  try { sessionStorage.setItem('adonis-boot-after-login', '1'); } catch { /* geen opslag */ }
}));
// Wisselen: venster om te kiezen welke banden erop gaan en welke eraf komen.
// Zonder JavaScript opent dezelfde keuze als gewone pagina.
(function () {
  function sync(form) {
    const op = form.querySelector('input[name="op"]:checked');
    const opId = op ? op.value : '';
    form.querySelectorAll('[data-eraf-for]').forEach((lab) => {
      const same = lab.dataset.erafFor === opId;
      const input = lab.querySelector('input');
      lab.hidden = same;
      input.disabled = same;
      if (same && input.checked) {
        input.checked = false;
        const fallback = form.querySelector('input[name="eraf"]:not([disabled])');
        if (fallback) fallback.checked = true;
      }
    });
    const eraf = form.querySelector('input[name="eraf"]:checked');
    const loc = form.querySelector('[data-swap-locatie]');
    if (loc) loc.hidden = !!eraf && eraf.value === 'geen';
  }
  document.addEventListener('change', (e) => {
    const form = e.target.closest('form.swap-form');
    if (form) sync(form);
  });
  document.querySelectorAll('form.swap-form').forEach(sync);

  let dlg = null;
  document.addEventListener('click', async (e) => {
    const link = e.target.closest('a[data-swap]');
    if (!link || e.ctrlKey || e.metaKey || e.shiftKey || !window.HTMLDialogElement) return;
    e.preventDefault();
    try {
      const res = await fetch(link.href, { credentials: 'same-origin' });
      if (!res.ok || res.redirected) throw new Error();
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const form = doc.querySelector('form.swap-form');
      if (!form) throw new Error();
      if (!dlg) {
        dlg = document.createElement('dialog');
        dlg.className = 'swap-dialog';
        dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); }); // klik naast het venster
        document.body.append(dlg);
      }
      dlg.replaceChildren(document.importNode(form, true));
      const f = dlg.querySelector('form');
      sync(f);
      f.querySelector('[data-swap-cancel]').addEventListener('click', (ev) => { ev.preventDefault(); dlg.close(); });
      dlg.showModal();
      const first = f.querySelector('input[name="eraf"]:checked') || f.querySelector('button[type=submit]');
      if (first) first.focus();
    } catch {
      window.location.href = link.href; // dan maar als gewone pagina
    }
  });
})();
// Pictogram van een portaal-website kan niet geladen worden: weglaten (het portaal zelf toont dan een letter).
document.addEventListener('error', (e) => {
  if (e.target instanceof HTMLImageElement && e.target.matches('.plate-site img[data-portal-icon]')) e.target.remove();
}, true);
// ---------- Terug naar de vorige pagina ----------
// ADONIS houdt per tabblad/venster bij welke pagina's u bekeek ("spoor"). De terug-links ("← …") en de terugknop in de app
// gaan daardoor naar de pagina waar u echt vandaan kwam, niet naar een vaste plek.
(function () {
  const KEY = 'adonis-trail';
  const here = () => location.pathname + location.search;
  const read = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { return []; } };
  const write = (t) => { try { sessionStorage.setItem(KEY, JSON.stringify(t.slice(-40))); } catch { /* geen opslag */ } };
  let trail = read();
  let navType = 'navigate';
  try { navType = (performance.getEntriesByType('navigation')[0] || {}).type || 'navigate'; } catch { /* oud */ }
  let wentBack = false;
  try { wentBack = sessionStorage.getItem(KEY + '-back') === '1'; sessionStorage.removeItem(KEY + '-back'); } catch { /* geen opslag */ }
  const url = here();
  if (wentBack || (navType === 'back_forward' && trail[trail.length - 2] === url)) {
    while (trail.length && trail[trail.length - 1] !== url) trail.pop(); // terug: alles na deze pagina vergeten
    if (!trail.length) trail.push(url);
  } else if (navType !== 'reload' && trail[trail.length - 1] !== url) {
    trail.push(url);
  }
  write(trail);
  // Live zoeken verandert het adres zonder nieuwe pagina: dan alleen de laatste stap bijwerken.
  window.adonisTrailReplace = (u) => { trail = read(); trail[trail.length - 1] = u; write(trail); };
  function previous() {
    const t = read();
    // Andere versies van dezelfde pagina (bijv. het bewerkformulier van deze klant) overslaan.
    for (let i = t.length - 2; i >= 0; i--) if (t[i].split('?')[0] !== location.pathname && !/^\/login/.test(t[i])) return t[i];
    return null;
  }
  function goBack(fallback) {
    const prev = previous();
    if (!prev) { if (fallback) location.href = fallback; else if (history.length > 1) history.back(); return; }
    try { sessionStorage.setItem(KEY + '-back', '1'); } catch { /* geen opslag */ }
    const t = read(); while (t.length && t[t.length - 1] !== prev) t.pop(); write(t.concat([]));
    location.href = prev;
  }
  window.adonisBack = goBack;
  // "← …"-links (kruimelpad, "← Terug", "← Klant"): naar waar u vandaan kwam.
  const backLinks = document.querySelectorAll('.crumbs a:first-child, a[data-back-link]');
  const prev = previous();
  backLinks.forEach((a) => {
    if (!prev || !/^←/.test(a.textContent.trim())) return;
    const target = new URL(a.href, location.href);
    if (target.pathname + target.search === prev) return; // gaat al naar de vorige pagina
    a.textContent = '← Terug';
    a.title = 'Terug naar de vorige pagina';
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('.crumbs a:first-child, a[data-back-link], [data-history-back]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    if (a.matches('a') && !/^←/.test(a.textContent.trim())) return;
    e.preventDefault();
    goBack(a.getAttribute('href'));
  });
})();
// Escape: naar het startscherm. Eerst sluit Esc een open venster of menu, en in een invoerveld verlaat Esc eerst het veld.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  // Nu al vastleggen (een venster dat Esc sluit, is na deze toetsaanslag al dicht).
  const busy = e.defaultPrevented || document.querySelector('dialog[open], .theme-menu:not([hidden]), .ai-busy:not([hidden]), .lightbox:not([hidden])');
  const el = document.activeElement;
  const inField = el && el.matches && el.matches('input, textarea, select, [contenteditable="true"]');
  // Pas daarna kijken of een ander deel van de pagina de toets al heeft gebruikt (bijv. een pop-up sluiten).
  setTimeout(() => {
    if (busy || e.defaultPrevented) return;
    if (inField) { el.blur(); return; }
    if (location.pathname === '/start' || location.pathname === '/login') return;
    location.href = '/start';
  }, 0);
});
// Klikbare tabelrijen
document.addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-href]');
  if (!row || e.target.closest('a, button, input, form')) return;
  if (e.ctrlKey || e.metaKey) window.open(row.dataset.href, '_blank');
  else window.location.href = row.dataset.href;
});
// Bevestiging voor verwijderen
document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-confirm]');
  if (form && !window.confirm(form.dataset.confirm)) e.preventDefault();
});
// Keuzelijst die direct opslaat (bijv. rol van een gebruiker)
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-autosubmit]')) e.target.form.requestSubmit();
});
// Zoekveld alleen automatisch selecteren op een computer met muis; op telefoon/tablet zou
// dat meteen het toetsenbord (en de wachtwoordbalk) openen.
if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) {
  const el = document.querySelector('[data-autofocus]');
  if (el) {
    el.focus();
    try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* geen tekstveld */ }
  }
}
// Zoeken terwijl je typt: de lijst eronder wordt meteen bijgewerkt (Enter of "Zoeken" werkt ook nog).
// Alleen de delen met data-live worden vervangen; het zoekveld zelf blijft staan, met de cursor erin.
(function () {
  document.querySelectorAll('form[role="search"]').forEach((form) => {
    const input = form.querySelector('input[name="q"]');
    if (!input || !document.querySelector('[data-live]')) return;
    let timer = null;
    let ctrl = null;
    let last = input.value.trim();
    const run = async () => {
      const q = input.value.trim();
      if (q === last) return;
      last = q;
      const params = new URLSearchParams(new FormData(form));
      if (!q) params.delete('q');
      // Zonder action-attribuut (bijv. de klantpagina) zoekt het formulier op de huidige pagina.
      const target = new URL(form.action || location.href, location.href);
      const remote = target.pathname !== location.pathname; // bijv. startscherm: resultaten van de klantenlijst
      const url = target.pathname + (params.toString() ? '?' + params : '');
      if (remote && !q) {
        document.querySelectorAll('[data-live-remote]').forEach((el) => { el.innerHTML = ''; });
        return;
      }
      if (ctrl) ctrl.abort();
      ctrl = new AbortController();
      form.classList.add('is-searching');
      try {
        const res = await fetch(url, { headers: { 'X-Live-Refresh': '1' }, credentials: 'same-origin', signal: ctrl.signal });
        if (!res.ok || res.redirected) return;
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        document.querySelectorAll('[data-live]').forEach((el) => {
          const fresh = doc.getElementById(el.id);
          if (fresh) el.innerHTML = fresh.innerHTML;
        });
        // "Wissen"-knop en andere delen van het zoekformulier gelijk houden
        const freshForm = doc.querySelector('form[role="search"]');
        const wipe = form.querySelector('a.btn-ghost');
        const freshWipe = freshForm && freshForm.querySelector('a.btn-ghost');
        if (wipe && !freshWipe) wipe.remove();
        else if (!wipe && freshWipe) form.append(freshWipe);
        if (!remote) { history.replaceState(history.state, '', url); if (window.adonisTrailReplace) window.adonisTrailReplace(url); }
        window.dispatchEvent(new Event('resize')); // schaduw bij brede tabellen opnieuw bepalen
        document.dispatchEvent(new Event('adonis:swapped'));
      } catch { /* afgebroken of geen verbinding: Enter werkt nog steeds */ }
      finally { form.classList.remove('is-searching'); }
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 250); });
  });
})();
// Toets "/" springt naar het zoekveld (als je niet al aan het typen bent).
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
  const box = document.querySelector('form[role="search"] input[name="q"], .start-search input');
  if (!box) return;
  e.preventDefault();
  box.focus();
  box.select();
});
// Telefoon: het actieve menu-item in beeld schuiven (het menu is daar één rij om door te vegen).
(function () {
  const nav = document.querySelector('.mainnav');
  const active = nav && nav.querySelector('a.active');
  if (active && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = active.offsetLeft - nav.clientWidth / 2 + active.offsetWidth / 2;
})();
// Tabellen die breder zijn dan het scherm: een schaduw aan de kant waar nog meer staat (zodat niets "verdwijnt").
(function () {
  function mark(w) {
    const more = w.scrollWidth - w.clientWidth;
    w.classList.toggle('more-right', more > 2 && w.scrollLeft < more - 2);
    w.classList.toggle('more-left', more > 2 && w.scrollLeft > 2);
  }
  function all() { document.querySelectorAll('.table-wrap').forEach(mark); }
  document.addEventListener('scroll', (e) => { if (e.target.classList && e.target.classList.contains('table-wrap')) mark(e.target); }, true);
  addEventListener('resize', all);
  addEventListener('load', all);
  // Ook na live bijwerken (de lijst wordt dan vervangen).
  if (window.MutationObserver) new MutationObserver(() => requestAnimationFrame(all)).observe(document.body, { childList: true, subtree: true });
  all();
})();
// Instellingen: "Geheime thema's" aan/uit toont of verbergt Neon en Black Ice meteen.
(function () {
  const toggle = document.querySelector('[data-secret-toggle]');
  if (!toggle) return;
  toggle.addEventListener('change', () => {
    document.querySelectorAll('[data-secret-theme]').forEach((el) => {
      el.hidden = !toggle.checked;
      const radio = el.querySelector('input[type=radio]');
      if (!toggle.checked && radio && radio.checked) {
        const sys = document.querySelector('input[name=theme][value=system]');
        if (sys) sys.checked = true;
      }
    });
  });
})();
// Afdrukknop
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-print]')) return;
  // In de ADONIS-app: eigen afdrukvoorbeeld; in de browser het gewone afdrukscherm.
  if (window.adonisApp && window.adonisApp.print) window.adonisApp.print(); else window.print();
});
// Wissellijst: "Gebeld" aan/uit zonder de pagina te herladen (je blijft op je plek in de lijst).
document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form.call-form');
  if (!form || !window.fetch) return;
  e.preventDefault();
  const btn = form.querySelector('button');
  try {
    const res = await fetch(form.action, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'X-CSRF-Token': form.querySelector('[name=_csrf]').value } });
    if (!res.ok) throw new Error();
    const r = await res.json();
    const d = r.uitgenodigd_at ? r.uitgenodigd_at.split('-').reverse().map((x, i) => (i === 2 ? x.slice(2) : x)).join('-') : '';
    btn.textContent = d ? '✓ ' + d : 'Gebeld';
    btn.classList.toggle('btn-ok', Boolean(d));
    form.closest('tr').classList.toggle('is-called', Boolean(d));
  } catch { form.submit(); }
});
// Instellingen: "Weergave op telefoon" meteen laten zien (opslaan gebeurt met de knop).
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-mscale-choice]') && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
    document.documentElement.setAttribute('data-mscale', e.target.value);
  }
});
// Telefoon: tabellen worden kaarten (zie app.css). Elke cel krijgt de kolomkop als label,
// lege cellen worden verborgen. Ook na live bijwerken (de lijst wordt dan vervangen).
(function () {
  const SKIP_LEAD = ['ph-col', 'qty-col', 'chk'];
  function cardify(table) {
    if (table.matches('.compact, .no-cards') || !table.tHead) return;
    const heads = [...table.tHead.rows[0].cells].map((th) => th.textContent.replace(/\s+/g, ' ').trim());
    table.classList.add('cards');
    for (const row of table.tBodies[0] ? table.tBodies[0].rows : []) {
      let lead = false;
      [...row.cells].forEach((td, i) => {
        td.dataset.label = heads[i] || '';
        const filled = td.textContent.trim() || td.querySelector('img, svg, input, button, select, .plate');
        td.classList.toggle('is-empty', !filled);
        if (!lead && filled && !SKIP_LEAD.some((c) => td.classList.contains(c))) { td.classList.add('card-lead'); lead = true; }
      });
    }
  }
  function all() { document.querySelectorAll('table.list').forEach(cardify); }
  all();
  if (window.MutationObserver) {
    let queued = false;
    new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; all(); }); } })
      .observe(document.body, { childList: true, subtree: true });
  }
})();
// "Terug"-knop (foutpagina)
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-back]')) return;
  if (history.length > 1) history.back(); else location.href = '/';
});
// Formulieren met data-guard: waarschuwen bij weggaan als er iets is veranderd dat nog niet is opgeslagen.
(function () {
  const forms = [...document.querySelectorAll('form[data-guard]')];
  if (!forms.length) return;
  let dirty = false;
  let leaving = false;
  forms.forEach((f) => {
    f.addEventListener('input', () => { dirty = true; });
    f.addEventListener('change', () => { dirty = true; });
  });
  document.addEventListener('submit', (e) => { if (!e.defaultPrevented) leaving = true; });
  window.adonisFormDirty = () => dirty && !leaving; // voor live.js (na een update niet zomaar herladen)
  window.addEventListener('beforeunload', (e) => {
    if (dirty && !leaving && !window.adonisLeaving) { e.preventDefault(); e.returnValue = ''; }
  });
})();
// Klantpagina: foto van het automodel ophalen als die nog niet bekend is (Wikipedia, via de eigen server).
(function () {
  const fig = document.querySelector('figure[data-carimg-q]');
  if (!fig || !fig.hidden || !window.fetch) return;
  fetch('/autofoto?q=' + encodeURIComponent(fig.dataset.carimgQ), { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((r) => {
      if (!r.ok) return;
      const img = fig.querySelector('img');
      img.addEventListener('load', () => {
        img.hidden = false; fig.hidden = false;
        const head = fig.closest('.customer-head'); if (head) head.classList.add('has-photo');
      }, { once: true });
      img.src = r.img;
      const t = fig.querySelector('[data-carimg-title]'); t.textContent = r.title; t.href = r.pageUrl;
      const f = fig.querySelector('[data-carimg-file]'); if (r.fileUrl) f.href = r.fileUrl;
    })
    .catch(() => { /* geen internet: geen foto */ });
})();
// Foto van het automodel klopt niet: voor dit model niet meer tonen.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-carimg-wrong]');
  if (!btn) return;
  const fig = btn.closest('figure[data-carimg-q]');
  const q = fig.dataset.carimgQ.replace(/\s*\(.*\)$/, '');
  if (!window.confirm(`Klopt deze foto niet bij de auto?\n\nDan wordt voor de ${q} geen foto meer getoond (bij alle klanten met dit model).`)) return;
  try {
    await fetch('/autofoto/fout', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': fig.dataset.csrf },
      body: new URLSearchParams({ q: fig.dataset.carimgQ }) });
  } catch { /* volgende keer */ }
  fig.hidden = true;
  const head = fig.closest('.customer-head'); if (head) head.classList.remove('has-photo');
});
// Voorraad: voorbeeldfoto per soort onderdeel ophalen (Wikipedia, via de eigen server). Elke soort maar één keer.
(function () {
  const fig = document.querySelector('figure.part-sample[data-fetch]');
  if (!window.fetch) return;
  const cache = new Map();
  const get = (type) => {
    if (!cache.has(type)) {
      cache.set(type, fetch('/onderdeelfoto?type=' + encodeURIComponent(type), { credentials: 'same-origin' })
        .then((r) => r.json()).catch(() => ({ ok: false })));
    }
    return cache.get(type);
  };
  (async () => {
    if (fig) {
      const r = await get(fig.dataset.type);
      if (r.ok) {
        const img = fig.querySelector('img');
        img.addEventListener('load', () => { img.hidden = false; fig.hidden = false; }, { once: true });
        img.src = r.img;
        const t = fig.querySelector('[data-sample-title]'); t.textContent = r.title; t.href = r.pageUrl;
        if (r.fileUrl) fig.querySelector('[data-sample-file]').href = r.fileUrl;
      }
    }
    await fillList();
  })();
  // Ook na zoeken-tijdens-typen of een live verversing (nieuwe rijen).
  document.addEventListener('adonis:swapped', () => fillList());
  async function fillList() {
    const cells = [...document.querySelectorAll('td[data-parttype]')].filter((td) => !td.querySelector('img'));
    // Lijst: soorten één voor één (vriendelijk voor Wikipedia), met de meest voorkomende eerst.
    const counts = new Map();
    cells.forEach((td) => counts.set(td.dataset.parttype, (counts.get(td.dataset.parttype) || 0) + 1));
    for (const type of [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a))) {
      const r = await get(type);
      if (!r.ok) continue;
      document.querySelectorAll('td[data-parttype]').forEach((td) => {
        if (td.dataset.parttype !== type || td.querySelector('img')) return;
        const span = document.createElement('span');
        span.className = 'ph-thumb ph-sample';
        span.title = `Voorbeeld: ${r.title} (Wikipedia)`;
        const img = document.createElement('img');
        img.src = r.img; img.alt = ''; img.loading = 'lazy';
        span.append(img);
        td.append(span);
      });
    }
  }
})();
// Voorbeeldfoto van een onderdeel klopt niet: voor deze soort niet meer tonen.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-sample-wrong]');
  if (!btn) return;
  const fig = btn.closest('figure.part-sample');
  if (!window.confirm(`Klopt deze voorbeeldfoto niet bij "${fig.dataset.type}"?\n\nDan wordt voor deze soort onderdeel geen voorbeeldfoto meer getoond.`)) return;
  try {
    await fetch('/onderdeelfoto/fout', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': fig.dataset.csrf },
      body: new URLSearchParams({ type: fig.dataset.type }) });
  } catch { /* volgende keer */ }
  fig.hidden = true;
});
// Terugzetten van een backup: wachten tot ADONIS weer draait en dan naar het inlogscherm.
(function () {
  const wait = document.querySelector('[data-restart-wait]');
  if (wait) {
    const status = wait.querySelector('[data-restart-status]');
    const started = Date.now();
    let wentDown = false;
    const poll = async () => {
      try {
        const r = await fetch('/status', { cache: 'no-store' });
        if (r.ok && (wentDown || Date.now() - started > 8000)) { status.textContent = 'Klaar! U wordt doorgestuurd…'; location.href = '/login'; return; }
      } catch { wentDown = true; status.textContent = 'ADONIS start opnieuw op…'; }
      if (Date.now() - started > 120000) { status.textContent = 'Dit duurt lang. Ververs de pagina, of start ADONIS opnieuw op de computer.'; return; }
      setTimeout(poll, 1500);
    };
    setTimeout(poll, 1500);
  }
  // Backup uit een bestand terugzetten (Systeem)
  const box = document.querySelector('.restore-upload');
  const input = document.getElementById('restoreFile');
  if (!box || !input) return;
  const msg = document.getElementById('restoreMsg');
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    if (!window.confirm(`Alle gegevens terugzetten naar de backup "${file.name}"?\n\nAlles wat daarna is ingevoerd, verdwijnt uit ADONIS. Er wordt eerst een veiligheidsbackup van de huidige situatie gemaakt, dus dit is terug te draaien. ADONIS start daarna opnieuw op.`)) return;
    msg.textContent = 'Bezig met uploaden en controleren…';
    try {
      const res = await fetch('/systeem/backup/terugzetten', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': box.dataset.csrf },
        body: file,
      });
      const r = await res.json().catch(() => ({ error: 'Onverwacht antwoord van de server.' }));
      if (!res.ok) throw new Error(r.error || 'Terugzetten mislukt.');
      document.querySelector('main').innerHTML = '';
      const h = document.createElement('h1'); h.textContent = 'Backup wordt teruggezet…';
      const p = document.createElement('p'); p.textContent = `Backup van ${r.when}. ADONIS start zo opnieuw op; daarna wordt u naar het inlogscherm gestuurd.`;
      document.querySelector('main').append(h, p);
      setTimeout(function again() {
        fetch('/status', { cache: 'no-store' }).then((x) => { if (x.ok) location.href = '/login'; else setTimeout(again, 1500); }).catch(() => setTimeout(again, 1500));
      }, 6000);
    } catch (e) {
      msg.textContent = e.message;
    }
  });
})();
