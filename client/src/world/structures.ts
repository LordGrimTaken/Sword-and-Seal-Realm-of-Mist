// Architecture of Cloudmist Valley: paifang, pagoda, bridge, lanterns, ruined shrine, boss-arena landmarks.
import * as THREE from "three";
import { Batch } from "./batch";
import { box, cone, cyl, Local, localVC, roofGeom, roofTexture, sph } from "./geo";
import { rockChunk, rockCluster } from "./rocks";
import { mulberry32 } from "./noise";
import { BRIDGE, PLAZA, bridgeY, pathX, terrainHeight } from "./terrain";
import { PAL, hex, toonGradient } from "./toon";
import { BANNER_CELL, Signage } from "./signage";
import { poiMarkers } from "./poi";

const C = {
  wood: hex(PAL.vermilion, PAL.ink, 0.3),
  woodWorn: hex(PAL.vermilion, PAL.mist, 0.4),
  dark: hex(PAL.inkSoft),
  darker: hex(PAL.inkSoft, PAL.vermilion, 0.22),
  stone: hex(PAL.paperDark, PAL.mist, 0.35),
  stoneD: hex(PAL.paperDark, PAL.inkSoft, 0.35),
  stoneL: hex(PAL.paper, PAL.mist, 0.25),
  wall: hex(PAL.paper, PAL.paperDark, 0.35),
  tile: hex(PAL.inkSoft, PAL.mist, 0.38),
  tileWorn: hex(PAL.inkSoft, PAL.mist, 0.55),
  gold: hex(PAL.gold),
  glow: hex(0xf2c06a),
  redGlow: hex(PAL.vermilion, PAL.gold, 0.22),
  moss: hex(PAL.jade, PAL.paperDark, 0.35),
  mossD: hex(PAL.jade, PAL.inkSoft, 0.45),
  inkPool: hex(PAL.ink, PAL.jade, 0.22),
  inkRipple: hex(PAL.mistLight, PAL.ink, 0.32),
};
export const COLORS = C;

export interface StructureOut {
  group: THREE.Group;
  lanterns: THREE.Vector3[];       // glowing lantern world positions (for halos / lights)
  smokes: THREE.Vector3[];         // incense smoke sources (world positions)
  rays: { x: number; y: number; z: number }[]; // god-ray anchors
  update(t: number): void;
}

export function structureMaterials(): Record<string, THREE.Material> {
  const roofMap = roofTexture();
  return {
    solid: new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() }),
    roof: new THREE.MeshToonMaterial({ vertexColors: true, map: roofMap, gradientMap: toonGradient(), side: THREE.DoubleSide }),
    cloth: new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient(), side: THREE.DoubleSide }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
  };
}

let SG: Signage | null = null;
let lanternCount = 0;

function redLantern(L: Local, x: number, y: number, z: number, s = 1) {
  if (SG) {
    const c = Math.cos(L.yaw), sn = Math.sin(L.yaw);
    SG.lanternSign(L.ox + x * c + z * sn, L.oy + y, L.oz - x * sn + z * c, 0.43 * s, (lanternCount++ % 3) as 0 | 1 | 2, L.yaw);
  }
  L.add(sph(0.42 * s, 12, 8), "glow", { p: [x, y, z], s: [1, 0.82, 1] }, C.redGlow);
  for (const k of [-0.2, 0, 0.2]) L.add(cyl(0.425 * s * (1 - Math.abs(k) * 0.55), 0.425 * s * (1 - Math.abs(k) * 0.55), 0.035 * s, 10), "solid", { p: [x, y + k * s * 1.3, z] }, C.darker);
  L.add(cyl(0.2 * s, 0.26 * s, 0.14 * s, 8), "solid", { p: [x, y + 0.36 * s, z] }, C.gold);
  L.add(cyl(0.2 * s, 0.14 * s, 0.14 * s, 8), "solid", { p: [x, y - 0.36 * s, z] }, C.gold);
}

/** stepped bracket cluster (dougong), arms projecting along x and z */
function dougong(L: Local, x: number, y: number, z: number, s: number, tiers: number) {
  const jade = C.mossD, red = C.wood;
  L.add(box(0.36 * s, 0.26 * s, 0.36 * s), "solid", { p: [x, y, z] }, jade);
  for (let t = 0; t < tiers; t++) {
    const yy = y + (0.2 + t * 0.26) * s, w = (0.9 + t * 0.55) * s;
    L.add(box(w, 0.14 * s, 0.34 * s), "solid", { p: [x, yy, z] }, t % 2 ? red : jade);
    L.add(box(0.3 * s, 0.14 * s, w * 0.9), "solid", { p: [x, yy + 0.02 * s, z] }, t % 2 ? jade : red);
    L.add(box(0.2 * s, 0.14 * s, 0.2 * s), "solid", { p: [x + w * 0.42, yy + 0.14 * s, z] }, C.gold);
    L.add(box(0.2 * s, 0.14 * s, 0.2 * s), "solid", { p: [x - w * 0.42, yy + 0.14 * s, z] }, C.gold);
  }
}

/** ridge-end dragon-fish ornament (chiwen): a curled spine, tail hook and fin spikes */
function chiwen(L: Local, x: number, y: number, z: number, side: number, s: number) {
  L.add(box(0.55 * s, 0.5 * s, 0.7 * s), "solid", { p: [x, y + 0.1 * s, z] }, C.tile, true);
  L.add(cone(0.3 * s, 1.3 * s, 6), "solid", { p: [x - side * 0.05 * s, y + 0.9 * s, z], r: [0, 0, side * 0.12] }, C.gold, true);
  L.add(new THREE.TorusGeometry(0.46 * s, 0.1 * s, 5, 10, Math.PI * 1.25), "solid", { p: [x - side * 0.52 * s, y + 1.45 * s, z], r: [0, 0, side > 0 ? -0.2 : Math.PI + 0.2 - Math.PI * 1.25 + Math.PI * 1.25 - 0.4], s: [1, 1, 1] }, C.gold);
  for (let k = 0; k < 3; k++) L.add(cone(0.09 * s, 0.34 * s, 4), "solid", { p: [x + side * 0.12 * s, y + (0.5 + k * 0.34) * s, z], r: [0, 0, side * (0.9 + k * 0.1)] }, C.gold);
  L.add(sph(0.1 * s, 6, 5), "solid", { p: [x - side * 0.86 * s, y + 1.28 * s, z] }, C.redGlow);
}

// ---------------- paifang gate ----------------
function paifang(b: Batch, x: number, z: number, group: THREE.Group, lanterns: THREE.Vector3[]) {
  const y = terrainHeight(x, z);
  const L = new Local(b, x, y, z, 0);
  const xs = [-9, -3, 3, 9];
  for (const px of xs) {
    L.add(box(1.5, 0.7, 1.5), "solid", { p: [px, 0.35, 0] }, C.stone, true);
    L.add(cyl(0.4, 0.46, 6.4, 10), "solid", { p: [px, 3.9, 0] }, C.wood, true);
    L.add(box(0.95, 2.4, 2.4), "solid", { p: [px, 1.2 + 0.2, 0] }, C.stone, true);   // stone drum buttress
    L.add(cyl(0.5, 0.5, 0.18, 10), "solid", { p: [px, 6.95, 0] }, C.gold);
  }
  // beams
  L.add(box(19.4, 0.55, 0.8), "solid", { p: [0, 4.75, 0] }, C.darker, true);
  L.add(box(19.8, 0.5, 0.35), "solid", { p: [0, 4.35, 0] }, C.gold);
  L.add(box(19.6, 0.8, 1.0), "solid", { p: [0, 6.55, 0] }, C.wood, true);
  L.add(box(19.8, 0.14, 1.1), "solid", { p: [0, 6.2, 0] }, C.gold);
  L.add(box(6.2, 1.9, 0.4), "solid", { p: [0, 5.55, 0] }, C.darker, true);
  // brackets (dougong): stepped, flared, painted jade/vermilion under the great roof
  for (let i = -9; i <= 9.01; i += 1.5) dougong(L, i, 7.0, 0, 1.0, 2);
  for (const sx of [-9, 9]) for (let i = -3.6; i <= 3.61; i += 1.8) dougong(L, sx + i, 5.9, 0, 0.8, 1);
  // roofs
  L.add(roofGeom(6.8, 3.1, 1.9, 1.5, false, 7), "roof", { p: [0, 7.45, 0] }, C.tile, true);
  L.add(roofGeom(5.0, 2.5, 1.3, 1.1, false, 5), "roof", { p: [-9, 6.4, 0] }, C.tile, true);
  L.add(roofGeom(5.0, 2.5, 1.3, 1.1, false, 5), "roof", { p: [9, 6.4, 0] }, C.tile, true);
  // eave-end roundels (tile ends) following the upturned eave line
  for (let i = -6.4; i <= 6.41; i += 0.8) {
    const u = i / 6.8, ey = 7.45 + 1.5 * (0.55 + 0.9 * Math.pow(Math.abs(u), 6)) - 0.12;
    for (const sz of [-1, 1]) L.add(cyl(0.2, 0.2, 0.1, 8), "solid", { p: [i, ey, sz * 3.12], r: [Math.PI / 2, 0, 0] }, C.gold);
  }
  for (const cx of [-9, 9]) for (let i = -4.4; i <= 4.41; i += 1.1) {
    const u = i / 5.0, ey = 6.4 + 1.1 * (0.55 + 0.9 * Math.pow(Math.abs(u), 6)) - 0.1;
    for (const sz of [-1, 1]) L.add(cyl(0.15, 0.15, 0.09, 8), "solid", { p: [cx + i, ey, sz * 2.52], r: [Math.PI / 2, 0, 0] }, C.gold);
  }
  // ridge caps + chiwen ridge-end dragons + central jewel
  L.add(box(13.4, 0.28, 0.5), "solid", { p: [0, 9.45, 0] }, C.dark, true);
  for (let i = -6.2; i <= 6.21; i += 0.62) L.add(cyl(0.2, 0.2, 0.22, 8), "solid", { p: [i, 9.66, 0], r: [0, 0, Math.PI / 2] }, C.tile);
  for (const s of [-1, 1]) {
    chiwen(L, s * 6.75, 10.7, 0, s, 1.0);
    chiwen(L, 9 + s * 4.8, 8.45 + 0.35, 0, s, 0.7);
  }
  L.add(cyl(0.12, 0.2, 0.5, 8), "solid", { p: [0, 9.85, 0] }, C.gold);
  L.add(sph(0.3, 10, 8), "solid", { p: [0, 10.35, 0], s: [1, 1.2, 1] }, C.gold);
  L.add(cone(0.14, 0.5, 6), "solid", { p: [0, 10.85, 0] }, C.gold);
  // hanging lanterns
  for (const lx of [-6, 6, -1.6, 1.6]) {
    redLantern(L, lx, 3.9, 0.75);
    L.add(box(0.06, 0.6, 0.06), "solid", { p: [lx, 3.25, 0.75] }, C.gold);
    lanterns.push(new THREE.Vector3(x + lx, y + 3.9, z + 0.75));
    redLantern(L, lx, 3.9, -0.75);
    lanterns.push(new THREE.Vector3(x + lx, y + 3.9, z - 0.75));
  }
  // ---- signage: JIUZHOU plaque (both faces, each reads correctly from its own side), couplets, banners ----
  if (SG) {
    SG.board("plaque", x, y + 5.58, z, 5.1, 1.53, 0, { off: 0.56 });
    SG.board("coupletL", x - 3, y + 3.75, z, 0.9, 1.8, 0, { off: 0.5 });
    SG.board("coupletR", x + 3, y + 3.75, z, 0.9, 1.8, 0, { off: 0.5 });
    for (const bx of [-7.4, 7.4, -4.6, 4.6]) {
      const cell = Math.abs(bx) > 6 ? BANNER_CELL.cloud : BANNER_CELL.fu;
      SG.banner(x + bx, y + 4.45, z, 1.15, 3.1, 0, cell);
    }
  }
  // guardian lions on plinths
  for (const sx of [-1, 1]) {
    const lx = sx * 5.6, lz = -4.2;
    L.add(box(1.6, 0.9, 1.6), "solid", { p: [lx, 0.45, lz] }, C.stoneD, true);
    L.add(box(0.9, 0.8, 1.2), "solid", { p: [lx, 1.3, lz] }, C.stone, true);
    L.add(sph(0.5, 8, 6), "solid", { p: [lx, 2.0, lz + 0.15], s: [1, 0.95, 1] }, C.stone, true);
    L.add(sph(0.28, 6, 5), "solid", { p: [lx, 1.75, lz + 0.55] }, C.stoneL);
    for (const k of [-1, 1]) L.add(sph(0.18, 6, 4), "solid", { p: [lx + k * 0.3, 2.45, lz + 0.1] }, C.stone);
  }
}


// ---------------- roadside steles: Bamboo Grove and Fox Hills place names beside the lantern path ----------------
function roadsideSteles(b: Batch) {
  const one = (bx: number, bz: number, yaw: number, key: "steleC" | "steleD") => {
    const gy = terrainHeight(bx, bz), L = new Local(b, bx, gy, bz, yaw);
    L.add(box(1.5, 0.45, 0.9), "solid", { p: [0, 0.22, 0] }, C.stoneD, true);
    L.add(box(1.2, 2.7, 0.4), "solid", { p: [0, 1.8, 0] }, C.stone, true);
    L.add(roofGeom(0.95, 0.5, 0.3, 0.12, false, 2, 4, 0.1), "roof", { p: [0, 3.15, 0] }, C.tile, true);
    L.add(sph(0.12, 6, 5), "solid", { p: [0, 3.62, 0] }, C.gold);
    if (SG) SG.board(key, bx, gy + 1.82, bz, 1.04, 2.3, yaw, { off: 0.22 });
  };
  const zg = 6, zf = 16;
  one(pathX(zg) - 5.6, zg, Math.PI / 2 - 0.5, "steleC");
  one(pathX(zf) + 5.6, zf, -Math.PI / 2 + 0.5, "steleD");
}

// ---------------- pagoda ----------------
function pagoda(b: Batch, x: number, z: number, lanterns: THREE.Vector3[]) {
  const y = terrainHeight(x, z);
  const L = new Local(b, x, y, z, 0.35);
  L.add(box(16, 0.7, 16), "solid", { p: [0, 0.35, 0] }, C.stoneD, true);
  L.add(box(13.4, 0.7, 13.4), "solid", { p: [0, 1.05, 0] }, C.stone, true);
  for (let i = 0; i < 4; i++) L.add(box(5 - i * 0.3, 0.3, 1.0), "solid", { p: [0, 0.15 + i * 0.3, 8.8 - i * 0.6] }, C.stone);
  let yy = 1.4;
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const w = 6.6 - i * 0.85, hgt = 2.7;
    L.add(box(w - 0.6, hgt, w - 0.6), "solid", { p: [0, yy + hgt / 2, 0] }, C.wall, true);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      L.add(cyl(0.24, 0.26, hgt, 8), "solid", { p: [sx * (w / 2 - 0.1), yy + hgt / 2, sz * (w / 2 - 0.1)] }, C.wood, true);
    }
    L.add(box(w + 0.1, 0.22, w + 0.1), "solid", { p: [0, yy + hgt - 0.1, 0] }, C.darker);
    // windows / doors on four faces
    for (let f = 0; f < 4; f++) {
      const a = f * Math.PI / 2;
      L.add(box(w * 0.26, hgt * 0.55, 0.12), "solid", { p: [Math.sin(a) * (w / 2 - 0.28), yy + hgt * 0.5, Math.cos(a) * (w / 2 - 0.28)], r: [0, a, 0] }, C.darker);
    }
    const eave = w / 2 + 1.9;
    L.add(roofGeom(eave, eave, 1.35 + (tiers - i) * 0.05, 1.5, true, 5), "roof", { p: [0, yy + hgt, 0] }, C.tile, true);
    // dougong brackets under the eaves on all four faces
    for (let f = 0; f < 4; f++) {
      const a = f * Math.PI / 2;
      for (let k = -1; k <= 1; k++) {
        const off = k * w * 0.27;
        dougong(L, Math.sin(a) * (w / 2 - 0.05) + Math.cos(a) * off, yy + hgt - 0.62, Math.cos(a) * (w / 2 - 0.05) - Math.sin(a) * off, 0.62, 1);
      }
    }
    // eave-end roundels on the front and right faces
    for (let k = -3; k <= 3; k++) { const e = k * eave * 0.2; for (const [ax, az] of [[e, eave * 0.93], [eave * 0.93, e]]) L.add(cyl(0.14, 0.14, 0.08, 7), "solid", { p: [ax, yy + hgt + 0.55 * Math.pow(Math.abs(k) / 3, 2) * 1.5 + 0.12, az] }, C.gold); }
    // corner ornaments
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const cx = sx * eave * 0.97, cz = sz * eave * 0.97;
      if (i < 3) {
        L.add(cyl(0.2, 0.2, 0.42, 6), "glow", { p: [cx, yy + hgt + 0.6, cz] }, C.redGlow);
        lanterns.push(new THREE.Vector3(x + (cx * Math.cos(0.35) + cz * Math.sin(0.35)), y + yy + hgt + 0.6, z + (-cx * Math.sin(0.35) + cz * Math.cos(0.35))));
      } else L.add(cone(0.14, 0.4, 5), "solid", { p: [cx, yy + hgt + 0.7, cz], r: [Math.PI, 0, 0] }, C.gold);
    }
    yy += hgt + 1.2;
  }
  if (SG) {
    const c = Math.cos(0.35), sn = Math.sin(0.35);
    const W = (px: number, pz: number): [number, number] => [x + px * c + pz * sn, z - px * sn + pz * c];
    let [wx, wz] = W(0, 3.14);
    SG.board("pagoda", wx, y + 3.0, wz, 4.6, 1.65, 0.35, { both: false, off: 0.02 });
    [wx, wz] = W(3.14, 0);
    SG.board("pagoda", wx, y + 3.0, wz, 4.6, 1.65, 0.35 + Math.PI / 2, { both: false, off: 0.02 });
    for (const sx of [-1, 1]) {
      const [px, pz] = W(sx * 2.6, 9.0);
      L.add(cyl(0.08, 0.1, 6.6, 6), "solid", { p: [sx * 3.4, 3.2 + 1.0, 9.0] }, C.darker, true);
      L.add(box(1.7, 0.08, 0.08), "solid", { p: [sx * 2.6, 7.0, 9.0] }, C.gold);
      L.add(sph(0.14, 6, 5), "solid", { p: [sx * 3.4, 7.55, 9.0] }, C.gold);
      SG.banner(px, y + 6.95, pz, 1.2, 3.6, 0.35, sx < 0 ? BANNER_CELL.jiuzhou : BANNER_CELL.cloud);
    }
  }
  L.add(cyl(0.12, 0.2, 4.6, 6), "solid", { p: [0, yy + 2.0, 0] }, C.gold);
  for (let k = 0; k < 5; k++) L.add(cyl(0.7 - k * 0.1, 0.7 - k * 0.1, 0.12, 10), "solid", { p: [0, yy + 0.4 + k * 0.6, 0] }, C.gold);
  L.add(sph(0.3, 8, 6), "solid", { p: [0, yy + 4.4, 0] }, C.gold);
}

// ---------------- stone lantern (path) ----------------
function stoneLantern(L: Local, lanterns: THREE.Vector3[], lit = true, tilt = 0) {
  L.add(box(0.8, 0.28, 0.8), "solid", { p: [0, 0.14, 0], r: [tilt, 0, 0] }, C.stoneD, true);
  L.add(cyl(0.13, 0.17, 1.05, 6), "solid", { p: [0, 0.8, 0], r: [tilt, 0, 0] }, C.stone, true);
  L.add(cyl(0.34, 0.2, 0.2, 8), "solid", { p: [0, 1.4, 0], r: [tilt, 0, 0] }, C.stone, true);
  L.add(box(0.46, 0.46, 0.46), lit ? "glow" : "solid", { p: [0, 1.76, 0], r: [tilt, 0, 0] }, lit ? C.glow : C.darker);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    L.add(box(0.05, 0.5, 0.05), "solid", { p: [Math.sin(a) * 0.24, 1.76, Math.cos(a) * 0.24], r: [tilt, 0, 0] }, C.darker);
  }
  L.add(roofGeom(0.55, 0.55, 0.38, 0.14, true, 2, 4, 0.1), "roof", { p: [0, 2.0, 0], r: [tilt, 0, 0] }, C.tile, true);
  L.add(sph(0.1, 6, 4), "solid", { p: [0, 2.45, 0] }, C.gold);
  if (lit) lanterns.push(new THREE.Vector3(L.ox, L.oy + 1.8, L.oz));
}

function pathLanterns(b: Batch, lanterns: THREE.Vector3[]) {
  // plaza ring + both sides of path to the shrine
  const place = (x: number, z: number) => {
    stoneLantern(new Local(b, x, terrainHeight(x, z), z, Math.atan2(pathX(z + 1) - pathX(z - 1), 2) * 0.5), lanterns);
  };
  for (let z = -62; z < -22; z += 9) { place(-4.6, z); place(4.6, z); }
  for (let z = -8; z < 78; z += 10) { const px = pathX(z); place(px - 4.0, z); place(px + 4.0, z); }
  // plaza edge lanterns
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2 + 0.2;
    const x = PLAZA.x + Math.sin(a) * (PLAZA.r - 1.2), z = PLAZA.z + Math.cos(a) * (PLAZA.r - 1.2);
    if (Math.abs(a - Math.PI) < 0.2) continue;
    place(x, z);
  }
}

// ---------------- bridge ----------------
function bridge(b: Batch, lanterns: THREE.Vector3[]) {
  const H = BRIDGE.half, W = BRIDGE.width * 2;
  // Lotus Pond stele at the plaza-side bridgehead
  {
    const bx = 4.6, bz = BRIDGE.zc - H - 2.2, gy = terrainHeight(bx, bz);
    b.add(box(1.5, 0.45, 0.9), "solid", { p: [bx, gy + 0.22, bz] }, C.stoneD, true);
    b.add(box(1.2, 2.7, 0.4), "solid", { p: [bx, gy + 1.8, bz] }, C.stone, true);
    b.add(roofGeom(0.95, 0.5, 0.3, 0.12, false, 2, 4, 0.1), "roof", { p: [bx, gy + 3.15, bz] }, C.tile, true);
    b.add(sph(0.12, 6, 5), "solid", { p: [bx, gy + 3.62, bz] }, C.gold);
    if (SG) SG.board("steleA", bx, gy + 1.82, bz, 1.04, 2.3, 0, { off: 0.22 });
  }
  const sh = new THREE.Shape();
  sh.moveTo(-H, -3.2);
  const N = 18;
  for (let i = 0; i <= N; i++) { const z = -H + (2 * H * i) / N; sh.lineTo(z, bridgeY(BRIDGE.zc + z)); }
  sh.lineTo(H, -3.2);
  sh.lineTo(11.2, -3.2);
  sh.absellipse(0, -3.2, 11.2, 5.5, 0, Math.PI, false);
  sh.lineTo(-H, -3.2);
  const eg = new THREE.ExtrudeGeometry(sh, { depth: W, bevelEnabled: false, curveSegments: 18 });
  eg.translate(0, 0, -W / 2);
  eg.rotateY(-Math.PI / 2);
  eg.translate(0, 0, BRIDGE.zc);
  b.add(eg, "solid", {}, C.stone, true);
  // parapets
  const step = 2.0;
  for (const sx of [-1, 1]) {
    for (let z = -H; z < H - 0.5; z += step) {
      const z0 = BRIDGE.zc + z, z1 = z0 + step;
      const ym = (bridgeY(z0) + bridgeY(z1)) / 2 + 0.45;
      const slope = (bridgeY(z1) - bridgeY(z0)) / step;
      b.add(box(0.42, 0.75, step * 1.03), "solid", { p: [sx * (BRIDGE.width - 0.25), ym, z0 + step / 2], r: [-Math.atan(slope), 0, 0] }, C.stoneL, true);
    }
    for (let z = -H + 1; z <= H; z += 6) {
      const zz = BRIDGE.zc + z, yy = bridgeY(zz);
      b.add(box(0.62, 1.25, 0.62), "solid", { p: [sx * (BRIDGE.width - 0.25), yy + 0.62, zz] }, C.stone, true);
      b.add(sph(0.3, 8, 6), "solid", { p: [sx * (BRIDGE.width - 0.25), yy + 1.45, zz] }, C.stoneL);
      if (Math.abs(z) < 14) {
        redLantern(new Local(b, 0, 0, 0, 0), sx * (BRIDGE.width - 0.25), yy + 1.95, zz, 0.7);
        lanterns.push(new THREE.Vector3(sx * (BRIDGE.width - 0.25), yy + 1.95, zz));
      }
    }
  }
}

/** long offering table: cloth runner, peaches, bowls, twin candles and joss sticks */
function offeringTable(L: Local, x: number, y: number, z: number) {
  L.add(box(2.2, 0.14, 0.9), "solid", { p: [x, y + 0.95, z] }, C.wood, true);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) L.add(box(0.14, 0.9, 0.14), "solid", { p: [x + sx * 0.95, y + 0.45, z + sz * 0.34] }, C.darker);
  L.add(box(1.9, 0.03, 0.7), "cloth", { p: [x, y + 1.04, z] }, C.redGlow);
  const pink = hex(PAL.paper, PAL.vermilion, 0.35);
  for (let i = -2; i <= 2; i++) {
    const px = x + i * 0.3;
    L.add(cyl(0.2, 0.12, 0.12, 8), "solid", { p: [px, y + 1.12, z + 0.12] }, C.gold);
    L.add(sph(0.12, 8, 6), "solid", { p: [px, y + 1.27, z + 0.12] }, i % 2 ? pink : C.gold);
  }
  for (const sx of [-1, 1]) {
    L.add(cyl(0.05, 0.06, 0.4, 6), "solid", { p: [x + sx * 0.85, y + 1.25, z - 0.1] }, C.stoneL);
    L.add(cone(0.05, 0.16, 5), "glow", { p: [x + sx * 0.85, y + 1.53, z - 0.1] }, C.glow);
  }
  L.add(cyl(0.18, 0.2, 0.1, 8), "solid", { p: [x, y + 1.11, z - 0.2] }, C.darker);
  for (let k = -1; k <= 1; k++) L.add(cyl(0.012, 0.012, 0.42, 4), "solid", { p: [x + k * 0.05, y + 1.38, z - 0.2] }, C.gold);
}

/** bronze tripod ding with ears, ring handles, ember glow */
function incenseBurner(L: Local, x: number, y: number, z: number, smokes: THREE.Vector3[], top: number, s = 1) {
  const bronze = hex(PAL.gold, PAL.inkSoft, 0.62);
  L.add(box(1.9 * s, 0.3 * s, 1.9 * s), "solid", { p: [x, y + 0.15 * s, z] }, C.stoneD, true);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5;
    L.add(cyl(0.16 * s, 0.1 * s, 0.9 * s, 6), "solid", { p: [x + Math.sin(a) * 0.55 * s, y + 0.75 * s, z + Math.cos(a) * 0.55 * s], r: [Math.cos(a) * 0.16, 0, -Math.sin(a) * 0.16] }, bronze, true);
  }
  L.add(sph(0.85 * s, 12, 8), "solid", { p: [x, y + 1.5 * s, z], s: [1, 0.72, 1] }, bronze, true);
  L.add(cyl(0.9 * s, 0.82 * s, 0.14 * s, 12), "solid", { p: [x, y + 1.98 * s, z] }, C.gold);
  L.add(cyl(0.78 * s, 0.78 * s, 0.05 * s, 12), "glow", { p: [x, y + 2.0 * s, z] }, hex(0xe8553f, PAL.gold, 0.3));
  for (const sx of [-1, 1]) L.add(new THREE.TorusGeometry(0.28 * s, 0.06 * s, 5, 10), "solid", { p: [x + sx * 0.95 * s, y + 2.15 * s, z], r: [0, Math.PI / 2, 0] }, C.gold);
  for (let k = -2; k <= 2; k++) L.add(cyl(0.02 * s, 0.02 * s, 0.7 * s, 4), "solid", { p: [x + k * 0.22 * s, y + 2.35 * s, z + (k % 2) * 0.12 * s], r: [0, 0, k * 0.05] }, C.woodWorn);
  smokes.push(new THREE.Vector3(L.ox + x, L.oy + y + 2.5 * s, L.oz + z));
}

// ---------------- ruined shrine ----------------
function shrine(b: Batch, lanterns: THREE.Vector3[], group: THREE.Group, smokes: THREE.Vector3[], rays: { x: number; y: number; z: number }[]) {
  const rnd = mulberry32(99);
  const top = terrainHeight(0, 86);
  const L = new Local(b, 0, top, 0, 0);
  // hall platform + steps
  L.add(box(20, 1.0, 10), "solid", { p: [0, 0.5, 95.5] }, C.stoneD, true);
  for (let i = 0; i < 4; i++) L.add(box(7 - i * 0.2, 0.25 * (i + 1), 0.8), "solid", { p: [0, 0.125 * (i + 1), 88.2 + i * 0.75] }, C.stone);
  // pillars (some broken)
  const px = [-8, -4.8, -1.6, 1.6, 4.8, 8];
  const hs = [5.6, 5.6, 5.6, 2.1, 5.6, 3.4];
  px.forEach((x, i) => {
    L.add(cyl(0.42, 0.5, hs[i], 9), "solid", { p: [x, 1.0 + hs[i] / 2, 92.6] }, i === 3 || i === 5 ? C.woodWorn : C.wood, true);
    L.add(box(1.1, 0.5, 1.1), "solid", { p: [x, 1.25, 92.6] }, C.stone, true);
    if (hs[i] < 4) {
      L.add(box(0.7, 0.35, 0.5), "solid", { p: [x, 1.0 + hs[i] + 0.1, 92.6], r: [0.2, 0.4, 0.3] }, C.woodWorn);
      // fallen pillar piece
      L.add(cyl(0.4, 0.42, 2.6, 8), "solid", { p: [x + 1.6, 1.4, 89.2], r: [0, 0.3 + i, Math.PI / 2] }, C.woodWorn, true);
    }
  });
  // back wall chunks
  L.add(box(6.5, 5.2, 0.6), "solid", { p: [-6.2, 3.6, 98.8] }, C.wall, true);
  L.add(box(5.0, 3.0, 0.6), "solid", { p: [0, 2.5, 98.8] }, C.wall, true);
  L.add(box(6.5, 4.4, 0.6), "solid", { p: [6.4, 3.2, 98.8] }, C.wall, true);
  L.add(box(2.6, 0.5, 0.7), "solid", { p: [-1.3, 4.2, 98.8], r: [0, 0, 0.5] }, C.stoneD);
  // tie beams, exposed rafters
  L.add(box(17.5, 0.5, 0.6), "solid", { p: [-1.2, 6.9, 92.6], r: [0, 0, 0.04] }, C.woodWorn, true);
  for (let i = 0; i < 5; i++) L.add(box(0.25, 0.3, 6.4), "solid", { p: [-7 + i * 1.7, 7.3 - i * 0.05, 95.5], r: [0.04, 0, 0] }, C.woodWorn);
  // remaining roof (left half) sagging, fallen piece on the right
  L.add(roofGeom(5.8, 5.2, 2.0, 1.2, false, 6), "roof", { p: [-5.2, 7.2, 95.6], r: [0.0, 0, 0.1] }, C.tileWorn, true);
  L.add(roofGeom(3.4, 3.0, 1.2, 0.9, false, 4), "roof", { p: [7.5, 1.7, 90.0], r: [0.25, 0.7, 0.35] }, C.tileWorn, true);
  L.add(roofGeom(2.0, 1.8, 0.7, 0.5, false, 3), "roof", { p: [-2.2, 1.2, 87.2], r: [-0.3, 0.2, -0.2] }, C.tileWorn);
  // moss on roof and ledges
  for (let i = 0; i < 14; i++) {
    const mx = -9 + rnd() * 16, mz = 92 + rnd() * 6;
    L.add(sph(0.7 + rnd() * 0.6, 6, 4), "solid", { p: [mx, 1.05, mz], s: [1.6, 0.18, 1.2] }, rnd() < 0.5 ? C.moss : C.mossD);
  }
  for (let i = 0; i < 6; i++) L.add(sph(0.8, 6, 4), "solid", { p: [-9 + rnd() * 7, 8.9 - rnd() * 0.5, 94 + rnd() * 4], s: [1.7, 0.2, 1.3] }, C.moss);
  // altar (stone table with offerings) + bronze incense burner (ding) with rising smoke
  L.add(box(3.6, 1.0, 1.6), "solid", { p: [0, 1.5, 94.8] }, C.stone, true);
  L.add(box(3.9, 0.18, 1.9), "solid", { p: [0, 2.09, 94.8] }, C.stoneL);
  offeringTable(L, 0, 1.0, 93.3);
  incenseBurner(L, 3.2, 1.0, 91.8, smokes, top, 0.85);
  incenseBurner(L, -3.2, 1.0, 91.8, smokes, top, 0.85);
  // ruined gate
  L.add(cyl(0.5, 0.58, 5.4, 9), "solid", { p: [-4.4, 2.7, 69.5] }, C.woodWorn, true);
  L.add(box(1.3, 0.6, 1.3), "solid", { p: [-4.4, 0.3, 69.5] }, C.stone, true);
  L.add(cyl(0.5, 0.58, 2.4, 9), "solid", { p: [4.4, 1.2, 69.5] }, C.woodWorn, true);
  L.add(box(1.3, 0.6, 1.3), "solid", { p: [4.4, 0.3, 69.5] }, C.stone, true);
  L.add(box(10.4, 0.6, 0.7), "solid", { p: [-0.8, 5.55, 69.5], r: [0, 0, 0.12] }, C.woodWorn, true);
  L.add(box(5.4, 0.6, 0.7), "solid", { p: [3.2, 0.5, 67.8], r: [0.05, 0.4, 0.1] }, C.woodWorn, true);
  // courtyard lanterns (two lit, two toppled)
  for (const [lx, lz, lit, t] of [[-7.5, 79, true, 0], [7.5, 79, true, 0], [-8.5, 89, false, 0.5], [8.5, 88, false, -0.35]] as [number, number, boolean, number][]) {
    stoneLantern(new Local(b, lx, top, lz, rnd() * 6), lanterns, lit, t);
  }
  // banners on leaning poles (one torn short)
  for (const sx of [-1, 1]) {
    L.add(cyl(0.09, 0.11, 6.8, 6), "solid", { p: [sx * 10.5, 3.4, 84], r: [0, 0, sx * 0.04] }, C.darker, true);
    L.add(box(1.9, 0.09, 0.09), "solid", { p: [sx * 9.6, 6.55, 84] }, C.gold);
    L.add(sph(0.16, 6, 5), "solid", { p: [sx * 10.5, 6.95, 84] }, C.gold);
    if (SG) SG.banner(sx * 9.6, top + 6.5, 84, 1.25, sx < 0 ? 4.0 : 2.6, 0, sx < 0 ? BANNER_CELL.guard : BANNER_CELL.cloud);
  }
  // hall tablet hanging crooked from the tie beam, and the fallen valley board
  if (SG) {
    SG.board("tablet", 0, top + 5.55, 92.2, 4.2, 1.52, Math.PI, { tilt: 0.1, off: 0.0, both: true });
    SG.board("valley", -3.1, top + 1.5, 86.4, 2.1, 0.72, Math.PI - 0.5, { tilt: -0.2, both: false });
  }
  // god-ray anchors over the broken roof
  rays.push({ x: -3, y: top + 9, z: 94 }, { x: 4, y: top + 8, z: 93 });
  // rubble: chiselled mossy chunks + a few columns' drums
  for (let i = 0; i < 30; i++) {
    const a = rnd() * Math.PI * 2, r = 6 + rnd() * 6;
    const sz = 0.35 + rnd() * 0.75;
    const g = i % 4 === 0 ? rockCluster(i + 11, sz * 0.8) : rockChunk(i + 3, sz * 1.2, sz * 0.7, sz, { moss: 0.5, cuts: 5, detail: 1 });
    localVC(L, g, "solid", { p: [Math.sin(a) * r, sz * 0.15, 86 + Math.cos(a) * r * 0.9], r: [0, rnd() * 6, 0] }, true);
  }
  // shrine statues
  for (const sx of [-1, 1]) {
    L.add(box(1.5, 1.1, 1.5), "solid", { p: [sx * 5.2, 0.55, 76] }, C.stoneD, true);
    L.add(sph(0.55, 8, 6), "solid", { p: [sx * 5.2, 1.6, 76], s: [1, 1.1, 1] }, C.stone, true);
    L.add(sph(0.3, 6, 5), "solid", { p: [sx * 5.2, 2.25, 76.15] }, C.stoneL);
  }
}

// ---------------- 0.5.0 boss-arena landmarks ----------------
// The two newer bosses fight in bare hollows. These landmarks dress those arenas in the valley's ink-wash language and go
// through the shared Batch, so they merge into the existing batch_* meshes: ZERO extra draw calls. The merged structure
// meshes are always in view, so the pieces stay deliberately low-poly (a few hundred triangles per cluster).

/** Ground height under a point authored in a Local's x/z, relative to the Local origin's y. */
function groundIn(L: Local, lx: number, lz: number): number {
  const c = Math.cos(L.yaw), s = Math.sin(L.yaw);
  return terrainHeight(L.ox + lx * c + lz * s, L.oz - lx * s + lz * c) - L.oy;
}

/** Broken shrine column: ground-seated footing, leaning shaft, snapped top (or a capped standing column), optional moss. */
function ruinPillar(L: Local, lx: number, lz: number, h: number, tilt: number, cap: boolean, mossy = false) {
  const g = groundIn(L, lx, lz);
  L.add(box(1.15, 0.5, 1.15), "solid", { p: [lx, g + 0.25, lz] }, C.stoneD);
  L.add(cyl(0.4, 0.48, h, 6), "solid", { p: [lx + tilt * 0.4, g + 0.5 + h / 2, lz], r: [tilt, 0, tilt * 0.8] }, C.stoneL, true);
  if (cap) L.add(box(1.2, 0.3, 1.2), "solid", { p: [lx + tilt * 0.8, g + 0.5 + h + 0.1, lz], r: [tilt, 0.35, tilt * 0.8] }, C.stone, true);
  else L.add(box(0.66, 0.28, 0.42), "solid", { p: [lx + tilt * 0.8 + 0.12, g + 0.5 + h + 0.08, lz], r: [0.24, 0.5, 0.22] }, C.stoneL);
  if (mossy) L.add(cyl(0.42, 0.42, 0.07, 6), "solid", { p: [lx + tilt * 0.4, g + 0.5 + h - 0.06, lz] }, C.moss);
}

/** A ward-stamp carved into a facing surface: dark recessed square with incised seal lines (local +z is the facing side). */
function sealStamp(L: Local, x: number, y: number, z: number, s: number, red = true) {
  L.add(box(0.56 * s, 0.56 * s, 0.08), "solid", { p: [x, y, z] }, C.darker);
  L.add(box(0.4 * s, 0.07, 0.08), "solid", { p: [x, y, z + 0.05] }, red ? C.redGlow : C.gold);
  L.add(box(0.07, 0.4 * s, 0.08), "solid", { p: [x, y, z + 0.05] }, red ? C.redGlow : C.gold);
}

function drownedShrine(b: Batch) {
  // A desecrated shrine half-sunk into the south side of the Hollow Hierophant's arena (-72,-72), facing north across the
  // fight floor: sunken hall platform, four broken columns, a collapsed roof, half-drowned steps down into a dark ink
  // pool, a fallen stone mask and a fallen stele. The arena's inner 8 units stay clear (the nearest piece is the ink
  // pool's near rim, 8.2 from the spawn and just outside the 7.5 stomp circle) and the eastern approach from the plaza
  // stays open; the whole ruin sits inside the world bounds.
  const X = -72, Z = -90;
  const L = new Local(b, X, terrainHeight(X, Z), Z, 0.06);
  // sunken hall platform: the lowest course is already under the ground
  L.add(box(9.0, 1.0, 5.0), "solid", { p: [0, 0.25, 0] }, C.stoneD, true);
  L.add(box(8.2, 0.3, 4.6), "solid", { p: [0, 0.72, 0] }, C.stone, true);
  // toppled back wall: a leaning stub and a fallen course
  L.add(box(6.6, 2.4, 0.5), "solid", { p: [-0.4, 1.45, -2.2], r: [0.05, 0, 0.07] }, C.wall, true);
  L.add(box(2.6, 1.0, 0.5), "solid", { p: [3.1, 0.55, -2.5], r: [0.1, 0.25, 0.45] }, C.wall);
  // columns: one still capped, the rest snapped at different heights
  ruinPillar(L, -3.2, -1.2, 4.3, 0.03, true);
  ruinPillar(L, 3.1, -1.3, 2.2, -0.05, false);
  ruinPillar(L, -3.0, 1.3, 1.1, 0.12, false);
  ruinPillar(L, 3.3, 1.2, 3.0, -0.02, false, true);
  // collapsed roof over the back of the hall
  L.add(roofGeom(3.4, 2.8, 1.1, 0.8, false, 5, 4), "roof", { p: [0.6, 1.08, -1.15], r: [0.16, 0.35, 0.22] }, C.tileWorn, true);
  // half-sunk steps: each course lower than the last, the final ones under the ink
  const steps: Array<[number, number, number, number]> = [[2.95, 6.4, 0.6, 0.55], [3.62, 5.6, 0.5, 0.42], [4.29, 4.8, 0.4, 0.28], [4.96, 4.0, 0.32, 0.15], [5.6, 3.4, 0.26, 0.05]];
  for (const [lz, w, h, top] of steps) L.add(box(w, h, 0.85), "solid", { p: [0, top - h / 2, lz] }, C.stoneD, top > 0.4);
  // the ink pool: a dark still surface held by a broken stone rim
  const pool = { x: 0.4, z: 6.0, r: 3.0 }, wy = 0.12;
  L.add(new THREE.CircleGeometry(pool.r, 18), "solid", { p: [pool.x, wy, pool.z], r: [-Math.PI / 2, 0, 0] }, C.inkPool);
  L.add(new THREE.RingGeometry(1.65, 1.78, 14), "solid", { p: [pool.x, wy + 0.012, pool.z], r: [-Math.PI / 2, 0, 0] }, C.inkRipple);
  for (let i = 0; i < 15; i++) {
    const a = (i / 15) * Math.PI * 2;
    if (Math.abs(a - Math.PI) < 0.5) continue; // the drowned steps enter the pool on the shrine side
    const rx = pool.x + Math.sin(a) * (pool.r + 0.4), rz = pool.z + Math.cos(a) * (pool.r + 0.4);
    L.add(box(1.5 + (i % 3) * 0.2, 0.55, 0.85), "solid", { p: [rx, groundIn(L, rx, rz) + 0.22, rz], r: [0.06, a, 0.05] }, i % 2 ? C.stoneD : C.stone);
  }
  // two half-drowned pillars rising out of the ink
  L.add(cyl(0.34, 0.42, 1.5, 6), "solid", { p: [pool.x - 1.1, wy + 0.65, pool.z + 0.5], r: [0.14, 0, 0.06] }, C.stoneL, true);
  L.add(cyl(0.3, 0.38, 1.0, 6), "solid", { p: [pool.x + 1.25, wy + 0.45, pool.z - 0.3], r: [-0.1, 0, 0.12] }, C.stone);
  // the fallen mask at the pool's east rim: a shallow carved stone face, one eye cracked in vermilion
  const mx = 3.9, mz = 3.5, mg = groundIn(L, mx, mz);
  L.add(box(2.0, 0.3, 2.4), "solid", { p: [mx, mg + 0.14, mz] }, C.stoneL, true);
  L.add(box(1.3, 0.26, 0.6), "solid", { p: [mx, mg + 0.15, mz + 1.25] }, C.stoneL);
  for (const sx of [-1, 1]) {
    L.add(box(0.5, 0.07, 0.3), "solid", { p: [mx + sx * 0.45, mg + 0.31, mz - 0.25] }, C.dark);
    L.add(box(0.55, 0.22, 0.6), "solid", { p: [mx + sx * 1.15, mg + 0.13, mz + 0.1] }, C.stoneL);
  }
  L.add(box(0.22, 0.14, 0.55), "solid", { p: [mx, mg + 0.34, mz + 0.25] }, C.stoneD);
  L.add(box(0.6, 0.07, 0.14), "solid", { p: [mx, mg + 0.31, mz + 0.75] }, C.dark);
  L.add(box(0.07, 0.05, 0.95), "solid", { p: [mx + 0.5, mg + 0.33, mz - 0.6], r: [0, 0.3, 0] }, C.redGlow);
  // the fallen stele, carved face up
  const stx = -3.9, stz = 3.4, stg = groundIn(L, stx, stz);
  L.add(box(1.6, 0.32, 3.2), "solid", { p: [stx, stg + 0.17, stz] }, C.stone, true);
  for (const bx of [-0.4, 0, 0.4]) L.add(box(0.09, 0.035, 1.9), "solid", { p: [stx + bx, stg + 0.35, stz + 0.1] }, C.gold);
  L.add(box(0.34, 0.045, 0.34), "solid", { p: [stx, stg + 0.35, stz + 1.15] }, C.redGlow);
  // a toppled cold lantern by the hall's west corner
  const lx2 = -5.0, lz2 = 2.2, lg = groundIn(L, lx2, lz2);
  L.add(box(0.75, 0.4, 0.75), "solid", { p: [lx2, lg + 0.2, lz2] }, C.stoneD);
  L.add(cyl(0.13, 0.15, 0.95, 6), "solid", { p: [lx2 + 0.75, lg + 0.15, lz2], r: [0, 0, Math.PI / 2] }, C.stone);
  L.add(box(0.5, 0.4, 0.5), "solid", { p: [lx2 + 1.4, lg + 0.2, lz2] }, C.stoneD);
  L.add(box(0.78, 0.16, 0.78), "solid", { p: [lx2 + 1.4, lg + 0.48, lz2], r: [0, 0, 0.08] }, C.stone);
  // two snapped column stumps flanking the hall
  for (const [sx2, sz2, sh] of [[-6.0, 0.4, 1.3], [5.6, 0.6, 0.9]] as Array<[number, number, number]>) {
    const g = groundIn(L, sx2, sz2);
    L.add(cyl(0.34, 0.46, sh, 6), "solid", { p: [sx2, g + sh / 2, sz2], r: [0.05, 0, 0.08] }, C.stoneL, true);
    L.add(box(0.6, 0.22, 0.38), "solid", { p: [sx2 + 0.15, g + sh + 0.06, sz2], r: [0.3, 0.6, 0.15] }, C.stone);
  }
  // rubble and moss
  for (const [rx2, rz2, sz2, seed] of [[5.8, 5.6, 0.9, 31], [-6.2, 5.0, 1.0, 47]] as Array<[number, number, number, number]>) {
    localVC(L, rockChunk(seed, sz2 * 1.2, sz2 * 0.7, sz2, { moss: 0.6, cuts: 5, detail: 1 }), "solid", { p: [rx2, groundIn(L, rx2, rz2) + sz2 * 0.12, rz2], r: [0, seed, 0] });
  }
  L.add(cyl(0.7, 0.8, 0.06, 6), "solid", { p: [-2.6, 0.84, -0.6] }, C.moss);
  L.add(cyl(0.55, 0.62, 0.06, 6), "solid", { p: [2.1, 0.84, 1.5] }, C.moss);
  L.add(cyl(0.5, 0.58, 0.06, 6), "solid", { p: [-4.9, groundIn(L, -4.9, 2.4) + 0.05, 2.4] }, C.moss);
}

function wardenStone(L: Local, sx: number, sz: number, inward: number, i: number) {
  const S = new Local(L.b, L.ox + sx, L.oy + groundIn(L, sx, sz), L.oz + sz, inward);
  const h = 2.4 + (i % 3) * 0.55;
  const tilt = (((i * 5) % 7) - 3) * 0.014;
  S.add(box(1.7 + (i % 2) * 0.2, 0.55, 1.25), "solid", { p: [0, 0.18, 0] }, C.stoneD);
  S.add(cyl(0.52, 0.76, h, 6), "solid", { p: [0, 0.45 + h / 2, 0], r: [tilt, 0, tilt * 0.7] }, i % 2 ? C.stone : C.stoneL, true);
  S.add(box(0.95, 0.3, 0.95), "solid", { p: [0, 0.45 + h + 0.12, 0], r: [tilt, 0.3, tilt] }, C.stone);
  sealStamp(S, 0, 1.55 + (h - 2.4) * 0.4, 0.64, 0.9, i % 2 === 0);
  if (i % 3 === 0) S.add(cyl(0.5, 0.62, 0.09, 6), "solid", { p: [0, 0.52, 0] }, C.moss);
}

function brokenWardStone(b: Batch) {
  // the snapped ward-stone inside the ring, south-east of the spawn: its seal still faces the arena centre
  const X = 66, Z = -66;
  const S = new Local(b, X, terrainHeight(X, Z), Z, -Math.PI / 4);
  S.add(box(2.7, 0.65, 2.3), "solid", { p: [0, 0.2, 0] }, C.stoneD, true);
  S.add(box(1.35, 1.85, 0.95), "solid", { p: [0, 1.25, 0], r: [0.04, 0, 0.07] }, C.stone, true);
  S.add(box(1.25, 0.85, 0.9), "solid", { p: [1.75, groundIn(S, 1.75, 1.15) + 0.42, 1.15], r: [0.2, 0.65, 0.28] }, C.stoneL, true);
  S.add(box(0.5, 0.4, 0.42), "solid", { p: [-1.2, groundIn(S, -1.2, 1.35) + 0.18, 1.35], r: [0.28, 0.9, 0.35] }, C.stone);
  // the great seal on the face that looks into the ring
  S.add(box(1.0, 1.15, 0.07), "solid", { p: [0, 1.45, 0.5] }, C.darker);
  for (const sy of [-0.56, 0.56]) S.add(box(1.1, 0.07, 0.08), "solid", { p: [0, 1.45 + sy, 0.55] }, C.gold);
  for (const sx of [-0.52, 0.52]) S.add(box(0.07, 1.15, 0.08), "solid", { p: [sx, 1.45, 0.55] }, C.gold);
  S.add(box(0.5, 0.06, 0.08), "solid", { p: [0, 1.45, 0.58] }, C.redGlow);
  S.add(box(0.06, 0.5, 0.08), "solid", { p: [0, 1.45, 0.58] }, C.redGlow);
  S.add(box(0.18, 0.18, 0.09), "solid", { p: [0, 1.45, 0.6] }, C.gold);
  // a cracked ward line of flat stones around the base
  for (let i = 0; i < 7; i++) {
    if (i === 3) continue; // break in the line
    const a = (i / 7) * Math.PI * 2 + 0.3;
    const rx = Math.sin(a) * 3.2, rz = Math.cos(a) * 3.2;
    S.add(box(1.0, 0.16, 0.5), "solid", { p: [rx, groundIn(S, rx, rz) + 0.07, rz], r: [0, a + 0.3, 0.03] }, i % 2 ? C.stoneD : C.stone);
  }
  S.add(cyl(0.6, 0.72, 0.07, 6), "solid", { p: [-0.9, groundIn(S, -0.9, -0.9) + 0.04, -0.9] }, C.moss);
}

function wardenStones(b: Batch) {
  // A broken ring of seal-stamped warden stones around the Mist Warden's arena (60,-60): weathered monoliths with carved
  // ward-stamps facing inward, low threshold stones at the western approach gap from the plaza, and a snapped ward-stone
  // inside the ring. The monoliths sit at r >= 12 from the spawn; the only pieces closer are the flat 0.2-high stones of
  // the broken ward line (5+ from the spawn, still outside the 3-unit wander core), so the fight floor and the approach
  // stay clear, and the whole ring is inside the world bounds.
  const X = 60, Z = -60;
  const L = new Local(b, X, terrainHeight(X, Z), Z, 0);
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    if (i === 5 || i === 6) continue; // approach gap towards the plaza (west-south-west)
    const r = 12.4 + ((i * 37) % 5) * 0.28;
    wardenStone(L, Math.sin(a) * r, Math.cos(a) * r, a + Math.PI, i);
  }
  // low threshold stones flank the gap without blocking it
  for (const a of [(5 / N) * Math.PI * 2, (6 / N) * Math.PI * 2]) {
    const sx = Math.sin(a) * 12.4, sz = Math.cos(a) * 12.4;
    L.add(box(1.9, 0.55, 1.1), "solid", { p: [sx, groundIn(L, sx, sz) + 0.22, sz], r: [0.05, a + 0.25, 0.04] }, C.stoneD, true);
  }
  brokenWardStone(b);
  // fallen stones and moss between the ring and the hollow
  for (const [rx, rz, sz2, seed] of [[-5.6, 14.6, 0.9, 71], [11.4, 9.0, 0.8, 83]] as Array<[number, number, number, number]>) {
    localVC(L, rockChunk(seed, sz2 * 1.2, sz2 * 0.7, sz2, { moss: 0.65, cuts: 5, detail: 1 }), "solid", { p: [rx, groundIn(L, rx, rz) + sz2 * 0.12, rz], r: [0, seed, 0] });
  }
  L.add(cyl(0.62, 0.72, 0.07, 6), "solid", { p: [13.6, groundIn(L, 13.6, -3.2) + 0.05, -3.2] }, C.moss);
  L.add(cyl(0.5, 0.58, 0.06, 6), "solid", { p: [-12.8, groundIn(L, -12.8, -4.4) + 0.05, -4.4] }, C.moss);
}

// ---------------- plaza decor ----------------
function plazaDecor(b: Batch, smokes: THREE.Vector3[]) {
  const y = terrainHeight(0, -80);
  const L = new Local(b, 0, y, -80, 0);
  // curb ring segments
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    if (Math.abs(a - 0) < 0.22 || Math.abs(a - Math.PI) < 0.22 && false) continue;
    const r = PLAZA.r + 0.2;
    L.add(box(1.75, 0.35, 0.6), "solid", { p: [Math.sin(a) * r, 0.1, Math.cos(a) * r], r: [0, a, 0] }, i % 2 ? C.stone : C.stoneD);
  }
  // central stele / incense drum
  L.add(cyl(1.5, 1.8, 0.5, 10), "solid", { p: [0, 0.25, 0] }, C.stoneD, true);
  L.add(cyl(1.0, 1.2, 0.5, 10), "solid", { p: [0, 0.75, 0] }, C.stone, true);
  L.add(cyl(0.55, 0.8, 1.6, 8), "solid", { p: [0, 1.8, 0] }, C.stoneD, true);
  for (const yy of [1.2, 2.35]) L.add(cyl(0.86, 0.86, 0.09, 10), "solid", { p: [0, yy, 0] }, C.gold);
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; L.add(box(0.14, 0.9, 0.05), "solid", { p: [Math.sin(a) * 0.74, 1.8, Math.cos(a) * 0.74], r: [0, a, 0] }, C.redGlow); }
  incenseBurner(L, 0, 2.58, 0, smokes, 0, 0.78);
  // Cloudmist Valley stele beside the gate approach, flag poles around the ring
  const stele = (sx: number, sz: number, yaw: number, key: "steleA" | "steleB" | "steleC" | "steleD", bx: number, bz: number) => {
    const Ls = new Local(b, bx, terrainHeight(bx, bz), bz, yaw);
    Ls.add(box(1.5, 0.45, 0.9), "solid", { p: [sx, 0.22, sz] }, C.stoneD, true);
    Ls.add(box(1.2, 2.7, 0.4), "solid", { p: [sx, 1.8, sz] }, C.stone, true);
    Ls.add(roofGeom(0.95, 0.5, 0.3, 0.12, false, 2, 4, 0.1), "roof", { p: [sx, 3.15, sz] }, C.tile, true);
    Ls.add(sph(0.12, 6, 5), "solid", { p: [sx, 3.62, sz] }, C.gold);
    if (SG) {
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      SG.board(key, bx + sx * c + sz * sn, terrainHeight(bx, bz) + 1.82, bz - sx * sn + sz * c, 1.04, 2.3, yaw, { off: 0.22 });
    }
  };
  stele(0, 0, 2.41, "steleB", -8, -71);
  for (let k = 0; k < 6; k++) {
    const a = 0.5 + (k / 6) * Math.PI * 2 + 0.26, r = PLAZA.r - 2.0;
    if (Math.cos(a) > 0.85) continue;
    const px = Math.sin(a) * r, pz = Math.cos(a) * r;
    L.add(cyl(0.09, 0.11, 6.2, 6), "solid", { p: [px, 3.1, pz] }, C.darker, true);
    L.add(box(1.6, 0.08, 0.08), "solid", { p: [px - Math.cos(a) * 0.8, 6.0, pz + Math.sin(a) * 0.8], r: [0, a, 0] }, C.gold);
    L.add(sph(0.15, 6, 5), "solid", { p: [px, 6.3, pz] }, C.gold);
    if (SG) SG.banner(L.ox + px - Math.cos(a) * 0.8, L.oy + 5.95, L.oz + pz + Math.sin(a) * 0.8, 1.15, 3.2, a, [BANNER_CELL.fu, BANNER_CELL.jiuzhou, BANNER_CELL.cloud][k % 3]);
  }
  // a few bench-like stone seats
  for (const sx of [-1, 1]) L.add(box(2.6, 0.5, 0.8), "solid", { p: [sx * 8.5, 0.35, 5.5], r: [0, sx * 0.6, 0] }, C.stone, true);
}

export function buildStructures(): StructureOut {
  const group = new THREE.Group();
  group.name = "structures";
  const lanterns: THREE.Vector3[] = [];
  const smokes: THREE.Vector3[] = [];
  const rays: { x: number; y: number; z: number }[] = [];
  const b = new Batch();
  SG = new Signage(); lanternCount = 0;
  paifang(b, 0, -62, group, lanterns);
  roadsideSteles(b);
  pagoda(b, -27, -72, lanterns);
  pathLanterns(b, lanterns);
  bridge(b, lanterns);
  shrine(b, lanterns, group, smokes, rays);
  drownedShrine(b);
  wardenStones(b);
  plazaDecor(b, smokes);
  poiMarkers(b, lanterns);
  b.build(group, structureMaterials(), 0.06);
  const sig = SG.build(group);
  SG = null;
  return { group, lanterns, smokes, rays, update(t: number) { sig.update(t); } };
}
