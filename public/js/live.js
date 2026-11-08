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
  let refreshPending = false;
  // Tabbladen op de achtergrond werken pas bij als je er weer naartoe gaat.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && refreshPending) { refreshPending = false; refreshLists(); }
  });
  function refreshLists() {
    if (!document.querySelector('[data-live]')) return;
    if (document.visibilityState === 'hidden') { refreshPending = true; return; }
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      try {
        const res = await fetch(location.href, { headers: { 'X-Live-Refresh': '1' }, credentials: 'same-origin' });
        if (!res.ok || res.redirected) return;
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        document.querySelectorAll('[data-live]:not([data-live-remote])').forEach((el) => {
          const fresh = doc.getElementById(el.id);
          if (fresh && fresh.innerHTML !== el.innerHTML) {
            el.innerHTML = fresh.innerHTML;
            el.classList.remove('live-flash');
            void el.offsetWidth; // animatie opnieuw starten
            el.classList.add('live-flash');
          }
        });
        document.dispatchEvent(new Event('adonis:swapped'));
      } catch { /* volgende keer beter */ }
    }, 300);
  }

  /* De server wordt bijgewerkt (nieuwe versie al gedownload, nu een paar seconden herstarten). */
  let updatingTo = null;
  // Iemand is iets aan het typen dat nog niet is opgeslagen (alleen de cursor in het zoekveld telt niet).
  function typing() {
    const el = document.activeElement;
    if (!el || !el.matches) return false;
    if (el.matches('[contenteditable="true"]')) return true;
    if (el.matches('textarea, input:not([type=checkbox], [type=radio], [type=button], [type=submit])')) return el.value !== el.defaultValue;
    return false;
  }
  function afterReconnect() {
    refreshLists();
    if (!updatingTo) return;
    const v = updatingTo; updatingTo = null;
    const busy = (window.adonisOrderDirty && window.adonisOrderDirty()) || (window.adonisFormDirty && window.adonisFormDirty())
      || document.querySelector('dialog[open], .ai-busy:not([hidden])')
      || typing();
    if (!busy) { window.adonisLeaving = true; location.reload(); return; }
    toast(`ADONIS is bijgewerkt naar v${v}. Vernieuw de pagina (F5) als u klaar bent.`);
  }
  function handle(ev) {
    if (ev.type === 'server-update') { updatingTo = ev.version; toast(`ADONIS wordt bijgewerkt naar v${ev.version} – een paar seconden geduld…`); return; }
    if (ev.type === 'notes') { if (String(ev.byId) !== String(me)) document.dispatchEvent(new CustomEvent('adonis:notes', { detail: ev })); return; }
    // Bandenhotel/voorraad gewijzigd door een collega: lijsten op dit scherm bijwerken.
    if (ev.type === 'data') {
      if (String(ev.byId) !== String(me)) refreshLists();
      return;
    }
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
    if (byOther && ev.action === 'created' && ev.status !== 'klaar') toast(`${label} toegevoegd door ${ev.by}`, `/werkopdracht/${ev.id}`);
    if (byOther && ev.status === 'klaar' && ev.action !== 'updated' && document.body.dataset.canInvoice) {
      toast(`${label} is klaar voor facturatie (door ${ev.by})`, `/werkopdracht/${ev.id}`);
    }
    refreshLists();
  }

  /*
   * Eén live-verbinding per browser in plaats van per tabblad. Een browser opent over http maximaal
   * 6 verbindingen per server; met een open verbinding per tabblad liep dat vol en bleef klikken hangen.
   * Eén tabblad ("leider") houdt de verbinding en geeft berichten door aan de andere tabbladen.
   * Sluit dat tabblad, dan neemt een ander het automatisch over.
   */
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('adonis-live') : null;
  if (channel) {
    channel.onmessage = (m) => {
      if (m.data && m.data.type === 'reconnected') afterReconnect();
      else handle(m.data);
    };
  }

  function openStream(onClose) {
    const es = new EventSource('/events');
    let wasDown = false;
    es.onmessage = (m) => {
      let data;
      try { data = JSON.parse(m.data); } catch { return; }
      handle(data);
      if (channel) channel.postMessage(data);
    };
    es.onerror = () => { wasDown = true; };
    es.onopen = () => {
      // Na een onderbreking (herstart/update) alles één keer bijwerken.
      if (wasDown) {
        wasDown = false;
        afterReconnect();
        if (channel) channel.postMessage({ type: 'reconnected' });
      }
    };
    const close = () => { es.close(); if (onClose) onClose(); };
    window.addEventListener('pagehide', close, { once: true });
    return close;
  }

  if (channel && navigator.locks && navigator.locks.request) {
    // De lock wordt vrijgegeven als dit tabblad sluit of wegnavigeert; dan neemt een ander tabblad het over.
    navigator.locks.request('adonis-live', () => new Promise((release) => { openStream(release); }));
  } else {
    // Oudere browsers: alleen verbinden zolang het tabblad zichtbaar is.
    let close = null;
    const sync = () => {
      if (document.visibilityState === 'visible' && !close) {
        close = openStream(() => { close = null; });
        refreshLists();
      } else if (document.visibilityState !== 'visible' && close) {
        close();
      }
    };
    document.addEventListener('visibilitychange', sync);
    if (document.visibilityState === 'visible') close = openStream(() => { close = null; });
  }
})();
