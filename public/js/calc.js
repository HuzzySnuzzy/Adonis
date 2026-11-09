'use strict';
/* Rekenhulp: omrekenen in de werkplaats. Alles in de browser, er wordt niets opgeslagen. */
(function () {
  // "2,5" en "2.5" zijn allebei 2,5; staan er punten én een komma ("1.250,50"), dan zijn de punten duizendtallen.
  const parse = (v) => { let s = String(v ?? '').trim().replace(/\s/g, ''); if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, ''); s = s.replace(',', '.'); const n = parseFloat(s); return Number.isFinite(n) ? n : null; };
  const fmt = (n, d = 2) => (n === null || !Number.isFinite(n) ? '' : n.toLocaleString('nl-NL', { maximumFractionDigits: d }));
  const money = (n) => '€ ' + n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const $ = (id) => document.getElementById(id);

  /* ---------- omrekenen met een vaste factor (alles via één basiseenheid) ---------- */
  for (const box of document.querySelectorAll('[data-sync]')) {
    const inputs = [...box.querySelectorAll('input[data-f]')];
    const run = (src) => {
      const v = parse(src.value);
      for (const i of inputs) if (i !== src) i.value = v === null ? '' : fmt(v * Number(src.dataset.f) / Number(i.dataset.f), 3);
    };
    inputs.forEach((i) => i.addEventListener('input', () => run(i)));
    const first = inputs.find((i) => i.value); if (first) run(first);
  }

  /* ---------- verbruik (l/100 km is omgekeerd evenredig) ---------- */
  const fuel = document.querySelector('[data-fuel]');
  if (fuel) {
    const K = { kml: 100, mpguk: 282.481, mpgus: 235.215 }; // waarde × l/100km = K
    const ins = [...fuel.querySelectorAll('input')];
    const run = (src) => {
      const v = parse(src.value);
      const l100 = v === null || v <= 0 ? null : src.dataset.fuel === 'l100' ? v : K[src.dataset.fuel] / v;
      for (const i of ins) if (i !== src) i.value = l100 === null ? '' : fmt(i.dataset.fuel === 'l100' ? l100 : K[i.dataset.fuel] / l100, 2);
    };
    ins.forEach((i) => i.addEventListener('input', () => run(i))); run(ins[0]);
  }

  /* ---------- temperatuur ---------- */
  const temp = document.querySelector('[data-temp]');
  if (temp) {
    const [c, f] = temp.querySelectorAll('input');
    c.addEventListener('input', () => { const v = parse(c.value); f.value = v === null ? '' : fmt(v * 9 / 5 + 32, 1); });
    f.addEventListener('input', () => { const v = parse(f.value); c.value = v === null ? '' : fmt((v - 32) * 5 / 9, 1); });
    c.dispatchEvent(new Event('input'));
  }

  /* ---------- BTW ---------- */
  const vat = document.querySelector('[data-vat]');
  if (vat) {
    const g = (k) => vat.querySelector(`[data-vat="${k}"]`);
    const run = (from) => {
      const pct = parse(g('pct').value) ?? 0;
      let ex = parse(g('ex').value); const inc = parse(g('inc').value);
      if (from === 'inc') ex = inc === null ? null : inc / (1 + pct / 100);
      if (from !== 'ex' && from !== 'pct') g('ex').value = ex === null ? '' : fmt(ex, 2);
      g('tax').value = ex === null ? '' : fmt(ex * pct / 100, 2);
      if (from !== 'inc') g('inc').value = ex === null ? '' : fmt(ex * (1 + pct / 100), 2);
    };
    for (const k of ['pct', 'ex', 'inc']) g(k).addEventListener('input', () => run(k));
    run('ex');
  }

  /* ---------- arbeidsloon ---------- */
  function hours(v) {
    const s = String(v || '').trim();
    const m = /^(\d+)\s*[:u.h]\s*(\d{1,2})$/i.exec(s.replace(/\s*(uur|min)\s*/g, (x, w) => (w === 'uur' ? ':' : '')));
    if (m && /[:uh]/i.test(s)) return Number(m[1]) + Number(m[2]) / 60;
    return parse(s);
  }
  function labour() {
    const h = hours($('labTime').value); const rate = parse($('labRate').value);
    if (h === null) { $('labOut').innerHTML = ''; return; }
    const hm = `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
    let html = `<p><b>${fmt(h, 2)} uur</b> (${hm})</p>`;
    if (rate !== null) { const ex = h * rate; html += `<dl class="calc-dl"><dt>Excl. BTW</dt><dd>${money(ex)}</dd><dt>Incl. 21% BTW</dt><dd>${money(ex * 1.21)}</dd></dl>`; }
    $('labOut').innerHTML = html;
  }
  if ($('labTime')) { $('labTime').addEventListener('input', labour); $('labRate').addEventListener('input', labour); labour(); }

  /* ---------- mengsmering ---------- */
  function mix() {
    const l = parse($('mixL').value); const r = parse($('mixR').value);
    $('mixOut').innerHTML = l && r ? `<p><b>${fmt(l * 1000 / r, 0)} ml</b> 2-taktolie op ${fmt(l, 2)} liter benzine (1:${fmt(r, 0)}).</p>` : '';
  }
  if ($('mixL')) { $('mixL').addEventListener('input', mix); $('mixR').addEventListener('input', mix); mix(); }

  /* ---------- last- en snelheidsindex ---------- */
  const LOAD = [190, 195, 200, 206, 212, 218, 224, 230, 236, 243, 250, 257, 265, 272, 280, 290, 300, 307, 315, 325, 335, 345, 355, 365, 375, 387,
    400, 412, 425, 437, 450, 462, 475, 487, 500, 515, 530, 545, 560, 580, 600, 615, 630, 650, 670, 690, 710, 730, 750, 775, 800, 825, 850, 875,
    900, 925, 950, 975, 1000, 1030, 1060, 1090, 1120, 1150, 1180, 1215, 1250, 1285, 1320, 1360, 1400, 1450, 1500, 1550, 1600, 1650, 1700]; // index 50 t/m 126
  const loadKg = (i) => (i >= 50 && i <= 126 ? LOAD[i - 50] : null);
  const SPEED = { L: 120, M: 130, N: 140, P: 150, Q: 160, R: 170, S: 180, T: 190, U: 200, H: 210, V: 240, W: 270, Y: 300 };
  function loadIndex() {
    const s = $('liIn').value.toUpperCase().replace(/\s/g, '');
    const m = /(\d{2,3})(?:\/(\d{2,3}))?(\(?[A-Z]{1,2}\)?)?$/.exec(s);
    const out = [];
    if (m) {
      const a = loadKg(Number(m[1]));
      if (a) out.push(`<dt>Draagvermogen</dt><dd><b>${a} kg</b> per band (${fmt(a * 4, 0)} kg voor 4 banden)</dd>`);
      const b = m[2] && loadKg(Number(m[2]));
      if (b) out.push(`<dt>Dubbellucht</dt><dd>${b} kg per band</dd>`);
      const sp = m[3] && m[3].replace(/[()]/g, '');
      if (sp && SPEED[sp]) out.push(`<dt>Max. snelheid</dt><dd><b>${SPEED[sp]} km/h</b>${m[3].startsWith('(') ? ' (en hoger, zie fabrikant)' : ''}</dd>`);
      else if (sp === 'ZR') out.push('<dt>Max. snelheid</dt><dd>meer dan 240 km/h</dd>');
    }
    if (/ZR/.test(s) && !out.some((x) => x.includes('240'))) out.push('<dt>ZR</dt><dd>geschikt voor meer dan 240 km/h</dd>');
    $('liOut').innerHTML = out.length ? `<dl class="calc-dl">${out.join('')}</dl>` : '<p class="muted small">Niet herkend. Typ bijvoorbeeld 91V.</p>';
  }
  if ($('liIn')) { $('liIn').addEventListener('input', loadIndex); loadIndex(); }

  /* ---------- DOT ---------- */
  function dot() {
    const d = $('dotIn').value.replace(/\D/g, '');
    if (!d) { $('dotOut').innerHTML = ''; return; }
    if (d.length === 3) { $('dotOut').innerHTML = '<p class="calc-bad"><b>Gemaakt vóór 2000</b> (3 cijfers). Deze band is veel te oud: vervangen.</p>'; return; }
    const m = /^(\d{2})(\d{2})$/.exec(d.slice(-4));
    const week = m && Number(m[1]); const year = m && 2000 + Number(m[2]);
    if (!m || week < 1 || week > 53) { $('dotOut').innerHTML = '<p class="muted small">Typ de laatste 4 cijfers, bijvoorbeeld 2321.</p>'; return; }
    const made = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
    const age = (Date.now() - made) / (365.25 * 864e5);
    if (age < -0.1) { $('dotOut').innerHTML = '<p class="muted small">Die datum ligt in de toekomst. Klopt het nummer?</p>'; return; }
    const y = Math.floor(Math.max(age, 0)); const mo = Math.floor((Math.max(age, 0) % 1) * 12);
    const cls = age >= 10 ? 'calc-bad' : age >= 6 ? 'calc-warn' : 'calc-ok';
    const advice = age >= 10 ? 'Ouder dan 10 jaar: vervangen.' : age >= 6 ? 'Ouder dan 6 jaar: goed controleren op scheurtjes en hardheid, vervangen adviseren.' : 'Leeftijd in orde.';
    $('dotOut').innerHTML = `<p class="${cls}"><b>Week ${week} van ${year}</b> · ${y} jaar${mo ? ` en ${mo} maand${mo === 1 ? '' : 'en'}` : ''} oud. ${advice}</p>`;
  }
  if ($('dotIn')) { $('dotIn').addEventListener('input', dot); dot(); }

  /* ---------- band omrekenen ---------- */
  function tyre(v) {
    const m = /(\d{3})\s*[/ ]\s*(\d{2})\s*[A-Z]{0,2}\s*[- ]?\s*(\d{2}(?:[.,]5)?)/i.exec(String(v || ''));
    if (!m) return null;
    const w = Number(m[1]); const a = Number(m[2]); const r = Number(m[3].replace(',', '.'));
    const side = w * a / 100; const dia = r * 25.4 + 2 * side;
    return { w, a, r, side, dia, circ: dia * Math.PI, rev: 1e6 / (dia * Math.PI), label: `${w}/${a}R${String(r).replace('.', ',')}` };
  }
  function verdict(pct) {
    const a = Math.abs(pct);
    if (a <= 1.5) return ['calc-ok', 'Binnen ±1,5%: normaal prima te gebruiken (controleer kentekenbewijs/CoC, ruimte in de wielkast en last-/snelheidsindex).'];
    if (pct > 0 && pct <= 3) return ['calc-warn', 'Groter dan 1,5% maar binnen 3%: kan, maar de teller wijkt merkbaar af. Goed nakijken.'];
    return ['calc-bad', 'Te groot verschil: niet aan te raden (teller, ABS/ESP en de keuring).'];
  }
  function tyres() {
    const A = tyre($('tyreA').value); const B = tyre($('tyreB').value); const shown = parse($('tyreSpeed').value) ?? 100;
    if (!A) { $('tyreOut').innerHTML = '<p class="muted small">Typ een maat, bijvoorbeeld 205/55R16.</p>'; $('tyreAlt').innerHTML = ''; return; }
    const row = (k, a, b, d = 0, unit = ' mm') => `<tr><th>${k}</th><td>${fmt(a, d)}${unit}</td>${B ? `<td>${fmt(b, d)}${unit}</td><td>${b - a >= 0 ? '+' : ''}${fmt(b - a, d)}${unit}</td>` : ''}</tr>`;
    let html = `<div class="table-wrap"><table class="list calc-table"><thead><tr><th></th><th>${esc(A.label)}</th>${B ? `<th>${esc(B.label)}</th><th>Verschil</th>` : ''}</tr></thead><tbody>
      ${row('Breedte', A.w, B && B.w)}${row('Wanghoogte', A.side, B && B.side, 1)}${row('Velgdiameter', A.r * 25.4, B && B.r * 25.4, 1)}
      ${row('Totale diameter', A.dia, B && B.dia, 1)}${row('Omtrek', A.circ, B && B.circ, 0)}${row('Omwentelingen per km', A.rev, B && B.rev, 0, '')}
      </tbody></table></div>`;
    if (B) {
      const pct = (B.dia / A.dia - 1) * 100;
      const [cls, txt] = verdict(pct);
      html += `<p class="${cls}"><b>Diameter ${pct >= 0 ? '+' : ''}${fmt(pct, 2)}%.</b> ${txt}</p>
        <p>Teller ${fmt(shown, 0)} km/h = werkelijk <b>${fmt(shown * B.dia / A.dia, 1)} km/h</b>.
        Bodemvrijheid ${B.dia >= A.dia ? '+' : ''}${fmt((B.dia - A.dia) / 2, 1)} mm.</p>`;
    }
    $('tyreOut').innerHTML = html;
    // Alternatieven: zelfde diameter (±1,5%), velg 2 kleiner t/m 3 groter, breedte in de buurt.
    const groups = new Map();
    for (let r = A.r - 2; r <= A.r + 3; r++) {
      if (r < 12 || r > 24) continue;
      const list = [];
      for (let w = Math.max(135, A.w - 40); w <= A.w + 50; w += 10) for (let a = 25; a <= 85; a += 5) {
        const t = tyre(`${w}/${a}R${r}`); const pct = (t.dia / A.dia - 1) * 100;
        if (Math.abs(pct) <= 1.5 && !(w === A.w && a === A.a && r === A.r)) list.push({ t, pct });
      }
      list.sort((x, y) => Math.abs(x.pct) - Math.abs(y.pct));
      if (list.length) groups.set(r, list.slice(0, 6));
    }
    $('tyreAlt').innerHTML = groups.size ? [...groups].map(([r, list]) => `<p><b>${r} inch:</b> ${list.map(({ t, pct }) =>
      `<button type="button" class="linkbtn calc-pick" data-size="${t.label}">${t.label}</button> <span class="muted small">(${pct >= 0 ? '+' : ''}${fmt(pct, 1)}%)</span>`).join(', ')}</p>`).join('')
      : '<p class="muted small">Geen alternatieven gevonden.</p>';
  }
  if ($('tyreA')) {
    for (const id of ['tyreA', 'tyreB', 'tyreSpeed']) $(id).addEventListener('input', tyres);
    $('tyreAlt').addEventListener('click', (e) => { const b = e.target.closest('[data-size]'); if (b) { $('tyreB').value = b.dataset.size; tyres(); $('tyreB').scrollIntoView({ block: 'center', behavior: 'smooth' }); } });
    tyres();
  }
})();
