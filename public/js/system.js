'use strict';
// Toon "bezig" en voorkom dubbel klikken tijdens het installeren.
document.querySelectorAll('.sys-form').forEach((form) => {
  form.addEventListener('submit', () => {
    const btn = form.querySelector('button[type=submit]');
    if (btn) { btn.disabled = true; btn.textContent = 'Bezig…'; }
    const note = form.querySelector('.busy-note');
    if (note) note.hidden = false;
  });
});
