'use strict';
/* RDW-gegevens opzoeken op het werkopdrachtformulier. */
(function () {
  const btn = document.getElementById('rdwBtn');
  const plate = document.querySelector('[data-rdw-plate]');
  if (!btn || !plate) return;
  const merk = document.querySelector('[name="d[merk_type]"]');
  const apk = document.querySelector('[name="d[apk_datum]"]');
  const deel1 = document.querySelector('[name="d[datum_deel1]"]');
  let pop = null;

  const fmt = (iso) => (iso ? iso.split('-').reverse().join('-') : '');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /* Welke uitlaatgastest hoort bij deze auto (APK)? Diesel: roetmeting. Benzine, LPG of aardgas (ook hybride): viergastest.
   * Alleen elektrisch of waterstof: geen van beide. Alleen invullen als er nog niets is aangevinkt. */
  const roet = document.querySelector('[name="d[achter][keuring][roet]"]');
  const viergas = document.querySelector('[name="d[achter][keuring][viergas]"]');
  function testFor(brandstof) {
    const b = String(brandstof || '').toLowerCase();
    if (!b) return null;
    if (/diesel/.test(b)) return 'roet';
    if (/benzine|lpg|cng|aardgas|alcohol|ethanol/.test(b)) return 'viergas';
    return 'geen';
  }
  function setTest(brandstof) {
    const t = testFor(brandstof);
    if (!t || t === 'geen' || !roet || !viergas || roet.disabled || roet.checked || viergas.checked) return false;
    const box = t === 'roet' ? roet : viergas;
    box.checked = true;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new Event('change', { bubbles: true }));
    if (window.adonisAutofilled) window.adonisAutofilled(box);
    return true;
  }

  async function fetchRdw() {
    const key = plate.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (key.length < 4) return null;
    const res = await fetch('/rdw/' + encodeURIComponent(key), { credentials: 'same-origin' });
    return res.json();
  }

  function setField(input, value) {
    if (!input || !value || input.value === value) return;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true })); // telt als wijziging (opslaan-waarschuwing, datumweergave)
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (window.adonisAutofilled) window.adonisAutofilled(input);
  }

  function closePop() {
    if (pop) { pop.remove(); pop = null; }
  }

  function showPop(html) {
    closePop();
    pop = document.createElement('div');
    pop.className = 'rdw-pop no-print';
    pop.innerHTML = '<button type="button" class="close" aria-label="Sluiten">×</button>' + html;
    document.body.append(pop);
    const r = btn.getBoundingClientRect();
    pop.style.top = window.scrollY + r.bottom + 6 + 'px';
    pop.style.left = Math.max(8, Math.min(window.scrollX + r.left - 150, window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 8)) + 'px';
    pop.querySelector('.close').addEventListener('click', closePop);
  }

  btn.addEventListener('click', async () => {
    showPop('<p class="muted">Gegevens ophalen bij de RDW…</p>');
    let r;
    try { r = await fetchRdw(); } catch { r = null; }
    if (!r) return showPop('<p>Vul eerst een geldig kenteken in.</p>');
    if (!r.ok) return showPop(`<p>${esc(r.error)}</p>`);
    const i = r.info;
    if (!i.found) return showPop(`<p>Kenteken <strong>${esc(plate.value)}</strong> is niet gevonden bij de RDW.</p>`);
    const apkTxt = r.apk ? `${fmt(i.apk)} <span class="apk-pill apk-${r.apk.cls}">${esc(r.apk.rel)}</span>` : 'onbekend';
    showPop(`
      <h3>${esc(r.merkType)}</h3>
      <dl>
        <dt>APK tot</dt><dd>${apkTxt}</dd>
        ${i.brandstof ? `<dt>Brandstof</dt><dd>${esc(i.brandstof)}${i.vermogenKw ? ` · ${i.vermogenKw} kW (${i.vermogenPk} pk)` : ''}</dd>` : ''}
        ${i.eersteToelating ? `<dt>Eerste toelating</dt><dd>${fmt(i.eersteToelating)}</dd>` : ''}
        ${i.kleur ? `<dt>Kleur</dt><dd>${esc(i.kleur)}</dd>` : ''}
        ${i.tellerstand ? `<dt>Tellerstand</dt><dd>${esc(i.tellerstand)}</dd>` : ''}
      </dl>
      ${i.terugroepactie ? '<div class="rdw-warn">⚠ Openstaande terugroepactie</div>' : ''}
      <div class="actions">
        ${merk && !merk.disabled ? '<button type="button" class="btn btn-small btn-primary" data-fill>Merk/type, APK-datum, datum deel I en uitlaatgastest invullen</button>' : ''}
        <a href="${esc(r.url)}" target="_blank" rel="noopener">Bekijken op rdw.nl</a>
      </div>`);
    const fill = pop.querySelector('[data-fill]');
    if (fill) fill.addEventListener('click', () => { setField(merk, r.merkType); setField(apk, i.apk); if (deel1 && !deel1.value) setField(deel1, i.eersteToelating); setTest(i.brandstof); closePop(); });
  });

  document.addEventListener('click', (e) => {
    if (pop && !pop.contains(e.target) && e.target !== btn) closePop();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop) { e.preventDefault(); closePop(); } });

  // Nieuw kenteken ingevuld en Merk/Type of APK-datum nog leeg: automatisch aanvullen.
  const form = plate.form;
  const autoRdw = !form || !form.dataset.autofill || form.dataset.autofill.split(' ').includes('rdw');
  plate.addEventListener('change', async () => {
    if (!autoRdw) return; // uitgezet bij Systeem → Automatisch invullen (de knop RDW werkt wel)
    const testDone = !roet || !viergas || roet.checked || viergas.checked;
    if (plate.disabled || ((merk && merk.value.trim()) && (apk && apk.value) && (!deel1 || deel1.value) && testDone)) return;
    try {
      const r = await fetchRdw();
      if (r && r.ok && r.info.found) {
        if (merk && !merk.value.trim()) setField(merk, r.merkType);
        if (apk && !apk.value) setField(apk, r.info.apk);
        if (deel1 && !deel1.value) setField(deel1, r.info.eersteToelating);
        setTest(r.info.brandstof); // achterkant: roetmeting of viergastest aanvinken
      }
    } catch { /* RDW niet bereikbaar: niets doen */ }
  });
})();
