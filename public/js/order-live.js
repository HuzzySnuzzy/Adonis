'use strict';
/*
 * Werkopdracht automatisch opslaan en live samen bewerken.
 * - Wat u wijzigt, wordt na een korte pauze in het typen opgeslagen (alleen de gewijzigde velden).
 * - Wijzigingen van collega's verschijnen meteen in uw scherm; per veld geldt: wie het laatst typt, wint.
 * - Bovenaan ziet u wie de werkopdracht nog meer open heeft, en bij een veld wie daar nu in typt.
 * Server: GET/POST /werkopdracht/:id/live en POST /werkopdracht/:id/aanwezig.
 */
(function () {
  const form = document.getElementById('orderForm');
  if (!form || !form.dataset.liveEdit) return;
  const csrf = (form.querySelector('input[name=_csrf]') || {}).value || '';
  const me = document.body.dataset.userId;
  const tab = 't' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const toolbar = document.querySelector('.order-toolbar');
  const stateEl = document.querySelector('[data-live-state]');
  const peopleEl = document.querySelector('[data-co-people]');
  let orderId = form.dataset.liveEdit === 'nieuw' ? null : form.dataset.liveEdit;
  let rev = Number(form.dataset.rev) || 0;
  let editable = !form.querySelector('fieldset:disabled');
  const SKIP = /^(_csrf|versie|zonder_factuurnr|next_status)$/;
  window.adonisOrderLive = true;

  /* ---------- velden lezen en schrijven ---------- */
  function fields() {
    const map = new Map();
    for (const el of form.elements) {
      if (!el.name || SKIP.test(el.name) || ['submit', 'button', 'file', 'reset'].includes(el.type)) continue;
      if (!map.has(el.name)) map.set(el.name, []);
      map.get(el.name).push(el);
    }
    return map;
  }
  function read(els) {
    const el = els[0];
    if (el.type === 'radio') { const c = els.find((e) => e.checked); return c ? c.value : ''; }
    if (el.type === 'checkbox') return el.checked ? 'on' : '';
    return el.value;
  }
  function snapshot(map = fields()) {
    const out = {};
    for (const [name, els] of map) out[name] = read(els);
    return out;
  }
  const remoteEvent = (type) => { const e = new Event(type, { bubbles: true }); e.adonisRemote = true; return e; };
  function write(els, value) {
    const el = els[0];
    if (el.type === 'radio') els.forEach((r) => { r.checked = r.value === value; });
    else if (el.type === 'checkbox') el.checked = value === 'on' || value === 'true';
    else if (el.value !== value) {
      const focused = document.activeElement === el && typeof el.selectionStart === 'number';
      const [a, b] = focused ? [el.selectionStart, el.selectionEnd] : [0, 0];
      el.value = value;
      if (focused) { try { el.setSelectionRange(Math.min(a, value.length), Math.min(b, value.length)); } catch { /* datum e.d. */ } }
    }
    el.dispatchEvent(remoteEvent('input'));
    if (el.type === 'radio' || el.type === 'checkbox') el.dispatchEvent(remoteEvent('change'));
  }
  const pageSig = () => [...form.querySelectorAll('[data-page]')]
    .map((p) => (p.querySelector('input[name$="[soort]"]') || {}).value || '?').join(',');
  const isPageField = (k) => k.startsWith('d[paginas]');
  const nr = form.querySelector('input[name=nummer]');
  const isPrefilledNr = () => !!nr && nr.value === nr.defaultValue;

  let synced = snapshot(); // wat de server (volgens ons) nu heeft
  let syncedSig = pageSig();
  const canon = {}; // nette waarde van de server voor een veld waarin u nog typt (bijv. kenteken in hoofdletters)
  const versieInput = () => form.querySelector('input[name=versie]');

  function pendingPatch() {
    const snap = snapshot();
    const patch = {};
    for (const [k, v] of Object.entries(snap)) if (synced[k] !== v) patch[k] = v;
    let pages = false;
    if (pageSig() !== syncedSig) { pages = true; for (const [k, v] of Object.entries(snap)) if (isPageField(k)) patch[k] = v; }
    return { snap, patch, pages, any: pages || Object.keys(patch).length > 0 };
  }
  window.adonisLiveDirty = () => editable && (!!inflight || pendingPatch().any);

  /* ---------- status bovenaan ---------- */
  let stateTimer = null;
  function setState(kind, text) {
    if (!stateEl) return;
    clearTimeout(stateTimer);
    const T = {
      saved: 'Alles opgeslagen', saving: 'Opslaan…', pending: 'Opslaan…',
      new: 'Wordt automatisch opgeslagen zodra er een kenteken en werk of onderdelen op staan',
      offline: 'Geen verbinding – wordt opgeslagen zodra die er weer is',
    };
    stateEl.textContent = text || T[kind] || '';
    stateEl.dataset.state = kind;
    if (toolbar) toolbar.classList.toggle('dirty', kind === 'pending' || kind === 'saving' || kind === 'error' || kind === 'offline');
  }
  function showRemote(by) {
    const t = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    setState('remote', `Bijgewerkt door ${by} · ${t}`);
    stateTimer = setTimeout(() => { if (stateEl.dataset.state === 'remote') setState('saved'); }, 6000);
  }

  /* ---------- opslaan ---------- */
  let timer = null; let firstChange = 0; let inflight = null; let retryTimer = null;
  let needReload = false; let lastFailed = null; let offline = false;
  function schedule(delay = 700) {
    if (!editable) return;
    clearTimeout(timer);
    if (!firstChange) firstChange = Date.now();
    // Bij doortypen toch minstens elke 2,5 seconde opslaan, zodat collega's het zien verschijnen.
    timer = setTimeout(flush, Math.max(0, Math.min(delay, 2500 - (Date.now() - firstChange))));
    if (stateEl && stateEl.dataset.state !== 'error') setState('pending');
  }
  function readyToCreate(snap) {
    if (String(snap['d[kenteken]'] || '').replace(/[^A-Za-z0-9]/g, '').length < 4 || !String(snap.nummer || '').trim()) return false;
    return Object.entries(snap).some(([k, v]) => v && v.trim && v.trim() && (k === 'd[werk_omschrijving]'
      || /^d\[werk_regels\]\[\d+\]\[omschrijving\]$/.test(k)
      || /^d\[onderdelen\]\[\d+\]\[omschrijving\]$/.test(k) || /^d\[achter\]\[advies\]\[\d+\]\[tekst\]$/.test(k)
      || (isPageField(k) && !k.endsWith('[soort]'))));
  }
  async function flush({ keepalive = false } = {}) {
    clearTimeout(timer); timer = null;
    if (inflight) await inflight.catch(() => {});
    if (!editable) return true;
    let { snap, patch, pages, any } = pendingPatch();
    if (!any) { firstChange = 0; if (!orderId) setState('new'); else if (!['error', 'remote'].includes(stateEl && stateEl.dataset.state)) setState('saved'); return true; }
    if (!orderId) {
      if (!readyToCreate(snap)) { firstChange = 0; setState('new'); return false; }
      patch = snap; pages = true;
    }
    firstChange = 0;
    setState('saving');
    const sent = JSON.stringify(patch);
    inflight = send(patch, pages, keepalive).finally(() => { inflight = null; });
    const ok = await inflight;
    if (ok) lastFailed = null; else lastFailed = sent;
    return ok;
  }
  async function send(patch, pages, keepalive) {
    let res; let r = {};
    try {
      res = await fetch(`/werkopdracht/${orderId || 'nieuw'}/live`, {
        method: 'POST', credentials: 'same-origin', keepalive,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ patch, pages, tab, rev, autoNummer: !orderId && isPrefilledNr() }),
      });
      r = await res.json().catch(() => ({}));
    } catch {
      offline = true; setState('offline'); clearTimeout(retryTimer); retryTimer = setTimeout(() => flush(), 5000);
      return false;
    }
    offline = false;
    if (!res.ok) {
      if (r.locked || r.gone) { editable = false; setState('error', r.error); return false; }
      if (res.status === 422) { setState('error', 'Niet opgeslagen: ' + (r.error || 'controleer de werkopdracht.')); return false; }
      // Uitgelogd of server even weg: later opnieuw.
      setState('offline', res.status === 403 ? 'Niet opgeslagen: u bent uitgelogd. Log opnieuw in (uw wijzigingen blijven op dit apparaat bewaard).' : null);
      if (res.status !== 403) { clearTimeout(retryTimer); retryTimer = setTimeout(() => flush(), 5000); }
      return false;
    }
    const map = fields();
    for (const [k, v] of Object.entries(patch)) if (!isPageField(k) || !pages) synced[k] = v;
    if (pages) {
      renumberPages();
      for (const k of Object.keys(synced)) if (isPageField(k)) delete synced[k];
      for (const [k, v] of Object.entries(r.fields || {})) if (isPageField(k)) synced[k] = v;
      syncedSig = pageSig();
    }
    // De server maakt sommige waarden netjes (hoofdletters, datum): overnemen, behalve in het veld waarin u typt.
    for (const [k, v] of Object.entries(r.fields || {})) {
      if (isPageField(k) && pages) continue;
      const els = map.get(k);
      if (!els || v === patch[k]) continue;
      if (els.includes(document.activeElement)) { canon[k] = v; continue; }
      if (read(els) === patch[k]) { write(els, v); synced[k] = v; }
    }
    if (!orderId && r.id) becameReal(r);
    rev = Math.max(rev, Number(r.rev) || 0);
    if (r.versie && versieInput()) versieInput().value = r.versie;
    const still = pendingPatch().any;
    if (still) schedule(300);
    else {
      setState('saved');
      document.dispatchEvent(new Event('adonis:order-synced'));
      if (needReload) reloadKeep();
    }
    return true;
  }
  function renumberPages() {
    form.querySelectorAll('[data-page]').forEach((page, i) => {
      page.querySelectorAll('[name^="d[paginas]["]').forEach((el) => { el.name = el.name.replace(/^d\[paginas\]\[\d+\]/, `d[paginas][${i}]`); });
    });
  }
  // Een nieuwe werkopdracht is net aangemaakt: vanaf nu is dit gewoon die werkopdracht (zonder de pagina te herladen).
  function becameReal(r) {
    orderId = String(r.id);
    form.dataset.liveEdit = orderId;
    form.action = '/werkopdracht/' + orderId;
    if (!versieInput()) {
      const v = document.createElement('input'); v.type = 'hidden'; v.name = 'versie'; v.value = r.versie || ''; form.prepend(v);
    }
    if (!document.getElementById('live-order')) {
      const s = document.createElement('span'); s.hidden = true; s.id = 'live-order'; s.dataset.id = orderId; document.body.append(s);
    }
    synced = { ...synced, ...r.fields };
    try { history.replaceState(history.state, '', '/werkopdracht/' + orderId); } catch { /* geen history */ }
    const title = document.querySelector('.tb-title strong');
    if (title) title.firstChild.textContent = 'Werkopdracht ' + r.nummer + ' ';
    document.title = document.title.replace('Nieuwe werkopdracht', 'Werkopdracht ' + r.nummer);
    hello();
  }

  /* ---------- wijzigingen van collega's ---------- */
  function applyRemote(remote) {
    const map = fields();
    let missing = false;
    for (const [k, v] of Object.entries(remote)) {
      const els = map.get(k);
      if (!els) { if (isPageField(k) || k.includes('[werk_regels]')) missing = true; continue; }
      if (read(els) !== synced[k]) { synced[k] = v; continue; } // u heeft dit veld zelf gewijzigd: dat gaat zo naar de server
      synced[k] = v;
      if (read(els) === v) continue;
      write(els, v);
      const box = els[0].type === 'radio' || els[0].type === 'checkbox' ? els[0].closest('label') || els[0] : els[0];
      box.classList.remove('co-flash'); void box.offsetWidth; box.classList.add('co-flash');
    }
    if (window.adonisOrder) { window.adonisOrder.updateTotals(); window.adonisOrder.fitAll(); }
    return missing;
  }
  function reloadKeep() {
    try { sessionStorage.setItem('adonis-live-scroll:' + location.pathname, JSON.stringify([scrollX, scrollY])); } catch { /* geen opslag */ }
    window.adonisLeaving = true;
    location.reload();
  }
  try {
    const k = 'adonis-live-scroll:' + location.pathname; const pos = JSON.parse(sessionStorage.getItem(k) || 'null');
    if (pos) { sessionStorage.removeItem(k); requestAnimationFrame(() => scrollTo(pos[0], pos[1])); }
  } catch { /* geen opslag */ }
  // Bladen toegevoegd of verwijderd door een collega: de indeling klopt niet meer, dus (zodra uw wijzigingen binnen zijn) herladen.
  function structureChanged() {
    if (!inflight && !pendingPatch().any) return reloadKeep();
    needReload = true;
    flush();
  }
  let resyncing = false;
  async function resync() {
    if (!orderId || resyncing) return;
    resyncing = true;
    try {
      const r = await (await fetch(`/werkopdracht/${orderId}/live`, { credentials: 'same-origin', headers: { Accept: 'application/json' } })).json();
      if (!r || !r.fields) return;
      if (r.editable !== editable) { if (!pendingPatch().any) reloadKeep(); return; } // status veranderd
      const sig = Object.keys(r.fields).filter((k) => /^d\[paginas\]\[\d+\]\[soort\]$/.test(k)).map((k) => r.fields[k]).join(',');
      if (sig !== syncedSig) { structureChanged(); return; }
      const missing = applyRemote(r.fields);
      rev = Number(r.rev) || rev;
      if (missing) structureChanged();
      if (versieInput() && r.versie) versieInput().value = r.versie;
      if (r.people) renderPeople(r.people);
    } catch { /* volgende keer */ } finally { resyncing = false; }
  }
  document.addEventListener('adonis:order-live', (e) => {
    const ev = e.detail;
    if (!orderId || String(ev.id) !== orderId) return;
    if (ev.tab === tab) { rev = Math.max(rev, Number(ev.rev) || 0); return; }
    if (Number(ev.prev) !== rev) { resync(); return; } // iets gemist
    rev = Number(ev.rev);
    if (versieInput() && ev.versie) versieInput().value = ev.versie;
    const missing = applyRemote(ev.fields || {});
    if (ev.structure || missing) structureChanged();
    if (stateEl && stateEl.dataset.state !== 'error' && !timer && !inflight) showRemote(String(ev.byId) === String(me) ? 'u (ander venster)' : ev.by);
  });
  document.addEventListener('adonis:order-resync', resync);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resync(); });

  /* ---------- wie kijkt er mee ---------- */
  const hue = (id) => (Number(id) * 67) % 360;
  let people = [];
  function renderPeople(list) {
    people = (list || []).filter((p) => p.tab !== tab);
    if (peopleEl) {
      const seen = new Set();
      peopleEl.replaceChildren(...people.filter((p) => { const k = p.userId + (String(p.userId) === String(me) ? p.tab : ''); if (seen.has(k)) return false; seen.add(k); return true; }).map((p) => {
        const own = String(p.userId) === String(me);
        const el = document.createElement('span');
        el.className = 'co-person' + (p.field ? ' is-typing' : '');
        el.style.setProperty('--co', `hsl(${hue(p.userId)} 65% 45%)`);
        let dot = document.createElement('i'); dot.textContent = (p.name || '?').trim().charAt(0).toUpperCase();
        if (p.av) { const t = document.createElement('template'); t.innerHTML = p.av; if (t.content.firstElementChild) dot = t.content.firstElementChild; } // profielfoto (van de server)
        const name = document.createElement('span'); name.textContent = own ? 'u (ander venster)' : p.name;
        el.title = (own ? 'U heeft deze werkopdracht ook in een ander venster open' : `${p.name} heeft deze werkopdracht open`) + (p.field ? ' en is aan het typen' : '');
        el.append(dot, name);
        return el;
      }));
      if (people.length) { const lbl = document.createElement('span'); lbl.className = 'co-label muted small'; lbl.textContent = 'Ook open:'; peopleEl.prepend(lbl); }
    }
    // Bij het veld: wie typt hier?
    form.querySelectorAll('.co-editing').forEach((el) => { el.classList.remove('co-editing'); el.style.removeProperty('--co'); });
    form.querySelectorAll('.co-tag').forEach((t) => t.remove());
    const map = fields();
    for (const p of people) {
      const els = p.field && map.get(p.field);
      if (!els) continue;
      const el = els[0].type === 'radio' || els[0].type === 'checkbox' ? els[0].closest('label') || els[0] : els[0];
      const color = `hsl(${hue(p.userId)} 65% 45%)`;
      el.classList.add('co-editing'); el.style.setProperty('--co', color);
      const host = el.parentElement;
      host.classList.add('co-host');
      const tag = document.createElement('span');
      tag.className = 'co-tag'; tag.setAttribute('aria-hidden', 'true'); tag.style.setProperty('--co', color);
      tag.textContent = String(p.userId) === String(me) ? 'u' : (p.name || '').split(' ')[0];
      host.append(tag);
    }
  }
  document.addEventListener('adonis:order-presence', (e) => { if (orderId && String(e.detail.id) === orderId) renderPeople(e.detail.people); });

  let field = ''; let helloTimer = null;
  function post(extra = {}, beacon = false) {
    if (!orderId) return;
    const body = new URLSearchParams({ _csrf: csrf, tab, field, ...extra });
    if (beacon && navigator.sendBeacon) { navigator.sendBeacon(`/werkopdracht/${orderId}/aanwezig`, body); return; }
    fetch(`/werkopdracht/${orderId}/aanwezig`, { method: 'POST', credentials: 'same-origin', body })
      .then((r) => r.json()).then((r) => renderPeople(r.people)).catch(() => {});
  }
  function hello() { post(); clearInterval(helloTimer); helloTimer = setInterval(() => { if (document.visibilityState === 'visible') post(); }, 20000); }
  let focusTimer = null;
  const setField = (name) => {
    clearTimeout(focusTimer);
    focusTimer = setTimeout(() => { if (name !== field) { field = name; post(); } }, name ? 150 : 600);
  };
  form.addEventListener('focusin', (e) => { if (editable && e.target.name && !SKIP.test(e.target.name)) setField(e.target.name); });
  form.addEventListener('focusout', (e) => {
    setField('');
    // Nette waarde van de server alsnog tonen nu u het veld verlaat.
    const k = e.target.name;
    if (k && canon[k] !== undefined) {
      const els = fields().get(k);
      if (els && read(els) === synced[k]) { write(els, canon[k]); synced[k] = canon[k]; }
      delete canon[k];
    }
  });
  window.addEventListener('pagehide', () => { if (orderId) post({ weg: '1' }, true); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) { hello(); resync(); } });

  /* ---------- oude werkopdracht: werkzaamheden regel voor regel zetten ---------- */
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-voorkant-v2]');
    if (!b || !editable) return;
    const h = form.querySelector('input[name="d[voorkant]"]');
    if (!h) return;
    b.disabled = true;
    h.value = '2';
    if (await flush()) reloadKeep(); else { h.value = ''; b.disabled = false; }
  });

  /* ---------- wanneer opslaan ---------- */
  form.addEventListener('input', (e) => { if (!e.adonisRemote) schedule(); });
  form.addEventListener('change', (e) => { if (!e.adonisRemote) schedule(300); });
  const pagesBox = form.querySelector('[data-pages]');
  if (pagesBox) new MutationObserver(() => schedule(300)).observe(pagesBox, { childList: true });
  // Velden die door een knop of sjabloon worden ingevuld (zonder typen): elke 3 seconden even kijken.
  setInterval(() => {
    if (!editable || timer || inflight || document.visibilityState !== 'visible') return;
    const p = pendingPatch();
    if (p.any && JSON.stringify(orderId ? p.patch : p.snap) !== lastFailed) schedule(0);
  }, 3000);
  // Pagina verlaten of naar een ander tabblad: meteen opslaan.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && (timer || pendingPatch().any)) flush({ keepalive: true }); });

  // De knop Opslaan: eerst automatisch opslaan; een statusknop (Klaar voor facturatie, Gefactureerd) daarna zoals altijd.
  form.addEventListener('submit', async (e) => {
    if (e.defaultPrevented || !editable) return;
    e.preventDefault();
    const btn = e.submitter;
    const next = btn && btn.name === 'next_status' ? btn.value : null;
    const ok = await flush();
    if (!ok && offline) return; // geen verbinding: wordt opgeslagen zodra die er weer is (zie de melding bovenaan)
    if (next || !ok) {
      if (next) { const h = document.createElement('input'); h.type = 'hidden'; h.name = 'next_status'; h.value = next; form.append(h); }
      window.adonisLeaving = true;
      HTMLFormElement.prototype.submit.call(form);
      return;
    }
    setState('saved', 'Opgeslagen');
    if (stateEl) { stateEl.classList.remove('co-flash'); void stateEl.offsetWidth; stateEl.classList.add('co-flash'); }
    stateTimer = setTimeout(() => setState('saved'), 3000);
  });

  if (orderId) { setState(editable ? 'saved' : 'readonly', editable ? 'Wordt automatisch opgeslagen' : ''); hello(); }
  else setState('new');
})();
