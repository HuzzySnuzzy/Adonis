'use strict';
/*
 * Barcode scannen: met de camera (live, of een foto van de barcode) of met een USB-barcodescanner (die "typt" de code).
 * Het lezen doet de browser zelf als dat kan (BarcodeDetector, o.a. Chrome op Android); anders de ingebouwde lezer
 * zxing-wasm (MIT, public/vendor/zxing), bijv. op de iPhone en in de ADONIS-app op Windows. Beide gratis en lokaal.
 * window.adonisScan({ title, text }) -> Promise met de code, of null bij Annuleren.
 * window.adonisBarcodeReader = { detect(bron) -> Promise<string[]> } kan een andere lezer inprikken.
 */
(function () {
  let detector;
  async function reader() {
    if (window.adonisBarcodeReader) return window.adonisBarcodeReader;
    if (detector !== undefined) return detector;
    detector = null;
    if ('BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.length) {
          const det = new window.BarcodeDetector({ formats });
          detector = { detect: async (src) => (await det.detect(src)).map((b) => b.rawValue).filter(Boolean) };
        }
      } catch { /* geen lezer */ }
    }
    if (!detector) detector = await zxing().catch((err) => { console.warn('Barcodelezer niet beschikbaar:', err); return null; });
    return detector;
  }
  /* zxing-wasm: pas laden als er gescand wordt (± 1 MB). */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script'); el.src = src; el.onload = resolve; el.onerror = () => reject(new Error('laden mislukt'));
      document.head.append(el);
    });
  }
  async function zxing() {
    if (!window.ZXingWASM) await loadScript('/static/vendor/zxing/zxing-reader.js');
    const Z = window.ZXingWASM;
    await Z.prepareZXingModule({ overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? '/static/vendor/zxing/' + path : prefix + path) }, fireImmediately: true });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return {
      slow: true,
      async detect(src) {
        const w = src.videoWidth || src.width; const h = src.videoHeight || src.height;
        if (!w || !h) return [];
        const s = Math.min(1, 1280 / Math.max(w, h));
        canvas.width = Math.round(w * s); canvas.height = Math.round(h * s);
        ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
        const res = await Z.readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), { tryHarder: true, maxNumberOfSymbols: 1 });
        return res.filter((r) => r.isValid && r.text).map((r) => r.text);
      },
    };
  }
  const canLive = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext);

  window.adonisScan = function ({ title = 'Barcode scannen', text = '' } = {}) {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'swap-dialog scan-dialog';
      dlg.innerHTML = '<form method="dialog" class="swap-form"><h1></h1><p class="muted small scan-text"></p>'
        + '<div class="scan-video" hidden><video muted playsinline autoplay></video><span class="scan-aim" aria-hidden="true"></span></div>'
        + '<p class="small scan-status" aria-live="polite"></p>'
        + '<label class="btn scan-photo" hidden><input type="file" accept="image/*" capture="environment" hidden> Foto van de barcode maken</label>'
        + '<label class="scan-manual">Of typ de code (een USB-barcodescanner werkt hier ook)'
        + '<span class="scan-field"><input class="mono" autocomplete="off" inputmode="numeric" enterkeyhint="done"><button class="btn btn-primary" type="button" data-ok>OK</button></span></label>'
        + '<div class="swap-actions"><button class="btn" type="button" data-cancel>Annuleren</button></div></form>';
      dlg.querySelector('h1').textContent = title;
      const tx = dlg.querySelector('.scan-text'); tx.textContent = text; tx.hidden = !text;
      const status = dlg.querySelector('.scan-status');
      const input = dlg.querySelector('.scan-manual input');
      const box = dlg.querySelector('.scan-video'); const video = box.querySelector('video');
      const photo = dlg.querySelector('.scan-photo');
      let answer = null; let stream = null; let timer = null; let closed = false;
      const say = (t) => { status.textContent = t; };
      const done = (v) => { if (closed) return; answer = v; if (v && navigator.vibrate) navigator.vibrate(60); dlg.close(); };
      dlg.querySelector('[data-ok]').addEventListener('click', () => { if (input.value.trim()) done(input.value.trim()); else input.focus(); });
      dlg.querySelector('[data-cancel]').addEventListener('click', () => done(null));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (input.value.trim()) done(input.value.trim()); } });
      dlg.addEventListener('close', () => {
        closed = true; clearTimeout(timer);
        if (stream) stream.getTracks().forEach((t) => t.stop());
        dlg.remove(); resolve(answer);
      });
      document.body.append(dlg);
      dlg.showModal();
      input.focus();

      (async () => {
        const r = await reader();
        if (closed) return;
        if (!r) { say('De barcodelezer kon niet worden geladen. Typ de code, of gebruik een USB-barcodescanner.'); return; }
        photo.hidden = false;
        photo.querySelector('input').addEventListener('change', async (e) => {
          const f = e.target.files[0]; e.target.value = '';
          if (!f) return;
          say('Barcode zoeken in de foto…');
          try {
            const bmp = await createImageBitmap(f);
            const codes = await r.detect(bmp);
            if (codes[0]) done(codes[0]); else say('Geen barcode gevonden in deze foto. Probeer het dichterbij en recht van voren.');
          } catch { say('Deze foto kon niet worden gelezen.'); }
        });
        if (!canLive()) { say(window.isSecureContext ? 'Maak een foto van de barcode.' : 'Live scannen kan alleen via een beveiligde verbinding (https). Maak een foto van de barcode.'); return; }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
          if (closed) { stream.getTracks().forEach((t) => t.stop()); return; }
          video.srcObject = stream; box.hidden = false;
          await video.play().catch(() => {});
          say('Houd de barcode in het kader.');
          const tick = async () => {
            if (closed) return;
            if (video.readyState >= 2) {
              try { const codes = await r.detect(video); if (codes[0]) { done(codes[0]); return; } } catch { /* volgende keer */ }
            }
            timer = setTimeout(tick, r.slow ? 300 : 180);
          };
          tick();
        } catch {
          say('De camera kon niet worden geopend (geen toestemming?). Maak een foto van de barcode, of typ de code.');
        }
      })();
    });
  };

  /* Kort berichtje onderaan (geen pop-up die wegklikken vraagt). */
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'scan-toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.append(t);
    setTimeout(() => t.classList.add('out'), 3800);
    setTimeout(() => t.remove(), 4400);
  }
  async function lookup(code) {
    const r = await fetch('/voorraad/scan?code=' + encodeURIComponent(code), { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('Opzoeken lukte niet.');
    return r.json();
  }

  document.addEventListener('click', async (e) => {
    /* Barcodevak van een voorraaditem: code toevoegen. */
    const into = e.target.closest('[data-scan-into]');
    if (into) {
      const field = into.closest('.scan-field').querySelector('[data-scan-target]');
      const code = await window.adonisScan({ title: 'Barcode van de verpakking' });
      if (!code) return;
      const list = field.value.split(',').map((s) => s.trim()).filter(Boolean);
      if (!list.includes(code)) list.push(code);
      field.value = list.join(', ');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      if (window.adonisAutofilled) window.adonisAutofilled(field);
      return;
    }
    /* Voorraad: scannen = opzoeken. */
    const stock = e.target.closest('[data-scan-stock]');
    if (stock) {
      const code = await window.adonisScan({ title: 'Onderdeel zoeken', text: 'Scan de barcode op de verpakking (of het artikelnummer).' });
      if (!code) return;
      try {
        const { items } = await lookup(code);
        const soort = stock.dataset.soort || 'onderdeel';
        if (items.length === 1) { location.href = items[0].href; return; }
        if (items.length > 1) { location.href = `/voorraad?soort=${items[0].soort}&q=${encodeURIComponent(code)}`; return; }
        if (window.confirm(`Code ${code} staat nog niet in de voorraad.\n\nEen nieuw onderdeel toevoegen met deze barcode?`)) {
          location.href = `/voorraad/nieuw?soort=${soort}&barcode=${encodeURIComponent(code)}`;
        }
      } catch (err) { toast(err.message); }
      return;
    }
    /* Werkopdracht: gescand onderdeel in de eerstvolgende lege regel (of hetzelfde onderdeel: aantal + 1). */
    const part = e.target.closest('[data-scan-part]');
    if (part) {
      const code = await window.adonisScan({ title: 'Onderdeel scannen', text: 'Het onderdeel wordt uit de voorraad ingevuld: nummer, omschrijving en prijs.' });
      if (!code) return;
      try {
        const { items } = await lookup(code);
        const it = items[0];
        if (!it) { toast(`Code ${code} staat niet in de voorraad. Voeg hem toe bij Voorraad (barcode bij het onderdeel), dan werkt scannen de volgende keer.`); return; }
        const rows = [...part.closest('table').querySelectorAll('tbody tr')];
        const f = (row, k) => row.querySelector(`[name$="[${k}]"]`);
        const nr = it.nummer || it.oe_nummer || '';
        const set = (el, v) => { if (!el || el.disabled) return; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); if (window.adonisAutofilled) window.adonisAutofilled(el); };
        const same = nr && rows.find((row) => f(row, 'nr') && f(row, 'nr').value.trim().toUpperCase() === nr.toUpperCase());
        if (same) {
          const q = f(same, 'aantal'); set(q, String((parseInt(q.value, 10) || 1) + 1));
          toast(`${nr}: aantal is nu ${q.value}.`);
          return;
        }
        const row = rows.find((r) => f(r, 'nr') && !f(r, 'nr').value.trim() && !f(r, 'omschrijving').value.trim());
        if (!row) { toast('Alle regels voor onderdelen zijn vol. Voeg een extra blad toe.'); return; }
        set(f(row, 'nr'), nr);
        set(f(row, 'omschrijving'), it.omschrijving || '');
        if (f(row, 'aantal') && !f(row, 'aantal').value) set(f(row, 'aantal'), '1');
        if (it.prijs) set(f(row, 'prijs'), it.prijs);
        if (items.length > 1) toast(`${items.length} onderdelen met deze code; het eerste is ingevuld.`);
        else if (Number(it.aantal) <= 0) toast('Let op: dit onderdeel staat op 0 in de voorraad.');
      } catch (err) { toast(err.message); }
    }
  });
})();
