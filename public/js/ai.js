'use strict';
/* Claude-taken: eerst de inspanning kiezen (met kostenschatting), dan pas uitvoeren.
 * window.adonisAi.choose({ taak, params, title }) -> Promise<'laag'|'normaal'|'hoog'|null>
 * Knoppen met data-ai-task voeren hun taak daarna zelf uit (POST naar data-ai-action). */
(function () {
  const csrf = (document.querySelector('input[name="_csrf"]') || {}).value
    || (document.querySelector('[data-csrf]') || { dataset: {} }).dataset.csrf || '';
  const remember = (taak, key) => { try { localStorage.setItem('adonis-ai-' + taak, key); } catch { /* geen opslag */ } };
  const remembered = (taak) => { try { return localStorage.getItem('adonis-ai-' + taak); } catch { return null; } };

  let dlg = null;
  function dialog() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.className = 'swap-dialog ai-dialog';
    dlg.innerHTML = `
      <form method="dialog" class="swap-form">
        <h1 data-ai-h>Claude</h1>
        <p class="muted" data-ai-detail></p>
        <fieldset class="swap-step">
          <legend>Hoeveel moeite mag Claude doen?</legend>
          <div data-ai-levels></div>
        </fieldset>
        <p class="muted small">Schatting vooraf: hoeveel Claude nadenkt verschilt per opdracht. De werkelijke kosten ziet u daarna
          (en bij Systeem). Bedragen zijn bij benadering, in euro's.</p>
        <p class="alert" data-ai-error hidden></p>
        <div class="swap-actions">
          <button class="btn" value="annuleren" type="submit" data-ai-cancel>Annuleren</button>
          <button class="btn btn-primary" value="start" type="submit" data-ai-start>Starten</button>
        </div>
      </form>`;
    document.body.append(dlg);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('annuleren'); });
    return dlg;
  }

  async function choose({ taak, params = {}, title = 'Claude' }) {
    const d = dialog();
    d.querySelector('[data-ai-h]').textContent = title;
    const levelsBox = d.querySelector('[data-ai-levels]');
    const err = d.querySelector('[data-ai-error]');
    const start = d.querySelector('[data-ai-start]');
    levelsBox.innerHTML = '<p class="muted">Kosten berekenen…</p>';
    d.querySelector('[data-ai-detail]').textContent = '';
    err.hidden = true;
    start.disabled = true;
    d.returnValue = '';
    d.showModal();
    try {
      const res = await fetch('/ai/schatting?' + new URLSearchParams({ taak, ...params }), { credentials: 'same-origin' });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || 'De schatting lukte niet.');
      d.querySelector('[data-ai-detail]').textContent = r.detail;
      const pick = remembered(taak) || r.aanbevolen;
      levelsBox.innerHTML = '';
      for (const l of r.levels) {
        const lab = document.createElement('label');
        lab.className = 'swap-choice ai-level';
        const input = document.createElement('input');
        input.type = 'radio'; input.name = 'ai-level'; input.value = l.key; input.checked = l.key === pick;
        const body = document.createElement('span');
        const head = document.createElement('b');
        head.textContent = l.label + (l.key === r.aanbevolen ? ' (aanbevolen)' : '');
        const price = document.createElement('span');
        price.className = 'ai-price';
        price.textContent = l.prijs;
        const sub = document.createElement('span');
        sub.className = 'muted small';
        sub.textContent = `${l.uitleg} Duur: ${l.tijd}.`;
        body.append(head, price, document.createElement('br'), sub);
        lab.append(input, body);
        levelsBox.append(lab);
      }
      start.disabled = false;
      (levelsBox.querySelector('input:checked') || start).focus();
    } catch (e) {
      levelsBox.innerHTML = '';
      err.textContent = e.message;
      err.hidden = false;
    }
    const answer = await new Promise((ok) => d.addEventListener('close', () => ok(d.returnValue), { once: true }));
    if (answer !== 'start') return null;
    const chosen = levelsBox.querySelector('input:checked');
    if (!chosen) return null;
    remember(taak, chosen.value);
    return chosen.value;
  }
  window.adonisAi = { choose };

  /* ----- knoppen: kiezen, dan uitvoeren ----- */
  function busy(text) {
    let el = document.querySelector('.ai-busy');
    if (!el) {
      el = document.createElement('div');
      el.className = 'ai-busy';
      el.innerHTML = '<div class="ai-busy-card"><div class="spinner"></div><p data-t></p><p class="muted small">Laat deze pagina open. Dit duurt meestal 10 seconden tot een minuut.</p></div>';
      document.body.append(el);
    }
    el.querySelector('[data-t]').textContent = text;
    el.hidden = false;
    return el;
  }
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-ai-task]');
    if (!btn) return;
    e.preventDefault();
    const taak = btn.dataset.aiTask;
    const effort = await choose({ taak, params: btn.dataset.aiId ? { id: btn.dataset.aiId } : {}, title: btn.dataset.aiTitle || 'Claude' });
    if (!effort) return;
    if (btn.hasAttribute('data-ai-bulk')) {
      const res = await fetch(btn.dataset.aiAction, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'X-CSRF-Token': csrf }, body: new URLSearchParams({ effort }) });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) { alert(r.error || 'Starten lukte niet.'); return; }
      pollJob();
      return;
    }
    const overlay = busy(btn.dataset.aiBusy || 'Claude leest de werkopdrachten…');
    try {
      const res = await fetch(btn.dataset.aiAction, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'X-CSRF-Token': csrf }, body: new URLSearchParams({ effort }) });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || 'Er ging iets mis.');
      window.adonisLeaving = true;
      try { localStorage.setItem('adonis-open-' + (btn.closest('[data-remember]') || {}).dataset?.remember, '1'); } catch { /* geen opslag */ }
      location.hash = btn.dataset.aiAnchor || 'aandachtspunten';
      location.reload();
    } catch (err) {
      overlay.hidden = true;
      alert(err.message);
    }
  });

  /* ----- inklapbare vakken: open/dicht onthouden; via een #-link altijd open ----- */
  function restoreBoxes() {
    document.querySelectorAll('details[data-remember]').forEach((d) => {
      let v = null;
      try { v = localStorage.getItem('adonis-open-' + d.dataset.remember); } catch { /* geen opslag */ }
      if (location.hash === '#' + d.id || v === '1') d.open = true;
      if (d.dataset.bound) return;
      d.dataset.bound = '1';
      d.addEventListener('toggle', () => { try { localStorage.setItem('adonis-open-' + d.dataset.remember, d.open ? '1' : '0'); } catch { /* geen opslag */ } });
    });
  }
  restoreBoxes();
  document.addEventListener('adonis:swapped', restoreBoxes);

  /* ----- voortgang "alle klanten" ----- */
  const jobBox = document.querySelector('[data-ai-job]');
  let polling = false;
  async function pollJob() {
    if (!jobBox || polling) return;
    polling = true;
    try {
      for (;;) {
        const r = await (await fetch('/aandachtspunten/taak', { credentials: 'same-origin' })).json();
        const j = r.job;
        if (!j) { jobBox.hidden = true; break; }
        jobBox.hidden = false;
        const pct = j.total ? Math.round((j.done / j.total) * 100) : 100;
        jobBox.replaceChildren();
        const t = document.createElement('div');
        t.textContent = j.running
          ? `✨ Claude analyseert klanten: ${j.done} van ${j.total} (${j.points} aandachtspunten, tot nu toe ${j.eurText}).`
          : `✨ Klaar: ${j.done} klant${j.done === 1 ? '' : 'en'} geanalyseerd, ${j.points} aandachtspunten gevonden (kosten ${j.eurText})${j.failed ? `, ${j.failed} mislukt` : ''}${j.stop && j.done < j.total ? ' – gestopt' : ''}.`;
        const bar = document.createElement('div'); bar.className = 'ai-job-bar';
        const fill = document.createElement('i'); fill.style.width = pct + '%'; bar.append(fill);
        jobBox.append(t, bar);
        if (j.running) {
          const stop = document.createElement('button');
          stop.className = 'btn btn-small'; stop.type = 'button'; stop.textContent = 'Stoppen';
          stop.addEventListener('click', () => fetch('/aandachtspunten/stoppen', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf } }));
          jobBox.append(stop);
        } else if (j.errors && j.errors.length) {
          const p = document.createElement('p'); p.className = 'muted small'; p.textContent = 'Laatste fout: ' + j.errors[j.errors.length - 1]; jobBox.append(p);
        }
        if (!j.running) break;
        await new Promise((ok) => setTimeout(ok, 2500));
      }
    } catch { /* volgende keer */ }
    polling = false;
  }
  if (jobBox) pollJob();

  /* ----- zoekwoorden uitproberen ----- */
  const test = document.querySelector('[data-syn-test]');
  if (test) {
    const out = document.querySelector('[data-syn-result]');
    let t = null;
    test.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const q = test.value.trim();
        if (!q) { out.textContent = 'Hier ziet u op welke woorden ADONIS dan ook zoekt.'; return; }
        const r = await (await fetch('/zoekwoorden/test?q=' + encodeURIComponent(q), { credentials: 'same-origin' })).json();
        out.textContent = r.parts.map((p) => (p.group ? `“${p.term}” (${p.group}): ` : `“${p.term}”: alleen dit woord – `) + p.alts.join(', ')).join('  ·  ');
      }, 200);
    });
  }
  // Verwijderknop die eerst vraagt (formaction)
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-confirm-click]');
    if (b && !window.confirm(b.dataset.confirmClick)) e.preventDefault();
  });
})();
