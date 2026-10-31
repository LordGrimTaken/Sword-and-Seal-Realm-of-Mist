// JIUZHOU world: Cloudmist Valley
import * as THREE from "three";
import { buildAmbient } from "./ambient";
import { buildWeather } from "./weather";
import { buildGround } from "./ground";
import { buildMountains, buildSky, HORIZON, SUN_DIR } from "./sky";
import { buildStructures } from "./structures";
import { buildTerrain, heightAt, POND, WATER_Y } from "./terrain";
import { buildVegetation } from "./vegetation";
import { buildCranes } from "./cranes";
import { buildWater } from "./water";
import { PAL, hex } from "./toon";
import { buildKoi } from "./koi";
import { createDayNight } from "./daynight";
import { updateWind } from "./wind";
import { buildHallAir, inSunkenHall, sunkenHallInfluence, HALL_FOG, HALL_LIGHT } from "./hall";
import { settings } from "../ui/settings";

export { heightAt };

export function createWorld(scene: THREE.Scene, renderer: THREE.WebGLRenderer): {
  update(dt: number, camPos: THREE.Vector3): void;
  /** local player (and optionally others) so the pond can ripple around anyone wading and the koi can shy away */
  focus(actors: { x: number; z: number }[]): void;
  heightAt(x: number, z: number): number;
  /** which named region of the world a point is in (rect test, no allocation) — the HUD zone label uses this */
  regionAt(x: number, z: number): "hall" | "valley";
} {
  const root = new THREE.Group();
  root.name = "jiuzhou-world";
  scene.add(root);

  scene.background = HORIZON.clone();
  scene.fog = new THREE.Fog(HORIZON.clone(), 26, 175);

  // lights: hemisphere + sun + 3 cheap lantern point lights = 4 dynamic lights total (1 hemi, 1 dir, 3 point)
  const hemi = new THREE.HemisphereLight(hex(PAL.mistLight, PAL.paper, 0.3), hex(PAL.paperDark, PAL.mist, 0.5), 1.45);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(hex(PAL.paper, PAL.gold, 0.08), 1.8);
  sun.position.copy(SUN_DIR).multiplyScalar(100);
  root.add(sun);

  const sky = buildSky();
  const mountains = buildMountains();
  root.add(sky, mountains.group);

  const terrain = buildTerrain();
  const structures = buildStructures();
  const veg = buildVegetation();
  const water = buildWater();
  const cranes = buildCranes();
  const koi = buildKoi();
  const ambient = buildAmbient(structures.lanterns, { smokes: structures.smokes, rays: structures.rays });
  const weather = buildWeather();
  const hallAir = buildHallAir();
  root.add(terrain, buildGround(), structures.group, veg.group, water.mesh, koi.mesh, ambient.group, cranes.mesh, weather.group, hallAir.group);

  const dayNight = createDayNight({
    scene, hemi, sun, sky, mountains: mountains.group,
    apply(tone) { water.setTone(tone); ambient.setTone(tone); },
  });
  let todClock = 0;
  let waders: { x: number; z: number }[] = [], wading: { x: number; z: number }[] = [];

  const lights: THREE.PointLight[] = [];
  for (let i = 0; i < 3; i++) {
    const l = new THREE.PointLight(0xefae5c, 7.5, 15, 2);
    l.position.set(0, -50, 0);
    root.add(l);
    lights.push(l);
  }
  const targets = lights.map(() => new THREE.Vector3(0, -50, 0));

  let time = 0, lightClock = 0;
  const size = new THREE.Vector2();
  const lan = structures.lanterns;
  const tmp = new THREE.Vector3();

  function pickLights(cam: THREE.Vector3) {
    // nearest three lanterns that are close to the camera's ground focus (cam looks down, so use xz)
    const best: { d: number; i: number }[] = [];
    for (let i = 0; i < lan.length; i++) {
      const dx = lan[i].x - cam.x, dz = lan[i].z - cam.z;
      const d = dx * dx + dz * dz;
      if (best.length < 3) { best.push({ d, i }); best.sort((a, b) => a.d - b.d); }
      else if (d < best[2].d) { best[2] = { d, i }; best.sort((a, b) => a.d - b.d); }
    }
    best.forEach((b, k) => { targets[k].copy(lan[b.i]); });
  }

  return {
    heightAt,
    regionAt(x, z) { return inSunkenHall(x, z) ? "hall" : "valley"; },
    focus(actors) { waders = actors; },
    update(dt: number, camPos: THREE.Vector3) {
      time += dt;
      todClock += dt;
      if (todClock > 0.2) { dayNight.update(todClock); todClock = 0; }
      updateWind(time);
      wading = waders.filter((a) => heightAt(a.x, a.z) < WATER_Y + 0.12 && Math.hypot(a.x - POND.x, a.z - POND.z) < POND.r * 1.5);
      water.setWaders(wading); koi.update(time, wading);
      lightClock -= dt;
      if (lightClock <= 0) { lightClock = 0.35; pickLights(camPos); }
      for (let k = 0; k < 3; k++) {
        tmp.copy(targets[k]);
        lights[k].position.lerp(tmp, Math.min(1, dt * 6));
        lights[k].intensity = 7.5 * (1 + 0.9 * dayNight.tone.lamp) * (0.93 + 0.07 * Math.sin(time * 5.3 + k * 2.1));
      }
      // skybox-style layers follow camera (parallax-correct)
      sky.position.copy(camPos);
      (sky.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
      mountains.group.position.set(camPos.x * (1 - mountains.scale), camPos.y * (1 - mountains.scale) - 6, camPos.z * (1 - mountains.scale));
      veg.update(time);
      structures.update(time);
      cranes.update(time);
      mountains.update(time);
      water.update(time);
      renderer.getDrawingBufferSize(size);
      weather.update(time, dt, camPos, dayNight.tone);
      ambient.update(time, camPos, size.y, weather.mist);
      // P3: the Sunken Hall is the valley's second region — inside it the fog, hemisphere and key light cool
      // and darken a little. The base colour still comes from the day/night tone, and weather keeps its own mist.
      const hallIn = sunkenHallInfluence(camPos.x, camPos.z);
      hallAir.update(time, hallIn, settings.get().reduceMotion);
      const dayTone = dayNight.tone, fog = scene.fog as THREE.Fog;
      fog.color.copy(dayTone.horizon).lerp(HALL_FOG, 0.55 * hallIn);
      hemi.color.copy(dayTone.hemiSky).lerp(HALL_LIGHT, 0.35 * hallIn);
      hemi.groundColor.copy(dayTone.hemiGround).lerp(HALL_FOG, 0.3 * hallIn);
      sun.color.copy(dayTone.sunCol).lerp(HALL_LIGHT, 0.25 * hallIn);
    },
  };
}

