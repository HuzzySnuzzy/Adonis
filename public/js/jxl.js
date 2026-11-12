'use strict';
/*
 * JPEG XL in ADONIS: foto's worden als JPEG XL bewaard en verstuurd (kleiner dan JPEG, zelfde kwaliteit).
 * window.adonisJxl.encode(imageData) / .decode(buffer) rekenen in een aparte thread (public/js/jxl-worker.js).
 * Kan een (oudere) browser een foto niet tonen, dan zet ADONIS hem hier zelf om, zodat hij toch verschijnt.
 */
(function () {
  let worker = null; let seq = 0;
  const pending = new Map();
  function call(msg, transfer) {
    if (!worker) {
      worker = new Worker('/static/js/jxl-worker.js', { type: 'module' });
      worker.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); if (e.data.ok) p.resolve(e.data); else p.reject(new Error(e.data.error)); };
      worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'JPEG XL niet beschikbaar')); pending.clear(); worker = null; };
    }
    const id = ++seq;
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, ...msg }, transfer || []); });
  }
  const isJxl = (b) => (b[0] === 0xff && b[1] === 0x0a) || (b.length > 12 && b[4] === 0x4a && b[5] === 0x58 && b[6] === 0x4c && b[7] === 0x20);
  // Kan deze browser zelf JPEG XL tonen? (1×1 pixel)
  const TINY = 'data:image/jxl;base64,/woAELATAEiAKADcAFUPAACoUBll3ODlXM+XHzospm1cZ2irbQtLEkXGsUmqQyZwSBLrIPMGEYBwAIDPkXklw0grSQA=';
  const native = new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i.width === 1); i.onerror = () => resolve(false); i.src = TINY; setTimeout(() => resolve(false), 3000); });

  window.adonisJxl = {
    native,
    isJxl,
    /** ImageData -> ArrayBuffer (JPEG XL) */
    async encode(imageData, opts) {
      const copy = imageData.data.slice().buffer;
      const r = await call({ op: 'encode', buf: copy, width: imageData.width, height: imageData.height, opts }, [copy]);
      return r.buf;
    },
    /** ArrayBuffer (JPEG XL) -> ImageData */
    async decode(buf) {
      const r = await call({ op: 'decode', buf }, [buf]);
      return new ImageData(new Uint8ClampedArray(r.buf), r.width, r.height);
    },
  };

  /* Foto of huisstijl-afbeelding die de browser niet kan tonen (JPEG XL in een oudere browser): zelf omzetten en tonen. */
  const PATTERN = /\/(fotos\/\d+\/(full|thumb)|huisstijl\/(banner|achtergrond))(\?|$)/;
  const done = new WeakSet(); const cache = new Map();
  // Huisstijl staat op elke pagina: het omgezette plaatje even bewaren (per versie), zodat niet elke pagina opnieuw rekent.
  const KEEP = /\/huisstijl\//;
  const stored = (src) => { try { return KEEP.test(src) ? localStorage.getItem('adonis-jxl:' + src) : null; } catch { return null; } };
  const store = (src, url) => {
    if (!KEEP.test(src)) return;
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith('adonis-jxl:' + src.split('?')[0])) localStorage.removeItem(k); }
      localStorage.setItem('adonis-jxl:' + src, url);
    } catch { /* vol of geen opslag */ }
  };
  async function convert(src) {
    const keep = stored(src);
    if (keep) return keep;
    const res = await fetch(src, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('niet gevonden');
    const buf = await res.arrayBuffer();
    if (!isJxl(new Uint8Array(buf, 0, 12))) throw new Error('geen JPEG XL');
    const img = await window.adonisJxl.decode(buf);
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(img, 0, 0);
    // Banner kan doorzichtig zijn: PNG. Foto's en achtergrond: JPEG.
    const url = /huisstijl\/banner/.test(src) ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92);
    store(src, url);
    return url;
  }
  function fallback(src) {
    if (!cache.has(src)) cache.set(src, convert(src));
    return cache.get(src);
  }
  function fix(img) {
    if (!(img instanceof HTMLImageElement) || done.has(img)) return;
    const src = img.currentSrc || img.src;
    if (!PATTERN.test(src)) return;
    done.add(img);
    fallback(src).then((url) => { img.src = url; }).catch(() => { /* echt kapot */ });
  }
  document.addEventListener('error', (e) => fix(e.target), true);
  document.addEventListener('DOMContentLoaded', async () => {
    // Plaatjes die al mislukten voordat dit script er was.
    document.querySelectorAll('img').forEach((img) => { if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) fix(img); });
    // Achtergrond van de huisstijl (CSS): alleen als de browser zelf geen JPEG XL kan tonen.
    if (await native) return;
    document.querySelectorAll('.brand-bg, [data-brand-pv-img]').forEach((el) => {
      const m = /url\("?([^")]*huisstijl\/achtergrond[^")]*)"?\)/.exec(getComputedStyle(el).backgroundImage || '');
      if (!m) return;
      const src = new URL(m[1], location.href).pathname + new URL(m[1], location.href).search;
      fallback(src).then((url) => el.style.setProperty('background-image', `url("${url}")`)).catch(() => { /* geen JPEG XL: niets te doen */ });
    });
  });
})();
