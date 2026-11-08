'use strict';
/* Plaknotities: knop links op het scherm. Een notitie hangt op het scherm (op elke pagina) of op een werkopdracht.
 * Bij het maken kiest u de kleur, wie hem ziet en waar hij komt. Verslepen aan de bovenrand; de plek onthoudt deze browser. */
(function () {
  if (!document.body.dataset.userId) return;
  // Bureaubladmodus: notities "op het scherm" horen bij het bureaublad, die op een werkopdracht bij dat venster.
  const inWindow = document.documentElement.classList.contains('in-window');
  const csrf = (document.querySelector('input[name="_csrf"]') || {}).value
    || (document.querySelector('[data-csrf]') || { dataset: {} }).dataset.csrf || '';
  const liveOrder = document.getElementById('live-order');
  const orderId = liveOrder ? liveOrder.dataset.id : '';
  const COLORS = { geel: 'Geel', roze: 'Roze', blauw: 'Blauw', groen: 'Groen', oranje: 'Oranje', paars: 'Paars' };
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('adonis-note-' + k)); } catch { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem('adonis-note-' + k); else localStorage.setItem('adonis-note-' + k, JSON.stringify(v)); } catch { /* geen opslag */ } },
  };
  const post = async (url, data) => {
    const res = await fetch(url, { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'X-CSRF-Token': csrf }, body: new URLSearchParams(data) });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(r.error || 'Opslaan lukte niet.');
    return r;
  };
  const svg = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICON = {
    note: '<path d="M5 3.5h14v11l-5 5.5H5z"/><path d="M14 20v-5.5h5"/><path d="M8.5 8h7M8.5 11.5h4.5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    eyeOff: '<path d="M3 3l18 18M10.6 6c.5-.1.9-.1 1.4-.1 6 0 9.5 6.1 9.5 6.1a17 17 0 0 1-3 3.6M6.4 6.9C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1"/>',
  };

  /* ----- knoppen links ----- */
  const dock = document.createElement('div');
  dock.className = 'note-dock no-print';
  dock.innerHTML = `<button type="button" class="note-dock-btn" data-note-new title="Nieuwe plaknotitie" aria-label="Nieuwe plaknotitie">${svg(ICON.note)}<b>+</b></button>
    <button type="button" class="note-dock-btn" data-note-toggle hidden></button>`;
  document.body.append(dock);
  if (inWindow && !orderId) dock.hidden = true; // op het bureaublad zelf staat de knop al
  const toggleBtn = dock.querySelector('[data-note-toggle]');
  let hidden = !!store.get('hidden');
  function renderToggle() {
    const n = notes.size;
    toggleBtn.hidden = !n;
    toggleBtn.innerHTML = svg(hidden ? ICON.eyeOff : ICON.eye) + `<span class="note-count">${n}</span>`;
    toggleBtn.title = hidden ? `Notities tonen (${n})` : `Notities verbergen (${n})`;
    toggleBtn.setAttribute('aria-label', toggleBtn.title);
    toggleBtn.classList.toggle('is-off', hidden);
    document.documentElement.classList.toggle('notes-hidden', hidden);
  }
  toggleBtn.addEventListener('click', () => { hidden = !hidden; store.set('hidden', hidden || null); renderToggle(); });

  /* ----- venster bij het maken ----- */
  let dlg = null;
  function dialog() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.className = 'swap-dialog note-dialog';
    dlg.innerHTML = `<form method="dialog" class="swap-form">
      <h1>Nieuwe plaknotitie</h1>
      <textarea name="text" rows="3" maxlength="4000" placeholder="Wat wilt u onthouden? (kan ook later)"></textarea>
      <fieldset class="swap-step"><legend>Kleur</legend><div class="note-swatches">
        ${Object.entries(COLORS).map(([k, l]) => `<label class="note-swatch c-${k}" title="${l}"><input type="radio" name="color" value="${k}"${k === 'geel' ? ' checked' : ''}><span>${l}</span></label>`).join('')}
      </div></fieldset>
      <fieldset class="swap-step"><legend>Wie mag hem zien?</legend>
        <label class="swap-choice"><input type="radio" name="shared" value="0" checked><span><b>Alleen ik</b><br><span class="muted small">Een persoonlijk briefje.</span></span></label>
        <label class="swap-choice"><input type="radio" name="shared" value="1"><span><b>Iedereen op deze ADONIS</b><br><span class="muted small">Alle collega's zien hem (en kunnen hem aanvullen).</span></span></label>
      </fieldset>
      <fieldset class="swap-step" data-place><legend>Waar komt hij?</legend>
        <label class="swap-choice"><input type="radio" name="place" value="order" checked><span><b>Op deze werkopdracht</b><br><span class="muted small">Alleen te zien bij deze werkopdracht (en een briefje-teken in de lijsten).</span></span></label>
        <label class="swap-choice"><input type="radio" name="place" value="screen"><span><b>Op het scherm</b><br><span class="muted small">Op elke pagina te zien, op dezelfde plek.</span></span></label>
      </fieldset>
      <p class="alert" data-err hidden></p>
      <div class="swap-actions"><button class="btn" value="annuleren" type="submit">Annuleren</button><button class="btn btn-primary" value="ok" type="submit">Plakken</button></div>
    </form>`;
    document.body.append(dlg);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('annuleren'); });
    return dlg;
  }
  dock.querySelector('[data-note-new]').addEventListener('click', async () => {
    const d = dialog(); const f = d.querySelector('form');
    f.reset();
    const last = store.get('last') || {};
    if (last.color && COLORS[last.color]) f.elements.namedItem('color').value = last.color;
    d.querySelector('[data-place]').hidden = !orderId;
    d.querySelector('[data-err]').hidden = true;
    d.returnValue = '';
    d.showModal();
    f.elements.namedItem('text').focus();
    const answer = await new Promise((ok) => d.addEventListener('close', () => ok(d.returnValue), { once: true }));
    if (answer !== 'ok') return;
    const color = f.elements.namedItem('color').value || 'geel';
    const shared = f.elements.namedItem('shared').value;
    const onOrder = orderId && f.elements.namedItem('place').value === 'order';
    store.set('last', { color });
    try {
      const r = await post('/notities', { text: f.elements.namedItem('text').value, color, shared, werkopdracht: onOrder ? orderId : '' });
      const n = notes.size;
      const pos = onOrder
        ? { x: 80 + (n % 5) * 34, y: window.scrollY + 140 + (n % 5) * 30 }
        : { x: 80 + (n % 5) * 34, y: 110 + (n % 5) * 30 };
      store.set('pos-' + r.note.id, pos);
      if (hidden) { hidden = false; store.set('hidden', null); }
      upsert(r.note, true);
      renderToggle();
    } catch (e) { alert(e.message); }
  });

  /* ----- notities tonen ----- */
  const notes = new Map(); // id -> { el, note }
  let topZ = 60;
  function place(el, note) {
    const onOrder = !!note.order_id;
    const p = store.get('pos-' + note.id) || { x: 80, y: onOrder ? 160 : 110 };
    const maxX = (onOrder ? document.documentElement.clientWidth : window.innerWidth) - (el.offsetWidth || 230) - 4; // helemaal in beeld
    const maxY = onOrder ? Math.max(document.documentElement.scrollHeight - 60, 0) : window.innerHeight - 40;
    el.style.left = Math.max(0, Math.min(p.x, maxX)) + 'px';
    el.style.top = Math.max(onOrder ? 0 : 4, Math.min(p.y, maxY)) + 'px';
  }
  function build(note) {
    const el = document.createElement('section');
    el.className = 'sticky-note no-print';
    el.innerHTML = `<header class="sn-head" title="Slepen om te verplaatsen">
        <span class="sn-who"></span>
        <button type="button" class="sn-btn" data-sn-min aria-label="Inklappen" title="Inklappen">–</button>
        <button type="button" class="sn-btn" data-sn-menu aria-label="Opties" title="Kleur, wie ziet hem, verplaatsen, weggooien">⋯</button>
      </header>
      <textarea class="sn-text" maxlength="4000" aria-label="Tekst van de notitie" placeholder="Typ hier…"></textarea>
      <div class="sn-menu" hidden></div>`;
    const text = el.querySelector('.sn-text');
    let t = null;
    text.addEventListener('input', () => {
      clearTimeout(t);
      el.classList.add('is-saving');
      t = setTimeout(async () => {
        try { const r = await post('/notities/' + note.id, { text: text.value }); if (r.note) notes.get(note.id).note = r.note; el.classList.remove('is-saving'); }
        catch (e) { el.classList.add('is-error'); el.title = e.message; }
      }, 600);
    });
    el.addEventListener('pointerdown', () => { el.style.zIndex = ++topZ; });
    el.querySelector('[data-sn-min]').addEventListener('click', () => {
      const min = !el.classList.contains('is-min');
      el.classList.toggle('is-min', min);
      store.set('min-' + note.id, min || null);
    });
    el.querySelector('[data-sn-menu]').addEventListener('click', () => toggleMenu(el));
    drag(el);
    return el;
  }
  function fill(el, note, force) {
    el.className = `sticky-note no-print c-${note.color}${note.order_id ? ' on-order' : ''}${store.get('min-' + note.id) ? ' is-min' : ''}`;
    el.dataset.id = note.id;
    el.classList.toggle('tilt-l', note.id % 2 === 0);
    const who = el.querySelector('.sn-who');
    who.textContent = (note.shared ? (note.mine ? 'Iedereen' : note.owner || 'Collega') : 'Alleen ik') + (note.order_id ? ` · wo ${note.order_nummer}` : '');
    who.title = note.shared ? `Zichtbaar voor iedereen · gemaakt door ${note.owner || '?'}${note.editor && note.editor !== note.owner ? `, laatst aangepast door ${note.editor}` : ''}` : 'Alleen voor u zichtbaar';
    const text = el.querySelector('.sn-text');
    if (force || document.activeElement !== text) text.value = note.text;
  }
  function upsert(note, focus) {
    let item = notes.get(note.id);
    if (!item) {
      item = { el: build(note), note };
      notes.set(note.id, item);
      (note.order_id ? document.body : dock.parentNode).append(item.el);
    }
    item.note = note;
    fill(item.el, note, !focus);
    place(item.el, note);
    if (focus) { item.el.style.zIndex = ++topZ; item.el.querySelector('.sn-text').focus(); }
  }
  function remove(id) { const item = notes.get(id); if (item) { item.el.remove(); notes.delete(id); store.set('pos-' + id, null); store.set('min-' + id, null); } }

  /* ----- menu per notitie ----- */
  function toggleMenu(el) {
    const menu = el.querySelector('.sn-menu');
    if (!menu.hidden) { menu.hidden = true; return; }
    const item = notes.get(Number(el.dataset.id)); const note = item.note;
    menu.replaceChildren();
    const sw = document.createElement('div'); sw.className = 'note-swatches small';
    for (const [k, l] of Object.entries(COLORS)) {
      const b = document.createElement('button'); b.type = 'button'; b.className = `note-swatch c-${k}${k === note.color ? ' is-on' : ''}`; b.title = l; b.setAttribute('aria-label', 'Kleur ' + l);
      b.addEventListener('click', () => change(note, { color: k }));
      sw.append(b);
    }
    menu.append(sw);
    const add = (label, fn, cls) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'sn-menu-item' + (cls ? ' ' + cls : ''); b.textContent = label; b.addEventListener('click', fn); menu.append(b); };
    if (note.mine) add(note.shared ? 'Alleen voor mij maken' : 'Iedereen laten zien', () => change(note, { shared: note.shared ? '0' : '1' }));
    if (note.order_id) add('Op het scherm hangen (elke pagina)', () => move(note, ''));
    else if (orderId) add('Op deze werkopdracht plakken', () => move(note, orderId));
    if (note.canDelete) add('Weggooien', async () => {
      if (!confirm('Deze notitie weggooien?' + (note.shared ? ' Hij verdwijnt dan voor iedereen.' : ''))) return;
      try { await post('/notities/' + note.id + '/weg', {}); remove(note.id); renderToggle(); } catch (e) { alert(e.message); }
    }, 'is-danger');
    menu.hidden = false;
  }
  async function change(note, data) {
    try { const r = await post('/notities/' + note.id, data); if (r.note) upsert(r.note); } catch (e) { alert(e.message); }
  }
  async function move(note, target) {
    // Zelfde plek in beeld houden: scherm <-> pagina verschilt de schuifpositie.
    const p = store.get('pos-' + note.id) || { x: 80, y: 110 };
    store.set('pos-' + note.id, target ? { x: p.x, y: p.y + window.scrollY } : { x: p.x, y: Math.max(60, p.y - window.scrollY) });
    const item = notes.get(note.id); if (item) { item.el.remove(); notes.delete(note.id); }
    try { const r = await post('/notities/' + note.id, { werkopdracht: target }); if (r.note) upsert(r.note); } catch (e) { alert(e.message); }
    renderToggle();
  }
  document.addEventListener('pointerdown', (e) => {
    document.querySelectorAll('.sn-menu:not([hidden])').forEach((m) => { if (!m.parentNode.contains(e.target)) m.hidden = true; });
  });

  /* ----- slepen ----- */
  function drag(el) {
    const head = el.querySelector('.sn-head');
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      const sx = e.clientX - el.offsetLeft; const sy = e.clientY - el.offsetTop;
      head.setPointerCapture(e.pointerId);
      el.classList.add('is-dragging');
      const moveTo = (ev) => { el.style.left = Math.max(0, ev.clientX - sx) + 'px'; el.style.top = Math.max(0, ev.clientY - sy) + 'px'; };
      const up = () => {
        head.removeEventListener('pointermove', moveTo);
        el.classList.remove('is-dragging');
        const id = Number(el.dataset.id);
        store.set('pos-' + id, { x: el.offsetLeft, y: el.offsetTop });
        place(el, notes.get(id).note);
      };
      head.addEventListener('pointermove', moveTo);
      head.addEventListener('pointerup', up, { once: true });
      head.addEventListener('pointercancel', up, { once: true });
    });
  }
  window.addEventListener('resize', () => { for (const { el, note } of notes.values()) place(el, note); });

  /* ----- laden en live bijwerken ----- */
  async function load() {
    try {
      const r = await (await fetch('/notities' + (orderId ? '?werkopdracht=' + orderId : ''), { credentials: 'same-origin' })).json();
      const seen = new Set();
      for (const n of r.notes) { if (inWindow && !n.order_id) continue; seen.add(n.id); upsert(n); }
      for (const id of [...notes.keys()]) if (!seen.has(id)) remove(id);
    } catch { /* volgende keer */ }
    renderToggle();
  }
  document.addEventListener('adonis:notes', load);
  load();
})();
