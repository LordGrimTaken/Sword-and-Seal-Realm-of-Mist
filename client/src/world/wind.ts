// Shared wind field: one time + direction uniform for every swaying thing (grass, bamboo, reeds, canopies) and the cloud-shadow drift.
// A gust is a slow travelling wave front that sweeps across the valley, so neighbouring plants bend together and the meadow visibly ripples.
import * as THREE from "three";

export const WIND = {
  time: { value: 0 },
  dir: { value: new THREE.Vector2(0.82, 0.57).normalize() },
};

const GLSL_WIND = `
uniform float uWT; uniform vec2 uWDir;
float jzGust(vec2 p){
  float x = dot(p, uWDir) * 0.045 - uWT * 0.55;
  float g = sin(x) + 0.55 * sin(x * 2.3 + 1.7 + 0.02 * p.y);
  return smoothstep(0.15, 1.45, g);
}`;

export interface WindOpts {
  /** local-space height of the mesh (sway grows with the square of height / this) */
  height: number;
  /** peak bend in local units at the top while a gust passes */
  amp: number;
  /** idle sway (without gust) as a fraction of amp */
  idle?: number;
}

/**
 * Patch a toon/standard material so its instances lean downwind as a gust passes. Chains with an existing onBeforeCompile and any earlier vertex
 * sway (the patch just adds offset to `transformed` right before projection). Instanced meshes only.
 */
export function applyWind(m: THREE.Material, o: WindOpts): void {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (s, r) => {
    prev?.call(m, s, r);
    s.uniforms.uWT = WIND.time; s.uniforms.uWDir = WIND.dir;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", `#include <common>\n${GLSL_WIND}`)
      .replace("#include <project_vertex>", `
        #ifdef USE_INSTANCING
        {
          vec3 jIp = vec3(instanceMatrix[3]);
          mat3 jIm = mat3(instanceMatrix);
          float jS2 = max(dot(jIm[0], jIm[0]), 1e-4);
          float jg = jzGust(jIp.xz);
          float jh = clamp(position.y / ${o.height.toFixed(2)}, 0.0, 1.0);
          float jph = jIp.x * 0.37 + jIp.z * 0.51;
          float jb = (jg + ${(o.idle ?? 0.25).toFixed(3)} * (0.6 + 0.4 * sin(uWT * 1.35 + jph))) * jh * jh * ${o.amp.toFixed(3)};
          vec3 jw = vec3(uWDir.x, 0.0, uWDir.y) * jb;
          transformed += vec3(dot(jIm[0], jw), dot(jIm[1], jw), dot(jIm[2], jw)) / jS2;
          transformed.y -= abs(jb) * 0.12 * jh;
        }
        #endif
        #include <project_vertex>`);
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey() : "") + `|wind${o.height}|${o.amp}|${o.idle ?? 0.25}`;
}

export function updateWind(t: number): void { WIND.time.value = t; }
