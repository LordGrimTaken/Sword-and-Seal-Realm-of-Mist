// Ambient life: drifting mist wisps, falling petals/leaves, lantern halos, boss rune ring.
import * as THREE from "three";
import { mulberry32 } from "./noise";
import { terrainHeight } from "./terrain";
import { PAL, hex } from "./toon";
import { SUN_DIR } from "./sky";
import type { Tone } from "./daynight";
import { POND, WATER_Y, GROVE } from "./terrain";

export interface AmbientOut { group: THREE.Group; update(t: number, cam: THREE.Vector3, vpHeight: number, heavyMist?: number): void; setTone(tone: Tone): void; }

function pointsMaterial(frag: string, extra: Record<string, THREE.IUniform>, vertBody: string, blending: THREE.Blending = THREE.NormalBlending): THREE.ShaderMaterial {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uPx: { value: 600 }, uLamp: { value: 0 }, uNight: { value: 0 }, uWx: { value: 0 } }, extra]);
  return new THREE.ShaderMaterial({
    uniforms, fog: true, transparent: true, depthWrite: false, blending,
    vertexShader: `
      attribute vec4 aSeed; attribute vec3 color;
      uniform float uTime; uniform vec3 uCam; uniform float uPx; uniform float uLamp; uniform float uNight; uniform float uWx;
      varying vec3 vCol; varying float vA; varying float vRot;
      #include <common>
      #include <fog_pars_vertex>
      void main(){
        vec3 wp; float size; float alpha;
        ${vertBody}
        vCol = color; vA = alpha; vRot = aSeed.w * 6.2831 + uTime * (0.4 + aSeed.x);
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(size * projectionMatrix[1][1] * uPx / max(-mvPosition.z, 0.1), 0.0, 700.0);
        #include <fog_vertex>
      }`,
    fragmentShader: `
      varying vec3 vCol; varying float vA; varying float vRot;
      #include <common>
      #include <fog_pars_fragment>
      void main(){
        vec2 pc = gl_PointCoord - 0.5;
        ${frag}
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

export interface AmbientExtras { smokes?: THREE.Vector3[]; rays?: { x: number; y: number; z: number }[] }

export function buildAmbient(lanterns: THREE.Vector3[], extras: AmbientExtras = {}): AmbientOut {
  const group = new THREE.Group();
  group.name = "ambient";
  const rnd = mulberry32(31);
  const mats: THREE.ShaderMaterial[] = [];

  // ---- mist wisps (world-anchored, wrap in 220 box) ----
  {
    const N = 46;
    const seed = new Float32Array(N * 4), base = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const c = hex(PAL.mistLight, PAL.paper, 0.2);
    for (let i = 0; i < N; i++) {
      const x = (rnd() - 0.5) * 220, z = (rnd() - 0.5) * 220;
      base.set([x, terrainHeight(x, z) + 1.5 + rnd() * 4.5, z], i * 3);
      seed.set([rnd(), rnd(), rnd(), rnd()], i * 4);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(base, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const m = pointsMaterial(
      `float d = length(pc) * 2.0; float a = smoothstep(1.0, 0.0, d); a *= a; gl_FragColor = vec4(vCol, a * vA);`,
      {},
      `wp = position; wp.x = mod(wp.x + 110.0 + uTime * (0.5 + aSeed.x * 0.9), 220.0) - 110.0;
       wp.y += sin(uTime * 0.2 + aSeed.y * 9.0) * 0.8;
       size = 22.0 + aSeed.z * 24.0;
       float edge = 1.0 - smoothstep(80.0, 110.0, abs(wp.x));
       alpha = 0.19 * (0.5 + aSeed.w * 0.5) * edge * (1.0 + 0.85 * uWx);`,
    );
    const p = new THREE.Points(g, m);
    p.frustumCulled = false; p.renderOrder = 3;
    group.add(p); mats.push(m);
  }

  // ---- petals & leaves (camera-relative volume) ----
  {
    const N = 260;
    const seed = new Float32Array(N * 4), pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const cs = [hex(PAL.paper, PAL.vermilion, 0.3), hex(PAL.paper, PAL.vermilion, 0.15), hex(PAL.jade, PAL.paper, 0.35), hex(PAL.gold, PAL.paper, 0.3), hex(PAL.vermilion, PAL.paperDark, 0.35)];
    for (let i = 0; i < N; i++) {
      seed.set([rnd(), rnd(), rnd(), rnd()], i * 4);
      const c = cs[Math.floor(rnd() * rnd() * cs.length * 1.0)];
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const m = pointsMaterial(
      `vec2 q = mat2(cos(vRot), -sin(vRot), sin(vRot), cos(vRot)) * pc;
       float k = length(vec2(q.x / 0.46, q.y / 0.2));
       float a = smoothstep(1.0, 0.8, k);
       if (a < 0.02) discard;
       gl_FragColor = vec4(vCol * (0.85 + 0.25 * (0.5 - q.y)), a * vA);`,
      {},
      `float B = 56.0;
       vec3 p = vec3(aSeed.x * B, aSeed.y * 30.0, aSeed.z * B);
       p.x += uTime * (0.8 + aSeed.w) + sin(uTime * 0.6 + aSeed.y * 20.0) * 1.6;
       p.y -= uTime * (0.7 + aSeed.x * 0.9);
       p.z += cos(uTime * 0.5 + aSeed.x * 17.0) * 1.4;
       vec3 rel = mod(p - uCam + vec3(B*0.5, 15.0, B*0.5), vec3(B, 30.0, B)) - vec3(B*0.5, 15.0, B*0.5);
       wp = uCam + rel; wp.y += 1.0;
       size = 0.34 + aSeed.w * 0.2;
       float e = max(abs(rel.x), abs(rel.z)) / (B*0.5);
       alpha = (1.0 - smoothstep(0.7, 1.0, e)) * (1.0 - smoothstep(10.0, 15.0, abs(rel.y))) * (1.0 - 0.8 * uNight);`,
    );
    const p = new THREE.Points(g, m);
    p.frustumCulled = false; p.renderOrder = 4;
    group.add(p); mats.push(m);
  }

  // ---- lantern halos ----
  {
    const N = lanterns.length;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N * 4), col = new Float32Array(N * 3);
    const warm = hex(0xf2c06a), red = hex(PAL.vermilion, PAL.gold, 0.3);
    lanterns.forEach((l, i) => {
      pos.set([l.x, l.y, l.z], i * 3);
      seed.set([rnd(), rnd(), rnd(), rnd()], i * 4);
      const c = l.y > 3.0 && (l.x === 0 || Math.abs(l.x) < 10 && l.z < -55 && l.z > -64) ? red : warm;
      col.set([c.r, c.g, c.b], i * 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const m = pointsMaterial(
      `float d = length(pc) * 2.0; float a = pow(smoothstep(1.0, 0.0, d), 2.0); gl_FragColor = vec4(vCol, a * vA);`,
      {},
      `wp = position;
       size = (2.7 + sin(uTime * 2.0 + aSeed.x * 40.0) * 0.14 + aSeed.y * 0.25) * (1.0 + 0.55 * uLamp);
       alpha = (0.32 + 0.06 * sin(uTime * 3.1 + aSeed.z * 40.0)) * (1.0 + 1.0 * uLamp);`,
    );
    m.fog = false;
    const p = new THREE.Points(g, m);
    p.frustumCulled = false; p.renderOrder = 5;
    group.add(p); mats.push(m);
  }


  // ---- drifting lantern sparks: a few warm embers lift off every lit lantern and fade (additive, one draw call) ----
  {
    const per = 3, N = lanterns.length * per;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N * 4), col = new Float32Array(N * 3);
    const gold = hex(0xf2c06a, PAL.gold, 0.3);
    lanterns.forEach((l, i) => {
      for (let k = 0; k < per; k++) { const j = i * per + k; pos.set([l.x, l.y + 0.1, l.z], j * 3); seed.set([rnd(), rnd(), rnd(), rnd()], j * 4); col.set([gold.r, gold.g, gold.b], j * 3); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const m = pointsMaterial(
      `float d = length(pc) * 2.0; float a = pow(smoothstep(1.0, 0.0, d), 2.2); gl_FragColor = vec4(vCol, a * vA);`,
      {},
      `float life = fract(uTime * (0.16 + aSeed.y * 0.12) + aSeed.x);
       wp = position;
       wp.y += life * (1.6 + aSeed.z * 1.8);
       wp.x += sin(uTime * 1.3 + aSeed.w * 20.0 + life * 5.0) * 0.28 * life;
       wp.z += cos(uTime * 1.1 + aSeed.y * 20.0 + life * 4.0) * 0.28 * life;
       size = 0.07 + aSeed.z * 0.05;
       float dc = distance(wp, uCam);
       alpha = sin(life * 3.14159) * 0.8 * (1.0 - smoothstep(26.0, 48.0, dc)) * (0.7 + 0.9 * uLamp);`,
      THREE.AdditiveBlending,
    );
    m.fog = false;
    const p = new THREE.Points(g, m);
    p.frustumCulled = false; p.renderOrder = 5; p.name = "lanternSparks";
    group.add(p); mats.push(m);
  }

  // ---- incense smoke columns ----
  const smokes = extras.smokes ?? [];
  if (smokes.length) {
    const per = 16, N = smokes.length * per;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N * 4), col = new Float32Array(N * 3);
    const c = hex(PAL.mistLight, PAL.paper, 0.35);
    smokes.forEach((sp, si) => {
      for (let i = 0; i < per; i++) { const k = si * per + i; pos.set([sp.x, sp.y, sp.z], k * 3); seed.set([i / per, rnd(), rnd(), rnd()], k * 4); col.set([c.r, c.g, c.b], k * 3); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const m = pointsMaterial(
      `float d = length(pc) * 2.0; float a = smoothstep(1.0, 0.0, d); a = a * a; gl_FragColor = vec4(vCol, a * vA);`,
      {},
      `float life = fract(uTime * 0.16 + aSeed.x);
       wp = position;
       float drift = life * life;
       wp.x += sin(uTime * 0.7 + aSeed.y * 6.0 + life * 5.0) * 0.5 * drift * 2.0 + drift * 1.2;
       wp.z += cos(uTime * 0.6 + aSeed.z * 6.0 + life * 4.0) * 0.5 * drift * 2.0;
       wp.y += life * 5.2;
       size = 1.2 + life * 3.6;
       alpha = (1.0 - life) * smoothstep(0.0, 0.1, life) * 0.3;`,
    );
    const p = new THREE.Points(g, m);
    p.frustumCulled = false; p.renderOrder = 4;
    group.add(p); mats.push(m);
  }

  // ---- god rays: camera-facing light shafts slanting along the sun direction, anchored over the shrine / gate / pond ----
  let raysMat: THREE.ShaderMaterial | null = null;
  const rayAnch = [...(extras.rays ?? []), { x: -6, y: 11, z: -58 }, { x: 8, y: 10, z: -40 }, { x: -26, y: 12, z: -70 }, { x: 40, y: 14, z: 30 }, { x: -30, y: 14, z: 5 }];
  {
    const pos: number[] = [], aT: number[] = [], aS: number[] = [], aD: number[] = [], aP: number[] = [], idx: number[] = [];
    rayAnch.forEach((a, i) => {
      for (let k = 0; k < 3; k++) {
        const ox = (rnd() - 0.5) * 7, oz = (rnd() - 0.5) * 7;
        const base = pos.length / 3;
        const w = 1.2 + rnd() * 2.4, L = 20 + rnd() * 12;
        for (const [t, sd] of [[0, -1], [0, 1], [1, -1], [1, 1]]) { pos.push(a.x + ox, a.y, a.z + oz); aT.push(t); aS.push(sd * w); aD.push(L, 0, 0); aP.push(rnd() * 6.28 + i); }
        idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aT", new THREE.Float32BufferAttribute(aT, 1));
    g.setAttribute("aS", new THREE.Float32BufferAttribute(aS, 1));
    g.setAttribute("aD", new THREE.Float32BufferAttribute(aD, 3));
    g.setAttribute("aP", new THREE.Float32BufferAttribute(aP, 1));
    g.setIndex(idx);
    const rm = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uTime: { value: 0 }, uCol: { value: hex(0xffe9b8) }, uRayDir: { value: SUN_DIR.clone().multiplyScalar(-1) }, uRayK: { value: 1 } },
      vertexShader: `attribute float aT; attribute float aS; attribute vec3 aD; attribute float aP; uniform float uTime; uniform vec3 uRayDir; varying float vT; varying float vS; varying float vI;
        void main(){
          vec3 axis = uRayDir * aD.x; vec3 p = position + axis * aT;
          vec3 toCam = normalize(cameraPosition - p);
          vec3 side = normalize(cross(normalize(axis), toCam));
          p += side * aS * (0.55 + 0.9 * aT);
          vT = aT; vS = aS / max(abs(aS), 0.001);
          vI = 0.55 + 0.45 * sin(uTime * 0.35 + aP) * sin(uTime * 0.21 + aP * 2.3);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `uniform vec3 uCol; uniform float uRayK; varying float vT; varying float vS; varying float vI;
        void main(){
          float across = 1.0 - smoothstep(0.0, 1.0, abs(vS));
          float along = smoothstep(0.0, 0.18, vT) * (1.0 - smoothstep(0.55, 1.0, vT));
          float a = along * across * vI * 0.16 * uRayK;
          gl_FragColor = vec4(uCol, a);
          #include <colorspace_fragment>
        }`,
    });
    raysMat = rm; mats.push(rm);
    const rays = new THREE.Mesh(g, rm);
    rays.frustumCulled = false; rays.renderOrder = 4; rays.name = "godrays";
    group.add(rays);
  }

  // ---- low mist sheets (world-noise, follow the camera) ----
  const sheets: THREE.Mesh[] = [];
  const sheetMats: THREE.ShaderMaterial[] = [];
  const sheetBase: number[] = [];   // calm-weather alpha of each haze sheet, so heavy weather can thicken them
  {
    const sg = new THREE.PlaneGeometry(420, 420, 1, 1); sg.rotateX(-Math.PI / 2);
    for (const [y, a, sc, sp] of [[1.1, 0.5, 0.028, 0.5], [3.4, 0.32, 0.019, 0.35], [6.2, 0.2, 0.012, 0.25]] as number[][]) {
      const mm = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, fog: false,
        uniforms: { uTime: { value: 0 }, uA: { value: a }, uSc: { value: sc }, uSp: { value: sp }, uCol: { value: hex(PAL.mistLight, PAL.paper, 0.12) } },
        vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `uniform float uTime, uA, uSc, uSp; uniform vec3 uCol; varying vec3 vW;
          float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
          float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
          float fb(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*vn(p); p*=2.03; a*=.5; } return s; }
          void main(){
            vec2 p = vW.xz * uSc + vec2(uTime * 0.012 * uSp, uTime * 0.007 * uSp);
            float n = fb(p) * 0.65 + fb(p * 2.7 + 9.0) * 0.35;
            float d = length(vW.xz - cameraPosition.xz);
            float fade = smoothstep(6.0, 28.0, d) * (1.0 - smoothstep(110.0, 200.0, d));
            float dy = abs(cameraPosition.y - vW.y);
            float near = smoothstep(0.4, 3.0, dy);   // vanish when the camera sits inside the sheet
            float a = smoothstep(0.42, 0.78, n) * uA * fade * near;
            gl_FragColor = vec4(uCol, a);
            #include <colorspace_fragment>
          }`,
      });
      const sh = new THREE.Mesh(sg, mm);
      sh.position.y = y; sh.renderOrder = 2; sh.frustumCulled = false; sh.name = "mistsheet";
      group.add(sh); sheets.push(sh); mats.push(mm); sheetMats.push(mm); sheetBase.push(a);
    }
  }


  // ---- fireflies: jade-gold motes that blink over the pond, reeds, bamboo grove and path at dusk and night (additive, one draw call) ----
  {
    const spots: [number, number, number, number, number][] = [ // cx, cz, radius, count, minY above ground
      [POND.x, POND.z, 17, 46, 0.5], [(GROVE.x0 + GROVE.x1) / 2, (GROVE.z0 + GROVE.z1) / 2, 24, 56, 0.4], [0, -62, 9, 14, 0.7], [0, 20, 14, 18, 0.5], [8, 66, 9, 12, 0.7],
    ];
    const total = spots.reduce((a, b) => a + b[3], 0);
    const pos = new Float32Array(total * 3), seed = new Float32Array(total * 4), col = new Float32Array(total * 3);
    const cj = hex(0xc8f0a0), cg = hex(0xf2d98a);
    let k = 0;
    for (const [cx, cz, R, n, y0] of spots) {
      for (let i = 0; i < n; i++, k++) {
        const a = rnd() * 6.283, rr = Math.sqrt(rnd()) * R;
        const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
        const gy = Math.max(terrainHeight(x, z), WATER_Y);
        pos.set([x, gy + y0 + rnd() * 1.7, z], k * 3);
        seed.set([rnd(), rnd(), rnd(), rnd()], k * 4);
        const c = rnd() < 0.6 ? cj : cg; col.set([c.r, c.g, c.b], k * 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const m = pointsMaterial(
      `float d = length(pc) * 2.0; float a = pow(smoothstep(1.0, 0.0, d), 1.7); gl_FragColor = vec4(vCol * (1.0 + 0.7 * smoothstep(0.35, 0.0, d)), a * vA);`,
      {},
      `float ph = aSeed.w * 6.283;
       wp = position;
       wp.x += sin(uTime * (0.25 + aSeed.x * 0.25) + ph) * 1.6 + sin(uTime * 0.9 + ph * 3.0) * 0.25;
       wp.z += cos(uTime * (0.21 + aSeed.y * 0.25) + ph * 1.7) * 1.6 + cos(uTime * 0.8 + ph) * 0.25;
       wp.y += sin(uTime * (0.4 + aSeed.z * 0.3) + ph) * 0.45;
       float blink = pow(max(0.0, sin(uTime * (0.9 + aSeed.x * 0.9) + ph * 5.0)), 2.0);
       size = 0.2 + aSeed.z * 0.1;
       float dc = distance(wp, uCam);
       float on = smoothstep(0.1, 0.55, uNight + uLamp * 0.25);
       alpha = blink * on * 0.95 * (1.0 - smoothstep(28.0, 55.0, dc));`,
      THREE.AdditiveBlending,
    );
    m.fog = false;
    const p = new THREE.Points(g, m);
    p.frustumCulled = false; p.renderOrder = 5; p.name = "fireflies";
    group.add(p); mats.push(m);
  }

  // ---- lantern ground pools: soft warm light pooled on the path under every lantern (additive decals replace extra point lights) ----
  const pools = (() => {
    const N = lanterns.length;
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    const pm = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      uniforms: { uLamp: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `attribute vec3 instCol; varying vec2 vUv; varying vec3 vC; varying float vR; void main(){ vUv = uv; vC = instCol; vec4 ip = instanceMatrix * vec4(position, 1.0); vR = instanceMatrix[0][0]; gl_Position = projectionMatrix * viewMatrix * modelMatrix * ip; }`,
      fragmentShader: `uniform float uLamp, uTime; varying vec2 vUv; varying vec3 vC; varying float vR;
        void main(){
          vec2 q = vUv - 0.5; float d = length(q) * 2.0;
          float rib = 0.85 + 0.15 * sin(atan(q.y, q.x) * 12.0); // paper-lantern ribs projected on the stone
          float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.0) * rib * smoothstep(0.3, 0.95, uLamp) * 0.3;
          gl_FragColor = vec4(vC * a, a);
          #include <colorspace_fragment>
        }`,
    });
    const im = new THREE.InstancedMesh(geo, pm, Math.max(1, N));
    const colAttr = new Float32Array(Math.max(1, N) * 3);
    const M4 = new THREE.Matrix4(), V3 = new THREE.Vector3(), Sc = new THREE.Vector3(), Q = new THREE.Quaternion();
    lanterns.forEach((l, i) => {
      const gy = terrainHeight(l.x, l.z);
      const s = 5.2 + (i % 3) * 0.6;
      M4.compose(V3.set(l.x, gy + 0.2, l.z), Q, Sc.set(s, 1, s)); im.setMatrixAt(i, M4);
      const c = i % 7 === 0 ? hex(0xe0553f, 0xf2c06a, 0.5) : hex(0xf2c06a);
      colAttr.set([c.r, c.g, c.b], i * 3);
    });
    geo.setAttribute("instCol", new THREE.InstancedBufferAttribute(colAttr, 3));
    im.frustumCulled = false; im.renderOrder = 1; im.name = "lanternPools"; im.visible = false;
    group.add(im);
    return { im, pm };
  })();

  let tone: Tone | null = null;

  // ---- boss courtyard rune ring ----
  const cv = document.createElement("canvas"); cv.width = cv.height = 512;
  const c2 = cv.getContext("2d")!;
  c2.translate(256, 256); c2.strokeStyle = "#e0553f"; c2.lineCap = "round"; c2.lineWidth = 4;
  for (const r of [236, 200]) { c2.beginPath(); c2.arc(0, 0, r, 0, Math.PI * 2); c2.stroke(); }
  c2.lineWidth = 6;
  for (let i = 0; i < 24; i++) { // rune ticks
    c2.save(); c2.rotate((i / 24) * Math.PI * 2); c2.translate(0, -218);
    c2.beginPath(); c2.moveTo(-9, -12); c2.lineTo(9, -12); c2.moveTo(0, -12); c2.lineTo(0, 12); if (i % 3 === 0) { c2.moveTo(-9, 12); c2.lineTo(9, 4); } c2.stroke(); c2.restore();
  }
  c2.lineWidth = 3;
  c2.beginPath();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 - Math.PI / 2; c2.lineTo(Math.cos(a) * 150, Math.sin(a) * 150); }
  c2.closePath(); c2.stroke();
  c2.beginPath();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6 - Math.PI / 2; c2.lineTo(Math.cos(a) * 150, Math.sin(a) * 150); }
  c2.closePath(); c2.stroke();
  const rt = new THREE.CanvasTexture(cv); rt.colorSpace = THREE.SRGBColorSpace;
  const runeMat = new THREE.MeshBasicMaterial({ map: rt, transparent: true, depthWrite: false, opacity: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const rune = new THREE.Mesh(new THREE.PlaneGeometry(17.4, 17.4), runeMat);
  rune.rotation.x = -Math.PI / 2;
  rune.position.set(0, terrainHeight(0, 84) + 0.06, 84);
  rune.renderOrder = 1;
  group.add(rune);

  return {
    group,
    setTone(tn: Tone) { tone = tn; },
    update(t, cam, vpHeight, heavyMist = 0) {
      const lamp = tone?.lamp ?? 0, night = tone?.night ?? 0;
      pools.pm.uniforms.uLamp.value = lamp; pools.im.visible = lamp > 0.02;
      if (raysMat) { raysMat.uniforms.uRayK.value = tone?.rays ?? 1; if (tone) { raysMat.uniforms.uRayDir.value.copy(tone.key).multiplyScalar(-1); raysMat.uniforms.uCol.value.copy(tone.sunCol).lerp(hex(0xffffff), 0.35); } }
      for (const sm of sheetMats) if (tone) sm.uniforms.uCol.value.copy(tone.horizon).lerp(hex(PAL.paper), 0.18 * (1 - night));
      sheetMats.forEach((sm, i) => { sm.uniforms.uA.value = Math.min(0.8, sheetBase[i] * (1 + 1.8 * heavyMist)); });
      for (const m of mats) { if (m.uniforms.uLamp) { m.uniforms.uLamp.value = lamp; m.uniforms.uNight.value = night; } if (m.uniforms.uWx) m.uniforms.uWx.value = heavyMist; m.uniforms.uTime.value = t; if (m.uniforms.uCam) m.uniforms.uCam.value.copy(cam); if (m.uniforms.uPx) m.uniforms.uPx.value = vpHeight * 0.5; }
      for (const sh of sheets) { sh.position.x = cam.x; sh.position.z = cam.z; }
      runeMat.opacity = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(t * 1.4));
      rune.rotation.z = t * 0.05;
    },
  };
}


