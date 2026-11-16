'use strict';
/* Drukte: tekstballon bij een dag (muis, of tikken op de telefoon). */
(function () {
  const tip = document.querySelector('.dk-tip');
  if (!tip) return;
  let cur = null;
  function show(el) {
    cur = el; tip.textContent = el.dataset.tip; tip.hidden = false;
    const r = el.getBoundingClientRect(); const w = tip.offsetWidth; const h = tip.offsetHeight;
    const x = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, document.documentElement.clientWidth - w - 8));
    const y = r.top - h - 8 < 4 ? r.bottom + 8 : r.top - h - 8;
    tip.style.setProperty('left', x + 'px'); tip.style.setProperty('top', y + 'px');
  }
  function hide() { cur = null; tip.hidden = true; }
  document.addEventListener('pointerover', (e) => { const el = e.target.closest('[data-tip]'); if (el && e.pointerType === 'mouse') show(el); });
  document.addEventListener('pointerout', (e) => { if (e.pointerType === 'mouse' && cur && !cur.contains(e.relatedTarget)) hide(); });
  document.addEventListener('click', (e) => { const el = e.target.closest('[data-tip]'); if (el && el !== cur) show(el); else hide(); });
  window.addEventListener('scroll', hide, { passive: true });
})();
