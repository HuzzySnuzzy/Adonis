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
  // De vier kolommen van de werkzaamheden groeien samen (per blad: de voorkant en elk vervolgblad).
  const fitGroup = (box) => { const ts = Array.from(box.querySelectorAll('textarea')); if (ts.length) fit(ts, parseInt(ts[0].getAttribute('rows'), 10)); };
  const fitAll = () => {
    form.querySelectorAll('[data-sync]').forEach(fitGroup);
    form.querySelectorAll('.block-lines textarea').forEach((t) => fit([t], parseInt(t.getAttribute('rows'), 10)));
  };
  form.addEventListener('input', (e) => {
    const group = e.target.closest && e.target.closest('[data-sync]');
    if (group) fitGroup(group);
    else if (e.target.matches('.block-lines textarea')) fit([e.target], parseInt(e.target.getAttribute('rows'), 10));
  });
  window.addEventListener('resize', fitAll);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);
  fitAll();

  /* ---------- Ja/Nee: nogmaals klikken maakt keuze ongedaan ---------- */
  document.querySelectorAll('.janee input, .cellbox input[type=radio]').forEach((r) => {
    let was = false;
    r.addEventListener('pointerdown', () => { was = r.checked; });
    r.closest('label').addEventListener('click', (e) => {
      if (was) { e.preventDefault(); r.checked = false; was = false; markDirty(); }
    });
  });

  /* ---------- ordernummer ook links/achterkant tonen ---------- */
  const nrInput = form.querySelector('input[name="nummer"]');
  nrInput.addEventListener('input', () => document.querySelectorAll('.mirror-nr').forEach((m) => { m.textContent = nrInput.value; }));

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
    if (!e.adonisRemote) markDirty();
    if (e.target.matches('[data-price], [data-qty]')) updateTotals();
    if (e.target.matches('[data-tread]')) updateTread(e.target);
    if (e.target.matches('input[type=date]')) updateDate(e.target);
  });
  form.addEventListener('change', (e) => {
    if (!e.adonisRemote) markDirty();
    if (e.target.matches('input[type=date]')) updateDate(e.target);
  });
  updateTotals();

  /* ---------- niet-opgeslagen wijzigingen ---------- */
  // Na een fout, of bij een nog niet bevestigde import, is er nog niets opgeslagen.
  let dirty = document.querySelector('.alert-wide, .import-review') !== null;
  function markDirty() { dirty = true; toolbar.classList.add('dirty'); }
  // Met automatisch opslaan (order-live.js) bepaalt dat of er nog iets niet is opgeslagen.
  const isDirty = () => (window.adonisLiveDirty ? window.adonisLiveDirty() : dirty);
  window.adonisOrderDirty = isDirty; // voor live bijwerken (live.js)
  window.adonisOrder = { fitAll, updateTotals };
  if (dirty) toolbar.classList.add('dirty');
  window.addEventListener('beforeunload', (e) => { if (isDirty() && !window.adonisLeaving) { e.preventDefault(); e.returnValue = ''; } });
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
    // Automatisch opgeslagen (order-live.js): het concept op dit apparaat is niet meer nodig.
    document.addEventListener('adonis:order-synced', () => { clearTimeout(timer); remove(KEY); });
  })();

  /* ---------- achterkant: uren en begroting rekenen mee (als hulp: alleen lege vakken krijgen een voorstel) ---------- */
  (function back() {
    const t2h = (v) => { const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(String(v || '').trim()); return m ? Number(m[1]) + Number(m[2]) / 60 : NaN; };
    const nl = (n, d = 2) => n.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
    function uur(row) {
      const van = t2h(row.querySelector('[data-van]').value); const tot = t2h(row.querySelector('[data-tot]').value);
      const uIn = row.querySelector('[data-uren-n]'); const tIn = row.querySelector('[data-uren-tarief]'); const bIn = row.querySelector('[data-uren-bedrag]');
      const h = !isNaN(van) && !isNaN(tot) && tot > van ? Math.round((tot - van) * 4) / 4 : NaN;
      uIn.placeholder = isNaN(h) ? '' : nl(h, h % 1 ? 2 : 0);
      const hours = num(uIn.value || uIn.placeholder); const rate = num(tIn.value);
      bIn.placeholder = !isNaN(hours) && !isNaN(rate) ? nl(hours * rate) : '';
    }
    function begroot() {
      const total = form.querySelector('[data-advies-total]'); if (!total) return;
      let sum = 0;
      form.querySelectorAll('[data-advies] tr[data-line]').forEach((tr) => {
        const v = num(tr.querySelector('[data-advies-cost]').value);
        const niet = tr.querySelector('input[value="niet"]:checked');
        if (!isNaN(v) && !niet) sum += v;
      });
      total.placeholder = sum ? nl(sum) : '';
    }
    form.querySelectorAll('tr[data-uur]').forEach(uur); begroot();
    form.addEventListener('input', (e) => { const r = e.target.closest('tr[data-uur]'); if (r) uur(r); if (e.target.closest('[data-advies]')) begroot(); });
    form.addEventListener('change', (e) => { if (e.target.closest('[data-advies]')) begroot(); });
  })();

  /* ---------- extra bladen toevoegen / verwijderen ---------- */
  (function pages() {
    const box = form.querySelector('[data-pages]');
    const add = form.querySelector('[data-page-add]');
    if (!box || !add) return;
    const max = Number(add.dataset.max) || 12;
    const count = () => box.querySelectorAll('[data-page]').length;
    const sync = () => add.querySelectorAll('button').forEach((b) => { b.disabled = count() >= max; });
    let next = count(); // nieuwe nummers na de bestaande (gaten zijn geen probleem: de server nummert opnieuw)
    add.addEventListener('click', (e) => {
      const b = e.target.closest('[data-add-page]');
      if (!b || count() >= max) return;
      const tpl = document.querySelector(`template[data-page-tpl="${b.dataset.addPage}"]`);
      if (!tpl) return;
      const holder = document.createElement('div');
      holder.innerHTML = tpl.innerHTML.replace(/__I__/g, String(next++));
      const page = holder.firstElementChild;
      page.querySelectorAll('.mirror-nr').forEach((m) => { m.textContent = nrInput.value; });
      box.append(page);
      markDirty(); fitAll(); sync();
      page.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const first = page.querySelector('input:not([type=hidden]), textarea');
      if (first) setTimeout(() => first.focus({ preventScroll: true }), 300);
    });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-page-remove]');
      if (!b) return;
      const page = b.closest('[data-page]');
      const filled = [...page.querySelectorAll('input:not([type=hidden]), textarea')].some((i) => i.value.trim());
      if (filled && !window.confirm('Dit blad verwijderen? Wat erop staat gaat verloren (pas definitief na Opslaan).')) return;
      page.remove();
      markDirty(); updateTotals(); sync();
    });
    sync();
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
