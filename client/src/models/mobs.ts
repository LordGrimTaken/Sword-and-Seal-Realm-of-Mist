// Procedural mobs: Bamboo Spirit, Fox Spirit (flowing tails, ghost-fire), Stone Guardian (mossy colossus).
import * as THREE from "three";
import { symbolTexture } from "../world/symbols";
import { mulberry32 } from "../world/noise";
import { rockChunk } from "../world/rocks";
import { PAL, hex } from "../world/toon";
import { jadeSerpent } from "./serpent";
import { lotusToad, stoneHound } from "./content_mobs";
import { Anim, Avatar, AvState, Dissolve, bake, clamp01, ease, glowPart, node, part, shadowBlob, vcPart } from "./common";

const hx = (a: number, b: number, t: number) => hex(a, b, t).getHex();
const add = <T extends THREE.Object3D>(parent: THREE.Object3D, o: T, x = 0, y = 0, z = 0): T => { o.position.set(x, y, z); parent.add(o); return o; };

function bambooLathe(h: number, r: number): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0.001, 0), new THREE.Vector2(r * 0.9, 0)];
  const n = Math.max(2, Math.round(h / 0.32));
  for (let k = 1; k <= n; k++) {
    const y = (k / n) * h;
    pts.push(new THREE.Vector2(r, y - 0.035), new THREE.Vector2(r * 1.3, y), new THREE.Vector2(r, y + 0.03));
  }
  pts.push(new THREE.Vector2(r * 0.9, h), new THREE.Vector2(0.001, h));
  return new THREE.LatheGeometry(pts, 7);
}

/** a fan of leaves; each leaf is its own node so the whole head of leaves ripples */
function leafHair(parent: THREE.Object3D, colors: number[], n: number, len: number, droop: number, rnd: () => number): THREE.Bone[] {
  const bones: THREE.Bone[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.5;
    const b = node(); b.position.set(Math.sin(a) * 0.05, 0, Math.cos(a) * 0.05);
    b.rotation.set(Math.cos(a) * (0.9 + droop * rnd()), 0, -Math.sin(a) * (0.9 + droop * rnd()));
    const L = len * (0.7 + rnd() * 0.5);
    const leaf = part(new THREE.ConeGeometry(0.075, L, 4), colors[i % colors.length], 0.008); leaf.scale.z = 0.28; leaf.position.y = L * 0.5; b.add(leaf);
    const vein = part(new THREE.BoxGeometry(0.008, L * 0.9, 0.02), hx(PAL.jade, PAL.paper, 0.35), 0); vein.position.set(0, L * 0.5, 0.012); b.add(vein);
    parent.add(b); bones.push(b);
  }
  return bones;
}

// ======================== Bamboo Spirit ========================
function bambooSpirit(): Avatar {
  const root = new THREE.Group();
  const body = node(); body.scale.setScalar(1.12); root.add(body);
  root.add(shadowBlob(0.8));
  const stalkC = hx(PAL.jade, PAL.paperDark, 0.5), stalkD = hx(PAL.jade, PAL.inkSoft, 0.35), leafC = hx(PAL.jade, PAL.paper, 0.14), leafD = hx(PAL.jade, PAL.ink, 0.35), leafL = hx(PAL.jade, PAL.paper, 0.4);
  const bundle = node(); bundle.position.y = 0.42; body.add(bundle);
  const stalks: THREE.Bone[] = [];
  const hairs: THREE.Bone[][] = [];
  const rnd = mulberry32(11);
  const N = 7;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const rr = i === 0 ? 0.0 : 0.15;
    const h = i === 0 ? 1.35 : 0.95 + rnd() * 0.35;
    const g = node(); g.position.set(Math.sin(a) * rr, 0, Math.cos(a) * rr);
    g.add(part(bambooLathe(h, i === 0 ? 0.14 : 0.09), i % 2 ? stalkD : stalkC, 0.017));
    g.rotation.set(Math.cos(a) * 0.08, 0, -Math.sin(a) * 0.08);
    g.userData.a = a; g.userData.h = h; g.userData.seed = rnd() * 6;
    const crown = node(); crown.position.y = h; g.add(crown);
    hairs.push(leafHair(crown, [leafC, leafD, leafL], i === 0 ? 14 : 8, i === 0 ? 0.85 : 0.6, 0.45, rnd));
    g.userData.crown = crown;
    bundle.add(g); stalks.push(g);
  }
  // long hanging leaf strands from the crown: "hair"
  const strands: THREE.Bone[][] = [];
  for (const s of [-1, 1]) {
    const root0 = node(); root0.position.set(s * 0.11, 1.28, -0.02); bundle.add(root0);
    const bs: THREE.Bone[] = [];
    let p: THREE.Object3D = root0;
    for (let i = 0; i < 4; i++) {
      const b = node(); b.position.y = i ? -0.2 : 0; p.add(b); bs.push(b);
      const lf = part(new THREE.ConeGeometry(0.06 - i * 0.01, 0.24, 4), i % 2 ? leafC : leafD, 0.006); lf.scale.z = 0.3; lf.rotation.x = Math.PI; lf.position.y = -0.1; b.add(lf);
      p = b;
    }
    strands.push(bs);
  }
  const rope = part(new THREE.TorusGeometry(0.22, 0.03, 5, 12), PAL.vermilion, 0.0); rope.rotation.x = Math.PI / 2; rope.position.y = 0.45; bundle.add(rope);
  const rope2 = part(new THREE.TorusGeometry(0.2, 0.03, 5, 12), PAL.vermilion, 0.0); rope2.rotation.x = Math.PI / 2; rope2.position.y = 0.85; bundle.add(rope2);
  // face on front stalk: big glowing eyes, angry brows, fanged mouth
  const face = node(); face.position.set(0, 0.98, 0.135); bundle.add(face);
  for (const s of [-1, 1]) {
    const e = glowPart(new THREE.BoxGeometry(0.1, 0.045, 0.03), 0xc4ffd2); e.rotation.z = s * 0.4; add(face, e, s * 0.07, 0, 0);
    const pupil = part(new THREE.BoxGeometry(0.03, 0.04, 0.032), PAL.ink, 0); add(face, pupil, s * 0.07, -0.002, 0.004);
    const brow = part(new THREE.BoxGeometry(0.13, 0.03, 0.03), PAL.ink, 0); brow.rotation.z = s * 0.5; add(face, brow, s * 0.07, 0.06, -0.005);
  }
  const mouth = part(new THREE.BoxGeometry(0.1, 0.035, 0.02), PAL.ink, 0); add(face, mouth, 0, -0.1, 0);
  for (const s of [-1, 1]) { const fang = part(new THREE.ConeGeometry(0.014, 0.04, 4), PAL.paper, 0); fang.rotation.x = Math.PI; add(face, fang, s * 0.03, -0.12, 0.01); }
  // legs (root stumps)
  const mkLeg = (x: number) => {
    const g = node(); g.position.set(x, 0.45, 0);
    const l = part(bambooLathe(0.45, 0.065), stalkD, 0.012); l.rotation.x = Math.PI; g.add(l);
    const foot = part(new THREE.ConeGeometry(0.1, 0.14, 5), stalkC, 0.01); foot.rotation.x = Math.PI / 2; foot.position.set(0, -0.44, 0.08); g.add(foot);
    body.add(g); return g;
  };
  const legL = mkLeg(-0.13), legR = mkLeg(0.13);
  // arms (branches with leaf hands)
  const mkArm = (s: number) => {
    const g = node(); g.position.set(s * 0.24, 1.05, 0.02);
    const a = part(bambooLathe(0.58, 0.05), stalkC, 0.01); a.rotation.z = s * -1.1; g.add(a);
    const hand = node(); hand.position.set(s * 0.52, -0.3, 0); hand.rotation.z = -s * 1.0; g.add(hand);
    leafHair(hand, [leafC, leafL], 5, 0.4, 0.3, rnd);
    body.add(g); return g;
  };
  const armL = mkArm(-1), armR = mkArm(1);

  const hnd = bake(root, 0.3);
  const an = new Anim(); const dis = new Dissolve(root);
  const shadow = root.children.find((c) => c.name === "shadow");
  const scatter = stalks.map(() => ({ rx: (rnd() - 0.5) * 2.2, rz: (rnd() - 0.5) * 2.2, dx: (rnd() - 0.5) * 0.9, dz: (rnd() - 0.5) * 0.9 }));
  return {
    root, height: 1.95,
    setState(st: AvState) {
      if (st !== "dead" && an.state === "dead") { dis.end(); root.visible = true; if (shadow) shadow.visible = true; stalks.forEach((s) => { s.position.y = 0; }); hnd.glow.value = 1; }
      an.setState(st);
    },
    update(dt: number) {
      an.tick(dt);
      const t = an.t, m = an.move, k = an.atk;
      if (an.state === "dead") {
        const d = ease(an.dead);
        stalks.forEach((s, i) => {
          const sc = scatter[i];
          const a = s.userData.a as number;
          if (i === 0) { s.rotation.x = -1.4 * d; s.position.y = 0.05 * d; s.position.z = -0.1 * d; }
          else { s.rotation.x = sc.rx * d + Math.cos(a) * 0.08; s.rotation.z = sc.rz * d - Math.sin(a) * 0.08; s.position.x = Math.sin(a) * 0.14 + sc.dx * d; s.position.z = Math.cos(a) * 0.14 + sc.dz * d; s.position.y = -0.38 * d; }
        });
        bundle.position.y = 0.42 - 0.02 * d; legL.rotation.x = 0.4 * d; legR.rotation.x = -0.5 * d;
        armL.rotation.z = 0.5 * d; armR.rotation.z = -0.5 * d;
        hnd.glow.value = 1 - d;
        const f = clamp01((an.stateT - 0.8) / 0.9);
        if (f > 0) { dis.begin(); dis.set(1 - f); } else dis.end();
        if (shadow) shadow.visible = f < 0.9;
        root.visible = f < 1;
        return;
      }
      hnd.glow.value = 0.85 + 0.15 * Math.sin(t * 3);
      const hop = Math.abs(Math.sin(t * 7.5)) * 0.14 * m;
      body.position.y = hop;
      body.rotation.x = 0.15 * m + 0.35 * k;
      body.position.z = 0.35 * Math.sin(Math.PI * clamp01((an.stateT % 0.8) / 0.8)) * k;
      legL.rotation.x = Math.sin(t * 7.5) * 0.7 * m; legR.rotation.x = -Math.sin(t * 7.5) * 0.7 * m;
      legL.position.y = 0.45 + Math.max(0, Math.sin(t * 7.5)) * 0.08 * m; legR.position.y = 0.45 + Math.max(0, -Math.sin(t * 7.5)) * 0.08 * m;
      stalks.forEach((s, i) => {
        const a = s.userData.a as number, ph = s.userData.seed as number;
        const sw = Math.sin(t * 1.6 + ph) * 0.05 + Math.sin(t * 3.1 + ph * 2) * 0.02;
        const fan = 0.28 * k * (i === 0 ? 0 : 1);
        s.rotation.x = Math.cos(a) * (0.08 + fan) + sw;
        s.rotation.z = -Math.sin(a) * (0.08 + fan) + Math.cos(t * 1.3 + ph) * 0.03;
        s.position.set(Math.sin(a) * (i === 0 ? 0 : 0.15), 0, Math.cos(a) * (i === 0 ? 0 : 0.15));
        hairs[i].forEach((b, j) => { b.rotation.y = Math.sin(t * 2.6 + ph + j) * 0.18 * (1 + m); });
      });
      strands.forEach((bs, si) => bs.forEach((b, j) => { b.rotation.x = Math.sin(t * 2.2 - j * 0.7 + si * 2) * 0.16 + 0.25 * m; b.rotation.z = Math.sin(t * 1.7 - j * 0.6 + si) * 0.14; }));
      bundle.rotation.z = Math.sin(t * 1.2) * 0.03;
      const sw = Math.sin(t * 7.5);
      armL.rotation.x = -sw * 0.5 * m - 1.3 * k * Math.sin(Math.PI * clamp01((an.stateT % 0.8) / 0.8)); armR.rotation.x = sw * 0.5 * m - 1.3 * k * Math.sin(Math.PI * clamp01((an.stateT % 0.8) / 0.8));
      armL.rotation.z = Math.sin(t * 1.4) * 0.06; armR.rotation.z = -Math.sin(t * 1.4) * 0.06;
      const bl = Math.max(0, Math.sin(t * 0.8)) ** 40; face.scale.y = 1 - 0.9 * bl;
    },
  };
}

// ======================== Fox Spirit ========================
function foxSpirit(grey = false): Avatar { // grey = Old Whisker, the named rare: larger, silver-grey fur
  const root = new THREE.Group();
  const body = node(); body.scale.setScalar(grey ? 1.55 : 1.1); root.add(body);
  root.add(shadowBlob(grey ? 1.4 : 0.95));
  const fur = grey ? hx(PAL.mist, PAL.paper, 0.45) : hx(PAL.vermilion, PAL.paperDark, 0.42), furD = grey ? hx(PAL.mist, PAL.inkSoft, 0.45) : hx(PAL.vermilion, PAL.inkSoft, 0.35), cream = hx(PAL.paper, PAL.paperDark, 0.1), sock = PAL.inkSoft;
  const torso = node(); torso.position.y = 0.64; body.add(torso);
  const tb = part(new THREE.SphereGeometry(0.31, 12, 9), fur, 0.02); tb.scale.set(0.85, 0.82, 1.55); torso.add(tb);
  const belly = part(new THREE.SphereGeometry(0.27, 9, 7), cream, 0); belly.scale.set(0.82, 0.6, 1.4); add(torso, belly, 0, -0.1, 0.03);
  const chest = part(new THREE.SphereGeometry(0.21, 9, 7), cream, 0.014); add(torso, chest, 0, -0.02, 0.38);
  for (let i = 0; i < 3; i++) { const s = part(new THREE.BoxGeometry(0.36, 0.022, 0.06), PAL.vermilion, 0); s.rotation.x = -0.1 + i * 0.05; add(torso, s, 0, 0.245 - i * 0.012, -0.12 + i * 0.16); }
  // flame mane along the spine
  for (let i = 0; i < 4; i++) { const f = glowPart(new THREE.ConeGeometry(0.05, 0.2 - i * 0.02, 5), i % 2 ? 0xffb35a : 0xff6a4a, 0.9); f.scale.z = 0.5; add(torso, f, 0, 0.3, -0.18 + i * 0.12); }
  // head
  const head = node(); head.position.set(0, 0.22, 0.54); head.scale.setScalar(1.15); torso.add(head);
  const skull = part(new THREE.SphereGeometry(0.2, 12, 9), fur, 0.02); skull.scale.set(1.02, 0.9, 0.95); head.add(skull);
  const snout = part(new THREE.ConeGeometry(0.12, 0.32, 8), cream, 0.016); snout.rotation.x = Math.PI / 2; add(head, snout, 0, -0.04, 0.23);
  const nose = part(new THREE.SphereGeometry(0.035, 6, 5), PAL.ink, 0); add(head, nose, 0, -0.015, 0.4);
  const jawM = part(new THREE.BoxGeometry(0.06, 0.012, 0.1), PAL.ink, 0); add(head, jawM, 0, -0.08, 0.3);
  for (const s of [-1, 1]) {
    const ear = part(new THREE.ConeGeometry(0.085, 0.34, 5), fur, 0.014); ear.rotation.z = -s * 0.22; ear.scale.z = 0.5; add(head, ear, s * 0.12, 0.22, -0.02);
    const earI = part(new THREE.ConeGeometry(0.045, 0.22, 4), PAL.ink, 0); earI.rotation.z = -s * 0.22; earI.scale.z = 0.4; add(head, earI, s * 0.12, 0.19, 0.0);
    // glowing slit eyes with ink-brush surround
    const eyeBg = part(new THREE.BoxGeometry(0.115, 0.045, 0.02), PAL.ink, 0); eyeBg.rotation.z = -s * 0.42; add(head, eyeBg, s * 0.09, 0.05, 0.17);
    const eye = glowPart(new THREE.BoxGeometry(0.085, 0.028, 0.02), 0xffe27a); eye.rotation.z = -s * 0.42; add(head, eye, s * 0.09, 0.05, 0.185);
    const cheek = part(new THREE.BoxGeometry(0.12, 0.016, 0.012), PAL.vermilion, 0); cheek.rotation.set(0, -s * 0.6, s * 0.2); add(head, cheek, s * 0.16, -0.04, 0.12);
    const whisk = part(new THREE.BoxGeometry(0.2, 0.006, 0.006), PAL.paper, 0); whisk.rotation.z = s * 0.15; add(head, whisk, s * 0.2, -0.03, 0.3);
  }
  const mark = glowPart(new THREE.ConeGeometry(0.035, 0.14, 4), 0xff5a3f, 0.9); mark.rotation.x = 0.2; add(head, mark, 0, 0.11, 0.18);
  // legs
  const legs: THREE.Bone[] = [];
  const mk = (x: number, z: number) => {
    const g = node(); g.position.set(x, 0.52, z);
    const up = part(new THREE.CylinderGeometry(0.065, 0.048, 0.36, 6), fur, 0.014); up.position.y = -0.18; g.add(up);
    const lo = part(new THREE.CylinderGeometry(0.046, 0.043, 0.22, 6), sock, 0.012); lo.position.y = -0.42; g.add(lo);
    const paw = part(new THREE.SphereGeometry(0.058, 6, 5), sock, 0.01); paw.position.set(0, -0.52, 0.03); paw.scale.set(1, 0.7, 1.4); g.add(paw);
    body.add(g); legs.push(g); return g;
  };
  mk(-0.15, 0.36); mk(0.15, 0.36); mk(-0.15, -0.3); mk(0.15, -0.3);
  // five flowing tails, each a 5-segment bone chain with a glowing flame tip
  const tails: { bones: THREE.Bone[]; fan: number; seed: number }[] = [];
  const nTails = 5;
  for (let i = 0; i < nTails; i++) {
    const fan = (i - (nTails - 1) / 2);
    const rootB = node(); rootB.position.set(0, 0.08, -0.4); rootB.rotation.order = "YXZ"; torso.add(rootB);
    const bones: THREE.Bone[] = [];
    let p: THREE.Object3D = rootB;
    const segs = 5, segL = 0.22;
    for (let j = 0; j < segs; j++) {
      const b = node(); b.position.y = j ? -segL : 0; p.add(b); bones.push(b);
      const w = 0.095 * (0.75 + 0.4 * Math.sin(Math.min(1, (j + 0.6) / segs) * Math.PI * 0.9));
      const col = j >= segs - 2 ? cream : j === 2 ? PAL.vermilion : j % 2 ? fur : furD;
      const seg = part(new THREE.SphereGeometry(1, 8, 6), col, 0.018); seg.scale.set(w, segL * 0.78, w * 0.9); seg.position.y = -segL * 0.5; b.add(seg);
      if (j === segs - 1) {
        const flame = glowPart(new THREE.ConeGeometry(0.07, 0.3, 5), i % 2 ? 0xffd27a : 0xff7a4a, 1); flame.rotation.x = Math.PI; flame.scale.z = 0.55; flame.position.y = -segL - 0.12; b.add(flame);
      }
      p = b;
    }
    tails.push({ bones, fan, seed: i * 1.3 });
  }
  // ghost-fire orbs
  const orbs: THREE.Bone[] = [];
  for (let i = 0; i < 2; i++) { const o = node(); body.add(o); o.add(glowPart(new THREE.SphereGeometry(0.06, 6, 5), i ? 0xffdd88 : 0xff7a55, 1)); orbs.push(o); }

  const hnd = bake(root, 0.32);
  const an = new Anim(); const dis = new Dissolve(root);
  const shadow = root.children.find((c) => c.name === "shadow");
  return {
    root, height: grey ? 1.8 : 1.25,
    setState(st: AvState) {
      if (st !== "dead" && an.state === "dead") { dis.end(); root.visible = true; if (shadow) shadow.visible = true; body.rotation.set(0, 0, 0); body.position.set(0, 0, 0); hnd.glow.value = 1; }
      an.setState(st);
    },
    update(dt: number) {
      an.tick(dt);
      const t = an.t, m = an.move, k = an.atk;
      const pulse = clamp01((an.stateT % 0.9) / 0.9);
      if (an.state === "dead") {
        const d = ease(an.dead);
        body.rotation.z = 1.45 * d; body.position.y = 0.3 * d;
        legs.forEach((l, i) => { l.rotation.x = (i % 2 ? 0.6 : -0.4) * d; });
        head.rotation.x = 0.3 * d;
        tails.forEach((tl) => { tl.bones.forEach((b, j) => { b.rotation.x = (j ? 0.2 : 1.9 - 0.4 * tl.fan * 0) * (1 - d) + 0.1 * d; }); });
        hnd.glow.value = 1 - d;
        const f = clamp01((an.stateT - 0.8) / 0.9);
        if (f > 0) { dis.begin(); dis.set(1 - f); } else dis.end();
        if (shadow) shadow.visible = f < 0.9;
        root.visible = f < 1;
        return;
      }
      hnd.glow.value = 0.85 + 0.15 * Math.sin(t * 4.1);
      const ph = t * 10;
      body.position.y = Math.abs(Math.sin(ph)) * 0.05 * m + Math.sin(t * 2) * 0.006 * (1 - m);
      body.position.z = 0.55 * Math.sin(Math.PI * pulse) * k;
      body.rotation.x = -0.3 * Math.sin(Math.PI * pulse) * k + 0.04 * m;
      legs.forEach((l, i) => { const s = (i === 0 || i === 3) ? 1 : -1; l.rotation.x = Math.sin(ph) * 0.7 * s * m - (i < 2 ? 0.8 : -0.4) * k * Math.sin(Math.PI * pulse); });
      torso.scale.set(1, 1 + Math.sin(t * 2.2) * 0.012, 1);
      head.rotation.y = Math.sin(t * 0.8) * 0.2 * (1 - k); head.rotation.x = -0.1 * m + 0.4 * k * Math.sin(Math.PI * pulse);
      head.rotation.z = Math.sin(t * 0.5) * 0.06;
      tails.forEach((tl) => {
        const rb = tl.bones[0].parent as THREE.Object3D;
        rb.rotation.y = tl.fan * 0.34 + Math.sin(t * 1.4 + tl.seed) * 0.1 * (1 - m);
        tl.bones.forEach((b, j) => {
          const wave = Math.sin(t * 2.3 - j * 0.8 + tl.seed) * (0.1 + 0.03 * j) * (1 + m * 0.8);
          b.rotation.x = (j === 0 ? 1.95 - 0.55 * m - 0.15 * k : 0.34 - 0.04 * m) + wave;
          b.rotation.z = Math.sin(t * 1.7 - j * 0.6 + tl.seed * 1.7) * 0.07 * (j + 1) * 0.4;
        });
      });
      orbs.forEach((o, i) => { const a = t * (1.4 + i * 0.5) + i * Math.PI; o.position.set(Math.sin(a) * 0.95, 1.05 + Math.sin(t * 2 + i) * 0.14, Math.cos(a) * 0.95); const s = 0.8 + 0.3 * Math.sin(t * 6 + i * 2); o.scale.setScalar(s); });
    },
  };
}

// ======================== Stone Guardian ========================
function runeCoreTexture(): THREE.CanvasTexture {
  return symbolTexture("rune", 256, "#ff7a58", "#ffcf8a").tex;
}

function stoneGuardian(): Avatar {
  const root = new THREE.Group();
  const body = node(); body.scale.setScalar(0.84); root.add(body);
  root.add(shadowBlob(2.8));
  const rnd = mulberry32(77);
  const stone = hx(PAL.mist, PAL.inkSoft, 0.5), stoneD = hx(PAL.inkSoft, PAL.ink, 0.28);
  const opt = (moss = 0.7, extra: object = {}) => ({ stone: new THREE.Color(stone), stoneD: new THREE.Color(stoneD), moss, strata: 0.45, cuts: 5, detail: 1, ...extra });
  let seed = 1;
  /** rock chunk of nominal size w,h,d */
  const R = (w: number, h: number, d: number, moss = 0.7, outline = 0.07): THREE.Mesh => vcPart(rockChunk(seed++ * 17, (w / 2) * 1.22, (h / 2) * 1.22, (d / 2) * 1.22, opt(moss)), outline);
  const RUNE = 0xff6a4a;
  const rune = (w: number, h: number, d: number, k = 1) => glowPart(new THREE.BoxGeometry(w, h, d), RUNE, k);

  // --- legs ---
  const mkLeg = (x: number) => {
    const g = node(); g.position.set(x, 2.25, 0);
    add(g, R(1.25, 1.25, 1.2), 0, -0.6, 0);
    const knee = add(g, R(0.85, 0.6, 0.6, 0.4), 0, -1.25, 0.55); knee.rotation.x = 0.3;
    add(g, R(1.1, 1.2, 1.1), 0, -1.65, 0);
    add(g, R(1.45, 0.55, 1.9, 0.9), 0, -2.1, 0.3);
    for (const s of [-1, 0, 1]) add(g, R(0.4, 0.4, 0.55, 0.3), s * 0.45, -2.15, 1.2);
    add(g, rune(0.07, 0.8, 0.07), 0.25, -1.55, 0.58);
    add(g, rune(0.07, 0.5, 0.07), -0.2, -1.65, 0.6);
    body.add(g); return g;
  };
  const legL = mkLeg(-0.95), legR = mkLeg(0.95);

  // --- pelvis + layered waist ---
  add(body, R(2.9, 1.0, 1.9, 0.6), 0, 2.4, 0);
  const waist = node(); waist.position.y = 2.75; body.add(waist);
  const torso = node(); torso.position.y = 2.95; body.add(torso);
  for (let i = 0; i < 3; i++) { const lay = add(torso, R(2.6 - i * 0.12, 0.55, 1.7 - i * 0.05, 0.6), (rnd() - 0.5) * 0.18, 0.1 + i * 0.5, (rnd() - 0.5) * 0.12); lay.rotation.y = (rnd() - 0.5) * 0.18; }
  // chest: big carved mass with a front slab and back hump
  add(torso, R(3.5, 1.9, 2.2, 0.8), 0, 2.15, 0);
  add(torso, R(2.6, 1.5, 0.55, 0.3), 0, 2.1, 1.12);
  add(torso, R(2.4, 1.3, 0.9, 0.9), 0, 2.4, -1.15);
  for (const s of [-1, 1]) add(torso, R(0.8, 1.3, 0.5, 0.2), s * 1.1, 2.1, 1.28);
  // chest core: ring of runes around the glowing rune
  const ring = glowPart(new THREE.TorusGeometry(0.62, 0.05, 5, 20), RUNE, 0.95); add(torso, ring, 0, 2.15, 1.42);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const tk = rune(0.1, 0.2, 0.06, 0.9); tk.rotation.z = -a; add(torso, tk, Math.sin(a) * 0.82, 2.15 + Math.cos(a) * 0.82, 1.4); }
  // belt of runes
  for (let i = -3; i <= 3; i++) add(torso, rune(0.22, 0.34, 0.06, 0.8), i * 0.44, 0.78, 1.0 + 0.02 * Math.abs(i));
  // cracks (glowing)
  const crack = (x: number, y: number, z: number, len: number, rot: number) => {
    let cx = x, cy = y;
    for (let i = 0; i < 4; i++) { const seg = rune(0.045, len / 4, 0.04, 0.55); const a = rot + (rnd() - 0.5) * 0.9; seg.rotation.z = a; cx += Math.sin(-a) * len / 4; cy += Math.cos(a) * len / 4; add(torso, seg, cx, cy, z); }
  };
  crack(-1.25, 2.9, 1.2, 1.0, 0.4); crack(1.4, 1.5, 1.25, 0.9, -0.5); crack(0.2, 3.0, -1.55, 1.2, 0.2); crack(-1.4, 1.2, 1.1, 0.7, 0.8);

  // --- head: carved face ---
  const head = node(); head.position.set(0, 3.75, 0.3); head.scale.setScalar(1.15); torso.add(head);
  add(head, R(1.5, 1.35, 1.4, 0.8), 0, 0.1, 0);
  add(head, R(1.7, 0.4, 0.7, 0.3), 0, 0.52, 0.62);       // brow ridge
  add(head, R(0.4, 0.8, 0.45, 0.2), 0, 0.0, 0.78);        // nose
  add(head, R(1.0, 0.5, 0.6, 0.3), 0, -0.52, 0.5);        // jaw
  for (const s of [-1, 1]) {
    add(head, R(0.55, 0.45, 0.4, 0.2), s * 0.62, -0.18, 0.55);    // cheek slabs
    const e = glowPart(new THREE.BoxGeometry(0.4, 0.12, 0.1), 0xff9a62, 1); e.rotation.z = -s * 0.28; add(head, e, s * 0.36, 0.3, 0.8);
    const horn = part(new THREE.ConeGeometry(0.2, 0.9, 5), hx(PAL.inkSoft, PAL.mist, 0.2), 0.03); horn.rotation.z = -s * 0.7; add(head, horn, s * 0.85, 0.8, -0.1);
    add(head, R(0.4, 0.8, 0.5, 0.2), s * 0.88, 0.1, -0.15);      // ear slab
  }
  const mouth = glowPart(new THREE.BoxGeometry(0.55, 0.07, 0.1), 0xd94a32, 0.85); add(head, mouth, 0, -0.45, 0.82);
  for (const s of [-2, -1, 0, 1, 2]) add(head, part(new THREE.ConeGeometry(0.07, 0.2, 4), hx(PAL.inkSoft, PAL.mist, 0.3), 0.01), s * 0.19, 0.95, -0.2);
  add(head, R(0.9, 0.35, 0.8, 1.0), 0.15, 0.85, 0.0);      // moss crown
  const mark = glowPart(new THREE.OctahedronGeometry(0.1), 0xff5a3f, 1); mark.scale.y = 1.6; add(head, mark, 0, 0.78, 0.84);

  // --- arms ---
  const mkArm = (s: number) => {
    const sh = node(); sh.position.set(s * 2.45, 3.45, 0); torso.add(sh);
    // pauldron boulder with moss + rune band + spikes
    const pd = add(sh, R(1.7, 1.1, 1.7, 1.0), s * 0.1, 0.3, 0); pd.rotation.z = -s * 0.15;
    const band = glowPart(new THREE.TorusGeometry(0.78, 0.045, 5, 18), RUNE, 0.9); band.rotation.x = Math.PI / 2 - 0.2; band.rotation.z = -s * 0.15; add(sh, band, s * 0.1, 0.1, 0);
    for (let i = 0; i < 3; i++) { const sp = part(new THREE.ConeGeometry(0.16, 0.6, 5), stoneD, 0.03); sp.rotation.z = -s * (0.4 + i * 0.35); add(sh, sp, s * (0.55 + i * 0.1), 1.05 - i * 0.16, (i - 1) * 0.35); }
    add(sh, R(1.0, 1.8, 1.05, 0.5), 0, -1.0, 0);
    add(sh, rune(0.07, 0.9, 0.07), s * 0.28, -1.0, 0.55);
    const elbow = node(); elbow.position.y = -1.95; sh.add(elbow);
    add(elbow, R(1.3, 0.55, 1.3, 0.4), 0, 0.0, 0);
    add(elbow, R(1.2, 1.6, 1.2, 0.4), 0, -0.95, 0);
    add(elbow, rune(0.07, 0.7, 0.07), -s * 0.25, -0.9, 0.62);
    add(elbow, rune(0.3, 0.07, 0.07), -s * 0.25, -0.62, 0.62);
    add(elbow, R(1.55, 1.25, 1.5, 0.3), 0, -2.15, 0.1);
    for (const k of [-1, 0, 1]) add(elbow, R(0.4, 0.4, 0.5, 0.2), k * 0.5, -2.35, 0.8);
    return { sh, elbow };
  };
  const A_L = mkArm(-1), A_R = mkArm(1);

  // chest core glyph (the one non-baked mesh): additive rune mark that pulses with the breathing glow
  const coreMat = new THREE.MeshBasicMaterial({ map: runeCoreTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
  const core = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), coreMat); core.position.set(0, 2.15, 1.45); core.name = "core"; torso.add(core);

  // phase 3 ("cracked open"): jagged white-hot fissures across the chest, belly and shoulders (additive, hidden until the last quarter of its HP)
  const crackMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false, side: THREE.DoubleSide });
  const cracks = new THREE.Group(); cracks.visible = false; torso.add(cracks);
  {
    const cr = mulberry32(5);
    for (const [x0, y0, ang, n] of [[-0.2, 2.9, -1.1, 6], [0.5, 2.8, -2.0, 5], [-0.7, 1.6, -0.5, 6], [0.3, 1.5, -1.6, 7], [0.9, 2.4, -0.9, 4], [-0.9, 2.5, -1.7, 4]] as const) {
      let cx = x0, cy = y0, a = ang;
      for (let i = 0; i < n; i++) {
        const len = 0.28 + cr() * 0.22, seg = new THREE.Mesh(new THREE.PlaneGeometry(0.07 * (1 - i / (n + 2)) + 0.025, len), crackMat);
        a += (cr() - 0.5) * 1.1; seg.rotation.z = a; seg.position.set(cx - Math.sin(a) * len / 2, cy + Math.cos(a) * len / 2, 1.5 + 0.01 * i); cracks.add(seg);
        cx -= Math.sin(a) * len; cy += Math.cos(a) * len;
      }
    }
  }
  let p3 = 0, p3Target = 0;

  const hnd = bake(root, 0.26);
  const an = new Anim(); const dis = new Dissolve(root);
  const shadow = root.children.find((c) => c.name === "shadow");
  return {
    root, height: 5.6,
    setPhase(n: number) { p3Target = n >= 3 ? 1 : 0; },
    setState(st: AvState) {
      if (st !== "dead" && an.state === "dead") { dis.end(); root.visible = true; if (shadow) shadow.visible = true; body.rotation.set(0, 0, 0); body.position.set(0, 0, 0); hnd.glow.value = 1; core.visible = true; }
      an.setState(st);
    },
    update(dt: number) {
      an.tick(dt);
      const t = an.t, m = an.move, k = an.atk;
      p3 += (p3Target - p3) * Math.min(1, dt * 2.5);
      if (an.state === "dead") {
        cracks.visible = false;
        const d = ease(an.dead);
        body.rotation.x = -0.35 * d; body.position.y = -0.9 * d; body.position.z = -0.4 * d;
        A_L.sh.rotation.x = 0.3 * d; A_R.sh.rotation.x = 0.5 * d; A_L.sh.rotation.z = -0.5 * d; A_R.sh.rotation.z = 0.4 * d;
        head.rotation.x = 0.5 * d; head.rotation.z = 0.2 * d;
        legL.rotation.x = 0.2 * d; legR.rotation.x = -0.15 * d;
        hnd.glow.value = 1 - d; coreMat.opacity = 1 - d; core.visible = d < 0.98;
        const f = clamp01((an.stateT - 1.0) / 1.2);
        if (f > 0) { dis.begin(); dis.set(1 - f); } else dis.end();
        if (shadow) shadow.visible = f < 0.9;
        root.visible = f < 1;
        return;
      }
      // breathing glow: a slow inhale/exhale of the runes, flaring on attack
      const breath = 0.5 + 0.5 * Math.sin(t * 1.5);
      const flare = 0.5 + 0.5 * Math.sin(t * 9);
      hnd.glow.value = 0.55 + 0.45 * breath + 0.3 * k + p3 * (0.6 + 0.35 * flare);
      coreMat.opacity = Math.min(1, 0.55 + 0.45 * breath + 0.4 * p3);
      coreMat.color.setRGB(1 + 0.6 * p3, 1 + 0.35 * p3, 1 + 0.1 * p3);
      const cs = (1.0 + 0.1 * breath + 0.15 * k) * (1 + 0.55 * p3); core.scale.set(cs, cs, 1); core.rotation.z = p3 * t * 0.6;
      cracks.visible = p3 > 0.02; crackMat.opacity = p3 * (0.7 + 0.3 * flare);
      const ph = t * 4.2;
      body.position.y = Math.abs(Math.sin(ph)) * 0.14 * m + Math.sin(t * 1.1) * 0.015;
      body.rotation.z = Math.sin(ph) * 0.035 * m;
      legL.rotation.x = Math.sin(ph) * 0.5 * m; legR.rotation.x = -Math.sin(ph) * 0.5 * m;
      torso.scale.set(1 + 0.008 * breath, 1 + 0.014 * breath, 1 + 0.008 * breath);
      torso.rotation.y = Math.sin(ph) * 0.1 * m;
      head.rotation.y = Math.sin(t * 0.5) * 0.15 * (1 - k);
      const p = (an.stateT % 1.2) / 1.2;
      const raise = ease(clamp01(p / 0.45)), slam = ease(clamp01((p - 0.45) / 0.15)), rec = ease(clamp01((p - 0.7) / 0.3));
      const armPitch = (-2.7 * raise * (1 - slam) + 0.1 * slam) * (1 - rec);
      const swing = Math.sin(ph) * 0.4 * m;
      A_L.sh.rotation.x = THREE.MathUtils.lerp(-swing + Math.sin(t * 1.2) * 0.02, armPitch, k);
      A_R.sh.rotation.x = THREE.MathUtils.lerp(swing + Math.sin(t * 1.2 + 1) * 0.02, armPitch, k);
      A_L.elbow.rotation.x = -0.2 - 0.5 * k * raise * (1 - slam); A_R.elbow.rotation.x = -0.2 - 0.5 * k * raise * (1 - slam);
      A_L.sh.rotation.z = 0.05; A_R.sh.rotation.z = -0.05;
      torso.rotation.x = (-0.2 * raise * (1 - slam) + 0.35 * slam * (1 - rec)) * k;
      body.position.z = 0.25 * slam * (1 - rec) * k;
    },
  };
}

// ======================== Ink Wisp ========================
function inkWisp(): Avatar {
  const root = new THREE.Group();
  const body = node(); root.add(body);
  root.add(shadowBlob(0.55));
  const ink = hx(PAL.ink, PAL.inkSoft, 0.2), inkD = hx(PAL.ink, PAL.inkSoft, 0.45), glowC = 0x9fd8ff;
  const orb = node(); body.add(orb);
  const shell = part(new THREE.SphereGeometry(0.34, 12, 10), ink, 0.02); shell.scale.y = 0.9; orb.add(shell);
  const core = glowPart(new THREE.SphereGeometry(0.22, 10, 8), glowC); orb.add(core);
  const tail: THREE.Object3D[] = [];
  for (let i = 0; i < 3; i++) {
    const tt = part(new THREE.SphereGeometry(0.2 - i * 0.05, 8, 6), i % 2 ? ink : inkD, 0.02);
    tt.position.set((i - 1) * 0.07, -0.52 - i * 0.26, 0.03); tt.scale.setScalar(1 - i * 0.22);
    body.add(tt); tail.push(tt);
  }
  for (const s of [-1, 1]) {
    const e = glowPart(new THREE.BoxGeometry(0.1, 0.05, 0.04), glowC);
    e.position.set(s * 0.11, 0.07, 0.27); orb.add(e);
  }
  const hnd = bake(root, 0.3);
  const an = new Anim(); const dis = new Dissolve(root);
  const shadow = root.children.find((c) => c.name === "shadow");
  return {
    root, height: 1.0,
    setState(st: AvState) {
      if (st !== "dead" && an.state === "dead") { dis.end(); root.visible = true; if (shadow) shadow.visible = true; hnd.glow.value = 1; }
      an.setState(st);
    },
    update(dt: number) {
      an.tick(dt);
      const t = an.t, m = an.move, k = an.atk;
      if (an.state === "dead") {
        const d = ease(an.dead);
        body.position.y = -0.4 * d; body.rotation.x = 1.2 * d;
        hnd.glow.value = 1 - d;
        const f = clamp01((an.stateT - 0.8) / 0.9);
        if (f > 0) { dis.begin(); dis.set(1 - f); } else dis.end();
        if (shadow) shadow.visible = f < 0.9;
        root.visible = f < 1;
        return;
      }
      hnd.glow.value = 0.8 + 0.2 * Math.sin(t * 4);
      body.position.y = 0.8 + Math.sin(t * 2.6) * 0.12 + Math.sin(t * 5.3) * 0.05;
      body.rotation.z = Math.sin(t * 1.3) * 0.1;
      const lunge = Math.sin(Math.PI * clamp01((an.stateT % 0.8) / 0.8)) * 0.45 * k;
      body.position.z = lunge; body.rotation.x = 0.3 * k;
      const squish = 1 + m * 0.25; shell.scale.y = 0.9 / squish; shell.scale.x = squish; shell.scale.z = squish;
      tail.forEach((tt, i) => {
        tt.position.y = -0.52 - i * 0.26 + Math.sin(t * 2.6 + i * 1.3) * 0.06 * (1 + m);
        tt.rotation.z = Math.sin(t * 2 + i) * 0.18;
      });
    },
  };
}

// ======================== The Hollow Bride (fourth boss, 0.5.0) ========================
/** A tall ceremonial wraith: ash-paper bridal robe, red and gold headdress with tassels, a hollow face, a long translucent
 *  veil and trailing bridal cloth. VEILED = pallid/wrapped, eyes dim, no sigil; REVEALED = the veil thins, a golden sigil
 *  blazes on the chest and the robe warms. `setVeiled` is the optional hook game.ts forwards from EntityState.veiled. */
function hollowBride(): Avatar & { setVeiled: (v: boolean) => void } {
  const root = new THREE.Group();
  const body = node(); root.add(body);
  root.add(shadowBlob(1.5));
  const robe = hx(PAL.paper, PAL.inkSoft, 0.4), robeD = hx(PAL.paper, PAL.inkSoft, 0.62), ash = hx(PAL.inkSoft, PAL.ink, 0.3);
  const gold = PAL.gold, red = PAL.vermilion, bone = hx(PAL.paper, PAL.ink, 0.08);

  // ---- lower robe: a flared, trailing paper cone (no feet; she hovers)
  const skirt = node(); skirt.position.y = 0.06; body.add(skirt);
  for (let i = 0; i < 5; i++) {
    const y = 0.24 + i * 0.5, r0 = 1.24 - i * 0.15, r1 = 1.12 - i * 0.15;
    add(skirt, part(new THREE.CylinderGeometry(r1, r0, 0.54, 9, 1, true), i % 2 ? robe : robeD, 0.028), 0, y, 0);
  }
  const hem = add(skirt, part(new THREE.TorusGeometry(1.2, 0.055, 5, 16), gold, 0.018), 0, 0.16, 0); hem.rotation.x = Math.PI / 2;
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const fold = part(new THREE.BoxGeometry(0.1, 1.5, 0.05), robeD, 0.02); fold.rotation.y = a; add(skirt, fold, Math.sin(a) * 1.05, 0.95, Math.cos(a) * 1.05); }

  // ---- torso + bridal sash
  const torso = node(); torso.position.y = 2.35; body.add(torso);
  add(torso, part(new THREE.CylinderGeometry(0.5, 0.82, 1.2, 8), robe, 0.03), 0, 0, 0);
  add(torso, part(new THREE.BoxGeometry(1.2, 0.17, 0.86), gold, 0.02), 0, 0.42, 0.01);
  add(torso, part(new THREE.BoxGeometry(0.3, 1.0, 0.1), red, 0.02), 0, 0.0, 0.55); // red front panel
  for (let i = 0; i < 4; i++) add(torso, part(new THREE.TorusGeometry(0.62 - i * 0.06, 0.03, 4, 12), robeD, 0.015), 0, 0.24 - i * 0.2, 0).rotation.x = Math.PI / 2;

  // ---- arms: long trailing sleeves
  const mkArm = (s: number) => {
    const sh = node(); sh.position.set(s * 0.62, 2.72, 0.02); body.add(sh);
    add(sh, part(new THREE.SphereGeometry(0.24, 9, 7), robe, 0.02), 0, 0, 0);
    const elbow = node(); elbow.position.y = 0.55; sh.add(elbow);
    add(elbow, part(new THREE.CylinderGeometry(0.16, 0.22, 1.0, 7), robeD, 0.022), 0, 0.5, 0);
    const hand = node(); hand.position.y = 1.0; elbow.add(hand);
    add(hand, part(new THREE.SphereGeometry(0.11, 8, 6), bone, 0.018), 0, 0, 0);
    for (let i = 0; i < 3; i++) add(hand, part(new THREE.ConeGeometry(0.035, 0.26, 4), bone, 0.01), (i - 1) * 0.07, -0.16, 0.02);
    return { sh, elbow, hand };
  };
  const armL = mkArm(-1), armR = mkArm(1);

  // ---- head: pale mask over a hollow void, dim veil-lit eyes, red-gold bridal crown with tassels
  const head = node(); head.position.set(0, 3.28, 0.02); body.add(head);
  add(head, part(new THREE.SphereGeometry(0.34, 12, 10), bone, 0.025), 0, 0, 0);
  add(head, part(new THREE.BoxGeometry(0.5, 0.44, 0.36), ash, 0.02), 0, 0.0, 0.22);
  for (const s of [-1, 1]) add(head, glowPart(new THREE.SphereGeometry(0.055, 8, 6), 0xd8e4ff), s * 0.1, 0.03, 0.4);
  const crown = node(); crown.position.y = 0.3; head.add(crown);
  add(crown, part(new THREE.TorusGeometry(0.27, 0.045, 5, 12), gold, 0.018), 0, -0.02, 0).rotation.x = Math.PI / 2;
  for (let i = -2; i <= 2; i++) { const c = part(new THREE.ConeGeometry(0.06, 0.5 + (i === 0 ? 0.2 : 0), 5), gold, 0.016); c.rotation.z = -i * 0.26; add(crown, c, i * 0.11, 0.26, 0); }
  const tassels: THREE.Bone[][] = [];
  for (const s of [-1, 1]) {
    let p: THREE.Object3D = crown; const bs: THREE.Bone[] = [];
    for (let i = 0; i < 3; i++) {
      const b = node(); b.position.y = i ? -0.3 : 0.08; b.position.x = s * 0.16; p.add(b); bs.push(b);
      add(b, part(new THREE.ConeGeometry(0.05 - i * 0.008, 0.34, 4), red, 0.012), 0, -0.17, 0);
      p = b;
    }
    tassels.push(bs);
  }

  // ---- translucent bridal cloth: three long veil panels from the crown + two trailing ribbons behind the waist (unbaked)
  const veilMat = new THREE.MeshToonMaterial({ color: 0xf4eee2, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false });
  const veil = new THREE.Group(); veil.position.set(0, 0.16, 0); head.add(veil);
  const veilPanels: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 2.9, 1, 4), veilMat);
    pl.position.set((i - 1) * 0.3, -1.2, i === 1 ? 0.34 : 0.06);
    pl.rotation.y = (i - 1) * 0.55;
    veil.add(pl); veilPanels.push(pl);
  }
  const clothMat = new THREE.MeshToonMaterial({ color: 0xe9dcc4, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false });
  const ribbons: THREE.Bone[][] = [];
  for (const s of [-1, 1]) {
    const rootB = node(); rootB.position.set(s * 0.3, 2.2, -0.5); body.add(rootB);
    const bs: THREE.Bone[] = []; let p: THREE.Object3D = rootB;
    for (let i = 0; i < 5; i++) {
      const b = node(); b.position.y = i ? 0 : 0; b.position.z = i ? -0.52 : 0; p.add(b); bs.push(b);
      const seg = new THREE.Mesh(new THREE.PlaneGeometry(0.42 - i * 0.05, 0.56), clothMat);
      seg.position.z = -0.26; seg.rotation.x = Math.PI / 2; b.add(seg);
      p = b;
    }
    ribbons.push(bs);
  }

  // ---- revealed sigil: an additive brush-rune on the chest, hidden while veiled (unbaked)
  const sigilMat = new THREE.MeshBasicMaterial({ map: symbolTexture("rune", 256, "#ffce7a", "#fff0c8").tex, color: 0xffce7a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
  const sigil = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), sigilMat); sigil.position.set(0, 2.4, 0.86); body.add(sigil);

  const hnd = bake(root, 0.3);
  const baked = hnd.skinned.material as THREE.MeshToonMaterial;
  const an = new Anim(); const dis = new Dissolve(root);
  const shadow = root.children.find((c) => c.name === "shadow");
  let veilAmt = 1; // 1 = VEILED (pallid, wrapped), 0 = REVEALED
  let veilTarget = 1;
  return {
    root, height: 4.4,
    setVeiled(v: boolean) { veilTarget = v ? 1 : 0; },
    setState(st: AvState) {
      if (st !== "dead" && an.state === "dead") { dis.end(); root.visible = true; if (shadow) shadow.visible = true; body.rotation.set(0, 0, 0); body.position.set(0, 0.25, 0); hnd.glow.value = 1; }
      an.setState(st);
    },
    update(dt: number) {
      an.tick(dt);
      const t = an.t, m = an.move, k = an.atk;
      veilAmt += (veilTarget - veilAmt) * Math.min(1, dt * 4.5);
      if (an.state === "dead") {
        const d = ease(an.dead);
        body.rotation.x = 0.5 * d; body.position.y = 0.25 - 0.5 * d;
        hnd.glow.value = (1 - veilAmt) * 0.6 * (1 - d);
        sigilMat.opacity = 0; veilMat.opacity = 0.3 * (1 - d);
        const f = clamp01((an.stateT - 0.8) / 1.0);
        if (f > 0) { dis.begin(); dis.set(1 - f); } else dis.end();
        if (shadow) shadow.visible = f < 0.9;
        root.visible = f < 1;
        return;
      }
      // state read-out: veil opacity, robe tint (cool ash while veiled -> warm bone when revealed), sigil + eyes
      veilMat.opacity = 0.12 + 0.4 * veilAmt;
      const warm = 1 - veilAmt;
      baked.color.setRGB(0.82 + 0.18 * warm, 0.85 + 0.13 * warm, 0.9 + 0.02 * warm);
      const pulse = 0.5 + 0.5 * Math.sin(t * 5.2);
      sigilMat.opacity = warm * (0.55 + 0.4 * pulse);
      sigil.scale.setScalar(0.9 + 0.14 * pulse * warm + 0.08 * warm);
      hnd.glow.value = 0.35 + 0.15 * Math.sin(t * 1.7) + 0.55 * warm + 0.25 * k;
      const hover = Math.sin(t * 1.15) * 0.07;
      body.position.y = 0.25 + hover + 0.03 * m;
      body.rotation.z = Math.sin(t * 0.85) * 0.03 + Math.sin(t * 3.1) * 0.012 * m;
      body.position.z = 0.18 * Math.sin(Math.PI * clamp01((an.stateT % 1.5) / 1.5)) * k;
      const bow = Math.sin(Math.PI * clamp01((an.stateT % 1.5) / 1.5)) * k;
      torso.rotation.x = -0.14 * bow; head.rotation.x = 0.12 * bow - 0.03;
      torso.rotation.y = Math.sin(t * 0.6) * 0.06 * (1 - k);
      head.rotation.y = Math.sin(t * 0.42) * 0.14 * (1 - k);
      head.rotation.z = Math.sin(t * 0.7) * 0.03;
      // long sleeves: sway, then sweep forward on attack
      const sweep = Math.sin(Math.PI * clamp01((an.stateT % 1.5) / 1.5)) * k;
      armL.sh.rotation.x = -0.1 - sweep * 1.5 + Math.sin(t * 1.3) * 0.05 * (1 - k);
      armR.sh.rotation.x = -0.1 - sweep * 1.3 + Math.sin(t * 1.3 + 1) * 0.05 * (1 - k);
      armL.sh.rotation.z = 0.12 + 0.1 * (1 - veilAmt); armR.sh.rotation.z = -0.12 - 0.1 * (1 - veilAmt);
      armL.elbow.rotation.x = -0.35 - sweep * 0.5; armR.elbow.rotation.x = -0.3 - sweep * 0.4;
      // crown tassels sway with the head
      tassels.forEach((bs, ri) => bs.forEach((b, j) => {
        b.rotation.x = Math.sin(t * 2.1 - j * 0.8 + ri) * (0.08 + 0.05 * j);
        b.rotation.z = Math.sin(t * 1.5 + j * 0.6 + ri * 2) * 0.06;
      }));
      // trailing bridal cloth ripples behind her, faster when she drifts
      ribbons.forEach((bs, ri) => bs.forEach((b, j) => {
        b.rotation.x = 0.18 + Math.sin(t * 1.7 - j * 0.75 + ri * 1.9) * (0.14 + 0.03 * j) + 0.16 * m;
        b.rotation.y = Math.sin(t * 1.1 + j * 0.4 + ri) * 0.1;
      }));
      veil.rotation.z = Math.sin(t * 0.8) * 0.05 + Math.sin(t * 2.3) * 0.02 * m;
      veilPanels.forEach((pl, i) => { pl.scale.y = 1 + Math.sin(t * 1.3 + i * 0.9) * 0.05 + 0.05 * (1 - veilAmt); });
    },
  };
}

// ======================== The Twin Wardens (fifth boss, a linked pair) ========================
/** A mirrored stone warden: two fused upper bodies sharing one robed base — a jade half and an ash half, twin horned masks,
 *  a chain strung between the two outer wrists and a glowing bond sigil on the shared chest. Deliberately unlike the other
 *  bosses: the silhouette reads as ONE body with two heads/halves, which is the encounter's theme. No optional hooks are
 *  needed (the bond is enforced server-side); the model just needs to animate walk/slam/death like any avatar. */
function twinWarden(): Avatar {
  const root = new THREE.Group();
  const body = node(); body.scale.setScalar(0.9); root.add(body);
  root.add(shadowBlob(2.7));
  const jade = hx(PAL.jade, PAL.inkSoft, 0.42), jadeD = hx(PAL.jade, PAL.ink, 0.32);
  const ash = hx(PAL.mist, PAL.inkSoft, 0.55), ashD = hx(PAL.inkSoft, PAL.ink, 0.3);
  const gold = PAL.gold, pale = hx(PAL.paper, PAL.inkSoft, 0.25);
  const RUNE = 0x8fe0c0;

  // ---- shared lower body: a heavy flared robe on four stubby feet (one base for both halves)
  const base = node(); base.position.y = 0.15; body.add(base);
  add(base, part(new THREE.CylinderGeometry(1.05, 1.35, 0.9, 8), ash, 0.04), 0, 0.45, 0);
  add(base, part(new THREE.TorusGeometry(1.12, 0.07, 5, 12), gold, 0.02), 0, 0.5, 0).rotation.x = Math.PI / 2;
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; const foot = part(new THREE.BoxGeometry(0.42, 0.35, 0.7), ashD, 0.03); foot.position.set(Math.sin(a) * 0.85, 0.18, Math.cos(a) * 0.85); foot.rotation.y = a; base.add(foot); }
  for (let i = 0; i < 3; i++) { const b = part(new THREE.BoxGeometry(1.5 - i * 0.18, 0.12, 1.5 - i * 0.18), i % 2 ? ashD : ash, 0.03); add(base, b, 0, 0.18 + i * 0.24, 0); }
  for (const s of [-1, 1]) add(base, glowPart(new THREE.BoxGeometry(0.07, 0.5, 0.07), RUNE, 0.8), s * 0.62, 0.5, 0.9);

  // ---- twin torso halves, mirrored about the spine: left jade, right ash
  const halves = [1, -1].map((s) => {
    const h = node(); h.position.set(s * 0.42, 1.55, 0); body.add(h);
    const c = s > 0 ? jade : ash, cd = s > 0 ? jadeD : ashD;
    add(h, part(new THREE.CylinderGeometry(0.46, 0.62, 0.95, 7), c, 0.03), 0, 0.45, 0);
    add(h, part(new THREE.CylinderGeometry(0.36, 0.48, 0.5, 7), cd, 0.03), 0, 1.12, 0);
    // mask head: horned half-mask, one glowing eye each; the two faces look slightly outward
    const head = node(); head.position.set(0, 1.6, 0); h.add(head);
    add(head, part(new THREE.SphereGeometry(0.3, 10, 8), pale, 0.025), 0, 0, 0);
    add(head, part(new THREE.BoxGeometry(0.3, 0.34, 0.2), cd, 0.02), s * 0.12, -0.02, 0.16);
    add(head, glowPart(new THREE.SphereGeometry(0.06, 8, 6), s > 0 ? RUNE : 0xffcf8a), s * 0.1, 0.03, 0.28);
    for (let k = 0; k < 2; k++) { const horn = part(new THREE.ConeGeometry(0.09, 0.55 - k * 0.12, 5), pale, 0.02); horn.rotation.z = s * (0.35 + k * 0.35); horn.rotation.x = -0.2 + k * 0.3; add(head, horn, s * (0.12 + k * 0.14), 0.3 - k * 0.05, -0.02); }
    // shoulder + arm with a rune band and a chain cuff
    const sh = node(); sh.position.set(s * 0.5, 1.05, 0); h.add(sh);
    add(sh, part(new THREE.SphereGeometry(0.34, 9, 7), c, 0.03), 0, 0, 0);
    const elbow = node(); elbow.position.y = -0.55; sh.add(elbow);
    add(elbow, part(new THREE.CylinderGeometry(0.2, 0.26, 0.8, 7), cd, 0.025), 0, -0.3, 0);
    add(elbow, glowPart(new THREE.TorusGeometry(0.24, 0.04, 5, 10), RUNE, 0.9), 0, -0.62, 0).rotation.x = Math.PI / 2;
    const fist = node(); fist.position.y = -0.75; elbow.add(fist);
    add(fist, part(new THREE.BoxGeometry(0.34, 0.3, 0.34), c, 0.03), 0, -0.1, 0);
    return { h, head, sh, elbow, fist, side: s };
  });

  // ---- the bond: a chain slung between the two outer fists and a shared sigil on the sternum
  const chain: THREE.Object3D[] = [];
  for (let i = 0; i < 5; i++) {
    const link = node(); link.position.set(0, 1.35 - Math.sin((i / 4) * Math.PI) * 0.32, 0.42);
    const tor = part(new THREE.TorusGeometry(0.1, 0.03, 4, 8), gold, 0.01); tor.rotation.x = i % 2 ? Math.PI / 2 : 0; link.add(tor);
    body.add(link); chain.push(link);
  }
  const coreMat = new THREE.MeshBasicMaterial({ map: symbolTexture("rune", 256, "#8fe0c0", "#d8fff0").tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
  const core = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), coreMat); core.position.set(0, 1.55, 0.55); body.add(core);
  const ring = part(new THREE.TorusGeometry(0.55, 0.035, 4, 14), gold, 0.01); ring.position.set(0, 1.55, 0.42); body.add(ring);

  const hnd = bake(root, 0.28);
  const an = new Anim(); const dis = new Dissolve(root);
  const shadow = root.children.find((c) => c.name === "shadow");
  return {
    root, height: 4.9,
    setState(st: AvState) {
      if (st !== "dead" && an.state === "dead") { dis.end(); root.visible = true; if (shadow) shadow.visible = true; body.rotation.set(0, 0, 0); body.position.set(0, 0, 0); hnd.glow.value = 1; core.visible = true; }
      an.setState(st);
    },
    update(dt: number) {
      an.tick(dt);
      const t = an.t, m = an.move, k = an.atk;
      if (an.state === "dead") {
        const d = ease(an.dead);
        body.rotation.z = 0.5 * d; body.rotation.x = 0.4 * d; body.position.y = -0.7 * d;
        halves.forEach((h, i) => { h.sh.rotation.z = -h.side * (0.4 + i * 0.2) * d; h.head.rotation.z = h.side * 0.35 * d; });
        hnd.glow.value = 1 - d; coreMat.opacity = 1 - d; core.visible = d < 0.95;
        const f = clamp01((an.stateT - 1.0) / 1.2);
        if (f > 0) { dis.begin(); dis.set(1 - f); } else dis.end();
        if (shadow) shadow.visible = f < 0.9;
        root.visible = f < 1;
        return;
      }
      const breath = 0.5 + 0.5 * Math.sin(t * 1.6);
      hnd.glow.value = 0.6 + 0.4 * breath + 0.3 * k;
      coreMat.opacity = 0.55 + 0.3 * breath + 0.2 * k;
      core.rotation.z = t * 0.5 * (1 + 0.3 * k);
      ring.rotation.z = -t * 0.35;
      const ph = t * 4.4;
      body.position.y = Math.abs(Math.sin(ph)) * 0.12 * m + Math.sin(t * 1.2) * 0.015;
      body.rotation.z = Math.sin(ph) * 0.03 * m;
      halves.forEach((h, i) => {
        const dir = i === 0 ? 1 : -1;
        h.h.rotation.y = Math.sin(t * 0.7 + i * 1.7) * 0.06;
        h.head.rotation.y = dir * (0.25 + Math.sin(t * 0.5 + i) * 0.15) * (1 - k);
        const raise = ease(clamp01((an.stateT % 1.35) / 0.5)), slam = ease(clamp01(((an.stateT % 1.35) - 0.5) / 0.16));
        h.sh.rotation.x = -(1.4 * raise * (1 - slam) - 0.25 * slam) * k + Math.sin(ph + i) * 0.08 * m;
        h.sh.rotation.z = dir * (0.15 + 0.5 * raise * (1 - slam)) * k;
        h.elbow.rotation.x = (-0.3 - 0.9 * raise * (1 - slam)) * k;
        h.h.rotation.x = (-0.1 + 0.25 * slam * (1 - ease(clamp01(((an.stateT % 1.35) - 0.66) / 0.34)))) * k;
      });
      chain.forEach((link, i) => { link.position.y = 1.35 - Math.sin((i / 4) * Math.PI) * 0.32 + Math.sin(t * 2.1 + i * 0.8) * 0.035; link.rotation.y = Math.sin(t * 1.4 + i) * 0.2; });
      const kk = 0.9 + 0.1 * Math.sin(t * 2.2);
      core.scale.set(kk, kk, 1);
    },
  };
}

export function buildMob(type: string): Avatar {
  switch (type) {
    case "bamboo_spirit": return bambooSpirit();
    case "fox_spirit": return foxSpirit();
    case "old_whisker": return foxSpirit(true);
    case "lotus_toad": return lotusToad();
    case "stone_hound": return stoneHound();
    case "jade_serpent": return jadeSerpent();
    case "ink_wisp": return inkWisp();
    case "mist_warden": return stoneGuardian();
    case "hollow_hierophant": return stoneGuardian(); // 0.5.0 third boss: reuses the carved colossus until it gets its own model
    case "hollow_bride": return hollowBride(); // 0.5.0 fourth boss: veiled wraith with its own model + setVeiled hook
    case "twin_warden": return twinWarden(); // 0.5.0 P3 fifth boss: the linked pair (two fused halves, one shared body)
    case "thorn_sprite": return foxSpirit();
    default: return stoneGuardian();
  }
}
