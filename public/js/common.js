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
