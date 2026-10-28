import * as THREE from "three";
import { HORIZON, SUN_DIR } from "./sky";
import { POND, WATER_Y } from "./terrain";
import { PAL, hex } from "./toon";

export function buildWater(): { mesh: THREE.Mesh; update(t: number): void } {
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
      uniform float uTime; uniform vec3 uDeep, uShallow, uSky, uSunDir; uniform vec2 uCenter; varying vec3 vW;
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
        float edge = 1.0 - smoothstep(18.0, 24.0, length(p-uCenter));
        gl_FragColor = vec4(col, 0.9 * edge);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.position.set(POND.x, WATER_Y, POND.z);
  mesh.renderOrder = 2;
  mesh.name = "water";
  return { mesh, update(t) { uniforms.uTime.value = t; } };
}
