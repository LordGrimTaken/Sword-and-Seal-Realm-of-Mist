// Sky gradient with soft sun + receding ink-wash mountain layers (skybox-style, parallax-correct).
import * as THREE from "three";
import { fbm, mulberry32 } from "./noise";
import { PAL, hex } from "./toon";

export const SUN_DIR = new THREE.Vector3(-0.62, 0.42, 0.66).normalize();
export const HORIZON = hex(PAL.mistLight, PAL.mist, 0.16);

const GLSL_NOISE = `
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm2(vec2 p){ float s=0.,a=.5; for(int i=0;i<4;i++){ s+=a*vn(p); p*=2.03; a*=.5;} return s; }
`;

export function buildSky(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
    uniforms: {
      uZenith: { value: hex(PAL.mist, PAL.mistLight, 0.12) },
      uHorizon: { value: HORIZON.clone() },
      uSunDir: { value: SUN_DIR.clone() },
      uSun: { value: hex(PAL.paper, 0xffffff, 0.0).multiplyScalar(1.15) },
      uTime: { value: 0 },
      uMoonDir: { value: SUN_DIR.clone().multiplyScalar(-1) }, uNight: { value: 0 }, uDisc: { value: 0.5 }, uDiscCol: { value: hex(PAL.vermilion, PAL.paper, 0.45) },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `
      uniform vec3 uZenith, uHorizon, uSun, uSunDir, uMoonDir, uDiscCol; uniform float uTime, uNight, uDisc; varying vec3 vDir;
      ${GLSL_NOISE}
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.75, h));
        col = mix(col, uHorizon, smoothstep(0.0, -0.3, h));
        // faint ink-wash cloud streaks
        vec2 cp = vec2(atan(d.x, d.z) * 2.2, h * 7.0) + vec2(uTime*0.004, 0.);
        float cl = fbm2(cp * vec2(1.0, 2.6) + 3.0);
        float band = smoothstep(0.05, 0.35, h) * (1.0 - smoothstep(0.35, 0.85, h));
        col = mix(col, uHorizon, smoothstep(0.45, 0.8, cl) * 0.5 * band);
        col = mix(col, uZenith*0.93, smoothstep(0.6, 0.9, fbm2(cp*1.7+11.)) * 0.18 * band);
        float sd = max(dot(d, uSunDir), 0.0);
        col += uSun * (pow(sd, 40.0) * 0.28 + pow(sd, 6.0) * 0.12);
        float above = smoothstep(-0.03, 0.04, d.y);
        // sun: a flat seal-red disc with a thin wash ring (poster silhouette), only above the horizon
        float ang = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
        float wob = 1.0 + 0.012 * sin(atan(d.x - uSunDir.x, d.z - uSunDir.z) * 7.0);
        col = mix(col, uDiscCol, smoothstep(0.066 * wob, 0.058 * wob, ang) * above * (1.0 - uNight * 0.85));
        col += uDiscCol * smoothstep(0.011, 0.0, abs(ang - 0.108)) * 0.22 * above * (1.0 - uNight);
        // moon: pale paper disc, ring halo, a few dark maria
        float am = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
        vec3 mcol = vec3(0.93, 0.92, 0.84) - 0.06 * vec3(fbm2(d.xz * 80.0 + 4.0));
        col = mix(col, mcol, smoothstep(0.05, 0.043, am) * uNight * above);
        col += vec3(0.5, 0.58, 0.8) * (exp(-am * 22.0) * 0.18 + smoothstep(0.012, 0.0, abs(am - 0.12)) * 0.1) * uNight * above;
        // stars: sparse twinkling dots, strongest high up, none on the lit side
        vec2 sc = vec2(atan(d.x, d.z) * 52.0, d.y * 52.0);
        vec2 si = floor(sc);
        float sh = h21(si + 17.0);
        float star = step(0.985, sh) * smoothstep(0.34, 0.0, length(fract(sc) - 0.5 - (h21(si) - 0.5) * 0.4)) * (0.55 + 0.45 * sin(uTime * (1.2 + sh * 3.0) + sh * 60.0));
        col += vec3(0.85, 0.9, 1.0) * star * uNight * smoothstep(0.06, 0.4, d.y) * 0.9;
        col += (h21(gl_FragCoord.xy*0.5) - 0.5) * 0.012;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 20), mat);
  m.renderOrder = -1000;
  m.frustumCulled = false;
  m.name = "sky";
  return m;
}

export function buildMountains(): { group: THREE.Group; scale: number; update(t: number): void } {
  const timeU = { value: 0 };
  const group = new THREE.Group();
  group.name = "mountains";
  const rnd = mulberry32(555);
  const S = 0.2; // skybox scale (true radius 240..450 -> 48..90, inside any sane far plane)
  const layers = [
    { R: 450, H: 250, c: hex(PAL.mist, PAL.mistLight, 0.5), seed: 4, peaks: 6, mist: 0.5 },
    { R: 370, H: 205, c: hex(PAL.mist, PAL.mistLight, 0.22), seed: 3, peaks: 6, mist: 0.42 },
    { R: 300, H: 150, c: hex(PAL.mist, PAL.inkSoft, 0.4), seed: 2, peaks: 7, mist: 0.36 },
    { R: 240, H: 100, c: hex(PAL.mist, PAL.inkSoft, 0.62), seed: 1, peaks: 8, mist: 0.3 },
  ];
  layers.forEach((L, li) => {
    const N = 720;
    const pos: number[] = [], t: number[] = [], idx: number[] = [], ang: number[] = [];
    const peakA: number[] = [], peakH: number[] = [], peakW: number[] = [];
    for (let i = 0; i < L.peaks; i++) { peakA.push((i / L.peaks) * 6.283 + rnd() * 0.6); peakH.push(0.4 + rnd() * 0.6); peakW.push(0.13 + rnd() * 0.2); }
    const crestAt = (a: number) => {
      const nx = Math.cos(a) * 1.6 + L.seed * 9, nz = Math.sin(a) * 1.6 + L.seed * 5;
      let h = 0.16 + 0.26 * Math.pow(fbm(nx, nz, 4), 1.5) + 0.07 * fbm(nx * 5, nz * 5, 3);
      for (let k = 0; k < L.peaks; k++) {
        let d = Math.abs(a - peakA[k]); d = Math.min(d, Math.PI * 2 - d);
        const q = Math.max(0, 1 - d / peakW[k]);
        h += peakH[k] * Math.pow(q, 1.6) * (0.86 + 0.14 * fbm(a * 55 + k * 7, k, 3) * 2.0) * (1 + 0.12 * Math.sin(a * 90 + k));
      }
      return h;
    };
    // a waterfall spilling from a shoulder just beside the tallest peak (layers 1-2 only, where it reads)
    let tall = 0; for (let k = 1; k < L.peaks; k++) if (peakH[k] > peakH[tall]) tall = k;
    const wfA = peakA[tall] + peakW[tall] * 0.32;
    const wfTop = crestAt(wfA) * 0.8;
    const hasWF = li === 1 || li === 2 || li === 3;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const nx = Math.cos(a) * 1.6 + L.seed * 9, nz = Math.sin(a) * 1.6 + L.seed * 5;
      let h = 0.16 + 0.26 * Math.pow(fbm(nx, nz, 4), 1.5) + 0.07 * fbm(nx * 5, nz * 5, 3);
      for (let k = 0; k < L.peaks; k++) {
        let d = Math.abs(a - peakA[k]); d = Math.min(d, Math.PI * 2 - d);
        const q = Math.max(0, 1 - d / peakW[k]);
        h += peakH[k] * Math.pow(q, 1.6) * (0.86 + 0.14 * fbm(a * 55 + k * 7, k, 3) * 2.0) * (1 + 0.12 * Math.sin(a * 90 + k));
      }
      const H = h * L.H;
      pos.push(Math.sin(a) * L.R, -40, Math.cos(a) * L.R); t.push(0); ang.push(a);
      pos.push(Math.sin(a) * L.R, H, Math.cos(a) * L.R); t.push(H / L.H); ang.push(a);
    }
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aT", new THREE.Float32BufferAttribute(t, 1));
    g.setAttribute("aAng", new THREE.Float32BufferAttribute(ang, 1));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, depthTest: false, depthWrite: false, fog: false,
      uniforms: { uCol: { value: L.c }, uMist: { value: HORIZON.clone() }, uSeed: { value: li * 3.7 }, uMistLine: { value: L.mist }, uTime: timeU, uWF: { value: new THREE.Vector4(wfA, hasWF ? 0.0075 + li * 0.0012 : 0.0, wfTop, hasWF ? 1 : 0) } },
      vertexShader: `attribute float aT; attribute float aAng; varying float vAng; varying float vY;
        void main(){ vAng = aAng; vY = position.y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform vec3 uCol, uMist; uniform float uSeed, uMistLine, uTime; uniform vec4 uWF; varying float vAng; varying float vY;
        ${GLSL_NOISE}
        void main(){
          float hh = clamp(vY / ${L.H.toFixed(1)}, 0.0, 1.0);
          float streak = fbm2(vec2(vAng * 30.0 + uSeed, vY * 0.03));
          float cloud = fbm2(vec2(vAng * 9.0 + uSeed * 2.0, hh * 3.0));
          // ink wash: dense ink on the crest fading to mist toward the base, with cloud bands cutting across
          float wash = smoothstep(0.0, 0.7, hh + (streak - 0.5) * 0.32);
          float band = exp(-pow((hh - uMistLine - (cloud - 0.5) * 0.18) / 0.075, 2.0));
          vec3 c = mix(uMist, uCol, wash);
          c = mix(c, uMist, band * 0.72);
          c = mix(c, uCol * 0.78, smoothstep(0.72, 1.0, hh) * 0.4 * (1.0 - band));
          c *= 0.95 + streak * 0.1;
          // waterfall: pale falling ribbon with streaks, a mist plume at its foot
          if (uWF.w > 0.5) {
            float dA = abs(mod(vAng - uWF.x + 3.14159265, 6.2831853) - 3.14159265);
            float w = uWF.y * (0.75 + 0.9 * smoothstep(uWF.z, 0.0, hh));
            float body = (1.0 - smoothstep(w * 0.55, w, dA)) * smoothstep(0.0, 0.05, uWF.z - hh);
            float foot = uMistLine - 0.02;
            body *= smoothstep(foot - 0.05, foot + 0.04, hh);
            float strk = fbm2(vec2(vAng * 900.0, vY * 0.12 - uTime * 0.9));
            float sheen = 0.55 + 0.45 * strk;
            c = mix(c, vec3(0.93, 0.95, 0.94), body * sheen * 0.9);
            float plume = (1.0 - smoothstep(0.0, w * 3.2, dA)) * exp(-pow((hh - foot) / 0.05, 2.0));
            c = mix(c, uMist * 1.1, plume * 0.45);
          }
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = -990 + li;
    mesh.frustumCulled = false;
    group.add(mesh);
  });
  group.scale.setScalar(S);
  return { group, scale: S, update(t: number) { timeU.value = t; } };
}
