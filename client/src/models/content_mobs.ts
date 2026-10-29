// 0.4.0 content mobs: Lotus Toad Warden (pond shore) and Stone Hound (northern foothills). Same recipe as the other mobs: toon parts under
// animation nodes, baked into ONE skinned mesh + ink hull, ink-dissolve on death.
import * as THREE from "three";
import { PAL, hex } from "../world/toon";
import { Anim, Avatar, AvState, Dissolve, bake, clamp01, ease, glowPart, node, part, shadowBlob } from "./common";

const hx = (a: number, b: number, t: number) => hex(a, b, t).getHex();
const add = <T extends THREE.Object3D>(parent: THREE.Object3D, o: T, x = 0, y = 0, z = 0): T => { o.position.set(x, y, z); parent.add(o); return o; };

// ======================== Lotus Toad Warden ========================
export function lotusToad(): Avatar {
  const root = new THREE.Group();
  const body = node(); body.scale.setScalar(1.12); root.add(body);
  root.add(shadowBlob(0.85));
  const skin = hx(PAL.jade, PAL.inkSoft, 0.42), skinL = hx(PAL.jade, PAL.paper, 0.3), skinD = hx(PAL.jade, PAL.ink, 0.55), belly = hx(PAL.paper, PAL.jade, 0.25), sac = hx(PAL.gold, PAL.paper, 0.25);
  const torso = node(); torso.position.y = 0.36; body.add(torso);
  const tb = part(new THREE.SphereGeometry(0.4, 12, 9), skin, 0.02); tb.scale.set(1.1, 0.78, 1.2); torso.add(tb);
  const bl = part(new THREE.SphereGeometry(0.34, 10, 8), belly, 0.0); bl.scale.set(1.0, 0.55, 1.1); add(torso, bl, 0, -0.1, 0.06);
  for (let i = 0; i < 9; i++) { // warts
    const a = i * 2.4, r = 0.28 + (i % 3) * 0.05;
    const w = part(new THREE.SphereGeometry(0.045 + (i % 2) * 0.02, 6, 5), i % 2 ? skinD : skinL, 0.008);
    add(torso, w, Math.sin(a) * r * 1.1, 0.16 + (i % 3) * 0.04, Math.cos(a) * r * 1.0 - 0.05);
  }
  // lotus leaf worn like a hat, with a bud: the "warden"
  const leaf = part(new THREE.CylinderGeometry(0.46, 0.4, 0.035, 12), hx(PAL.jade, PAL.paper, 0.1), 0.014); leaf.rotation.set(0.12, 0, -0.1); add(torso, leaf, 0, 0.33, -0.1);
  const vein = part(new THREE.BoxGeometry(0.62, 0.012, 0.012), skinD, 0); vein.rotation.set(0.12, 0.5, -0.1); add(torso, vein, 0, 0.355, -0.1);
  const bud = part(new THREE.ConeGeometry(0.07, 0.2, 6), hx(PAL.vermilion, PAL.paper, 0.45), 0.01); add(torso, bud, 0.08, 0.46, -0.1);
  // head
  const head = node(); head.position.set(0, 0.1, 0.44); torso.add(head);
  const sk = part(new THREE.SphereGeometry(0.27, 12, 9), skin, 0.018); sk.scale.set(1.25, 0.78, 1.0); head.add(sk);
  const mouth = part(new THREE.BoxGeometry(0.46, 0.018, 0.04), PAL.ink, 0); add(head, mouth, 0, -0.06, 0.22);
  for (const s of [-1, 1]) {
    const eye = part(new THREE.SphereGeometry(0.095, 8, 6), hx(PAL.gold, PAL.paper, 0.35), 0.012); add(head, eye, s * 0.17, 0.16, 0.04);
    const pupil = glowPart(new THREE.BoxGeometry(0.1, 0.045, 0.02), 0xf0d36a, 0.8); add(head, pupil, s * 0.17, 0.165, 0.125);
    const slit = part(new THREE.BoxGeometry(0.012, 0.075, 0.012), PAL.ink, 0); add(head, slit, s * 0.17, 0.165, 0.136);
    const nostril = part(new THREE.SphereGeometry(0.014, 4, 4), PAL.ink, 0); add(head, nostril, s * 0.06, 0.05, 0.25);
  }
  const throat = node(); throat.position.set(0, -0.1, 0.12); head.add(throat);
  throat.add(part(new THREE.SphereGeometry(0.15, 9, 7), sac, 0.012));
  // legs
  const legs: THREE.Bone[] = [];
  const mkLeg = (x: number, z: number, big: boolean) => {
    const g = node(); g.position.set(x, 0.3, z);
    const up = part(new THREE.SphereGeometry(big ? 0.17 : 0.1, 7, 6), skin, 0.012); up.scale.set(0.8, big ? 1.1 : 1.3, 1.1); up.position.y = -0.06; g.add(up);
    const lo = part(new THREE.CylinderGeometry(0.045, 0.04, big ? 0.3 : 0.22, 5), skinD, 0.01); lo.position.set(0, big ? -0.22 : -0.2, big ? -0.04 : 0.02); g.add(lo);
    for (const t of [-1, 0, 1]) { const toe = part(new THREE.SphereGeometry(0.03, 4, 4), skinL, 0); toe.scale.set(1, 0.6, 1.8); add(g, toe, t * 0.05, big ? -0.34 : -0.3, 0.06); }
    torso.add(g); legs.push(g); return g;
  };
  mkLeg(-0.3, 0.3, false); mkLeg(0.3, 0.3, false); mkLeg(-0.36, -0.3, true); mkLeg(0.36, -0.3, true);

  const hnd = bake(root, 0.3);
  const an = new Anim(); const dis = new Dissolve(root);
  const shadow = root.children.find((c) => c.name === "shadow");
  return {
    root, height: 1.0,
    setState(st: AvState) {
      if (st !== "dead" && an.state === "dead") { dis.end(); root.visible = true; if (shadow) shadow.visible = true; body.rotation.set(0, 0, 0); body.position.set(0, 0, 0); hnd.glow.value = 1; }
      an.setState(st);
    },
    update(dt: number) {
      an.tick(dt);
      const t = an.t, m = an.move, k = an.atk;
      if (an.state === "dead") {
        const d = ease(an.dead);
        body.rotation.z = Math.PI * 0.85 * d; body.position.y = 0.34 * d;
        legs.forEach((l, i) => { l.rotation.x = (i < 2 ? -0.9 : 0.7) * d; });
        hnd.glow.value = 1 - d;
        const f = clamp01((an.stateT - 0.8) / 0.9);
        if (f > 0) { dis.begin(); dis.set(1 - f); } else dis.end();
        if (shadow) shadow.visible = f < 0.9;
        root.visible = f < 1;
        return;
      }
      hnd.glow.value = 0.9 + 0.1 * Math.sin(t * 3);
      const hop = Math.abs(Math.sin(t * 5.5)) * m;
      body.position.y = hop * 0.2;
      body.rotation.x = -0.18 * hop * m + 0.1 * Math.sin(t * 1.4) * (1 - m);
      legs.forEach((l, i) => { l.rotation.x = (i < 2 ? -1 : 1) * hop * 0.7; });
      const spit = Math.sin(Math.PI * clamp01((an.stateT % 1.2) / 1.2)) * k;
      torso.scale.set(1, 1 + Math.sin(t * 2.2) * 0.03 + 0.12 * spit, 1 - 0.1 * spit);
      head.rotation.x = -0.45 * spit + 0.05 * Math.sin(t * 0.9);
      throat.scale.setScalar(1 + 0.18 * Math.sin(t * 3.3) + 0.55 * spit);
      body.position.z = -0.14 * spit;
    },
  };
}

// ======================== Stone Hound ========================
export function stoneHound(): Avatar {
  const root = new THREE.Group();
  const body = node(); body.scale.setScalar(1.12); root.add(body);
  root.add(shadowBlob(1.0));
  const stone = hx(PAL.mist, PAL.inkSoft, 0.5), stoneD = hx(PAL.inkSoft, PAL.mist, 0.25), stoneL = hx(PAL.mist, PAL.paper, 0.35), moss = hx(PAL.jade, PAL.inkSoft, 0.5);
  const torso = node(); torso.position.y = 0.66; body.add(torso);
  const tb = part(new THREE.SphereGeometry(0.34, 10, 8), stone, 0.02); tb.scale.set(0.9, 0.86, 1.65); torso.add(tb);
  const chest = part(new THREE.SphereGeometry(0.3, 9, 7), stoneL, 0.014); add(torso, chest, 0, -0.02, 0.32);
  // rock plates along the spine
  for (let i = 0; i < 5; i++) {
    const pl = part(new THREE.BoxGeometry(0.34 - i * 0.03, 0.16 + (i % 2) * 0.05, 0.22), i % 2 ? stoneD : stone, 0.014);
    pl.rotation.set(-0.12 + i * 0.05, 0, (i - 2) * 0.05); add(torso, pl, 0, 0.3 - i * 0.012, -0.34 + i * 0.17);
  }
  const mossP = part(new THREE.SphereGeometry(0.1, 6, 5), moss, 0); mossP.scale.set(1.4, 0.4, 1.2); add(torso, mossP, 0.12, 0.34, -0.08);
  // glowing cracks along the flanks (the "hollow" spark that wakes them)
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const cr = glowPart(new THREE.BoxGeometry(0.03, 0.02, 0.16 + i * 0.03), 0xffa24a, 0.7); cr.rotation.set(0, 0, s * (0.25 + i * 0.2)); add(torso, cr, s * 0.29, 0.02 + i * 0.07, -0.1 + i * 0.12);
  }
  // head
  const head = node(); head.position.set(0, 0.2, 0.62); torso.add(head);
  const skull = part(new THREE.SphereGeometry(0.22, 10, 8), stone, 0.018); skull.scale.set(1.05, 0.92, 1.0); head.add(skull);
  const snout = part(new THREE.BoxGeometry(0.22, 0.17, 0.3), stoneL, 0.014); add(head, snout, 0, -0.05, 0.24);
  const nose = part(new THREE.SphereGeometry(0.04, 6, 5), PAL.ink, 0); add(head, nose, 0, 0.0, 0.4);
  const jaw = part(new THREE.BoxGeometry(0.2, 0.05, 0.26), stoneD, 0.01); add(head, jaw, 0, -0.16, 0.22);
  for (const s of [-1, 1]) {
    const ear = part(new THREE.BoxGeometry(0.08, 0.2, 0.1), stoneD, 0.012); ear.rotation.z = -s * 0.3; add(head, ear, s * 0.15, 0.2, -0.04);
    const eye = glowPart(new THREE.BoxGeometry(0.075, 0.03, 0.02), 0xffb35a, 1); eye.rotation.z = -s * 0.3; add(head, eye, s * 0.1, 0.06, 0.19);
    const fang = part(new THREE.ConeGeometry(0.022, 0.1, 4), PAL.paper, 0); fang.rotation.x = Math.PI; add(head, fang, s * 0.07, -0.14, 0.36);
    const brow = part(new THREE.BoxGeometry(0.12, 0.02, 0.03), stoneD, 0); brow.rotation.z = s * 0.3; add(head, brow, s * 0.1, 0.12, 0.2);
  }
  // legs
  const legs: THREE.Bone[] = [];
  const mkLeg = (x: number, z: number) => {
    const g = node(); g.position.set(x, 0.52, z);
    const up = part(new THREE.CylinderGeometry(0.085, 0.065, 0.36, 6), stone, 0.014); up.position.y = -0.18; g.add(up);
    const lo = part(new THREE.CylinderGeometry(0.06, 0.06, 0.26, 6), stoneD, 0.012); lo.position.y = -0.46; g.add(lo);
    const paw = part(new THREE.BoxGeometry(0.15, 0.09, 0.22), stoneL, 0.01); add(g, paw, 0, -0.6, 0.04);
    torso.add(g); legs.push(g); return g;
  };
  mkLeg(-0.2, 0.36); mkLeg(0.2, 0.36); mkLeg(-0.2, -0.34); mkLeg(0.2, -0.34);
  // tail: three heavy stone segments
  const tailRoot = node(); tailRoot.position.set(0, 0.12, -0.5); torso.add(tailRoot);
  const tailBones: THREE.Bone[] = [];
  let tp: THREE.Object3D = tailRoot;
  for (let j = 0; j < 3; j++) {
    const b = node(); b.position.y = j ? -0.16 : 0; tp.add(b); tailBones.push(b);
    const seg = part(new THREE.SphereGeometry(0.075 - j * 0.012, 6, 5), j % 2 ? stoneD : stone, 0.012); seg.position.set(0, -0.08, -0.04); b.add(seg);
    tp = b;
  }
  tailRoot.rotation.x = 2.2;

  const hnd = bake(root, 0.3);
  const an = new Anim(); const dis = new Dissolve(root);
  const shadow = root.children.find((c) => c.name === "shadow");
  return {
    root, height: 1.4,
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
        body.rotation.z = -1.4 * d; body.position.y = 0.3 * d;
        legs.forEach((l, i) => { l.rotation.x = (i % 2 ? 0.6 : -0.4) * d; });
        head.rotation.x = 0.35 * d;
        hnd.glow.value = 1 - d;
        const f = clamp01((an.stateT - 0.8) / 0.9);
        if (f > 0) { dis.begin(); dis.set(1 - f); } else dis.end();
        if (shadow) shadow.visible = f < 0.9;
        root.visible = f < 1;
        return;
      }
      hnd.glow.value = 0.8 + 0.2 * Math.sin(t * 3.4);
      const ph = t * 9.5;
      body.position.y = Math.abs(Math.sin(ph)) * 0.05 * m + Math.sin(t * 2) * 0.006 * (1 - m);
      body.position.z = 0.5 * Math.sin(Math.PI * pulse) * k;
      body.rotation.x = -0.25 * Math.sin(Math.PI * pulse) * k + 0.04 * m;
      legs.forEach((l, i) => { const s = (i === 0 || i === 3) ? 1 : -1; l.rotation.x = Math.sin(ph) * 0.75 * s * m - (i < 2 ? 0.7 : -0.4) * k * Math.sin(Math.PI * pulse); });
      head.rotation.y = Math.sin(t * 0.7) * 0.18 * (1 - k); head.rotation.x = -0.08 * m + 0.4 * k * Math.sin(Math.PI * pulse);
      tailBones.forEach((b, j) => { b.rotation.x = Math.sin(t * 2.4 - j * 0.8) * 0.18 + 0.15 * m; b.rotation.z = Math.sin(t * 1.8 - j) * 0.15; });
    },
  };
}
