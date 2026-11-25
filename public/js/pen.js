'use strict';
/*
 * Schrijven in blauw of rood, zoals op een papieren werkopdracht. Kies de pen bovenaan; wat u daarna in een vak typt,
 * krijgt die kleur (per vak, voor iedereen zichtbaar en ook op papier). De keuze van de pen onthoudt dit apparaat.
 * De rode vakken staan in het verborgen veld d[inkt_rood] en gaan zo mee met automatisch opslaan en live bewerken.
 */
(function () {
  const form = document.getElementById('orderForm');
  const store = form && form.querySelector('[data-ink-red]');
  if (!store) return;
  const pick = document.querySelector('.pen-pick');
  const KEY = 'adonis-pen';
  let pen = 'blauw';
  try { if (localStorage.getItem(KEY) === 'rood') pen = 'rood'; } catch { /* geen opslag */ }

  const set = () => new Set(store.value.split(/\s+/).filter(Boolean));
  const writable = (el) => el && el.name && /^d\[/.test(el.name) && el.name !== 'd[inkt_rood]'
    && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['hidden', 'checkbox', 'radio', 'file', 'date'].includes(el.type)));
  let last = null;
  function paint() {
    if (store.value === last) return;
    last = store.value;
    const red = set();
    form.querySelectorAll('.ink-red').forEach((el) => { if (!red.has(el.name)) el.classList.remove('ink-red'); });
    for (const n of red) form.querySelectorAll(`[name="${CSS.escape(n)}"]`).forEach((el) => el.classList.add('ink-red'));
  }
  function showPen() {
    document.documentElement.dataset.pen = pen;
    if (pick) pick.querySelectorAll('[data-pen]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.pen === pen)));
  }
  function choose(p) {
    pen = p === 'rood' ? 'rood' : 'blauw';
    try { localStorage.setItem(KEY, pen); } catch { /* geen opslag */ }
    showPen();
    const a = document.activeElement;
    if (writable(a)) a.focus();
  }
  if (pick) pick.addEventListener('click', (e) => { const b = e.target.closest('[data-pen]'); if (b) choose(b.dataset.pen); });
  document.addEventListener('keydown', (e) => { if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); choose(pen === 'rood' ? 'blauw' : 'rood'); } });

  // Typt u (zelf) in een vak, dan krijgt het de kleur van uw pen. Leeg gemaakt = weer gewoon blauw.
  form.addEventListener('input', (e) => {
    const el = e.target;
    if (!e.isTrusted || !writable(el)) return;
    const red = set();
    const want = pen === 'rood' && String(el.value).trim() !== '';
    if (want === red.has(el.name)) return;
    if (want) red.add(el.name); else red.delete(el.name);
    store.value = [...red].join(' ');
    paint();
    store.dispatchEvent(new Event('input', { bubbles: true })); // automatisch opslaan
  });
  // Wijzigingen van collega's (live) of een herladen formulier: kleuren bijwerken.
  setInterval(paint, 800);
  showPen(); paint();
})();
