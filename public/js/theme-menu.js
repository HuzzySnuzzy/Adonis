'use strict';
/* Themamenu in de menubalk (zoals in DiscordLinked): Systeem, Licht, Donker, Neon + Effecten.
 * De keuze wordt per gebruiker op de server bewaard. Systeem/Licht/Donker wisselen meteen;
 * van of naar Neon of Black Ice herlaadt de pagina even (eigen achtergrondlagen). */
(function () {
  const btn = document.getElementById('themeBtn');
  const menu = document.getElementById('themeMenu');
  if (!btn || !menu) return;
  const root = document.documentElement;
  const items = () => [...menu.querySelectorAll('button[role="menuitemradio"]:not([aria-disabled="true"])')];
  const current = () => root.getAttribute('data-theme') || 'system';
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

  function syncFxNote() {
    const still = reduced && reduced.matches;
    document.getElementById('themeFxNote').hidden = !still;
    menu.querySelectorAll('.theme-fx-item').forEach((b) => b.setAttribute('aria-disabled', still ? 'true' : 'false'));
  }

  function open(focusChecked) {
    syncFxNote();
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    // Niet onder de rand van het scherm uit (telefoon dwars).
    const top = btn.getBoundingClientRect().bottom;
    menu.style.maxHeight = Math.max(160, window.innerHeight - top - 24) + 'px';
    const target = (focusChecked && menu.querySelector('.theme-item[aria-checked="true"]')) || items()[0];
    if (target) target.focus();
  }
  function close(returnFocus) {
    if (menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (returnFocus) btn.focus();
  }

  async function save(params) {
    const body = new URLSearchParams(params);
    const res = await fetch('/instellingen/thema', {
      method: 'POST', credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-CSRF-Token': menu.dataset.csrf, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error('Opslaan mislukt');
    return res.json();
  }

  function check(selector, attr, value) {
    menu.querySelectorAll(selector).forEach((b) => b.setAttribute('aria-checked', String(b.dataset[attr] === value)));
  }

  async function chooseTheme(theme) {
    const before = current();
    if (theme === before) return close(true);
    check('.theme-item', 'themeValue', theme);
    try { await save({ theme }); } catch { check('.theme-item', 'themeValue', before); return; }
    // Neon, Black Ice en VCDS hebben een eigen stijlblad of achtergrondlagen: dan de pagina even herladen.
    if (['neon', 'ice', 'vcds'].includes(theme) || ['neon', 'ice', 'vcds'].includes(before)) {
      window.adonisLeaving = true; // geen "niet opgeslagen"-waarschuwing; ingevulde gegevens blijven staan in het formulier
      location.reload();
      return;
    }
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.content = theme === 'system' ? 'light dark' : theme === 'oled' ? 'dark' : theme;
    const label = { system: 'Systeem', light: 'Licht', dark: 'Donker', oled: 'OLED', vcds: 'VCDS', neon: 'Neon', ice: 'Black Ice' }[theme];
    btn.title = 'Thema: ' + label;
    btn.setAttribute('aria-label', 'Thema kiezen (nu ' + label + ')');
    close(true);
  }

  async function chooseFx(fx) {
    if (root.getAttribute('data-fx') === fx) return;
    check('.theme-fx-item', 'fxValue', fx);
    root.setAttribute('data-fx', fx);
    try { await save({ fx }); } catch { /* volgende keer */ }
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault(); // met JavaScript: menu in plaats van doorschakelen
    if (menu.hidden) open(e.detail === 0); else close(false);
  });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(true); }
  });
  menu.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || t.getAttribute('aria-disabled') === 'true') return;
    if (t.dataset.themeValue) chooseTheme(t.dataset.themeValue);
    else if (t.dataset.fxValue) chooseFx(t.dataset.fxValue);
  });
  menu.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'Tab') close(false);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) close(false);
  });
})();
