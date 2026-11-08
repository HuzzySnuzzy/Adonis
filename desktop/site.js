'use strict';
/* Een website uit het Portaal in een eigen ADONIS-venster: knoppen terug/vooruit/herladen, het adres, en "openen in browser". */
(function () {
  const q = new URLSearchParams(location.search);
  const view = document.getElementById('view');
  const addr = document.getElementById('addr');
  const back = document.getElementById('back');
  const fwd = document.getElementById('fwd');
  const url = q.get('url') || '';
  if (!/^https?:\/\//i.test(url)) return;
  view.src = url;
  const show = (u) => {
    try {
      const x = new URL(u);
      addr.replaceChildren();
      if (x.protocol === 'https:') { const l = document.createElement('span'); l.className = 'lock'; l.textContent = '🔒'; addr.append(l); }
      const h = document.createElement('b'); h.textContent = x.hostname.replace(/^www\./, ''); addr.append(h);
      addr.append(document.createTextNode(x.pathname + x.search));
      addr.title = u;
    } catch { addr.textContent = u; }
  };
  show(url);
  const nav = () => { try { back.disabled = !view.canGoBack(); fwd.disabled = !view.canGoForward(); show(view.getURL()); } catch { /* nog niet klaar */ } };
  view.addEventListener('did-navigate', nav);
  view.addEventListener('did-navigate-in-page', nav);
  view.addEventListener('did-start-loading', () => document.body.classList.add('loading'));
  view.addEventListener('did-stop-loading', () => { document.body.classList.remove('loading'); nav(); });
  view.addEventListener('page-title-updated', (e) => { document.title = e.title + ' – ADONIS'; });
  back.addEventListener('click', () => view.goBack());
  fwd.addEventListener('click', () => view.goForward());
  document.getElementById('reload').addEventListener('click', () => view.reload());
  document.getElementById('ext').addEventListener('click', () => window.adonisApp && window.adonisApp.openExternal(view.getURL() || url));
  addEventListener('keydown', (e) => {
    if (e.key === 'F5') { e.preventDefault(); view.reload(); }
    if (e.altKey && e.key === 'ArrowLeft' && view.canGoBack()) view.goBack();
    if (e.altKey && e.key === 'ArrowRight' && view.canGoForward()) view.goForward();
  });
})();
