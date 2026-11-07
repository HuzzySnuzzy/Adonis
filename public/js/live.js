'use strict';
/* Live bijwerken: luistert naar wijzigingen van collega's en werkt het scherm bij. */
(function () {
  if (!window.EventSource) return;
  const me = document.body.dataset.userId;
  const liveOrder = document.getElementById('live-order');
  const openOrderId = liveOrder ? liveOrder.dataset.id : null;
  const toasts = document.getElementById('liveToasts');

  function toast(text, href) {
    if (!toasts) return;
    const el = document.createElement(href ? 'a' : 'div');
    el.className = 'live-toast';
    el.textContent = text;
    if (href) el.href = href;
    toasts.append(el);
    setTimeout(() => el.classList.add('hide'), 6000);
    setTimeout(() => el.remove(), 6600);
  }

  function banner(text, withReload) {
    let el = document.getElementById('liveBanner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'liveBanner';
      el.className = 'live-banner no-print';
      const toolbar = document.querySelector('.order-toolbar');
      (toolbar || document.body.firstElementChild).after(el);
    }
    el.textContent = text + ' ';
    if (withReload) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-small';
      btn.textContent = 'Herladen (jouw wijzigingen gaan verloren)';
      btn.addEventListener('click', () => { window.adonisLeaving = true; location.reload(); });
      el.append(btn);
    }
  }

  // Lijsten op deze pagina opnieuw ophalen en alleen de "live" delen vervangen.
  let refreshTimer = null;
  function refreshLists() {
    if (!document.querySelector('[data-live]')) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      try {
        const res = await fetch(location.href, { headers: { 'X-Live-Refresh': '1' }, credentials: 'same-origin' });
        if (!res.ok || res.redirected) return;
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        document.querySelectorAll('[data-live]').forEach((el) => {
          const fresh = doc.getElementById(el.id);
          if (fresh && fresh.innerHTML !== el.innerHTML) {
            el.innerHTML = fresh.innerHTML;
            el.classList.remove('live-flash');
            void el.offsetWidth; // animatie opnieuw starten
            el.classList.add('live-flash');
          }
        });
      } catch { /* volgende keer beter */ }
    }, 300);
  }

  function handle(ev) {
    if (ev.type !== 'order') return;
    const byOther = String(ev.byId) !== String(me);
    const label = `Werkopdracht ${ev.nummer}${ev.kenteken ? ` (${ev.kenteken})` : ''}`;

    if (openOrderId && String(ev.id) === openOrderId && byOther) {
      if (ev.action === 'deleted') {
        banner(`${ev.by} heeft deze werkopdracht zojuist verwijderd.`, false);
      } else if (window.adonisOrderDirty && window.adonisOrderDirty()) {
        banner(`${ev.by} heeft deze werkopdracht zojuist gewijzigd. Opslaan zou hun wijzigingen overschrijven.`, true);
      } else {
        location.reload(); // niets veranderd hier: gewoon de nieuwste versie tonen
        return;
      }
    }
    if (byOther && ev.action === 'created') toast(`${label} toegevoegd door ${ev.by}`, `/werkopdracht/${ev.id}`);
    refreshLists();
  }

  const es = new EventSource('/events');
  es.onmessage = (m) => {
    try { handle(JSON.parse(m.data)); } catch { /* onbekend bericht */ }
  };
  // Na een onderbreking (herstart/update) alles één keer bijwerken.
  let wasDown = false;
  es.onerror = () => { wasDown = true; };
  es.onopen = () => { if (wasDown) { wasDown = false; refreshLists(); } };
})();
