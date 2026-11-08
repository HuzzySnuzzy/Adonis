'use strict';
/* Hoekje rechtsonder: voortgang van het bijwerken van de app, en daarna "Nu opnieuw starten" / "Later". */
const $ = (id) => document.getElementById(id);
const mb = (n) => (n / 1048576).toLocaleString('nl-NL', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
function show(s) {
  const toast = $('toast');
  toast.classList.toggle('err', s.state === 'fout');
  $('ask').hidden = s.state !== 'klaar';
  $('bar').hidden = s.state !== 'download';
  if (s.state === 'download') {
    $('title').textContent = `ADONIS bijwerken naar versie ${s.version}`;
    const known = s.total > 0;
    $('bar').classList.toggle('indeterminate', !known);
    $('fill').style.width = known ? Math.min(100, Math.round((s.received / s.total) * 100)) + '%' : '';
    $('sub').textContent = known ? `${Math.round((s.received / s.total) * 100)}% · ${mb(s.received)} van ${mb(s.total)} MB` : `${mb(s.received)} MB gedownload…`;
  } else if (s.state === 'klaar') {
    $('title').textContent = `Versie ${s.version} is klaar`;
    $('sub').textContent = 'Nu opnieuw starten, of later: dan bij de volgende start.';
  } else if (s.state === 'fout') {
    $('title').textContent = 'Bijwerken lukte niet';
    $('sub').textContent = s.error ? s.error.charAt(0).toUpperCase() + s.error.slice(1) + '. ADONIS probeert het later opnieuw.' : 'ADONIS probeert het later opnieuw.';
  } else if (s.state === 'actueel') {
    $('title').textContent = 'ADONIS is up-to-date';
    $('sub').textContent = `U heeft de nieuwste versie (${s.version}).`;
  } else if (s.state === 'bezig') {
    $('title').textContent = 'Controleren op updates…';
    $('sub').textContent = '';
  }
}
window.adonisApp.onUpdateState(show);
$('restart').addEventListener('click', () => window.adonisApp.updateRestart());
$('later').addEventListener('click', () => window.adonisApp.updateHide());
$('close').addEventListener('click', () => window.adonisApp.updateHide());
