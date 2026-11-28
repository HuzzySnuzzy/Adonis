'use strict';
/* Banden importeren met foto's: foto's kiezen en verkleinen, laten lezen door Claude, wachten, en controleren. */
(function () {
  /* ---------- 1. foto's kiezen ---------- */
  const pick = document.querySelector('[data-tp-pick]');
  if (pick) {
    const max = Number(pick.dataset.max) || 40;
    const thumbs = pick.querySelector('[data-tp-thumbs]');
    const count = pick.querySelector('[data-tp-count]');
    const start = pick.querySelector('[data-tp-start]');
    const err = pick.querySelector('[data-tp-error]');
    const list = []; // { full, thumb, name }
    const say = (t) => { err.textContent = t; err.hidden = !t; };
    const show = () => {
      count.textContent = list.length ? `${list.length} foto${list.length === 1 ? '' : "'s"} gekozen (maximaal ${max}).` : `Nog geen foto's (maximaal ${max}).`;
      start.disabled = !list.length;
      start.lastChild.textContent = ` Labels laten lezen${list.length ? ` (${list.length} foto${list.length === 1 ? '' : "'s"})` : ''}`;
    };
    async function add(file) {
      const P = window.adonisPhotoCanvas;
      const bmp = await P.loadBitmap(file);
      const big = P.canvasOf(bmp, 1600); const small = P.canvasOf(bmp, 360);
      if (bmp.close) bmp.close();
      const item = { full: big.toDataURL('image/jpeg', 0.82), thumb: small.toDataURL('image/jpeg', 0.75), name: file.name || 'foto' };
      list.push(item);
      const fig = document.createElement('figure'); fig.className = 'tp-thumb';
      const img = document.createElement('img'); img.src = item.thumb; img.alt = item.name;
      const del = document.createElement('button'); del.type = 'button'; del.className = 'thumb-del'; del.textContent = '×'; del.setAttribute('aria-label', 'Foto weghalen');
      del.addEventListener('click', () => { list.splice(list.indexOf(item), 1); fig.remove(); show(); });
      fig.append(img, del); thumbs.append(fig);
    }
    pick.addEventListener('change', async (e) => {
      const input = e.target.closest('[data-tp-input]');
      if (!input) return;
      const files = [...input.files]; input.value = '';
      say('');
      for (const f of files) {
        if (list.length >= max) { say(`Maximaal ${max} foto's tegelijk.`); break; }
        try { await add(f); } catch (ex) { say(`${f.name}: ${ex.message}`); }
        show();
      }
    });
    start.addEventListener('click', async () => {
      if (!list.length) return;
      const effort = await window.adonisAi.choose({ taak: 'bandenfotos', params: { n: list.length }, title: "Labels laten lezen" });
      if (!effort) return;
      start.disabled = true; say('');
      count.textContent = 'Foto\'s versturen…';
      try {
        const r = await fetch('/bandenhotel/foto-import', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': pick.dataset.csrf },
          body: JSON.stringify({ images: list, effort }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Versturen lukte niet.');
        window.adonisLeaving = true; location.href = j.url;
      } catch (ex) { say(ex.message); start.disabled = false; show(); }
    });
    show();
  }

  /* ---------- 2. wachten tot Claude klaar is ---------- */
  const wait = document.querySelector('[data-tp-wait]');
  if (wait) {
    const fill = wait.querySelector('[data-tp-fill]'); const txt = wait.querySelector('[data-tp-progress]');
    const tick = async () => {
      try {
        const s = await (await fetch(`/bandenhotel/foto-import/${wait.dataset.tpWait}/status`, { credentials: 'same-origin' })).json();
        if (s.status !== 'bezig') { window.adonisLeaving = true; location.reload(); return; }
        txt.textContent = `${s.done} van ${s.total} foto's gelezen.`;
        fill.style.setProperty('width', Math.max(4, Math.round((s.done / s.total) * 100)) + '%');
      } catch { /* even geen verbinding */ }
      setTimeout(tick, 2000);
    };
    setTimeout(tick, 1500);
  }

  /* ---------- 3. controleren: kenteken aangepast? Opnieuw opzoeken. ---------- */
  const review = document.querySelector('[data-tp-review]');
  if (review) {
    review.addEventListener('change', async (e) => {
      const plate = e.target.closest('[data-tp-plate], [data-tp-naam]');
      if (!plate) return;
      const row = plate.closest('[data-tp-row]');
      const k = row.querySelector('[data-tp-plate]').value; const n = row.querySelector('[data-tp-naam]').value;
      const st = row.querySelector('[data-tp-status]');
      try {
        const m = await (await fetch('/bandenhotel/foto-import/kenteken?' + new URLSearchParams({ kenteken: k, naam: n }), { credentials: 'same-origin' })).json();
        st.textContent = '';
        const tag = (cls, t) => { const s = document.createElement('span'); s.className = 'tp-tag ' + cls; s.textContent = t; return s; };
        if (m.klant) { st.append(tag('tp-known', 'Bekende klant'), ' ' + (m.klant.naam || m.klant.kenteken)); }
        else if (k || n) st.append(tag('tp-new', 'Nieuwe klant'), ' wordt toegevoegd aan Klanten');
        if (m.opgeslagen) { st.append(document.createElement('br'), tag('tp-warn', 'Staat al in het bandenhotel'), m.opgeslagen.locatie ? ' · ' + m.opgeslagen.locatie : ''); }
        row.classList.toggle('is-dup', !!m.opgeslagen);
      } catch { /* niet erg */ }
    });
    // Aantal aangevinkt op de knop.
    const btn = review.querySelector('.tp-actions .btn-primary');
    const upd = () => { const n = review.querySelectorAll('input[name$="[mee]"]:checked').length; btn.textContent = n ? `${n} set${n === 1 ? '' : 's'} toevoegen aan het bandenhotel` : 'Niets aangevinkt'; btn.disabled = !n; };
    review.addEventListener('change', (e) => { if (e.target.name && e.target.name.endsWith('[mee]')) upd(); });
    upd();
  }
})();
