// Day / night cycle in five ink-wash keyframes: dawn (rose-gold mist), day (jade-grey), dusk (vermilion bleed), night (indigo ink, moon, stars).
// Everything tinted by the cycle reads one shared Tone: sky + mountain colours, fog, hemisphere / key light, lantern strength, firefly and star density,
// the post pass grade. Night stays readable (never below ~55% of day light) so telegraphs and mobs remain legible.
import * as THREE from "three";
import { HORIZON, SUN_DIR } from "./sky";
import { PAL, hex } from "./toon";

export interface Tone {
  /** 0..1 clock, 0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk */
  t: number;
  /** 1 at deep night (stars, moon, fireflies) */
  night: number;
  /** 0..1 how much the lanterns should be glowing */
  lamp: number;
  /** 1 = full sun beams, 0 = none */
  rays: number;
  zenith: THREE.Color; horizon: THREE.Color; sunCol: THREE.Color; discCol: THREE.Color;
  hemiSky: THREE.Color; hemiGround: THREE.Color; hemiI: number; sunI: number;
  /** multiplicative grade for the post pass */
  tint: THREE.Color;
  /** direction towards the dominant light (sun by day, moon by night) */
  key: THREE.Vector3;
  /** where the sun / moon discs are drawn in the sky dome */
  skySun: THREE.Vector3; skyMoon: THREE.Vector3;
  /** 0..1 sun disc visibility */
  disc: number;
}

interface Key {
  at: number; zenith: number; horizon: number; hemiSky: number; hemiGround: number; hemiI: number; sun: number; sunI: number;
  lamp: number; night: number; rays: number; tint: [number, number, number]; disc: number; discCol: number;
}
const DAY_Z = hex(PAL.mist, PAL.mistLight, 0.12), DAY_H = HORIZON, DAY_HS = hex(PAL.mistLight, PAL.paper, 0.3), DAY_HG = hex(PAL.paperDark, PAL.mist, 0.5), DAY_SUN = hex(PAL.paper, PAL.gold, 0.08);
const KEYS: Key[] = [
  { at: 0.0, zenith: 0x1d2745, horizon: 0x56698c, hemiSky: 0x8394c2, hemiGround: 0x3d4466, hemiI: 1.12, sun: 0xaebfff, sunI: 0.95, lamp: 1, night: 1, rays: 0.0, tint: [0.9, 0.97, 1.12], disc: 0, discCol: 0xe8e4d4 },
  { at: 0.23, zenith: 0x39466a, horizon: 0x7a8199, hemiSky: 0x9aa0c0, hemiGround: 0x5a5470, hemiI: 1.15, sun: 0xd0b8c8, sunI: 1.0, lamp: 0.85, night: 0.55, rays: 0.3, tint: [0.98, 0.97, 1.06], disc: 0.5, discCol: 0xe07a56 },
  { at: 0.30, zenith: 0x9aa6b8, horizon: 0xdccdbd, hemiSky: 0xd4cfd0, hemiGround: 0xaaa597, hemiI: 1.35, sun: 0xffd9b0, sunI: 1.55, lamp: 0.3, night: 0.0, rays: 1.5, tint: [1.03, 0.985, 0.95], disc: 1, discCol: 0xd9573a },
  { at: 0.42, zenith: -1, horizon: -1, hemiSky: -1, hemiGround: -1, hemiI: 1.45, sun: -1, sunI: 1.8, lamp: 0, night: 0, rays: 1, tint: [1, 1, 1], disc: 0.55, discCol: 0xe3b9a0 },
  { at: 0.60, zenith: -1, horizon: -1, hemiSky: -1, hemiGround: -1, hemiI: 1.45, sun: -1, sunI: 1.8, lamp: 0, night: 0, rays: 1, tint: [1, 1, 1], disc: 0.55, discCol: 0xe3b9a0 },
  { at: 0.72, zenith: 0x8a8aa6, horizon: 0xcfb0a8, hemiSky: 0xbfbcc6, hemiGround: 0x9a9296, hemiI: 1.28, sun: 0xffbd94, sunI: 1.3, lamp: 0.75, night: 0.05, rays: 1.5, tint: [1.025, 0.985, 0.97], disc: 1, discCol: 0xc8372d },
  { at: 0.80, zenith: 0x3b3f66, horizon: 0x8b7088, hemiSky: 0x9a9bc0, hemiGround: 0x555070, hemiI: 1.15, sun: 0xc08fa8, sunI: 1.0, lamp: 0.95, night: 0.6, rays: 0.25, tint: [0.98, 0.95, 1.06], disc: 0.4, discCol: 0xb03a30 },
  { at: 1.0, zenith: 0x1d2745, horizon: 0x56698c, hemiSky: 0x8394c2, hemiGround: 0x3d4466, hemiI: 1.12, sun: 0xaebfff, sunI: 0.95, lamp: 1, night: 1, rays: 0.0, tint: [0.9, 0.97, 1.12], disc: 0, discCol: 0xe8e4d4 },
];
const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const col = (h: number, dayC: THREE.Color) => (h < 0 ? dayC.clone() : new THREE.Color(h));

export function createTone(): Tone {
  const c = () => new THREE.Color();
  return { t: 0.3, night: 0, lamp: 0, rays: 1, zenith: c(), horizon: c(), sunCol: c(), discCol: c(), hemiSky: c(), hemiGround: c(), hemiI: 1.45, sunI: 1.8, tint: c(), key: new THREE.Vector3(), skySun: new THREE.Vector3(), skyMoon: new THREE.Vector3(), disc: 0.5 };
}

const AZ0 = Math.atan2(SUN_DIR.x, SUN_DIR.z);
const A = new THREE.Color(), B = new THREE.Color();

export function sampleTone(t: number, out: Tone): Tone {
  t = ((t % 1) + 1) % 1;
  let i = 0;
  while (i < KEYS.length - 2 && t >= KEYS[i + 1].at) i++;
  const k0 = KEYS[i], k1 = KEYS[i + 1];
  const u = ss(0, 1, (t - k0.at) / (k1.at - k0.at));
  const mix = (get: (k: Key) => number, dst: THREE.Color, day: THREE.Color) => { A.copy(col(get(k0), day)); B.copy(col(get(k1), day)); dst.copy(A).lerp(B, u); };
  mix((k) => k.zenith, out.zenith, DAY_Z); mix((k) => k.horizon, out.horizon, DAY_H);
  mix((k) => k.hemiSky, out.hemiSky, DAY_HS); mix((k) => k.hemiGround, out.hemiGround, DAY_HG); mix((k) => k.sun, out.sunCol, DAY_SUN);
  mix((k) => k.discCol, out.discCol, DAY_SUN);
  const f = (get: (k: Key) => number) => get(k0) + (get(k1) - get(k0)) * u;
  out.hemiI = f((k) => k.hemiI); out.sunI = f((k) => k.sunI); out.lamp = f((k) => k.lamp); out.night = f((k) => k.night); out.rays = f((k) => k.rays);
  out.disc = f((k) => k.disc);
  out.tint.setRGB(f((k) => k.tint[0]), f((k) => k.tint[1]), f((k) => k.tint[2]));
  out.t = t;
  // sun on a gentle arc: east at dawn, high at noon, west at dusk; the moon sits opposite
  const a = (t - 0.25) * Math.PI * 2, elev = Math.sin(a);
  const az = AZ0 - Math.cos(a) * 1.1;
  const sy = Math.max(-0.5, Math.min(0.72, elev * 0.8)), sh = Math.sqrt(1 - sy * sy);
  out.skySun.set(Math.sin(az) * sh, sy, Math.cos(az) * sh);
  out.skyMoon.set(-out.skySun.x, -out.skySun.y, -out.skySun.z);
  const sunW = ss(-0.12, 0.1, elev);
  const ky = (v: THREE.Vector3) => new THREE.Vector3(v.x, Math.max(0.24, v.y * 0.6 + 0.16), v.z).normalize();
  out.key.copy(ky(out.skyMoon)).lerp(ky(out.skySun), sunW).normalize();
  return out;
}

export interface DayNightTargets {
  scene: THREE.Scene;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  sky: THREE.Mesh;
  mountains: THREE.Group;
  apply(tone: Tone): void;
}

export interface DayNight { tone: Tone; update(dt: number): void; set(t: number): void; }

/** query ?tod=0..1 freezes the clock at that time (0.5 noon, 0.75 dusk, 0 midnight); ?todspeed= sets cycles per minute (default one cycle per 16 minutes). */
export function createDayNight(g: DayNightTargets): DayNight {
  const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
  const fixed = q.get("tod");
  const speedQ = q.get("todspeed");
  let clock = fixed !== null && !Number.isNaN(Number(fixed)) ? Number(fixed) : 0.45;
  const rate = fixed !== null && speedQ === null ? 0 : (speedQ !== null && !Number.isNaN(Number(speedQ)) ? Number(speedQ) / 60 : 1 / (16 * 60));
  const tone = createTone();
  const baseCols = new Map<THREE.ShaderMaterial, THREE.Color>();
  const sky = g.sky.material as THREE.ShaderMaterial;
  const nightMul = new THREE.Color(0.34, 0.4, 0.62);
  const tmp = new THREE.Color();

  function apply() {
    sampleTone(clock, tone);
    sky.uniforms.uZenith.value.copy(tone.zenith);
    sky.uniforms.uHorizon.value.copy(tone.horizon);
    sky.uniforms.uSun.value.copy(tone.sunCol).multiplyScalar(1.1);
    sky.uniforms.uSunDir.value.copy(tone.skySun);
    sky.uniforms.uMoonDir.value.copy(tone.skyMoon);
    sky.uniforms.uNight.value = tone.night;
    sky.uniforms.uDisc.value = tone.disc;
    sky.uniforms.uDiscCol.value.copy(tone.discCol);
    (g.scene.background as THREE.Color).copy(tone.horizon);
    (g.scene.fog as THREE.Fog).color.copy(tone.horizon);
    g.hemi.color.copy(tone.hemiSky); g.hemi.groundColor.copy(tone.hemiGround); g.hemi.intensity = tone.hemiI;
    g.sun.color.copy(tone.sunCol); g.sun.intensity = tone.sunI;
    g.sun.position.copy(tone.key).multiplyScalar(100);
    const nm = tone.night;
    g.mountains.children.forEach((m) => {
      const mat = (m as THREE.Mesh).material as THREE.ShaderMaterial;
      const base: THREE.Color = baseCols.get(mat) ?? (mat.uniforms.uCol.value as THREE.Color).clone();
      baseCols.set(mat, base);
      mat.uniforms.uMist.value.copy(tone.horizon);
      tmp.copy(base).lerp(tmp.copy(base).multiply(nightMul), nm); // darker indigo ridges at night
      // dawn / dusk: ridges take a little of the horizon glow
      mat.uniforms.uCol.value.copy(tmp).lerp(tone.horizon, 0.1 * (1 - nm) * (1 - tone.disc * 0.0));
    });
    g.scene.userData.tone = tone;
    g.apply(tone);
  }
  apply();
  g.scene.userData.setTimeOfDay = (t: number) => { clock = t; apply(); };
  return {
    tone,
    set(t: number) { clock = t; apply(); },
    update(dt: number) { if (rate > 0) { clock = (clock + dt * rate) % 1; apply(); } },
  };
}
