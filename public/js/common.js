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
