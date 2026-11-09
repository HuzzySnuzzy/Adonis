'use strict';
/* Verkenner: foto groot bekijken, met pijltjes naar de vorige/volgende en een link naar waar hij vandaan komt. */
(function () {
  const dlg = document.querySelector('[data-xp-view]');
  const grid = document.querySelector('[data-xp-photos]');
  if (!dlg || !grid) return;
  const items = [...grid.querySelectorAll('.xp-photo')];
  const img = dlg.querySelector('[data-xp-img]');
  let at = 0;
  function show(i) {
    at = (i + items.length) % items.length;
    const a = items[at];
    img.src = a.dataset.full; img.alt = a.dataset.name || 'Foto';
    dlg.querySelector('[data-xp-from]').textContent = a.dataset.from;
    dlg.querySelector('[data-xp-when]').textContent = ' ' + a.dataset.when;
    dlg.querySelector('[data-xp-goto]').href = a.dataset.href;
    const dl = dlg.querySelector('[data-xp-dl]'); dl.href = a.dataset.full + '?download=1';
    dlg.querySelectorAll('.xp-nav').forEach((b) => { b.hidden = items.length < 2; });
  }
  grid.addEventListener('click', (e) => {
    const a = e.target.closest('.xp-photo');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    show(items.indexOf(a));
    if (!dlg.open) dlg.showModal();
  });
  dlg.querySelector('[data-xp-prev]').addEventListener('click', () => show(at - 1));
  dlg.querySelector('[data-xp-next]').addEventListener('click', () => show(at + 1));
  dlg.querySelector('[data-xp-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(at - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); show(at + 1); }
  });
})();
