// Flying cranes: a handful of ink-and-paper silhouettes drifting in lazy circles over the valley.
import * as THREE from "three";
import { mulberry32 } from "./noise";
import { PAL, hex } from "./toon";

export interface CranesOut { mesh: THREE.InstancedMesh; update(t: number): void }

function craneGeometry(): THREE.BufferGeometry {
  const white = hex(PAL.paper, PAL.mistLight, 0.35), black = hex(PAL.ink, PAL.inkSoft, 0.4), red = hex(PAL.vermilion);
  const pos: number[] = [], col: number[] = [], wing: number[] = [];
  const tri = (a: number[], b: number[], c: number[], k: THREE.Color, w = [0, 0, 0]) => {
    for (const [v, ww] of [[a, w[0]], [b, w[1]], [c, w[2]]] as [number[], number][]) { pos.push(...v); col.push(k.r, k.g, k.b); wing.push(ww); }
  };
  // body (diamond), neck, head, beak, legs
  const nose = [0, 0.02, 1.1], tail = [0, 0, -0.9], top = [0, 0.14, 0.1], bot = [0, -0.1, 0.1], L = [-0.12, 0, 0.1], Rr = [0.12, 0, 0.1];
  tri(nose, top, L, white); tri(nose, Rr, top, white); tri(top, tail, L, white); tri(top, Rr, tail, white);
  tri(nose, L, bot, white); tri(nose, bot, Rr, white); tri(bot, L, tail, white); tri(bot, tail, Rr, white);
  const neck0 = [0, 0.05, 1.05], neck1 = [0, 0.1, 1.9];
  tri([-0.045, 0.02, 1.0], [0.045, 0.02, 1.0], neck1, white); tri([-0.04, 0.12, 1.0], neck1, [0.04, 0.12, 1.0], white);
  void neck0;
  tri([-0.06, 0.05, 1.9], [0.06, 0.05, 1.9], [0, 0.16, 2.1], white);
  tri([0, 0.15, 2.0], [0, 0.07, 2.05], [0, 0.1, 2.6], black);
  tri([-0.03, 0.17, 1.95], [0.03, 0.17, 1.95], [0, 0.2, 2.0], red);
  tri([-0.02, -0.02, -0.7], [0.02, -0.02, -0.7], [0, -0.1, -1.9], black);
  tri([-0.02, -0.04, -0.7], [0, -0.14, -1.9], [0.02, -0.04, -0.7], black);
  // wings: broad panels along x with black flight feathers; aWing = distance from body (0..1) drives the flap
  for (const s of [-1, 1]) {
    const w0 = [s * 0.1, 0.05, 0.55], w1 = [s * 0.1, 0.05, -0.5];
    const m0 = [s * 1.4, 0.18, 0.5], m1 = [s * 1.5, 0.15, -0.5];
    const t0 = [s * 3.1, 0.12, 0.25], t1 = [s * 3.2, 0.1, -0.7], tp = [s * 3.4, 0.1, -0.15];
    const mk = (a: number[], b: number[], c: number[], k: THREE.Color, wa: number, wb: number, wc: number) => (s > 0 ? tri(a, b, c, k, [wa, wb, wc]) : tri(a, c, b, k, [wa, wc, wb]));
    mk(w0, m0, w1, white, 0, 0.45, 0); mk(w1, m0, m1, white, 0, 0.45, 0.48);
    mk(m0, t0, m1, white, 0.45, 0.95, 0.48); mk(m1, t0, t1, black, 0.48, 0.95, 1.0); mk(t0, tp, t1, black, 0.95, 1.0, 1.0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("aWing", new THREE.Float32BufferAttribute(wing, 1));
  g.computeVertexNormals();
  return g;
}

export function buildCranes(): CranesOut {
  const rnd = mulberry32(404);
  const geo = craneGeometry();
  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = uniforms.uTime;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aWing; uniform float uTime;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vec3 ip = vec3(instanceMatrix[3]);
        float fl = sin(uTime * 4.2 + ip.x * 0.37 + ip.z * 0.21);
        transformed.y += fl * aWing * aWing * 0.95 + aWing * 0.15;
        transformed.z -= abs(fl) * aWing * 0.18;`);
  };
  mat.customProgramCacheKey = () => "crane";
  const flocks = [
    { cx: -6, cz: -50, r: 34, y: 22, sp: 0.07, n: 3 },
    { cx: 50, cz: 20, r: 40, y: 30, sp: -0.06, n: 2 },
    { cx: 0, cz: 78, r: 30, y: 36, sp: 0.05, n: 2 },
    { cx: -40, cz: 10, r: 28, y: 26, sp: -0.08, n: 2 },
  ];
  const cr: { f: typeof flocks[number]; a0: number; dr: number; dy: number; s: number }[] = [];
  for (const f of flocks) for (let i = 0; i < f.n; i++) cr.push({ f, a0: rnd() * 6.28, dr: (rnd() - 0.5) * 8, dy: (rnd() - 0.5) * 5, s: 1.0 + rnd() * 0.5 });
  const mesh = new THREE.InstancedMesh(geo, mat, cr.length);
  mesh.frustumCulled = false; mesh.name = "cranes";
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const update = (t: number) => {
    uniforms.uTime.value = t;
    cr.forEach((c, i) => {
      const a = c.a0 + t * c.f.sp * (1 + (i % 3) * 0.1);
      const r = c.f.r + c.dr;
      v.set(c.f.cx + Math.sin(a) * r, c.f.y + c.dy + Math.sin(t * 0.3 + i) * 1.4, c.f.cz + Math.cos(a) * r);
      const dirSign = Math.sign(c.f.sp);
      const heading = a + (dirSign > 0 ? Math.PI / 2 : -Math.PI / 2) + Math.PI / 2 * 0;
      // heading: tangent of circle; model faces +z
      const tx = Math.cos(a) * dirSign, tz = -Math.sin(a) * dirSign;
      e.set(0.05 * Math.sin(t * 0.8 + i), Math.atan2(tx, tz), -0.18 * dirSign + 0.08 * Math.sin(t * 0.9 + i * 2), "YXZ");
      void heading;
      q.setFromEuler(e); sc.setScalar(c.s * 1.6);
      m.compose(v, q, sc); mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { mesh, update };
}
