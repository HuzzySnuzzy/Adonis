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
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // "1.250" = duizend tweehonderdvijftig
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
  // (Een <form method="dialog"> – plaknotitie, Claude-venster – verlaat de pagina niet.)
  document.addEventListener('submit', (e) => { if (!e.defaultPrevented && e.target.method !== 'dialog') dirty = false; });

  /* ---------- concept bewaren op dit apparaat ----------
   * Wat er wordt getypt, wordt elke seconde op dit apparaat bewaard. Sluit de pagina per ongeluk, is de
   * sessie verlopen of mislukt het opslaan, dan biedt de volgende keer "Terugzetten" aan. Na een geslaagd
   * opslaan (groene melding) wordt het concept weer verwijderd. */
  (function drafts() {
    if (!window.localStorage || form.querySelector('fieldset:disabled')) return;
    const KEY = 'adonis-concept:' + new URL(form.action, location.href).pathname;
    const SKIP = /^(_csrf|versie|zonder_factuurnr|nummer)$/; // nummer niet: dat kan intussen door een ander zijn gebruikt
    const MAX_AGE = 7 * 24 * 3600 * 1000;
    const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
    const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* vol of geblokkeerd */ } };
    const remove = (k) => { try { localStorage.removeItem(k); } catch { /* geblokkeerd */ } };
    function snapshot() {
      const out = {};
      for (const el of form.elements) {
        if (!el.name || SKIP.test(el.name) || el.type === 'submit' || el.type === 'button' || el.type === 'file') continue;
        out[el.name] = el.type === 'checkbox' || el.type === 'radio' ? (el.checked ? el.value || 'on' : (out[el.name] ?? null)) : el.value;
      }
      return out;
    }
    function apply(values) {
      for (const el of form.elements) {
        if (!el.name || !(el.name in values) || SKIP.test(el.name)) continue;
        if (el.type === 'checkbox' || el.type === 'radio') el.checked = values[el.name] === (el.value || 'on');
        else el.value = values[el.name] ?? '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      updateTotals();
    }
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    // Opruimen: na een geslaagd opslaan, en concepten ouder dan een week.
    try {
      const ok = document.querySelector('.flash-ok');
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith('adonis-concept:')) continue;
        const d = read(k);
        if (!d || Date.now() - d.t > MAX_AGE || (ok && d.submitted)) remove(k);
      }
    } catch { /* geblokkeerd */ }
    const initial = snapshot();
    const saved = read(KEY);
    if (saved && saved.values && !same(saved.values, initial)) {
      const when = new Date(saved.t);
      const today = new Date().toDateString() === when.toDateString();
      const time = when.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
      const bar = document.createElement('div');
      bar.className = 'draft-banner no-print';
      bar.innerHTML = '<span></span><button type="button" class="btn btn-primary">Terugzetten</button><button type="button" class="btn">Weggooien</button>';
      bar.querySelector('span').textContent = `Er is een niet-opgeslagen versie van deze werkopdracht bewaard (${today ? 'vandaag' : when.toLocaleDateString('nl-NL')} om ${time}). Wilt u die terugzetten?`;
      const [restore, discard] = bar.querySelectorAll('button');
      restore.addEventListener('click', () => { apply(saved.values); markDirty(); bar.remove(); });
      discard.addEventListener('click', () => {
        if (!window.confirm('De bewaarde versie weggooien? Dit kan niet ongedaan worden gemaakt.')) return;
        remove(KEY); bar.remove();
      });
      toolbar.after(bar);
    }
    let timer = null;
    const store = (extra = {}) => {
      const values = snapshot();
      if (same(values, initial) && !extra.submitted) return;
      write(KEY, { t: Date.now(), values, ...extra });
    };
    form.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(store, 800); });
    form.addEventListener('change', () => { clearTimeout(timer); timer = setTimeout(store, 300); });
    // Bij opslaan: bewaren met een vlag; pas na de groene melding wordt het verwijderd.
    form.addEventListener('submit', () => { clearTimeout(timer); store({ submitted: true }); });
  })();

  /* ---------- Enter springt naar volgend veld i.p.v. opslaan ---------- */
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const fields = Array.from(form.querySelectorAll('input:not([type=hidden]):not([type=radio]), textarea'));
    const next = fields[fields.indexOf(e.target) + 1];
    if (next) next.focus();
  });

  /* ---------- gefactureerd zonder factuurnummer: eerst bevestigen ---------- */
  form.addEventListener('submit', (e) => {
    const btn = e.submitter;
    if (!btn || btn.value !== 'gefactureerd') return;
    const nr = form.querySelector('[name="d[faktuurnr]"]');
    const flag = form.querySelector('[name=zonder_factuurnr]');
    if (nr && !nr.value.trim()) {
      if (!window.confirm('Er is geen factuurnummer ingevuld (onderaan: "Berekend op faktuurnr.").\n\nToch als gefactureerd afronden?')) {
        e.preventDefault();
        nr.focus();
        return;
      }
      flag.value = '1';
    }
  }, true);

  /* ---------- Ctrl/Cmd+S = opslaan ---------- */
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (form.querySelector('fieldset:disabled')) return; // alleen-lezen
      form.requestSubmit();
    }
  });

  const printBtn = document.getElementById('printBtn');
  if (printBtn) printBtn.addEventListener('click', () => {
    fitAll();
    // In de ADONIS-app: eigen afdrukvoorbeeld (A4 liggend, met grijze vakken); anders het afdrukscherm van de browser.
    if (window.adonisApp && window.adonisApp.print) window.adonisApp.print(); else window.print();
  });
  window.addEventListener('beforeprint', fitAll);
  window.addEventListener('afterprint', fitAll);
})();
