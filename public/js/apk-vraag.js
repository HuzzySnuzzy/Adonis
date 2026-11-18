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

  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[data-apkq-ask]');
    if (!btn) return;
    const vraag = form.vraag.value.trim();
    if (vraag.length < 8) { say('Typ eerst uw vraag.'); form.vraag.focus(); return; }
    say('');
    const effort = await window.adonisAi.choose({ taak: 'apkvraag', title: 'APK-vraag' });
    if (!effort) return;
    btn.disabled = true; busy.hidden = false;
    try {
      const r = await fetch('/apk-vraag', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': form.dataset.csrf },
        body: JSON.stringify({ vraag, soort: form.soort.value, effort }),
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
