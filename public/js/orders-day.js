'use strict';
/* Werkopdrachten per dag: naar een datum springen, en met de pijltjestoetsen naar de vorige/volgende dag. */
(function () {
  const go = (href) => { if (href) { window.adonisLeaving = true; location.href = href; } };
  document.addEventListener('change', (e) => {
    const j = e.target.closest('[data-day-jump]');
    if (j && /^\d{4}-\d{2}-\d{2}$/.test(j.value)) go('/werkopdrachten?dag=' + j.value);
  });
  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
    if (e.target.closest('input, textarea, select, [contenteditable], dialog')) return;
    if (e.key === 'ArrowLeft') { const a = document.querySelector('[data-day-prev]'); if (a) { e.preventDefault(); go(a.getAttribute('href')); } }
    if (e.key === 'ArrowRight') { const a = document.querySelector('[data-day-next]'); if (a) { e.preventDefault(); go(a.getAttribute('href')); } }
  });
})();
