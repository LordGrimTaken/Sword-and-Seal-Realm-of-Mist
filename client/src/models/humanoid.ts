// Stylised procedural humanoids (3 player classes + elder NPC). Chibi-leaning proportions (head ~1/5 of body) with
// painted faces, swaying hair / scarf / sash / sleeve chains, rim-lit toon shading and ink hulls. One skinned mesh each.
import * as THREE from "three";
import type { ClassId } from "../../../shared/protocol";
import { PAL, hex } from "../world/toon";
import { drawSymbol } from "../world/symbols";
import { faceMesh, type FaceStyle } from "./face";
import { Anim, Avatar, AvState, Dissolve, bake, clamp01, ease, node, part, shadowBlob, type BakeHandle } from "./common";

const SKIN = hex(PAL.paper, PAL.vermilion, 0.1).getHex();
const hx = (a: number, b: number, t: number) => hex(a, b, t).getHex();

interface Look {
  robe: number; robe2: number; trim: number; inner: number; sash: number; hair: number; cuff: number;
  hat?: "none" | "guan" | "band" | "douli"; beard?: boolean; scale?: number; sleeveLen?: number; hunch?: number; ribbon?: number;
  cls: ClassId | "npc";
  face?: FaceStyle;
}

interface Rig {
  root: THREE.Group; body: THREE.Bone; torso: THREE.Bone; head: THREE.Bone; skirt: THREE.Bone;
  armL: THREE.Bone; armR: THREE.Bone; legL: THREE.Bone; legR: THREE.Bone;
  chains: { bones: THREE.Bone[]; kind: "hair" | "scarf" | "sash" | "drape"; side: number; seed: number }[];
  props: THREE.Bone; extra: { orbit?: THREE.Group; gourd?: THREE.Bone; staff?: THREE.Bone; tassel?: THREE.Bone; glow?: THREE.Mesh };
}

function lathe(pts: [number, number][], seg = 14): THREE.LatheGeometry {
  return new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg);
}
const add = <T extends THREE.Object3D>(parent: THREE.Object3D, o: T, x = 0, y = 0, z = 0): T => { o.position.set(x, y, z); parent.add(o); return o; };

/** hanging chain of tapered segments (hair tail, scarf, sash). Returns the bones (top to bottom). */
function chain(parent: THREE.Object3D, n: number, seg: number, r0: number, r1: number, color: number, flat = 1, color2?: number, outline = 0.012): THREE.Bone[] {
  const bones: THREE.Bone[] = [];
  let p: THREE.Object3D = parent;
  for (let i = 0; i < n; i++) {
    const b = node(); b.position.set(0, i === 0 ? 0 : -seg, 0); p.add(b); bones.push(b);
    const ra = r0 + (r1 - r0) * (i / n), rb = r0 + (r1 - r0) * ((i + 1) / n);
    const m = part(new THREE.CylinderGeometry(ra, Math.max(0.004, rb), seg * 1.08, 6), color2 && i === n - 1 ? color2 : color, outline);
    m.scale.z = flat; m.position.y = -seg / 2; b.add(m);
    p = b;
  }
  return bones;
}

export function talismanTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas"); cv.width = 64; cv.height = 128;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#e9dfc4"; g.fillRect(0, 0, 64, 128);
  g.strokeStyle = "#c8372d"; g.lineWidth = 3; g.lineCap = "round"; g.lineJoin = "round";
  g.strokeRect(4, 4, 56, 120);
  drawSymbol(g, "charm", 6, 24, 52, "#c8372d"); // abstract seal marks: circles, dotted line, spiral, zigzag (no characters)
  g.fillStyle = "#c8372d"; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(14 + i * 9, 106, 1.8, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** the face itself is a brush-painted texture patch (see face.ts), attached after baking */

function buildRig(L: Look): Rig {
  const root = new THREE.Group();
  const body = node(); root.add(body);
  const props = node(); body.add(props);
  const S = L.scale ?? 1;
  body.scale.setScalar(S);
  root.add(shadowBlob(0.7 * S));
  const chains: Rig["chains"] = [];

  // legs (pivot at hip)
  const mkLeg = (x: number) => {
    const g = node(); g.position.set(x, 0.95, 0);
    const leg = part(new THREE.CylinderGeometry(0.085, 0.07, 0.8, 7), L.inner, 0.018); leg.position.y = -0.42; g.add(leg);
    const shoe = part(new THREE.BoxGeometry(0.17, 0.12, 0.3), PAL.ink, 0.014); shoe.position.set(0, -0.84, 0.06); g.add(shoe);
    const toe = part(new THREE.ConeGeometry(0.06, 0.1, 5), L.trim, 0); toe.rotation.x = Math.PI / 2; toe.position.set(0, -0.8, 0.22); toe.scale.x = 1.2; g.add(toe);
    body.add(g); return g;
  };
  const legL = mkLeg(-0.11), legR = mkLeg(0.11);

  // skirt (robe lower)
  const skirt = node(); skirt.position.y = 1.0; body.add(skirt);
  const sk = part(lathe([[0.47, -0.86], [0.42, -0.55], [0.32, -0.26], [0.23, 0.0]], 18), L.robe, 0.028);
  sk.scale.set(1, 1, 0.84);
  skirt.add(sk);
  const hem = part(lathe([[0.475, -0.86], [0.48, -0.86], [0.46, -0.74], [0.455, -0.74]], 18), L.trim, 0); hem.scale.set(1.0, 1, 0.84); skirt.add(hem);
  const panel = part(new THREE.BoxGeometry(0.22, 0.82, 0.04), L.robe2, 0.0); panel.position.set(0, -0.44, 0.34); panel.rotation.x = -0.1; skirt.add(panel);
  const panelHem = part(new THREE.BoxGeometry(0.23, 0.05, 0.05), L.trim, 0); panelHem.position.set(0, -0.84, 0.375); skirt.add(panelHem);

  // torso
  const torso = node(); torso.position.y = 1.0; body.add(torso);
  const tb = part(lathe([[0.21, 0.0], [0.205, 0.14], [0.24, 0.34], [0.28, 0.45], [0.2, 0.5], [0.07, 0.53]], 16), L.robe, 0.026);
  tb.scale.set(1.05, 1, 0.8); torso.add(tb);
  for (const s of [-1, 1]) {
    const c = part(new THREE.BoxGeometry(0.11, 0.52, 0.03), L.trim, 0.008);
    c.position.set(s * 0.065, 0.28, 0.17); c.rotation.z = -s * 0.42; torso.add(c);
  }
  const collar = part(new THREE.TorusGeometry(0.1, 0.026, 6, 12), L.trim, 0); collar.position.set(0, 0.52, 0.01); collar.rotation.x = Math.PI / 2 - 0.2; torso.add(collar);
  const sash = part(new THREE.TorusGeometry(0.215, 0.04, 6, 18), L.sash, 0.012); sash.position.y = 0.02; sash.rotation.x = Math.PI / 2; sash.scale.set(1.05, 0.82, 1); torso.add(sash);
  const knot = part(new THREE.SphereGeometry(0.055, 6, 5), L.trim, 0); knot.position.set(0.08, 0.02, 0.18); torso.add(knot);
  const tassel = node(); tassel.position.set(0.08, 0.0, 0.19); torso.add(tassel);
  const ts = part(new THREE.BoxGeometry(0.04, 0.32, 0.02), L.trim, 0); ts.position.y = -0.16; tassel.add(ts);
  // sash tails that flutter behind
  const st = node(); st.position.set(-0.05, 0.02, -0.2); torso.add(st);
  chains.push({ bones: chain(st, 3, 0.15, 0.05, 0.035, L.sash, 0.25, L.trim), kind: "sash", side: -1, seed: 1.3 });
  const st2 = node(); st2.position.set(0.07, 0.02, -0.2); torso.add(st2);
  chains.push({ bones: chain(st2, 3, 0.12, 0.045, 0.03, L.sash, 0.25, L.trim), kind: "sash", side: 1, seed: 2.9 });

  // head (scaled up ~1.45x so the head reads at gameplay-camera distance)
  const head = node(); head.position.y = 0.6; head.scale.setScalar(1.45); torso.add(head);
  const neck = part(new THREE.CylinderGeometry(0.05, 0.06, 0.13, 6), SKIN, 0); neck.position.y = -0.08; head.add(neck);
  const skull = part(new THREE.SphereGeometry(0.125, 14, 11), SKIN, 0.016); skull.scale.set(0.95, 1.02, 0.98); skull.position.y = 0.05; head.add(skull);
  for (const s of [-1, 1]) { const ear = part(new THREE.SphereGeometry(0.022, 5, 4), SKIN, 0); ear.scale.set(0.5, 1, 0.8); add(head, ear, s * 0.122, 0.04, 0.0); }

  // hair: cap, bangs, side locks, back mass
  const hairCap = part(new THREE.SphereGeometry(0.137, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), L.hair, 0.016);
  hairCap.position.set(0, 0.066, -0.02); hairCap.rotation.x = -0.62; head.add(hairCap);
  const backHair = part(new THREE.SphereGeometry(0.132, 10, 8), L.hair, 0.014); backHair.scale.set(0.96, 1.0, 0.72); add(head, backHair, 0, 0.0, -0.075);
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) / 2;
    const b = part(new THREE.ConeGeometry(0.03, 0.062 + (i % 2) * 0.02, 5), L.hair, 0.006); b.rotation.set(Math.PI, 0, -a * 0.25); b.scale.z = 0.5;
    add(head, b, a * 0.07, 0.15 - Math.abs(a) * 0.012, 0.1);
  }
  for (const s of [-1, 1]) {
    const lock = part(new THREE.ConeGeometry(0.026, 0.28, 5), L.hair, 0.008); lock.rotation.set(Math.PI, 0, s * 0.06); lock.scale.z = 0.6; add(head, lock, s * 0.118, -0.0, 0.03);
  }

  if (L.hat === "guan") {
    const crown = part(new THREE.CylinderGeometry(0.055, 0.075, 0.14, 8), PAL.gold, 0.012); add(head, crown, 0, 0.27, -0.02);
    const cap = part(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 8), L.hair, 0.01); add(head, cap, 0, 0.2, -0.02);
    const pin = part(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 4), PAL.gold, 0); pin.rotation.z = Math.PI / 2; add(head, pin, 0, 0.28, -0.02);
    const fin = part(new THREE.ConeGeometry(0.05, 0.16, 4), PAL.gold, 0.008); fin.scale.z = 0.3; add(head, fin, 0, 0.38, -0.02);
    // two long back locks
    for (const s of [-1, 1]) { const hb = node(); hb.position.set(s * 0.05, 0.12, -0.12); head.add(hb); chains.push({ bones: chain(hb, 3, 0.16, 0.035, 0.015, L.hair, 0.6), kind: "hair", side: s, seed: s * 1.7 }); }
  } else if (L.hat === "douli") {
    const bun = part(new THREE.SphereGeometry(0.07, 8, 6), L.hair, 0.014); add(head, bun, 0, 0.2, -0.05);
    const pin = part(new THREE.CylinderGeometry(0.01, 0.01, 0.24, 4), PAL.gold, 0); pin.rotation.z = Math.PI / 2; add(head, pin, 0, 0.2, -0.05);
    // soft braid over one shoulder
    const hb = node(); hb.position.set(0.06, 0.05, -0.12); head.add(hb); chains.push({ bones: chain(hb, 5, 0.17, 0.045, 0.02, L.hair, 0.8, PAL.vermilion), kind: "hair", side: 1, seed: 0.7 });
  } else if (L.hat === "band") {
    const band = part(new THREE.TorusGeometry(0.133, 0.015, 5, 14), L.trim, 0); band.rotation.x = Math.PI / 2; add(head, band, 0, 0.12, 0);
    const bun = part(new THREE.SphereGeometry(0.065, 8, 6), L.hair, 0.014); add(head, bun, 0, 0.2, -0.04);
  } else {
    const bun = part(new THREE.SphereGeometry(0.07, 8, 6), L.hair, 0.014); add(head, bun, 0, 0.21, -0.04);
    const pin = part(new THREE.CylinderGeometry(0.01, 0.01, 0.24, 4), L.cls === "npc" ? PAL.paperDark : PAL.gold, 0); pin.rotation.z = Math.PI / 2; add(head, pin, 0, 0.21, -0.04);
  }
  if (L.ribbon !== undefined) {
    // sword cultivator: long ponytail + two ribbon streamers
    const pt = node(); pt.position.set(0, 0.17, -0.1); head.add(pt);
    chains.push({ bones: chain(pt, 5, 0.2, 0.065, 0.02, L.hair, 0.75), kind: "hair", side: 0, seed: 0.3 });
    for (const s of [-1, 1]) {
      const rb = node(); rb.position.set(s * 0.025, 0.19, -0.1); head.add(rb);
      chains.push({ bones: chain(rb, 3, 0.14, 0.028, 0.02, L.ribbon, 0.2), kind: "hair", side: s, seed: s * 2.2 });
    }
  }
  if (L.beard) {
    const beard = part(new THREE.ConeGeometry(0.075, 0.38, 7), PAL.paper, 0.012); beard.position.set(0, -0.16, 0.085); beard.rotation.x = Math.PI; beard.scale.set(1, 1, 0.6); head.add(beard);
    const stache = part(new THREE.BoxGeometry(0.13, 0.022, 0.02), PAL.paper, 0); add(head, stache, 0, 0.004, 0.122);
  }

  // arms: tapered sleeve + wide hanging drape that sways
  const sl = L.sleeveLen ?? 0.66;
  const flare = L.cls === "talisman" ? 0.25 : L.cls === "physician" ? 0.2 : 0.17;
  const mkArm = (s: number) => {
    const g = node(); g.position.set(s * 0.28, 0.44, 0);
    const sleeve = part(new THREE.CylinderGeometry(0.07, flare, sl, 9), L.robe, 0.022); sleeve.position.set(s * 0.02, -sl / 2 + 0.03, 0.0); sleeve.scale.z = 0.8; g.add(sleeve);
    const cuff = part(new THREE.CylinderGeometry(flare + 0.002, flare + 0.008, 0.07, 9), L.cuff, 0.0); cuff.position.set(s * 0.02, -sl + 0.05, 0); cuff.scale.z = 0.8; g.add(cuff);
    const hand = part(new THREE.SphereGeometry(0.055, 7, 6), SKIN, 0.012); hand.position.set(s * 0.02, -sl + 0.01, 0.06); g.add(hand);
    // drape: panel hanging from the cuff (long sleeve end)
    const dr = node(); dr.position.set(s * 0.02, -sl + 0.05, -0.02); g.add(dr);
    const dp = part(new THREE.BoxGeometry(flare * 1.7, 0.34, 0.03), L.robe, 0.012); dp.position.y = -0.17; dr.add(dp);
    const dh = part(new THREE.BoxGeometry(flare * 1.75, 0.05, 0.035), L.cuff, 0); dh.position.y = -0.33; dr.add(dh);
    chains.push({ bones: [dr], kind: "drape", side: s, seed: s * 0.9 });
    g.rotation.z = s * 0.1;
    torso.add(g);
    return g;
  };
  const armL = mkArm(-1), armR = mkArm(1);
  if (L.hunch) { torso.rotation.x = L.hunch; }
  return { root, body, torso, head, skirt, armL, armR, legL, legR, chains, props, extra: {} };
}

// ---- per-class dressing ----
function dressSword(r: Rig, L: Look) {
  const g = node();
  g.position.set(0.0, 0.34, -0.22); g.rotation.set(0, 0, 0.62);
  const scab = part(new THREE.BoxGeometry(0.085, 1.15, 0.045), PAL.inkSoft, 0.016); scab.position.y = -0.12; g.add(scab);
  const band1 = part(new THREE.BoxGeometry(0.1, 0.05, 0.055), PAL.gold, 0.0); band1.position.y = 0.2; g.add(band1);
  const band2 = part(new THREE.BoxGeometry(0.1, 0.05, 0.055), PAL.gold, 0.0); band2.position.y = -0.55; g.add(band2);
  const tip = part(new THREE.ConeGeometry(0.05, 0.12, 5), PAL.gold, 0); tip.rotation.x = Math.PI; tip.position.y = -0.74; g.add(tip);
  const guard = part(new THREE.BoxGeometry(0.24, 0.035, 0.06), PAL.gold, 0.012); guard.position.y = 0.5; g.add(guard);
  const grip = part(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 6), PAL.ink, 0.01); grip.position.y = 0.63; g.add(grip);
  const pom = part(new THREE.SphereGeometry(0.05, 6, 5), PAL.jade, 0.01); pom.position.y = 0.77; g.add(pom);
  const tas = node(); tas.position.y = 0.77; g.add(tas); r.extra.tassel = tas;
  const tm = part(new THREE.BoxGeometry(0.035, 0.4, 0.015), PAL.vermilion, 0); tm.position.set(0, -0.2, 0.03); tas.add(tm);
  r.torso.add(g);
  // red scarf (the sword's silhouette streamer)
  const sc = node(); sc.position.set(0, 0.5, -0.1); r.torso.add(sc);
  const ring = part(new THREE.TorusGeometry(0.13, 0.04, 6, 14), PAL.vermilion, 0.01); ring.rotation.x = Math.PI / 2 - 0.2; ring.position.set(0, 0.5, 0.0); r.torso.add(ring);
  r.chains.push({ bones: chain(sc, 4, 0.2, 0.09, 0.05, PAL.vermilion, 0.2, hx(PAL.vermilion, PAL.ink, 0.3)), kind: "scarf", side: 0, seed: 0.5 });
  // shoulder guards (ink-black pauldrons with gold edge) for a broader, martial silhouette
  for (const s of [-1, 1]) {
    const pl = part(new THREE.SphereGeometry(0.12, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), PAL.inkSoft, 0.016); pl.position.set(s * 0.3, 0.45, 0); pl.scale.set(1.15, 0.8, 1); r.torso.add(pl);
    const pe = part(new THREE.TorusGeometry(0.12, 0.014, 5, 12), PAL.gold, 0); pe.rotation.x = Math.PI / 2; pe.position.set(s * 0.3, 0.44, 0); pe.scale.set(1.15, 1, 1); r.torso.add(pe);
  }
  void L;
}
function dressTalisman(r: Rig) {
  const orbit = new THREE.Group(); orbit.position.y = 0.3; r.torso.add(orbit);
  const tex = talismanTexture();
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const holder = new THREE.Group(); holder.position.set(Math.sin(a) * 0.82, Math.sin(i * 1.9) * 0.1, Math.cos(a) * 0.82); holder.rotation.y = a;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.52), mat); holder.add(p);
    orbit.add(holder);
  }
  r.extra.orbit = orbit;
  const disc = part(new THREE.TorusGeometry(0.085, 0.018, 5, 10), PAL.gold, 0); disc.position.set(0, 0.28, 0.215); r.torso.add(disc);
  const dc = part(new THREE.CylinderGeometry(0.068, 0.068, 0.012, 8), PAL.vermilion, 0); dc.rotation.x = Math.PI / 2; dc.position.set(0, 0.28, 0.21); r.torso.add(dc);
  // long gold-trimmed pibo scarf draped over shoulders, trailing behind
  const sc = node(); sc.position.set(0, 0.48, -0.15); r.torso.add(sc);
  const bar = part(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 6), PAL.gold, 0.008); bar.rotation.z = Math.PI / 2; bar.position.set(0, 0.5, -0.04); r.torso.add(bar);
  r.chains.push({ bones: chain(sc, 4, 0.22, 0.14, 0.1, hx(PAL.jade, PAL.paper, 0.4), 0.15, PAL.gold), kind: "scarf", side: 0, seed: 1.1 });
}
function dressPhysician(r: Rig) {
  const gourd = node(); gourd.position.set(-0.29, 0.0, 0.06); r.torso.add(gourd); r.extra.gourd = gourd;
  const cord = part(new THREE.BoxGeometry(0.014, 0.18, 0.014), PAL.vermilion, 0); cord.position.y = -0.09; gourd.add(cord);
  const gcol = hx(PAL.gold, PAL.vermilion, 0.3);
  const gb = part(new THREE.SphereGeometry(0.12, 9, 7), gcol, 0.016); gb.position.y = -0.3; gourd.add(gb);
  const gt = part(new THREE.SphereGeometry(0.075, 8, 6), gcol, 0.013); gt.position.y = -0.16; gourd.add(gt);
  const cork = part(new THREE.CylinderGeometry(0.02, 0.025, 0.045, 5), PAL.vermilion, 0); cork.position.y = -0.08; gourd.add(cork);
  const needle = node(); needle.position.set(0.26, -0.02, 0.07); needle.rotation.z = -0.5; r.torso.add(needle);
  const nc = part(new THREE.CylinderGeometry(0.04, 0.04, 0.26, 7), PAL.inkSoft, 0.012); needle.add(nc);
  for (const s of [-1, 1]) { const cap = part(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 7), PAL.gold, 0); cap.position.y = s * 0.13; needle.add(cap); }
  const strap = part(new THREE.BoxGeometry(0.045, 0.66, 0.014), PAL.paperDark, 0); strap.position.set(0.02, 0.22, 0.21); strap.rotation.z = 0.7; r.torso.add(strap);
  // big straw douli hat slung on the back + herb basket: unmistakable healer silhouette
  const hat = node(); hat.position.set(0, 0.34, -0.27); hat.rotation.x = -0.5; r.torso.add(hat);
  const cone = part(new THREE.ConeGeometry(0.42, 0.24, 14), hx(PAL.paperDark, PAL.gold, 0.25), 0.016); cone.position.y = 0.0; hat.add(cone);
  const rim = part(new THREE.TorusGeometry(0.42, 0.015, 5, 18), hx(PAL.paperDark, PAL.inkSoft, 0.3), 0); rim.rotation.x = Math.PI / 2; rim.position.y = -0.12; hat.add(rim);
  const cordH = part(new THREE.TorusGeometry(0.13, 0.012, 4, 10), PAL.vermilion, 0); cordH.rotation.x = Math.PI / 2; cordH.position.y = 0.06; hat.add(cordH);
  for (let i = 0; i < 3; i++) { const lf = part(new THREE.ConeGeometry(0.035, 0.2, 4), PAL.jade, 0); lf.position.set((i - 1) * 0.09, -0.02, 0.28); lf.rotation.x = 1.2; hat.add(lf); }
}
function dressNpc(r: Rig) {
  const staff = node(); staff.position.set(0.06, -0.62, 0.06);
  const shaft = part(new THREE.CylinderGeometry(0.028, 0.034, 1.7, 6), hx(PAL.inkSoft, PAL.gold, 0.2), 0.012); shaft.position.y = 0.25; staff.add(shaft);
  const knob = part(new THREE.TorusGeometry(0.09, 0.024, 5, 10), hx(PAL.inkSoft, PAL.gold, 0.2), 0.008); knob.position.y = 1.12; staff.add(knob);
  const gcol = hx(PAL.gold, PAL.vermilion, 0.3);
  const g1 = part(new THREE.SphereGeometry(0.09, 8, 6), gcol, 0.012); g1.position.set(0, 0.88, 0.0); staff.add(g1);
  const g2 = part(new THREE.SphereGeometry(0.06, 8, 6), gcol, 0.01); g2.position.set(0, 1.0, 0.0); staff.add(g2);
  const cord = part(new THREE.BoxGeometry(0.12, 0.012, 0.012), PAL.vermilion, 0); cord.position.set(0, 1.07, 0); staff.add(cord);
  r.armR.add(staff); r.extra.staff = staff;
}

/** Notice Board Keeper: a rolled notice scroll in the right hand, a hanging wooden tag and a vermilion cord. */
function dressKeeper(r: Rig) {
  const prop = node(); prop.position.set(0.04, -0.6, 0.1);
  const wood = hx(PAL.inkSoft, PAL.gold, 0.25);
  const roll = part(new THREE.CylinderGeometry(0.055, 0.055, 0.5, 8), PAL.paper, 0.012); roll.rotation.z = Math.PI / 2; roll.position.set(0, 0.05, 0); prop.add(roll);
  for (const sx of [-1, 1]) {
    const cap = part(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 8), wood, 0.01); cap.rotation.z = Math.PI / 2; cap.position.set(sx * 0.27, 0.05, 0); prop.add(cap);
  }
  const band = part(new THREE.CylinderGeometry(0.062, 0.062, 0.06, 8), PAL.vermilion, 0); band.rotation.z = Math.PI / 2; band.position.set(0, 0.05, 0); prop.add(band);
  const tag = part(new THREE.BoxGeometry(0.07, 0.13, 0.015), wood, 0.008); tag.position.set(0.1, -0.08, 0.02); prop.add(tag);
  r.armR.add(prop);
}

/** Artisan Tao (0.4.0): a smith's hammer in the right hand and a leather apron over the robe. */
function dressArtisan(r: Rig) {
  const prop = node(); prop.position.set(0.04, -0.58, 0.1);
  const wood = hx(PAL.inkSoft, PAL.gold, 0.25), iron = hx(PAL.inkSoft, PAL.mist, 0.3);
  const haft = part(new THREE.CylinderGeometry(0.026, 0.03, 0.5, 6), wood, 0.012); haft.position.y = 0.05; prop.add(haft);
  const hd = part(new THREE.BoxGeometry(0.22, 0.1, 0.1), iron, 0.014); hd.position.set(0, 0.32, 0); prop.add(hd);
  const band = part(new THREE.BoxGeometry(0.05, 0.12, 0.12), PAL.vermilion, 0); band.position.set(0.07, 0.32, 0); prop.add(band);
  r.armR.add(prop);
  const apron = part(new THREE.BoxGeometry(0.34, 0.46, 0.03), hx(PAL.inkSoft, PAL.gold, 0.35), 0.012); apron.position.set(0, 0.22, 0.2); apron.rotation.x = -0.06; r.torso.add(apron);
  const strap = part(new THREE.BoxGeometry(0.05, 0.36, 0.02), hx(PAL.inkSoft, PAL.gold, 0.35), 0); strap.position.set(0, 0.38, 0.16); strap.rotation.x = 0.1; r.torso.add(strap);
}
/** Peddler Hao (0.4.0): a tall wicker pack on the back crammed with bundles, a hanging gourd and a pole over the shoulder. */
function dressPeddler(r: Rig) {
  const wicker = hx(PAL.gold, PAL.paperDark, 0.45), wickerD = hx(PAL.gold, PAL.inkSoft, 0.5);
  const pack = part(new THREE.BoxGeometry(0.46, 0.62, 0.26), wicker, 0.02); pack.position.set(0, 0.34, -0.3); r.torso.add(pack);
  const frame = part(new THREE.BoxGeometry(0.5, 0.05, 0.3), wickerD, 0.01); frame.position.set(0, 0.64, -0.3); r.torso.add(frame);
  for (let i = 0; i < 3; i++) {
    const b = part(new THREE.CylinderGeometry(0.075, 0.075, 0.5, 7), [PAL.vermilion, PAL.jade, hx(PAL.paper, PAL.gold, 0.2)][i], 0.012);
    b.rotation.z = Math.PI / 2; b.position.set((i - 1) * 0.04, 0.78 + i * 0.1, -0.3); r.torso.add(b);
  }
  const pole = part(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 5), wickerD, 0.008); pole.rotation.z = 0.5; pole.position.set(0.05, 0.62, -0.18); r.torso.add(pole);
  const gourd = part(new THREE.SphereGeometry(0.08, 7, 6), hx(PAL.gold, PAL.vermilion, 0.3), 0.01); gourd.position.set(0.32, 0.28, -0.18); r.torso.add(gourd);
  const strap = part(new THREE.BoxGeometry(0.04, 0.5, 0.02), wickerD, 0); strap.position.set(0.1, 0.28, 0.1); strap.rotation.z = 0.12; r.torso.add(strap);
}

// ---- animation ----
type Style = "slash" | "cast" | "heal" | "none";
function animate(r: Rig, a: Anim, style: Style, dt: number, L: Look) {
  const t = a.t;
  const m = a.move, k = a.atk;
  const walk = Math.sin(t * 9.5), walk2 = Math.sin(t * 9.5 + Math.PI);
  const breathe = Math.sin(t * 1.9);
  const bob = Math.abs(walk) * 0.05 * m;
  r.body.position.y = bob + Math.sin(t * 1.9) * 0.004 * (1 - m);
  r.body.rotation.x = 0.1 * m;
  r.legL.rotation.x = walk * 0.75 * m;
  r.legR.rotation.x = walk2 * 0.75 * m;
  r.skirt.rotation.x = walk * 0.12 * m + 0.04 * m;
  r.skirt.scale.set(1 + 0.012 * breathe, 1, 1 + 0.012 * breathe);
  r.torso.scale.y = 1 + 0.014 * breathe;
  r.torso.rotation.y = Math.sin(t * 0.7) * 0.03 * (1 - m);
  r.head.rotation.y = Math.sin(t * 0.6 + 1.0) * 0.12 * (1 - m);
  r.head.rotation.x = Math.sin(t * 0.9) * 0.02;

  let aL = Math.sin(t * 1.3) * 0.05 + walk2 * 0.55 * m;
  let aR = Math.sin(t * 1.3 + 1.2) * 0.05 + walk * 0.55 * m;
  let zL = -0.1 - Math.sin(t * 1.5) * 0.02, zR = 0.1 + Math.sin(t * 1.5) * 0.02;
  if (k > 0.01) {
    const p = (a.stateT % 0.7) / 0.7;
    if (style === "slash") {
      const wind = ease(clamp01(p / 0.28)), strike = ease(clamp01((p - 0.28) / 0.17)), rec = ease(clamp01((p - 0.6) / 0.4));
      const pose = -2.5 * wind * (1 - strike) + 0.35 * strike;
      const poseR = pose * (1 - rec);
      aR = THREE.MathUtils.lerp(aR, poseR, k);
      zR = THREE.MathUtils.lerp(zR, 0.1 + 0.3 * wind * (1 - strike), k);
      aL = THREE.MathUtils.lerp(aL, -0.6 * wind, k);
      r.torso.rotation.y += (-0.4 * wind + 0.8 * strike * (1 - rec)) * k;
      r.body.position.z = 0.3 * Math.sin(Math.PI * clamp01((p - 0.2) / 0.5)) * k;
      r.body.rotation.x += 0.2 * strike * (1 - rec) * k;
    } else if (style === "cast" || style === "heal") {
      const raise = ease(clamp01(p / 0.3)), rel = ease(clamp01((p - 0.35) / 0.2)), back = ease(clamp01((p - 0.7) / 0.3));
      const pitch = style === "cast" ? -1.55 : -1.05;
      const v = (pitch * raise) * (1 - back) + 0.25 * rel * (1 - back);
      aR = THREE.MathUtils.lerp(aR, v, k); aL = THREE.MathUtils.lerp(aL, v * (style === "cast" ? 0.4 : 1.0), k);
      zR = THREE.MathUtils.lerp(zR, 0.2, k); zL = THREE.MathUtils.lerp(zL, -0.2, k);
      r.body.position.z = 0.1 * rel * (1 - back) * k;
      r.torso.rotation.x += -0.1 * raise * k;
    }
  }
  r.armL.rotation.x = aL; r.armR.rotation.x = aR; r.armL.rotation.z = zL; r.armR.rotation.z = zR;
  if (style === "none" && L.cls === "npc") {
    r.armR.rotation.x = -0.25 + Math.sin(t * 0.8) * 0.03; r.armR.rotation.z = 0.12;
    const tap = Math.max(0, Math.sin(t * 0.9)) ** 18;
    r.body.rotation.x += 0.02 * tap;
  }

  // flowing chains: hair / scarf / sash / sleeve drapes. Trailing strength grows with speed and attack lunges.
  const wind = m + 0.6 * k;
  for (const c of r.chains) {
    const ph = c.seed;
    const n = c.bones.length;
    for (let i = 0; i < n; i++) {
      const b = c.bones[i];
      const lag = i * 0.65;
      const sway = Math.sin(t * 2.3 - lag + ph) * (0.07 + 0.05 * i) + Math.sin(t * 4.1 - lag * 1.6 + ph * 2) * 0.03 * (1 + wind);
      if (c.kind === "drape") {
        b.rotation.x = -walk * 0.22 * m * c.side + sway * 0.9 + 0.12 * wind;
        b.rotation.z = c.side * (0.04 + 0.06 * Math.sin(t * 1.9 + ph));
      } else if (c.kind === "scarf") {
        b.rotation.x = (i === 0 ? 0.35 + 0.75 * wind : 0.18 * wind + 0.12) + sway;
        b.rotation.z = Math.sin(t * 1.9 - lag + ph) * 0.1 * (1 + wind);
      } else if (c.kind === "sash") {
        b.rotation.x = (i === 0 ? 0.2 + 0.65 * wind : 0.2 * wind) + sway;
        b.rotation.z = c.side * (0.12 + 0.1 * Math.sin(t * 2.6 - lag + ph)) * (1 + wind);
      } else {
        b.rotation.x = (i === 0 ? 0.14 + 0.5 * wind : 0.1 + 0.16 * wind) + sway;
        b.rotation.z = c.side * (i === 0 ? 0.18 : 0.02) + Math.sin(t * 1.7 - lag + ph) * 0.07 * (1 + wind);
      }
    }
  }
  if (r.extra.tassel) r.extra.tassel.rotation.z = Math.sin(t * 2.4) * 0.12 + 0.1 * m;
  if (r.extra.gourd) { r.extra.gourd.rotation.z = Math.sin(t * 2.0) * 0.05 + walk * 0.1 * m; }
  if (r.extra.orbit) {
    r.extra.orbit.rotation.y += dt * (1.2 + 5.0 * k);
    r.extra.orbit.position.y = 0.3 + Math.sin(t * 2.0) * 0.04;
    r.extra.orbit.children.forEach((c, i) => { c.position.y = Math.sin(t * 2.2 + i * 1.7) * 0.1; });
  }
}

function dying(r: Rig, a: Anim, dis: Dissolve, shadow: THREE.Object3D | undefined, extra: THREE.Object3D | undefined) {
  const k = ease(a.dead);
  r.body.rotation.x = -1.5 * k;
  r.body.rotation.z = 0.2 * k;
  r.body.position.y = 0.18 * k;
  r.body.position.z = -0.2 * k;
  r.armL.rotation.x = -0.4 * k; r.armR.rotation.x = 0.3 * k;
  r.legL.rotation.x = 0.1 * k; r.legR.rotation.x = -0.2 * k;
  const fadeT = clamp01((a.stateT - 0.9) / 1.0);
  if (fadeT > 0) { dis.begin(); dis.set(1 - fadeT); } else dis.end();
  if (shadow) shadow.visible = fadeT < 0.9;
  if (extra) extra.visible = fadeT < 0.3;
  r.root.visible = fadeT < 1;
}

function makeAvatar(r: Rig, style: Style, L: Look, height: number): Avatar {
  const hnd: BakeHandle = bake(r.root, 0.34);
  // brush-painted face: a curved patch riding the head bone (child of the baked mesh so distance-LOD hides it with the body)
  const face = faceMesh((L.face ?? (L.cls === "npc" ? "elder" : L.cls === "sword" ? "stern" : L.cls === "talisman" ? "calm" : "gentle")) as FaceStyle);
  hnd.skinned.add(face);
  const fm = new THREE.Matrix4();
  const syncFace = () => {
    fm.identity();
    for (let o: THREE.Object3D | null = r.head; o && o !== r.root; o = o.parent) { o.updateMatrix(); fm.premultiply(o.matrix); }
    face.matrix.copy(fm); face.matrixWorldNeedsUpdate = true;
  };
  syncFace();
  const a = new Anim();
  const dis = new Dissolve(r.root);
  const shadow = r.root.children.find((c) => c.name === "shadow");
  const orbit = r.extra.orbit;
  return {
    root: r.root,
    height,
    setState(st: AvState) {
      if (st !== "dead" && a.state === "dead") { dis.end(); r.root.visible = true; if (shadow) shadow.visible = true; if (orbit) orbit.visible = true; r.body.rotation.set(0, 0, 0); r.body.position.set(0, 0, 0); }
      a.setState(st);
    },
    update(dt: number) {
      a.tick(dt);
      hnd.glow.value = 1;
      if (a.state === "dead") { dying(r, a, dis, shadow, orbit); syncFace(); return; }
      r.body.rotation.z = 0; r.body.position.z = 0;
      animate(r, a, style, dt, L);
      syncFace();
    },
  };
}

export function buildClass(cls: ClassId): Avatar {
  if (cls === "sword") {
    const L: Look = { robe: hx(PAL.paper, PAL.paperDark, 0.15), robe2: hx(PAL.inkSoft, PAL.ink, 0.2), trim: PAL.inkSoft, inner: PAL.inkSoft, sash: PAL.inkSoft, hair: PAL.ink, cuff: PAL.inkSoft, ribbon: PAL.vermilion, cls };
    const r = buildRig(L); dressSword(r, L);
    return makeAvatar(r, "slash", L, 2.15);
  }
  if (cls === "talisman") {
    const L: Look = { robe: hx(PAL.jade, PAL.ink, 0.45), robe2: hx(PAL.paper, PAL.jade, 0.2), trim: PAL.gold, inner: PAL.inkSoft, sash: PAL.gold, hair: PAL.ink, cuff: PAL.gold, hat: "guan", cls, sleeveLen: 0.7 };
    const r = buildRig(L); dressTalisman(r);
    return makeAvatar(r, "cast", L, 2.3);
  }
  const L: Look = { robe: hx(PAL.jade, PAL.paper, 0.28), robe2: PAL.paper, trim: hx(PAL.paper, PAL.paperDark, 0.2), inner: hx(PAL.jade, PAL.ink, 0.55), sash: hx(PAL.gold, PAL.vermilion, 0.15), hair: hx(PAL.ink, PAL.inkSoft, 0.2), cuff: PAL.paper, hat: "douli", sleeveLen: 0.6, cls };
  const r = buildRig(L); dressPhysician(r);
  return makeAvatar(r, "heal", L, 2.1);
}

export function buildNpc(variant: "elder" | "keeper" | "artisan" | "peddler" = "elder"): Avatar {
  if (variant === "artisan") {
    const A: Look = { robe: hx(PAL.inkSoft, PAL.vermilion, 0.3), robe2: hx(PAL.paperDark, PAL.inkSoft, 0.3), trim: PAL.gold, inner: PAL.inkSoft, sash: PAL.vermilion, hair: PAL.ink, cuff: PAL.gold, hat: "band", scale: 1.0, cls: "npc", face: "stern", sleeveLen: 0.5 };
    const ra = buildRig(A); dressArtisan(ra);
    return makeAvatar(ra, "none", A, 2.05);
  }
  if (variant === "peddler") {
    const H: Look = { robe: hx(PAL.gold, PAL.paperDark, 0.5), robe2: hx(PAL.paper, PAL.gold, 0.3), trim: PAL.vermilion, inner: hx(PAL.inkSoft, PAL.gold, 0.2), sash: PAL.jade, hair: PAL.ink, cuff: hx(PAL.paper, PAL.gold, 0.3), hat: "douli", scale: 0.95, hunch: 0.08, cls: "npc", face: "calm", sleeveLen: 0.55 };
    const rh = buildRig(H); dressPeddler(rh);
    return makeAvatar(rh, "none", H, 2.1);
  }
  if (variant === "keeper") {
    const K: Look = { robe: hx(PAL.ink, PAL.jade, 0.16), robe2: PAL.jade, trim: PAL.jade, inner: PAL.ink, sash: PAL.vermilion, hair: PAL.ink, cuff: PAL.jade, hat: "band", scale: 1, cls: "npc", face: "calm", sleeveLen: 0.62 };
    const rk = buildRig(K); dressKeeper(rk);
    return makeAvatar(rk, "none", K, 2.05);
  }
  const L: Look = { robe: hx(PAL.paperDark, PAL.mist, 0.25), robe2: hx(PAL.paper, PAL.paperDark, 0.2), trim: hx(PAL.vermilion, PAL.ink, 0.2), inner: PAL.inkSoft, sash: hx(PAL.vermilion, PAL.ink, 0.15), hair: PAL.paper, cuff: hx(PAL.inkSoft, PAL.mist, 0.3), beard: true, scale: 0.93, hunch: 0.1, cls: "npc", sleeveLen: 0.6 };
  const r = buildRig(L); dressNpc(r);
  return makeAvatar(r, "none", L, 1.95);
}
