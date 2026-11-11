'use strict';
/*
 * Feestelijke achtergronden: sneeuw met Kerst, pepernoten en cadeautjes met Sinterklaas, vuurwerk met Oud en Nieuw,
 * hartjes met Valentijn, bloesem en eitjes met Pasen, oranje confetti met Koningsdag, vleermuizen met Halloween.
 * Eén <canvas> achter alles (dus achter de knoppen en kaarten), nooit klikbaar. Welk feest het is, zet de server in
 * <html data-feest="…"> (Systeem → Feestdagen). Bekijken kan altijd: ?feest=kerst achter het adres, of de knop
 * "Bekijken" bij Systeem → Feestdagen. "Minder beweging" op het apparaat: een stilstaand beeld; Effecten "Rustig": minder.
 */
(function () {
  const html = document.documentElement;
  if (html.classList.contains('in-window')) return; // bureaubladvensters: het bureaublad zelf toont het al
  const reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const TAU = Math.PI * 2;

  /** Is de achtergrond donker? (dan lichte sneeuw; op een lichte achtergrond grijsblauwe) */
  function isDark() {
    for (const el of [document.body, html]) {
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(getComputedStyle(el).backgroundColor || '');
      if (m && (m[4] === undefined || Number(m[4]) > 0.2)) return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 < 0.45;
    }
    return matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /* ================= de effecten ================= */
  // Elk effect: function (o) -> { step(dt, ctx) }. o.W()/o.H(): grootte, o.dark, o.density (0,5 bij Rustig).
  const count = (o, per, min, max) => Math.round(clamp((o.W() * o.H()) / per, min, max) * o.density);

  function snow(o) {
    const col = o.dark ? '255,255,255' : '118,140,178';
    const mk = (anyY) => {
      const z = Math.random();
      return { x: rnd(0, o.W()), y: anyY ? rnd(0, o.H()) : rnd(-30, -6), r: 1 + z * 2.6, vy: 16 + z * 44, ph: rnd(0, TAU), sw: rnd(0.4, 1.3),
        a: (o.dark ? 0.35 : 0.42) + z * 0.45, star: z > 0.55 && Math.random() < 0.22, rot: rnd(0, TAU), vr: rnd(-0.6, 0.6) };
    };
    const flakes = Array.from({ length: count(o, 9000, 40, 170) }, () => mk(true));
    return {
      step(dt, ctx) {
        for (const f of flakes) {
          f.y += f.vy * dt; f.ph += f.sw * dt; f.x += Math.sin(f.ph) * 14 * dt; f.rot += f.vr * dt;
          if (f.y > o.H() + 12) Object.assign(f, mk(false));
          if (f.x < -12) f.x = o.W() + 10; else if (f.x > o.W() + 12) f.x = -10;
          if (!ctx) continue;
          if (f.star) {
            ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot);
            ctx.strokeStyle = `rgba(${col},${f.a})`; ctx.lineWidth = 1; ctx.lineCap = 'round';
            const L = f.r * 2.6;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
              const a = (i * TAU) / 6; const cx = Math.cos(a); const cy = Math.sin(a);
              ctx.moveTo(0, 0); ctx.lineTo(cx * L, cy * L);
              ctx.moveTo(cx * L * 0.55, cy * L * 0.55); ctx.lineTo(cx * L * 0.55 + Math.cos(a + 0.7) * L * 0.3, cy * L * 0.55 + Math.sin(a + 0.7) * L * 0.3);
              ctx.moveTo(cx * L * 0.55, cy * L * 0.55); ctx.lineTo(cx * L * 0.55 + Math.cos(a - 0.7) * L * 0.3, cy * L * 0.55 + Math.sin(a - 0.7) * L * 0.3);
            }
            ctx.stroke(); ctx.restore();
          } else {
            ctx.fillStyle = `rgba(${col},${f.a})`;
            ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.fill();
          }
        }
      },
    };
  }

  function sinterklaas(o) {
    const GIFT = [['#c8102e', '#f6d77b'], ['#1f4fa8', '#ffffff'], ['#d4a017', '#9c1c1c'], ['#2e8b57', '#f6d77b'], ['#7b2d8e', '#f6d77b']];
    const mk = (anyY) => {
      const gift = Math.random() < 0.18;
      return { gift, x: rnd(0, o.W()), y: anyY ? rnd(0, o.H()) : rnd(-40, -10), s: gift ? rnd(9, 15) : rnd(3.2, 5.6), vy: gift ? rnd(28, 50) : rnd(40, 75),
        ph: rnd(0, TAU), sw: rnd(0.5, 1.4), rot: rnd(0, TAU), vr: rnd(-1.6, 1.6), c: gift ? pick(GIFT) : null, shade: rnd(-18, 18), a: rnd(0.65, 0.95) };
    };
    const items = Array.from({ length: count(o, 19000, 18, 80) }, () => mk(true));
    return {
      step(dt, ctx) {
        for (const p of items) {
          p.y += p.vy * dt; p.ph += p.sw * dt; p.x += Math.sin(p.ph) * 10 * dt; p.rot += p.vr * dt;
          if (p.y > o.H() + 20) Object.assign(p, mk(false));
          if (!ctx) continue;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = p.a;
          if (p.gift) {
            const s = p.s;
            ctx.fillStyle = p.c[0]; ctx.fillRect(-s / 2, -s / 2, s, s);
            ctx.fillStyle = p.c[1]; ctx.fillRect(-s * 0.09, -s / 2, s * 0.18, s); ctx.fillRect(-s / 2, -s * 0.09, s, s * 0.18);
            ctx.beginPath(); ctx.ellipse(-s * 0.16, -s / 2 - s * 0.08, s * 0.16, s * 0.1, -0.5, 0, TAU); ctx.ellipse(s * 0.16, -s / 2 - s * 0.08, s * 0.16, s * 0.1, 0.5, 0, TAU); ctx.fill();
          } else {
            const base = 150 + p.shade;
            ctx.fillStyle = `rgb(${base + 18},${Math.round(base * 0.62)},${Math.round(base * 0.3)})`;
            ctx.beginPath(); ctx.arc(0, 0, p.s, 0, TAU); ctx.fill();
            ctx.strokeStyle = 'rgba(90,45,15,.55)'; ctx.lineWidth = 0.8; ctx.stroke();
            ctx.fillStyle = 'rgba(255,230,190,.45)'; ctx.beginPath(); ctx.arc(-p.s * 0.3, -p.s * 0.3, p.s * 0.32, 0, TAU); ctx.fill();
          }
          ctx.restore();
        }
      },
    };
  }

  function fireworks(o) {
    const COLORS = o.dark ? ['#ffd166', '#ff5d73', '#5ee6ff', '#c77dff', '#7cff8a', '#ffffff', '#ff9f43']
      : ['#e0a100', '#e5383b', '#0096c7', '#9d4edd', '#2b9348', '#f77f00', '#d81b60'];
    const rockets = []; const sparks = [];
    let wait = 0.3;
    const max = Math.max(2, Math.round(4 * o.density));
    function launch() {
      const tx = rnd(0.1, 0.9) * o.W(); const ty = rnd(0.1, 0.5) * o.H();
      rockets.push({ x: tx + rnd(-60, 60), y: o.H() + 8, tx, ty, t: 0, dur: rnd(0.8, 1.2), c: pick(COLORS) });
    }
    function burst(x, y, c) {
      const n = Math.round(rnd(46, 72) * (0.6 + 0.4 * o.density));
      const c2 = Math.random() < 0.35 ? pick(COLORS) : c;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rnd(-0.05, 0.05); const v = rnd(70, 170);
        sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: rnd(1.2, 1.9), c: i % 3 ? c : c2 });
      }
    }
    return {
      step(dt, ctx) {
        wait -= dt;
        if (wait <= 0 && rockets.length + (sparks.length ? 1 : 0) < max) { launch(); wait = rnd(0.55, 1.4) / o.density; }
        if (ctx) ctx.globalCompositeOperation = o.dark ? 'lighter' : 'source-over';
        for (let i = rockets.length - 1; i >= 0; i--) {
          const r = rockets[i]; r.t += dt;
          const k = Math.min(1, r.t / r.dur); const e = 1 - (1 - k) * (1 - k);
          const x = r.x + (r.tx - r.x) * e; const y = r.y + (r.ty - r.y) * e;
          if (ctx) {
            ctx.fillStyle = r.c; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, TAU); ctx.fill();
            ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(x, y + 6, 1.2, 0, TAU); ctx.arc(x, y + 12, 0.9, 0, TAU); ctx.fill();
          }
          if (k >= 1) { burst(r.tx, r.ty, r.c); rockets.splice(i, 1); }
        }
        for (let i = sparks.length - 1; i >= 0; i--) {
          const s = sparks[i]; s.age += dt;
          if (s.age >= s.life) { sparks.splice(i, 1); continue; }
          const drag = Math.pow(0.35, dt); s.vx *= drag; s.vy = s.vy * drag + 60 * dt;
          s.x += s.vx * dt; s.y += s.vy * dt;
          if (!ctx) continue;
          const f = 1 - s.age / s.life;
          ctx.globalAlpha = f * (o.dark ? 0.95 : 0.8); ctx.fillStyle = s.c;
          ctx.beginPath(); ctx.arc(s.x, s.y, 1.1 + f * 1.1, 0, TAU); ctx.fill();
        }
        if (ctx) { ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
      },
    };
  }

  function hearts(o) {
    const COLORS = ['#e63950', '#ff6b8b', '#ff8fab', '#c9184a', '#ff4d6d'];
    const mk = (anyY) => ({ x: rnd(0, o.W()), y: anyY ? rnd(0, o.H()) : o.H() + rnd(10, 40), s: rnd(8, 19), vy: rnd(16, 38), ph: rnd(0, TAU), sw: rnd(0.6, 1.4),
      rot: rnd(-0.35, 0.35), c: pick(COLORS), a: rnd(0.35, 0.75) });
    const items = Array.from({ length: count(o, 26000, 12, 55) }, () => mk(true));
    return {
      step(dt, ctx) {
        for (const h of items) {
          h.y -= h.vy * dt; h.ph += h.sw * dt; h.x += Math.sin(h.ph) * 16 * dt;
          if (h.y < -30) Object.assign(h, mk(false));
          if (!ctx) continue;
          const s = h.s; const fade = clamp(h.y / (o.H() * 0.25), 0, 1);
          ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(h.rot + Math.sin(h.ph) * 0.12); ctx.globalAlpha = h.a * fade; ctx.fillStyle = h.c;
          ctx.beginPath();
          ctx.moveTo(0, s * 0.3);
          ctx.bezierCurveTo(0, 0, -s * 0.5, 0, -s * 0.5, s * 0.3);
          ctx.bezierCurveTo(-s * 0.5, s * 0.6, 0, s * 0.75, 0, s);
          ctx.bezierCurveTo(0, s * 0.75, s * 0.5, s * 0.6, s * 0.5, s * 0.3);
          ctx.bezierCurveTo(s * 0.5, 0, 0, 0, 0, s * 0.3);
          ctx.fill(); ctx.restore();
        }
      },
    };
  }

  function easter(o) {
    const PETAL = o.dark ? ['#f7c6d9', '#fde2e4', '#fff1b8', '#e2f0cb', '#ffffff'] : ['#f29bbd', '#f7b6c8', '#f2d25c', '#a8d18d', '#e8a0bf'];
    const EGG = [['#8ecae6', '#ffb703'], ['#ffafcc', '#bde0fe'], ['#caffbf', '#ffd6a5'], ['#fdffb6', '#cdb4db'], ['#ffc8dd', '#a2d2ff']];
    const mk = (anyY) => {
      const egg = Math.random() < 0.09;
      return { egg, x: rnd(0, o.W()), y: anyY ? rnd(0, o.H()) : rnd(-30, -8), s: egg ? rnd(6, 9) : rnd(3, 6.5), vy: egg ? rnd(30, 48) : rnd(22, 46),
        ph: rnd(0, TAU), sw: rnd(0.5, 1.5), rot: rnd(0, TAU), vr: rnd(-1.4, 1.4), flip: rnd(0, TAU), c: egg ? pick(EGG) : pick(PETAL), a: rnd(0.55, 0.9) };
    };
    const items = Array.from({ length: count(o, 15000, 20, 90) }, () => mk(true));
    return {
      step(dt, ctx) {
        for (const p of items) {
          p.y += p.vy * dt; p.ph += p.sw * dt; p.x += Math.sin(p.ph) * 18 * dt; p.rot += p.vr * dt * (p.egg ? 0.3 : 1); p.flip += dt * 2.2;
          if (p.y > o.H() + 20) Object.assign(p, mk(false));
          if (!ctx) continue;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = p.a;
          if (p.egg) {
            const rx = p.s; const ry = p.s * 1.32;
            ctx.fillStyle = p.c[0]; ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, TAU); ctx.fill();
            ctx.save(); ctx.clip();
            ctx.strokeStyle = p.c[1]; ctx.lineWidth = rx * 0.32; ctx.beginPath();
            for (let i = 0; i <= 6; i++) ctx.lineTo(-rx + (i * 2 * rx) / 6, i % 2 ? -ry * 0.05 : ry * 0.18);
            ctx.stroke(); ctx.restore();
          } else {
            ctx.scale(1, 0.45 + 0.55 * Math.abs(Math.cos(p.flip)));
            ctx.fillStyle = p.c; ctx.beginPath();
            ctx.moveTo(0, -p.s); ctx.quadraticCurveTo(p.s * 0.9, -p.s * 0.2, 0, p.s); ctx.quadraticCurveTo(-p.s * 0.9, -p.s * 0.2, 0, -p.s);
            ctx.fill();
          }
          ctx.restore();
        }
      },
    };
  }

  function koningsdag(o) {
    const ORANGE = ['#ff7a00', '#ff9500', '#ffa630', '#f26b00'];
    const NL = ['#ae1c28', o.dark ? '#ffffff' : '#d9dde5', '#21468b'];
    const mk = (anyY) => ({ x: rnd(0, o.W()), y: anyY ? rnd(0, o.H()) : rnd(-30, -8), w: rnd(5, 8), h: rnd(9, 13), vy: rnd(45, 95), ph: rnd(0, TAU),
      sw: rnd(0.6, 1.6), rot: rnd(0, TAU), vr: rnd(-2.5, 2.5), flip: rnd(0, TAU), vf: rnd(3, 7), c: Math.random() < 0.72 ? pick(ORANGE) : pick(NL), a: rnd(0.6, 0.95) });
    const items = Array.from({ length: count(o, 11000, 30, 130) }, () => mk(true));
    return {
      step(dt, ctx) {
        for (const p of items) {
          p.y += p.vy * dt; p.ph += p.sw * dt; p.x += Math.sin(p.ph) * 22 * dt; p.rot += p.vr * dt; p.flip += p.vf * dt;
          if (p.y > o.H() + 20) Object.assign(p, mk(false));
          if (!ctx) continue;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.flip)); ctx.globalAlpha = p.a;
          ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
      },
    };
  }

  function halloween(o) {
    const BAT = o.dark ? 'rgba(150,110,190,.75)' : 'rgba(29,20,36,.82)';
    const LEAF = ['#d9661f', '#b5401e', '#e8a33d', '#8a4513', '#c2571a'];
    const mkBat = (fresh) => {
      const dir = Math.random() < 0.5 ? 1 : -1;
      return { dir, x: fresh ? rnd(0, o.W()) : (dir > 0 ? -40 : o.W() + 40), y: rnd(0.06, 0.6) * o.H(), s: rnd(28, 46), vx: dir * rnd(55, 120),
        ph: rnd(0, TAU), flap: rnd(9, 14), bob: rnd(0, TAU) };
    };
    const mkLeaf = (anyY) => ({ x: rnd(0, o.W()), y: anyY ? rnd(0, o.H()) : rnd(-30, -8), s: rnd(6, 11), vy: rnd(25, 55), ph: rnd(0, TAU), sw: rnd(0.5, 1.3),
      rot: rnd(0, TAU), vr: rnd(-1.8, 1.8), c: pick(LEAF), a: rnd(0.55, 0.9) });
    const bats = Array.from({ length: Math.max(3, Math.round(7 * o.density)) }, () => mkBat(true));
    const leaves = Array.from({ length: count(o, 28000, 10, 45) }, () => mkLeaf(true));
    function wing(ctx, s, f) { // linkervleugel; f = -1..1 (vleugelslag)
      ctx.moveTo(0, -s * 0.02);
      ctx.quadraticCurveTo(-s * 0.28, -s * 0.38 * f - s * 0.06, -s * 0.56, -s * 0.18 * f);
      ctx.quadraticCurveTo(-s * 0.45, -s * 0.02 * f + s * 0.06, -s * 0.37, s * 0.1);
      ctx.quadraticCurveTo(-s * 0.28, s * 0.02, -s * 0.2, s * 0.13);
      ctx.quadraticCurveTo(-s * 0.12, s * 0.04, -s * 0.03, s * 0.12);
      ctx.closePath();
    }
    return {
      step(dt, ctx) {
        for (const l of leaves) {
          l.y += l.vy * dt; l.ph += l.sw * dt; l.x += Math.sin(l.ph) * 24 * dt; l.rot += l.vr * dt;
          if (l.y > o.H() + 20) Object.assign(l, mkLeaf(false));
          if (!ctx) continue;
          ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.rot); ctx.globalAlpha = l.a; ctx.fillStyle = l.c;
          ctx.beginPath(); ctx.moveTo(0, -l.s); ctx.quadraticCurveTo(l.s * 0.85, -l.s * 0.1, 0, l.s); ctx.quadraticCurveTo(-l.s * 0.85, -l.s * 0.1, 0, -l.s); ctx.fill();
          ctx.strokeStyle = 'rgba(70,30,10,.45)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(0, -l.s * 0.85); ctx.lineTo(0, l.s * 1.25); ctx.stroke();
          ctx.restore();
        }
        for (const b of bats) {
          b.x += b.vx * dt; b.ph += b.flap * dt; b.bob += dt * 1.6;
          if ((b.dir > 0 && b.x > o.W() + 50) || (b.dir < 0 && b.x < -50)) Object.assign(b, mkBat(false));
          if (!ctx) continue;
          const f = Math.sin(b.ph); const s = b.s;
          ctx.save(); ctx.translate(b.x, b.y + Math.sin(b.bob) * 10); ctx.globalAlpha = 1; ctx.fillStyle = BAT;
          ctx.beginPath(); wing(ctx, s, f); ctx.fill();
          ctx.save(); ctx.scale(-1, 1); ctx.beginPath(); wing(ctx, s, f); ctx.fill(); ctx.restore();
          ctx.beginPath(); ctx.ellipse(0, s * 0.04, s * 0.07, s * 0.13, 0, 0, TAU); ctx.fill();
          ctx.beginPath(); ctx.moveTo(-s * 0.05, -s * 0.06); ctx.lineTo(-s * 0.035, -s * 0.15); ctx.lineTo(-s * 0.01, -s * 0.07);
          ctx.moveTo(s * 0.05, -s * 0.06); ctx.lineTo(s * 0.035, -s * 0.15); ctx.lineTo(s * 0.01, -s * 0.07); ctx.fill();
          ctx.restore();
        }
      },
    };
  }

  const EFFECTS = { kerst: snow, sinterklaas, oudnieuw: fireworks, valentijn: hearts, pasen: easter, koningsdag, halloween };
  const NAMES = { kerst: 'Kerst', sinterklaas: 'Sinterklaas', oudnieuw: 'Oud en Nieuw', valentijn: 'Valentijnsdag', pasen: 'Pasen', koningsdag: 'Koningsdag', halloween: 'Halloween' };

  /* ================= tekenen ================= */
  let current = null;
  // De laag ligt achter <body>. Heeft <body> zelf een achtergrond, dan zou die de laag bedekken: die achtergrond gaat
  // dan zolang naar <html> (er verandert niets aan hoe het eruitziet) en <body> wordt doorzichtig.
  let moved = null;
  function uncover() {
    if (moved) return;
    const bs = getComputedStyle(document.body);
    const opaque = bs.backgroundImage !== 'none' || !/rgba\(.*,\s*0\)$|transparent/.test(bs.backgroundColor);
    moved = { props: [] };
    const set = (k, v) => { html.style.setProperty(k, v); moved.props.push(k); };
    if (opaque) {
      const hs = getComputedStyle(html);
      if (hs.backgroundImage === 'none' || bs.backgroundImage !== 'none') {
        set('background-color', bs.backgroundColor === 'rgba(0, 0, 0, 0)' ? hs.backgroundColor : bs.backgroundColor);
        if (bs.backgroundImage !== 'none') {
          for (const k of ['background-image', 'background-size', 'background-position', 'background-repeat', 'background-attachment']) set(k, bs.getPropertyValue(k));
        }
      }
    }
    html.classList.add('festive-on');
  }
  function cover() {
    if (!moved) return;
    for (const k of moved.props) html.style.removeProperty(k);
    html.classList.remove('festive-on');
    moved = null;
  }
  function stop() { if (current) { current.stop(); current = null; } cover(); }
  function start(key) {
    stop();
    const make = EFFECTS[key];
    if (!make || !document.body) return;
    uncover();
    const canvas = document.createElement('canvas');
    canvas.className = 'festive-layer';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.append(canvas);
    const ctx = canvas.getContext('2d');
    let W = 0; let H = 0;
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    const fx = make({ W: () => W, H: () => H, dark: isDark(), density: html.dataset.fx === 'calm' ? 0.5 : 1 });
    let raf = 0; let last = performance.now();
    const still = reduce.matches;
    const frame = (t) => {
      const dt = Math.min(0.05, Math.max(0, (t - last) / 1000)); last = t;
      ctx.clearRect(0, 0, W, H);
      fx.step(dt, ctx);
      raf = requestAnimationFrame(frame);
    };
    const drawStill = () => { for (let i = 0; i < 40; i++) fx.step(0.04, null); ctx.clearRect(0, 0, W, H); fx.step(0.001, ctx); };
    const run = () => { cancelAnimationFrame(raf); if (still) drawStill(); else { last = performance.now(); raf = requestAnimationFrame(frame); } };
    const onResize = () => { size(); if (still) drawStill(); };
    const onVis = () => { if (document.visibilityState === 'hidden') cancelAnimationFrame(raf); else run(); };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    run();
    current = { key, stop() { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); document.removeEventListener('visibilitychange', onVis); canvas.remove(); } };
  }
  // Ander thema gekozen (licht/donker): opnieuw beginnen met passende kleuren.
  new MutationObserver(() => { if (current) { const k = current.key; stop(); setTimeout(() => start(k), 50); } }).observe(html, { attributes: true, attributeFilter: ['data-theme'] });

  /* ================= wat tonen we? ================= */
  const param = new URLSearchParams(location.search).get('feest');
  const active = () => html.dataset.feest || null;
  if (param === 'uit') { /* even niets */ } else if (param && EFFECTS[param]) start(param); else if (active()) start(active());

  // Voorbeeld (Systeem → Feestdagen, knop "Bekijken"): 20 seconden, met een balkje om te stoppen.
  let bar = null; let barTimer = null;
  function preview(key, ms = 20000) {
    if (!EFFECTS[key]) return;
    start(key);
    if (bar) bar.remove();
    bar = document.createElement('div');
    bar.className = 'festive-preview-bar no-print';
    bar.setAttribute('role', 'status');
    const txt = document.createElement('span'); txt.innerHTML = `Voorbeeld: <b></b>`; txt.querySelector('b').textContent = NAMES[key];
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn btn-small'; btn.textContent = 'Stoppen';
    bar.append(txt, btn);
    document.body.append(bar);
    const end = () => { clearTimeout(barTimer); if (bar) { bar.remove(); bar = null; } if (active()) start(active()); else stop(); };
    btn.addEventListener('click', end);
    clearTimeout(barTimer); barTimer = setTimeout(end, ms);
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-feest-preview]');
    if (b) { e.preventDefault(); preview(b.dataset.feestPreview); }
  });
  window.adonisFeest = { start, stop, preview, keys: Object.keys(EFFECTS) };
})();
