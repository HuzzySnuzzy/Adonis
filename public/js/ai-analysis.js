'use strict';
/* AI-analyse: Claude laten onderzoeken (met keuze van inspanning), scannen tonen, wijzers in het röntgenbeeld. */
(function () {
  const csrf = (document.querySelector('input[name="_csrf"]') || {}).value
    || (document.querySelector('[data-csrf]') || { dataset: {} }).dataset.csrf || '';
  const car = document.querySelector('[data-va-key]');
  const status = document.querySelector('[data-va-status]');
  const holo = car && car.querySelector('.holo');

  async function poll(key) {
    if (holo) holo.classList.add('is-scanning');
    if (status) status.hidden = false;
    let failures = 0;
    const giveUp = (msg) => { if (holo) holo.classList.remove('is-scanning'); if (status) { status.textContent = msg; status.classList.add('alert'); } };
    for (;;) {
      await new Promise((ok) => setTimeout(ok, 3000));
      let r;
      try {
        const res = await fetch('/ai-analyse/status?key=' + encodeURIComponent(key), { credentials: 'same-origin' });
        if (res.redirected || res.status === 401) return giveUp('U bent uitgelogd. Log opnieuw in en open deze pagina nog eens.');
        r = await res.json(); failures = 0;
      } catch { if (++failures >= 10) return giveUp('Geen verbinding met de server. Vernieuw de pagina (F5) om te zien of de analyse klaar is.'); continue; }
      if (!r.done) continue;
      if (r.error) {
        if (holo) holo.classList.remove('is-scanning');
        if (status) { status.textContent = r.error; status.classList.add('alert'); }
        return;
      }
      window.adonisLeaving = true;
      location.hash = 'va-car';
      location.reload();
      return;
    }
  }

  const start = document.querySelector('[data-va-start]');
  if (start) {
    start.addEventListener('click', async () => {
      const params = { kenteken: start.dataset.kenteken || '', omschrijving: start.dataset.omschrijving || '' };
      const effort = await window.adonisAi.choose({ taak: 'voertuig', params, title: 'AI-analyse van deze auto' });
      if (!effort) return;
      start.disabled = true;
      try {
        const res = await fetch('/ai-analyse', { method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'X-CSRF-Token': csrf },
          body: new URLSearchParams({ effort, ...params }) });
        const r = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(r.error || 'Starten lukte niet.');
        poll(r.key);
      } catch (e) { start.disabled = false; alert(e.message); }
    });
  }
  if (car && car.dataset.vaBusy) poll(car.dataset.vaKey);

  /* Wijzers: klikken of Enter opent het vak van dat onderdeel. */
  function openZone(z) {
    const box = document.getElementById('zone-' + z);
    if (!box) return;
    box.open = true;
    box.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    box.classList.remove('va-flash'); void box.offsetWidth; box.classList.add('va-flash');
  }
  document.addEventListener('click', (e) => { const p = e.target.closest('.h-pointer[data-zone]'); if (p) openZone(p.dataset.zone); });
  document.addEventListener('keydown', (e) => {
    const p = e.target.closest && e.target.closest('.h-pointer[data-zone]');
    if (p && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openZone(p.dataset.zone); }
  });
  // Vak openen of erover bewegen licht de wijzer op.
  document.querySelectorAll('.va-zone[id^="zone-"]').forEach((box) => {
    const z = box.id.slice(5);
    const ptr = document.querySelector(`.h-pointer[data-zone="${z}"]`);
    if (!ptr) return;
    box.addEventListener('mouseenter', () => ptr.classList.add('is-hot'));
    box.addEventListener('mouseleave', () => ptr.classList.remove('is-hot'));
  });
})();
