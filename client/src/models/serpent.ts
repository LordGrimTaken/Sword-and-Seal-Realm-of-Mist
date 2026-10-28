// Jade Serpent: a 16-segment bone chain with ink-brush diamond scales, glowing eyes, S-curve slither,
// reared idle with a coiled tail, a cocked-then-lunging strike, and a limp collapse + ink dissolve on death.
// Baked into ONE skinned mesh (+ ONE ink hull) like every other avatar.
import * as THREE from "three";
import { PAL, hex } from "../world/toon";
import { Anim, Avatar, AvState, Dissolve, bake, clamp01, ease, glowPart, node, part, shadowBlob, vcPart } from "./common";

const hx = (a: number, b: number, t: number) => hex(a, b, t).getHex();
const SEGS = 16;
const SEG_L = 0.2;
const HEAD_Z = 1.25; // head sits ahead of the entity origin so the body trails behind it

const JADE_D = hex(PAL.jade, PAL.ink, 0.55), JADE = hex(PAL.jade, PAL.inkSoft, 0.14), JADE_L = hex(PAL.jade, PAL.paper, 0.3);
const BELLY = hex(PAL.paper, PAL.jade, 0.3), INK = new THREE.Color(PAL.ink), VERM = new THREE.Color(PAL.vermilion);
const sstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

const BODY_LEN = (SEGS - 1) * SEG_L + 0.25; // head-back to tail tip
/** radius at distance s behind the head: slim neck, fat belly, long taper to a point */
function radiusAtS(s: number): number {
  const base = 0.105 + 0.13 * sstep(0.0, 1.1, s);
  const t = clamp01((s - 1.1) / (BODY_LEN - 1.1));
  return Math.max(0.014, base * 1.3 * (1 - Math.pow(t, 1.25)));
}

/** one continuous tube (smooth-skinned between the chain's bones) with vertex-coloured ink-brush scale pattern */
function bodyTube(): THREE.Mesh {
  const RINGS = 96, RAD = 18;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i <= RINGS; i++) {
    const s = (i / RINGS) * BODY_LEN - 0.02;
    const z = HEAD_Z - s, r = radiusAtS(Math.max(0, s));
    for (let k = 0; k < RAD; k++) {
      const phi = (k / RAD) * Math.PI * 2 - Math.PI;       // -PI..PI, 0 = dorsal (up)
      const x = Math.sin(phi), y = Math.cos(phi);
      const flat = y < 0 ? 0.78 : 1.0;                     // flat belly
      pos.push(x * r * 1.04, y * r * 0.94 * flat, z);
      const ap = Math.abs(phi);
      const dors = sstep(1.7, 0.35, ap), belly = sstep(1.95, 2.6, ap);
      c.copy(JADE).lerp(JADE_L, sstep(0.9, 1.9, ap) * 0.7 * (1 - belly));
      c.lerp(JADE_D, dors * 0.8);
      c.lerp(BELLY, belly);
      // ink diamonds down the spine, each haloed with a pale-jade rim (reads as a wet brush dab)
      const P = 0.42, u = (((s / P) % 1) + 1) % 1 * 2 - 1;
      const dia = 1 - (ap / 0.72 + Math.abs(u) * 0.95);
      if (ap < 1.0 && dia > -0.16) {
        if (dia > 0) c.lerp(INK, Math.min(1, dia * 3.0) * 0.94);
        else c.lerp(JADE_L, 0.55 * (1 + dia / 0.16));
      }
      // vermilion fleck on the flank between diamonds
      const f = 1 - (Math.abs(ap - 1.25) / 0.22 + Math.abs(Math.abs(u) - 1) / 0.28);
      if (f > 0) c.lerp(VERM, Math.min(1, f * 2.5) * 0.9);
      // scale-row tone alternation
      const alt = ((i + (k % 2)) % 2 ? 1 : -1) * 0.045; c.multiplyScalar(1 + alt);
      // dry-brush rings on the tail and an ink-dipped tip
      if (s > 2.1 && ap < 2.3 && Math.abs((((s - 2.1) / 0.3) % 1) - 0.5) < 0.14) c.lerp(INK, 0.8);
      c.lerp(INK, sstep(BODY_LEN - 0.6, BODY_LEN, s) * 0.85);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < RINGS; i++) for (let k = 0; k < RAD; k++) {
    const a = i * RAD + k, b = i * RAD + ((k + 1) % RAD), a2 = a + RAD, b2 = b + RAD;
    idx.push(a, b, a2, b, b2, a2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = vcPart(g, 0.02);
  // smooth skinning: blend the two bones either side of each vertex
  m.userData.skinFn = (geo: THREE.BufferGeometry, boneIndex: (b: THREE.Object3D) => number) => {
    const p = geo.getAttribute("position"), n = p.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const f = Math.min(SEGS - 1, Math.max(0, (HEAD_Z - p.getZ(i)) / SEG_L));     // continuous bone coordinate (0 = head bone)
      const j = Math.min(SEGS - 1, Math.floor(f)), j2 = Math.min(SEGS - 1, j + 1), w = f >= SEGS - 1 ? 0 : f - j;
      si[i * 4] = boneIndex(m.userData.bones[j]); si[i * 4 + 1] = boneIndex(m.userData.bones[j2]);
      sw[i * 4] = 1 - w; sw[i * 4 + 1] = w;
    }
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
  };
  return m;
}

const mkq = () => new THREE.Quaternion();

function jadeSerpent(): Avatar {
  const root = new THREE.Group();
  const body = node(); root.add(body);
  const sh = shadowBlob(1.0); sh.scale.set(1.15, 1, 1.9); sh.position.z = -0.35; root.add(sh);

  // ---- bone chain: bones[0] is the head, bones[SEGS-1] the tail tip ----
  const bones: THREE.Bone[] = [];
  const rad: number[] = [];
  let parent: THREE.Object3D = body;
  for (let j = 0; j < SEGS; j++) {
    const b = node(); b.rotation.order = "YXZ";
    b.position.set(0, 0, j === 0 ? HEAD_Z : -SEG_L);
    parent.add(b); bones.push(b); parent = b;
    const r = radiusAtS(j * SEG_L); rad.push(r);
    // dorsal ridge spines: tiny pale-jade fins that read as a brush stroke along the back
    if (j > 1 && j < SEGS - 2 && j % 2 === 0) {
      const f = part(new THREE.ConeGeometry(r * 0.28, r * 0.8, 4), hx(PAL.jade, PAL.ink, 0.5), 0.006); f.scale.z = 0.45; f.position.set(0, r * 0.98, -SEG_L * 0.5); f.rotation.x = -0.35; b.add(f);
    }
  }
  const tube = bodyTube(); tube.userData.bones = bones; body.add(tube);
  // ---- head ----
  const head = bones[0];
  const hm = node(); hm.scale.set(1.5, 1.35, 1.5); head.add(hm);
  const hr = 0.17;
  const skull = part(new THREE.SphereGeometry(1, 14, 10), hx(PAL.jade, PAL.inkSoft, 0.2), 0.02); skull.scale.set(hr * 1.12, hr * 0.78, hr * 1.45); skull.position.set(0, 0, 0.0); hm.add(skull);
  const snout = part(new THREE.SphereGeometry(1, 10, 7), hx(PAL.jade, PAL.paper, 0.18), 0.016); snout.scale.set(hr * 0.78, hr * 0.5, hr * 1.0); snout.position.set(0, -0.025, hr * 1.05); hm.add(snout);
  const jaw = part(new THREE.SphereGeometry(1, 8, 6), BELLY.getHex(), 0.012); jaw.scale.set(hr * 0.72, hr * 0.3, hr * 1.2); jaw.position.set(0, -hr * 0.55, hr * 0.5); hm.add(jaw);
  for (const s of [-1, 1]) {
    // glowing eyes in a dark brush-stroke socket, slanted
    const sock = part(new THREE.SphereGeometry(0.05, 8, 6), PAL.ink, 0); sock.scale.set(0.8, 0.5, 1.5); sock.rotation.set(0, s * 0.3, -s * 0.35); sock.position.set(s * hr * 0.78, hr * 0.33, hr * 0.4); hm.add(sock);
    const eye = glowPart(new THREE.SphereGeometry(0.036, 8, 6), 0xe4ff8a); eye.scale.set(0.9, 0.75, 1.5); eye.rotation.set(0, s * 0.3, -s * 0.35); eye.position.set(s * hr * 0.88, hr * 0.36, hr * 0.44); hm.add(eye);
    const brow = part(new THREE.BoxGeometry(0.11, 0.024, 0.085), PAL.ink, 0); brow.rotation.set(0, s * 0.15, -s * 0.5); brow.position.set(s * hr * 0.85, hr * 0.5, hr * 0.38); hm.add(brow);
    // nostril dots + fang
    const nos = part(new THREE.SphereGeometry(0.014, 5, 4), PAL.ink, 0); nos.position.set(s * 0.03, 0.0, hr * 1.9); hm.add(nos);
    const fang = part(new THREE.ConeGeometry(0.014, 0.075, 4), PAL.paper, 0); fang.rotation.x = Math.PI; fang.position.set(s * 0.045, -hr * 0.5, hr * 1.25); hm.add(fang);
    // little gold antlers + whiskers (dragon-kin)
    const horn = part(new THREE.ConeGeometry(0.03, 0.24, 5), PAL.gold, 0.008); horn.rotation.set(-0.9, 0, -s * 0.5); horn.position.set(s * 0.075, hr * 0.62, -hr * 0.2); hm.add(horn);
    const tip = part(new THREE.ConeGeometry(0.018, 0.12, 4), PAL.gold, 0.005); tip.rotation.set(-0.3, 0, -s * 1.0); tip.position.set(s * 0.12, hr * 1.2, -hr * 0.55); hm.add(tip);
  }
  const crest = part(new THREE.ConeGeometry(0.05, 0.2, 4), PAL.vermilion, 0.008); crest.scale.z = 0.35; crest.rotation.x = -0.4; crest.position.set(0, hr * 0.78, -hr * 0.15); hm.add(crest);
  // whisker chains
  const whiskers: THREE.Bone[][] = [];
  for (const s of [-1, 1]) {
    const w0 = node(); w0.position.set(s * 0.06, -0.015, hr * 1.6); hm.add(w0);
    const wb: THREE.Bone[] = []; let p: THREE.Object3D = w0;
    for (let i = 0; i < 3; i++) {
      const b = node(); b.position.z = i ? -0.08 : 0; p.add(b); wb.push(b);
      const w = part(new THREE.CylinderGeometry(0.009 - i * 0.002, 0.007 - i * 0.002, 0.09, 4), hx(PAL.jade, PAL.paper, 0.6), 0); w.rotation.x = Math.PI / 2; w.position.z = -0.045; b.add(w);
      p = b;
    }
    w0.rotation.y = s * 2.4; whiskers.push(wb);
  }
  // forked tongue
  const tongue = node(); tongue.position.set(0, -hr * 0.4, hr * 1.6); hm.add(tongue);
  const tl = part(new THREE.BoxGeometry(0.016, 0.01, 0.2), PAL.vermilion, 0); tl.position.z = 0.1; tongue.add(tl);
  for (const s of [-1, 1]) { const f = part(new THREE.BoxGeometry(0.012, 0.01, 0.08), PAL.vermilion, 0); f.rotation.y = s * 0.4; f.position.set(s * 0.02, 0, 0.23); tongue.add(f); }

  const hnd = bake(root, 0.3);
  const an = new Anim(); const dis = new Dissolve(root);
  const shadow = root.children.find((c) => c.name === "shadow");

  // ---- pose solver ----
  const yaw = new Float32Array(SEGS), pitch = new Float32Array(SEGS), theta = new Float32Array(SEGS);
  const REAR = [0.45, -0.6, -1.25, -1.45, -1.2, -0.7, -0.2], LOW = [0.35, 0.05, -0.1, -0.05];
  const WIND = [0.5, -0.6, -1.15, -1.4, -1.25, -0.8, -0.3], STRIKE = [0.55, 0.3, 0.05, -0.2, -0.3, -0.15];
  const q = mkq(), qb = mkq(), qy = mkq(), qx = mkq(), v = new THREE.Vector3(), pos = new THREE.Vector3();
  const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0);
  let slither = 0, spin = 0;

  /** apply yaw/pitch to bones, forward-kinematics the chain to find the lowest point, and plant the body on the ground */
  function applyPose(lift = 0) {
    q.identity(); pos.set(0, 0, HEAD_Z);
    let minY = 1e9;
    for (let j = 0; j < SEGS; j++) {
      bones[j].rotation.set(pitch[j], yaw[j], 0);
      qy.setFromAxisAngle(AY, yaw[j]); qx.setFromAxisAngle(AX, pitch[j]);
      qb.copy(qy).multiply(qx);
      if (j > 0) { v.set(0, 0, -SEG_L).applyQuaternion(q); pos.add(v); }
      q.multiply(qb);
      // a point on the segment's belly (mid-segment, below the axis)
      v.set(0, 0, -SEG_L * 0.5).applyQuaternion(q);
      minY = Math.min(minY, pos.y + v.y - rad[j] * 0.9);
    }
    body.position.y = -minY + 0.015 + lift;
  }

  return {
    root, height: 1.45,
    setState(st: AvState) {
      if (st !== "dead" && an.state === "dead") { dis.end(); root.visible = true; if (shadow) shadow.visible = true; hnd.glow.value = 1; body.position.z = 0; }
      an.setState(st);
    },
    update(dt: number) {
      an.tick(dt);
      const t = an.t, m = an.move, k = an.atk;
      tongue.scale.z = 0.25 + 0.75 * Math.max(0, Math.sin(t * 9)) ** 6 * 1.0 + 0.0;
      tongue.visible = an.state !== "dead";
      whiskers.forEach((wb, si) => wb.forEach((b, i) => { b.rotation.y = Math.sin(t * 2.4 - i * 0.8 + si * 2) * 0.28; b.rotation.x = Math.sin(t * 1.9 - i * 0.6) * 0.16 + 0.15 + 0.3 * m; }));

      if (an.state === "dead") {
        const d = ease(an.dead);
        // collapse: head drops, spine goes slack with a lazy S, belly flat
        for (let j = 0; j < SEGS; j++) {
          const u = j / (SEGS - 1);
          yaw[j] = (0.45 * Math.sin(u * 5.5 + 0.7) + 0.12) * d * (j ? 1 : 0.4);
          pitch[j] = (j === 0 ? 0.3 : j === 1 ? -0.2 : 0) * d;
        }
        applyPose();
        body.position.z = -0.25 * d;
        body.rotation.z = 0.35 * d;   // roll belly-up a little
        hnd.glow.value = 1 - d;
        const f = clamp01((an.stateT - 0.8) / 0.9);
        if (f > 0) { dis.begin(); dis.set(1 - f); } else dis.end();
        if (shadow) shadow.visible = f < 0.9;
        root.visible = f < 1;
        return;
      }
      body.rotation.z = 0;
      hnd.glow.value = 0.85 + 0.15 * Math.sin(t * 3.4);
      slither += dt * (2.2 + 7.5 * m + 4 * k);
      spin = t;
      const p = (an.stateT % 0.9) / 0.9;
      const cock = ease(clamp01(p / 0.5)), lunge = ease(clamp01((p - 0.5) / 0.14)), rec = ease(clamp01((p - 0.66) / 0.34));
      const wind = cock * (1 - lunge) * (1 - rec), strike = lunge * (1 - rec);
      for (let j = 0; j < SEGS; j++) {
        const u = j / (SEGS - 1);
        // lateral S-curve travelling down the body; stronger toward the tail, damped near the head
        const amp = (0.2 + 0.4 * m) * (0.35 + 0.9 * u) * (1 - 0.8 * strike);
        let y = amp * Math.sin(slither - j * 0.7);
        // idle tail coil: the last third curls into a spiral
        y += (1 - m) * (1 - k) * 0.4 * clamp01((j - 6) / 5) * (j > 5 ? 1 : 0);
        // cobra-style neck S when cocking back
        y += wind * 0.32 * Math.sin(j * 0.9) * (j < 7 ? 1 : 0) * 0.6;
        yaw[j] = y;
        // cumulative pitch profile (angle of the chain at bone j; + = nose down / tail up), blended per pose
        const at = (P: number[]) => (j < P.length ? P[j] : 0);
        let th = at(REAR) * (1 - m) + at(LOW) * m;
        th = th + (at(WIND) - th) * wind;
        th = th + (at(STRIKE) - th) * strike;
        if (j > 7) th += 0.012 * Math.sin(spin * 1.3 + j * 0.5);
        theta[j] = th;
      }
      for (let j = 0; j < SEGS; j++) pitch[j] = theta[j] - (j ? theta[j - 1] : 0);
      applyPose(0.0);
      // strike drives the whole body forward; slither adds a tiny surge
      body.position.z = 1.15 * strike - 0.3 * wind + 0.03 * Math.sin(slither * 2) * m;
      body.rotation.y = 0.12 * Math.sin(slither * 0.5) * (1 - k) * m;
      sh.position.z = -0.35 + 0.6 * strike;
    },
  };
}

export { jadeSerpent };
