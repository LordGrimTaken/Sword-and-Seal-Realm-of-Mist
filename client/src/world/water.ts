import * as THREE from "three";
import { HORIZON, SUN_DIR } from "./sky";
import { POND, WATER_Y, terrainHeight } from "./terrain";
import type { Tone } from "./daynight";
import { PAL, hex } from "./toon";

/** height of the ground relative to the water line over the pond (R channel, 0..1 = -0.6..+1.0 m), so the shader can draw shore lines without a depth texture */
function bakeShoreMap(extent: number, n = 112): THREE.DataTexture {
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const wx = POND.x + (x / (n - 1) - 0.5) * extent, wz = POND.z + (y / (n - 1) - 0.5) * extent;
    const h = terrainHeight(wx, wz) - WATER_Y;
    const v = Math.max(0, Math.min(1, (h + 0.6) / 1.6));
    const k = (y * n + x) * 4; d[k] = d[k + 1] = d[k + 2] = Math.round(v * 255); d[k + 3] = 255;
  }
  const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}

export function buildWater(): { mesh: THREE.Mesh; update(t: number): void; setTone(tone: Tone): void; setWaders(w: { x: number; z: number }[]): void } {
  const EXT = POND.r * 1.55 * 2;
  const g = new THREE.CircleGeometry(POND.r * 1.55, 56);
  g.rotateX(-Math.PI / 2);
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uDeep: { value: hex(PAL.jade, PAL.inkSoft, 0.62) },
      uShallow: { value: hex(PAL.jade, PAL.mist, 0.45) },
      uSky: { value: HORIZON.clone() },
      uSunDir: { value: SUN_DIR.clone() },
      uCenter: { value: new THREE.Vector2(POND.x, POND.z) },
      uShore: { value: bakeShoreMap(EXT) }, uExt: { value: EXT }, uFoam: { value: hex(PAL.paper, PAL.mistLight, 0.35) },
      uWade: { value: [new THREE.Vector2(0, -999), new THREE.Vector2(0, -999), new THREE.Vector2(0, -999), new THREE.Vector2(0, -999)] },
    },
  ]);
  const mat = new THREE.ShaderMaterial({
    uniforms, fog: true, transparent: true, depthWrite: false,
    vertexShader: `
      varying vec3 vW;
      #include <common>
      #include <fog_pars_vertex>
      void main(){
        vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uDeep, uShallow, uSky, uSunDir, uFoam; uniform vec2 uCenter; uniform vec2 uWade[4]; uniform sampler2D uShore; uniform float uExt; varying vec3 vW;
      #include <common>
      #include <fog_pars_fragment>
      float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float vnz(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hsh(i),hsh(i+vec2(1,0)),f.x), mix(hsh(i+vec2(0,1)),hsh(i+vec2(1,1)),f.x), f.y); }
      void main(){
        vec2 p = vW.xz;
        // gentle ripple normal
        float e = 0.05;
        float t = uTime;
        float h0 = vnz(p*0.9 + vec2(t*0.12, t*0.08)) + 0.5*vnz(p*2.1 - vec2(t*0.2, 0.));
        float hx = vnz((p+vec2(e,0.))*0.9 + vec2(t*0.12, t*0.08)) + 0.5*vnz((p+vec2(e,0.))*2.1 - vec2(t*0.2, 0.));
        float hz = vnz((p+vec2(0.,e))*0.9 + vec2(t*0.12, t*0.08)) + 0.5*vnz((p+vec2(0.,e))*2.1 - vec2(t*0.2, 0.));
        vec3 n = normalize(vec3(-(hx-h0)*0.35/e*0.1, 1.0, -(hz-h0)*0.35/e*0.1));
        // expanding ring ripples
        float rings = 0.0;
        for (int i=0;i<4;i++){
          float fi = float(i);
          float ct = floor(t*0.22 + fi*0.31);
          float ph = fract(t*0.22 + fi*0.31);
          vec2 c = uCenter + (vec2(hsh(vec2(ct,fi)), hsh(vec2(fi,ct+3.)))-0.5)*22.0;
          float d = distance(p, c);
          float rr = ph*3.4;
          rings += smoothstep(0.14,0.0,abs(d-rr)) * (1.0-ph) * 0.9;
        }
        // wading: concentric rings that keep spreading from anyone standing in the water
        for (int k = 0; k < 4; k++){
          float dw = distance(p, uWade[k]);
          float on = step(-500.0, uWade[k].y);
          float ring = smoothstep(0.12, 0.0, abs(fract(dw * 1.1 - t * 0.95) - 0.5)) * smoothstep(3.2, 0.2, dw) * on;
          rings += ring * 1.25 + on * smoothstep(0.7, 0.0, dw) * 0.35;
        }
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(V, n), 0.0), 2.6);
        float depthMix = smoothstep(0.0, 1.0, length(p-uCenter)/16.0);
        vec3 col = mix(uDeep, uShallow, 0.35 + 0.4*depthMix);
        col = mix(col, uSky, clamp(fres*1.1 + 0.2, 0., 0.85));
        // ink-wash drift strokes
        float s = vnz(vec2(p.x*0.35 + t*0.03, p.y*1.6));
        col = mix(col, uDeep*0.85, smoothstep(0.55,0.9,s)*0.25);
        vec3 H = normalize(V + normalize(uSunDir));
        col += vec3(1.0,0.96,0.86) * pow(max(dot(n,H),0.0), 140.0) * 0.55;
        col += uSky * rings * 0.55;
        // shore: thin broken brush lines of foam that lap in and out, and a translucent shallows
        float hv = texture2D(uShore, (p - uCenter) / uExt + 0.5).r * 1.6 - 0.6;   // ground height above the water line
        float lap = 0.05 * sin(t * 0.8 + vnz(p * 0.9) * 6.0);
        float l1 = smoothstep(0.05, 0.0, abs(hv + 0.07 + lap));
        float l2 = smoothstep(0.04, 0.0, abs(hv + 0.3 + lap * 1.6)) * 0.55;
        float brk = smoothstep(0.3, 0.62, vnz(p * vec2(2.6, 3.4) + t * 0.05));
        col = mix(col, uFoam, clamp((l1 + l2) * brk, 0.0, 1.0) * 0.75);
        float edge = 1.0 - smoothstep(18.0, 24.0, length(p-uCenter));
        float shallow = smoothstep(0.0, 0.55, -hv);
        gl_FragColor = vec4(col, mix(0.5, 0.9, shallow) * edge);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.position.set(POND.x, WATER_Y, POND.z);
  mesh.renderOrder = 2;
  mesh.name = "water";
  const deep0 = uniforms.uDeep.value.clone(), shallow0 = uniforms.uShallow.value.clone();
  const nightMul = new THREE.Color(0.35, 0.45, 0.7);
  const wc = [0, 1, 2, 3].map(() => new THREE.Vector2(0, -999));
  return {
    mesh,
    update(t) { uniforms.uTime.value = t; },
    setTone(tone: Tone) {
      uniforms.uSky.value.copy(tone.horizon);
      uniforms.uSunDir.value.copy(tone.key);
      uniforms.uDeep.value.copy(deep0).lerp(deep0.clone().multiply(nightMul), tone.night);
      uniforms.uShallow.value.copy(shallow0).lerp(shallow0.clone().multiply(nightMul), tone.night);
    },
    setWaders(w: { x: number; z: number }[]) {
      for (let i = 0; i < 4; i++) { const a = w[i]; if (a) wc[i].set(a.x, a.z); else wc[i].set(0, -999); }
      uniforms.uWade.value = wc;
    },
  };
}
