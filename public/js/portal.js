'use strict';
/* Portaal: bewerken, zoeken, slepen en snelkoppelingen/bladwijzers importeren. */
(function () {
  const main = document.querySelector('.portal-page');
  if (!main) return;
  const csrf = main.dataset.csrf;
  const editing = () => main.classList.contains('is-editing');
  const post = (url, body) => fetch(url, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify(body),
  });

  /* ----- bewerken aan/uit (blijft in de adresbalk staan, ook na live verversen) ----- */
  const editBtn = document.querySelector('[data-portal-edit]');
  function setEditing(on) {
    main.classList.toggle('is-editing', on);
    editBtn.setAttribute('aria-pressed', String(on));
    const u = new URL(location.href);
    if (on) u.searchParams.set('bewerken', '1'); else u.searchParams.delete('bewerken');
    history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    markDraggable();
  }
  editBtn.addEventListener('click', () => setEditing(!editing()));

  /* ----- pictogram kan niet geladen worden: dan de letter ----- */
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.matches('[data-portal-icon]')) return;
    const letter = img.parentElement.querySelector('.pt-letter');
    if (letter) letter.hidden = false;
    img.remove();
  }, true);

  /* ----- zoeken ----- */
  const filter = document.querySelector('[data-portal-filter]');
  function applyFilter() {
    const q = filter.value.trim().toLowerCase();
    let any = false;
    document.querySelectorAll('.portal-folder').forEach((f) => {
      let n = 0;
      f.querySelectorAll('.portal-tile').forEach((t) => {
        const hit = !q || (t.dataset.title + ' ' + t.textContent + ' ' + t.dataset.url).toLowerCase().includes(q);
        t.hidden = !hit;
        if (hit) n++;
      });
      f.hidden = !!q && n === 0;
      if (n) any = true;
    });
    document.querySelector('.portal-nomatch').hidden = !q || any;
  }
  filter.addEventListener('input', applyFilter);
  filter.addEventListener('keydown', (e) => {
    // Enter: de eerste gevonden website openen
    if (e.key !== 'Enter') return;
    const first = [...document.querySelectorAll('.portal-tile')].find((t) => !t.hidden);
    if (first) { e.preventDefault(); window.open(first.href, '_blank', 'noopener'); }
  });

  /* ----- website wijzigen (venster) ----- */
  const dlg = document.getElementById('portalLinkDialog');
  const form = dlg.querySelector('[data-portal-linkform]');
  let current = null;
  const field = (n) => form.elements.namedItem(n); // let op: form.title is de titel van het formulier zelf
  function openEditor(tile) {
    current = tile;
    form.action = `/portaal/link/${tile.dataset.id}`;
    field('title').value = tile.dataset.title;
    field('url').value = tile.dataset.url;
    field('folder').value = tile.dataset.folder;
    field('zoek').value = tile.dataset.zoek || '';
    field('icoon').checked = false;
    dlg.showModal();
    field('title').focus();
  }
  document.addEventListener('click', (e) => {
    const tile = e.target.closest('.portal-tile');
    if (!tile || !editing()) return;
    // In de bewerkstand opent een klik het venster in plaats van de website.
    e.preventDefault();
    openEditor(tile);
  });
  dlg.querySelector('[data-portal-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.querySelector('[data-portal-delete]').addEventListener('click', async () => {
    if (!current || !window.confirm(`"${current.querySelector('.pt-title').textContent}" verwijderen uit het portaal?`)) return;
    await post(`/portaal/link/${current.dataset.id}/verwijderen`, {});
    current.remove();
    dlg.close();
  });

  /* ----- slepen: volgorde en andere map ----- */
  let dragging = null;
  function markDraggable() {
    document.querySelectorAll('.portal-tile').forEach((t) => { t.draggable = editing(); });
  }
  markDraggable();
  document.addEventListener('adonis:swapped', () => { markDraggable(); applyFilter(); });
  document.addEventListener('dragstart', (e) => {
    const tile = e.target.closest && e.target.closest('.portal-tile');
    if (!tile || !editing()) return;
    dragging = tile;
    tile.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-adonis-link', tile.dataset.id);
  });
  document.addEventListener('dragend', () => {
    if (dragging) dragging.classList.remove('is-dragging');
    dragging = null;
    document.querySelectorAll('.is-drop').forEach((el) => el.classList.remove('is-drop'));
  });
  function gridAt(target) { return target.closest && target.closest('.portal-folder') && target.closest('.portal-folder').querySelector('.portal-grid'); }
  document.addEventListener('dragover', (e) => {
    const folder = e.target.closest && e.target.closest('.portal-folder');
    const files = [...(e.dataTransfer.types || [])].some((t) => t === 'Files' || t === 'text/uri-list');
    // Bestanden naast een map: niet door de browser laten openen, maar importeren (in een nieuwe map).
    if (!folder && files && !dragging) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; return; }
    if (!folder || (!dragging && !files)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = dragging ? 'move' : 'copy';
    document.querySelectorAll('.is-drop').forEach((el) => { if (el !== folder) el.classList.remove('is-drop'); });
    folder.classList.add('is-drop');
    if (!dragging) return;
    const grid = gridAt(e.target);
    const over = e.target.closest('.portal-tile');
    const add = grid.querySelector('.portal-add');
    if (over && over !== dragging) {
      const r = over.getBoundingClientRect();
      grid.insertBefore(dragging, e.clientX > r.left + r.width / 2 ? over.nextSibling : over);
    } else if (!over && dragging.parentElement !== grid) {
      grid.insertBefore(dragging, add);
    }
  });
  document.addEventListener('drop', async (e) => {
    const folder = e.target.closest && e.target.closest('.portal-folder');
    if (!folder) {
      if (dragging || !(e.dataTransfer.files || []).length) return;
      e.preventDefault();
      return importFiles([...e.dataTransfer.files], null);
    }
    e.preventDefault();
    folder.classList.remove('is-drop');
    if (dragging) {
      const from = dragging.dataset.folder;
      dragging.dataset.folder = folder.dataset.folderId;
      const order = {};
      for (const fid of new Set([from, folder.dataset.folderId])) {
        const g = document.querySelector(`[data-folder-grid="${fid}"]`);
        if (g) order[fid] = [...g.querySelectorAll('.portal-tile')].map((t) => t.dataset.id);
      }
      await post('/portaal/volgorde', { folders: order });
      return;
    }
    // Bestanden (snelkoppelingen) of een adres uit de browser op een map laten vallen
    const files = [...(e.dataTransfer.files || [])];
    if (files.length) return importFiles(files, folder.dataset.folderId);
    const uri = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').split(/\r?\n/).find((l) => /^https?:\/\//i.test(l.trim()));
    if (uri) {
      const res = await fetch(`/portaal/map/${folder.dataset.folderId}/link`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'X-CSRF-Token': csrf },
        body: new URLSearchParams({ url: uri.trim() }),
      });
      if (res.ok) location.reload(); else alert((await res.json().catch(() => ({}))).error || 'Toevoegen lukte niet.');
    }
  });

  /* ----- importeren ----- */
  const readText = (f) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result || '')); r.onerror = () => ok(''); r.readAsText(f); });
  function parseBookmarks(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const groups = new Map();
    doc.querySelectorAll('a[href]').forEach((a) => {
      const url = a.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(url)) return;
      let name = 'Bladwijzers';
      for (let el = a.parentElement; el; el = el.parentElement) {
        if (el.tagName === 'DL') {
          const h = el.previousElementSibling;
          if (h && h.tagName === 'H3') { name = h.textContent.trim() || name; break; }
        }
      }
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push({ title: a.textContent.trim(), url });
    });
    return [...groups].map(([name, links]) => ({ name, links }));
  }
  async function importFiles(files, folderId) {
    const shortcuts = [];
    let groups = [];
    for (const f of files) {
      const name = f.name.replace(/\.(url|webloc|html?)$/i, '');
      const text = await readText(f);
      if (/\.html?$/i.test(f.name) || /<!DOCTYPE NETSCAPE-Bookmark/i.test(text)) {
        groups = groups.concat(parseBookmarks(text));
        continue;
      }
      const m = /^\s*URL\s*=\s*(\S+)/mi.exec(text) || /<string>\s*(https?:[^<\s]+)\s*<\/string>/i.exec(text);
      if (m && /^https?:/i.test(m[1])) shortcuts.push({ title: name, url: m[1] });
    }
    if (shortcuts.length) {
      let folderName = '';
      if (!folderId) {
        folderName = await window.adonisAsk({ title: `${shortcuts.length} snelkoppeling${shortcuts.length === 1 ? '' : 'en'} gevonden`,
          text: 'In welke map moeten ze?', value: 'Bureaublad', ok: 'Toevoegen' });
        if (folderName === null) return;
      }
      groups.push({ name: folderName || 'Bureaublad', links: shortcuts });
    }
    if (!groups.length) {
      window.alert('Hierin zijn geen websites gevonden. Kies snelkoppelingen (.url) of een bladwijzerbestand (.html).\n\n(Pictogrammen van programma\'s (.lnk) kunnen niet; alleen websites.)');
      return;
    }
    const res = await post('/portaal/importeren', { folderId: folderId || null, folders: groups });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) { window.alert(r.error || 'Importeren lukte niet.'); return; }
    window.alert(`${r.added} website${r.added === 1 ? '' : 's'} toegevoegd${r.dup ? `, ${r.dup} stond${r.dup === 1 ? '' : 'en'} er al` : ''}${r.bad ? `, ${r.bad} overgeslagen (geen geldig adres)` : ''}.\n\nDe pictogrammen worden op de achtergrond opgehaald en verschijnen vanzelf.`);
    location.reload();
  }
  // Pictogrammen die nog worden opgehaald (draaiend rondje): zelf even opnieuw kijken tot ze er zijn.
  let tries = 0;
  async function pollIcons() {
    if (!document.querySelector('#live-portal .pt-loading') || tries++ > 40 || document.hidden) return;
    try {
      const res = await fetch(location.href, { headers: { 'X-Live-Refresh': '1' }, credentials: 'same-origin' });
      const fresh = new DOMParser().parseFromString(await res.text(), 'text/html').getElementById('live-portal');
      const live = document.getElementById('live-portal');
      if (fresh && live && fresh.innerHTML !== live.innerHTML) {
        live.innerHTML = fresh.innerHTML;
        document.dispatchEvent(new Event('adonis:swapped'));
      }
    } catch { /* volgende keer */ }
    schedule(3000);
  }
  let pollTimer = null;
  const schedule = (ms) => { clearTimeout(pollTimer); pollTimer = setTimeout(pollIcons, ms); }; // altijd maar één keten
  schedule(2000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(500); });

  const picker = document.querySelector('[data-portal-import]');
  if (picker) picker.addEventListener('change', () => { const files = [...picker.files]; picker.value = ''; if (files.length) importFiles(files, null); });
})();
