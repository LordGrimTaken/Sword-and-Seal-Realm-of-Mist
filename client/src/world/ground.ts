// Ground dressing: plaza decal, flagstone path (instanced), grass tufts (instanced).
import * as THREE from "three";
import { fbm, mulberry32, smoothstep, vnoise } from "./noise";
import { BRIDGE, PLAZA, POND, WATER_Y, bridgeY, pathMask, pathX, pondD, terrainHeight } from "./terrain";
import { PAL, hex, toonGradient } from "./toon";
import { applyWind } from "./wind";
import { scatterSpatial } from "./vegetation";

/**
 * Ink-paved plaza: annular flagstone courses with wet ink-wash joints, a lotus medallion (16 + 8 brush petals around a taiji hub,
 * mostly hidden by the incense drum), vermilion hairline + seal dots, and a calm cool-grey stone tone so characters pop.
 */
function plazaTexture(): THREE.CanvasTexture {
  const N = 2048, cv = document.createElement("canvas"); cv.width = cv.height = N;
  const g = cv.getContext("2d")!;
  const R = N / 2, U = R / (PLAZA.r + 0.8); // px per world unit
  g.translate(R, R);
  const rnd = mulberry32(5);
  const INK = "26,26,31";
  const clip = () => { g.beginPath(); g.arc(0, 0, R - 2, 0, 7); g.clip(); };
  g.save(); clip();
  // ---- stone base ----
  g.fillStyle = "#b3b5a8"; g.fillRect(-R, -R, N, N);
  // ---- annular flagstone courses (staggered), ink-wash joints ----
  const courseW = 1.15 * U, medal = 7.1 * U;
  const jointsA: [number, number, number, number][] = []; // r0, r1, a0, a1 per slab for joints
  let ring = 0;
  for (let r0 = medal; r0 < R; r0 += courseW, ring++) {
    const r1 = Math.min(R, r0 + courseW), rm = (r0 + r1) / 2;
    const slabLen = 2.3 * U, n = Math.max(6, Math.round((Math.PI * 2 * rm) / slabLen));
    const off = (ring % 2) * (Math.PI / n);
    for (let k = 0; k < n; k++) {
      const a0 = off + (k / n) * Math.PI * 2, a1 = off + ((k + 1) / n) * Math.PI * 2;
      // calm tone variation: cool grey with a faint jade / paper wash per slab
      const t = 0.965 + rnd() * 0.07, w = rnd();
      const cr = (178 + (w > 0.7 ? 8 : 0) - (w < 0.2 ? 6 : 0)) * t, cg = (181 + (w < 0.2 ? 3 : 0)) * t, cb = (168 + (w < 0.2 ? 5 : 0) - (w > 0.7 ? 6 : 0)) * t;
      g.fillStyle = `rgb(${cr | 0},${cg | 0},${cb | 0})`;
      g.beginPath(); g.arc(0, 0, r1, a0, a1); g.arc(0, 0, r0, a1, a0, true); g.closePath(); g.fill();
      jointsA.push([r0, r1, a0, a1]);
    }
  }
  // soft ink-wash blooms over the paving (large, very low alpha): painted rather than tiled
  for (let i = 0; i < 90; i++) {
    const a = rnd() * 6.283, r = Math.sqrt(rnd()) * R, x = Math.cos(a) * r, y = Math.sin(a) * r, rad = (60 + rnd() * 220);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad); const dark = rnd() < 0.55;
    gr.addColorStop(0, dark ? "rgba(58,68,70,0.10)" : "rgba(235,228,205,0.10)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // joints: wet ink lines with a soft bleed halo + wobble
  g.lineCap = "round";
  const wob = () => (rnd() - 0.5) * 1.6;
  for (const pass of [0, 1]) {
    g.strokeStyle = pass === 0 ? `rgba(${INK},0.16)` : `rgba(${INK},0.5)`; g.lineWidth = pass === 0 ? 7 : 2.2;
    for (const [r0, , a0, a1] of jointsA) {
      g.beginPath(); const steps = Math.max(2, Math.round((a1 - a0) * r0 / 22));
      for (let s = 0; s <= steps; s++) { const a = a0 + (a1 - a0) * (s / steps); const px = Math.cos(a) * r0 + wob(), py = Math.sin(a) * r0 + wob(); if (s) g.lineTo(px, py); else g.moveTo(px, py); }
      g.stroke();
      g.beginPath(); g.moveTo(Math.cos(a0) * r0 + wob(), Math.sin(a0) * r0 + wob()); g.lineTo(Math.cos(a0) * (r0 + courseW) + wob(), Math.sin(a0) * (r0 + courseW) + wob()); g.stroke();
    }
  }
  // a few hairline cracks and moss specks
  g.lineWidth = 1.2;
  for (let i = 0; i < 70; i++) {
    const a = rnd() * 6.283, r = medal + rnd() * (R - medal), x = Math.cos(a) * r, y = Math.sin(a) * r;
    g.strokeStyle = `rgba(${INK},0.28)`; g.beginPath(); g.moveTo(x, y); let cx = x, cy = y;
    for (let k = 0; k < 4; k++) { cx += (rnd() - 0.5) * 26; cy += (rnd() - 0.5) * 26; g.lineTo(cx, cy); } g.stroke();
    if (rnd() < 0.5) { g.fillStyle = "rgba(79,165,139,0.16)"; g.beginPath(); g.ellipse(x, y, 8 + rnd() * 18, 4 + rnd() * 8, rnd() * 3, 0, 7); g.fill(); }
  }
  // ---- outer border: double ink ring with a running cloud-fret band ----
  const rb = R - 0.55 * U;
  g.strokeStyle = `rgba(${INK},0.8)`; g.lineWidth = 9; g.beginPath(); g.arc(0, 0, rb, 0, 7); g.stroke();
  g.lineWidth = 3; g.beginPath(); g.arc(0, 0, rb - 1.0 * U, 0, 7); g.stroke();
  g.lineWidth = 3.5; g.strokeStyle = `rgba(${INK},0.62)`;
  const fr0 = rb - 0.5 * U, nF = 64; // small leaf-scroll (cloud scroll) running between the two rings
  for (let k = 0; k < nF; k++) {
    const a = (k / nF) * Math.PI * 2; g.save(); g.rotate(a); g.translate(0, -fr0);
    g.beginPath(); g.moveTo(-9, 5); g.bezierCurveTo(-9, -6, 4, -8, 6, -1); g.bezierCurveTo(8, 4, 1, 5, 1, 0); g.stroke(); g.restore();
  }
  g.restore();

  // ---- lotus medallion ----
  g.save(); clip();
  // clean cool-paper disc, dissolving into the paving through an ink-wash edge
  const disc = g.createRadialGradient(0, 0, medal * 0.96, 0, 0, medal * 1.02);
  g.fillStyle = "#c9cabb"; g.beginPath(); g.arc(0, 0, medal, 0, 7); g.fill();
  for (let i = 0; i < 40; i++) { const a = rnd() * 6.283, rr = rnd() * medal * 0.95; g.fillStyle = `rgba(${rnd() < 0.5 ? "120,140,140" : "238,232,212"},0.07)`; g.beginPath(); g.arc(Math.cos(a) * rr, Math.sin(a) * rr, 30 + rnd() * 90, 0, 7); g.fill(); }
  void disc;
  g.strokeStyle = `rgba(${INK},0.85)`; g.lineWidth = 8; g.beginPath(); g.arc(0, 0, medal, 0, 7); g.stroke();
  g.lineWidth = 2.5; g.beginPath(); g.arc(0, 0, medal - 0.35 * U, 0, 7); g.stroke();
  // petals: pointed, brush-outlined, jade wash at the heart
  const petal = (r0: number, r1: number, w: number, fill: string, fill2: string, rot: number, lw: number) => {
    g.save(); g.rotate(rot); g.translate(0, -r0);
    const L = r1 - r0;
    g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(w, -L * 0.18, w * 0.9, -L * 0.7, 0, -L); g.bezierCurveTo(-w * 0.9, -L * 0.7, -w, -L * 0.18, 0, 0); g.closePath();
    const gr = g.createLinearGradient(0, 0, 0, -L); gr.addColorStop(0, fill2); gr.addColorStop(0.55, fill); gr.addColorStop(1, fill);
    g.fillStyle = gr; g.fill();
    g.strokeStyle = `rgba(${INK},0.82)`; g.lineWidth = lw; g.lineJoin = "round"; g.stroke();
    // centre vein + two side veins (dry brush)
    g.lineWidth = lw * 0.45; g.strokeStyle = `rgba(${INK},0.35)`;
    g.beginPath(); g.moveTo(0, -L * 0.12); g.quadraticCurveTo(w * 0.05, -L * 0.5, 0, -L * 0.86); g.stroke();
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * w * 0.12, -L * 0.14); g.quadraticCurveTo(s * w * 0.55, -L * 0.45, s * w * 0.22, -L * 0.8); g.stroke(); }
    g.restore();
  };
  for (let k = 0; k < 16; k++) petal(2.9 * U, 6.75 * U, 0.52 * U, "#ece6d2", "#a9c9bb", (k / 16) * Math.PI * 2 + Math.PI / 16, 4.5);
  for (let k = 0; k < 8; k++) petal(2.2 * U, 5.0 * U, 0.62 * U, "#a8cdbd", "#5f9a86", (k / 8) * Math.PI * 2, 4.5);
  // vermilion hairline + seal dots, gold stamens ring
  g.strokeStyle = "rgba(200,55,45,0.85)"; g.lineWidth = 3.2; g.beginPath(); g.arc(0, 0, 2.1 * U, 0, 7); g.stroke();
  for (let k = 0; k < 16; k++) { const a = ((k + 0.5) / 16) * Math.PI * 2; g.fillStyle = "#c8372d"; g.strokeStyle = `rgba(${INK},0.85)`; g.lineWidth = 2.5; g.beginPath(); g.arc(Math.sin(a) * (medal - 0.17 * U), -Math.cos(a) * (medal - 0.17 * U), 8, 0, 7); g.fill(); g.stroke(); }
  // taiji hub (under the incense drum, but visible in the cracks of the render)
  const hub = 1.9 * U;
  g.fillStyle = "#e9e3cf"; g.beginPath(); g.arc(0, 0, hub, 0, 7); g.fill();
  g.fillStyle = `rgb(${INK})`; g.beginPath(); g.arc(0, 0, hub, -Math.PI / 2, Math.PI / 2); g.arc(0, hub / 2, hub / 2, Math.PI / 2, -Math.PI / 2, true); g.arc(0, -hub / 2, hub / 2, Math.PI / 2, -Math.PI / 2, false); g.fill();
  g.fillStyle = "#e9e3cf"; g.beginPath(); g.arc(0, -hub / 2, hub * 0.14, 0, 7); g.fill();
  g.fillStyle = `rgb(${INK})`; g.beginPath(); g.arc(0, hub / 2, hub * 0.14, 0, 7); g.fill();
  g.strokeStyle = `rgba(${INK},0.9)`; g.lineWidth = 5; g.beginPath(); g.arc(0, 0, hub, 0, 7); g.stroke();
  g.restore();

  // edge fade into the terrain
  g.globalCompositeOperation = "destination-in";
  const gr = g.createRadialGradient(0, 0, R * 0.93, 0, 0, R); gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(-R, -R, N, N);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}


/** Bridge deck paving: ink-jointed flagstones, a pale central runner with lotus rosettes and vermilion studs, repeated along the arch. */
function bridgeDeckTexture(): THREE.CanvasTexture {
  const W = 512, H = 1024, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d")!;
  const rnd = mulberry32(91);
  g.fillStyle = "#b4b6a8"; g.fillRect(0, 0, W, H);
  const INK = "26,26,31";
  // flagstone rows: two flank lanes + centre runner
  const lanes = [[0, 0.24], [0.24, 0.76], [0.76, 1]], rows = 4;
  for (let li = 0; li < 3; li++) {
    const [a, b] = lanes[li];
    const nr = li === 1 ? rows * 2 : rows * 2;
    for (let r = 0; r < nr; r++) {
      const y0 = (r + (li === 1 ? 0 : (li === 0 ? 0.35 : 0.65)) % 1) / nr * H;
      const t = 0.955 + rnd() * 0.09;
      g.fillStyle = li === 1 ? `rgb(${(206 * t) | 0},${(207 * t) | 0},${(192 * t) | 0})` : `rgb(${(176 * t) | 0},${(180 * t) | 0},${(168 * t) | 0})`;
      g.fillRect(a * W + 3, y0 + 3, (b - a) * W - 6, H / nr - 6);
    }
  }
  for (let i = 0; i < 40; i++) { const x = rnd() * W, y = rnd() * H, r = 30 + rnd() * 90; const gr = g.createRadialGradient(x, y, 0, x, y, r); const dk = rnd() < 0.5; gr.addColorStop(0, dk ? "rgba(60,72,74,0.1)" : "rgba(238,232,210,0.12)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  // joints
  g.lineCap = "round";
  for (const pass of [0, 1]) {
    g.strokeStyle = pass ? `rgba(${INK},0.55)` : `rgba(${INK},0.15)`; g.lineWidth = pass ? 2.6 : 8;
    for (let li = 0; li < 3; li++) {
      const [a, b] = lanes[li]; const nr = rows * 2;
      for (let r = 0; r < nr; r++) { const y0 = (r + (li === 1 ? 0 : (li === 0 ? 0.35 : 0.65)) % 1) / nr * H; g.beginPath(); g.moveTo(a * W + 2, y0 + (rnd() - 0.5)); g.lineTo(b * W - 2, y0 + (rnd() - 0.5)); g.stroke(); }
    }
    for (const x of [0.24, 0.76]) { g.beginPath(); g.moveTo(x * W, 0); for (let y = 0; y <= H; y += 64) g.lineTo(x * W + (rnd() - 0.5) * 1.6, y); g.stroke(); }
  }
  // runner ornaments: lotus rosette + vermilion studs at the joints
  const rosette = (cx: number, cy: number, r: number) => {
    g.save(); g.translate(cx, cy);
    for (let k = 0; k < 8; k++) { g.save(); g.rotate((k / 8) * Math.PI * 2); g.beginPath(); g.moveTo(0, -r * 0.2); g.bezierCurveTo(r * 0.3, -r * 0.5, r * 0.22, -r * 0.85, 0, -r); g.bezierCurveTo(-r * 0.22, -r * 0.85, -r * 0.3, -r * 0.5, 0, -r * 0.2); g.fillStyle = k % 2 ? "#e9e3cf" : "#a8cdbd"; g.fill(); g.strokeStyle = `rgba(${INK},0.8)`; g.lineWidth = 2.6; g.stroke(); g.restore(); }
    g.fillStyle = "#c8372d"; g.beginPath(); g.arc(0, 0, r * 0.18, 0, 7); g.fill(); g.strokeStyle = `rgba(${INK},0.85)`; g.lineWidth = 2; g.stroke();
    g.restore();
  };
  rosette(W / 2, H / 2, 108);
  for (const y of [0, H]) rosette(W / 2, y, 108);
  for (const [x, y] of [[0.5, 0.25], [0.5, 0.75]] as number[][]) { g.fillStyle = "#c8372d"; g.beginPath(); g.arc(x * W, y * H, 9, 0, 7); g.fill(); g.strokeStyle = `rgba(${INK},0.85)`; g.lineWidth = 2.5; g.stroke(); }
  g.strokeStyle = `rgba(${INK},0.7)`; g.lineWidth = 3.5; for (const x of [0.24, 0.76]) { g.beginPath(); g.moveTo(x * W, 0); g.lineTo(x * W, H); g.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

function bridgeDeck(): THREE.Mesh {
  const SEG = 76, half = BRIDGE.half, hw = BRIDGE.width - 0.5;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= SEG; i++) {
    const z = BRIDGE.zc - half + (2 * half * i) / SEG, y = bridgeY(z) + 0.035;
    pos.push(-hw, y, z, hw, y, z); uv.push(0, (i / SEG) * 2 * half / (hw * 2) / 2, 1, (i / SEG) * 2 * half / (hw * 2) / 2);
    if (i < SEG) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshToonMaterial({ map: bridgeDeckTexture(), gradientMap: toonGradient(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.name = "bridgeDeck";
  return m;
}

export function buildGround(): THREE.Group {
  const group = new THREE.Group(); group.name = "ground";
  const rnd = mulberry32(808);

  // ---- plaza decal ----
  const dec = new THREE.Mesh(new THREE.CircleGeometry(PLAZA.r + 0.8, 64), new THREE.MeshToonMaterial({ map: plazaTexture(), gradientMap: toonGradient(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  dec.rotation.x = -Math.PI / 2;
  dec.rotation.z = Math.PI; // so image up = +z
  dec.position.set(PLAZA.x, terrainHeight(PLAZA.x, PLAZA.z) + 0.03, PLAZA.z);
  dec.renderOrder = 1;
  group.add(dec);
  group.add(bridgeDeck());

  // ---- flagstones along path ----
  const slabG = new THREE.BoxGeometry(1.0, 0.16, 0.8);
  const slabs: { x: number; z: number; ry: number; s: number; c: THREE.Color }[] = [];
  const stoneBase = hex(PAL.paperDark, PAL.mist, 0.3).multiplyScalar(0.62);
  for (let z = -61; z < 78; z += 1.05) {
    const cx = pathX(z);
    const wHalf = z < -22 ? 2.6 : 1.9;
    for (let lane = -wHalf; lane <= wHalf + 0.01; lane += 1.15) {
      const x = cx + lane + (rnd() - 0.5) * 0.25, zz = z + (rnd() - 0.5) * 0.3 + (Math.floor(lane / 1.15) % 2) * 0.5;
      if (pondD(x, zz) < 1.12 && Math.abs(x) < BRIDGE.width + 1.0) continue;
      if (Math.hypot(x - PLAZA.x, zz - PLAZA.z) < PLAZA.r + 0.3) continue;
      if (Math.hypot(x, zz - 84) < 12) continue;
      if (rnd() < 0.1) continue;
      const slope = Math.atan2(pathX(zz + 1) - pathX(zz - 1), 2);
      slabs.push({ x, z: zz, ry: slope + (rnd() - 0.5) * 0.15, s: 0.8 + rnd() * 0.3, c: stoneBase.clone().multiplyScalar(0.8 + rnd() * 0.35) });
    }
  }
  const sm = new THREE.InstancedMesh(slabG, new THREE.MeshToonMaterial({ gradientMap: toonGradient() }), slabs.length);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3(), N = new THREE.Vector3();
  slabs.forEach((s, i) => {
    const h = terrainHeight(s.x, s.z);
    const gx = (terrainHeight(s.x + 0.6, s.z) - terrainHeight(s.x - 0.6, s.z)) / 1.2, gz = (terrainHeight(s.x, s.z + 0.6) - terrainHeight(s.x, s.z - 0.6)) / 1.2;
    N.set(-gx, 1, -gz).normalize();
    Q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), N);
    const q2 = new THREE.Quaternion().setFromEuler(E.set(0, s.ry, 0));
    Q.multiply(q2);
    V.set(s.x, h + 0.02, s.z); S.set(s.s, 1, s.s);
    M.compose(V, Q, S); sm.setMatrixAt(i, M); sm.setColorAt(i, s.c);
  });
  sm.instanceMatrix.needsUpdate = true; if (sm.instanceColor) sm.instanceColor.needsUpdate = true;
  group.add(sm);

  // ---- grass tufts ----
  const blade = (x: number, a: number, h: number, w: number, lean: number, c0: THREE.Color, c1: THREE.Color) => {
    const g = new THREE.BufferGeometry();
    const ca = Math.cos(a), sa = Math.sin(a);
    const P = [x - w, 0, 0, x + w, 0, 0, x + lean, h, 0.0];
    const pos: number[] = [];
    for (let i = 0; i < 3; i++) { const px = P[i * 3], py = P[i * 3 + 1]; pos.push(px * ca, py, -px * sa + (i === 2 ? lean * 0.5 : 0)); }
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute([c0.r, c0.g, c0.b, c0.r, c0.g, c0.b, c1.r, c1.g, c1.b], 3));
    g.setIndex([0, 1, 2]);
    g.computeVertexNormals();
    return g;
  };
  const dark = hex(PAL.jade, PAL.ink, 0.5), light = hex(PAL.jade, PAL.paper, 0.5);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) parts.push(blade(0.0, (i / 5) * Math.PI * 2 + rnd() * 0.4, 0.34 + rnd() * 0.38, 0.062, 0.12 + rnd() * 0.26, dark, light));
  const merged = mergeParts(parts);
  const tp: { x: number; z: number; s: number; ry: number; c: THREE.Color }[] = [];
  for (let i = 0; i < 24000 && tp.length < 5400; i++) {
    const x = (rnd() - 0.5) * 200, z = (rnd() - 0.5) * 200;
    if (pathMask(x, z) > 0.0 || Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + 0.5 || pondD(x, z) < 1.15) continue;
    if (Math.hypot(x, z - 84) < 10) continue;
    const dens = fbm(x * 0.06 + 20, z * 0.06, 3);
    if (rnd() > dens * 1.25) continue;
    tp.push({ x, z, s: 0.7 + rnd() * 1.1, ry: rnd() * 6.28, c: new THREE.Color().setHSL(0.36 + rnd() * 0.05, 0.1 + rnd() * 0.12, 0.7 + rnd() * 0.5) });
  }
  const tuftMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient(), side: THREE.DoubleSide });
  applyWind(tuftMat, { height: 0.7, amp: 0.34, idle: 0.3 });
  // 5400 tufts cover the whole valley: one InstancedMesh has a single valley-wide bounding sphere (and the old mesh opted
  // out of culling entirely), so split the same transforms into a few spatial chunks that each frustum-cull on their own.
  scatterSpatial(group, merged, tuftMat, tp.map((t) => ({ x: t.x, z: t.z, s: t.s, ry: t.ry, col: t.c })), (t, i, mesh) => {
    V.set(t.x, terrainHeight(t.x, t.z) - 0.02, t.z); Q.setFromEuler(E.set(0, t.ry, 0)); S.set(t.s, t.s, t.s);
    M.compose(V, Q, S); mesh.setMatrixAt(i, M);
    if (t.col) mesh.setColorAt(i, t.col);
  }, 6, "grass");
  // ---- stepping stones: shore trail, a crossing into the pond, and side trails off the path ----
  {
    const trail: { x: number; z: number; s: number; ry: number; top?: number }[] = [];
    // crossing into the lotus pond from the east shore
    for (let i = 0; i < 9; i++) { const t = i / 8; trail.push({ x: 13.5 - t * 8 + Math.sin(i * 1.7) * 0.5, z: -33 - t * 3.5 + Math.cos(i * 2.1) * 0.4, s: 0.55 + rnd() * 0.25, ry: rnd() * 3, top: WATER_Y + 0.14 }); }
    // trail along the west shore
    for (let i = 0; i < 12; i++) { const a = 2.6 + i * 0.16; const r = POND.r * (1.12 + 0.04 * Math.sin(i)); trail.push({ x: POND.x + Math.cos(a) * r, z: POND.z + Math.sin(a) * r * 0.95, s: 0.5 + rnd() * 0.25, ry: rnd() * 3 }); }
    // side trails leaving the path
    for (const [sx, sz, dx, dz] of [[-3.5, -52, -6.5, 1.1], [3.5, -50, 6.0, 1.3], [pathX(8) + 2.6, 8, 4.6, 0.7], [pathX(30) - 2.6, 30, -4.2, 0.9]] as number[][]) {
      for (let i = 0; i < 6; i++) trail.push({ x: sx + dx * (i / 5) * 0.9 + (rnd() - 0.5) * 0.3, z: sz + dz * i * 0.9 + (rnd() - 0.5) * 0.3, s: 0.45 + rnd() * 0.3, ry: rnd() * 3 });
    }
    const stoneG = new THREE.CylinderGeometry(0.62, 0.7, 1, 9);
    const sp = stoneG.getAttribute("position");
    for (let i = 0; i < sp.count; i++) { const j = 0.82 + vnoise(sp.getX(i) * 3 + 2, sp.getZ(i) * 3) * 0.4; sp.setX(i, sp.getX(i) * j); sp.setZ(i, sp.getZ(i) * j * 0.85); }
    stoneG.computeVertexNormals();
    const mat = new THREE.MeshToonMaterial({ gradientMap: toonGradient() });
    const keep = trail.filter((t) => pathMask(t.x, t.z) < 0.05 || t.top === undefined);
    const im = new THREE.InstancedMesh(stoneG, mat, keep.length);
    keep.forEach((t, i) => {
      const h = t.top !== undefined ? t.top : terrainHeight(t.x, t.z) + 0.1;
      const depth = t.top !== undefined ? Math.max(0.3, h - terrainHeight(t.x, t.z)) : 0.34;
      V.set(t.x, h - depth / 2, t.z); Q.setFromEuler(E.set(0, t.ry, 0)); S.set(t.s * 1.25, depth, t.s * 1.1);
      M.compose(V, Q, S); im.setMatrixAt(i, M);
      im.setColorAt(i, stoneBase.clone().multiplyScalar(0.95 + rnd() * 0.5));
    });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.name = "steppingStones";
    group.add(im);
  }
  void smoothstep; void vnoise;
  return group;
}

import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
}
