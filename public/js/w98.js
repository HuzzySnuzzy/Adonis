'use strict';
/* Thema Windows 98: een klok rechts in de taakbalk (de voettekst). */
(function () {
  const bar = document.querySelector('.app-footer');
  if (!bar) return;
  const clock = document.createElement('span');
  clock.className = 'w98-clock';
  const tick = () => { clock.textContent = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }); };
  tick();
  bar.append(clock);
  setTimeout(() => { tick(); setInterval(tick, 60000); }, (60 - new Date().getSeconds()) * 1000);
})();
