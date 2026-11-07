'use strict';
/* Foto's koppelen: een map (of .zip) met foto's aan de geïmporteerde records hangen, op bestandsnaam. */
(function () {
  const card = document.getElementById('linkCard');
  if (!card || !document.getElementById('dirInput')) return;
  const csrf = card.dataset.csrf;
  const IMAGE = /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i;
  const $ = (id) => document.getElementById(id);
  const base = (name) => String(name).replace(/\\/g, '/').split('/').pop().trim().toLowerCase();
  let busy = false;

  async function collect(fileList) {
    const out = [];
    for (const f of fileList) {
      if (/\.zip$/i.test(f.name)) {
        if (!window.fflate) throw new Error('Zip uitpakken is niet beschikbaar; pak de zip eerst uit en kies de map.');
        $('linkText').textContent = `${f.name} uitpakken…`;
        const entries = window.fflate.unzipSync(new Uint8Array(await f.arrayBuffer()), { filter: (e) => IMAGE.test(e.name) && !/__MACOSX\//.test(e.name) });
        for (const [name, bytes] of Object.entries(entries)) {
          const ext = name.split('.').pop().toLowerCase();
          out.push({ name, blob: new Blob([bytes], { type: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' }) });
        }
      } else if (IMAGE.test(f.name)) {
        out.push({ name: f.webkitRelativePath || f.name, blob: f });
      }
    }
    return out;
  }

  function li(list, text) {
    const el = document.createElement('li');
    el.textContent = text;
    list.append(el);
  }

  async function run(fileList) {
    if (busy || !fileList.length) return;
    busy = true;
    $('linkProgress').hidden = false;
    $('linkResult').hidden = true;
    ['linkSummary', 'linkMissing', 'linkErrors'].forEach((id) => { $(id).innerHTML = ''; });
    let files;
    try {
      files = await collect([...fileList]);
    } catch (e) {
      $('linkText').textContent = e.message;
      busy = false;
      return;
    }
    $('linkText').textContent = 'Verwijzingen ophalen…';
    const { refs } = await (await fetch('/importeren/fotos/verwijzingen', { credentials: 'same-origin' })).json();
    const jobs = [];
    const missing = [];
    let already = 0;
    for (const f of files) {
      const owners = refs[base(f.name)];
      if (!owners) { missing.push(f.name); continue; }
      const todo = owners.filter((o) => !o.linked);
      if (!todo.length) { already++; continue; }
      jobs.push({ f, todo });
    }
    const bar = $('linkBar');
    bar.max = Math.max(1, jobs.length);
    bar.value = 0;
    let linked = 0;
    const errors = [];
    let next = 0;
    async function worker() {
      while (next < jobs.length) {
        const job = jobs[next++];
        try {
          const data = await window.adonisPhotos.prepare(job.f.blob);
          for (const o of job.todo) {
            const r = await window.adonisPhotos.upload(o.type, o.id, csrf, { ...data, name: base(job.f.name), ref: base(job.f.name) });
            if (!r.existed) linked++;
          }
        } catch (e) {
          errors.push(`${base(job.f.name)}: ${e.message}`);
        }
        bar.value++;
        $('linkText').textContent = `${bar.value} van ${jobs.length} foto's verwerkt…`;
      }
    }
    if (!jobs.length) $('linkText').textContent = 'Niets nieuws om te koppelen.';
    await Promise.all([worker(), worker(), worker()]);
    if (jobs.length) $('linkText').textContent = 'Klaar.';
    li($('linkSummary'), `${linked} foto's gekoppeld`);
    if (already) li($('linkSummary'), `${already} waren al gekoppeld`);
    if (missing.length) li($('linkSummary'), `${missing.length} foto's horen bij geen enkel record (zie hieronder)`);
    if (errors.length) li($('linkSummary'), `${errors.length} niet gelukt`);
    missing.slice(0, 300).forEach((m) => li($('linkMissing'), m));
    errors.forEach((m) => li($('linkErrors'), m));
    $('linkMissingWrap').hidden = !missing.length;
    $('linkErrorsWrap').hidden = !errors.length;
    $('linkResult').hidden = false;
    busy = false;
  }
  ['dirInput', 'filesInput'].forEach((id) => $(id).addEventListener('change', (e) => { run(e.target.files); e.target.value = ''; }));
})();
