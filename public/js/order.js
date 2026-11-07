'use strict';
(function () {
  const form = document.getElementById('orderForm');
  const toolbar = document.querySelector('.order-toolbar');
  const rowPx = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row')) || 30;

  /* ---------- meegroeiende gelinieerde tekstvakken ---------- */
  function fit(textareas, minRows) {
    const row = rowPx();
    textareas.forEach((t) => { t.style.minHeight = '0'; t.style.height = '0'; });
    let needed = 0;
    textareas.forEach((t) => { needed = Math.max(needed, t.scrollHeight); });
    const lines = Math.max(minRows, Math.ceil((needed - 1) / row));
    textareas.forEach((t) => { t.style.height = ''; t.style.minHeight = lines * row + 'px'; });
  }
  const workGroup = Array.from(document.querySelectorAll('[data-sync] textarea'));
  const fitAll = () => {
    if (workGroup.length) fit(workGroup, parseInt(workGroup[0].getAttribute('rows'), 10));
    document.querySelectorAll('.block-lines textarea').forEach((t) => fit([t], parseInt(t.getAttribute('rows'), 10)));
  };
  form.addEventListener('input', (e) => {
    if (e.target.matches('[data-sync] textarea')) fit(workGroup, parseInt(workGroup[0].getAttribute('rows'), 10));
    else if (e.target.matches('.block-lines textarea')) fit([e.target], parseInt(e.target.getAttribute('rows'), 10));
  });
  window.addEventListener('resize', fitAll);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);
  fitAll();

  /* ---------- Ja/Nee: nogmaals klikken maakt keuze ongedaan ---------- */
  document.querySelectorAll('.janee input').forEach((r) => {
    let was = false;
    r.addEventListener('pointerdown', () => { was = r.checked; });
    r.closest('label').addEventListener('click', (e) => {
      if (was) { e.preventDefault(); r.checked = false; was = false; markDirty(); }
    });
  });

  /* ---------- ordernummer ook links/achterkant tonen ---------- */
  const nrInput = form.querySelector('input[name="nummer"]');
  const mirrors = document.querySelectorAll('.mirror-nr');
  nrInput.addEventListener('input', () => mirrors.forEach((m) => { m.textContent = nrInput.value; }));

  /* ---------- totaal materiaal (aantal × prijs) ---------- */
  function num(v) {
    let s = String(v || '').replace(/[^\d.,-]/g, '');
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    return parseFloat(s);
  }
  const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
  const totalsEl = document.getElementById('totals');
  function updateTotals() {
    let total = 0;
    form.querySelectorAll('[data-price]').forEach((p) => {
      const price = num(p.value);
      if (isNaN(price)) return;
      const q = p.closest('tr').querySelector('[data-qty]');
      let qty = q ? num(q.value) : 1;
      if (isNaN(qty) || qty === 0) qty = 1;
      total += price * qty;
    });
    if (totalsEl) totalsEl.textContent = total ? 'Totaal materiaal: ' + euro.format(total) : '';
  }

  /* ---------- bandenprofiel kleuren ---------- */
  function updateTread(input) {
    const td = input.closest('td');
    const v = num(input.value);
    td.classList.toggle('tread-bad', !isNaN(v) && v < 1.6);
    td.classList.toggle('tread-warn', !isNaN(v) && v >= 1.6 && v < 3);
  }
  document.querySelectorAll('[data-tread]').forEach(updateTread);

  /* ---------- lege datumvelden ---------- */
  function updateDate(input) { input.classList.toggle('is-empty', !input.value); }
  form.querySelectorAll('input[type=date]').forEach(updateDate);

  form.addEventListener('input', (e) => {
    markDirty();
    if (e.target.matches('[data-price], [data-qty]')) updateTotals();
    if (e.target.matches('[data-tread]')) updateTread(e.target);
    if (e.target.matches('input[type=date]')) updateDate(e.target);
  });
  form.addEventListener('change', (e) => {
    markDirty();
    if (e.target.matches('input[type=date]')) updateDate(e.target);
  });
  updateTotals();

  /* ---------- niet-opgeslagen wijzigingen ---------- */
  // Na een fout, of bij een nog niet bevestigde import, is er nog niets opgeslagen.
  let dirty = document.querySelector('.alert-wide, .import-review') !== null;
  function markDirty() { dirty = true; toolbar.classList.add('dirty'); }
  window.adonisOrderDirty = () => dirty; // voor live bijwerken (live.js)
  if (dirty) toolbar.classList.add('dirty');
  window.addEventListener('beforeunload', (e) => { if (dirty && !window.adonisLeaving) { e.preventDefault(); e.returnValue = ''; } });
  // Opslaan of annuleren (na bevestiging) mag de pagina verlaten zonder waarschuwing.
  document.addEventListener('submit', (e) => { if (!e.defaultPrevented) dirty = false; });

  /* ---------- Enter springt naar volgend veld i.p.v. opslaan ---------- */
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const fields = Array.from(form.querySelectorAll('input:not([type=hidden]):not([type=radio]), textarea'));
    const next = fields[fields.indexOf(e.target) + 1];
    if (next) next.focus();
  });

  /* ---------- Ctrl/Cmd+S = opslaan ---------- */
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  const printBtn = document.getElementById('printBtn');
  if (printBtn) printBtn.addEventListener('click', () => {
    fitAll();
    window.print();
  });
  window.addEventListener('beforeprint', fitAll);
  window.addEventListener('afterprint', fitAll);
})();
