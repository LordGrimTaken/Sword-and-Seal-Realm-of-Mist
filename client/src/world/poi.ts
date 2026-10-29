// Points of interest (0.4.0): a small stone marker with a vermilion seal at each of the six places the server tracks.
// Positions mirror POIS in server/src/data.ts (the server decides discovery; this is only the visible marker).
import * as THREE from "three";
import type { Batch } from "./batch";
import { box, cyl, Local, sph } from "./geo";
import { terrainHeight } from "./terrain";
import { COLORS as C } from "./structures";

const SPOTS: Array<{ x: number; z: number; yaw: number; kind: "stele" | "cairn" | "hut" | "flame" | "scales" | "lookout" }> = [
  { x: -62, z: 14, yaw: 0.6, kind: "hut" },
  { x: 36, z: -52, yaw: -0.5, kind: "stele" },
  { x: 34, z: -22, yaw: 0.2, kind: "scales" },
  { x: 62, z: 36, yaw: 0, kind: "flame" },
  { x: -22, z: 52, yaw: 0.3, kind: "cairn" },
  { x: 82, z: -62, yaw: -0.8, kind: "lookout" },
];

export function poiMarkers(b: Batch, lanterns: THREE.Vector3[]) {
  for (const s of SPOTS) {
    const gy = terrainHeight(s.x, s.z), L = new Local(b, s.x, gy, s.z, s.yaw);
    if (s.kind === "cairn") {
      [[0, 0.3, 0, 1.3], [0.2, 0.85, 0.1, 0.95], [-0.1, 1.3, 0, 0.65], [0.05, 1.65, 0, 0.4]].forEach(([x, y, z, r]) => L.add(sph(r, 7, 5), "solid", { p: [x, y, z] }, C.stone, true));
      L.add(box(0.5, 0.12, 0.1), "solid", { p: [0.05, 2.0, 0] }, C.redGlow);
    } else if (s.kind === "hut") {
      L.add(box(2.6, 0.2, 2.2), "solid", { p: [0, 0.1, 0] }, C.stoneD, true);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) L.add(cyl(0.09, 0.1, 2.0, 6), "solid", { p: [sx * 1.1, 1.1, sz * 0.9] }, C.mossD, true);
      L.add(box(2.9, 0.18, 2.5), "solid", { p: [0, 2.15, 0] }, C.tileWorn, true);
      L.add(box(0.5, 0.4, 0.5), "solid", { p: [0.6, 0.4, 0.2] }, C.stone);
    } else if (s.kind === "flame") {
      L.add(cyl(1.0, 1.2, 0.35, 8), "solid", { p: [0, 0.18, 0] }, C.stoneD, true);
      L.add(sph(0.28, 6, 5), "solid", { p: [0, 0.75, 0] }, 0x7fd7ff);
      lanterns.push(new THREE.Vector3(s.x, gy + 0.9, s.z));
    } else if (s.kind === "scales") {
      for (let i = 0; i < 5; i++) L.add(sph(0.25 + (i % 2) * 0.08, 5, 4), "solid", { p: [Math.cos(i * 1.3) * 0.8, 0.12, Math.sin(i * 1.3) * 0.8] }, C.moss);
      L.add(box(0.6, 1.4, 0.3), "solid", { p: [0, 0.7, 0] }, C.stone, true);
    } else if (s.kind === "lookout") {
      L.add(box(3.0, 0.4, 3.0), "solid", { p: [0, 0.2, 0] }, C.stoneD, true);
      L.add(box(0.5, 1.7, 0.5), "solid", { p: [-1.1, 1.1, -1.1] }, C.stone, true);
      L.add(box(0.5, 1.7, 0.5), "solid", { p: [1.1, 1.1, -1.1] }, C.stone, true);
      L.add(box(2.7, 0.35, 0.6), "solid", { p: [0, 2.1, -1.1] }, C.wood, true);
      lanterns.push(new THREE.Vector3(s.x, gy + 1.9, s.z + 0.8));
    } else {
      L.add(box(1.3, 0.35, 0.9), "solid", { p: [0, 0.18, 0] }, C.stoneD, true);
      L.add(box(0.9, 2.0, 0.3), "solid", { p: [0, 1.3, 0] }, C.stone, true);
      L.add(box(0.5, 0.5, 0.06), "solid", { p: [0, 1.7, 0.18] }, C.redGlow);
      L.add(sph(0.1, 6, 5), "solid", { p: [0, 2.4, 0] }, C.gold);
    }
  }
}
