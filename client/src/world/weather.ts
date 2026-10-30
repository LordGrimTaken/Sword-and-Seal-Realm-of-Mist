// Weather layer: a deterministic, time-driven cycle of clear skies, heavy mist banks and soft ink-rain over Cloudmist Valley.
// Purely atmospheric (client-only): mist billboards drift around the camera, rain is one instanced line system that follows
// the camera and leans with the shared wind field. Everything fades smoothly and keeps the ink-and-vermilion palette.
import * as THREE from "three";
import { fbm, hash2, lerp, mulberry32, smoothstep } from "./noise";
import { PAL, hex } from "./toon";
import { WIND } from "./wind";
import type { Tone } from "./daynight";
import { settings } from "../ui/settings";

export type WeatherKind = "clear" | "mist" | "rain";

export interface WeatherState { kind: WeatherKind; mist: number; rain: number; epoch: number; forced: WeatherKind | null; reduceMotion: boolean }

export interface WeatherOut {
  group: THREE.Group;
  /** how heavy the mist is right now, 0..1 (ambient.ts thickens its ground-haze sheets with this) */
  mist: number;
  update(t: number, dt: number, cam: THREE.Vector3, tone: Tone): void;
  /** force one weather state (null = resume the deterministic cycle); used by ?weather= and the __jzWeather debug hook */
  force(kind: WeatherKind | null): void;
  state(): WeatherState;
}

/** seconds per weather epoch: mostly clear, sometimes heavy mist, occasionally soft ink-rain */
const EPOCH = 74;
/** seconds to crossfade from one epoch's weather to the next */
const FADE = 10;
/** rain volume (world units): one box that follows the camera */
const RAIN_BOX = 46, RAIN_H = 32, RAIN_SEGS = 1000;
/** number of big drifting mist billboards (one instanced draw call) */
const BANKS = 6;

const MIST_TINT = hex(PAL.mistLight, PAL.paper, 0.22);

/**
 * Deterministic weather for epoch `i` (world-time / EPOCH). fbm gives a smoothly varying 0..1 value so consecutive epochs
 * tend to stay in the same mood; the bands are "mostly clear, occasional mist, sometimes soft rain".
 */
function epochTarget(i: number): { mist: number; rain: number } {
  const v = fbm(i * 0.73 + 2.7, i * 0.41 + 9.2, 2);
  if (v < 0.55) return { mist: 0.05 + 0.1 * hash2(i, 1.7), rain: 0 };                       // clear: a thread of haze
  if (v < 0.85) return { mist: 0.55 + 0.45 * hash2(i, 3.1), rain: 0 };                      // mist banks roll in
  return { mist: 0.45 + 0.35 * hash2(i, 5.3), rain: 0.55 + 0.45 * hash2(i, 7.9) };          // low cloud with soft ink-rain
}

/** ?weather=clear|mist|rain freezes the cycle to one state (handy for screenshots and UI tests). */
const forcedParam = (() => {
  if (typeof location === "undefined") return null;
  const w = new URLSearchParams(location.search).get("weather");
  return w === "clear" || w === "mist" || w === "rain" ? (w as WeatherKind) : null;
})();

/** Soft ink-wash mist bank: horizontal streaks with a torn, feathered edge (white RGB; alpha carries the bank). */
let mistTexCache: THREE.CanvasTexture | null = null;
function mistBankTexture(): THREE.CanvasTexture {
  if (mistTexCache) return mistTexCache;
  const W = 256, H = 128, cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d")!, img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W, v = (y + 0.5) / H;
    // stretched wash: long horizontal wisps over a slow vertical billow
    const n = fbm(u * 3.4 + 2.1, v * 8.2 + 5.7, 4) * 0.72 + fbm(u * 8.5 + 11.3, v * 2.6 + 1.9, 2) * 0.28;
    const edge = smoothstep(0.0, 0.24, u) * smoothstep(0.0, 0.24, 1 - u) * smoothstep(0.0, 0.34, v) * smoothstep(0.0, 0.34, 1 - v);
    const a = Math.max(0, Math.min(1, smoothstep(0.34, 0.72, n) * edge));
    const i = (y * W + x) * 4;
    img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  mistTexCache = t;
  return t;
}

export function buildWeather(): WeatherOut {
  const group = new THREE.Group();
  group.name = "weather";
  const rnd = mulberry32(9137);

  // ---------------- mist banks: one instanced billboard draw call ----------------
  const bankOff = new Float32Array(BANKS * 3), bankSize = new Float32Array(BANKS * 2), bankSeed = new Float32Array(BANKS * 4);
  for (let i = 0; i < BANKS; i++) {
    const a = (i / BANKS) * Math.PI * 2 + rnd() * 0.7;
    const r = 24 + rnd() * 30;
    bankOff.set([Math.cos(a) * r, 3.2 + rnd() * 8.5, Math.sin(a) * r], i * 3);
    bankSize.set([40 + rnd() * 40, 15 + rnd() * 14], i * 2);
    bankSeed.set([rnd(), rnd(), rnd(), rnd()], i * 4);
  }
  const bankGeo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  bankGeo.index = quad.index;
  bankGeo.setAttribute("position", quad.getAttribute("position"));
  bankGeo.setAttribute("uv", quad.getAttribute("uv"));
  bankGeo.setAttribute("aOffset", new THREE.InstancedBufferAttribute(bankOff, 3));
  bankGeo.setAttribute("aSize", new THREE.InstancedBufferAttribute(bankSize, 2));
  bankGeo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(bankSeed, 4));
  bankGeo.instanceCount = BANKS;
  const mistMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, fog: false, side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uMist: { value: 0 },
      uCol: { value: MIST_TINT.clone() }, uDrift: { value: WIND.dir.value.clone() }, uMotion: { value: 1 },
      uTex: { value: mistBankTexture() },
    },
    vertexShader: `
      attribute vec3 aOffset; attribute vec2 aSize; attribute vec4 aSeed;
      uniform float uTime, uMotion; uniform vec3 uCam; uniform vec2 uDrift;
      varying vec2 vUv; varying float vA; varying vec4 vSeed;
      void main(){
        vSeed = aSeed;
        float t = uTime * (0.05 + aSeed.x * 0.09) * (0.25 + 0.75 * uMotion);
        vec3 c = uCam + aOffset;
        c.xz += uDrift * sin(t * 2.1 + aSeed.y * 6.2831) * (5.0 + aSeed.z * 11.0);
        c.y += sin(t * 1.3 + aSeed.w * 6.2831) * 1.3;
        vec4 mv = viewMatrix * vec4(c, 1.0);
        float ang = aSeed.w * 6.2831 + uTime * (0.006 + aSeed.x * 0.012) * uMotion;
        vec2 p = position.xy * aSize;
        p = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p;
        mv.xy += p;
        float d = -mv.z;
        vA = smoothstep(6.0, 18.0, d) * (1.0 - smoothstep(58.0, 92.0, d));
        // vary the wash per bank so five copies of one texture do not read as a repeated stamp
        vec2 q = uv - 0.5;
        q = mat2(cos(aSeed.y * 6.28), -sin(aSeed.y * 6.28), sin(aSeed.y * 6.28), cos(aSeed.y * 6.28)) * q;
        vUv = q * (0.72 + aSeed.z * 0.4) + 0.5 + vec2(aSeed.x * 0.12, aSeed.w * 0.12);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uTex; uniform float uMist; uniform vec3 uCol;
      varying vec2 vUv; varying float vA; varying vec4 vSeed;
      void main(){
        float a = texture2D(uTex, vUv).a * vA * uMist * (0.32 + vSeed.z * 0.16);
        if (a < 0.0025) discard;
        gl_FragColor = vec4(uCol, a);
        #include <colorspace_fragment>
      }`,
  });
  const banks = new THREE.Mesh(bankGeo, mistMat);
  banks.frustumCulled = false;
  banks.renderOrder = 3;
  banks.name = "mistBanks";
  banks.visible = false;
  group.add(banks);

  // ---------------- ink rain: one instanced line system, camera-relative, wind-leaned ----------------
  const rainPos = new Float32Array(RAIN_SEGS * 2 * 3);
  const rainBase = new Float32Array(RAIN_SEGS * 2 * 3);
  const rainEnd = new Float32Array(RAIN_SEGS * 2);
  const rainSeed = new Float32Array(RAIN_SEGS * 2 * 4);
  const drops: { x: number; y: number; z: number; seed: number }[] = [];
  for (let i = 0; i < RAIN_SEGS; i++) drops.push({ x: rnd(), y: rnd(), z: rnd(), seed: rnd() });
  for (let i = 0; i < RAIN_SEGS; i++) {
    const d = drops[i];
    for (let k = 0; k < 2; k++) {
      const v = (i * 2 + k);
      rainBase.set([d.x, d.y, d.z], v * 3);
      rainEnd[v] = k;
      rainSeed.set([rnd(), rnd(), rnd(), rnd()], v * 4);
    }
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  rainGeo.setAttribute("aBase", new THREE.BufferAttribute(rainBase, 3));
  rainGeo.setAttribute("aEnd", new THREE.BufferAttribute(rainEnd, 1));
  rainGeo.setAttribute("aSeed", new THREE.BufferAttribute(rainSeed, 4));
  const rainMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: {
      uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uRain: { value: 0 },
      uWind: { value: new THREE.Vector2(0.82, 0.57).normalize() }, uMotion: { value: 1 },
      uCol: { value: hex(PAL.inkSoft, PAL.mist, 0.55) },
    },
    vertexShader: `
      attribute vec3 aBase; attribute float aEnd; attribute vec4 aSeed;
      uniform float uTime, uMotion; uniform vec3 uCam; uniform vec2 uWind; uniform float uRain;
      varying float vA;
      void main(){
        float spd = 16.0 + aSeed.x * 13.0;
        float lean = 2.6 + aSeed.y * 3.2;
        float fall = mod(aBase.y * ${RAIN_H.toFixed(1)} - uTime * spd * (0.15 + 0.85 * uMotion), ${RAIN_H.toFixed(1)});
        // streak head in a camera-relative box: x/z wrap around, height wraps through the fall cycle
        vec3 rel;
        rel.x = mod(aBase.x * ${RAIN_BOX.toFixed(1)} + uWind.x * (fall - ${RAIN_H.toFixed(1)}) * -0.2 + ${RAIN_BOX.toFixed(1)} * 0.5, ${RAIN_BOX.toFixed(1)}) - ${RAIN_BOX.toFixed(1)} * 0.5;
        rel.z = mod(aBase.z * ${RAIN_BOX.toFixed(1)} + uWind.y * (fall - ${RAIN_H.toFixed(1)}) * -0.2 + ${RAIN_BOX.toFixed(1)} * 0.5, ${RAIN_BOX.toFixed(1)}) - ${RAIN_BOX.toFixed(1)} * 0.5;
        rel.y = fall - ${RAIN_H.toFixed(1)} * 0.5;
        vec3 head = uCam + rel;
        vec3 vel = normalize(vec3(uWind.x * lean, -spd, uWind.y * lean));
        vec3 wp = head + vel * (aEnd * (1.2 + aSeed.z * 1.6) * (0.4 + 0.6 * uMotion));
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        float d = -mv.z;
        float edge = 1.0 - smoothstep(${(RAIN_BOX * 0.32).toFixed(1)}, ${(RAIN_BOX * 0.5).toFixed(1)}, length(rel.xz));
        vA = edge * smoothstep(1.0, 4.0, d) * uRain;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uCol; varying float vA;
      void main(){
        if (vA < 0.004) discard;
        gl_FragColor = vec4(uCol, vA * 0.85);
        #include <colorspace_fragment>
      }`,
  });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  rain.renderOrder = 4;
  rain.name = "inkRain";
  rain.visible = false;
  group.add(rain);

  // ---------------- deterministic cycle state ----------------
  let mist = 0, rainAmt = 0;
  let forced: WeatherKind | null = forcedParam;
  let epochNow = 0;
  const camTmp = new THREE.Vector3();

  const setForcedTargets = (k: WeatherKind): { mist: number; rain: number } =>
    k === "clear" ? { mist: 0.03, rain: 0 } : k === "mist" ? { mist: 1, rain: 0 } : { mist: 0.62, rain: 1 };

  function cycleTargets(t: number): { mist: number; rain: number; epoch: number } {
    const idx = Math.floor(t / EPOCH);
    const local = t - idx * EPOCH;
    const a = epochTarget(idx), b = epochTarget(idx - 1);
    const u = smoothstep(0, FADE, local);
    return { mist: lerp(b.mist, a.mist, u), rain: lerp(b.rain, a.rain, u), epoch: idx };
  }

  function update(t: number, dt: number, cam: THREE.Vector3, tone: Tone) {
    const cyc = cycleTargets(t);
    epochNow = cyc.epoch;
    const target = forced ? setForcedTargets(forced) : cyc;
    const tau = forced ? 0.55 : 2.4;                       // forced states settle fast (screenshots/tests)
    const k = 1 - Math.exp(-dt / tau);
    mist += (target.mist - mist) * k;
    rainAmt += (target.rain - rainAmt) * k;
    if (mist < 0.004) mist = 0;
    if (rainAmt < 0.004) rainAmt = 0;
    const reduce = settings.get().reduceMotion;
    const motion = reduce ? 0.3 : 1;

    // mist banks: tint with the current horizon so they read as part of the same atmosphere
    const mistOn = mist > 0.02;
    banks.visible = mistOn;
    if (mistOn) {
      mistMat.uniforms.uTime.value = t;
      mistMat.uniforms.uMist.value = mist;
      camTmp.copy(cam);
      mistMat.uniforms.uCam.value.copy(camTmp);
      mistMat.uniforms.uMotion.value = motion;
      (mistMat.uniforms.uCol.value as THREE.Color).copy(tone.horizon).lerp(MIST_TINT, 0.55).lerp(hex(PAL.mistLight, PAL.mist, 0.3), 0.25 * tone.night);
      (mistMat.uniforms.uDrift.value as THREE.Vector2).copy(WIND.dir.value);
    }

    // ink rain: lean with the shared wind, drop density with reduceMotion already handled by speed
    const rainOn = rainAmt > 0.02;
    rain.visible = rainOn;
    if (rainOn) {
      rainMat.uniforms.uTime.value = t;
      rainMat.uniforms.uRain.value = rainAmt;
      rainMat.uniforms.uCam.value.copy(cam);
      rainMat.uniforms.uMotion.value = motion;
      (rainMat.uniforms.uWind.value as THREE.Vector2).copy(WIND.dir.value);
      // ink streaks: dark against the bright day fog, faintly pale ink at night so they still read against lantern light\n      (rainMat.uniforms.uCol.value as THREE.Color).copy(tone.horizon).multiplyScalar(0.55).lerp(hex(PAL.mistLight), 0.35 * tone.night);
    }
  }

  function force(kind: WeatherKind | null) { forced = kind; }

  function state(): WeatherState {
    const kind: WeatherKind = rainAmt > 0.2 ? "rain" : mist > 0.2 ? "mist" : "clear";
    return { kind, mist: Math.round(mist * 1000) / 1000, rain: Math.round(rainAmt * 1000) / 1000, epoch: epochNow, forced, reduceMotion: settings.get().reduceMotion };
  }

  if (typeof window !== "undefined") {
    (window as unknown as { __jzWeather?: unknown }).__jzWeather = { force, state, clear: () => force("clear") };
  }

  return {
    group,
    get mist() { return mist; },
    update,
    force,
    state,
  };
}







