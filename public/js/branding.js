'use strict';
/* Systeem → Huisstijl: afbeeldingen verkleinen in de browser en opslaan, en een live voorbeeld van naam en achtergrond. */
(function () {
  const card = document.querySelector('[data-brand-card]');
  if (!card) return;
  const csrf = card.dataset.csrf;
  const errEl = card.querySelector('[data-brand-error]');
  const busyEl = card.querySelector('[data-brand-busy]');
  const pv = card.querySelector('[data-brand-pv]');
  const pvImg = card.querySelector('[data-brand-pv-img]');
  const pageBg = document.querySelector('.brand-bg');

  /* ---------- naam en ondertitel: meteen in het voorbeeld ---------- */
  const nameIn = card.querySelector('[data-brand-name]');
  const subIn = card.querySelector('[data-brand-sub]');
  function preview() {
    if (!pv) return;
    const word = pv.querySelector('.logo-word'); const sub = pv.querySelector('.logo-sub');
    const n = nameIn.value.trim();
    if (word) word.textContent = n || 'ADONIS';
    if (sub) sub.textContent = subIn.value.trim() || (n ? '' : 'Werkopdrachten');
    const logo = pv.querySelector('.logo'); if (logo) logo.classList.toggle('logo-custom', !!n);
  }
  nameIn.addEventListener('input', preview); subIn.addEventListener('input', preview);

  /* ---------- vervaging en zichtbaarheid: meteen zien (ook op deze pagina zelf) ---------- */
  const blur = card.querySelector('[data-brand-blur]');
  const zicht = card.querySelector('[data-brand-zicht]');
  function bg() {
    const b = blur.value + 'px'; const z = String(zicht.value / 100);
    card.querySelector('[data-out="blur"]').textContent = blur.value + ' px';
    card.querySelector('[data-out="zicht"]').textContent = zicht.value + '%';
    for (const el of [pvImg, document.documentElement]) {
      if (!el) continue;
      el.style.setProperty('--brand-bg-blur', b); el.style.setProperty('--brand-bg-zicht', z);
    }
  }
  blur.addEventListener('input', bg); zicht.addEventListener('input', bg);
  if (pvImg) {
    const src = card.querySelector('.brand-file-achtergrond img');
    if (src) pvImg.style.backgroundImage = `url("${src.getAttribute('src')}")`;
    bg();
  }
  if (!pageBg) document.documentElement.style.removeProperty('--brand-bg-blur');

  /* ---------- afbeelding kiezen: verkleinen en opslaan ---------- */
  const SIZE = { logo: [512, 512, 'image/png'], banner: [1400, 420, 'image/png'], achtergrond: [2560, 1600, 'image/jpeg'] };
  function load(file) {
    // Via een data:-adres (blob: mag niet volgens de beveiligingsregels van de pagina).
    const fail = () => new Error('Deze afbeelding kan niet worden geopend. Kies een PNG, JPG, WebP of SVG.');
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(fail());
      fr.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(fail());
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  async function shrink(file, slot) {
    const [maxW, maxH, type] = SIZE[slot];
    const img = await load(file);
    const w0 = img.naturalWidth || 512; const h0 = img.naturalHeight || 512;
    const scale = Math.min(1, maxW / w0, maxH / h0);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * scale)); c.height = Math.max(1, Math.round(h0 * scale));
    const ctx = c.getContext('2d');
    if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(type, 0.86);
  }
  card.addEventListener('change', async (e) => {
    const input = e.target.closest('[data-brand-file]');
    if (!input || !input.files[0]) return;
    const slot = input.dataset.brandFile;
    errEl.hidden = true; busyEl.hidden = false;
    try {
      if (input.files[0].size > 40 * 1024 * 1024) throw new Error('Dit bestand is erg groot (meer dan 40 MB). Kies een kleinere afbeelding.');
      const data = await shrink(input.files[0], slot);
      const r = await fetch('/systeem/huisstijl/afbeelding', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ slot, data }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Opslaan lukte niet.');
      window.adonisLeaving = true;
      location.hash = 'huisstijl';
      location.reload();
    } catch (err) {
      errEl.textContent = err.message; errEl.hidden = false; busyEl.hidden = true;
    } finally { input.value = ''; }
  });
})();

/* Kleuren: meteen zien op deze pagina (pas na Opslaan voor iedereen). */
(function () {
  const box = document.querySelector('[data-brand-colors]');
  if (!box) return;
  const own = box.querySelector('[data-brand-own]'); const c1 = box.querySelector('[data-brand-c1]'); const c2 = box.querySelector('[data-brand-c2]');
  const root = document.documentElement;
  const lum = (hex) => { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  function apply() {
    const on = own.checked;
    c1.disabled = !on; c2.disabled = !on;
    if (!on) { ['--primary', '--primary-hover', '--brand', '--accent', '--on-primary'].forEach((k) => root.style.removeProperty(k)); return; }
    root.style.setProperty('--primary', c1.value); root.style.setProperty('--primary-hover', `color-mix(in srgb, ${c1.value} 82%, #000)`);
    root.style.setProperty('--brand', c1.value); root.style.setProperty('--accent', c2.value);
    root.style.setProperty('--on-primary', lum(c1.value) > 0.36 ? '#14171c' : '#ffffff');
  }
  [own, c1, c2].forEach((el) => el.addEventListener('input', apply));
  own.addEventListener('change', apply);
  if (own.checked) apply(); else { c1.disabled = true; c2.disabled = true; }
})();
