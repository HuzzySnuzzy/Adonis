'use strict';
// Klikbare tabelrijen
document.addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-href]');
  if (!row || e.target.closest('a, button, input, form')) return;
  if (e.ctrlKey || e.metaKey) window.open(row.dataset.href, '_blank');
  else window.location.href = row.dataset.href;
});
// Bevestiging voor verwijderen
document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-confirm]');
  if (form && !window.confirm(form.dataset.confirm)) e.preventDefault();
});
// Keuzelijst die direct opslaat (bijv. rol van een gebruiker)
document.addEventListener('change', (e) => {
  if (e.target.matches('select[data-autosubmit]')) e.target.form.requestSubmit();
});
// Zoekveld alleen automatisch selecteren op een computer met muis; op telefoon/tablet zou
// dat meteen het toetsenbord (en de wachtwoordbalk) openen.
if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) {
  const el = document.querySelector('[data-autofocus]');
  if (el) el.focus();
}
// Telefoon: het actieve menu-item in beeld schuiven (het menu is daar één rij om door te vegen).
(function () {
  const nav = document.querySelector('.mainnav');
  const active = nav && nav.querySelector('a.active');
  if (active && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = active.offsetLeft - nav.clientWidth / 2 + active.offsetWidth / 2;
})();
// Tabellen die breder zijn dan het scherm: een schaduw aan de kant waar nog meer staat (zodat niets "verdwijnt").
(function () {
  function mark(w) {
    const more = w.scrollWidth - w.clientWidth;
    w.classList.toggle('more-right', more > 2 && w.scrollLeft < more - 2);
    w.classList.toggle('more-left', more > 2 && w.scrollLeft > 2);
  }
  function all() { document.querySelectorAll('.table-wrap').forEach(mark); }
  document.addEventListener('scroll', (e) => { if (e.target.classList && e.target.classList.contains('table-wrap')) mark(e.target); }, true);
  addEventListener('resize', all);
  addEventListener('load', all);
  // Ook na live bijwerken (de lijst wordt dan vervangen).
  if (window.MutationObserver) new MutationObserver(() => requestAnimationFrame(all)).observe(document.body, { childList: true, subtree: true });
  all();
})();
// Instellingen: "Geheime thema's" aan/uit toont of verbergt Neon en Black Ice meteen.
(function () {
  const toggle = document.querySelector('[data-secret-toggle]');
  if (!toggle) return;
  toggle.addEventListener('change', () => {
    document.querySelectorAll('[data-secret-theme]').forEach((el) => {
      el.hidden = !toggle.checked;
      const radio = el.querySelector('input[type=radio]');
      if (!toggle.checked && radio && radio.checked) {
        const sys = document.querySelector('input[name=theme][value=system]');
        if (sys) sys.checked = true;
      }
    });
  });
})();
// Afdrukknop
document.addEventListener('click', (e) => { if (e.target.closest('[data-print]')) window.print(); });
// Wissellijst: "Gebeld" aan/uit zonder de pagina te herladen (je blijft op je plek in de lijst).
document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form.call-form');
  if (!form || !window.fetch) return;
  e.preventDefault();
  const btn = form.querySelector('button');
  try {
    const res = await fetch(form.action, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'X-CSRF-Token': form.querySelector('[name=_csrf]').value } });
    if (!res.ok) throw new Error();
    const r = await res.json();
    const d = r.uitgenodigd_at ? r.uitgenodigd_at.split('-').reverse().map((x, i) => (i === 2 ? x.slice(2) : x)).join('-') : '';
    btn.textContent = d ? '✓ ' + d : 'Gebeld';
    btn.classList.toggle('btn-ok', Boolean(d));
    form.closest('tr').classList.toggle('is-called', Boolean(d));
  } catch { form.submit(); }
});
// Instellingen: "Weergave op telefoon" meteen laten zien (opslaan gebeurt met de knop).
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-mscale-choice]')) document.documentElement.setAttribute('data-mscale', e.target.value);
});
