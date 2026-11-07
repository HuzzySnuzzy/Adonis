'use strict';
/* Bandenhotel en voorraad: aantal met − / + zonder de pagina te herladen, klantgegevens bij een kenteken,
 * en het profiel meteen kleuren tijdens het typen. */
(function () {
  // −/+ in de voorraadlijst
  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-qty]');
    if (!form || !window.fetch) return;
    e.preventDefault();
    const btn = e.submitter;
    if (!btn) return;
    const out = form.querySelector('.qty-n');
    const minus = form.querySelector('button[value="-1"]');
    const before = Number(out.textContent);
    const delta = Number(btn.value);
    const next = Math.max(0, before + delta);
    out.textContent = next; // meteen tonen; bij een fout terugzetten
    minus.disabled = next === 0;
    form.closest('tr').classList.toggle('is-out', next === 0);
    try {
      const res = await fetch(form.action, {
        method: 'POST', credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': form.querySelector('[name=_csrf]').value },
        body: new URLSearchParams({ delta: String(delta) }),
      });
      if (!res.ok) throw new Error();
      const r = await res.json();
      out.textContent = r.aantal;
      minus.disabled = r.aantal === 0;
      form.closest('tr').classList.toggle('is-out', r.aantal === 0 || !r.beschikbaar);
    } catch {
      out.textContent = before;
      minus.disabled = before === 0;
      alert('Het aantal kon niet worden opgeslagen. Controleer de verbinding en probeer het opnieuw.');
    }
  });

  // Kenteken ingevuld: lege klantvelden aanvullen met wat ADONIS al weet.
  const plate = document.getElementById('tyrePlate');
  if (plate) {
    const form = plate.form;
    const hint = document.getElementById('plateHint');
    const field = (n) => form.elements[`t[${n}]`];
    plate.addEventListener('change', async () => {
      const v = plate.value.trim();
      hint.textContent = '';
      if (v.replace(/[^a-z0-9]/gi, '').length < 4) return;
      try {
        const res = await fetch('/bandenhotel/klant/' + encodeURIComponent(v), { credentials: 'same-origin' });
        const r = await res.json();
        if (r.found) {
          if (!field('klant_naam').value) field('klant_naam').value = r.naam;
          if (!field('telefoon').value) field('telefoon').value = r.telefoon;
          if (!field('auto').value) field('auto').value = r.auto;
          if (r.kenteken) plate.value = r.kenteken;
          hint.textContent = 'Klant gevonden: gegevens overgenomen uit de werkopdrachten.';
        }
        if (r.opgeslagen) hint.textContent += (hint.textContent ? ' ' : '') + `Let op: er ${r.opgeslagen === 1 ? 'staat al 1 set' : 'staan al ' + r.opgeslagen + ' sets'} van dit kenteken in opslag.`;
      } catch { /* niet erg */ }
    });
  }

  // Profiel kleuren tijdens het typen (zelfde grenzen als op de server).
  document.querySelectorAll('.tread-input').forEach((input) => {
    const season = input.form.elements['t[seizoen]'];
    const paint = () => {
      const n = parseFloat(input.value.replace(',', '.'));
      const warn = season && /winter/i.test(season.value) ? 4 : 3;
      input.classList.remove('tread-ok', 'tread-warn', 'tread-bad');
      if (!Number.isNaN(n)) input.classList.add(n < 1.6 ? 'tread-bad' : n < warn ? 'tread-warn' : 'tread-ok');
    };
    input.addEventListener('input', paint);
    if (season) season.addEventListener('input', paint);
  });
})();
