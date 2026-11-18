// main.js — builds the world (roads → buildings → lamps → nature → vehicles →
// people), then runs the game: third-person player, shooting, driving,
// rooftop super-jumps, night mode, camera, HUD, minimap and the main loop.
import {
  V3, C3, canvas, engine, scene, camera, hemi, sun, glow, SKY, NIGHT_SKY, state, rand, rr, clamp, hex, angDiff,
  flatMats, interiorMats, litMat, canvasTex, radialTex, emissiveTemplate, flushAccs,
  query, circleHit, pushOut, pointIn, rayBox, xfp, xfl,
} from "./engine.js";
import { createFacades, facadeList } from "./textures.js";
import {
  generateRoads, buildRoadMeshes, buildLamps, lampPools, bulbMats, edges, districtAt, PARIS, CITY, SHORE_X, WORLD, landmarks, roadDist,
} from "./roads.js";
import { planBuildings, buildBuildings, mapBuildings, roofs, enterables, billboards, drawAd, postFlush } from "./buildings.js";
import { buildGround, buildNature, POND } from "./nature.js";
import {
  initVehicleTemplates, spawnParked, spawnTraffic, updateTraffic, vehicles, traffic, VEH, specOf, vehicleSolid, stealTraffic, swapToBurnt, driveVehicle, knockTraffic,
} from "./vehicles.js";
import { spawnPeds, updatePeds, peds, knockDown, scare } from "./people.js";

// Start on the Saint-Clair fountain plaza, looking east down the boulevard
// toward the city skyline in the distance.
const START = { x: PARIS.x + 14, z: PARIS.z };

// ---------------------------------------------------------------- build the world
const t0 = performance.now();
createFacades();
generateRoads();
buildRoadMeshes();
buildGround();
planBuildings(START);
buildBuildings();
buildLamps();
buildNature(START);
flushAccs();
for (const f of postFlush) f();
initVehicleTemplates();
spawnParked(START);
spawnTraffic();
spawnPeds(190);
console.log(`World built in ${Math.round(performance.now() - t0)} ms — ${edges.length} roads, ${mapBuildings.length} buildings, ${traffic.length} cars, ${peds.length} people`);

// ---------------------------------------------------------------- player model
const MB = BABYLON.MeshBuilder;
const skinMat = litMat("playerSkin", hex("#c08462"), 0.18);
skinMat.specularPower = 24;
const shortsMat = litMat("shorts", hex("#2c2f33"), 0.05);
const player = new BABYLON.TransformNode("player", scene);
const cap = (r, h, mat, parent, x, y, z, sx = 1, sy = 1, sz = 1) => {
  const m = MB.CreateCapsule("c", { radius: r, height: h, tessellation: 12, subdivisions: 2 }, scene);
  m.material = mat; m.parent = parent; m.position.set(x, y, z); m.scaling.set(sx, sy, sz);
  return m;
};
const sph = (d, mat, parent, x, y, z, sx = 1, sy = 1, sz = 1) => {
  const m = MB.CreateSphere("s", { diameter: d, segments: 12 }, scene);
  m.material = mat; m.parent = parent; m.position.set(x, y, z); m.scaling.set(sx, sy, sz);
  return m;
};
const pivot = (parent, x, y, z) => { const n = new BABYLON.TransformNode("p", scene); n.parent = parent; n.position.set(x, y, z); return n; };
const body = pivot(player, 0, 0, 0);
cap(0.17, 0.34, shortsMat, body, 0, 0.98, 0, 1.3, 1, 0.95);
cap(0.17, 0.42, skinMat, body, 0, 1.2, 0, 1.15, 1, 0.85);
sph(0.46, skinMat, body, 0, 1.4, 0, 1.45, 0.75, 0.82);
sph(0.4, skinMat, body, 0, 1.3, -0.02, 1.5, 0.85, 0.7);
sph(0.16, skinMat, body, -0.12, 1.52, -0.02, 1.2, 0.8, 1);
sph(0.16, skinMat, body, 0.12, 1.52, -0.02, 1.2, 0.8, 1);
cap(0.06, 0.16, skinMat, body, 0, 1.58, 0);
sph(0.24, skinMat, body, 0, 1.72, 0.01, 0.9, 1.05, 1);
sph(0.19, skinMat, body, -0.31, 1.47, 0);
sph(0.19, skinMat, body, 0.31, 1.47, 0);
function makeArm(side) {
  const sh = pivot(body, side * 0.33, 1.46, 0);
  sh.rotation.z = side * 0.16;
  cap(0.075, 0.34, skinMat, sh, 0, -0.16, 0);
  const el = pivot(sh, 0, -0.3, 0);
  el.rotation.x = -0.3;
  cap(0.06, 0.3, skinMat, el, 0, -0.14, 0);
  sph(0.1, skinMat, el, 0, -0.31, 0.01);
  return { sh, el };
}
function makeLeg(side) {
  const hip = pivot(body, side * 0.11, 0.93, 0);
  cap(0.105, 0.24, shortsMat, hip, 0, -0.07, 0);
  cap(0.095, 0.46, skinMat, hip, 0, -0.22, 0);
  const knee = pivot(hip, 0, -0.45, 0);
  cap(0.072, 0.44, skinMat, knee, 0, -0.21, 0);
  const foot = MB.CreateBox("foot", { width: 0.1, height: 0.06, depth: 0.24 }, scene);
  foot.material = skinMat; foot.parent = knee; foot.position.set(0, -0.44, 0.05);
  return { hip, knee };
}
const armL = makeArm(-1), armR = makeArm(1);
const legL = makeLeg(-1), legR = makeLeg(1);
const gunMat = litMat("gunM", hex("#202226"), 0.5);
const gun = pivot(armR.el, 0, -0.33, 0.04);
for (const [w, h, d, x, y, z] of [[0.05, 0.24, 0.07, 0, -0.07, 0], [0.045, 0.07, 0.13, 0, 0.03, 0.05]]) {
  const b = MB.CreateBox("gunPart", { width: w, height: h, depth: d }, scene);
  b.material = gunMat; b.parent = gun; b.position.set(x, y, z);
}
const muzzle = pivot(gun, 0, -0.2, 0);
const blobTex = radialTex("blob", [[0, "rgba(0,0,0,0.5)"], [0.6, "rgba(0,0,0,0.25)"], [1, "rgba(0,0,0,0)"]]);
const blob = MB.CreateGround("blob", { width: 1.5, height: 1.1 }, scene);
const blobMat = new BABYLON.StandardMaterial("blobMat", scene);
blobMat.diffuseTexture = blobTex; blobMat.useAlphaFromDiffuseTexture = true;
blobMat.disableLighting = true; blobMat.emissiveColor = new C3(0, 0, 0); blobMat.zOffset = -7;
blob.material = blobMat;

// ---------------------------------------------------------------- effects
const tracerT = emissiveTemplate("tracer", MB.CreateBox("tracer", { size: 1 }, scene), hex("#ffe9a0"));
const sparkT = emissiveTemplate("spark", MB.CreateSphere("spark", { diameter: 1, segments: 6 }, scene), hex("#ffb347"));
const flashT = emissiveTemplate("flash", MB.CreateSphere("flash", { diameter: 1, segments: 10 }, scene), hex("#ff9a3c"));
const effects = [];
function addEffect(mesh, life, update) { effects.push({ mesh, t: 0, life, update }); }
function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.t += dt;
    if (e.t >= e.life) { e.mesh.dispose(); effects.splice(i, 1); continue; }
    if (e.update) e.update(e.t / e.life, e.mesh);
  }
}
function spark(p, size = 0.28, life = 0.12) {
  const s = sparkT.createInstance("s");
  s.position.copyFrom(p);
  addEffect(s, life, (k, m) => m.scaling.setAll(size * (1 - k * 0.7)));
}
function tracer(a, b) {
  const len = V3.Distance(a, b);
  if (len < 0.1) return;
  const t = tracerT.createInstance("t");
  t.position = V3.Center(a, b);
  t.scaling.set(0.035, 0.035, len);
  t.lookAt(b);
  addEffect(t, 0.06);
}
const smokeTex = radialTex("smoke", [[0, "rgba(255,255,255,0.9)"], [0.5, "rgba(255,255,255,0.35)"], [1, "rgba(255,255,255,0)"]], 64);
function smoke(pos, seconds) {
  const ps = new BABYLON.ParticleSystem("smoke", 180, scene);
  ps.particleTexture = smokeTex; ps.emitter = pos.clone();
  ps.minEmitBox = new V3(-0.8, 0.5, -0.8); ps.maxEmitBox = new V3(0.8, 1.2, 0.8);
  ps.color1 = new BABYLON.Color4(0.22, 0.2, 0.19, 0.55); ps.color2 = new BABYLON.Color4(0.08, 0.08, 0.08, 0.5);
  ps.colorDead = new BABYLON.Color4(0, 0, 0, 0);
  ps.minSize = 1.2; ps.maxSize = 3.2; ps.minLifeTime = 2.5; ps.maxLifeTime = 4.5; ps.emitRate = 22;
  ps.direction1 = new V3(-0.6, 3.5, -0.6); ps.direction2 = new V3(0.6, 5, 0.6);
  ps.minEmitPower = 0.6; ps.maxEmitPower = 1.2; ps.gravity = new V3(0.4, 0.3, 0.2);
  ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
  ps.start();
  setTimeout(() => ps.stop(), seconds * 1000);
  setTimeout(() => ps.dispose(), (seconds + 6) * 1000);
  const fire = new BABYLON.ParticleSystem("fire", 120, scene);
  fire.particleTexture = smokeTex; fire.emitter = pos.clone();
  fire.minEmitBox = new V3(-0.7, 0.3, -0.9); fire.maxEmitBox = new V3(0.7, 0.9, 0.9);
  fire.color1 = new BABYLON.Color4(1, 0.6, 0.15, 0.9); fire.color2 = new BABYLON.Color4(1, 0.3, 0.05, 0.8);
  fire.colorDead = new BABYLON.Color4(0.2, 0.05, 0, 0);
  fire.minSize = 0.5; fire.maxSize = 1.3; fire.minLifeTime = 0.3; fire.maxLifeTime = 0.8; fire.emitRate = 60;
  fire.direction1 = new V3(-0.3, 2, -0.3); fire.direction2 = new V3(0.3, 3.5, 0.3);
  fire.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
  fire.start();
  setTimeout(() => fire.stop(), seconds * 600);
  setTimeout(() => fire.dispose(), seconds * 600 + 2000);
}

// ---------------------------------------------------------------- night mode
const starTex = canvasTex("stars", 2048, (ctx, W, H) => {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#02040a"); g.addColorStop(0.45, "#0a1226"); g.addColorStop(0.5, "#0d1830"); g.addColorStop(1, "#02040a");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(255,255,${rr(220, 255) | 0},${rr(0.25, 1)})`;
    const s = rand() < 0.04 ? 2.2 : rr(0.8, 1.5);
    ctx.fillRect(rand() * W, rand() * H * 0.48, s, s);
  }
}, true, 1024);
const skyDome = MB.CreateSphere("sky", { diameter: 2600, segments: 16, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
const skyMat = new BABYLON.StandardMaterial("skyM", scene);
skyMat.disableLighting = true; skyMat.emissiveTexture = starTex; skyMat.fogEnabled = false; skyMat.backFaceCulling = false;
skyDome.material = skyMat; skyDome.infiniteDistance = true; skyDome.setEnabled(false);
const moonTex = radialTex("moon", [[0, "rgba(255,252,235,1)"], [0.42, "rgba(245,240,220,1)"], [0.48, "rgba(200,210,240,0.35)"], [1, "rgba(160,180,230,0)"]]);
const moon = MB.CreatePlane("moon", { size: 120 }, scene);
const moonMat = new BABYLON.StandardMaterial("moonM", scene);
moonMat.disableLighting = true; moonMat.emissiveTexture = moonTex; moonMat.opacityTexture = moonTex; moonMat.fogEnabled = false;
moon.material = moonMat; moon.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL; moon.infiniteDistance = true;
moon.position.set(-700, 520, 650); moon.setEnabled(false);
const beamTex = canvasTex("beam", 256, (ctx, S) => {
  ctx.clearRect(0, 0, S, S);
  const g = ctx.createLinearGradient(0, S, 0, 0);
  g.addColorStop(0, "rgba(255,245,215,0.75)"); g.addColorStop(1, "rgba(255,245,215,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(S * 0.38, S); ctx.lineTo(S * 0.62, S); ctx.lineTo(S, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
}, false);
beamTex.hasAlpha = true; beamTex.wrapU = beamTex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
const beamMat = new BABYLON.StandardMaterial("beamM", scene);
beamMat.disableLighting = true; beamMat.emissiveTexture = beamTex; beamMat.opacityTexture = beamTex;
beamMat.alphaMode = BABYLON.Engine.ALPHA_ADD; beamMat.backFaceCulling = false; beamMat.zOffset = -6;
const beam = MB.CreateGround("beam", { width: 9, height: 16 }, scene);
beam.material = beamMat; beam.setEnabled(false);

// ---------------------------------------------------------------- day / night cycle
// Time of day (hours, 0–24) advances continuously; every light, sky colour,
// lit window, street lamp and interior is blended from it. A full day takes
// DAY_LENGTH real seconds.
const DAY_LENGTH = 720;                       // 12 real minutes per game day
let tod = 9.5;                                // start mid-morning
const SUNSET = hex("#f4925a"), DUSK_LIGHT = hex("#ffbe8a");
const NIGHT_HEMI = hex("#8fa3d6"), NIGHT_GROUND = hex("#1c2233"), DAY_GROUND = new C3(0.5, 0.5, 0.53);
const NIGHT_IN = new C3(0.5, 0.47, 0.4), WARM = new C3(0.55, 0.5, 0.42);
for (const m of interiorMats) m.__nightEm = m.diffuseTexture ? WARM.clone() : m.diffuseColor.multiply(WARM);
for (const f of facadeList) { f.mat.emissiveTexture = f.nightTex; f.nightTex.level = 0; }
for (const b of bulbMats) { b.dayC = hex(b.day); b.nightC = hex(b.night); }
const poolTex = scene.getMaterialByName("poolM").emissiveTexture;
skyMat.alpha = 0; moonMat.alpha = 0;
const lerpC = (a, b, t) => C3.Lerp(a, b, clamp(t, 0, 1));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
let lampsOn = null, innerNight = null;

function applyTimeOfDay() {
  // sun travels east (+x) → overhead → west between 06:00 and 18:00
  const ang = ((tod - 6) / 12) * Math.PI;
  const elev = Math.sin(ang);
  const f = smooth(-0.24, 0.2, elev);                      // 0 night … 1 full day (long twilight)
  const warmth = clamp(1 - Math.abs(elev - 0.02) / 0.24, 0, 1); // golden hour around sunrise/sunset
  state.night = f < 0.45;

  let sky = lerpC(NIGHT_SKY, SKY, f);
  sky = lerpC(sky, SUNSET, warmth * 0.75 * (0.35 + 0.65 * f));
  scene.clearColor = new BABYLON.Color4(sky.r, sky.g, sky.b, 1);
  scene.fogColor = sky;
  scene.fogStart = 90 + 230 * f;
  scene.fogEnd = 700 + 700 * f;

  hemi.intensity = 0.3 + 0.48 * f;
  hemi.diffuse = lerpC(lerpC(NIGHT_HEMI, new C3(1, 1, 1), f), DUSK_LIGHT, Math.max(0, warmth) * 0.5);
  hemi.groundColor = lerpC(NIGHT_GROUND, DAY_GROUND, f);
  const sx = Math.cos(ang), sy = Math.max(0.05, elev);
  sun.direction = new V3(-sx, -sy, -0.35).normalize();
  sun.intensity = 0.5 * smooth(0, 0.25, elev) + 0.06;
  sun.diffuse = lerpC(new C3(1, 1, 1), DUSK_LIGHT, Math.max(0, warmth));

  for (const fm of flatMats) {
    const k = fm.k + (1 - fm.k) * f;
    if (fm.tex) fm.tex.level = k; else fm.m.emissiveColor = fm.day.scale(k);
  }
  const lit = 1 - smooth(0.3, 0.8, f);                     // windows / lamps switch on at dusk
  for (const fc of facadeList) {
    fc.nightTex.level = lit;
    if (fc.imat) fc.imat.emissiveColor = lerpC(fc.imat.__dayEm, NIGHT_IN, lit);
  }
  if (innerNight !== lit > 0.5) {
    innerNight = lit > 0.5;
    for (const fc of facadeList) if (fc.imat) fc.imat.diffuseTexture = innerNight ? fc.itexN : fc.itex;
  }
  for (const m of interiorMats) m.emissiveColor = lerpC(m.__dayEm, m.__nightEm, lit);
  for (const b of bulbMats) b.m.emissiveColor = lerpC(b.dayC, b.nightC, lit);
  poolTex.level = lit;
  if (lampsOn !== lit > 0.02) { lampsOn = lit > 0.02; for (const p of lampPools) p.isVisible = lampsOn; }

  skyMat.alpha = 1 - smooth(0.0, 0.6, f);
  skyDome.setEnabled(skyMat.alpha > 0.01);
  moonMat.alpha = skyMat.alpha;
  moon.setEnabled(skyMat.alpha > 0.01);
  moon.position.set(-sx * 800, Math.max(120, -elev * 700 + 250), 450);   // rises opposite the sun
  glow.intensity = 0.35 + 0.55 * lit;
  document.body.classList.toggle("night", state.night);

  const hh = Math.floor(tod), mm = Math.floor((tod - hh) * 60);
  clockEl.innerHTML = `${state.night ? "☾" : "☀"} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
const clockEl = document.getElementById("clock");
let todTimer = 0;
function updateTimeOfDay(dt) {
  tod = (tod + (dt * 24) / DAY_LENGTH) % 24;
  todTimer -= dt;
  if (todTimer <= 0) { todTimer = 0.15; applyTimeOfDay(); }
}
// N jumps ahead to the next night or morning.
function skipTime() { tod = state.night ? 7.0 : 20.5; applyTimeOfDay(); }
function setTime(h) { tod = ((h % 24) + 24) % 24; applyTimeOfDay(); }

// ---------------------------------------------------------------- input
const keys = {};
let lastSpaceAt = 0, superJumpQueued = false, interactQueued = false;
window.addEventListener("keydown", (e) => {
  if (e.code === "Tab") { e.preventDefault(); document.getElementById("controls").classList.toggle("show"); }
  if (e.code === "Space") e.preventDefault();
  // Full map (M) — while it is open the game ignores movement keys.
  if (e.code === "KeyM" && !e.repeat) { toggleBigMap(); return; }
  if (bigMapOpen) {
    if (e.code === "Escape") toggleBigMap(false);
    if (e.code === "KeyC") centerBigMap();
    return;
  }
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === "Space") {
    const now = performance.now();
    if (now - lastSpaceAt < 320) superJumpQueued = true;
    lastSpaceAt = now;
  }
  if (e.code === "KeyE" || e.code === "Enter") interactQueued = true;
  if (e.code === "KeyN") skipTime();
});
window.addEventListener("keyup", (e) => { keys[e.code] = false; });
window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; firing = false; aiming = false; });

let yaw = 0, pitch = 0.12, camDist = 6;
let firing = false, aiming = false, lastMouseAt = 0;
const locked = () => document.pointerLockElement === canvas;
// Pointer events (Babylon's preventDefault on pointerdown suppresses mouse
// events). Buttons come from the bitmask so left+right together works.
const syncButtons = (e) => {
  if (!locked()) return;
  firing = (e.buttons & 1) !== 0;
  aiming = (e.buttons & 2) !== 0;
};
canvas.addEventListener("pointerdown", (e) => {
  if (!locked()) {
    const p = canvas.requestPointerLock && canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
    return;
  }
  syncButtons(e);
});
window.addEventListener("pointerup", syncButtons);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("pointerlockchange", () => {
  document.getElementById("clickToPlay").style.display = locked() ? "none" : "block";
  if (!locked()) { firing = false; aiming = false; }
});
document.addEventListener("pointermove", (e) => {
  if (!locked()) return;
  syncButtons(e);
  const sens = aiming ? 0.0013 : 0.0025;
  yaw += e.movementX * sens;
  pitch = clamp(pitch + e.movementY * sens * 0.8, -0.6, 1.25);
  if (Math.abs(e.movementX) > 1) lastMouseAt = performance.now();
});
canvas.addEventListener("wheel", (e) => { camDist = clamp(camDist + Math.sign(e.deltaY) * 0.8, 2, 18); e.preventDefault(); }, { passive: false });

// ---------------------------------------------------------------- on-foot physics
const RADIUS = 0.4, STEP = 0.42, HEIGHT = 1.8, GRAV = 22;
const pos = new V3(START.x, 0, START.z);
let vy = 0, onGround = true, facing = 0, walkPhase = 0, moveAmt = 0;
let pushX = 0, pushZ = 0, superJump = null, aimTimer = 0, vehicle = null;

function supportHeight(x, z, y) {
  let best = 0;
  for (const s of query(x - 0.3, x + 0.3, z - 0.3, z + 0.3)) {
    if (s.maxY > y + STEP || s.maxY <= best) continue;
    if (circleHit(s, x, z, 0.28)) best = s.maxY;
  }
  return best;
}
function ceilingAt(x, z, y) {
  let c = Infinity;
  for (const s of query(x - 0.25, x + 0.25, z - 0.25, z + 0.25)) {
    if (s.minY < y + 1.0 || s.minY >= c) continue;
    if (circleHit(s, x, z, 0.22)) c = s.minY;
  }
  return c;
}
function collideHoriz(p) {
  const list = query(p.x - RADIUS - 0.1, p.x + RADIUS + 0.1, p.z - RADIUS - 0.1, p.z + RADIUS + 0.1).slice();
  for (const b of list) {
    if (b.maxY <= p.y + STEP || b.minY >= p.y + HEIGHT - 0.05) continue;
    pushOut(b, p, RADIUS);
  }
}
function inEnterable(e, x, z) {
  const [lx, lz] = xfl(e.xf, x, z);
  return lx > e.minX && lx < e.maxX && lz > e.minZ && lz < e.maxZ;
}
function indoorsNow() {
  for (const e of enterables) if (pos.y < e.F * e.fh - 0.5 && inEnterable(e, pos.x, pos.z)) return e;
  return null;
}

function roofCandidate() {
  if (vehicle || indoorsNow()) return null;
  let best = null, bestD = 3.2;
  for (const r of roofs) {
    if (Math.abs(r.xf.cx - pos.x) > 60 || Math.abs(r.xf.cz - pos.z) > 60) continue;
    if (r.top < pos.y + 1.5) continue;
    const [lx, lz] = xfl(r.xf, pos.x, pos.z);
    const d = Math.hypot(Math.max(Math.abs(lx) - r.hw, 0), Math.max(Math.abs(lz) - r.hd, 0));
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}
function startSuperJump() {
  const r = roofCandidate();
  if (!r) return false;
  let lx, lz;
  if (r.landing) { lx = r.landing.x; lz = r.landing.z; }
  else {
    [lx, lz] = xfl(r.xf, pos.x, pos.z);
    lx = clamp(lx, -Math.max(0.2, r.lhw), Math.max(0.2, r.lhw));
    lz = clamp(lz, -Math.max(0.2, r.lhd), Math.max(0.2, r.lhd));
    for (const m of r.mechs) {
      if (Math.hypot(lx - m.x, lz - m.z) < m.r) {
        const a = Math.atan2(lz - m.z, lx - m.x);
        lx = clamp(m.x + Math.cos(a) * (m.r + 0.5), -r.hw + 0.8, r.hw - 0.8);
        lz = clamp(m.z + Math.sin(a) * (m.r + 0.5), -r.hd + 0.8, r.hd - 0.8);
      }
    }
  }
  const [tx, tz] = xfp(r.xf, lx, lz);
  const rim = r.rim ?? r.top;
  vy = Math.sqrt(2 * GRAV * (rim + 2.6 - pos.y));
  onGround = false;
  superJump = { x: tx, z: tz, clearY: rim + 0.35 };
  facing = Math.atan2(tx - pos.x, tz - pos.z);
  return true;
}

function updatePlayer(dt) {
  const fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw), rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
  let mx = 0, mz = 0;
  const downed = downTimer > 0;               // thrown from a crash: lie there for a moment
  if (downed) downTimer -= dt;
  if (!superJump && !downed) {
    if (keys.KeyW || keys.ArrowUp) { mx += fwdX; mz += fwdZ; }
    if (keys.KeyS || keys.ArrowDown) { mx -= fwdX; mz -= fwdZ; }
    if (keys.KeyD || keys.ArrowRight) { mx += rightX; mz += rightZ; }
    if (keys.KeyA || keys.ArrowLeft) { mx -= rightX; mz -= rightZ; }
  }
  const len = Math.hypot(mx, mz);
  const running = (keys.ShiftLeft || keys.ShiftRight) && !aiming;
  const speed = aiming ? 2.6 : running ? 9 : 4.2;
  const gunUp = aiming || aimTimer > 0;

  let dx = 0, dz = 0;
  if (len > 0) { dx += (mx / len) * speed * dt; dz += (mz / len) * speed * dt; }
  dx += pushX * dt; dz += pushZ * dt;
  const pk = Math.exp(-4 * dt); pushX *= pk; pushZ *= pk;
  if (superJump && pos.y > superJump.clearY) {
    const gx = superJump.x - pos.x, gz = superJump.z - pos.z, gd = Math.hypot(gx, gz);
    if (gd > 0.05) { const s = Math.min(gd, 14 * dt); dx += (gx / gd) * s; dz += (gz / gd) * s; }
  }
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.15));
  for (let i = 0; i < n; i++) {
    pos.x += dx / n; pos.z += dz / n;
    collideHoriz(pos);
    if (onGround) { const g = supportHeight(pos.x, pos.z, pos.y); if (g > pos.y) pos.y = g; }
  }
  // bump into pedestrians
  for (const p of peds) {
    if (p.state === "down" || Math.abs(p.x - pos.x) > 1 || Math.abs(p.z - pos.z) > 1 || pos.y > 1.5) continue;
    const ddx = pos.x - p.x, ddz = pos.z - p.z, d = Math.hypot(ddx, ddz);
    if (d < 0.7 && d > 0.01) { pos.x += (ddx / d) * (0.7 - d) * 0.5; pos.z += (ddz / d) * (0.7 - d) * 0.5; }
  }
  if (gunUp) {
    // face the point under the crosshair (not just the camera yaw — the
    // camera sits over the right shoulder, so they differ up close)
    const { o, d } = aimRay();
    poseToward(o.x + d.x * 30, o.y + d.y * 30, o.z + d.z * 30, dt);
  } else if (len > 0) facing += angDiff(Math.atan2(mx, mz), facing) * Math.min(1, dt * 12);
  moveAmt += ((len > 0 ? (running ? 1 : 0.6) : 0) - moveAmt) * Math.min(1, dt * 10);

  if (onGround && keys.Space && !superJump && !downed) { vy = 7.2; onGround = false; }
  vy = Math.max(-45, vy - GRAV * dt);
  const gh = supportHeight(pos.x, pos.z, pos.y);
  let ny = pos.y + vy * dt;
  if (vy > 0) { const c = ceilingAt(pos.x, pos.z, pos.y); if (ny + HEIGHT > c) { ny = c - HEIGHT; vy = 0; } }
  if (vy <= 0 && ny <= gh) { pos.y = gh; vy = 0; onGround = true; superJump = null; }
  else if (onGround && vy <= 0 && pos.y - gh < 0.45) { pos.y = gh; vy = 0; }
  else { pos.y = ny; onGround = false; }
  pos.x = clamp(pos.x, WORLD.x0 + 2, WORLD.x1 - 2);
  pos.z = clamp(pos.z, WORLD.z0 + 2, WORLD.z1 - 2);

  for (const t of traffic) {
    const ddx = pos.x - t.vx, ddz = pos.z - t.vz, d = Math.hypot(ddx, ddz);
    if (d < 2.6 && d > 0.01 && pos.y < 1.5) { pos.x += (ddx / d) * (2.6 - d); pos.z += (ddz / d) * (2.6 - d); }
  }

  player.position.copyFrom(pos);
  player.rotation.y = facing;
  const shadowY = supportHeight(pos.x, pos.z, pos.y + 0.01);
  blob.position.set(pos.x, shadowY + 0.1, pos.z);
  blob.rotation.y = facing;
  const s = Math.max(0.3, 1 - (pos.y - shadowY) * 0.25);
  blob.scaling.set(s, 1, s);

  walkPhase += dt * (running ? 11 : 7.5) * (len > 0 ? 1 : 0);
  const a = moveAmt * 0.75, sw = Math.sin(walkPhase);
  if (onGround) {
    legL.hip.rotation.x = -sw * a; legR.hip.rotation.x = sw * a;
    legL.knee.rotation.x = Math.max(0, Math.sin(walkPhase + 1.2)) * a * 1.3;
    legR.knee.rotation.x = Math.max(0, -Math.sin(walkPhase + 1.2)) * a * 1.3;
  } else {
    legL.hip.rotation.x = -0.5; legR.hip.rotation.x = -0.2;
    legL.knee.rotation.x = 0.9; legR.knee.rotation.x = 0.5;
  }
  armL.sh.rotation.x = sw * a * 0.9;
  armL.el.rotation.x = -0.3 - moveAmt * 0.5;
  if (gunUp) { armR.sh.rotation.x = -Math.PI / 2 - aimElev; armR.sh.rotation.z = 0.05; armR.el.rotation.x = 0; }
  else { armR.sh.rotation.x = -sw * a * 0.9; armR.sh.rotation.z = 0.16; armR.el.rotation.x = -0.3 - moveAmt * 0.5; }
  aimTimer = Math.max(0, aimTimer - dt);
  body.position.y = Math.abs(Math.cos(walkPhase)) * 0.05 * moveAmt + Math.sin(performance.now() / 500) * 0.006;
  // thrown: tumble flat onto the back, then get up again
  const lieT = downed ? -1.5 : 0;
  body.rotation.x += (lieT - body.rotation.x) * Math.min(1, dt * (downed ? 7 : 4));
  if (downed) {
    body.position.y = 0.12;
    legL.hip.rotation.x = -0.3; legR.hip.rotation.x = 0.15;
    legL.knee.rotation.x = 0.5; legR.knee.rotation.x = 0.2;
    armL.sh.rotation.x = -2.4; armR.sh.rotation.x = -2.1;
  }
}

// ---------------------------------------------------------------- vehicles
function playerFits(x, y, z) {
  for (const s of query(x - 0.6, x + 0.6, z - 0.6, z + 0.6)) {
    if (s.maxY <= y + STEP || s.minY >= y + HEIGHT) continue;
    if (circleHit(s, x, z, 0.45)) return false;
  }
  return true;
}
function enterVehicle(v) {
  vehicle = v;
  v.solid.off = true;
  v.speed = 0;
  v.mesh.unfreezeWorldMatrix();
  superJump = null; firing = false; aiming = false; aimTimer = 0;
  blob.setEnabled(false); gun.setEnabled(false);
  yaw = v.heading; lastMouseAt = 0;
  if (v.kind === "car") player.setEnabled(false);
  else {
    player.parent = v.mesh;
    player.position.set(0, 0.1, -0.22);
    player.rotation.y = 0;
    body.position.y = 0; body.rotation.x = 0.28;
    legL.hip.rotation.x = legR.hip.rotation.x = -1.35;
    legL.knee.rotation.x = legR.knee.rotation.x = 1.3;
    armL.sh.rotation.x = armR.sh.rotation.x = -1.05;
    armL.el.rotation.x = armR.el.rotation.x = -0.35;
    armR.sh.rotation.z = 0.16;
  }
}
function exitVehicle() {
  const v = vehicle, c = specOf(v);
  v.speed = 0;
  const p = v.mesh.position, h = v.heading, side = c.hw + 0.9;
  const opts = [
    [-Math.cos(h) * side, Math.sin(h) * side], [Math.cos(h) * side, -Math.sin(h) * side],
    [-Math.sin(h) * (c.hd + 1), -Math.cos(h) * (c.hd + 1)], [Math.sin(h) * (c.hd + 1), Math.cos(h) * (c.hd + 1)],
  ];
  let spot = null;
  for (const [ox, oz] of opts) {
    const x = p.x + ox, z = p.z + oz, y = supportHeight(x, z, p.y + 0.3);
    if (playerFits(x, y, z)) { spot = [x, y, z]; break; }
  }
  if (!spot) spot = [p.x, p.y + c.ht + 0.1, p.z];
  vehicle = null;
  v.solid = vehicleSolid(v);
  v.mesh.rotation.z = 0; v.mesh.rotation.x = 0; v.wobble = 0;
  v.mesh.freezeWorldMatrix();
  beam.setEnabled(false);
  player.parent = null; player.setEnabled(true);
  body.rotation.x = 0; armR.sh.rotation.z = 0.16;
  blob.setEnabled(true); gun.setEnabled(true);
  pos.set(spot[0], spot[1], spot[2]);
  vy = 0; onGround = true; facing = h;
}
function nearestUsable() {
  let best = null, bestD = Infinity;
  for (const v of vehicles) {
    if (v.wrecked) continue;
    const d = V3.Distance(v.mesh.position, pos);
    if (d < (v.kind === "car" ? specOf(v).hd + 1.6 : 2.6) && d < bestD) { best = v; bestD = d; }
  }
  for (const t of traffic) {
    const d = Math.hypot(t.vx - pos.x, t.vz - pos.z);
    if (d < t.spec.hd + 1.6 && d < bestD && pos.y < 2) { best = t; bestD = d; }
  }
  return best;
}
function updateVehicle(dt) {
  const v = vehicle;
  const res = driveVehicle(v, dt, keys, enterables, supportHeight);
  if (res.impact > 5) { onCrash(v, res); if (vehicle !== v) return; }   // may have thrown us out
  else if (res.impact > 1.5) shake = Math.max(shake, 0.08);
  if (res.scrape && Math.random() < 0.6) {             // grinding along a wall
    const side = Math.random() < 0.5 ? -1 : 1, sp = specOf(v);
    crashSparks.emitter = new V3(v.mesh.position.x + Math.cos(v.heading) * sp.hw * side, 0.5, v.mesh.position.z - Math.sin(v.heading) * sp.hw * side);
    crashSparks.manualEmitCount = 6;
  }
  // body wobble after an impact (pitch + a little roll, decaying)
  if (v.wobble > 0.002) {
    const t = performance.now() / 1000;
    v.mesh.rotation.x = Math.sin(t * 28) * v.wobble;
    if (v.kind === "car") v.mesh.rotation.z = Math.sin(t * 21) * v.wobble * 0.6;
    v.wobble *= Math.exp(-5 * dt);
  } else if (v.mesh.rotation.x) { v.mesh.rotation.x = 0; if (v.kind === "car") v.mesh.rotation.z = 0; }
  if (performance.now() - lastMouseAt > 1200 && Math.abs(v.speed) > 2) yaw += angDiff(v.heading, yaw) * Math.min(1, dt * 2.5);
  pos.copyFrom(v.mesh.position);
  if (state.night) {
    beam.setEnabled(true);
    const off = specOf(v).hd + 7.8;
    beam.position.set(pos.x + Math.sin(v.heading) * off, pos.y + 0.2, pos.z + Math.cos(v.heading) * off);
    beam.rotation.y = v.heading;
  } else beam.setEnabled(false);
}

// ---------------------------------------------------------------- shooting
const pedBox = { rot: null, lx0: 0, lx1: 0, lz0: 0, lz1: 0, minY: 0, maxY: 1.8 };
function raycast(o, d, tmin, tmax) {
  let best = tmax, hit = null;
  for (let t = tmin; t < best; t += 6) {
    const t2 = Math.min(t + 6, best);
    const ax = o.x + d.x * t, az = o.z + d.z * t, bx = o.x + d.x * t2, bz = o.z + d.z * t2;
    for (const s of query(Math.min(ax, bx), Math.max(ax, bx), Math.min(az, bz), Math.max(az, bz))) {
      const th = rayBox(o, d, s, tmin, best);
      if (th !== null && th < best) { best = th; hit = { solid: s }; }
    }
  }
  for (const t of traffic) {
    if (Math.abs(t.vx - o.x) > tmax || Math.abs(t.vz - o.z) > tmax) continue;
    const th = rayBox(o, d, t.box, tmin, best);
    if (th !== null && th < best) { best = th; hit = { traffic: t }; }
  }
  for (const p of peds) {
    if (Math.abs(p.x - o.x) > 120 || Math.abs(p.z - o.z) > 120) continue;
    const down = p.state === "down";
    pedBox.lx0 = p.x - (down ? 0.9 : 0.3); pedBox.lx1 = p.x + (down ? 0.9 : 0.3);
    pedBox.lz0 = p.z - (down ? 0.9 : 0.3); pedBox.lz1 = p.z + (down ? 0.9 : 0.3);
    pedBox.maxY = down ? 0.45 : 1.8;
    const th = rayBox(o, d, pedBox, tmin, best);
    if (th !== null && th < best) { best = th; hit = { ped: p }; }
  }
  if (d.y < 0) { const tg = -o.y / d.y; if (tg > tmin && tg < best) { best = tg; hit = { ground: true }; } }
  return { t: best, hit };
}
function explode(at, scale = 1) {
  const f = flashT.createInstance("boom");
  f.position.copyFrom(at);
  addEffect(f, 0.45, (k, m) => m.scaling.setAll((1.5 + k * 7) * scale * (1 - k * 0.4)));
  smoke(at, 12);
  scare(at.x, at.z, 70);
  for (const p of peds) {
    const dx = p.x - at.x, dz = p.z - at.z, d = Math.hypot(dx, dz);
    if (d < 7) knockDown(p, (dx / (d || 1)) * 9, (dz / (d || 1)) * 9);
  }
  if (!vehicle) {
    const dx = pos.x - at.x, dz = pos.z - at.z, d = Math.hypot(dx, dz);
    if (d < 7) {
      const k = 1 - d / 7;
      pushX += (dx / (d || 1)) * 14 * k; pushZ += (dz / (d || 1)) * 14 * k;
      vy = Math.max(vy, 7 * k); onGround = false;
    }
  }
}
function wreck(v) {
  if (v.smokePS) { v.smokePS.dispose(); v.smokePS = null; }
  swapToBurnt(v);
  explode(v.mesh.position.add(new V3(0, 0.6, 0)), v.kind === "car" ? 1 : 0.6);
}

// ---------------------------------------------------------------- crashes
// Shared particle systems (emit on demand with manualEmitCount).
const crashSparks = new BABYLON.ParticleSystem("crashSparks", 600, scene);
crashSparks.particleTexture = smokeTex;
crashSparks.emitter = new V3(0, -100, 0);
crashSparks.minEmitBox = new V3(-0.4, -0.2, -0.4); crashSparks.maxEmitBox = new V3(0.4, 0.3, 0.4);
crashSparks.color1 = new BABYLON.Color4(1, 0.9, 0.45, 1); crashSparks.color2 = new BABYLON.Color4(1, 0.55, 0.1, 1);
crashSparks.colorDead = new BABYLON.Color4(0.4, 0.1, 0, 0);
crashSparks.minSize = 0.06; crashSparks.maxSize = 0.2;
crashSparks.minLifeTime = 0.25; crashSparks.maxLifeTime = 0.75;
crashSparks.direction1 = new V3(-5, 2, -5); crashSparks.direction2 = new V3(5, 8, 5);
crashSparks.minEmitPower = 1; crashSparks.maxEmitPower = 2.6;
crashSparks.gravity = new V3(0, -16, 0);
crashSparks.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
crashSparks.emitRate = 0;
crashSparks.start();
const crashDust = new BABYLON.ParticleSystem("crashDust", 300, scene);
crashDust.particleTexture = smokeTex;
crashDust.emitter = new V3(0, -100, 0);
crashDust.minEmitBox = new V3(-0.8, 0, -0.8); crashDust.maxEmitBox = new V3(0.8, 0.8, 0.8);
crashDust.color1 = new BABYLON.Color4(0.55, 0.52, 0.48, 0.55); crashDust.color2 = new BABYLON.Color4(0.35, 0.33, 0.3, 0.45);
crashDust.colorDead = new BABYLON.Color4(0.3, 0.3, 0.3, 0);
crashDust.minSize = 0.6; crashDust.maxSize = 1.8;
crashDust.minLifeTime = 0.7; crashDust.maxLifeTime = 1.6;
crashDust.direction1 = new V3(-1.5, 0.6, -1.5); crashDust.direction2 = new V3(1.5, 2.2, 1.5);
crashDust.minEmitPower = 0.6; crashDust.maxEmitPower = 1.4;
crashDust.gravity = new V3(0, 0.4, 0);
crashDust.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
crashDust.emitRate = 0;
crashDust.start();
// Debris chunks + glass shards fly off and fall.
const debrisT = MB.CreateBox("debris", { size: 1 }, scene);
debrisT.material = litMat("debrisM", hex("#2a2b2e"), 0.3); debrisT.setEnabled(false);
const shardT = MB.CreateBox("shard", { size: 1 }, scene);
shardT.material = litMat("shardM", hex("#9fc3d6"), 0.8); shardT.setEnabled(false);
function debris(at, n, power) {
  for (let i = 0; i < n; i++) {
    const glass = Math.random() < 0.45;
    const m = (glass ? shardT : debrisT).createInstance("d");
    const s = glass ? 0.05 + Math.random() * 0.08 : 0.08 + Math.random() * 0.22;
    m.scaling.set(s, s * (glass ? 0.3 : 0.6), s * (glass ? 1 : 1.3));
    const a = Math.random() * Math.PI * 2, sp = power * (0.3 + Math.random() * 0.7);
    const vx = Math.cos(a) * sp, vz = Math.sin(a) * sp, vy0 = 2 + Math.random() * power * 0.5;
    const spin = new V3(Math.random() * 12, Math.random() * 12, Math.random() * 12);
    const life = 1.6 + Math.random() * 1.2;
    m.position.copyFrom(at);
    addEffect(m, life, (k, mesh) => {
      const t = k * life;
      const y = at.y + vy0 * t - 9.8 * t * t;
      const tt = y > 0.05 ? t : (vy0 + Math.sqrt(vy0 * vy0 + 19.6 * at.y)) / 19.6; // stop where it lands
      mesh.position.set(at.x + vx * tt, Math.max(0.05, y), at.z + vz * tt);
      if (y > 0.05) mesh.rotation.set(spin.x * t, spin.y * t, spin.z * t);
    });
  }
}

// Procedural crash sound (Web Audio): a noise burst + a metallic clang.
let actx = null;
function audio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { actx = null; } }
  return actx;
}
function playCrash(impact) {
  const a = audio();
  if (!a || a.state !== "running") return;
  const vol = clamp(impact / 30, 0.12, 1), t0 = a.currentTime;
  const N = Math.floor(a.sampleRate * 0.6);
  const buf = a.createBuffer(1, N, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < N; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / N, 2.5);
  const src = a.createBufferSource(); src.buffer = buf;
  const lp = a.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900 + impact * 60;
  const g = a.createGain(); g.gain.value = vol * 0.9;
  src.connect(lp); lp.connect(g); g.connect(a.destination); src.start(t0);
  for (const [f, type] of [[140 + Math.random() * 60, "square"], [430 + Math.random() * 200, "triangle"]]) {
    const o = a.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f, t0); o.frequency.exponentialRampToValueAtTime(f * 0.45, t0 + 0.45);
    const og = a.createGain();
    og.gain.setValueAtTime(vol * 0.18, t0); og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
    o.connect(og); og.connect(a.destination); o.start(t0); o.stop(t0 + 0.55);
  }
}
canvas.addEventListener("pointerdown", () => { const a = audio(); if (a && a.state === "suspended") a.resume(); });

let shake = 0;          // camera shake amount (0..1)
let downTimer = 0;      // player lying on the ground after being thrown
function crashFX(at, impact) {
  crashSparks.emitter = at.clone();
  crashSparks.manualEmitCount = Math.round(20 + impact * 4);
  crashDust.emitter = at.clone();
  crashDust.manualEmitCount = Math.round(4 + impact * 0.6);
  debris(at, Math.round(clamp(impact / 2.5, 3, 22)), clamp(impact * 0.35, 3, 14));
  shake = Math.max(shake, clamp(impact / 28, 0.15, 1));
  playCrash(impact);
}
// Engine smoke once a vehicle is badly damaged (grey → black as it gets worse).
function updateDamageSmoke(v) {
  const sp = specOf(v), frac = v.health / (sp.hits * 10);
  if (frac > 0.45 || v.wrecked) return;
  if (!v.smokePS) {
    const ps = new BABYLON.ParticleSystem("engineSmoke", 120, scene);
    ps.particleTexture = smokeTex;
    ps.emitter = v.mesh;
    ps.minEmitBox = new V3(-0.3, sp.ht * 0.65, sp.hd * 0.55); ps.maxEmitBox = new V3(0.3, sp.ht * 0.75, sp.hd * 0.75);
    ps.minSize = 0.4; ps.maxSize = 1.2; ps.minLifeTime = 1; ps.maxLifeTime = 2.2;
    ps.direction1 = new V3(-0.4, 1.5, -0.4); ps.direction2 = new V3(0.4, 2.5, 0.4);
    ps.colorDead = new BABYLON.Color4(0, 0, 0, 0);
    ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    ps.start();
    v.smokePS = ps;
  }
  const dark = frac < 0.2;
  v.smokePS.emitRate = dark ? 40 : 16;
  v.smokePS.color1 = dark ? new BABYLON.Color4(0.08, 0.08, 0.08, 0.7) : new BABYLON.Color4(0.6, 0.6, 0.6, 0.45);
  v.smokePS.color2 = dark ? new BABYLON.Color4(0.15, 0.13, 0.12, 0.6) : new BABYLON.Color4(0.45, 0.45, 0.45, 0.35);
}
// Throw the player off a bike / out of a totalled car.
function throwPlayer(v, impact, dirSign) {
  const h = v.heading;
  exitVehicle();
  if (v.kind === "bike" && !v.wrecked) {          // the bike falls over where it stopped
    v.mesh.unfreezeWorldMatrix();
    v.mesh.rotation.z = 1.35;
    v.mesh.position.y = 0.15;
    v.mesh.freezeWorldMatrix();
  }
  const p = v.mesh.position;
  pos.set(p.x, p.y + 1.0, p.z);
  const fling = clamp(impact * 0.45, 4, 18) * dirSign;
  pushX = Math.sin(h) * fling; pushZ = Math.cos(h) * fling;
  vy = clamp(3 + impact * 0.14, 4, 9);
  onGround = false;
  downTimer = clamp(1.2 + impact * 0.04, 1.4, 3);
  facing = h + (dirSign < 0 ? Math.PI : 0);
}
// Called when the player's vehicle hits something hard.
function onCrash(v, res) {
  const sp = specOf(v), I = res.impact;
  if (v.health === undefined) v.health = sp.hits * 10;
  const at = new V3(res.x, v.mesh.position.y + Math.min(sp.ht * 0.5, 1.0), res.z);
  crashFX(at, I);
  scare(at.x, at.z, 35);
  v.wobble = Math.min(0.14, I * 0.006);
  v.health -= Math.max(0, I - 4) * (res.traffic ? 0.9 : 1.1);
  if (res.traffic) {
    const t = res.traffic;
    const myMass = sp.hd * sp.hw;
    knockTraffic(t, t.vx - v.mesh.position.x, t.vz - v.mesh.position.z, I, myMass / 2.1);
    t.hits += I / 7;
    if (t.hits >= t.spec.hits) {
      const w = stealTraffic(t);
      w.solid.off = true;
      wreck(w);
      w.solid = vehicleSolid(w);
    }
  }
  if (v.health <= 0) {                               // totalled: thrown clear, then it blows
    throwPlayer(v, I, res.dir);
    v.solid.off = true;
    wreck(v);
    v.solid = vehicleSolid(v);
    return;
  }
  if (v.kind === "bike" && I > 9) { throwPlayer(v, I, res.dir); return; }
  updateDamageSmoke(v);
}
function damageVehicle(v) {
  if (v.wrecked || v === vehicle) return;
  if (++v.hits >= specOf(v).hits) wreck(v);
}
function damageTraffic(t) {
  t.hits++;
  t.stopUntil = performance.now() + 6000;
  if (t.hits >= t.spec.hits) {
    const v = stealTraffic(t);
    v.solid.off = true;
    wreck(v);
    v.solid = vehicleSolid(v);
  }
}
// Aiming: the crosshair ray goes from the camera through the screen centre.
// Anything between the camera and the player is skipped (tmin), so the
// crosshair picks what is *in front of* the player.
function aimRay() {
  const o = camera.position.clone();
  const d = camera.getDirection(BABYLON.Axis.Z).normalize();
  const tmin = Math.max(0.3, V3.Dot(camTarget.subtract(o), d) + 0.5);
  return { o, d, tmin };
}
let aimElev = 0;
// Turn the body toward a world point and raise the gun arm to its height.
function poseToward(x, y, z, dt = 1) {
  const dx = x - pos.x, dz = z - pos.z;
  // the gun hangs off the right shoulder (~0.33 m), so turn a touch further
  // left for its barrel — not the chest — to line up with the target
  const hd = Math.max(0.5, Math.hypot(dx, dz));
  const want = Math.atan2(dx, dz) - Math.asin(Math.min(0.9, 0.33 / hd));
  facing += angDiff(want, facing) * Math.min(1, dt * 20);
  aimElev = Math.atan2(y - (pos.y + 1.46), Math.max(0.5, Math.hypot(dx, dz)));
}

let shotCooldown = 0;
function fire() {
  shotCooldown = 0.16;
  aimTimer = 0.7;
  // 1) what is under the crosshair?
  const { o, d, tmin } = aimRay();
  const aim = raycast(o, d, tmin, 260);
  const aimPt = o.add(d.scale(aim.t));
  // 2) snap the body + arm onto it, so the muzzle points there
  poseToward(aimPt.x, aimPt.y, aimPt.z);
  player.rotation.y = facing;
  armR.sh.rotation.x = -Math.PI / 2 - aimElev;
  armR.sh.rotation.z = 0.05;
  armR.el.rotation.x = 0;
  for (const n of [player, body, armR.sh, armR.el, gun, muzzle]) n.computeWorldMatrix(true);
  const m = muzzle.getAbsolutePosition().clone();
  // 3) the bullet travels from the muzzle to that point; a wall or car in
  //    between (e.g. shooting round a corner) stops it first
  const toAim = aimPt.subtract(m);
  const dist = toAim.length();
  let end = aimPt, hit = aim.hit, dir = d;
  if (dist > 0.05) {
    dir = toAim.scale(1 / dist);
    const block = raycast(m, dir, 0.02, dist - 0.25);
    if (block.hit) { end = m.add(dir.scale(block.t)); hit = block.hit; }
  }
  tracer(m, end);
  spark(m, 0.18, 0.05);
  scare(pos.x, pos.z, 45);
  if (hit) {
    spark(end.subtract(dir.scale(0.05)));
    if (hit.solid && hit.solid.vehicle) damageVehicle(hit.solid.vehicle);
    else if (hit.traffic) damageTraffic(hit.traffic);
    else if (hit.ped) knockDown(hit.ped, dir.x * 3, dir.z * 3);
  }
}

// ---------------------------------------------------------------- camera
const camTarget = new V3();
function pointBlocked(x, y, z) {
  for (const b of query(x - 0.2, x + 0.2, z - 0.2, z + 0.2)) if (pointIn(b, x, y, z, 0.18)) return true;
  return false;
}
let camSide = 0.6;
function updateCamera(dt) {
  // On foot the camera sits over the right shoulder so the crosshair (screen
  // centre) is never hidden behind the player; aiming pulls it in tighter.
  let dist = camDist, h = 1.7, side = 1.0;
  if (vehicle) { const c = specOf(vehicle); dist = Math.max(camDist, c.camDist); h = c.camH; side = 0; }
  else if (aiming) { dist = 2.8; side = 0.85; h = 1.72; }
  // don't push the pivot into a wall the player is hugging on the right
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  for (let s = 0.15; s <= side; s += 0.15) {
    if (pointBlocked(pos.x + rx * (s + 0.2), pos.y + h, pos.z + rz * (s + 0.2))) { side = Math.max(0, s - 0.15); break; }
  }
  camSide += (side - camSide) * Math.min(1, dt * 10);
  camTarget.set(pos.x + rx * camSide, pos.y + h, pos.z + rz * camSide);
  const p = vehicle ? Math.max(pitch, 0.05) : pitch;
  const cp = Math.cos(p);
  const dx = -Math.sin(yaw) * cp, dy = Math.sin(p), dz = -Math.cos(yaw) * cp;
  let d = dist;
  for (let s = 0.3; s <= dist; s += 0.25) {
    if (pointBlocked(camTarget.x + dx * s, camTarget.y + dy * s, camTarget.z + dz * s)) { d = Math.max(0.35, s - 0.3); break; }
  }
  const want = new V3(camTarget.x + dx * d, Math.max(0.4, camTarget.y + dy * d), camTarget.z + dz * d);
  const cur = V3.Distance(camera.position, camTarget);
  const k = d < cur - 0.05 ? 1 : Math.min(1, dt * (vehicle ? 8 : 12));
  camera.position = V3.Lerp(camera.position, want, k);
  if (shake > 0.001) {                                  // crash shake
    const s = shake * shake * 0.45;
    camera.position.addInPlaceFromFloats((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    shake = Math.max(0, shake - dt * 1.6);
  }
  camera.setTarget(camTarget);
  const fovT = aiming && !vehicle ? 0.62 : vehicle ? 1.05 + clamp(Math.abs(vehicle.speed) / 40, 0, 1) * 0.15 : 1.0;
  camera.fov += (fovT - camera.fov) * Math.min(1, dt * 10);
}

// ---------------------------------------------------------------- HUD
const el = (id) => document.getElementById(id);
const locEl = el("location"), promptEl = el("prompt"), speedEl = el("speed"), crossEl = el("crosshair"), distEl = el("district");
const hud = {};
function setHud(key, node, html) {
  if (hud[key] === html) return;
  hud[key] = html;
  node.innerHTML = html;
  node.style.display = html ? "block" : "none";
}
const DISTRICTS = {
  city: ["MIDTOWN", "Babylon City"], paris: ["SAINT-CLAIR", "Residential quarter"],
  park: ["RIVERSIDE PARK", "Between the city and Saint-Clair"], beach: ["THE COAST", "Saint-Clair beach"],
};
let curDistrict = null, districtTimer = null, hudTimer = 0;
function updateHud(dt) {
  let loc = "";
  for (const e of enterables) {
    if (inEnterable(e, pos.x, pos.z)) {
      const fl = Math.floor((pos.y + 0.4) / e.fh);
      loc = `${e.name} · ${fl === 0 ? "Lobby" : fl >= e.F ? "Roof" : "Floor " + fl}`;
      break;
    }
  }
  if (!loc && !vehicle && pos.y > 8 && onGround) loc = "Rooftop";
  setHud("loc", locEl, loc);
  setHud("speed", speedEl, vehicle ? `${Math.round(Math.abs(vehicle.speed) * 3.6)} <small>km/h</small>` : "");
  crossEl.className = aiming ? "hud aim" : "hud";
  crossEl.style.display = locked() && !vehicle ? "block" : "none";

  hudTimer -= dt;
  if (hudTimer > 0) return;
  hudTimer = 0.12;
  const dname = districtAt(pos.x, pos.z);
  if (dname !== curDistrict) {
    curDistrict = dname;
    const [t, s] = DISTRICTS[dname];
    distEl.innerHTML = `${t}<small>${s}</small>`;
    distEl.classList.add("show");
    clearTimeout(districtTimer);
    districtTimer = setTimeout(() => distEl.classList.remove("show"), 2800);
  }
  let pr = "";
  if (vehicle) pr = "<kbd>E</kbd> Get out";
  else {
    const u = nearestUsable();
    if (u) pr = `<kbd>E</kbd> ${u.e ? "Take the " + u.spec.name : u.spec.label}`;
    else if (onGround && roofCandidate()) pr = "<kbd>Space</kbd><kbd>Space</kbd> Jump onto roof";
  }
  setHud("prompt", promptEl, pr);
}
let adTimer = 0;
function animateBillboards(dt) {
  adTimer -= dt;
  if (adTimer > 0 || !billboards.length) return;
  adTimer = 0.6;
  const b = billboards[Math.floor(rand() * billboards.length)];
  b.frame++;
  drawAd(b, b.frame);
}

// ---------------------------------------------------------------- minimap
const mm = el("minimap");
const mctx = mm.getContext("2d");
const baked = document.createElement("canvas");
baked.width = WORLD.x1 - WORLD.x0;
baked.height = WORLD.z1 - WORLD.z0;
const toMap = (x, z) => [x - WORLD.x0, WORLD.z1 - z];
{
  const c = baked.getContext("2d");
  c.fillStyle = "#1c2a1f"; c.fillRect(0, 0, baked.width, baked.height);
  c.fillStyle = "#17181e";
  const [cx0, cz0] = toMap(CITY.x0, CITY.z1);
  c.fillRect(cx0, cz0, CITY.x1 - CITY.x0 + 30, CITY.z1 - CITY.z0);
  const [px, pz] = toMap(PARIS.x, PARIS.z);
  c.fillStyle = "#211f1c"; c.beginPath(); c.arc(px, pz, 216, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#1f5f80"; c.fillRect(0, 0, toMap(SHORE_X, 0)[0], baked.height);
  c.fillStyle = "#8a7c5c"; c.fillRect(toMap(SHORE_X, 0)[0], 0, 55, baked.height);
  const [qx, qz] = toMap(POND.x, POND.z);
  c.fillStyle = "#2a6d8f"; c.beginPath(); c.arc(qx, qz, POND.r, 0, Math.PI * 2); c.fill();
  c.lineCap = "round"; c.lineJoin = "round";
  for (const pass of [0, 1]) {
    for (const e of edges) {
      c.strokeStyle = pass ? "#6d7178" : "#3a3d44";
      c.lineWidth = pass ? e.w : e.w + e.sw * 2;
      c.beginPath();
      for (let i = 0; i < e.xs.length; i++) { const [x, z] = toMap(e.xs[i], e.zs[i]); i ? c.lineTo(x, z) : c.moveTo(x, z); }
      c.stroke();
    }
  }
  for (const b of mapBuildings) {
    c.fillStyle = b.color;
    c.beginPath();
    b.pts.forEach(([x, z], i) => { const [mx, mz] = toMap(x, z); i ? c.lineTo(mx, mz) : c.moveTo(mx, mz); });
    c.closePath(); c.fill();
    if (b.door) { const [dx, dz] = toMap(b.door[0], b.door[1]); c.fillStyle = "#ffe08a"; c.beginPath(); c.arc(dx, dz, 3, 0, Math.PI * 2); c.fill(); }
  }
}
function drawMinimap() {
  const W = mm.width, R = W / 2;
  mctx.save();
  mctx.clearRect(0, 0, W, W);
  mctx.beginPath(); mctx.arc(R, R, R, 0, Math.PI * 2); mctx.clip();
  mctx.fillStyle = "#16171d"; mctx.fillRect(0, 0, W, W);
  mctx.translate(R, R); mctx.rotate(-yaw); mctx.scale(0.9, 0.9);
  const [px, pz] = toMap(pos.x, pos.z);
  mctx.drawImage(baked, -px, -pz);
  const dot = (x, z, r, col) => {
    const [tx, tz] = toMap(x, z);
    const dx = tx - px, dz = tz - pz;
    if (Math.abs(dx) > 160 || Math.abs(dz) > 160) return;
    mctx.fillStyle = col; mctx.beginPath(); mctx.arc(dx, dz, r, 0, Math.PI * 2); mctx.fill();
  };
  for (const t of traffic) dot(t.vx, t.vz, 3.2, "#4a8cff");
  for (const p of peds) dot(p.x, p.z, 1.6, p.state === "flee" ? "#ff8a5c" : "#d9d9d9");
  for (const v of vehicles) if (v !== vehicle && !v.wrecked && v.kind === "bike") dot(v.mesh.position.x, v.mesh.position.z, 2.2, "#7ee3a1");
  mctx.restore();
  mctx.save();
  mctx.translate(R, R); mctx.rotate((vehicle ? vehicle.heading : facing) - yaw);
  mctx.fillStyle = "#fff"; mctx.strokeStyle = "#222"; mctx.lineWidth = 1.5;
  mctx.beginPath(); mctx.moveTo(0, -10); mctx.lineTo(7, 8); mctx.lineTo(0, 4); mctx.lineTo(-7, 8); mctx.closePath();
  mctx.fill(); mctx.stroke();
  mctx.restore();
  const nr = R - 16;
  mctx.fillStyle = "#fff"; mctx.font = "bold 15px Segoe UI, sans-serif";
  mctx.textAlign = "center"; mctx.textBaseline = "middle";
  mctx.fillText("N", R - nr * Math.sin(yaw), R - nr * Math.cos(yaw));
}

// ---------------------------------------------------------------- full map (M)
// Reuses the baked minimap image (1 px = 1 m, north up). Scroll to zoom,
// drag to pan, C to centre on the player, M / Esc to close.
const bigEl = el("bigmap"), big = el("bigmapCanvas"), bctx = big.getContext("2d");
let bigMapOpen = false, bigZoom = 1, bigFit = 1, bigCx = 0, bigCz = 0, bigDrag = null, bigTimer = 0;
const MAP_LABELS = [
  { x: 330, z: 0, t: "MIDTOWN", s: "Babylon City" },
  { x: PARIS.x, z: PARIS.z + 120, t: "SAINT-CLAIR", s: "Residential quarter" },
  { x: -175, z: -330, t: "RIVERSIDE PARK", s: "" },
  { x: SHORE_X + 10, z: -420, t: "THE COAST", s: "" },
];
function bigToScreen(x, z) {
  const [mx, mz] = toMap(x, z);
  return [big.width / 2 + (mx - bigCx) * bigZoom, big.height / 2 + (mz - bigCz) * bigZoom];
}
function centerBigMap() { [bigCx, bigCz] = toMap(pos.x, pos.z); drawBigMap(); }
function toggleBigMap(force) {
  bigMapOpen = force ?? !bigMapOpen;
  bigEl.classList.toggle("show", bigMapOpen);
  if (!bigMapOpen) return;
  for (const k in keys) keys[k] = false;
  firing = false; aiming = false;
  if (locked()) document.exitPointerLock();
  big.width = window.innerWidth; big.height = window.innerHeight;
  bigFit = Math.min(big.width / baked.width, big.height / baked.height) * 0.94;
  bigZoom = bigFit;
  bigCx = baked.width / 2; bigCz = baked.height / 2;
  drawBigMap();
}
function drawBigMap() {
  const W = big.width, H = big.height, z = bigZoom;
  bctx.fillStyle = "#0e0f13"; bctx.fillRect(0, 0, W, H);
  bctx.save();
  bctx.translate(W / 2, H / 2); bctx.scale(z, z); bctx.translate(-bigCx, -bigCz);
  bctx.imageSmoothingEnabled = z < 2;
  bctx.drawImage(baked, 0, 0);
  bctx.restore();

  const dot = (x, zz, r, col) => {
    const [sx, sy] = bigToScreen(x, zz);
    if (sx < -10 || sy < -10 || sx > W + 10 || sy > H + 10) return;
    bctx.fillStyle = col; bctx.beginPath(); bctx.arc(sx, sy, r, 0, Math.PI * 2); bctx.fill();
  };
  const r = clamp(z * 1.6, 1.5, 5);
  for (const t of traffic) dot(t.vx, t.vz, r, "#4a8cff");
  if (z > bigFit * 1.8) for (const p of peds) dot(p.x, p.z, r * 0.6, p.state === "flee" ? "#ff8a5c" : "#d9d9d9");
  for (const v of vehicles) {
    if (v === vehicle || v.wrecked) continue;
    const sp = specOf(v);
    if (sp.name === "supercar" || sp.name === "superbike") dot(v.mesh.position.x, v.mesh.position.z, r * 1.2, "#ff4fd8");
    else if (v.kind === "bike") dot(v.mesh.position.x, v.mesh.position.z, r * 0.9, "#7ee3a1");
  }

  bctx.textAlign = "center"; bctx.textBaseline = "middle";
  // enterable buildings — names once zoomed in a little
  for (const e of enterables) {
    const [x, zz] = xfp(e.xf, 0, e.minZ);
    const [sx, sy] = bigToScreen(x, zz);
    bctx.fillStyle = "#ffe08a"; bctx.beginPath(); bctx.arc(sx, sy, Math.max(3, r), 0, Math.PI * 2); bctx.fill();
    if (z > bigFit * 1.6) {
      bctx.font = "600 12px Segoe UI, sans-serif";
      bctx.fillStyle = "rgba(0,0,0,.6)"; bctx.fillText(e.name, sx + 1, sy - 13);
      bctx.fillStyle = "#ffe08a"; bctx.fillText(e.name, sx, sy - 14);
    }
  }
  // district labels
  for (const l of MAP_LABELS) {
    const [sx, sy] = bigToScreen(l.x, l.z);
    bctx.font = `800 ${Math.round(clamp(z * 30, 16, 34))}px Segoe UI, sans-serif`;
    bctx.fillStyle = "rgba(0,0,0,.55)"; bctx.fillText(l.t, sx + 2, sy + 2);
    bctx.fillStyle = "#f4f1ea"; bctx.fillText(l.t, sx, sy);
    if (l.s) {
      bctx.font = "500 14px Segoe UI, sans-serif";
      bctx.fillStyle = "rgba(244,241,234,.8)"; bctx.fillText(l.s, sx, sy + Math.round(clamp(z * 30, 16, 34)) * 0.8);
    }
  }
  // the player (north-up: heading 0 points up the screen)
  const [px, py] = bigToScreen(pos.x, pos.z);
  bctx.save();
  bctx.translate(px, py); bctx.rotate(vehicle ? vehicle.heading : facing);
  bctx.fillStyle = "#fff"; bctx.strokeStyle = "#e0322b"; bctx.lineWidth = 2.5;
  bctx.beginPath(); bctx.moveTo(0, -13); bctx.lineTo(9, 10); bctx.lineTo(0, 5); bctx.lineTo(-9, 10); bctx.closePath();
  bctx.fill(); bctx.stroke();
  bctx.restore();
  // compass
  bctx.font = "800 20px Segoe UI, sans-serif"; bctx.fillStyle = "#fff";
  bctx.fillText("N ↑", W - 50, 40);
}
big.addEventListener("wheel", (e) => {
  e.preventDefault();
  // zoom around the cursor: the map point under it stays put
  const mx = bigCx + (e.offsetX - big.width / 2) / bigZoom, mz = bigCz + (e.offsetY - big.height / 2) / bigZoom;
  bigZoom = clamp(bigZoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), bigFit * 0.8, 8);
  bigCx = mx - (e.offsetX - big.width / 2) / bigZoom;
  bigCz = mz - (e.offsetY - big.height / 2) / bigZoom;
  drawBigMap();
}, { passive: false });
big.addEventListener("pointerdown", (e) => { bigDrag = { x: e.clientX, y: e.clientY }; big.setPointerCapture(e.pointerId); });
big.addEventListener("pointermove", (e) => {
  if (!bigDrag) return;
  bigCx -= (e.clientX - bigDrag.x) / bigZoom; bigCz -= (e.clientY - bigDrag.y) / bigZoom;
  bigDrag = { x: e.clientX, y: e.clientY };
  drawBigMap();
});
big.addEventListener("pointerup", () => { bigDrag = null; });
el("bigmapClose").addEventListener("click", () => toggleBigMap(false));
window.addEventListener("resize", () => { if (bigMapOpen) { big.width = window.innerWidth; big.height = window.innerHeight; drawBigMap(); } });

// ---------------------------------------------------------------- start + debug params
// ?night=1  ?time=<hours>  ?ride=car|bike  ?b=<enterable>&f=<floor>  ?jump=1  ?at=x,z,yaw  ?pitch= ?dist=
window.__city = { pos, enterables, roofs, vehicles, traffic, peds, setTime, fire, startSuperJump, edges };
yaw = Math.PI / 2; // look east at the skyline
{
  const q = new URLSearchParams(location.search);
  const bi = q.get("b");
  if (bi !== null && enterables[+bi]) {
    const e = enterables[+bi];
    const fl = Math.min(e.F, +(q.get("f") || 0));
    const [x, z] = xfp(e.xf, e.minX + 4.5, e.maxZ - 7.2);
    pos.set(x, fl * e.fh, z);
    yaw = e.xf.yaw + Math.PI * 0.25;
  }
  if (q.get("jump")) {
    const r = roofs.filter((rf) => !rf.landing && rf.top > 20)
      .sort((a, b) => Math.hypot(a.xf.cx - START.x, a.xf.cz - START.z) - Math.hypot(b.xf.cx - START.x, b.xf.cz - START.z))[0];
    const [x, z] = xfp(r.xf, 0, -r.hd - 1.5);
    pos.set(x, 0, z);
    yaw = r.xf.yaw;
  }
  if (q.get("at")) { const [x, z, y2] = q.get("at").split(",").map(Number); pos.set(x, 0, z); if (!isNaN(y2)) yaw = y2; }
  if (q.get("pitch") !== null) pitch = +q.get("pitch");
  if (q.get("dist") !== null) camDist = +q.get("dist");
  facing = yaw;
  if (q.get("night")) tod = 22;
  if (q.get("time") !== null) tod = +q.get("time");
  applyTimeOfDay();
  const ride = q.get("ride");
  if (ride === "car" || ride === "bike") {
    const v = vehicles.find((x) => x.kind === ride);
    pos.copyFrom(v.mesh.position);
    enterVehicle(v);
    if (q.get("speed")) v.speed = +q.get("speed");
  }
}
camera.position.set(pos.x - Math.sin(yaw) * 6, pos.y + 2.5, pos.z - Math.cos(yaw) * 6);

// ---------------------------------------------------------------- loop
let mapTimer = 0;
engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  const now = performance.now();
  if (interactQueued) {
    interactQueued = false;
    if (vehicle) exitVehicle();
    else if (downTimer <= 0) { const u = nearestUsable(); if (u) enterVehicle(u.e ? stealTraffic(u) : u); }
  }
  if (superJumpQueued) { superJumpQueued = false; if (!vehicle) startSuperJump(); }

  updateTraffic(dt, now, { pos, vehicle, peds });
  if (vehicle) updateVehicle(dt);
  else {
    updatePlayer(dt);
    shotCooldown -= dt;
    if (firing && locked() && shotCooldown <= 0 && downTimer <= 0) fire();
  }
  updatePeds(dt, { pos, vehicle, vehicleSpeed: vehicle ? vehicle.speed : 0 });
  updateCamera(dt);
  updateTimeOfDay(dt);
  updateEffects(dt);
  updateHud(dt);
  animateBillboards(dt);
  mapTimer += dt;
  if (mapTimer > 1 / 30) { mapTimer = 0; drawMinimap(); }
  if (bigMapOpen && (bigTimer += dt) > 0.2) { bigTimer = 0; drawBigMap(); }   // live traffic + player
  scene.render();
});
window.addEventListener("resize", () => engine.resize());
document.getElementById("loading")?.remove();
