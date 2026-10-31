// "The Sunken Hall": a walled, half-sunken ruined court in the north-west of Cloudmist Valley — the game's
// second named region inside the same world (no instancing, no loading). The stone shell is merged into the
// structures batch (see structures.ts) so it costs no extra draw calls; this module owns the region rect, the
// cold interior ambience and the drifting hall air motes.
//
// Site: centre (-73, 40). The interior floor rect x[-81,-65] z[35.5,44.5] is a natural shallow bowl (interior
// terrain 0.06..0.45, surrounding ring up to 0.98), so the court reads a little lower than the valley floor,
// behind 5-6.5-unit broken walls. One gate in the south wall (centred -70, 35.5) is the only opening; a broken
// stair descends from the valley shoulder (terrain ~0.55 at z=28) into the court. Existing spawn boxes keep 4.0+
// units from the interior rect (far-west bamboo / grove bamboo), the nearest stone-hound point is 34.7 away and
// the hermit POI is 21.6 away.
import * as THREE from "three";
import type { Batch } from "./batch";
import { box, cone, cyl, Local, localVC, roofGeom, sph } from "./geo";
import { rockChunk } from "./rocks";
import { mulberry32 } from "./noise";
import { terrainHeight } from "./terrain";
import { PAL, hex } from "./toon";

/** Ink-and-vermilion palette entries used by the hall (locked palette, same helpers as the other set pieces). */
const C = {
  stone: hex(PAL.paperDark, PAL.mist, 0.35),
  stoneD: hex(PAL.paperDark, PAL.inkSoft, 0.35),
  stoneL: hex(PAL.paper, PAL.mist, 0.25),
  wall: hex(PAL.paper, PAL.paperDark, 0.35),
  wallD: hex(PAL.paperDark, PAL.inkSoft, 0.4),
  wallWorn: hex(PAL.paperDark, PAL.mist, 0.55),
  inkPool: hex(PAL.ink, PAL.jade, 0.22),
  inkRipple: hex(PAL.mistLight, PAL.ink, 0.32),
  moss: hex(PAL.jade, PAL.paperDark, 0.35),
  mossD: hex(PAL.jade, PAL.inkSoft, 0.45),
  gold: hex(PAL.gold),
  red: hex(PAL.vermilion, PAL.gold, 0.22),
  glow: hex(0xf2c06a),
  cold: hex(PAL.mistLight, PAL.mist, 0.4),
};

/** The region rect used by the HUD label and the ambience blend (interior floor: 16 x 9 units). */
export const HALL = {
  name: "The Sunken Hall",
  valleyName: "Cloudmist Valley",
  /** interior (player-enterable) rectangle — the walls stand just outside it */
  x0: -81, x1: -65, z0: 35.5, z1: 44.5,
  cx: -73, cz: 40,
  /** the one opening: a broken gate centred on the south wall, with its stair running south into the valley */
  gateX: -70, gateZ: 35.5, gateW: 3.4,
  /** world point just outside the gate where the approach stair lands */
  approachX: -70, approachZ: 30,
  /** interior dressing that mobs must not spawn on (altar dais / ink pool), used by the content checks too */
  altar: { x: -73, z: 40, hx: 2.8, hz: 2.2 },
  pool: { x: -73, z: 42.9, hx: 3.0, hz: 1.0 },
} as const;

/** rough mean of the interior terrain: the visual reference height for the hall's geometry */
export const HALL_BASE_Y: number = terrainHeight(HALL.cx, HALL.cz);

/** Cold fog / light the interior blends toward (kept here so the world can crossfade between valley and hall). */
export const HALL_FOG = hex(PAL.mist, PAL.inkSoft, 0.52);
export const HALL_LIGHT = hex(PAL.mist, PAL.mistLight, 0.45);

/** Cheap region test (no allocation): true inside the hall's interior floor rect. */
export function inSunkenHall(x: number, z: number): boolean {
  return x >= HALL.x0 && x <= HALL.x1 && z >= HALL.z0 && z <= HALL.z1;
}

/** 1 inside the hall, easing to 0 within 7 units outside it — drives the cold fog / light blend. No allocation. */
export function sunkenHallInfluence(x: number, z: number): number {
  const dx = Math.max(HALL.x0 - x, 0, x - HALL.x1);
  const dz = Math.max(HALL.z0 - z, 0, z - HALL.z1);
  if (dx === 0 && dz === 0) return 1;
  const d = Math.hypot(dx, dz);
  return d >= 7 ? 0 : 1 - d / 7;
}

// ---------------------------------------------------------------------------------------------
// geometry (merged into the structures batch)
// ---------------------------------------------------------------------------------------------

type Ground = (lx: number, lz: number) => number;

/** one stone column, snapped at `h` with a broken cap on the taller ones */
function column(L: Local, ground: Ground, lx: number, lz: number, h: number, tilt: number, cap: boolean) {
  const g = ground(lx, lz);
  L.add(cyl(0.34, 0.44, 0.6, 6), "solid", { p: [lx, g + 0.3, lz] }, C.stoneD, true);
  L.add(cyl(0.3, 0.4, h, 6), "solid", { p: [lx, g + 0.6 + h / 2, lz], r: [tilt * 0.7, 0, tilt] }, C.stoneL, true);
  if (cap) {
    L.add(box(0.95, 0.22, 0.95), "solid", { p: [lx + tilt * 0.25, g + 0.72 + h, lz], r: [tilt * 0.4, 0.1, tilt * 0.5] }, C.stone, true);
    L.add(box(0.62, 0.14, 0.62), "solid", { p: [lx + tilt * 0.3, g + 0.9 + h, lz], r: [0, 0.4, tilt * 0.3] }, C.stone);
  } else {
    L.add(box(0.5, 0.3, 0.5), "solid", { p: [lx + 0.12, g + 0.72 + h, lz - 0.08], r: [0.2, 0.5, 0.14] }, C.stone);
  }
}

/** a brazier: stone pedestal + bowl + a warm glow part (its world position also feeds the lantern halo/point lights) */
function brazier(L: Local, ground: Ground, lx: number, lz: number, lanterns: THREE.Vector3[], s = 1) {
  const g = ground(lx, lz);
  L.add(cyl(0.3 * s, 0.42 * s, 0.9 * s, 7), "solid", { p: [lx, g + 0.45 * s, lz] }, C.stoneD, true);
  L.add(cyl(0.46 * s, 0.34 * s, 0.24 * s, 8), "solid", { p: [lx, g + 0.96 * s, lz] }, C.stone);
  L.add(sph(0.2 * s, 8, 6), "glow", { p: [lx, g + 1.08 * s, lz], s: [1, 0.72, 1] }, C.glow);
  L.add(cyl(0.1 * s, 0.16 * s, 0.1 * s, 6), "solid", { p: [lx, g + 1.0 * s, lz] }, C.red);
  lanterns.push(new THREE.Vector3(HALL.cx + lx, HALL_BASE_Y + g + 1.12 * s, HALL.cz + lz));
}

function sunkenHallShell(b: Batch, lanterns: THREE.Vector3[], smokes: THREE.Vector3[]): void {
  const rnd = mulberry32(7077);
  const X = HALL.cx, Z = HALL.cz, Y = HALL_BASE_Y;
  const L = new Local(b, X, Y, Z, 0);
  /** local ground height relative to the hall origin (terrain is not carved; the floor paving hugs it) */
  const ground: Ground = (lx, lz) => terrainHeight(X + lx, Z + lz) - Y;
  const HX = 8, HZ = 4.5;       // interior half extents: 16 x 9
  const T = 2.0;                 // wall thickness
  const GH = HALL.gateX - X;     // gate centre in local x (= +3)
  const GW = HALL.gateW;

  // ---- sunken topsoil → worn flagstone paving: thin slabs that follow the terrain (the player walks on terrain) ----
  for (let ix = 0; ix < 5; ix++) for (let iz = 0; iz < 3; iz++) {
    const lx = -HX + 1.65 + ix * 3.15, lz = -HZ + 1.55 + iz * 3.0;
    const g = ground(lx, lz);
    if (Math.abs(lx - GH) < 2.0 && lz > HZ - 1.2) continue; // keep a clear runner from the gate
    L.add(box(3.0, 0.16, 2.85), "solid", { p: [lx, g + 0.02, lz], r: [0, (rnd() - 0.5) * 0.05, (rnd() - 0.5) * 0.02] }, [C.stone, C.stoneD, C.stoneL][(ix + iz * 2) % 3]);
  }
  // runner from the gate to the altar: broad flat walk stones
  for (let i = 0; i < 5; i++) {
    const lz = HZ - 0.7 - i * 1.6, g = ground(GH, lz);
    L.add(box(2.3, 0.14, 1.3), "solid", { p: [GH, g + 0.03, lz], r: [0, (rnd() - 0.5) * 0.04, 0] }, i % 2 ? C.stone : C.stoneL);
  }

  // ---- walls: four broken sides with battered bases, only the south wall has a gate gap ----
  const wallRun = (lx: number, lz: number, len: number, h: number, horiz: boolean, baseY: number) => {
    const w = horiz ? len : T, d = horiz ? T : len;
    // buried base course + main mass
    L.add(box(w + 0.5, 1.3, d + 0.5), "solid", { p: [lx, baseY - 0.35, lz] }, C.stoneD, true);
    L.add(box(w, h, d), "solid", { p: [lx, baseY + h / 2, lz] }, C.wall, true);
    // weathered top course + leaning broken chunks
    L.add(box(w + 0.16, 0.26, d + 0.16), "solid", { p: [lx, baseY + h + 0.08, lz] }, C.wallWorn);
    const nChunks = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < nChunks; i++) {
      const along = (rnd() - 0.5) * (len - 1.1);
      const cx2 = horiz ? lx + along : lx + (rnd() - 0.5) * 0.5;
      const cz2 = horiz ? lz + (rnd() - 0.5) * 0.5 : lz + along;
      L.add(box(0.8 + rnd() * 0.7, 0.3 + rnd() * 0.55, 0.55 + rnd() * 0.4), "solid",
        { p: [cx2, baseY + h + 0.26 + rnd() * 0.12, cz2], r: [(rnd() - 0.5) * 0.4, rnd() * 0.8, (rnd() - 0.5) * 0.5] }, C.wallD);
    }
  };
  // north wall: two segments with different heights (the tallest side)
  const nG = ground(0, HZ + T / 2);
  wallRun(-HX + 4.4, HZ + T / 2, 7.2, 6.2, true, nG);
  wallRun(HX - 4.4, HZ + T / 2, 7.2, 5.4, true, nG);
  // east + west walls, broken into two runs each
  const eG = ground(HX + T / 2, 0), wG = ground(-HX - T / 2, 0);
  wallRun(HX + T / 2, -2.6, 5.2, 5.6, false, eG);
  wallRun(HX + T / 2, 2.7, 5.4, 4.6, false, eG);
  wallRun(-HX - T / 2, -2.7, 5.4, 5.0, false, wG);
  wallRun(-HX - T / 2, 2.6, 5.2, 6.0, false, wG);
  // south wall (gate side): two runs plus the gate towers
  const sG = ground(0, -HZ - T / 2);
  const sRunL = GH - GW / 2 - (-HX) - T / 2;   // west of the gap
  const sRunR = HX - (GH + GW / 2) - T / 2;    // east of the gap
  wallRun(-HX + sRunL / 2 - T / 2, -HZ - T / 2, sRunL, 4.9, true, sG);
  wallRun(HX - sRunR / 2 + T / 2, -HZ - T / 2, sRunR, 4.6, true, sG);
  // gate towers: broken, taller than the wall run, framing the only way in
  for (const sx of [GH - GW / 2 - 0.7, GH + GW / 2 + 0.7]) {
    const g = ground(sx, -HZ - T / 2);
    L.add(box(2.0, 1.4, 2.6), "solid", { p: [sx, g - 0.3, -HZ - T / 2] }, C.stoneD, true);
    L.add(box(1.7, 5.3, 2.3), "solid", { p: [sx, g + 2.65, -HZ - T / 2] }, C.wall, true);
    L.add(box(1.92, 0.3, 2.5), "solid", { p: [sx, g + 5.4, -HZ - T / 2] }, C.wallWorn);
    L.add(box(1.3, 0.5, 1.2), "solid", { p: [sx + (rnd() - 0.5) * 0.4, g + 5.65, -HZ - T / 2], r: [0.1, 0.5, 0.2] }, C.wallD);
  }
  // fallen lintel lying across the gate mouth, half-buried
  L.add(box(4.6, 0.42, 0.6), "solid", { p: [GH - 0.3, sG + 0.5, -HZ - T / 2 + 0.2], r: [0.06, 0.14, 0.17] }, C.wallWorn, true);
  L.add(box(1.3, 0.5, 1.1), "solid", { p: [GH + 1.9, sG + 0.22, -HZ - T / 2 - 0.9], r: [0.2, 0.9, 0.3] }, C.stoneD);

  // ---- the one approach: a broken stair outside the gate, flush with the terrain so it can be walked down ----
  for (let i = 0; i < 5; i++) {
    const lz = -HZ - T / 2 - 0.9 - i * 1.35, lx = GH + (i % 2) * 0.1;
    const g = ground(lx, lz);
    L.add(box(3.6, 0.2, 1.2), "solid", { p: [lx, g + 0.04, lz], r: [0, (rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.03] }, i % 2 ? C.stone : C.stoneL);
    if (i < 2) continue;
    // low broken cheek walls flanking the stair
    for (const side of [-1, 1]) L.add(box(0.7, 0.9 + rnd() * 0.6, 1.1), "solid", { p: [lx + side * 2.3, ground(lx + side * 2.3, lz) + 0.45, lz], r: [0.05, rnd() * 0.2, 0] }, C.stoneD, side === -1);
  }

  // ---- corner towers (broken, crenellated) ----
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as Array<[number, number]>) {
    const lx = sx * (HX + T / 2 - 0.2), lz = sz * (HZ + T / 2 - 0.2), g = ground(lx, lz);
    const h = 5.6 + (sx === sz ? 0.8 : 0);
    L.add(box(2.4, 1.5, 2.4), "solid", { p: [lx, g - 0.35, lz] }, C.stoneD, true);
    L.add(box(2.1, h, 2.1), "solid", { p: [lx, g + h / 2 + 0.4, lz] }, C.wallD, true);
    for (let i = 0; i < 3; i++) L.add(box(0.6, 0.5 + rnd() * 0.4, 0.6), "solid",
      { p: [lx + (i - 1) * 0.72, g + h + 0.65, lz + (rnd() - 0.5) * 1.1], r: [0, rnd() * 0.7, 0] }, C.wallWorn);
  }

  // ---- central altar dais: two low steps, a stone altar, a leaning stele and offerings ----
  const aG = ground(0, 0);
  L.add(box(4.4, 0.4, 3.2), "solid", { p: [0, aG + 0.2, 0] }, C.stoneD, true);
  L.add(box(3.4, 0.3, 2.3), "solid", { p: [0, aG + 0.55, 0] }, C.stone, true);
  L.add(box(1.5, 1.05, 1.0), "solid", { p: [0, aG + 1.2, -0.1] }, C.stoneL, true);
  L.add(box(1.7, 0.16, 1.2), "solid", { p: [0, aG + 1.78, -0.1] }, C.stoneD);
  // offerings: two small bowls + a jade cup
  for (const [ox, oz, r] of [[-0.5, 0.25, 0.18], [0.48, 0.22, 0.15]] as Array<[number, number, number]>) {
    L.add(cyl(r, r * 0.7, 0.12, 7), "solid", { p: [ox, aG + 1.92, oz] }, C.stone);
    L.add(cyl(r * 0.6, r * 0.5, 0.04, 7), "solid", { p: [ox, aG + 1.86, oz] }, C.mossD);
  }
  L.add(cyl(0.1, 0.13, 0.26, 6), "solid", { p: [0.1, aG + 2.0, 0.42] }, C.moss);
  // the stele behind the altar: carved face, gold lines, a vermilion seal
  L.add(box(1.25, 2.1, 0.28), "solid", { p: [0, aG + 2.3, -1.15], r: [-0.08, 0, 0.03] }, C.stone, true);
  for (let i = 0; i < 4; i++) L.add(box(0.62 - i * 0.06, 0.05, 0.04), "solid", { p: [0, aG + 2.75 - i * 0.22, -0.99], r: [-0.08, 0, 0.03] }, C.gold);
  L.add(box(0.34, 0.34, 0.06), "solid", { p: [0.3, aG + 1.85, -0.99], r: [-0.08, 0, 0.03] }, C.red);
  // flanking braziers (warm accents inside the cold hall)
  brazier(L, ground, -2.7, 0.6, lanterns);
  brazier(L, ground, 2.7, 0.6, lanterns);
  // incense smoke at the altar (the existing ambient smoke columns pick this up)
  smokes.push(new THREE.Vector3(X, Y + aG + 2.05, Z - 0.1));

  // ---- ink pool on the north side: dark still water in a broken rim, half-sunk columns ----
  const px = 0, pz = HZ - 1.6, pg = ground(px, pz), eh = 0.24;
  L.add(box(7.0, 0.18, 2.4), "solid", { p: [px, pg + 0.05, pz] }, C.inkPool);
  for (const [ex, ez, w, d] of [[0, 1.25, 7.2, 0.5], [0, -1.25, 7.2, 0.5], [-3.45, 0, 0.5, 2.0], [3.45, 0, 0.5, 2.0]] as Array<[number, number, number, number]>)
    L.add(box(w, eh + 0.16, d), "solid", { p: [px + ex, ground(px + ex, pz + ez) + eh / 2, pz + ez], r: [0, 0.05 * (rnd() - 0.5), 0] }, C.stoneD, true);
  for (const [rx, rz, r] of [[-1.6, 0.2, 1.5], [1.2, -0.2, 1.0]] as Array<[number, number, number]>)
    L.add(new THREE.RingGeometry(r * 0.82, r, 16), "solid", { p: [px + rx, pg + 0.1, pz + rz], r: [-Math.PI / 2, 0, 0] }, C.inkRipple);
  for (const [cx2, cz2, ch, tilt] of [[-2.2, 0.35, 1.4, 0.16], [2.4, -0.3, 0.9, -0.1]] as Array<[number, number, number, number]>) {
    L.add(cyl(0.3, 0.38, ch, 6), "solid", { p: [px + cx2, pg + ch / 2, pz + cz2], r: [tilt, 0, tilt * 0.5] }, C.stoneL, true);
    L.add(box(0.5, 0.26, 0.42), "solid", { p: [px + cx2 + 0.1, pg + ch + 0.1, pz + cz2], r: [0.3, 0.6, 0.2] }, C.stone);
  }
  // a drowned lotus cluster (static) and moss on the rim
  for (let i = 0; i < 3; i++) L.add(cyl(0.45 - i * 0.07, 0.5 - i * 0.06, 0.03, 9), "solid", { p: [-1.0 + i * 0.7, pg + 0.12, pz + 0.35] }, C.moss);
  L.add(cyl(0.1, 0.14, 0.4, 6), "solid", { p: [-2.4, pg + 0.28, pz - 0.6], r: [0.2, 0, 0.1] }, C.mossD);

  // ---- interior columns: two rows of broken pillars + one fallen drum ----
  column(L, ground, -6.2, -2.9, 3.6, 0.03, true);
  column(L, ground, 6.2, -2.9, 1.6, -0.06, false);
  column(L, ground, -6.2, 2.9, 2.6, 0.05, false);
  column(L, ground, 6.2, 2.9, 0.9, 0.12, false);
  L.add(cyl(0.42, 0.42, 1.5, 6), "solid", { p: [3.4, ground(3.4, -3.2) + 0.42, -3.2], r: [0.1, 0.5, Math.PI / 2] }, C.stoneL, true);
  L.add(box(0.6, 0.24, 0.48), "solid", { p: [4.4, ground(4.4, -3.0) + 0.12, -3.0], r: [0.25, 0.8, 0.15] }, C.stone);

  // ---- wall tablets: two carved seals on the north wall's inner face ----
  for (const [tx, th] of [[-3.4, 1.6], [3.6, 1.3]] as Array<[number, number]>) {
    const tg = ground(tx, HZ - 0.15);
    L.add(box(1.5, th, 0.22), "solid", { p: [tx, tg + 1.3, HZ - 0.15], r: [0.03, 0, 0.02] }, C.stone, true);
    for (let i = 0; i < 3; i++) L.add(box(0.85 - i * 0.1, 0.05, 0.05), "solid", { p: [tx, tg + 1.75 - i * 0.2, HZ - 0.02], r: [0.03, 0, 0.02] }, C.gold);
    L.add(box(0.3, 0.3, 0.05), "solid", { p: [tx + 0.35, tg + 1.05, HZ - 0.02], r: [0.03, 0, 0.02] }, C.red);
  }

  // ---- rubble, moss and fallen stone in the corners (overgrown ruin) ----
  localVC(L, rockChunk(19, 1.6, 1.0, 1.4, { moss: 0.62, cuts: 5, detail: 1 }), "solid", { p: [-7.1, ground(-7.1, -3.6) + 0.2, -3.6], r: [0, 0.7, 0] });
  localVC(L, rockChunk(43, 1.3, 0.8, 1.2, { moss: 0.55, cuts: 4, detail: 1 }), "solid", { p: [6.9, ground(6.9, 3.7) + 0.16, 3.7], r: [0, 2.1, 0] });
  localVC(L, rockChunk(77, 0.9, 0.6, 0.9, { moss: 0.7, cuts: 4, detail: 1 }), "solid", { p: [-2.6, ground(-2.6, -3.9) + 0.1, -3.9], r: [0, 1.2, 0] });
  for (const [mx, mz, mr] of [[-6.8, -1.2, 0.55], [6.4, 1.4, 0.5], [-4.6, 3.2, 0.42], [2.2, -3.4, 0.36]] as Array<[number, number, number]>) {
    L.add(cyl(mr, mr * 1.08, 0.05, 8), "solid", { p: [mx, ground(mx, mz) + 0.03, mz] }, C.moss);
  }
  // broken roof beams fallen along the east wall
  L.add(box(0.34, 0.34, 3.8), "solid", { p: [7.3, ground(7.3, -0.4) + 0.26, -0.4], r: [0.04, 0.06, 0.05] }, C.wallD, true);
  L.add(box(0.3, 0.3, 2.6), "solid", { p: [6.7, ground(6.7, 1.9) + 0.2, 1.9], r: [-0.03, -0.25, 0.02] }, C.wallD);
}

/** Build the hall's stone shell into the shared structures batch (returns nothing: geometry only). */
export function buildSunkenHall(b: Batch, lanterns: THREE.Vector3[], smokes: THREE.Vector3[]): void {
  sunkenHallShell(b, lanterns, smokes);
}

// ---------------------------------------------------------------------------------------------
// interior ambience: cold air motes + faint low haze drifting through the hall (1 draw call)
// ---------------------------------------------------------------------------------------------

export interface HallAirOut {
  group: THREE.Group;
  /** `inside` = the camera's hall influence (0..1); `reduceMotion` damps the drift to ~30% */
  update(t: number, inside: number, reduceMotion: boolean): void;
}

export function buildHallAir(): HallAirOut {
  const group = new THREE.Group();
  group.name = "hallAir";
  const N = 110;
  const rnd = mulberry32(5150);
  const pos = new Float32Array(N * 3), seed = new Float32Array(N * 4), col = new Float32Array(N * 3);
  const cold = C.cold;
  for (let i = 0; i < N; i++) {
    const lx = (rnd() - 0.5) * 15, lz = (rnd() - 0.5) * 8.4;
    const gy = terrainHeight(HALL.cx + lx, HALL.cz + lz);
    pos.set([HALL.cx + lx, gy + 0.25 + rnd() * 4.6, HALL.cz + lz], i * 3);
    seed.set([rnd(), rnd(), rnd(), rnd()], i * 4);
    const c = cold.clone().lerp(hex(PAL.mistLight, PAL.paper, 0.2), rnd() * 0.5);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true, blending: THREE.NormalBlending,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uIn: { value: 0 }, uPx: { value: 600 }, uMotion: { value: 1 },
    }]),
    vertexShader: `
      attribute vec4 aSeed; attribute vec3 color;
      uniform float uTime, uIn, uPx, uMotion;
      varying vec3 vCol; varying float vA;
      #include <common>
      #include <fog_pars_vertex>
      void main(){
        vec3 wp = position;
        float m = 0.2 + 0.8 * uMotion;
        wp.x += sin(uTime * (0.18 + aSeed.x * 0.22) * m + aSeed.y * 12.0) * (0.5 + aSeed.z * 0.9);
        wp.z += cos(uTime * (0.15 + aSeed.y * 0.2) * m + aSeed.x * 9.0) * (0.5 + aSeed.w * 0.9);
        wp.y += sin(uTime * (0.12 + aSeed.w * 0.16) * m + aSeed.z * 7.0) * (0.25 + aSeed.x * 0.4);
        vCol = color;
        float dc = distance(wp, cameraPosition);
        vA = uIn * (0.16 + 0.22 * aSeed.w) * smoothstep(0.4, 2.2, dc) * (1.0 - smoothstep(14.0, 26.0, dc));
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp((0.18 + aSeed.z * 0.5) * projectionMatrix[1][1] * uPx / max(-mvPosition.z, 0.1), 1.0, 90.0);
        #include <fog_vertex>
      }`,
    fragmentShader: `
      varying vec3 vCol; varying float vA;
      #include <common>
      #include <fog_pars_fragment>
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.15, d) * vA;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vCol, a);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const points = new THREE.Points(g, m);
  points.frustumCulled = false;
  points.renderOrder = 3;
  points.name = "hallMotes";
  points.visible = false;
  group.add(points);

  return {
    group,
    update(t: number, inside: number, reduceMotion: boolean) {
      const on = inside > 0.02;
      points.visible = on;
      if (!on) return;
      m.uniforms.uTime.value = t;
      m.uniforms.uIn.value = Math.min(1, inside);
      m.uniforms.uMotion.value = reduceMotion ? 0.3 : 1;
    },
  };
}
