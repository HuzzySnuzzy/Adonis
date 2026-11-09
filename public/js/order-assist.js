'use strict';
/*
 * Slimmer invullen van de werkopdracht:
 *  - Kenteken ingevuld: bekende klant? Dan naam, adres, telefoon enz. aanvullen (alleen lege vakken, geel = even nakijken),
 *    en bovenaan wat we al weten: vorige werkopdracht, laatste km-stand, olie en banden van vorige keer, bandenhotel.
 *  - Suggesties tijdens het typen: onderdelen (eerdere werkopdrachten + voorraad, met prijs), werkzaamheden, bandenmaat en -merk.
 *  - Waarschuwingen: km-stand lager dan vorige keer, km uit < km in, APK verlopen, oude banden (DOT).
 */
(function () {
  const form = document.getElementById('orderForm');
  if (!form) return;
  const editable = !form.querySelector('fieldset:disabled');
  const $ = (name) => form.querySelector(`[name="d[${name}]"]`);
  const plate = $('kenteken');
  const orderId = (document.getElementById('live-order') || {}).dataset?.id || '';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('-') : '');
  const fmtKm = (n) => Number(n).toLocaleString('nl-NL');
  const kmOf = (v) => { const n = parseInt(String(v || '').replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : null; };

  function setField(input, value, { force = false } = {}) {
    if (!input || input.disabled || value === undefined || value === null || value === '') return false;
    if (!force && String(input.value).trim()) return false;
    if (input.value === String(value)) return false;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.classList.add('needs-check');
    setTimeout(() => input.classList.remove('needs-check'), 2500);
    return true;
  }

  /* ---------- balk bovenaan: wat we al weten ---------- */
  const bar = document.createElement('section');
  bar.className = 'order-assist no-print';
  bar.setAttribute('aria-label', 'Hulp bij invullen');
  bar.hidden = true;
  bar.setAttribute('aria-live', 'polite');
  form.before(bar);
  let info = null;

  function render() {
    const chips = []; const actions = []; const warns = warnings();
    if (info && info.found) {
      const c = info.customer || {};
      chips.push(`<span class="oa-chip"><b>Bekende klant</b> <a href="/klant/${c.id}">${esc(c.naam || info.kenteken)}</a>${info.orders ? ` · ${info.orders} eerdere werkopdracht${info.orders === 1 ? '' : 'en'}` : ''}</span>`);
      if (info.last) chips.push(`<span class="oa-chip">Vorige keer: <a href="/werkopdracht/${info.last.id}">nr ${info.last.nummer}</a> op ${fmtDate(info.last.datum)}</span>`);
      if (info.km) chips.push(`<span class="oa-chip">Laatste km-stand: <b>${fmtKm(info.km.km)}</b> (${fmtDate(info.km.datum)})</span>`);
      if (info.service) chips.push(`<span class="oa-chip">Laatste servicebeurt: ${fmtKm(info.service.km)} km</span>`);
      if (info.oil) {
        chips.push(`<span class="oa-chip">Motorolie vorige keer: <b>${esc(info.oil.visc || '?')}</b>${info.oil.liter ? `, ${esc(info.oil.liter)} l` : ''}</span>`);
        if (editable) actions.push('<button type="button" class="btn btn-small" data-oa="oil">Olie van vorige keer invullen</button>');
      }
    }
    if (info && info.tyres) {
      const t = info.tyres;
      if (t.onCar) chips.push(`<span class="oa-chip">Op de auto: <b>${esc([t.onCar.maat, t.onCar.seizoen].filter(Boolean).join(' ') || 'banden')}</b>${t.onCar.merk ? ' ' + esc(t.onCar.merk) : ''}</span>`);
      for (const s of t.stored.slice(0, 2)) chips.push(`<span class="oa-chip">In het bandenhotel: <a href="/bandenhotel/${s.id}">${esc([s.seizoen, s.maat].filter(Boolean).join(' ') || 'set')}</a>${s.locatie ? ' · ' + esc(s.locatie) : ''}</span>`);
    }
    const tyreSrc = tyreSource();
    if (editable && tyreSrc) actions.push(`<button type="button" class="btn btn-small" data-oa="tyres">Bandenmaten invullen (${esc(tyreSrc.label)})</button>`);
    if (!chips.length && !warns.length) { bar.hidden = true; bar.innerHTML = ''; return; }
    bar.hidden = false;
    bar.innerHTML = (chips.length ? `<div class="oa-chips">${chips.join('')}</div>` : '')
      + (actions.length ? `<div class="oa-actions">${actions.join('')}</div>` : '')
      + (warns.length ? `<ul class="oa-warns">${warns.map((w) => `<li>⚠ ${w}</li>`).join('')}</ul>` : '');
  }

  // Bandenmaten: van de vorige werkopdracht, anders wat er volgens het bandenhotel op de auto staat.
  const WHEELS = ['lv', 'rv', 'la', 'ra'];
  const tyreInput = (w, f) => form.querySelector(`[name="d[achter][banden][${w}][${f}]"]`);
  function tyreSource() {
    if (!info) return null;
    const empty = WHEELS.some((w) => tyreInput(w, 'maat') && !tyreInput(w, 'maat').value.trim());
    if (!empty) return null;
    if (info.banden && WHEELS.some((w) => info.banden[w] && info.banden[w].maat)) return { label: 'van vorige keer', get: (w) => info.banden[w] || {} };
    if (info.tyres && info.tyres.onCar && info.tyres.onCar.maat) return { label: 'bandenhotel', get: () => ({ maat: info.tyres.onCar.maat, merk: info.tyres.onCar.merk }) };
    return null;
  }

  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-oa]');
    if (!b) return;
    if (b.dataset.oa === 'oil' && info.oil) {
      setField(form.querySelector('[name="d[vloeistoffen][motorolie][info]"]'), info.oil.info);
      setField(form.querySelector('[name="d[vloeistoffen][motorolie][info2]"]'), info.oil.info2);
      setField(form.querySelector('[name="d[vloeistoffen][motorolie][liter]"]'), info.oil.liter);
    }
    if (b.dataset.oa === 'tyres') {
      const src = tyreSource();
      if (src) for (const w of WHEELS) { const v = src.get(w); setField(tyreInput(w, 'maat'), v.maat); setField(tyreInput(w, 'merk'), v.merk); }
    }
    render();
  });

  /* ---------- waarschuwingen ---------- */
  function dotAge(v) {
    const m = /^(\d{2})(\d{2})$/.exec(String(v || '').replace(/\D/g, '').slice(-4));
    if (!m) return null;
    const week = Number(m[1]); const year = 2000 + Number(m[2]);
    if (week < 1 || week > 53) return null;
    const made = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
    const years = (Date.now() - made) / (365.25 * 864e5);
    return years < -0.1 ? null : years;
  }
  function warnings() {
    const out = [];
    const kmIn = kmOf(($('km_in') || {}).value); const kmUit = kmOf(($('km_uit') || {}).value);
    if (info && info.km && kmIn && kmIn < info.km.km) out.push(`Km-stand (in) ${fmtKm(kmIn)} is lager dan vorige keer (${fmtKm(info.km.km)} op ${fmtDate(info.km.datum)}). Typfout?`);
    if (kmIn && kmUit && kmUit < kmIn) out.push(`Km-stand (uit) is lager dan km-stand (in).`);
    const apk = ($('apk_datum') || {}).value;
    if (apk && apk < new Date().toISOString().slice(0, 10)) out.push(`APK is verlopen (${fmtDate(apk)}).`);
    else if (apk && (new Date(apk) - Date.now()) / 864e5 <= 60) out.push(`APK verloopt binnenkort (${fmtDate(apk)}): even melden aan de klant?`);
    const old = WHEELS.map((w) => [w, dotAge((tyreInput(w, 'dot') || {}).value)]).filter(([, a]) => a !== null && a >= 6);
    if (old.length) out.push(`Banden ouder dan 6 jaar (DOT): ${old.map(([w, a]) => `${w.toUpperCase()} ${Math.floor(a)} jaar`).join(', ')}.`);
    if (info && info.service && kmIn && kmIn - info.service.km >= 15000) out.push(`Laatste servicebeurt was bij ${fmtKm(info.service.km)} km: nu ${fmtKm(kmIn - info.service.km)} km geleden.`);
    return out;
  }
  let warnTimer = null;
  form.addEventListener('input', (e) => {
    if (!e.target.matches('[name="d[km_in]"], [name="d[km_uit]"], [name="d[apk_datum]"], [name*="[dot]"], [name*="[maat]"]')) return;
    clearTimeout(warnTimer); warnTimer = setTimeout(render, 300);
  });

  /* ---------- kenteken: klant opzoeken en aanvullen ---------- */
  let seq = 0;
  async function lookup(fill) {
    const v = plate ? plate.value.trim() : '';
    if (v.replace(/[^A-Za-z0-9]/g, '').length < 4) { info = null; render(); return; }
    const my = ++seq;
    let r;
    try { r = await (await fetch(`/werkopdracht/hulp?kenteken=${encodeURIComponent(v)}&id=${encodeURIComponent(orderId)}`, { credentials: 'same-origin' })).json(); } catch { return; }
    if (my !== seq) return;
    info = r;
    if (fill && editable && r.found && r.customer) {
      for (const f of ['naam', 'adres', 'plaats', 'klantnr', 'tel_prive', 'tel_zaak', 'merk_type', 'chassisnummer', 'alarmcode']) setField($(f), r.customer[f]);
      setField($('apk_datum'), r.customer.apk);
    }
    if (fill && editable && r.km && $('km_in') && !$('km_in').value) $('km_in').placeholder = `vorige: ${fmtKm(r.km.km)}`;
    render();
  }
  if (plate) {
    plate.addEventListener('change', () => lookup(true));
    if (plate.value.trim()) lookup(false);
  }

  /* ---------- suggesties tijdens het typen ---------- */
  const pop = document.createElement('ul');
  pop.className = 'oa-pop no-print';
  pop.setAttribute('role', 'listbox');
  pop.hidden = true;
  document.body.append(pop);
  let cur = null; // { el, kind, items, sel, line }
  let ctrl = null; let timer = null;

  function close() { pop.hidden = true; pop.innerHTML = ''; cur = null; }
  /* Plek van een veld op de pagina, in dezelfde (CSS-)pixels als style.top. Niet via getBoundingClientRect: op de
   * telefoon staat de pagina ingezoomd (zoom: .9) en dan kloppen schermpixels niet met paginapixels, waardoor de lijst
   * over het veld viel. Daarom optellen langs de offsetParents, min wat er in tussenliggende vakken is gescrold. */
  function docBox(el) {
    let x = 0; let y = 0; let n = el;
    while (n) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { x -= a.scrollLeft; y -= a.scrollTop; }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  }
  function position(el, lineIdx) {
    const b = docBox(el);
    let top = b.y + b.h; let anchorTop = b.y;
    if (lineIdx !== undefined) {
      const cs = getComputedStyle(el); const lh = parseFloat(cs.lineHeight) || 20;
      anchorTop = b.y + (parseFloat(cs.paddingTop) || 0) + lineIdx * lh - el.scrollTop;
      top = anchorTop + lh;
    }
    const zoom = (el.getBoundingClientRect().height / el.offsetHeight) || 1;
    const vv = window.visualViewport;
    // Zichtbaar deel van het scherm (boven het toetsenbord), in paginapixels.
    const viewTop = (vv ? vv.pageTop : window.scrollY) / zoom; const viewH = (vv ? vv.height : window.innerHeight) / zoom;
    pop.style.maxHeight = Math.max(140, Math.min(320, viewH * 0.45)) + 'px';
    const h = Math.min(pop.scrollHeight, parseFloat(pop.style.maxHeight));
    // Past hij niet onder het veld (toetsenbord), maar wel erboven? Dan erboven. Nooit óp het veld.
    const below = top + 2 + h <= viewTop + viewH; const above = anchorTop - 2 - h >= viewTop;
    pop.style.top = (below || !above ? top + 2 : anchorTop - 2 - h) + 'px';
    const pageW = document.documentElement.clientWidth / zoom;
    const width = Math.min(Math.max(b.w, 260), 420, pageW - 16);
    pop.style.minWidth = width + 'px';
    pop.style.maxWidth = Math.min(420, pageW - 16) + 'px';
    pop.style.left = Math.max(8, Math.min(b.x, pageW - width - 8)) + 'px';
  }
  function show(el, kind, items, line) {
    if (!items.length || document.activeElement !== el) return close();
    cur = { el, kind, items, sel: -1, line };
    pop.innerHTML = items.map((it, i) => `<li role="option" data-i="${i}"><span class="oa-main">${it.nr !== undefined
      ? `${it.nr ? `<b>${esc(it.nr)}</b> ` : ''}${esc(it.omschrijving)}${it.prijs ? ` <span class="oa-price">€ ${esc(it.prijs)}</span>` : ''}`
      : esc(it.text)}</span>${it.note ? `<span class="oa-note">${esc(it.note)}</span>` : ''}</li>`).join('')
      + '<li class="oa-foot" aria-hidden="true">↑↓ kiezen · Enter overnemen · Esc sluiten</li>';
    pop.hidden = false;
    position(el, line ? line.index : undefined);
  }
  function mark(i) {
    if (!cur) return;
    cur.sel = (i + cur.items.length) % cur.items.length;
    pop.querySelectorAll('li[data-i]').forEach((li) => li.classList.toggle('is-sel', Number(li.dataset.i) === cur.sel));
  }
  function pick(i) {
    if (!cur) return;
    const { el, kind, items, line } = cur; const it = items[i];
    close();
    if (kind === 'onderdeel') {
      const row = el.closest('tr');
      const f = (k) => row.querySelector(`[name$="[${k}]"]`);
      setField(f('nr'), it.nr, { force: el === f('nr') });
      setField(f('omschrijving'), it.omschrijving, { force: el === f('omschrijving') });
      setField(f('prijs'), it.prijs);
      if (f('aantal') && !f('aantal').value) setField(f('aantal'), '1');
      (f('aantal') || el).focus();
    } else if (kind === 'werk') {
      const v = el.value;
      el.value = v.slice(0, line.start) + it.text + v.slice(line.end);
      const caret = line.start + it.text.length;
      el.setSelectionRange(caret, caret);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      setField(el, it.text, { force: true });
      // Bandenmaat: dezelfde maat op het andere wiel van dezelfde as, als dat nog leeg is. Merk: op alle lege wielen.
      const m = /\[banden\]\[(lv|rv|la|ra)\]\[(maat|merk)\]/.exec(el.name);
      if (m) {
        const pair = { lv: ['rv'], rv: ['lv'], la: ['ra'], ra: ['la'] }[m[1]];
        for (const w of m[2] === 'merk' ? WHEELS : pair) setField(tyreInput(w, m[2]), it.text);
      }
      render();
    }
  }
  pop.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); pick(Number(li.dataset.i)); } });

  function kindOf(el) {
    if (!el.name || el.disabled || el.readOnly) return null;
    if (/^d\[onderdelen\]\[\d+\]\[(nr|omschrijving)\]$/.test(el.name)) return 'onderdeel';
    if (el.name === 'd[werk_omschrijving]') return 'werk';
    if (/\[banden\]\[\w+\]\[maat\]$/.test(el.name)) return 'bandmaat';
    if (/\[banden\]\[\w+\]\[merk\]$/.test(el.name)) return 'bandmerk';
    return null;
  }
  function currentLine(el) {
    const v = el.value; const caret = el.selectionStart;
    const start = v.lastIndexOf('\n', caret - 1) + 1; let end = v.indexOf('\n', caret); if (end < 0) end = v.length;
    return { start, end, text: v.slice(start, caret), index: v.slice(0, start).split('\n').length - 1 };
  }
  if (editable) form.addEventListener('input', (e) => {
    const el = e.target; const kind = kindOf(el);
    if (!kind || !e.isTrusted) return;
    const line = kind === 'werk' ? currentLine(el) : null;
    const q = (line ? line.text : el.value).replace(/^[-–•*\s]+/, '').trim();
    clearTimeout(timer);
    if (q.length < 2) return close();
    timer = setTimeout(async () => {
      if (ctrl) ctrl.abort();
      ctrl = new AbortController();
      try {
        const r = await (await fetch(`/werkopdracht/suggesties?soort=${kind}&q=${encodeURIComponent(q)}`, { credentials: 'same-origin', signal: ctrl.signal })).json();
        if (line) { const p = (line.text.match(/^[-–•*\s]+/) || [''])[0]; r.items.forEach((it) => { it.text = p + it.text.replace(/^[-–•*\s]+/, ''); }); }
        show(el, kind, r.items.filter((it) => (it.text || '').trim().toLowerCase() !== q.toLowerCase()), line);
      } catch { /* afgebroken of offline */ }
    }, 160);
  });
  document.addEventListener('keydown', (e) => {
    if (!cur || pop.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); mark(cur.sel + (e.key === 'ArrowDown' ? 1 : -1)); }
    else if (e.key === 'Enter' && cur.sel >= 0) { e.preventDefault(); e.stopImmediatePropagation(); pick(cur.sel); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    else if (e.key === 'Tab') close();
  }, true);
  form.addEventListener('focusout', () => setTimeout(() => { if (cur && document.activeElement !== cur.el) close(); }, 120));
  // Toetsenbord open/dicht of de telefoon scrollt het veld in beeld: de lijst gaat mee in plaats van te verdwijnen.
  const follow = () => { if (cur && !pop.hidden) position(cur.el, cur.line ? cur.line.index : undefined); };
  window.addEventListener('resize', follow);
  if (window.visualViewport) { visualViewport.addEventListener('resize', follow); visualViewport.addEventListener('scroll', follow); }
  document.addEventListener('scroll', (e) => { if (cur && !pop.contains(e.target)) follow(); }, true);

  render();
})();
