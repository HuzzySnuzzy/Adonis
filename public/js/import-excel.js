'use strict';
/* Excel-import: bestand uploaden, en op de controlepagina rijen kiezen en de indeling bijwerken. */
(function () {
  /* ---------- uploaden ---------- */
  const card = document.getElementById('excelCard');
  if (card) {
    const input = document.getElementById('excelInput');
    const start = document.getElementById('excelStart');
    const name = document.getElementById('excelName');
    const err = document.getElementById('excelError');
    const busy = document.getElementById('excelBusy');
    const claude = document.getElementById('useClaude');
    const maxBytes = Number(card.dataset.max) * 1024 * 1024;
    let file = null;
    const showError = (msg) => { err.textContent = msg; err.hidden = !msg; };
    input.addEventListener('change', () => {
      file = input.files[0] || null;
      showError('');
      name.hidden = !file;
      name.textContent = file ? `${file.name} (${Math.max(1, Math.round(file.size / 1024))} kB)` : '';
      if (file && file.size > maxBytes) { showError(`Het bestand is te groot (max. ${card.dataset.max} MB).`); file = null; }
      start.disabled = !file;
    });
    start.addEventListener('click', async () => {
      if (!file) return;
      const withClaude = claude && claude.checked && !claude.disabled;
      // Eerst kiezen hoeveel moeite Claude mag doen (met kostenschatting).
      let effort = '';
      if (withClaude && window.adonisAi) {
        effort = await window.adonisAi.choose({ taak: 'excel', params: { bytes: file.size }, title: 'Excel-lijst laten beoordelen' });
        if (!effort) return;
      }
      start.disabled = true;
      busy.hidden = false;
      showError('');
      document.getElementById('excelBusyText').textContent = withClaude ? 'Claude bekijkt het bestand…' : 'Bezig met inlezen…';
      document.getElementById('excelBusySub').textContent = withClaude ? 'Dit duurt meestal 30 seconden tot 2 minuten. Laat deze pagina open.' : 'Laat deze pagina open.';
      try {
        const res = await fetch('/importeren/excel' + (withClaude ? '?effort=' + encodeURIComponent(effort) : '?claude=0'), {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': card.dataset.csrf, 'X-Filename': encodeURIComponent(file.name) },
          body: file,
        });
        const r = await res.json().catch(() => ({ error: 'Onverwacht antwoord van de server.' }));
        if (!res.ok || !r.redirect) throw new Error(r.error || 'Er ging iets mis.');
        window.location.href = r.redirect;
      } catch (e) {
        showError(e.message);
        busy.hidden = true;
        start.disabled = false;
      }
    });
  }

  /* ---------- controlepagina ---------- */
  const form = document.getElementById('reviewForm');
  if (!form) return;
  const total = document.getElementById('totalOn');
  const anker = document.getElementById('anker');

  function recount() {
    let all = 0;
    form.querySelectorAll('[data-rows]').forEach((block) => {
      const n = block.querySelectorAll('input[type=checkbox][name$="[rij][]"]:checked').length;
      block.querySelector('[data-on-count]').textContent = n;
      all += n;
    });
    if (total) total.textContent = all;
  }
  form.addEventListener('change', (e) => {
    if (e.target.matches('input[type=checkbox][name$="[rij][]"]')) recount();
    if (e.target.matches('[data-only-flagged]')) {
      const block = e.target.closest('[data-rows]');
      block.classList.toggle('only-flagged', e.target.checked);
    }
    // Ander doel of andere kolom: meteen het voorbeeld bijwerken.
    if (e.target.matches('select[data-replan]')) {
      anker.value = e.target.closest('[data-sheet]').dataset.sheet;
      document.getElementById('replanBtn').click();
    }
  });
  form.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-all]');
    if (!b) return;
    const block = b.closest('[data-rows]');
    const onlyVisible = block.classList.contains('only-flagged');
    block.querySelectorAll('tbody tr').forEach((tr) => {
      if (onlyVisible && !tr.hasAttribute('data-flagged')) return;
      tr.querySelector('input[type=checkbox]').checked = b.dataset.all === '1';
    });
    recount();
  });

  // Bij verzenden: de gekozen rijen compact als "2,3,5-9" (anders worden het duizenden losse velden).
  form.addEventListener('submit', (e) => {
    const sub = e.submitter;
    if (sub && sub.id === 'confirmBtn') {
      const n = Number(total.textContent);
      if (!window.confirm(n ? `${n} rijen importeren?` : 'Er zijn geen rijen aangevinkt. Toch doorgaan?')) { e.preventDefault(); return; }
    }
    if (sub && sub.id === 'replanBtn' && !anker.value) {
      // Terugkomen bij het blad dat in beeld was.
      const cards = [...form.querySelectorAll('[data-sheet]')];
      const visible = cards.find((c) => c.getBoundingClientRect().bottom > 80) || cards[0];
      if (visible) anker.value = visible.dataset.sheet;
    }
    form.querySelectorAll('[data-rows]').forEach((block) => {
      const boxes = [...block.querySelectorAll('input[type=checkbox][name$="[rij][]"]')];
      const nums = boxes.filter((b) => b.checked).map((b) => Number(b.value)).sort((a, b) => a - b);
      const parts = [];
      for (let i = 0; i < nums.length; i++) {
        let j = i;
        while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
        parts.push(j > i ? `${nums[i]}-${nums[j]}` : String(nums[i]));
        i = j;
      }
      const keuze = block.querySelector('[data-keuze]');
      keuze.value = parts.join(',');
      keuze.disabled = false;
      boxes.forEach((b) => { b.disabled = true; });
    });
    window.adonisLeaving = true;
    // Na terug-navigeren (bfcache) moeten de vinkjes weer werken.
    setTimeout(() => form.querySelectorAll('input[type=checkbox][name$="[rij][]"]').forEach((b) => { b.disabled = false; }), 0);
  });
})();
