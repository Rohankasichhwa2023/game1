// waterMat.js — the water surface: one small shader for the sea, the far
// ocean and London's river.
//
// Cheap on purpose (no reflection / refraction render passes): the waves are
// a handful of travelling sine swells + ripples summed into a surface normal
// per pixel; that normal drives a Fresnel blend between the deep water colour
// and the reflected sky, plus a sharp sun glint on the crests. The fine
// ripples fade out with distance so the far sea doesn't shimmer and alias.
// Scene fog and the day / night light are matched every frame.
import { scene, sun, hemi } from "./engine.js";

BABYLON.Effect.ShadersStore.seaVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vPos;
void main() {
  vec4 wp = world * vec4(position, 1.0);
  vPos = wp.xyz;
  gl_Position = viewProjection * wp;
}`;

BABYLON.Effect.ShadersStore.seaFragmentShader = `
precision highp float;
varying vec3 vPos;
uniform float time;
uniform vec3 camPos;
uniform vec3 toSun;
uniform float sunPower;
uniform float dayLight;
uniform vec3 skyColor;
uniform vec3 fogColor;
uniform vec2 fogRange;
uniform vec3 deepColor;
uniform vec3 shallowColor;

// slope (dh/dx, dh/dz) of one travelling wave
vec2 wave(vec2 p, vec2 dir, float freq, float amp, float speed) {
  float ph = dot(p, dir) * freq + time * speed;
  return dir * (cos(ph) * freq * amp);
}
void main() {
  vec2 p = vPos.xz;
  vec3 toCam = camPos - vPos;
  float dist = length(toCam);
  float near = clamp(1.0 - dist / 260.0, 0.0, 1.0);       // fine ripples only up close
  vec2 g = wave(p, vec2(0.96, 0.28), 0.21, 0.09, 1.05)        // long swell
         + wave(p, vec2(-0.37, 0.93), 0.33, 0.055, 1.4)
         + wave(p, vec2(0.62, -0.78), 0.71, 0.022, 2.1)
         + near * (wave(p, vec2(-0.88, -0.47), 1.6, 0.010, 3.2)
                 + wave(p, vec2(0.21, 0.98), 2.7, 0.0055, 4.1)
                 + wave(p + vec2(13.0, 7.0), vec2(0.71, 0.70), 4.3, 0.003, 5.3));
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 v = toCam / max(dist, 0.001);
  float ndv = max(dot(n, v), 0.0);
  float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
  vec3 r = reflect(-v, n);
  // reflected sky: a bit brighter toward the horizon
  vec3 sky = skyColor * mix(1.12, 0.82, clamp(r.y, 0.0, 1.0));
  // body colour: deeper where the surface faces you, lighter on the slopes of the swell
  float crest = clamp(0.5 + (g.x + g.y) * 2.2, 0.0, 1.0);
  vec3 body = mix(deepColor, shallowColor, 0.25 + 0.45 * crest) * dayLight;
  vec3 col = mix(body, sky, clamp(fres, 0.0, 1.0));
  // sun glint
  float s = pow(max(dot(r, toSun), 0.0), 220.0) * sunPower;
  col += vec3(1.0, 0.95, 0.85) * s * (0.5 + 0.5 * near);
  float f = clamp((fogRange.y - dist) / max(fogRange.y - fogRange.x, 1.0), 0.0, 1.0);
  gl_FragColor = vec4(mix(fogColor, col, f), 1.0);
}`;

const mats = [];
export function makeWaterMat(name, zOffset = 0) {
  const m = new BABYLON.ShaderMaterial(name, scene, { vertex: "sea", fragment: "sea" }, {
    attributes: ["position"],
    uniforms: ["world", "viewProjection", "time", "camPos", "toSun", "sunPower", "dayLight", "skyColor", "fogColor", "fogRange", "deepColor", "shallowColor"],
  });
  m.zOffset = zOffset;
  m.backFaceCulling = false;
  m.setColor3("deepColor", new BABYLON.Color3(0.05, 0.22, 0.32));
  m.setColor3("shallowColor", new BABYLON.Color3(0.13, 0.42, 0.5));
  // camera position at the moment it's drawn (indoor rendering shifts the camera)
  m.onBindObservable.add(() => {
    const c = scene.activeCamera;
    if (c) m.getEffect().setVector3("camPos", c.globalPosition);
  });
  mats.push(m);
  update(m, 0);
  return m;
}
let t = 0;
function update(m) {
  const d = sun.direction;
  m.setFloat("time", t);
  m.setVector3("toSun", new BABYLON.Vector3(-d.x, -d.y, -d.z).normalize());
  m.setFloat("sunPower", Math.max(0, (sun.intensity - 0.08) / 0.5) * 3.0);
  m.setFloat("dayLight", Math.min(1.1, 0.25 + hemi.intensity));
  m.setColor3("skyColor", new BABYLON.Color3(scene.clearColor.r, scene.clearColor.g, scene.clearColor.b));
  m.setColor3("fogColor", scene.fogColor);
  m.setVector2("fogRange", new BABYLON.Vector2(scene.fogStart, scene.fogEnd));
}
export function updateWater(dt) {
  t += dt;
  for (const m of mats) update(m);
}
