'use strict';
/* Instellingen → Profiel: live voorbeeld van pictogram en kleur, en een eigen foto (vierkant bijgesneden, 256 × 256). */
(function () {
  const card = document.querySelector('[data-profile]');
  if (!card) return;
  const pv = card.querySelector('[data-profile-preview]');
  const form = card.querySelector('form');
  const letter = (card.querySelector('.profile-letter') || {}).textContent || '?';
  function preview() {
    const look = (form.querySelector('input[name=look]:checked') || {}).value || 'letter';
    const kleur = (form.querySelector('input[name=kleur]:checked') || {}).value || '0';
    const el = document.createElement('span');
    el.className = `avatar user-avatar av-xl av-c${kleur}`;
    if (look === 'letter') el.textContent = letter;
    else if (look === 'img') { el.classList.add('av-img'); el.append(card.querySelector('.profile-img img').cloneNode()); }
    else { el.classList.add('av-icon'); const svg = form.querySelector(`input[name=look][value="${look}"]`).parentElement.querySelector('svg').cloneNode(true); svg.removeAttribute('width'); svg.removeAttribute('height'); el.append(svg); }
    pv.replaceChildren(el);
    // De kleur doet niets bij een eigen foto.
    card.querySelector('.profile-colors').classList.toggle('is-off', look === 'img');
  }
  form.addEventListener('change', preview);

  const file = card.querySelector('[data-profile-file]');
  const err = card.querySelector('[data-profile-error]');
  const busy = card.querySelector('[data-profile-busy]');
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    err.hidden = true; busy.hidden = false;
    try {
      const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Deze foto kan niet worden geopend.')); i.src = url; });
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement('canvas'); c.width = 256; c.height = 256;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 256, 256); ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
      const r = await fetch('/instellingen/profielfoto', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': card.dataset.csrf },
        body: JSON.stringify({ data: c.toDataURL('image/jpeg', 0.88) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Opslaan lukte niet.');
      window.adonisLeaving = true; location.hash = 'profiel'; location.reload();
    } catch (e) { err.textContent = e.message || 'Er ging iets mis.'; err.hidden = false; busy.hidden = true; } finally { file.value = ''; }
  });
})();
