'use strict';
/* Lijst opschonen met AI: starten (met kostenschatting vooraf), voortgang volgen, en de voorstellen met de autofill-kleurveeg tonen. */
(function () {
  const box = document.querySelector('[data-listai]');
  if (!box) return;
  const lijst = box.dataset.lijst;
  const prog = box.querySelector('[data-listai-progress]');
  const fill = box.querySelector('[data-listai-fill]');
  const txt = box.querySelector('[data-listai-text]');
  const err = box.querySelector('[data-listai-error]');
  const startBtn = box.querySelector('[data-listai-start]');

  async function poll() {
    prog.hidden = false; if (startBtn) startBtn.disabled = true;
    try {
      const r = await (await fetch('/lijsten/optimaliseren/status?lijst=' + encodeURIComponent(lijst), { credentials: 'same-origin' })).json();
      const j = r.job;
      if (j && j.running) {
        const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
        fill.style.width = Math.max(4, pct) + '%';
        txt.textContent = `Claude bekijkt de lijst… ${j.done} van ${j.total} regels${j.eur ? ' · tot nu toe ' + j.eurText : ''}`;
        setTimeout(poll, 2000);
        return;
      }
      if (j && j.error) { err.textContent = j.error; err.hidden = false; prog.hidden = true; if (startBtn) startBtn.disabled = false; return; }
      fill.style.width = '100%'; txt.textContent = 'Klaar. De voorstellen worden geladen…';
      window.adonisLeaving = true; location.reload();
    } catch { setTimeout(poll, 4000); }
  }
  if (box.dataset.running) poll();
  if (startBtn) startBtn.addEventListener('click', async () => {
    err.hidden = true;
    const effort = await window.adonisAi.choose({ taak: 'lijst', params: { lijst }, title: 'Lijst laten controleren door Claude' });
    if (!effort) return;
    startBtn.disabled = true;
    try {
      const r = await fetch('/lijsten/optimaliseren', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'X-CSRF-Token': box.dataset.csrf },
        body: new URLSearchParams({ lijst, effort }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Starten lukte niet.');
      poll();
    } catch (e) { err.textContent = e.message; err.hidden = false; startBtn.disabled = false; }
  });

  /* ---------- voorstellen ---------- */
  const form = document.querySelector('[data-listai-form]');
  if (!form) return;
  const count = form.querySelector('[data-listai-count]');
  const applyBtn = form.querySelector('[data-listai-apply]');
  const update = () => {
    const n = form.querySelectorAll('input[name=k]:checked').length;
    if (count) count.textContent = n ? `${n} aangevinkt` : 'Niets aangevinkt';
    if (applyBtn) applyBtn.disabled = !n;
  };
  form.addEventListener('change', update);
  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-listai-all]');
    if (!b) return;
    form.querySelectorAll('input[name=k]:not(:disabled)').forEach((c) => { c.checked = b.dataset.listaiAll === '1'; });
    update();
  });
  update();
  // De nieuwe waarden verschijnen een voor een met de kleurveeg van automatisch invullen.
  [...form.querySelectorAll('.listai-change:not(.is-done) [data-listai-new]')].slice(0, 60).forEach((el, i) => {
    setTimeout(() => window.adonisAutofilled && window.adonisAutofilled(el), 120 + i * 70);
  });
})();
