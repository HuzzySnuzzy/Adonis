'use strict';
const params = new URLSearchParams(location.search);
document.getElementById('url').textContent = params.get('url') || '(onbekend)';
document.getElementById('err').textContent = params.get('error') ? 'Melding: ' + params.get('error') : '';
document.getElementById('retry').addEventListener('click', () => window.adonisApp.open());
document.getElementById('change').addEventListener('click', () => window.adonisApp.setup());
let left = 15;
setInterval(() => {
  left -= 1;
  document.getElementById('sec').textContent = String(Math.max(0, left));
  if (left === 0) window.adonisApp.open();
}, 1000);
