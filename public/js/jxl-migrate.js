'use strict';
/* Systeem → Foto's: bestaande foto's één voor één omzetten naar JPEG XL (rekenwerk in deze browser, in een aparte thread). */
(function () {
  const card = document.querySelector('[data-jxl-card]');
  if (!card) return;
  const $ = (s) => card.querySelector(s);
  const startBtn = $('[data-jxl-start]'); const stopBtn = $('[data-jxl-stop]');
  const prog = $('[data-jxl-progress]'); const fill = $('[data-jxl-fill]'); const txt = $('[data-jxl-text]'); const err = $('[data-jxl-error]');
  const mb = (n) => (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
  let stop = false;
  // jxl.js wordt pas na deze pagina-scripts geladen (defer), dus even wachten.
  document.addEventListener('DOMContentLoaded', () => window.adonisJxl && window.adonisJxl.native.then((ok) => { $('[data-jxl-native]').textContent = ok ? 'Deze browser toont JPEG XL zelf.' : 'Deze browser toont JPEG XL niet zelf; ADONIS zet foto’s dan bij het bekijken om (iets trager).'; }));

  const toDataUrl = (buf) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(new Blob([buf], { type: 'image/jxl' })); });
  async function convert(id) {
    const P = window.adonisPhotoCanvas;
    const res = await fetch(`/fotos/${id}/full`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Foto ' + id + ' niet gevonden.');
    const bmp = await createImageBitmap(await res.blob());
    // Grote versie op dezelfde maat (niet opnieuw verkleinen), kleine versie zoals bij het uploaden.
    const big = P.canvasOf(bmp, Math.max(bmp.width, bmp.height)); const small = P.canvasOf(bmp, P.THUMB);
    if (bmp.close) bmp.close();
    const enc = async (c, q) => toDataUrl(await window.adonisJxl.encode(c.getContext('2d').getImageData(0, 0, c.width, c.height), { quality: q }));
    const body = JSON.stringify({ full: await enc(big, 88), thumb: await enc(small, 80) });
    const r = await fetch(`/systeem/jxl/${id}`, { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': card.dataset.csrf }, body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Omzetten lukte niet.');
    return j;
  }
  async function run() {
    if (!window.adonisJxl || !window.adonisPhotoCanvas) { err.textContent = 'JPEG XL is in deze browser niet beschikbaar.'; err.hidden = false; return; }
    err.hidden = true; stop = false; startBtn.disabled = true; stopBtn.hidden = false; prog.hidden = false;
    const { todo } = await (await fetch('/systeem/jxl', { credentials: 'same-origin' })).json();
    let done = 0; let saved = 0; let skipped = 0; let failed = 0;
    for (const id of todo) {
      if (stop) break;
      txt.textContent = `Bezig met foto ${done + 1} van ${todo.length}… ${saved ? 'bespaard: ' + mb(saved) : ''}`;
      try {
        const r = await convert(id);
        if (r.skipped) skipped++; else if (r.before) saved += r.before - r.after;
      } catch (e) { failed++; console.warn(e); }
      done++;
      fill.style.width = Math.max(4, Math.round((done / todo.length) * 100)) + '%';
    }
    const s = (await (await fetch('/systeem/jxl', { credentials: 'same-origin' })).json()).stats;
    for (const k of ['total', 'jxl', 'todo']) $(`[data-jxl-n="${k}"]`).textContent = s[k];
    $('[data-jxl-n="bytes"]').textContent = mb(s.bytes);
    txt.textContent = `${stop ? 'Gestopt' : 'Klaar'}: ${done - skipped - failed} omgezet, ${mb(saved)} bespaard`
      + (skipped ? `, ${skipped} bleven JPEG (werden niet kleiner)` : '') + (failed ? `, ${failed} mislukt` : '') + '.';
    fill.style.width = '100%'; stopBtn.hidden = true; startBtn.disabled = !s.todo;
  }
  startBtn.addEventListener('click', run);
  stopBtn.addEventListener('click', () => { stop = true; stopBtn.hidden = true; txt.textContent = 'Stoppen na deze foto…'; });
})();
