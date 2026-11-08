'use strict';
(function () {
  const card = document.getElementById('importCard');
  if (!card) return;
  const MAX = parseInt(card.dataset.max, 10) || 4;
  const MAX_SIDE = 2000; // pixels: scherp genoeg voor handschrift, klein genoeg om snel te versturen
  const thumbs = document.getElementById('thumbs');
  const startBtn = document.getElementById('startImport');
  const errorBox = document.getElementById('importError');
  const busy = document.getElementById('busy');
  const images = []; // data-URL's (JPEG)

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = !msg;
  }

  async function loadBitmap(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* val terug */ }
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Kan deze afbeelding niet openen.'));
      img.src = URL.createObjectURL(file);
    });
  }

  async function toJpeg(file) {
    const bmp = await loadBitmap(file);
    const w = bmp.width, h = bmp.height;
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  function render() {
    thumbs.innerHTML = '';
    images.forEach((url, i) => {
      const fig = document.createElement('figure');
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Foto ' + (i + 1);
      const cap = document.createElement('figcaption');
      cap.textContent = i === 0 ? 'Voorkant' : i === 1 ? 'Achterkant' : 'Foto ' + (i + 1);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'thumb-del';
      del.setAttribute('aria-label', 'Foto verwijderen');
      del.textContent = '×';
      del.addEventListener('click', () => { images.splice(i, 1); render(); });
      fig.append(img, cap, del);
      thumbs.append(fig);
    });
    startBtn.disabled = images.length === 0;
  }

  async function addFiles(fileList) {
    showError('');
    for (const file of Array.from(fileList)) {
      if (images.length >= MAX) { showError(`Maximaal ${MAX} foto's.`); break; }
      try {
        images.push(await toJpeg(file));
      } catch (err) {
        showError(err.message || 'Kan deze afbeelding niet openen.');
      }
    }
    render();
  }

  ['cameraInput', 'fileInput'].forEach((id) => {
    const input = document.getElementById(id);
    input.addEventListener('change', async () => {
      await addFiles(input.files);
      input.value = '';
    });
  });

  startBtn.addEventListener('click', async () => {
    showError('');
    // Eerst kiezen hoeveel moeite Claude mag doen (met kostenschatting).
    let effort = 'hoog';
    if (window.adonisAi) {
      effort = await window.adonisAi.choose({ taak: 'foto', params: { n: images.length }, title: 'Werkopdracht uitlezen' });
      if (!effort) return;
    }
    startBtn.disabled = true;
    busy.hidden = false;
    try {
      const res = await fetch('/importeren', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': card.dataset.csrf },
        body: JSON.stringify({ images, effort }),
      });
      let body = {};
      try { body = await res.json(); } catch { /* geen JSON */ }
      if (!res.ok || !body.redirect) throw new Error(body.error || 'Uitlezen mislukt (' + res.status + ').');
      window.location.href = body.redirect;
    } catch (err) {
      showError(err.message === 'Failed to fetch' ? 'Geen verbinding met de server.' : err.message);
      startBtn.disabled = false;
      busy.hidden = true;
    }
  });
})();
