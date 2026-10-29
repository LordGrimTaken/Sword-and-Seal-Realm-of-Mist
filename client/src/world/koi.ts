// Koi: a small school of paper-cut carp circling the lotus pond (vermilion, paper-white, ink, gold patches). One instanced draw call, all motion in the vertex shader.
import * as THREE from "three";
import { mulberry32 } from "./noise";
import { POND, WATER_Y } from "./terrain";
import { PAL, hex } from "./toon";

export function buildKoi(): { mesh: THREE.Mesh; update(t: number, wade: { x: number; z: number }[]): void } {
  const SEG = 12;
  const pos: number[] = [], aS: number[] = [], aV: number[] = [], idx: number[] = [];
  const prof = (s: number) => { // half-width along the body: round head, fat belly, thin peduncle, flared tail fin
    if (s < 0.62) return 0.2 * Math.sin(Math.pow(Math.min(1, s / 0.62 + 0.04), 0.7) * Math.PI * 0.92) + 0.015;
    if (s < 0.78) return 0.06 * (1 - (s - 0.62) / 0.16) + 0.04;
    return 0.04 + 0.2 * Math.pow((s - 0.78) / 0.22, 0.8) * (1 - 0.35 * Math.pow((s - 0.78) / 0.22, 4.0));
  };
  for (let i = 0; i <= SEG; i++) {
    const s = i / SEG, w = prof(s);
    for (const v of [-1, 1]) { pos.push(-(s - 0.5), 0, v * w); aS.push(s); aV.push(v); }
  }
  for (let i = 0; i < SEG; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("aS", new THREE.Float32BufferAttribute(aS, 1));
  geo.setAttribute("aV", new THREE.Float32BufferAttribute(aV, 1));
  geo.setIndex(idx);
  const N = 9, rnd = mulberry32(88);
  const inst = new Float32Array(N * 4), ic = new Float32Array(N * 3), ia = new Float32Array(N * 4);
  const palette = [hex(PAL.vermilion, PAL.paper, 0.1), hex(PAL.vermilion, PAL.gold, 0.35), hex(PAL.ink, PAL.mist, 0.1), hex(PAL.gold, PAL.paper, 0.2)];
  for (let i = 0; i < N; i++) {
    inst.set([rnd(), 3.8 + rnd() * 7.2, 0.18 + rnd() * 0.14, rnd() < 0.5 ? 1 : -1], i * 4); // phase, orbit radius, angular speed, direction
    const c = palette[i % palette.length]; ic.set([c.r, c.g, c.b], i * 3);
    ia.set([rnd(), 0.75 + rnd() * 0.5, rnd() * 6.28, 0.5 + rnd()], i * 4); // seed, length scale, wobble phase, ellipse squash
  }
  geo.setAttribute("aI", new THREE.InstancedBufferAttribute(inst, 4));
  geo.setAttribute("aC", new THREE.InstancedBufferAttribute(ic, 3));
  geo.setAttribute("aA", new THREE.InstancedBufferAttribute(ia, 4));
  geo.instanceCount = N;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uCenter: { value: new THREE.Vector3(POND.x, WATER_Y + 0.045, POND.z) }, uWade: { value: [new THREE.Vector3(0, -999, 0), new THREE.Vector3(0, -999, 0), new THREE.Vector3(0, -999, 0), new THREE.Vector3(0, -999, 0)] },
    uWater: { value: hex(PAL.jade, PAL.inkSoft, 0.5) },
  }]);
  const mat = new THREE.ShaderMaterial({
    uniforms, fog: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `
      attribute float aS; attribute float aV; attribute vec4 aI; attribute vec3 aC; attribute vec4 aA;
      uniform float uTime; uniform vec3 uCenter; uniform vec3 uWade[4];
      varying float vS; varying float vV; varying vec3 vC; varying float vSeed; varying float vFlee;
      #include <common>
      #include <fog_pars_vertex>
      vec3 pathAt(float u, float R, float sq, float dirn){
        float a = u * dirn;
        float r = R * (1.0 + 0.16 * sin(a * 2.0 + aA.z));
        return vec3(cos(a) * r, 0.0, sin(a) * r * sq * 0.8);
      }
      void main(){
        float u = aI.x * 6.2831 + uTime * aI.z;
        vec3 c = pathAt(u, aI.y, aA.w, aI.w);
        vec3 c2 = pathAt(u + 0.02, aI.y, aA.w, aI.w);
        vec3 tg = normalize(c2 - c + vec3(1e-5));
        // shy: shoved away by anyone wading nearby
        vec3 world0 = uCenter + c; float flee = 0.0; vec3 push = vec3(0.0);
        for (int k = 0; k < 4; k++){ vec3 dv = world0 - vec3(uWade[k].x, world0.y, uWade[k].z); float dd = length(dv); float f = smoothstep(5.0, 1.0, dd) * step(-500.0, uWade[k].y); push += normalize(dv + vec3(1e-4)) * f * 3.0; flee = max(flee, f); }
        vec3 head = tg * 1.0 + push * 0.4;
        float ang = atan(-head.z, head.x);
        float L = 0.95 * aA.y * (1.0 + flee * 0.15);
        float sw = sin(uTime * (4.0 + flee * 8.0) + aA.z - aS * 5.5) * (0.04 + 0.14 * aS * aS) * (1.0 + flee);
        vec3 p = vec3(position.x * L, 0.0, position.z * L * 1.0 + sw * L);
        float ca = cos(ang), sa = sin(ang);
        vec3 w = uCenter + c + push * 0.35 * smoothstep(0.0, 1.0, flee) + vec3(ca * p.x + sa * p.z, 0.0, -sa * p.x + ca * p.z);
        vS = aS; vV = aV; vC = aC; vSeed = aA.x; vFlee = flee;
        vec4 mvPosition = viewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform vec3 uWater;
      varying float vS; varying float vV; varying vec3 vC; varying float vSeed; varying float vFlee;
      #include <common>
      #include <fog_pars_fragment>
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      void main(){
        float n = vn(vec2(vS * 6.0 + vSeed * 30.0, vV * 1.3 + vSeed * 9.0));
        float pat = smoothstep(0.5, 0.58, n);
        vec3 paper = vec3(0.93, 0.9, 0.8);
        vec3 col = mix(paper, vC, pat);
        float fin = smoothstep(0.76, 0.86, vS);
        col = mix(col, mix(paper, vC, 0.4) * 1.05, fin);                  // pale translucent tail
        col *= 1.0 - 0.28 * smoothstep(0.55, 1.0, abs(vV));              // ink-dark edge
        col = mix(col, uWater, 0.28);                                      // seen through the water
        float eye = smoothstep(0.05, 0.0, abs(vS - 0.11)) * step(0.5, abs(vV)) * 0.8;
        col = mix(col, vec3(0.1), eye);
        gl_FragColor = vec4(col, 0.88);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.name = "koi";
  return {
    mesh,
    update(t, wade) {
      uniforms.uTime.value = t;
      const arr = uniforms.uWade.value as THREE.Vector3[];
      for (let i = 0; i < 4; i++) { const w = wade[i]; if (w) arr[i].set(w.x, 0, w.z); else arr[i].set(0, -999, 0); }
    },
  };
}
