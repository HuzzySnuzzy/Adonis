'use strict';
(async function () {
  const params = new URLSearchParams(location.search);
  const input = document.getElementById('url');
  const msg = document.getElementById('msg');
  const go = document.getElementById('go');
  const back = document.getElementById('back');
  const cfg = await window.adonisApp.getConfig();
  if (cfg.url) {
    input.value = cfg.url;
    document.getElementById('title').textContent = 'Adres van de server wijzigen';
    document.getElementById('intro').textContent = 'De app maakt nu verbinding met het adres hieronder. Pas het aan en klik op Verbinden.';
    back.hidden = false;
    input.select();
  }
  back.addEventListener('click', () => window.adonisApp.open());
  document.getElementById('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.className = 'msg';
    msg.textContent = 'Verbinden…';
    go.disabled = true;
    const r = await window.adonisApp.saveUrl(input.value);
    go.disabled = false;
    if (r.ok) {
      msg.className = 'msg ok';
      msg.textContent = 'Verbonden met ' + r.url + ' – ADONIS wordt geopend…';
    } else {
      msg.textContent = r.error;
    }
  });
  if (params.get('reason') === 'wijzigen') input.focus();
})();
