'use strict';
/* Sjablonen op de werkopdracht: een voorgevulde werkopdracht invullen (alleen lege regels/vakken) of de huidige
 * werkopdracht als sjabloon bewaren (zonder klant, auto, datums en km-standen; dat doet de server). */
(function () {
  const form = document.getElementById('orderForm');
  const menu = document.querySelector('[data-tpl-menu]');
  if (!form || !menu) return;
  const csrf = form.querySelector('[name=_csrf]').value;
  const field = (name) => form.querySelector(`[name="${name}"]`);
  function set(el, v) {
    if (!el || v === undefined || v === null || v === '' || v === false) return;
    if (el.type === 'checkbox') { if (!el.checked) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); } return; }
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    if (window.adonisAutofilled) window.adonisAutofilled(el);
  }
  const fill = (name, v) => { const el = field(name); if (el && (el.type === 'checkbox' ? !el.checked : !el.value.trim())) set(el, v); };

  function apply(t) {
    // Onderdelen: op de eerste lege regels
    const rows = [...form.querySelectorAll('table.parts tr[data-line]')].filter((tr) => !tr.closest('[data-page]'));
    let r = 0;
    for (const p of t.onderdelen.filter((x) => x.nr || x.omschrijving || x.aantal || x.prijs)) {
      while (r < rows.length && [...rows[r].querySelectorAll('input')].some((i) => i.value.trim())) r++;
      if (r >= rows.length) break;
      for (const k of ['nr', 'omschrijving', 'aantal', 'prijs']) set(rows[r].querySelector(`[name$="[${k}]"]`), p[k]);
      r++;
    }
    // Werkzaamheden: achter wat er al staat, regels gelijk houden over de vier kolommen
    const cols = ['werk_check', 'werk_omschrijving', 'werk_code', 'werk_tijd'];
    const lines = (s) => String(s || '').replace(/\n+$/, '').split('\n');
    const wrows = [...form.querySelectorAll('[data-work-rows] .work-line')].filter((x) => !x.closest('[data-page]'));
    if (wrows.length) { // voorkant 2: regel voor regel, na de laatste ingevulde regel
      const tl = cols.map((c) => (String(t[c] || '').trim() ? lines(t[c]) : []));
      const n = Math.max(...tl.map((l) => l.length));
      let start = 0;
      wrows.forEach((row, i) => { if ([...row.querySelectorAll('input')].some((x) => x.value.trim())) start = i + 1; });
      for (let i = 0; i < n; i++) {
        const row = wrows[Math.min(start + i, wrows.length - 1)];
        cols.forEach((c, k) => {
          const v = tl[k][i]; if (!v) return;
          const el = row.querySelector(`[name$="[${c.slice(5)}]"]`);
          // Geen regels meer over: achter de laatste regel zetten (er gaat niets verloren).
          set(el, start + i >= wrows.length && el.value.trim() ? `${el.value} · ${v.trim()}` : v);
        });
      }
    }
    const used = Math.max(...cols.map((c) => { const el = field(`d[${c}]`); return el && el.value.trim() ? lines(el.value).length : 0; }));
    for (const c of wrows.length ? [] : cols) {
      const el = field(`d[${c}]`); if (!el || !String(t[c] || '').trim()) continue;
      const mine = el.value.trim() ? lines(el.value) : [];
      while (mine.length < used) mine.push('');
      set(el, [...mine, ...lines(t[c])].join('\n'));
    }
    for (const [k, v] of Object.entries(t.vloeistoffen)) for (const [f, x] of Object.entries(v)) fill(`d[vloeistoffen][${k}][${f}]`, x);
    for (const [k, x] of Object.entries(t.diversen)) fill(`d[diversen][${k}]`, x);
    fill('d[servicebeurt_km]', t.servicebeurt_km); fill('d[tarief]', t.tarief);
    // Achterkant: aantekeningen op de eerste lege regels
    const adv = [...form.querySelectorAll('[data-advies] tr[data-line]')];
    let a = 0;
    for (const x of t.achter.advies.filter((y) => y.tekst)) {
      while (a < adv.length && adv[a].querySelector('[name$="[tekst]"]').value.trim()) a++;
      if (a >= adv.length) break;
      set(adv[a].querySelector('[name$="[tekst]"]'), x.tekst); set(adv[a].querySelector('[name$="[kosten]"]'), x.kosten);
      for (const k of ['soort', 'besluit']) { const el = x[k] && adv[a].querySelector(`[name$="[${k}]"][value="${x[k]}"]`); if (el) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); } }
      a++;
    }
  }

  menu.addEventListener('click', async (e) => {
    const ap = e.target.closest('[data-tpl-apply]');
    const sv = e.target.closest('[data-tpl-save]');
    if (!ap && !sv) return;
    menu.open = false;
    if (ap) {
      try {
        const r = await fetch(`/sjablonen/${ap.dataset.tplApply}.json`, { credentials: 'same-origin' });
        if (!r.ok) throw new Error();
        apply((await r.json()).data);
      } catch { alert('Het sjabloon kon niet worden geladen.'); }
      return;
    }
    const naam = await window.adonisAsk({
      title: 'Opslaan als sjabloon', ok: 'Sjabloon opslaan', placeholder: 'bijv. Kleine beurt of Bandenwissel naar zomer',
      text: 'Onderdelen, werkzaamheden, vloeistoffen en aantekeningen worden bewaard. Klant, auto, datums en km-standen niet.',
    });
    if (!naam || !naam.trim()) return;
    const send = async (vervangen) => {
      const body = new URLSearchParams();
      for (const [k, v] of new FormData(form)) if (k.startsWith('d[')) body.append(k, v);
      body.append('naam', naam.trim()); if (vervangen) body.append('vervangen', '1');
      return fetch('/sjablonen', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'X-CSRF-Token': csrf }, body });
    };
    try {
      let r = await send(false);
      if (r.status === 409 && confirm((await r.json()).error + '\n\nVervangen door deze werkopdracht?')) r = await send(true);
      if (r.ok) alert(`Sjabloon "${naam.trim()}" opgeslagen. U vindt het voortaan onder Sjabloon op elke werkopdracht.`);
      else if (r.status !== 409) throw new Error();
    } catch { alert('Het sjabloon kon niet worden opgeslagen.'); }
  });
})();
