// Painted hero art for the launcher: an ink-wash valley (SVG, generated from a fixed seed), news banners, and a small
// canvas of drifting mist and falling petals. No external assets.
(() => {
  "use strict";
  const W = 1100, H = 680;
  function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const f1 = (n) => Math.round(n * 10) / 10;

  // mountain ridge as a closed path; focus = x of the tallest peaks
  function ridge(seed, w, h, base, amp, focus, spread, step = 12) {
    const r = rng(seed), p1 = r() * 6, p2 = r() * 6, p3 = r() * 6, pts = [];
    for (let x = -step; x <= w + step; x += step) {
      const fall = Math.exp(-Math.pow((x - focus) / spread, 2));
      const peak = Math.pow(Math.abs(Math.sin(x * 0.011 + p1)), 0.75) * 0.55 + Math.abs(Math.sin(x * 0.027 + p2)) * 0.3 + r() * 0.08 + Math.sin(x * 0.006 + p3) * 0.1;
      pts.push([x, base - amp * (0.25 + 0.75 * fall) * peak]);
    }
    let d = `M${pts[0][0]} ${f1(pts[0][1])}`;
    for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; d += ` Q${pts[i][0]} ${f1(pts[i][1])} ${f1(mx)} ${f1(my)}`; }
    return `${d} L${w + step} ${h} L${-step} ${h}Z`;
  }
  function ridgeY(seed, w, base, amp, focus, spread, x, step = 12) { // y of the same ridge at x (for placing props)
    const r = rng(seed), p1 = r() * 6, p2 = r() * 6, p3 = r() * 6; let y = base;
    for (let xx = -step; xx <= w + step; xx += step) {
      const fall = Math.exp(-Math.pow((xx - focus) / spread, 2));
      const peak = Math.pow(Math.abs(Math.sin(xx * 0.011 + p1)), 0.75) * 0.55 + Math.abs(Math.sin(xx * 0.027 + p2)) * 0.3 + r() * 0.08 + Math.sin(xx * 0.006 + p3) * 0.1;
      if (Math.abs(xx - x) < step / 2 + 0.1) y = base - amp * (0.25 + 0.75 * fall) * peak;
    }
    return y;
  }
  function pagoda(cx, y, s, fill) {
    let d = "";
    const tiers = 5;
    for (let i = 0; i < tiers; i++) {
      const w = (22 - i * 3.2) * s, ty = y - i * 11 * s;
      d += `M${f1(cx - w)} ${f1(ty)} Q${f1(cx - w * 0.55)} ${f1(ty)} ${f1(cx - w * 0.3)} ${f1(ty - 7 * s)} L${f1(cx + w * 0.3)} ${f1(ty - 7 * s)} Q${f1(cx + w * 0.55)} ${f1(ty)} ${f1(cx + w)} ${f1(ty)} Q${f1(cx + w * 0.5)} ${f1(ty + 3.4 * s)} ${f1(cx)} ${f1(ty + 3.4 * s)} Q${f1(cx - w * 0.5)} ${f1(ty + 3.4 * s)} ${f1(cx - w)} ${f1(ty)}Z`;
      d += `M${f1(cx - w * 0.28)} ${f1(ty)} h${f1(w * 0.56)} v${f1(4 * s)} h${f1(-w * 0.56)}Z`;
    }
    d += `M${f1(cx - 1 * s)} ${f1(y - tiers * 11 * s + 2 * s)} h${f1(2 * s)} v${f1(-12 * s)} h${f1(-2 * s)}Z`;
    return `<path d="${d}" fill="${fill}"/>`;
  }
  function pine(x, y, s, fill, seed) {
    const r = rng(seed); let d = `<path d="M${f1(x - 1.3 * s)} ${y} L${f1(x - 0.6 * s)} ${f1(y - 26 * s)} L${f1(x + 0.6 * s)} ${f1(y - 26 * s)} L${f1(x + 1.3 * s)} ${y}Z" fill="${fill}"/>`;
    for (let i = 0; i < 4; i++) { const w = (17 - i * 3.2) * s, cy = y - (10 + i * 7.5) * s; d += `<ellipse cx="${f1(x + (r() - .5) * 4 * s)}" cy="${f1(cy)}" rx="${f1(w)}" ry="${f1(4.2 * s)}" fill="${fill}"/>`; }
    return d;
  }
  function birds(list, col) { return list.map(([x, y, s]) => `<path d="M${x} ${y} q${3 * s} ${-4 * s} ${6 * s} 0 q${3 * s} ${-4 * s} ${6 * s} 0" fill="none" stroke="${col}" stroke-width="1.3" stroke-linecap="round"/>`).join(""); }
  function bamboo(x, baseY, h, seed, fill) {
    const r = rng(seed); let d = "";
    const lean = (r() - 0.5) * 18;
    d += `<path d="M${x} ${baseY} Q${x + lean * 0.4} ${baseY - h * 0.5} ${x + lean} ${baseY - h}" stroke="${fill}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
    for (let i = 1; i < 7; i++) { const t = i / 7, px = x + lean * t * t * 1.1, py = baseY - h * t; d += `<path d="M${f1(px - 3.4)} ${f1(py)} h6.8" stroke="${fill}" stroke-width="1.6"/>`; if (i > 2) { const dir = i % 2 ? 1 : -1; d += `<path d="M${f1(px)} ${f1(py)} q${dir * 22} ${-6} ${dir * 42} ${10} q${-dir * 22} ${-1} ${-dir * 42} ${-10}Z" fill="${fill}"/>`; } }
    return d;
  }

  let uid = 0;
  function sceneSvg() {
    const id = "s" + ++uid;
    const R = [
      { seed: 11, base: 392, amp: 150, focus: 430, spread: 300, col: "#a9b8c2", op: .55 },
      { seed: 23, base: 438, amp: 175, focus: 640, spread: 300, col: "#7e92a1", op: .78 },
      { seed: 37, base: 492, amp: 150, focus: 520, spread: 330, col: "#556b7b", op: .92 },
      { seed: 53, base: 560, amp: 120, focus: 820, spread: 340, col: "#34444f", op: 1 },
    ];
    const rp = (i) => ridge(R[i].seed, W, H, R[i].base, R[i].amp, R[i].focus, R[i].spread);
    const py = (i, x) => ridgeY(R[i].seed, W, R[i].base, R[i].amp, R[i].focus, R[i].spread, Math.round(x / 12) * 12);
    let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
<defs>
<linearGradient id="${id}sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f2733"/><stop offset=".38" stop-color="#4b5d6c"/><stop offset=".66" stop-color="#a7b6bd"/><stop offset=".86" stop-color="#e6d6b8"/><stop offset="1" stop-color="#e8c9a8"/></linearGradient>
<radialGradient id="${id}sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#d7463a"/><stop offset=".72" stop-color="#c8372d"/><stop offset="1" stop-color="#c8372d" stop-opacity="0"/></radialGradient>
<radialGradient id="${id}glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#f0b79a" stop-opacity=".7"/><stop offset="1" stop-color="#f0b79a" stop-opacity="0"/></radialGradient>
<linearGradient id="${id}ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3641"/><stop offset="1" stop-color="#12161c"/></linearGradient>
<filter id="${id}rough" x="-2%" y="-2%" width="104%" height="104%"><feTurbulence type="fractalNoise" baseFrequency=".022" numOctaves="2" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="9"/></filter>
<filter id="${id}blur"><feGaussianBlur stdDeviation="13"/></filter>
<filter id="${id}soft"><feGaussianBlur stdDeviation="1.1"/></filter>
<filter id="${id}grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" seed="9"/><feColorMatrix values="0 0 0 0 .1  0 0 0 0 .09  0 0 0 0 .08  0 0 0 .5 -.12"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#${id}sky)"/>
<circle cx="560" cy="338" r="190" fill="url(#${id}glow)"/>
<circle cx="560" cy="338" r="62" fill="url(#${id}sun)" filter="url(#${id}soft)"/>
${birds([[470, 214, 1.2], [494, 196, 1], [520, 224, 0.9], [770, 168, 1.1], [796, 154, 0.8]], "#2a3340")}
<g filter="url(#${id}rough)">
<path d="${rp(0)}" fill="${R[0].col}" opacity="${R[0].op}"/>
</g>
<ellipse cx="300" cy="420" rx="420" ry="26" fill="#e9eef0" opacity=".5" filter="url(#${id}blur)"/>
<ellipse cx="880" cy="440" rx="380" ry="24" fill="#e9eef0" opacity=".45" filter="url(#${id}blur)"/>
<g filter="url(#${id}rough)">
<path d="${rp(1)}" fill="${R[1].col}" opacity="${R[1].op}"/>
${pagoda(702, py(1, 702) + 3, 1.0, "#3f5260")}
${pine(640, py(1, 640) + 2, 0.7, "#3f5260", 3)}${pine(668, py(1, 668) + 3, 0.55, "#3f5260", 5)}
</g>
<ellipse cx="560" cy="470" rx="520" ry="30" fill="#dfe7ea" opacity=".6" filter="url(#${id}blur)"/>
<g filter="url(#${id}rough)">
<path d="${rp(2)}" fill="${R[2].col}" opacity="${R[2].op}"/>
${pine(452, py(2, 452) + 2, 1.15, "#2c3b46", 7)}${pine(486, py(2, 486) + 3, 0.9, "#2c3b46", 8)}${pine(842, py(2, 842) + 3, 1.05, "#2c3b46", 9)}${pine(876, py(2, 876) + 2, 0.8, "#2c3b46", 10)}
</g>
<ellipse cx="760" cy="540" rx="520" ry="30" fill="#cfd9dc" opacity=".5" filter="url(#${id}blur)"/>
<ellipse cx="260" cy="560" rx="360" ry="26" fill="#cfd9dc" opacity=".4" filter="url(#${id}blur)"/>
<g filter="url(#${id}rough)">
<path d="${rp(3)}" fill="${R[3].col}"/>
${pine(618, py(3, 618) + 3, 1.5, "#1b242c", 12)}${pine(662, py(3, 662) + 3, 1.2, "#1b242c", 13)}
</g>
<rect x="0" y="590" width="${W}" height="${H - 590}" fill="url(#${id}ground)"/>
<g opacity=".9">${bamboo(996, 640, 300, 5, "#141a20")}${bamboo(1030, 650, 340, 6, "#141a20")}${bamboo(1066, 650, 260, 7, "#141a20")}${bamboo(70, 650, 250, 8, "#141a20")}${bamboo(36, 650, 300, 9, "#141a20")}</g>
<g transform="translate(386 520)"><rect width="30" height="30" rx="3" fill="#c8372d" opacity=".92"/><path d="M23 6 l3 3 -13 13 -3 -3z" fill="#f2ead8"/><path d="M7 20 l4 4 -2 2 -4 -4z" fill="#f2ead8"/></g>
<rect width="${W}" height="${H}" filter="url(#${id}grain)" opacity=".55" style="mix-blend-mode:multiply"/>
</svg>`;
    return s;
  }

  // Painted banners for news cards. key: valley | blades | scroll | lantern
  function bannerSvg(key) {
    const id = "b" + ++uid, k = ["valley", "blades", "scroll", "lantern"].includes(key) ? key : "valley";
    const head = (a, b) => `<svg viewBox="0 0 336 120" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient><filter id="${id}r"><feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="2" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="5"/></filter><filter id="${id}b"><feGaussianBlur stdDeviation="6"/></filter></defs><rect width="336" height="120" fill="url(#${id}g)"/>`;
    let s;
    if (k === "valley") {
      s = head("#34424f", "#e6d3b4") + `<circle cx="228" cy="62" r="24" fill="#c8372d"/><g filter="url(#${id}r)"><path d="${ridge(71, 336, 120, 74, 46, 190, 120, 8)}" fill="#8aa0ae" opacity=".75"/></g><ellipse cx="170" cy="82" rx="190" ry="9" fill="#eef2f3" opacity=".6" filter="url(#${id}b)"/><g filter="url(#${id}r)"><path d="${ridge(72, 336, 120, 100, 46, 90, 130, 8)}" fill="#4d6372"/>${pagoda(250, 62, 0.5, "#33434f")}</g><g filter="url(#${id}r)"><path d="${ridge(73, 336, 120, 124, 34, 260, 120, 8)}" fill="#26323c"/></g></svg>`;
    } else if (k === "blades") {
      s = head("#222a33", "#5b6a76") + `<ellipse cx="168" cy="64" rx="140" ry="34" fill="#c9d3d6" opacity=".25" filter="url(#${id}b)"/><g filter="url(#${id}r)"><path d="M30 104 C90 78 170 30 316 8 C250 40 170 76 110 112Z" fill="#c8372d"/></g><g transform="rotate(-38 168 62)"><path d="M70 62 L250 56 L262 62 L250 68Z" fill="#e9e1cd"/><rect x="48" y="58" width="24" height="8" rx="2" fill="#c9a227"/><rect x="38" y="57" width="10" height="10" rx="3" fill="#1a1a1f"/></g><g transform="rotate(38 168 62)"><path d="M70 62 L250 56 L262 62 L250 68Z" fill="#cfd6d8"/><rect x="48" y="58" width="24" height="8" rx="2" fill="#c9a227"/><rect x="38" y="57" width="10" height="10" rx="3" fill="#1a1a1f"/></g><circle cx="64" cy="26" r="3" fill="#c8372d"/><circle cx="288" cy="94" r="4" fill="#c8372d"/><circle cx="302" cy="84" r="2" fill="#c8372d"/></svg>`;
    } else if (k === "scroll") {
      s = head("#2b3540", "#7c8f9b") + `<ellipse cx="168" cy="100" rx="200" ry="14" fill="#dfe7ea" opacity=".35" filter="url(#${id}b)"/><rect x="62" y="20" width="212" height="80" fill="#efe5cf"/><rect x="62" y="20" width="212" height="80" fill="none" stroke="#b9a782" stroke-width="1.2"/><rect x="52" y="14" width="14" height="92" rx="7" fill="#6e2a22"/><rect x="270" y="14" width="14" height="92" rx="7" fill="#6e2a22"/><g stroke="#2b2b33" stroke-linecap="round" fill="none" opacity=".8" filter="url(#${id}r)"><path d="M80 34 q40 -8 90 0 t90 0" stroke-width="3"/><path d="M80 90 q50 8 100 0 t80 -2" stroke-width="2.6"/><path d="M84 52 q20 4 40 0 M214 52 q20 4 40 0 M84 70 q20 -4 40 0 M214 70 q20 -4 40 0" stroke-width="2.2"/></g><rect x="150" y="44" width="38" height="38" rx="3" fill="#c8372d"/><path d="M180 50 l4 4 -18 18 -4 -4z" fill="#f2ead8"/><path d="M158 70 l6 6 -3 3 -6 -6z" fill="#f2ead8"/></svg>`;
    } else {
      s = head("#171d27", "#3a4756") + [[60, 34, 1], [124, 62, 1.3], [190, 28, 0.9], [250, 56, 1.2], [300, 30, 0.8]].map(([x, y, z]) => `<g><circle cx="${x}" cy="${y}" r="${26 * z}" fill="#f0a35a" opacity=".22" filter="url(#${id}b)"/><path d="M${x} ${y - 20 * z} v-8 M${x - 10 * z} ${y - 12 * z} h${20 * z} v${24 * z} h${-20 * z}z" stroke="#1a1a1f" stroke-width="1" fill="#e76a3c"/><path d="M${x} ${y + 12 * z} v${12 * z}" stroke="#c9a227" stroke-width="1.4"/></g>`).join("") + `<g filter="url(#${id}r)"><path d="${ridge(81, 336, 120, 118, 30, 160, 140, 8)}" fill="#0f141a"/></g></svg>`;
    }
    return s;
  }

  // ----- animated overlay: drifting mist puffs and falling petals -----
  function startFx(canvas) {
    const ctx = canvas.getContext("2d"); if (!ctx) return () => {};
    const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = 1; canvas.width = W * dpr; canvas.height = H * dpr;
    const r = rng(77);
    const puffs = Array.from({ length: 9 }, () => ({ x: r() * W, y: 340 + r() * 250, rx: 200 + r() * 220, ry: 26 + r() * 30, v: 4 + r() * 9, a: 0.08 + r() * 0.09 }));
    const petals = Array.from({ length: 26 }, () => ({ x: r() * W, y: r() * H, s: 3 + r() * 3.2, vx: 8 + r() * 14, vy: 14 + r() * 20, rot: r() * 6, vr: (r() - .5) * 2, ph: r() * 6, col: r() < .6 ? "#e8a39a" : r() < .5 ? "#f4e4d4" : "#c8372d" }));
    let last = performance.now(), raf = 0, acc = 0;
    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000); last = now; acc += dt; if (acc < 1 / 30) return; const d = acc; acc = 0;
      ctx.clearRect(0, 0, W, H);
      for (const p of puffs) {
        p.x += p.v * d; if (p.x - p.rx > W) p.x = -p.rx;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.rx);
        g.addColorStop(0, `rgba(236,241,243,${p.a})`); g.addColorStop(1, "rgba(236,241,243,0)");
        ctx.save(); ctx.translate(0, p.y); ctx.scale(1, p.ry / p.rx); ctx.translate(0, -p.y); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.rx, 0, 6.2832); ctx.fill(); ctx.restore();
      }
      for (const p of petals) {
        p.ph += d; p.x += (p.vx + Math.sin(p.ph * 1.3) * 10) * d; p.y += p.vy * d; p.rot += p.vr * d;
        if (p.y > H + 10 || p.x > W + 10) { p.x = -10 - r() * 200; p.y = r() * H * 0.7; }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = 0.75; ctx.fillStyle = p.col; ctx.beginPath(); ctx.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, 6.2832); ctx.fill(); ctx.restore();
      }
    }
    if (reduce) { frame(performance.now() + 100); cancelAnimationFrame(raf); return () => {}; }
    raf = requestAnimationFrame(frame);
    const vis = () => { if (document.hidden) cancelAnimationFrame(raf); else { last = performance.now(); raf = requestAnimationFrame(frame); } };
    document.addEventListener("visibilitychange", vis);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", vis); };
  }

  window.Hero = {
    mount(sceneEl, canvasEl) { sceneEl.innerHTML = sceneSvg(); startFx(canvasEl); },
    banner: bannerSvg,
  };
})();
