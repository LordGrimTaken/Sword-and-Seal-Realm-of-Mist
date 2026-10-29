// Single full-screen ink-wash pass: depth-fog desaturation, soft ink edges, paper grain, vignette.
import * as THREE from "three";

export function createComposer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): {
  render(dt: number): void;
  resize(w: number, h: number): void;
} {
  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize(size);
  const depth = new THREE.DepthTexture(Math.max(1, size.x), Math.max(1, size.y));
  depth.type = THREE.UnsignedIntType;
  const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
    type: THREE.HalfFloatType, depthBuffer: true, depthTexture: depth, samples: 4,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });

  const mat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: {
      tColor: { value: rt.texture }, tDepth: { value: depth },
      uNear: { value: camera.near }, uFar: { value: camera.far },
      uTexel: { value: new THREE.Vector2(1 / size.x, 1 / size.y) },
      uFogNear: { value: 26 }, uFogFar: { value: 175 },
      uMist: { value: new THREE.Color(0x8fa3ad) }, uInk: { value: new THREE.Color(0x1a1a1f) }, uPaper: { value: new THREE.Color(0xf2ead8) },
      uTime: { value: 0 }, uRes: { value: new THREE.Vector2(size.x, size.y) },
      uTint: { value: new THREE.Color(1, 1, 1) }, uNight: { value: 0 }, uCamY: { value: 0 }, uUpRow: { value: new THREE.Vector3(0, 1, 0) }, uTan: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      #include <common>
      #include <packing>
      uniform sampler2D tColor; uniform sampler2D tDepth;
      uniform float uNear, uFar, uFogNear, uFogFar, uTime, uNight, uCamY; uniform vec3 uTint, uUpRow; uniform vec2 uTan; uniform vec2 uTexel, uRes; uniform vec3 uMist, uInk, uPaper;
      varying vec2 vUv;
      float lin(vec2 uv, out float sky){ float d = texture2D(tDepth, uv).x; sky = step(0.99995, d); return -perspectiveDepthToViewZ(d, uNear, uFar); }
      float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
      void main(){
        vec3 col = texture2D(tColor, vUv).rgb;
        float sky0; float d0 = lin(vUv, sky0);
        float lum0 = dot(col, vec3(0.2126, 0.7152, 0.0722));
        // --- ink edges: depth discontinuities, thicker (brush-like) up close, thinner far away ---
        float sk; float wpx = mix(1.7, 0.9, smoothstep(8.0, 70.0, d0)); vec2 o = uTexel * wpx;
        float dl = lin(vUv - vec2(o.x, 0.), sk); dl = mix(dl, d0, sk);
        float dr = lin(vUv + vec2(o.x, 0.), sk); dr = mix(dr, d0, sk);
        float du = lin(vUv + vec2(0., o.y), sk); du = mix(du, d0, sk);
        float dd = lin(vUv - vec2(0., o.y), sk); dd = mix(dd, d0, sk);
        float e = (abs(dl - dr) + abs(du - dd)) / max(d0, 0.5);
        float edge = smoothstep(0.03, 0.1, e) * (1.0 - sky0) * (1.0 - smoothstep(45.0, 150.0, d0));
        // wobble the line a little so it reads as hand-drawn (varies along the stroke)
        float wob = 0.78 + 0.34 * vn(vUv * uRes * 0.045 + 3.0);
        edge *= wob;
        // --- inner colour edges (banners, signage, face details): weak luminance sobel, near range only ---
        vec2 t1 = uTexel * 1.0;
        float lL = dot(texture2D(tColor, vUv - vec2(t1.x, 0.)).rgb, vec3(0.2126, 0.7152, 0.0722));
        float lR = dot(texture2D(tColor, vUv + vec2(t1.x, 0.)).rgb, vec3(0.2126, 0.7152, 0.0722));
        float lU = dot(texture2D(tColor, vUv + vec2(0., t1.y)).rgb, vec3(0.2126, 0.7152, 0.0722));
        float lD = dot(texture2D(tColor, vUv - vec2(0., t1.y)).rgb, vec3(0.2126, 0.7152, 0.0722));
        float ce = smoothstep(0.16, 0.42, abs(lL - lR) + abs(lU - lD)) * (1.0 - sky0) * (1.0 - smoothstep(14.0, 55.0, d0));
        // --- atmospheric perspective: distance collapses into flat blue-grey washes with few tonal bands ---
        float fogT = smoothstep(uFogNear * 0.6, uFogFar, d0) * (1.0 - sky0);
        float luma = lum0;
        vec3 wash = mix(vec3(luma), uMist * (0.5 + luma * 1.15), 0.4);
        col = mix(col, wash, fogT * 0.5);
        float farT = smoothstep(48.0, 135.0, d0) * (1.0 - sky0);
        float lq = floor(luma * 3.6 + 0.5) / 3.6;
        vec3 bands = mix(uMist * 0.7, uMist * 1.25 + vec3(0.03, 0.04, 0.05), clamp(lq * 1.1, 0.0, 1.0));
        col = mix(col, mix(col, bands, 0.7), farT * 0.55);
        // valley mist: exponential height fog rebuilt from depth, so low ground (pond, grove floor, path) fills with haze while ridges stay clear
        vec3 vpos = vec3((vUv * 2.0 - 1.0) * uTan, -1.0) * d0;
        float wy = uCamY + dot(uUpRow, vpos);
        float hfog = (1.0 - exp(-d0 * 0.011)) * smoothstep(6.5, -1.2, wy) * (1.0 - sky0);
        col = mix(col, uMist * 1.14 + vec3(0.04, 0.045, 0.05) * (1.0 - uNight), clamp(hfog * 0.6, 0.0, 0.6));
        // far layers get a cool shift, near layers keep warm paper highlights
        col = mix(col, col * vec3(0.9, 0.97, 1.1), fogT * 0.5);
        // --- gentle tonal grade: cool shadows, warm paper highlights + a little S-curve for tone separation ---
        col = mix(col, col * mix(vec3(0.94, 0.98, 1.03), vec3(1.03, 1.0, 0.95), smoothstep(0.05, 0.8, luma)), 0.7);
        // clamp before the S-curve: close to a lantern point light the HDR value exceeds 1 and the cubic flips channels (cyan / blue banding)
        vec3 cs = clamp(col, 0.0, 1.0);
        col = mix(col, cs * cs * (3.0 - 2.0 * cs) + max(col - 1.0, 0.0), 0.22 * (1.0 - fogT));
        // soft shoulder: HDR lantern light / glow cores roll off instead of clipping to white (hue-preserving)
        float pk = max(col.r, max(col.g, col.b));
        if (pk > 0.88) { float kk = (0.88 + (pk - 0.88) / (1.0 + (pk - 0.88) * 1.6)) / pk; col *= kk; }
        // time-of-day grade (dawn rose-gold, dusk vermilion bleed, night indigo)
        col *= mix(vec3(1.0), uTint, 0.85);
        // seal-red spot colour: vermilion props and wounds keep their chroma while the rest of the palette settles a touch
        float gl = dot(col, vec3(0.2126, 0.7152, 0.0722));
        float redn = clamp((col.r - max(col.g, col.b)) * 3.4, 0.0, 1.0);
        col = mix(col, vec3(gl), 0.07 * (1.0 - redn));
        col = mix(col, vec3(gl) + (col - vec3(gl)) * 1.28, redn * 0.85);
        // --- ink lines ---
        col = mix(col, uInk * 0.9, clamp(edge * 0.62 + ce * 0.32, 0.0, 0.8));
        // --- paper grain + fibres + faint wash blotches ---
        vec2 px = vUv * uRes;
        float g = h21(floor(px * 0.5) + 7.0) - 0.5;
        float fib = vn(vec2(px.x * 0.9, px.y * 0.06)) - 0.5;
        float fib2 = vn(vec2(px.x * 0.05, px.y * 0.8)) - 0.5;
        float blot = vn(px * 0.006 + 11.0) - 0.5;
        float paper = g * 0.05 + fib * 0.04 + fib2 * 0.03 + blot * 0.05;
        col *= 1.0 + paper * (0.45 + 0.55 * smoothstep(0.1, 0.7, luma));
        col = mix(col, col * uPaper * 1.08, 0.08);
        // --- vignette ---
        vec2 q = vUv - 0.5; float rr = length(q * vec2(1.0, 1.1));
        float torn = vn(px * 0.011 + 5.0) * 0.12 + vn(px * 0.065) * 0.05;   // ragged, fibrous scroll edge
        float vg = smoothstep(0.33, 0.95, rr + torn * 0.3);
        col = mix(col, col * vec3(0.7, 0.7, 0.75) + uInk * 0.03, vg * 0.6);
        float tea = smoothstep(0.64, 0.98, rr + torn * 0.5);                // tea-stained paper border
        col = mix(col, col * vec3(1.06, 0.93, 0.78), tea * 0.26 * (1.0 - uNight * 0.6));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const pscene = new THREE.Scene(); pscene.add(quad);
  const pcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let t = 0;
  return {
    render(dt: number) {
      t += dt;
      mat.uniforms.uTime.value = t;
      mat.uniforms.uNear.value = camera.near; mat.uniforms.uFar.value = camera.far;
      const f = scene.fog as THREE.Fog | null;
      if (f && (f as THREE.Fog).isFog) { mat.uniforms.uFogNear.value = f.near; mat.uniforms.uFogFar.value = f.far; mat.uniforms.uMist.value.copy(f.color); }
      const tone = scene.userData.tone as { tint: THREE.Color; night: number } | undefined;
      if (tone) { mat.uniforms.uTint.value.copy(tone.tint); mat.uniforms.uNight.value = tone.night; }
      const me = camera.matrixWorld.elements;
      mat.uniforms.uCamY.value = me[13]; mat.uniforms.uUpRow.value.set(me[1], me[5], me[9]);
      mat.uniforms.uTan.value.set(1 / camera.projectionMatrix.elements[0], 1 / camera.projectionMatrix.elements[5]);
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(pscene, pcam);
    },
    resize(w: number, h: number) {
      const pr = renderer.getPixelRatio();
      const W = Math.max(1, Math.floor(w * pr)), H = Math.max(1, Math.floor(h * pr));
      rt.setSize(W, H);
      mat.uniforms.uTexel.value.set(1 / W, 1 / H);
      mat.uniforms.uRes.value.set(W, H);
    },
  };
}
