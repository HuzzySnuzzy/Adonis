'use strict';
/* Foto's: verkleinen in de browser, uploaden, bekijken (groot, met vorige/volgende) en verwijderen.
 * window.adonisPhotos.prepare(file) wordt ook gebruikt door "Foto's koppelen". */
(function () {
  const FULL = 1800; // langste zijde van de grote versie (scherp genoeg om een DOT-nummer te lezen)
  const THUMB = 360;

  async function loadBitmap(blob) {
    // Een JPEG XL-bestand kiezen werkt ook als de browser het zelf niet kan tonen.
    if (window.adonisJxl && window.createImageBitmap && !(await window.adonisJxl.native)) {
      const buf = await blob.arrayBuffer();
      if (window.adonisJxl.isJxl(new Uint8Array(buf, 0, Math.min(12, buf.byteLength)))) return createImageBitmap(await window.adonisJxl.decode(buf));
    }
    if (window.createImageBitmap) {
      try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { /* val terug */ }
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Kan deze afbeelding niet openen (wordt dit formaat ondersteund?).')); };
      img.src = url;
    });
  }
  function canvasOf(bmp, max) {
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * s));
    c.height = Math.max(1, Math.round(bmp.height * s));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  }
  const toDataUrl = (buf, type) => new Promise((resolve, reject) => {
    const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(new Blob([buf], { type }));
  });
  /** Canvas -> JPEG XL (data:-adres). Lukt dat niet (heel oude browser), dan JPEG. */
  async function encodeCanvas(c, quality) {
    if (window.adonisJxl) {
      try {
        const data = c.getContext('2d').getImageData(0, 0, c.width, c.height);
        return await toDataUrl(await window.adonisJxl.encode(data, { quality }), 'image/jxl');
      } catch (err) { console.warn('JPEG XL lukte niet, dan JPEG:', err); }
    }
    return c.toDataURL('image/jpeg', quality / 100);
  }
  async function prepare(blob) {
    const bmp = await loadBitmap(blob);
    const big = canvasOf(bmp, FULL); const small = canvasOf(bmp, THUMB);
    if (bmp.close) bmp.close();
    let full = await encodeCanvas(big, 85); let thumb = await encodeCanvas(small, 80);
    // Groot en klein in hetzelfde formaat (de server bewaart één soort per foto).
    if (full.startsWith('data:image/jxl') !== thumb.startsWith('data:image/jxl')) { full = big.toDataURL('image/jpeg', 0.85); thumb = small.toDataURL('image/jpeg', 0.8); }
    // preview: altijd te tonen (ook waar de browser zelf geen JPEG XL kan laten zien); wordt niet geüpload.
    return { full, thumb, preview: small.toDataURL('image/jpeg', 0.8), width: big.width, height: big.height };
  }
  window.adonisPhotoCanvas = { canvasOf, encodeCanvas, loadBitmap, FULL, THUMB };
  async function upload(type, id, csrf, data) {
    const res = await fetch(`/fotos/${type}/${id}`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ ...data, preview: undefined }),
    });
    const r = await res.json().catch(() => ({ error: 'Onverwacht antwoord van de server.' }));
    if (!res.ok) throw new Error(r.error || 'Uploaden mislukt.');
    return r;
  }
  window.adonisPhotos = { prepare, upload };

  /* ---------- fotokaart op een record ---------- */
  const card = document.querySelector('.photo-card[data-photo-type]');
  if (card) {
    const grid = card.querySelector('[data-photo-grid]');
    const status = card.querySelector('[data-photo-status]');
    const empty = card.querySelector('[data-photo-empty]');
    const count = card.querySelector('[data-photo-count]');
    const { photoType: type, photoId: id, csrf } = card.dataset;
    const say = (t) => { status.textContent = t; status.hidden = !t; };
    const refresh = () => {
      const n = grid.children.length;
      empty.hidden = n > 0;
      count.textContent = n ? `(${n})` : '';
    };
    function figure(photoId, thumbUrl) {
      const fig = document.createElement('figure');
      fig.className = 'photo';
      fig.dataset.photo = photoId;
      const a = document.createElement('a');
      a.href = `/fotos/${photoId}/full`; a.target = '_blank'; a.rel = 'noopener'; a.dataset.photoOpen = '';
      const img = document.createElement('img');
      img.src = thumbUrl || `/fotos/${photoId}/thumb`; img.alt = 'Foto';
      a.append(img);
      const form = document.createElement('form');
      form.method = 'post'; form.action = `/fotos/${photoId}/verwijderen`;
      form.dataset.photoDelete = '';
      const tok = document.createElement('input');
      tok.type = 'hidden'; tok.name = '_csrf'; tok.value = csrf;
      const del = document.createElement('button');
      del.type = 'submit'; del.className = 'thumb-del'; del.title = 'Verwijderen'; del.setAttribute('aria-label', 'Foto verwijderen'); del.textContent = '×';
      form.append(tok, del);
      fig.append(a, form);
      return fig;
    }
    async function addFiles(files) {
      const list = [...files].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|jxl)$/i.test(f.name));
      if (!list.length) return;
      let ok = 0;
      const errors = [];
      for (const [i, f] of list.entries()) {
        say(`Foto ${i + 1} van ${list.length} wordt toegevoegd…`);
        try {
          const data = await prepare(f);
          const r = await upload(type, id, csrf, { ...data, name: f.name });
          grid.append(figure(r.id, data.preview));
          ok++;
        } catch (e) {
          errors.push(`${f.name}: ${e.message}`);
        }
      }
      refresh();
      say(errors.length ? `${ok} toegevoegd. Niet gelukt: ${errors.join('; ')}` : '');
    }
    card.addEventListener('change', (e) => {
      if (!e.target.matches('[data-photo-input]')) return;
      addFiles(e.target.files);
      e.target.value = '';
    });
    // Slepen en neerzetten (computer)
    card.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); card.classList.add('drop'); } });
    card.addEventListener('dragleave', (e) => { if (!card.contains(e.relatedTarget)) card.classList.remove('drop'); });
    card.addEventListener('drop', (e) => { e.preventDefault(); card.classList.remove('drop'); addFiles(e.dataTransfer.files); });
    // Verwijderen zonder de pagina (en ingevulde velden) te verliezen
    card.addEventListener('submit', async (e) => {
      const form = e.target.closest('form[data-photo-delete]');
      if (!form || e.defaultPrevented) return;
      e.preventDefault();
      if (!window.confirm('Deze foto verwijderen?')) return;
      try {
        const res = await fetch(form.action, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'X-CSRF-Token': csrf } });
        if (!res.ok) throw new Error();
        form.closest('figure').remove();
        refresh();
      } catch { say('Verwijderen mislukt. Probeer het opnieuw.'); }
    });
  }

  /* ---------- groot bekijken ---------- */
  let dialog = null;
  let current = [];
  let index = 0;
  function show(i) {
    index = (i + current.length) % current.length;
    const img = dialog.querySelector('img');
    img.src = current[index];
    dialog.querySelector('.lb-count').textContent = current.length > 1 ? `${index + 1} / ${current.length}` : '';
    dialog.querySelector('.lb-open').href = current[index];
    dialog.querySelectorAll('.lb-nav').forEach((b) => { b.hidden = current.length < 2; });
  }
  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'lightbox';
    dialog.setAttribute('aria-label', 'Foto');
    dialog.innerHTML = '<img alt="Foto"><div class="lb-bar"><span class="lb-count"></span>' +
      '<a class="lb-open" target="_blank" rel="noopener">Origineel openen</a>' +
      '<button type="button" class="lb-close" aria-label="Sluiten">×</button></div>' +
      '<button type="button" class="lb-nav lb-prev" aria-label="Vorige">‹</button><button type="button" class="lb-nav lb-next" aria-label="Volgende">›</button>';
    dialog.addEventListener('click', (e) => {
      if (e.target.closest('.lb-prev')) show(index - 1);
      else if (e.target.closest('.lb-next')) show(index + 1);
      else if (e.target.closest('.lb-close') || e.target === dialog) dialog.close();
    });
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') show(index - 1);
      if (e.key === 'ArrowRight') show(index + 1);
    });
    document.body.append(dialog);
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-photo-open]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || !window.HTMLDialogElement) return;
    e.preventDefault();
    if (!dialog) build();
    const scope = a.closest('[data-photo-grid], tr, .photo-card') || document;
    current = [...scope.querySelectorAll('a[data-photo-open]')].map((x) => x.href);
    if (!current.length) current = [a.href];
    dialog.showModal();
    show(Math.max(0, current.indexOf(a.href)));
  });
})();
