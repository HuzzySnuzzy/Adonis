'use strict';
/* APK-vraag: inspanning kiezen (met kostenschatting), vraag versturen en wachten op het antwoord. */
(function () {
  const form = document.querySelector('[data-apkq-form]');
  const err = form && form.querySelector('[data-apkq-error]');
  const busy = form && form.querySelector('[data-apkq-busy]');
  const say = (t) => { if (!err) return; err.textContent = t; err.hidden = !t; };

  async function waitFor(id) {
    for (;;) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const r = await fetch(`/apk-vraag/${id}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        const j = await r.json();
        if (j.status !== 'bezig') { window.adonisLeaving = true; location.href = `/apk-vraag/${id}`; return; }
      } catch { /* even geen verbinding: opnieuw proberen */ }
    }
  }

  // Kenteken: meteen laten zien welke auto het is (RDW), zodat u ziet dat het klopt.
  const plate = form && form.querySelector('[data-apkq-plate]');
  const car = form && form.querySelector('[data-apkq-car]');
  const fmt = (iso) => (iso ? iso.split('-').reverse().join('-') : '');
  let lastPlate = '';
  async function showCar() {
    const k = plate.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (k === lastPlate) return; lastPlate = k;
    if (k.length < 4) { car.textContent = ''; return; }
    car.textContent = 'Gegevens ophalen bij de RDW…';
    try {
      const r = await fetch('/rdw/' + encodeURIComponent(k), { credentials: 'same-origin' });
      const j = await r.json();
      if (k !== lastPlate) return;
      if (!j.ok) { car.textContent = j.error || 'Geen gegevens van de RDW.'; return; }
      if (!j.info.found) { car.textContent = 'Dit kenteken is niet gevonden bij de RDW. Klopt het?'; return; }
      car.textContent = [j.merkType, j.info.eersteToelating ? 'eerste toelating ' + fmt(j.info.eersteToelating) : '', j.info.voertuigsoort, j.info.brandstof].filter(Boolean).join(' · ');
    } catch { car.textContent = ''; }
  }
  if (plate) {
    plate.addEventListener('input', () => { const p = plate.selectionStart; plate.value = plate.value.toUpperCase(); try { plate.setSelectionRange(p, p); } catch { /* */ } });
    plate.addEventListener('change', showCar);
    plate.addEventListener('blur', showCar);
    if (plate.value) showCar();
  }

  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[data-apkq-ask]');
    if (!btn) return;
    const vraag = form.vraag.value.trim();
    if (vraag.length < 8) { say('Typ eerst uw vraag.'); form.vraag.focus(); return; }
    if (plate.value.replace(/[^A-Za-z0-9]/g, '').length < 4) { say('Vul het kenteken in van de auto waar het om gaat.'); plate.focus(); return; }
    say('');
    const effort = await window.adonisAi.choose({ taak: 'apkvraag', title: 'APK-vraag' });
    if (!effort) return;
    btn.disabled = true; busy.hidden = false;
    try {
      const r = await fetch('/apk-vraag', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': form.dataset.csrf },
        body: JSON.stringify({ vraag, kenteken: plate.value, effort }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Versturen lukte niet.');
      waitFor(j.id);
    } catch (ex) { say(ex.message); btn.disabled = false; busy.hidden = true; }
  });

  // Antwoord nog niet klaar (bijv. pagina opnieuw geopend): wachten en dan verversen.
  const item = document.querySelector('[data-apkq-item][data-apkq-status="bezig"]');
  if (item) waitFor(item.dataset.apkqItem);
})();
