// Pooled point-sprite particle system (soft glow or ink-splat shaped), CPU simulated.
import * as THREE from "three";

export class Particles {
  readonly points: THREE.Points;
  private n: number;
  private pos: Float32Array; private col: Float32Array; private size: Float32Array; private alpha: Float32Array; private seed: Float32Array;
  private vel: Float32Array; private life: Float32Array; private max: Float32Array; private s0: Float32Array; private s1: Float32Array; private a0: Float32Array;
  private drag: Float32Array; private grav: Float32Array;
  private head = 0;
  private mat: THREE.ShaderMaterial;
  private geo = new THREE.BufferGeometry();
  private tmp = new THREE.Vector2();

  constructor(parent: THREE.Object3D, n: number, additive: boolean, ink: boolean) {
    this.n = n;
    this.pos = new Float32Array(n * 3).fill(0); this.col = new Float32Array(n * 3); this.size = new Float32Array(n); this.alpha = new Float32Array(n); this.seed = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n).fill(0); this.max = new Float32Array(n).fill(1); this.s0 = new Float32Array(n); this.s1 = new Float32Array(n);
    this.a0 = new Float32Array(n); this.drag = new Float32Array(n); this.grav = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.seed[i] = Math.random(); this.pos[i * 3 + 1] = -999; }
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aSeed", new THREE.BufferAttribute(this.seed, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uPx: { value: 400 }, uInk: { value: ink ? 1 : 0 } },
      vertexShader: `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha; attribute float aSeed;
        uniform float uPx; varying vec3 vC; varying float vA; varying float vS;
        void main(){
          vC = aColor; vA = aAlpha; vS = aSeed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * projectionMatrix[1][1] * uPx / max(-mv.z, 0.1), 0.0, 256.0);
        }`,
      fragmentShader: `
        uniform float uInk; varying vec3 vC; varying float vA; varying float vS;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){
          vec2 pc = gl_PointCoord - 0.5;
          float d = length(pc) * 2.0;
          float a;
          if (uInk > 0.5) {
            float ang = atan(pc.y, pc.x);
            float edge = 0.62 + 0.3 * vn(vec2(ang * 2.2 + vS * 40.0, vS * 9.0)) + 0.1 * sin(ang * 5.0 + vS * 30.0);
            a = smoothstep(edge, edge - 0.18, d);
          } else {
            a = pow(clamp(1.0 - d, 0.0, 1.0), 1.6);
          }
          if (a < 0.01) discard;
          gl_FragColor = vec4(vC, a * vA);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    this.points.onBeforeRender = (r) => { r.getDrawingBufferSize(this.tmp); this.mat.uniforms.uPx.value = this.tmp.y * 0.5; };
    parent.add(this.points);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, color: THREE.Color, alpha = 1, drag = 0, grav = 0): void {
    const i = this.head; this.head = (this.head + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = alpha; this.drag[i] = drag; this.grav[i] = grav;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.size[i] = s0; this.alpha[i] = alpha;
  }

  update(dt: number): void {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.size[i] = 0; this.pos[i * 3 + 1] = -999; continue; }
      const u = 1 - this.life[i] / this.max[i];
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * u;
      this.alpha[i] = this.a0[i] * (u < 0.1 ? u / 0.1 : 1 - Math.pow((u - 0.1) / 0.9, 1.5));
    }
    const g = this.geo;
    (g.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute("aColor") as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute("aSize") as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute("aAlpha") as THREE.BufferAttribute).needsUpdate = true;
  }
}
