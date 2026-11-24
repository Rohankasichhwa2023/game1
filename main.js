// main.js — builds the world (roads → buildings → lamps → nature → vehicles →
// people), then runs the game: third-person player, shooting, driving,
// night mode, camera, HUD, minimap and the main loop.
import {
  V3,
  C3,
  canvas,
  engine,
  scene,
  camera,
  hemi,
  sun,
  glow,
  SKY,
  NIGHT_SKY,
  state,
  rand,
  rr,
  clamp,
  hex,
  angDiff,
  flatMats,
  interiorMats,
  litMat,
  canvasTex,
  radialTex,
  emissiveTemplate,
  flushAccs,
  query,
  circleHit,
  pushOut,
  pointIn,
  rayBox,
  xfp,
  xfl,
  makeXF,
  removeSolid,
  terrainH,
  terrainSlope,
  addTerrainFlat,
  landH,
  groundAt,
  beginStatic,
  flushStatic,
  updateAmbient,
} from "./engine.js";
import { createFacades, facadeList } from "./textures.js";
import {
  generateRoads,
  buildRoadMeshes,
  buildLamps,
  lampPools,
  bulbMats,
  edges,
  districtAt,
  PARIS,
  CITY,
  SHORE_X,
  WORLD,
  landmarks,
  roadDist,
  reserved,
  nodes,
  pathAt,
} from "./roads.js";
import {
  planBuildings,
  buildBuildings,
  mapBuildings,
  roofs,
  enterables,
  billboards,
  drawAd,
  postFlush,
  homes,
  pulseHomeMarkers,
} from "./buildings.js";
import {
  nearestHome,
  enterHome,
  leaveHome,
  atExit,
  WORLD_MASK,
  INSIDE_MASK,
  BOTH_MASK,
  RENDER_SHIFT,
} from "./interiors.js";
import { buildGround, buildNature, POND } from "./nature.js";
import { RW, river, riverDist } from "./london.js";
import {
  initMission,
  updateMission,
  missionObjective,
  missionOnPedDown,
  missionShootables,
  setMissionUIHidden,
  missionHitGoon,
  missionRespawn,
  missionOnRespawn,
  missionTimeScale,
} from "./mission.js";
import {
  buildLondonGround,
  buildLondonWorld,
  updateLondon,
} from "./londonWorld.js";
import { KTM, KTM_CORE } from "./kathmandu.js";
import { TERRAIN_BOX } from "./terrain.js";
import { buildBridges, seaAt, deckAt, landSdf, onBridge } from "./water.js";
import { buildCoast, buildBridgeStructures, buildDocks, animateSea } from "./coast.js";
import {
  buildKathmanduWorld,
  initKathmanduCulling,
  updateKathmandu,
} from "./ktmBuild.js";
import {
  initVehicleTemplates,
  spawnParked,
  spawnBoats,
  driveBoat,
  sinkMesh,
  updateSinking,
  spawnTraffic,
  updateTraffic,
  vehicles,
  traffic,
  VEH,
  specOf,
  vehicleSolid,
  stealTraffic,
  swapToBurnt,
  driveVehicle,
  knockTraffic,
} from "./vehicles.js";
import {
  spawnPeds,
  spawnDistrictPeds,
  updatePeds,
  peds,
  knockDown,
  scare,
  pedHooks,
} from "./people.js";
import * as sfx from "./sound.js";
import {
  spawnCharacters,
  updateCharacters,
  hideCharacterUI,
  inConversation,
  talkPrompt,
  characterMarkers,
} from "./characters.js";

// ---------------------------------------------------------------- build the world
const t0 = performance.now();
createFacades();
generateRoads();
// the districts are islands: roads over the sea become bridges (water.js)
buildBridges(edges, pathAt);
// Kathmandu's hillside: level terraces for the temple squares and Durbar Square
// (before anything is built on the terrain)
for (const q of landmarks.ktmSquares || []) addTerrainFlat(q.x, q.z, q.r + 4, 60);
if (landmarks.ktmDurbar)
  addTerrainFlat(landmarks.ktmDurbar.x, landmarks.ktmDurbar.z, 46, 75);

// The old start point in the middle of Saint-Clair: no longer where you spawn,
// but still the reference for which Midtown towers get interiors and where the
// park keeps a clear view (so moving the spawn doesn't reshuffle the world).
const PARIS_START = (() => {
  const fallback = { x: PARIS.x + 14, z: PARIS.z, yaw: Math.PI / 2 };
  const r = (n) => Math.hypot(n.x - PARIS.x, n.z - PARIS.z);
  let best = null,
    bd = Infinity;
  for (const n of nodes) {
    if (n.edges.length < 3 || n.edges.some((e) => e.district !== "paris"))
      continue;
    if (r(n) < 70) continue; // not on the plaza ring itself
    // the radial boulevard leading outward from this junction (so we face inward)
    const e = n.edges.find(
      (x) =>
        x.kind === "radial" && x.len > 40 && r(x.a === n ? x.b : x.a) > r(n),
    );
    if (!e) continue;
    if (r(n) < bd) {
      bd = r(n);
      best = { n, e };
    }
  }
  if (!best) return fallback;
  const { n, e } = best;
  const atA = e.a === n,
    s0 = atA ? 15 : e.len - 15,
    dir = atA ? -1 : 1; // dir: +1 = walking toward the node along +s
  const at = (s, off) => {
    const q = pathAt(e, s, {});
    const fx = q.tx * dir,
      fz = q.tz * dir;
    return { x: q.x + fz * off, z: q.z - fx * off, h: Math.atan2(fx, fz) };
  };
  const walk = e.w / 2 + e.sw * 0.55,
    kerb = e.w / 2 - 1.15;
  const p = at(s0, walk);
  return {
    x: p.x,
    z: p.z,
    yaw: p.h,
    parked: [
      { key: "superbike", ...at(s0 - dir * 3.2, walk) },
      { key: "bike", ...at(s0 - dir * 5.0, walk) },
      { key: "supercar", ...at(s0 - dir * 9, kerb) },
      { key: "suv", ...at(s0 - dir * 15.5, kerb) },
    ],
  };
})();
// Spawn in Kathmandu: on the pavement of an arterial a few steps before a busy
// junction near Durbar Square, facing into it. The starter bikes stand on the
// pavement behind you, the cars are parked at the kerb.
// You start in the middle of Durbar Square's stone courtyard, looking up at
// the palace and its five-tier pagoda tower — temples, crowds and the hill
// town all round, the bikes and a supercar parked at the courtyard's edge,
// and Laxmi Didi (Mission 1) a few steps away by the road.
const START = (() => {
  const d = landmarks.ktmDurbar;
  if (!d) return startRoadside();
  const at = (lx, lz) => xfp(makeXF(d.x, d.z, d.yaw), lx, lz);
  const [x, z] = at(-4, -15);
  const side = d.yaw + Math.PI / 2; // parked across the courtyard front
  const car = (key, lx, lz, h) => {
    const [px, pz] = at(lx, lz);
    return { key, x: px, z: pz, h };
  };
  return {
    x,
    z,
    yaw: d.yaw, // facing the palace (local +z)
    parked: [
      car("superbike", 3.5, -19, side + 0.3),
      car("bike", 5.2, -20.5, side + 0.3),
      car("supercar", -14, -22, side),
      car("suv", 13, -22.5, side + Math.PI),
    ],
  };
})();
// (the old spawn: on an arterial just before a busy junction near the square)
function startRoadside() {
  const goal = landmarks.ktmDurbar || KTM_CORE;
  const dG = (n) => Math.hypot(n.x - goal.x, n.z - goal.z);
  let best = null,
    bd = Infinity;
  for (const n of nodes) {
    if (n.edges.length < 3 || n.edges.some((e) => e.district !== "kathmandu"))
      continue;
    const e = n.edges.find((x) => x.kind === "artery" && x.len > 30);
    if (!e || dG(n) >= bd) continue;
    bd = dG(n);
    best = { n, e };
  }
  if (!best) return PARIS_START;
  const { n, e } = best;
  const back = Math.min(16, e.len / 2),
    atA = e.a === n,
    s0 = atA ? back : e.len - back,
    dir = atA ? -1 : 1; // dir: +1 = walking toward the node along +s
  const at = (s, off) => {
    const q = pathAt(e, s, {});
    const fx = q.tx * dir,
      fz = q.tz * dir;
    return { x: q.x + fz * off, z: q.z - fx * off, h: Math.atan2(fx, fz) };
  };
  const walk = e.w / 2 + e.sw * 0.55,
    kerb = e.w / 2 - 1.15;
  const p = at(s0, walk);
  return {
    x: p.x,
    z: p.z,
    yaw: p.h,
    parked: [
      { key: "superbike", ...at(s0 - dir * 3.2, walk) },
      { key: "bike", ...at(s0 - dir * 5.0, walk) },
      { key: "supercar", ...at(s0 - dir * 9, kerb) },
      { key: "suv", ...at(s0 - dir * 15.5, kerb) },
    ],
  };
}
beginStatic(); // static props are batched into thin instances (see engine.js)
buildRoadMeshes();
buildGround();
buildLondonGround();
planBuildings(PARIS_START);
buildBuildings();
buildLamps();
buildNature(PARIS_START);
buildLondonWorld();
{
  // Kathmandu: ground, squares + temples, Durbar Square palace
  const k = buildKathmanduWorld(landmarks);
  mapBuildings.push(...k.map);
  roofs.push(...k.roofs);
}
// islands: sea, beaches, bridges, and jetties with boats round the bay
buildCoast();
buildBridgeStructures();
const MOORINGS = buildDocks([
  { x: KTM.x0 - 45, z: 830 },    // Kathmandu's west shore (nearest the start)
  { x: PARIS.x, z: PARIS.z + 368 }, // Saint-Clair's north shore
  { x: -150, z: 470 },           // Midtown's north-west corner
]);
flushAccs();
flushStatic();
initKathmanduCulling();
for (const f of postFlush) f();
initVehicleTemplates();
spawnParked(START);
spawnBoats(MOORINGS);
spawnTraffic();
spawnPeds(300);
spawnDistrictPeds("kathmandu", 300); // Kathmandu's busy lanes (dormant while you're elsewhere)
spawnCharacters();
initMission({
  moorings: MOORINGS,
  combat: {
    hurtPlayer: (n, fx, fz) => hurtPlayer(n, fx, fz),
    tracer: (a, b) => tracer(a, b),
    spark: (p, s, l) => spark(p, s, l),
    shotClear: (a, b) => shotClear(a, b),
    shotSound: (x, z) => sfx.enemyShot(Math.hypot(x - pos.x, z - pos.z), panOf(x, z)),
    deathSound: (x, z) => sfx.npcDeath(Math.hypot(x - pos.x, z - pos.z), panOf(x, z)),
    playerVehicle: () => vehicle,
    playerDead: () => playerDead,
    flushAccs: () => flushAccs(),
    setTime: (h) => setTime(h),
  },
});
console.log(
  `World built in ${Math.round(performance.now() - t0)} ms — ${edges.length} roads, ${mapBuildings.length} buildings (${homes.length} homes), ${traffic.length} cars, ${peds.length} people`,
);

// ---------------------------------------------------------------- player model
const MB = BABYLON.MeshBuilder;
const skinMat = litMat("playerSkin", hex("#c08462"), 0.18);
skinMat.specularPower = 24;
const shortsMat = litMat("shorts", hex("#2c2f33"), 0.05);
const player = new BABYLON.TransformNode("player", scene);
const cap = (r, h, mat, parent, x, y, z, sx = 1, sy = 1, sz = 1) => {
  const m = MB.CreateCapsule(
    "c",
    { radius: r, height: h, tessellation: 12, subdivisions: 2 },
    scene,
  );
  m.material = mat;
  m.parent = parent;
  m.position.set(x, y, z);
  m.scaling.set(sx, sy, sz);
  return m;
};
const sph = (d, mat, parent, x, y, z, sx = 1, sy = 1, sz = 1) => {
  const m = MB.CreateSphere("s", { diameter: d, segments: 12 }, scene);
  m.material = mat;
  m.parent = parent;
  m.position.set(x, y, z);
  m.scaling.set(sx, sy, sz);
  return m;
};
const pivot = (parent, x, y, z) => {
  const n = new BABYLON.TransformNode("p", scene);
  n.parent = parent;
  n.position.set(x, y, z);
  return n;
};
// stunt pivot at the waist (flips / rolls / twirls / banking spin the body round
// it); the body itself still hangs from the feet, as the normal poses expect
const stuntPivot = pivot(player, 0, 1.0, 0);
const stuntOff = pivot(stuntPivot, 0, -1.0, 0);
const body = pivot(stuntOff, 0, 0, 0);
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
  const hand = pivot(el, 0, -0.33, 0.02); // where a web leaves the wrist
  return { sh, el, hand };
}
function makeLeg(side) {
  const hip = pivot(body, side * 0.11, 0.93, 0);
  cap(0.105, 0.24, shortsMat, hip, 0, -0.07, 0);
  cap(0.095, 0.46, skinMat, hip, 0, -0.22, 0);
  const knee = pivot(hip, 0, -0.45, 0);
  cap(0.072, 0.44, skinMat, knee, 0, -0.21, 0);
  const foot = MB.CreateBox(
    "foot",
    { width: 0.1, height: 0.06, depth: 0.24 },
    scene,
  );
  foot.material = skinMat;
  foot.parent = knee;
  foot.position.set(0, -0.44, 0.05);
  return { hip, knee };
}
const armL = makeArm(-1),
  armR = makeArm(1);
const legL = makeLeg(-1),
  legR = makeLeg(1);
const gunMat = litMat("gunM", hex("#202226"), 0.5);
const gun = pivot(armR.el, 0, -0.33, 0.04);
for (const [w, h, d, x, y, z] of [
  [0.05, 0.24, 0.07, 0, -0.07, 0],
  [0.045, 0.07, 0.13, 0, 0.03, 0.05],
]) {
  const b = MB.CreateBox("gunPart", { width: w, height: h, depth: d }, scene);
  b.material = gunMat;
  b.parent = gun;
  b.position.set(x, y, z);
}
const muzzle = pivot(gun, 0, -0.2, 0);
const blobTex = radialTex("blob", [
  [0, "rgba(0,0,0,0.5)"],
  [0.6, "rgba(0,0,0,0.25)"],
  [1, "rgba(0,0,0,0)"],
]);
const blob = MB.CreateGround("blob", { width: 1.5, height: 1.1 }, scene);
const blobMat = new BABYLON.StandardMaterial("blobMat", scene);
blobMat.diffuseTexture = blobTex;
blobMat.useAlphaFromDiffuseTexture = true;
blobMat.disableLighting = true;
blobMat.emissiveColor = new C3(0, 0, 0);
blobMat.zOffset = -7;
blob.material = blobMat;

// ---------------------------------------------------------------- effects
const tracerT = emissiveTemplate(
  "tracer",
  MB.CreateBox("tracer", { size: 1 }, scene),
  hex("#ffe9a0"),
);
const sparkT = emissiveTemplate(
  "spark",
  MB.CreateSphere("spark", { diameter: 1, segments: 6 }, scene),
  hex("#ffb347"),
);
const flashT = emissiveTemplate(
  "flash",
  MB.CreateSphere("flash", { diameter: 1, segments: 10 }, scene),
  hex("#ff9a3c"),
);
const effects = [];
function addEffect(mesh, life, update) {
  effects.push({ mesh, t: 0, life, update });
}
function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.t += dt;
    if (e.t >= e.life) {
      e.mesh.dispose();
      effects.splice(i, 1);
      continue;
    }
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
const smokeTex = radialTex(
  "smoke",
  [
    [0, "rgba(255,255,255,0.9)"],
    [0.5, "rgba(255,255,255,0.35)"],
    [1, "rgba(255,255,255,0)"],
  ],
  64,
);
function smoke(pos, seconds) {
  const ps = new BABYLON.ParticleSystem("smoke", 180, scene);
  ps.particleTexture = smokeTex;
  ps.emitter = pos.clone();
  ps.minEmitBox = new V3(-0.8, 0.5, -0.8);
  ps.maxEmitBox = new V3(0.8, 1.2, 0.8);
  ps.color1 = new BABYLON.Color4(0.22, 0.2, 0.19, 0.55);
  ps.color2 = new BABYLON.Color4(0.08, 0.08, 0.08, 0.5);
  ps.colorDead = new BABYLON.Color4(0, 0, 0, 0);
  ps.minSize = 1.2;
  ps.maxSize = 3.2;
  ps.minLifeTime = 2.5;
  ps.maxLifeTime = 4.5;
  ps.emitRate = 22;
  ps.direction1 = new V3(-0.6, 3.5, -0.6);
  ps.direction2 = new V3(0.6, 5, 0.6);
  ps.minEmitPower = 0.6;
  ps.maxEmitPower = 1.2;
  ps.gravity = new V3(0.4, 0.3, 0.2);
  ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
  ps.start();
  setTimeout(() => ps.stop(), seconds * 1000);
  setTimeout(() => ps.dispose(), (seconds + 6) * 1000);
  const fire = new BABYLON.ParticleSystem("fire", 120, scene);
  fire.particleTexture = smokeTex;
  fire.emitter = pos.clone();
  fire.minEmitBox = new V3(-0.7, 0.3, -0.9);
  fire.maxEmitBox = new V3(0.7, 0.9, 0.9);
  fire.color1 = new BABYLON.Color4(1, 0.6, 0.15, 0.9);
  fire.color2 = new BABYLON.Color4(1, 0.3, 0.05, 0.8);
  fire.colorDead = new BABYLON.Color4(0.2, 0.05, 0, 0);
  fire.minSize = 0.5;
  fire.maxSize = 1.3;
  fire.minLifeTime = 0.3;
  fire.maxLifeTime = 0.8;
  fire.emitRate = 60;
  fire.direction1 = new V3(-0.3, 2, -0.3);
  fire.direction2 = new V3(0.3, 3.5, 0.3);
  fire.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
  fire.start();
  setTimeout(() => fire.stop(), seconds * 600);
  setTimeout(() => fire.dispose(), seconds * 600 + 2000);
}

// ---------------------------------------------------------------- night mode
const starTex = canvasTex(
  "stars",
  2048,
  (ctx, W, H) => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#02040a");
    g.addColorStop(0.45, "#0a1226");
    g.addColorStop(0.5, "#0d1830");
    g.addColorStop(1, "#02040a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = `rgba(255,255,${rr(220, 255) | 0},${rr(0.25, 1)})`;
      const s = rand() < 0.04 ? 2.2 : rr(0.8, 1.5);
      ctx.fillRect(rand() * W, rand() * H * 0.48, s, s);
    }
  },
  true,
  1024,
);
const skyDome = MB.CreateSphere(
  "sky",
  { diameter: 2600, segments: 16, sideOrientation: BABYLON.Mesh.BACKSIDE },
  scene,
);
const skyMat = new BABYLON.StandardMaterial("skyM", scene);
skyMat.disableLighting = true;
skyMat.emissiveTexture = starTex;
skyMat.fogEnabled = false;
skyMat.backFaceCulling = false;
skyDome.material = skyMat;
skyDome.infiniteDistance = true;
skyDome.setEnabled(false);
const moonTex = radialTex("moon", [
  [0, "rgba(255,252,235,1)"],
  [0.42, "rgba(245,240,220,1)"],
  [0.48, "rgba(200,210,240,0.35)"],
  [1, "rgba(160,180,230,0)"],
]);
const moon = MB.CreatePlane("moon", { size: 120 }, scene);
const moonMat = new BABYLON.StandardMaterial("moonM", scene);
moonMat.disableLighting = true;
moonMat.emissiveTexture = moonTex;
moonMat.opacityTexture = moonTex;
moonMat.fogEnabled = false;
moon.material = moonMat;
moon.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
moon.infiniteDistance = true;
moon.position.set(-700, 520, 650);
moon.setEnabled(false);
const beamTex = canvasTex(
  "beam",
  256,
  (ctx, S) => {
    ctx.clearRect(0, 0, S, S);
    const g = ctx.createLinearGradient(0, S, 0, 0);
    g.addColorStop(0, "rgba(255,245,215,0.75)");
    g.addColorStop(1, "rgba(255,245,215,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(S * 0.38, S);
    ctx.lineTo(S * 0.62, S);
    ctx.lineTo(S, 0);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
  },
  false,
);
beamTex.hasAlpha = true;
beamTex.wrapU = beamTex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
const beamMat = new BABYLON.StandardMaterial("beamM", scene);
beamMat.disableLighting = true;
beamMat.emissiveTexture = beamTex;
beamMat.opacityTexture = beamTex;
beamMat.alphaMode = BABYLON.Engine.ALPHA_ADD;
beamMat.backFaceCulling = false;
beamMat.zOffset = -6;
const beam = MB.CreateGround("beam", { width: 9, height: 16 }, scene);
beam.material = beamMat;
beam.setEnabled(false);

// ---------------------------------------------------------------- day / night cycle
// Time of day (hours, 0–24) advances continuously; every light, sky colour,
// lit window, street lamp and interior is blended from it. A full day takes
// DAY_LENGTH real seconds.
const DAY_LENGTH = 720; // 12 real minutes per game day
let tod = 9.5; // start mid-morning
const SUNSET = hex("#f4925a"),
  DUSK_LIGHT = hex("#ffbe8a");
const NIGHT_HEMI = hex("#8fa3d6"),
  NIGHT_GROUND = hex("#1c2233"),
  DAY_GROUND = new C3(0.5, 0.5, 0.53);
const NIGHT_IN = new C3(0.5, 0.47, 0.4),
  WARM = new C3(0.55, 0.5, 0.42);
for (const m of interiorMats)
  m.__nightEm = m.diffuseTexture ? WARM.clone() : m.diffuseColor.multiply(WARM);
for (const f of facadeList) {
  f.mat.emissiveTexture = f.nightTex;
  f.nightTex.level = 0;
}
for (const b of bulbMats) {
  b.dayC = hex(b.day);
  b.nightC = hex(b.night);
}
const poolTex = scene.getMaterialByName("poolM").emissiveTexture;
skyMat.alpha = 0;
moonMat.alpha = 0;
const lerpC = (a, b, t) => C3.Lerp(a, b, clamp(t, 0, 1));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
let lampsOn = null,
  innerNight = null;

function applyTimeOfDay() {
  // sun travels east (+x) → overhead → west between 06:00 and 18:00
  const ang = ((tod - 6) / 12) * Math.PI;
  const elev = Math.sin(ang);
  const f = smooth(-0.24, 0.2, elev); // 0 night … 1 full day (long twilight)
  const warmth = clamp(1 - Math.abs(elev - 0.02) / 0.24, 0, 1); // golden hour around sunrise/sunset
  state.night = f < 0.45;

  let sky = lerpC(NIGHT_SKY, SKY, f);
  sky = lerpC(sky, SUNSET, warmth * 0.75 * (0.35 + 0.65 * f));
  scene.clearColor = new BABYLON.Color4(sky.r, sky.g, sky.b, 1);
  scene.fogColor = sky;
  scene.fogStart = 90 + 230 * f;
  scene.fogEnd = 700 + 700 * f;

  hemi.intensity = 0.3 + 0.48 * f;
  hemi.diffuse = lerpC(
    lerpC(NIGHT_HEMI, new C3(1, 1, 1), f),
    DUSK_LIGHT,
    Math.max(0, warmth) * 0.5,
  );
  hemi.groundColor = lerpC(NIGHT_GROUND, DAY_GROUND, f);
  const sx = Math.cos(ang),
    sy = Math.max(0.05, elev);
  sun.direction = new V3(-sx, -sy, -0.35).normalize();
  sun.intensity = 0.5 * smooth(0, 0.25, elev) + 0.06;
  sun.diffuse = lerpC(new C3(1, 1, 1), DUSK_LIGHT, Math.max(0, warmth));

  for (const fm of flatMats) {
    const k = fm.k + (1 - fm.k) * f;
    if (fm.tex) fm.tex.level = k;
    else fm.m.emissiveColor = fm.day.scale(k);
  }
  const lit = 1 - smooth(0.3, 0.8, f); // windows / lamps switch on at dusk
  for (const fc of facadeList) {
    fc.nightTex.level = lit;
    if (fc.imat) fc.imat.emissiveColor = lerpC(fc.imat.__dayEm, NIGHT_IN, lit);
  }
  if (innerNight !== lit > 0.5) {
    innerNight = lit > 0.5;
    for (const fc of facadeList)
      if (fc.imat) fc.imat.diffuseTexture = innerNight ? fc.itexN : fc.itex;
  }
  for (const m of interiorMats)
    m.emissiveColor = lerpC(m.__dayEm, m.__nightEm, lit);
  for (const b of bulbMats) b.m.emissiveColor = lerpC(b.dayC, b.nightC, lit);
  poolTex.level = lit;
  if (lampsOn !== lit > 0.02) {
    lampsOn = lit > 0.02;
    for (const p of lampPools) p.isVisible = lampsOn;
  }

  skyMat.alpha = 1 - smooth(0.0, 0.6, f);
  skyDome.setEnabled(skyMat.alpha > 0.01);
  moonMat.alpha = skyMat.alpha;
  moon.setEnabled(skyMat.alpha > 0.01);
  moon.position.set(-sx * 800, Math.max(120, -elev * 700 + 250), 450); // rises opposite the sun
  glow.intensity = 0.42 + 0.55 * lit;
  // bloom only once it's getting dark (lamps / windows / headlights matter);
  // in full daylight it was the biggest GPU cost for very little to see
  glow.isEnabled = lit > 0.02;
  document.body.classList.toggle("night", state.night);

  const hh = Math.floor(tod),
    mm = Math.floor((tod - hh) * 60);
  clockEl.innerHTML = `${state.night ? "☾" : "☀"} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
const clockEl = document.getElementById("clock");
let todTimer = 0;
function updateTimeOfDay(dt) {
  tod = (tod + (dt * 24) / DAY_LENGTH) % 24;
  todTimer -= dt;
  if (todTimer <= 0) {
    todTimer = 0.15;
    applyTimeOfDay();
  }
}
// N jumps ahead to the next night or morning.
function skipTime() {
  tod = state.night ? 7.0 : 20.5;
  applyTimeOfDay();
}
function setTime(h) {
  tod = ((h % 24) + 24) % 24;
  applyTimeOfDay();
}

// ---------------------------------------------------------------- input
const keys = {};
let meleeQueued = false;
let interactQueued = false,
  swingQueued = false,
  zipQueued = false;
window.addEventListener("keydown", (e) => {
  sfx.unlock(); // browsers only allow audio after a key / click
  if (e.code === "KeyK" && !e.repeat) {
    toast(
      sfx.toggleMute()
        ? "SOUND OFF<small>K to turn it back on</small>"
        : "SOUND ON<small>K to mute</small>",
    );
    return;
  }
  if (e.code === "Tab") {
    e.preventDefault();
    document.getElementById("controls").classList.toggle("show");
  }
  if (e.code === "Space") e.preventDefault();
  // Full map (M) — while it is open the game ignores movement keys.
  if (e.code === "KeyM" && !e.repeat) {
    toggleBigMap();
    return;
  }
  if (bigMapOpen) {
    if (e.code === "Escape") toggleBigMap(false);
    if (e.code === "KeyC") centerBigMap();
    return;
  }
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === "KeyE" || e.code === "Enter") interactQueued = true;
  if (e.code === "KeyQ") meleeQueued = true;
  if (e.code === "KeyF") toggleWeapon();
  if (e.code === "KeyN") skipTime();
});
window.addEventListener("keyup", (e) => {
  keys[e.code] = false;
});
window.addEventListener("blur", () => {
  for (const k in keys) keys[k] = false;
  firing = false;
  aiming = false;
  webHeld = false;
  zipHeld = false;
});

let yaw = 0,
  pitch = 0.12,
  camDist = 6;
let firing = false,
  aiming = false,
  lastMouseAt = 0;
// Left click uses the selected tool: "gun" (shoot, right click aims) or
// "web" (press = shoot a web line, hold = swing, release = let go; right
// click = web zip). F toggles.
let weapon = "gun",
  webHeld = false,
  zipHeld = false;
const locked = () => document.pointerLockElement === canvas;
// Pointer events (Babylon's preventDefault on pointerdown suppresses mouse
// events). Buttons come from the bitmask so left+right together works.
// The click that captures the mouse must not also shoot / fire a web: its
// buttons are ignored until they've been released.
let swallowClick = false;
const syncButtons = (e) => {
  if (!locked()) return;
  if (swallowClick) {
    if (e.buttons === 0) swallowClick = false;
    return;
  }
  const left = (e.buttons & 1) !== 0;
  if (weapon === "gun") {
    firing = left;
    aiming = (e.buttons & 2) !== 0;
  } else {
    if (left && !webHeld) swingQueued = true; // fresh press → fire a web
    webHeld = left;
    const right = (e.buttons & 2) !== 0;
    if (right && !zipHeld) zipQueued = true; // fresh right press → web zip
    zipHeld = right;
    firing = false;
    aiming = false;
  }
};
function toggleWeapon() {
  weapon = weapon === "gun" ? "web" : "gun";
  firing = false;
  aiming = false;
  webHeld = false;
  zipHeld = false; // a swing in progress lets go
  if (!vehicle) gun.setEnabled(weapon === "gun");
}
const weaponLabel = () =>
  weapon === "gun"
    ? "Gun <small><kbd>F</kbd> switch</small>"
    : "Web shooter <small><kbd>F</kbd> switch</small>";
gun.setEnabled(weapon === "gun");
canvas.addEventListener("pointerdown", (e) => {
  if (!locked()) {
    swallowClick = true;
    firing = false;
    aiming = false;
    webHeld = false;
    zipHeld = false;
    const p = canvas.requestPointerLock && canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
    return;
  }
  syncButtons(e);
});
window.addEventListener("pointerup", syncButtons);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("pointerlockchange", () => {
  document.getElementById("clickToPlay").style.display = locked()
    ? "none"
    : "block";
  if (!locked()) {
    firing = false;
    aiming = false;
    webHeld = false;
    zipHeld = false;
  }
});
document.addEventListener("pointermove", (e) => {
  if (!locked()) return;
  syncButtons(e);
  const sens = aiming ? 0.0013 : 0.0025;
  yaw += e.movementX * sens;
  pitch = clamp(pitch + e.movementY * sens * 0.8, -1.45, 1.25); // -1.45 ≈ looking almost straight up
  if (Math.abs(e.movementX) > 1) lastMouseAt = performance.now();
});
canvas.addEventListener(
  "wheel",
  (e) => {
    camDist = clamp(camDist + Math.sign(e.deltaY) * 0.8, 2, 18);
    e.preventDefault();
  },
  { passive: false },
);

// ---------------------------------------------------------------- on-foot physics
const RADIUS = 0.4,
  STEP = 0.42,
  HEIGHT = 1.8,
  GRAV = 22;
const pos = new V3(START.x, terrainH(START.x, START.z), START.z);
let home = null; // the home we're inside (its interior is the only thing drawn)
let homeBusy = false; // fading in / out
let vy = 0,
  onGround = true,
  facing = 0,
  walkPhase = 0,
  moveAmt = 0;
let pushX = 0,
  pushZ = 0,
  aimTimer = 0,
  vehicle = null;

// height of the player above the bare ground (not counting roofs etc.)
const aboveGround = () => pos.y - terrainH(pos.x, pos.z);
function supportHeight(x, z, y) {
  // the ground itself (hilly in Kathmandu), or a bridge deck if you're up on it
  let best = groundAt(x, z, y);
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
  const list = query(
    p.x - RADIUS - 0.1,
    p.x + RADIUS + 0.1,
    p.z - RADIUS - 0.1,
    p.z + RADIUS + 0.1,
  ).slice();
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
  for (const e of enterables)
    if (pos.y < e.F * e.fh - 0.5 && inEnterable(e, pos.x, pos.z)) return e;
  return null;
}

// ---------------------------------------------------------------- web swinging
// With the web shooter selected the game keeps a web target picked for you: a
// spot on a building above and ahead (the way you're travelling / looking),
// marked by a white reticle. Left click shoots a web at it: hold to swing on it
// as a pendulum, release to let go and fly on with your momentum, click again
// mid-air to chain. Right click is a web zip to the roof edge under the amber
// reticle (near the crosshair): it yanks you there and you vault up onto it.
// Swinging: W pumps and steers toward the camera, A / D carve, S brakes, Shift
// pumps harder. From the street the first web launches you up off your feet.
// Swinging up level with the anchor lets go automatically with a fling.
const WEB_RANGE = 70,
  SWING_MAX = 46,
  HAND = 1.6,
  ZIP_RANGE = 55,
  ZIP_MAX = 34;
let lastWebAt = 0;
let swing = null; // { ax, ay, az, len, reelTo, reelRate, launch, vx, vy, vz, age, shot, shotDur, arm }
let zip = null; // { ax, ay, az, nx, nz, top, vx, vy, vz, t, age, shot, shotDur, arm, best, bestT }
const airVel = { x: 0, z: 0 }; // horizontal momentum carried through the air after a swing / zip
const pvel = { x: 0, y: 0, z: 0 }; // measured player velocity (smoothed), see trackVelocity
const lastPos = pos.clone();
const vel = { x: 0, y: 0, z: 0 },
  mom = { x: 0, y: 0, z: 0 };

function trackVelocity(dt) {
  if (dt <= 0) return;
  const vx = (pos.x - lastPos.x) / dt,
    vy2 = (pos.y - lastPos.y) / dt,
    vz = (pos.z - lastPos.z) / dt;
  lastPos.copyFrom(pos);
  if (Math.abs(vx) + Math.abs(vy2) + Math.abs(vz) > 150) return; // teleported (doors, cars, start)
  const k = Math.min(1, dt * 15);
  pvel.x += (vx - pvel.x) * k;
  pvel.y += (vy2 - pvel.y) * k;
  pvel.z += (vz - pvel.z) * k;
}
// The player's current velocity (exact while on a web, measured otherwise).
function playerVel() {
  const w = swing || zip;
  if (w) {
    vel.x = w.vx;
    vel.y = w.vy;
    vel.z = w.vz;
  } else if (vehicle) {
    vel.x = Math.sin(vehicle.heading) * vehicle.speed;
    vel.y = 0;
    vel.z = Math.cos(vehicle.heading) * vehicle.speed;
  } else {
    vel.x = pvel.x;
    vel.y = pvel.y;
    vel.z = pvel.z;
  }
  return vel;
}
// The momentum a new web starts from, so attaching never stops you dead.
function takeMomentum() {
  const w = swing || zip;
  if (w) {
    mom.x = w.vx;
    mom.y = w.vy;
    mom.z = w.vz;
  } else if (onGround) {
    mom.x = pvel.x;
    mom.y = 0;
    mom.z = pvel.z;
  } else if (airVel.x || airVel.z) {
    mom.x = airVel.x;
    mom.y = vy;
    mom.z = airVel.z;
  } else {
    mom.x = pvel.x;
    mom.y = vy;
    mom.z = pvel.z;
  }
  return mom;
}

// ---- targeting
// Distance along a ray to the first building/wall (not vehicles), or null.
function rayToSolid(o, d, max) {
  let best = max,
    hit = false;
  for (let t = 0; t < best; t += 8) {
    const t2 = Math.min(t + 8, best);
    const ax = o.x + d.x * t,
      az = o.z + d.z * t,
      bx = o.x + d.x * t2,
      bz = o.z + d.z * t2;
    for (const s of query(
      Math.min(ax, bx),
      Math.max(ax, bx),
      Math.min(az, bz),
      Math.max(az, bz),
    )) {
      if (s.vehicle || s.off || s.maxY < 4) continue;
      const th = rayBox(o, d, s, 0.5, best);
      if (th !== null && th < best) {
        best = th;
        hit = true;
      }
    }
  }
  return hit ? best : null;
}
const _ro = new V3(),
  _rd = new V3();
// Can a web from the hand reach (x, y, z)? `slack`: how far short of it a hit may be (the wall it sticks to).
function losClear(x, y, z, slack) {
  const hx = pos.x,
    hy = pos.y + HAND,
    hz = pos.z;
  const dx = x - hx,
    dy = y - hy,
    dz = z - hz,
    dist = Math.hypot(dx, dy, dz);
  if (dist < 0.5) return true;
  _ro.set(hx, hy, hz);
  _rd.set(dx / dist, dy / dist, dz / dist);
  const t = rayToSolid(_ro, _rd, dist + 0.5);
  return t === null || t >= dist - slack;
}
// Point on the footprint of a (rotated) box nearest the ideal point (ix, iz), on
// a face the player at (hx, hz) can see, pushed `out` m off the wall; plus its
// outward normal. Results in SP (world). False when the player is over / inside it.
const SP = { x: 0, z: 0, nx: 0, nz: 0 };
function surfacePoint(r, x0, x1, z0, z1, ix, iz, hx, hz, out) {
  let lx = ix,
    lz = iz,
    px = hx,
    pz = hz;
  if (r) {
    let dx = ix - r.cx,
      dz = iz - r.cz;
    lx = dx * r.c - dz * r.s;
    lz = dx * r.s + dz * r.c;
    dx = hx - r.cx;
    dz = hz - r.cz;
    px = dx * r.c - dz * r.s;
    pz = dx * r.s + dz * r.c;
  }
  const ex0 = x0 - px,
    ex1 = px - x1,
    ez0 = z0 - pz,
    ez1 = pz - z1;
  if (ex0 <= 0 && ex1 <= 0 && ez0 <= 0 && ez1 <= 0) return false;
  let cx = clamp(lx, x0, x1),
    cz = clamp(lz, z0, z1),
    nx = lx - cx,
    nz = lz - cz;
  if ((nx === 0 && nz === 0) || (px - cx) * nx + (pz - cz) * nz <= 0) {
    // ideal point inside the footprint (or round the back): use the face toward the player
    if (ex0 >= ex1 && ex0 >= ez0 && ex0 >= ez1) {
      cx = x0;
      cz = clamp(lz, z0, z1);
      nx = -1;
      nz = 0;
    } else if (ex1 >= ez0 && ex1 >= ez1) {
      cx = x1;
      cz = clamp(lz, z0, z1);
      nx = 1;
      nz = 0;
    } else if (ez0 >= ez1) {
      cz = z0;
      cx = clamp(lx, x0, x1);
      nx = 0;
      nz = -1;
    } else {
      cz = z1;
      cx = clamp(lx, x0, x1);
      nx = 0;
      nz = 1;
    }
  } else {
    const nl = Math.hypot(nx, nz);
    nx /= nl;
    nz /= nl;
  }
  cx += nx * out;
  cz += nz * out;
  if (r) {
    SP.x = r.cx + cx * r.c + cz * r.s;
    SP.z = r.cz - cx * r.s + cz * r.c;
    SP.nx = nx * r.c + nz * r.s;
    SP.nz = -nx * r.s + nz * r.c;
  } else {
    SP.x = cx;
    SP.z = cz;
    SP.nx = nx;
    SP.nz = nz;
  }
  return true;
}
// A few best-scoring candidates (reused objects), checked for line of sight best-first.
const POOL = 4,
  pool = [];
for (let i = 0; i < POOL; i++)
  pool.push({ x: 0, y: 0, z: 0, nx: 0, nz: 0, top: 0, score: 0 });
let poolN = 0;
function poolAdd(x, y, z, score, nx = 0, nz = 0, top = 0) {
  if (poolN === POOL && score <= pool[POOL - 1].score) return;
  let i = poolN < POOL ? poolN++ : POOL - 1;
  const slot = pool[i];
  while (i > 0 && pool[i - 1].score < score) {
    pool[i] = pool[i - 1];
    i--;
  }
  pool[i] = slot;
  slot.x = x;
  slot.y = y;
  slot.z = z;
  slot.nx = nx;
  slot.nz = nz;
  slot.top = top;
  slot.score = score;
}
const anchorT = { ok: false, ground: false, aimed: false, x: 0, y: 0, z: 0 };
const zipT = { ok: false, x: 0, y: 0, z: 0, nx: 0, nz: 0, top: 0 };

// Swing anchor: on a building wall above and ahead. Ideal: ~reach m ahead (further
// the faster you go), ~idealRise m up; side walls along the street are preferred
// over a wall straight across the path (you'd swing into it) unless you can clear it.
// Smart aim: the web goes exactly where the crosshair is when it's on a building
// the web can reach (crosshair glows blue), otherwise to the auto pick below.
// Crosshair aim: where the screen centre meets a building, if a web from the hand
// can reach it and it's high enough to hang from.
const _ao = new V3(),
  _ad = new V3();
function aimAnchor(ground) {
  camera.getDirectionToRef(BABYLON.Axis.Z, _ad);
  _ao.copyFrom(camera.position);
  const hx = pos.x,
    hy = pos.y + HAND,
    hz = pos.z;
  const along =
    (hx - _ao.x) * _ad.x + (hy - _ao.y) * _ad.y + (hz - _ao.z) * _ad.z; // the player's depth on the ray
  const t = rayToSolid(_ao, _ad, Math.max(0, along) + WEB_RANGE + 2);
  if (t === null || t < along - 0.5) return false; // sky, or something behind the player
  const b = t - 0.25; // just off the surface
  const x = _ao.x + _ad.x * b,
    y = _ao.y + _ad.y * b,
    z = _ao.z + _ad.z * b;
  const dy = y - hy,
    dist = Math.hypot(x - hx, dy, z - hz);
  if (dist > WEB_RANGE || dist < 4 || dy < (ground ? 6 : 2)) return false;
  if (!losClear(x, y, z, 1.5)) return false;
  anchorT.ok = true;
  anchorT.aimed = true;
  anchorT.x = x;
  anchorT.y = y;
  anchorT.z = z;
  return true;
}
function scanAnchor() {
  anchorT.ok = false;
  anchorT.aimed = false;
  const hx = pos.x,
    hy = pos.y + HAND,
    hz = pos.z;
  const ground =
    onGround || pos.y - supportHeight(pos.x, pos.z, pos.y + 0.01) < 1.2;
  anchorT.ground = ground;
  if (aimAnchor(ground)) return;
  const v = playerVel(),
    hs = Math.hypot(v.x, v.z),
    w = Math.min(1, hs / 16) * 0.8;
  let fx = Math.sin(yaw),
    fz = Math.cos(yaw);
  if (hs > 1) {
    fx += (v.x / hs) * w;
    fz += (v.z / hs) * w;
  }
  const fl = Math.hypot(fx, fz);
  if (fl < 0.1) {
    fx = Math.sin(yaw);
    fz = Math.cos(yaw);
  } else {
    fx /= fl;
    fz /= fl;
  }
  const rx = fz,
    rz = -fx;
  const reach = clamp(15 + hs * 0.4, 15, 32);
  const minRise = ground ? 8 : 4,
    idealRise = ground ? 17 : clamp(11 + hs * 0.15, 11, 17);
  const qx = hx + fx * 26,
    qz = hz + fz * 26,
    R = 46;
  const sw = swing;
  poolN = 0;
  for (const s of query(qx - R, qx + R, qz - R, qz + R)) {
    if (s.vehicle || s.maxY < 8 || s.maxY - 0.3 < hy + minRise) continue;
    if (s.lx1 - s.lx0 < 2.5 || s.lz1 - s.lz0 < 2.5) continue; // lamp posts, trees, signs
    const lo = Math.max(s.minY + 2, hy + minRise),
      hi = s.maxY - 0.3;
    if (lo > hi) continue;
    const ay = clamp(hy + idealRise, lo, hi),
      dy = ay - hy;
    for (let k = -1; k <= 1; k++) {
      const ix = hx + fx * reach + rx * k * 7,
        iz = hz + fz * reach + rz * k * 7;
      if (
        !surfacePoint(s.rot, s.lx0, s.lx1, s.lz0, s.lz1, ix, iz, hx, hz, 0.25)
      )
        break;
      const dx = SP.x - hx,
        dz = SP.z - hz,
        dist = Math.hypot(dx, dy, dz);
      if (dist > WEB_RANGE || dist < 7) continue;
      const fwd = dx * fx + dz * fz,
        lat = dx * rx + dz * rz;
      if (fwd < 2.5 || Math.abs(lat) > fwd * 1.3 + 4) continue;
      if (
        sw &&
        Math.abs(SP.x - sw.ax) + Math.abs(ay - sw.ay) + Math.abs(SP.z - sw.az) <
          5
      )
        continue;
      const headOn = -(SP.nx * fx + SP.nz * fz);
      let score =
        -Math.abs(fwd - reach) * 0.5 -
        Math.max(0, Math.abs(lat) - 6) * 0.35 -
        Math.abs(dy - idealRise) * 0.45;
      if (headOn > 0.6) score -= Math.max(0, s.maxY - hy - 12) * 0.6 * headOn;
      else if (Math.abs(lat) > 3) score += 2.5;
      poolAdd(SP.x, ay, SP.z, score);
    }
  }
  for (let i = 0; i < poolN; i++) {
    const c = pool[i];
    if (losClear(c.x, c.y, c.z, 1.5)) {
      anchorT.ok = true;
      anchorT.x = c.x;
      anchorT.y = c.y;
      anchorT.z = c.z;
      return;
    }
  }
}
// Zip point: just outside the rim of a roof near the crosshair.
const _cd = new V3();
function scanZip() {
  zipT.ok = false;
  camera.getDirectionToRef(BABYLON.Axis.Z, _cd);
  const hx = pos.x,
    hy = pos.y + HAND,
    hz = pos.z;
  const chl = Math.hypot(_cd.x, _cd.z) || 1,
    cfx = _cd.x / chl,
    cfz = _cd.z / chl;
  poolN = 0;
  for (const r of roofs) {
    const ddx = r.xf.cx - hx,
      ddz = r.xf.cz - hz;
    if (Math.abs(ddx) > ZIP_RANGE + 30 || Math.abs(ddz) > ZIP_RANGE + 30)
      continue;
    if (r.top < pos.y + 1 || r.top > hy + 45) continue;
    const dc = Math.hypot(ddx, ddz);
    if (
      !surfacePoint(
        r.xf,
        -r.hw,
        r.hw,
        -r.hd,
        r.hd,
        hx + cfx * dc,
        hz + cfz * dc,
        hx,
        hz,
        0.75,
      )
    )
      continue;
    const ty = r.top + 1.6; // body arrives with its feet just above the rim
    const dx = SP.x - hx,
      dy = ty - hy,
      dz = SP.z - hz,
      dist = Math.hypot(dx, dy, dz);
    if (dist > ZIP_RANGE || dist < 4) continue;
    const cosA = (dx * _cd.x + dy * _cd.y + dz * _cd.z) / dist;
    if (cosA < 0.85) continue;
    poolAdd(SP.x, ty, SP.z, cosA - dist * 0.002, SP.nx, SP.nz, r.top);
  }
  for (let i = 0; i < poolN; i++) {
    const c = pool[i];
    if (losClear(c.x, c.y, c.z, 0.4)) {
      zipT.ok = true;
      zipT.x = c.x;
      zipT.y = c.y;
      zipT.z = c.z;
      zipT.nx = c.nx;
      zipT.nz = c.nz;
      zipT.top = c.top;
      return;
    }
  }
}

// ---- web line, reticles, puffs
const webMat = new BABYLON.StandardMaterial("webM", scene);
webMat.disableLighting = true;
webMat.emissiveColor = new C3(0.9, 0.92, 0.95);
const ropeT = MB.CreateCylinder(
  "webSeg",
  { diameter: 0.045, height: 1, tessellation: 5 },
  scene,
);
ropeT.rotation.x = Math.PI / 2;
ropeT.bakeCurrentTransformIntoVertices(); // length along +z
ropeT.material = webMat;
ropeT.isPickable = false;
ropeT.setEnabled(false);
const ROPE_N = 10,
  ropeSegs = [],
  ropePts = [];
for (let i = 0; i < ROPE_N; i++) {
  const m = ropeT.createInstance("webSeg");
  m.isPickable = false;
  m.setEnabled(false);
  ropeSegs.push(m);
}
for (let i = 0; i <= ROPE_N; i++) ropePts.push(new V3());
let ropeOn = false,
  ropeFx = null; // ropeFx: { kind: "miss" | "release", t, ... }
function hideRope() {
  if (!ropeOn) return;
  ropeOn = false;
  for (const m of ropeSegs) m.setEnabled(false);
}
// The web as a chain of short segments: straight when taut, sagging in the middle
// when slack and rippling sideways (`wave`) just after it's shot.
function drawRope(hx, hy, hz, ex, ey, ez, sag, wave, phase) {
  const lx = ex - hx,
    ly = ey - hy,
    lz = ez - hz;
  const hl = Math.hypot(lx, lz) || 1,
    px = -lz / hl,
    pz = lx / hl;
  for (let i = 0; i <= ROPE_N; i++) {
    const t = i / ROPE_N,
      b = 4 * t * (1 - t),
      rip = wave * Math.sin(t * 9.4 - phase) * b;
    ropePts[i].set(
      hx + lx * t + px * rip,
      hy + ly * t - sag * b + rip * 0.4,
      hz + lz * t + pz * rip,
    );
  }
  for (let i = 0; i < ROPE_N; i++) {
    const a = ropePts[i],
      b = ropePts[i + 1],
      m = ropeSegs[i];
    const dx = b.x - a.x,
      dy = b.y - a.y,
      dz = b.z - a.z;
    m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    m.scaling.z = Math.hypot(dx, dy, dz) + 0.02;
    m.rotation.x = Math.atan2(-dy, Math.hypot(dx, dz));
    m.rotation.y = Math.atan2(dx, dz);
    if (!ropeOn) m.setEnabled(true);
  }
  ropeOn = true;
}
// World position of a hand (forces the arm's matrices so the web starts there this frame).
function handPos(arm) {
  player.computeWorldMatrix(true);
  stuntPivot.computeWorldMatrix(true);
  stuntOff.computeWorldMatrix(true);
  body.computeWorldMatrix(true);
  arm.sh.computeWorldMatrix(true);
  arm.el.computeWorldMatrix(true);
  arm.hand.computeWorldMatrix(true);
  return arm.hand.getAbsolutePosition();
}
const puffT = emissiveTemplate(
  "webPuff",
  MB.CreateSphere("webPuff", { diameter: 1, segments: 6 }, scene),
  new C3(0.85, 0.88, 0.95),
);
function webPuff(x, y, z, n, size) {
  for (let i = 0; i < n; i++) {
    const m = puffT.createInstance("wp");
    const a = Math.random() * Math.PI * 2,
      sp = 1.5 + Math.random() * 2.5,
      up = (Math.random() - 0.3) * 1.6;
    const vx = Math.cos(a) * sp,
      vyy = up * sp * 0.6,
      vz = Math.sin(a) * sp,
      s0 = size * (0.6 + Math.random() * 0.6);
    const life = 0.25 + Math.random() * 0.12;
    m.position.set(x, y, z);
    m.scaling.setAll(s0);
    addEffect(m, life, (k, mesh) => {
      const t = k * life;
      mesh.position.set(x + vx * t, y + vyy * t - 3 * t * t, z + vz * t);
      mesh.scaling.setAll(s0 * (1 - k));
    });
  }
}
function reticleTex(name, col) {
  const t = canvasTex(
    name,
    128,
    (ctx, S) => {
      ctx.clearRect(0, 0, S, S);
      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, S * 0.33, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, S * 0.33, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, S * 0.09, 0, Math.PI * 2);
      ctx.fill();
    },
    false,
  );
  t.hasAlpha = true;
  t.wrapU = t.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
  return t;
}
function reticleMesh(name, col) {
  const tex = reticleTex(name + "T", col);
  const mat = new BABYLON.StandardMaterial(name + "M", scene);
  mat.disableLighting = true;
  mat.diffuseColor = new C3(0, 0, 0);
  mat.emissiveTexture = tex;
  mat.opacityTexture = tex;
  mat.fogEnabled = false;
  mat.backFaceCulling = false;
  mat.disableDepthWrite = true;
  const m = MB.CreatePlane(name, { size: 1 }, scene);
  m.material = mat;
  m.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
  m.renderingGroupId = 1;
  m.isPickable = false;
  m.setEnabled(false);
  return m;
}
const anchorRet = reticleMesh("anchorRet", "#ffffff"),
  zipRet = reticleMesh("zipRet", "#ffc23d");
let scanTimer = 0,
  retPulse = 0;
function placeReticle(m, t, size, dt) {
  if (!t.ok) {
    if (m.isEnabled()) m.setEnabled(false);
    return;
  }
  const p = m.position;
  if (
    !m.isEnabled() ||
    Math.abs(p.x - t.x) + Math.abs(p.y - t.y) + Math.abs(p.z - t.z) > 6
  )
    p.set(t.x, t.y, t.z);
  else {
    const k = Math.min(1, dt * 18);
    p.x += (t.x - p.x) * k;
    p.y += (t.y - p.y) * k;
    p.z += (t.z - p.z) * k;
  }
  const c = camera.position,
    d = Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z);
  m.scaling.setAll(d * size * (1 + 0.08 * Math.sin(retPulse * 7)));
  if (!m.isEnabled()) m.setEnabled(true);
}
// Re-pick the targets ~10 times a second (not every frame) and keep the reticles on them.
function updateWebTargets(dt) {
  const active =
    weapon === "web" && !vehicle && !home && !homeBusy && downTimer <= 0;
  scanTimer -= dt;
  if (active && scanTimer <= 0) {
    scanTimer = 0.1;
    if (indoorsNow()) anchorT.ok = zipT.ok = false;
    else {
      scanAnchor();
      if (!zip) scanZip();
      else zipT.ok = false;
    }
  }
  if (!active) anchorT.ok = zipT.ok = false;
  retPulse += dt;
  placeReticle(anchorRet, anchorT, 0.032, dt);
  placeReticle(zipRet, zipT, 0.026, dt);
}

// Draws the web each frame: attached (swing / zip), missed, or just released.
function updateRope(dt) {
  if (vehicle || home) {
    ropeFx = null;
    hideRope();
    return;
  }
  const w = swing || zip;
  if (w) {
    const hp = handPos(w.arm);
    const e = 1 - (1 - w.shot) * (1 - w.shot); // ease-out as it shoots
    const ex = hp.x + (w.ax - hp.x) * e,
      ey = hp.y + (w.ay - hp.y) * e,
      ez = hp.z + (w.az - hp.z) * e;
    let slack = 0;
    if (swing)
      slack = clamp(
        swing.len - Math.hypot(pos.x - w.ax, pos.y + HAND - w.ay, pos.z - w.az),
        0,
        4,
      );
    const sag = (1 - w.shot) * 0.6 + slack * 0.35;
    const wave = 0.45 * Math.exp(-Math.max(0, w.age - w.shotDur) * 6) * w.shot;
    if (w.shot >= 1 && !w.puffed) {
      w.puffed = true;
      webPuff(w.ax, w.ay, w.az, 6, 0.22);
    }
    drawRope(hp.x, hp.y, hp.z, ex, ey, ez, sag, wave, w.age * 30);
    return;
  }
  const f = ropeFx;
  if (!f) {
    hideRope();
    return;
  }
  f.t += dt;
  if (f.kind === "release") {
    // let go: the web leaves the hand and whips back toward where it was stuck, going slack
    const T = 0.22;
    if (f.t >= T) {
      ropeFx = null;
      hideRope();
      return;
    }
    const k = f.t / T,
      kk = k * k;
    const sx = f.hx + (f.ax - f.hx) * kk,
      sy = f.hy + (f.ay - f.hy) * kk,
      sz = f.hz + (f.az - f.hz) * kk;
    const L = Math.hypot(f.ax - sx, f.ay - sy, f.az - sz);
    drawRope(
      sx,
      sy,
      sz,
      f.ax,
      f.ay,
      f.az,
      L * 0.12 * k + 0.2,
      0.3 * (1 - k),
      f.t * 40,
    );
  } else {
    // nothing to stick to: the web shoots out ~22 m and drops away
    const T = 0.38;
    if (f.t >= T) {
      ropeFx = null;
      hideRope();
      return;
    }
    const hp = handPos(armR);
    const out = Math.min(1, f.t / 0.12) * 22,
      droop = Math.max(0, f.t - 0.12) * 18;
    drawRope(
      hp.x,
      hp.y,
      hp.z,
      hp.x + f.dx * out,
      hp.y + f.dy * out - droop,
      hp.z + f.dz * out,
      0.4 + droop * 0.3,
      0.2,
      f.t * 40,
    );
  }
}
function releaseRope(w) {
  if (w.shot < 1) {
    ropeFx = null;
    return;
  }
  const hp = handPos(w.arm);
  ropeFx = {
    kind: "release",
    t: 0,
    ax: w.ax,
    ay: w.ay,
    az: w.az,
    hx: hp.x,
    hy: hp.y,
    hz: hp.z,
  };
  webPuff(hp.x, hp.y, hp.z, 3, 0.12);
}
function webMissShot() {
  const fx = Math.sin(yaw),
    fz = Math.cos(yaw);
  ropeFx = { kind: "miss", t: 0, dx: fx * 0.78, dy: 0.62, dz: fz * 0.78 };
  sfx.webShot(0.6);
}

// ---- swing
function canWeb() {
  return !vehicle && !home && downTimer <= 0 && !indoorsNow();
}
// Which hand shoots: the one on the anchor's side.
function armToward(x, z) {
  return (x - pos.x) * Math.cos(facing) - (z - pos.z) * Math.sin(facing) >= 0
    ? armR
    : armL;
}
function startSwing() {
  if (!canWeb()) return false;
  scanAnchor(); // fresh pick for the click
  if (!anchorT.ok) {
    webMissShot();
    return false;
  }
  const m = takeMomentum(),
    ground = anchorT.ground;
  const ax = anchorT.x,
    ay = anchorT.y,
    az = anchorT.z;
  const dx = ax - pos.x,
    dy = ay - pos.y - HAND,
    dz = az - pos.z,
    dist = Math.hypot(dx, dy, dz);
  let vx = m.x,
    vy0 = m.y,
    vz = m.z,
    reelTo,
    reelRate;
  if (ground) {
    // From the street: the web yanks you up off your feet toward the anchor,
    // reels you in, then the rope goes taut and you swing on through.
    vx += (dx / dist) * 7;
    vz += (dz / dist) * 7;
    vy0 = Math.max(vy0, 9 + (dy / dist) * 4);
    reelTo = Math.max(8, dist * 0.6);
    reelRate = 16;
    pos.y += 0.05;
  } else {
    reelTo = Math.max(6, dist * 0.88);
    reelRate = 2.5;
  }
  zip = null;
  swing = {
    ax,
    ay,
    az,
    len: dist,
    reelTo,
    reelRate,
    launch: ground,
    vx,
    vy: vy0,
    vz,
    age: 0,
    shot: 0,
    shotDur: clamp(dist / 320, 0.05, 0.18),
    arm: armToward(ax, az),
    puffed: false,
  };
  onGround = false;
  ropeFx = null;
  sfx.webShot(1);
  return true;
}
function endSwing(fling) {
  const s = swing;
  if (!s) return;
  airVel.x = s.vx;
  airVel.z = s.vz;
  vy = s.vy;
  if (fling) {
    // a timed release on the up-swing gives a little lift and carry (none on the down-swing)
    const up = clamp(s.vy / 12, 0, 1);
    vy += 1.5 + 3.5 * up;
    const k = 1 + 0.06 * up;
    airVel.x *= k;
    airVel.z *= k;
  }
  onGround = false;
  swing = null;
  releaseRope(s);
  if (fling) stuntOnRelease();
}
// Walls: slide along them, losing only the speed going into them. Returns that
// speed; the wall's outward normal is left in lastWN.
const lastWN = { x: 0, z: 0 };
function wallSlide(o) {
  const bx = pos.x,
    bz = pos.z;
  collideHoriz(pos);
  const nx = pos.x - bx,
    nz = pos.z - bz,
    nl = Math.hypot(nx, nz);
  if (nl < 1e-4) return 0;
  lastWN.x = nx / nl;
  lastWN.z = nz / nl;
  const vn = (o.vx * nx + o.vz * nz) / nl;
  if (vn < 0) {
    o.vx -= (vn * nx) / nl;
    o.vz -= (vn * nz) / nl;
  }
  return Math.min(0, vn);
}
// Web moves (swing / zip) only slid along walls sideways; swinging up under an
// overhang or into a roof edge at an angle could leave the body inside the
// building. After each step: stop under anything overhead, and if still
// inside a solid, stand on it (came down onto it) or go back to where we were.
function unstick(px, py, pz, o) {
  if (o.vy > 0) {
    const c = ceilingAt(pos.x, pos.z, py);
    if (pos.y + HEIGHT > c) {
      pos.y = Math.max(py, c - HEIGHT);
      o.vy = Math.min(0, o.vy);
    }
  }
  for (const b of query(pos.x - 0.3, pos.x + 0.3, pos.z - 0.3, pos.z + 0.3)) {
    if (b.vehicle || b.maxY <= pos.y + STEP || b.minY >= pos.y + HEIGHT - 0.05) continue;
    if (!pointIn(b, pos.x, pos.y + 0.9, pos.z, 0.05)) continue;
    if (py >= b.maxY - 0.6) pos.y = b.maxY; // dropped onto it: on top
    else {
      // came in from the side / below: back out, losing the speed into it
      const ix = pos.x - px,
        iz = pos.z - pz,
        il = Math.hypot(ix, iz);
      pos.x = px;
      pos.z = pz;
      if (pos.y + HEIGHT > b.minY && py + HEIGHT <= b.minY + 0.05) pos.y = Math.min(pos.y, py);
      if (il > 1e-4) {
        const vn = (o.vx * ix + o.vz * iz) / il;
        if (vn > 0) {
          o.vx -= (vn * ix) / il;
          o.vz -= (vn * iz) / il;
        }
      }
    }
    break;
  }
}
// Touch down from the air: crouch into it; a fast landing rolls on a little.
function touchDown(fallSpeed, hx, hz) {
  if (inWater(pos.x, pos.z)) {
    if (fallSpeed > 3) {
      sfx.splash(fallSpeed);
      lastSplashAt = performance.now();
    }
  } else if (fallSpeed > 7) sfx.land(fallSpeed);
  landT = Math.max(
    landT,
    clamp(fallSpeed / 24 + Math.hypot(hx, hz) / 70, 0, 1),
  );
  if (fallSpeed > 16)
    shake = Math.max(shake, clamp((fallSpeed - 16) / 60, 0, 0.3));
  pushX += hx * 0.4;
  pushZ += hz * 0.4;
}
// Mouse steering: the travel direction turns toward where the camera looks
// (rad/s, speed is kept). Small look offsets → gentle curve; big ones → full rate;
// looking far off to the side / behind (> ~120°) fades it out so you can look around.
const MOUSE_STEER = 1.9;
function mouseSteer(vx, vz, w) {
  const diff = angDiff(yaw, Math.atan2(vx, vz)),
    ad = Math.abs(diff);
  if (ad < 0.02) return 0;
  const fade = ad < 1.6 ? 1 : Math.max(0, 1 - (ad - 1.6) / 0.6);
  return (
    Math.sign(diff) *
    Math.min(1, ad / 0.7) *
    fade *
    MOUSE_STEER *
    (w ? 1.35 : 1)
  );
}
function updateSwing(dt) {
  const s = swing;
  s.age += dt;
  s.shot = Math.min(1, s.shot + dt / s.shotDur);
  const taut = s.shot >= 1; // the rope only acts once the web has stuck
  const fx = Math.sin(yaw),
    fz = Math.cos(yaw);
  const W = keys.KeyW || keys.ArrowUp,
    brake = keys.KeyS || keys.ArrowDown;
  const steer =
    (keys.KeyD || keys.ArrowRight ? 1 : 0) -
    (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  // Rope length: a slow reel-in gives the swing its dip and tug; from the street
  // a hard yank comes first; and it never gets so long that the bottom of the
  // arc would scrape the street / roof below (reeled in smoothly instead).
  if (s.launch && s.len <= s.reelTo + 0.05) {
    s.launch = false;
    s.reelTo = Math.max(6, s.len * 0.88);
    s.reelRate = 2.5;
  }
  let reelTo = s.reelTo,
    rate = s.reelRate;
  // What's below you jumps from the street to a roof the instant you pass
  // over a building; reacting to that raw yanked you up the rope at up to
  // 18 m/s — a jolt high up. The floor is smoothed and the reel eased.
  const floorT = supportHeight(pos.x, pos.z, pos.y);
  if (s.floorS === undefined) s.floorS = floorT;
  s.floorS += (floorT - s.floorS) * Math.min(1, dt * (floorT > s.floorS ? 2.5 : 6));
  const clearLen = s.ay - HAND - s.floorS - 1.0;
  if (clearLen < reelTo) {
    reelTo = Math.max(3, clearLen);
    rate = Math.max(rate, Math.min(9, (s.len - reelTo) * 2.5));
  }
  const sp0 = Math.hypot(s.vx, s.vy, s.vz);
  const n = Math.max(1, Math.ceil((sp0 * dt) / 0.3)); // sub-step so we can't tunnel through walls
  const h = dt / n;
  let hitWall = 0;
  for (let i = 0; i < n && swing; i++) {
    let ox = pos.x - s.ax,
      oy = pos.y + HAND - s.ay,
      oz = pos.z - s.az;
    const d = Math.hypot(ox, oy, oz) || 1;
    ox /= d;
    oy /= d;
    oz /= d; // unit vector anchor → hand
    s.vy -= GRAV * h;
    if (taut) {
      const below = clamp(-oy, 0, 1); // 1 at the bottom of the arc
      const sp = Math.hypot(s.vx, s.vy, s.vz),
        hs = Math.hypot(s.vx, s.vz);
      // pump: push along the arc the way the camera faces (strongest at the bottom)
      let pump = W ? 9 : 0;
      if (sp < 7 && s.age > 0.3) pump += 6; // never stall dangling under the web
      if (pump && below > 0.05) {
        const fd = fx * ox + fz * oz;
        const tx = fx - ox * fd,
          ty = -oy * fd,
          tz = fz - oz * fd,
          tl = Math.hypot(tx, ty, tz);
        if (tl > 0.05) {
          const a = (pump * below * h) / tl;
          s.vx += tx * a;
          s.vy += ty * a;
          s.vz += tz * a;
        }
      }
      // steer: A / D carve, W drifts the swing round toward the camera (speed is kept)
      if (hs > 2) {
        let turn = steer * 1.3 + mouseSteer(s.vx, s.vz, W);
        if (turn) {
          const a = turn * h,
            c = Math.cos(a),
            sn = Math.sin(a);
          const nvx = s.vx * c + s.vz * sn;
          s.vz = -s.vx * sn + s.vz * c;
          s.vx = nvx;
        }
      }
    }
    if (brake) {
      const k = Math.exp(-1.6 * h);
      s.vx *= k;
      s.vz *= k;
    }
    let hx = pos.x + s.vx * h,
      hy = pos.y + HAND + s.vy * h,
      hz = pos.z + s.vz * h;
    if (taut) {
      // rope: can't get further than len from the anchor (projected back onto the sphere)
      const want = s.len > reelTo ? rate : 0;
      if (want) s.len = Math.max(reelTo, s.len - want * h);
      let qx = hx - s.ax,
        qy = hy - s.ay,
        qz = hz - s.az;
      const q = Math.hypot(qx, qy, qz);
      if (q > s.len) {
        qx /= q;
        qy /= q;
        qz /= q;
        hx = s.ax + qx * s.len;
        hy = s.ay + qy * s.len;
        hz = s.az + qz * s.len;
        const vr = s.vx * qx + s.vy * qy + s.vz * qz,
          cap = -want; // reeling pulls you in at the reel speed
        if (vr > cap) {
          s.vx -= qx * (vr - cap);
          s.vy -= qy * (vr - cap);
          s.vz -= qz * (vr - cap);
          // the rope catching a fall turns part of that speed into swing instead of killing it
          const caught = vr - 3;
          if (caught > 0) {
            let tx = s.vx - qx * cap,
              ty = s.vy - qy * cap,
              tz = s.vz - qz * cap,
              tl = Math.hypot(tx, ty, tz);
            if (tl < 0.5) {
              const fd = fx * qx + fz * qz;
              tx = fx - qx * fd;
              ty = -qy * fd;
              tz = fz - qz * fd;
              tl = Math.hypot(tx, ty, tz) || 1;
            }
            const a = (caught * 0.5) / tl;
            s.vx += tx * a;
            s.vy += ty * a;
            s.vz += tz * a;
          }
        }
      }
    }
    // soft speed cap (eases back instead of clamping)
    const sp = Math.hypot(s.vx, s.vy, s.vz);
    if (sp > SWING_MAX) {
      const k = (sp - (sp - SWING_MAX) * Math.min(1, 3 * h)) / sp;
      s.vx *= k;
      s.vy *= k;
      s.vz *= k;
    }
    const px = pos.x,
      py = pos.y,
      pz = pos.z;
    pos.set(hx, hy - HAND, hz);
    hitWall = Math.min(hitWall, wallSlide(s));
    unstick(px, py, pz, s);
    // the street / a roof: skim it during the launch, land on it afterwards
    const gh = supportHeight(pos.x, pos.z, pos.y);
    if (pos.y <= gh) {
      pos.y = gh;
      if (s.launch || s.age < 0.35) {
        if (s.vy < 2) s.vy = 2;
      } else if (s.vy <= 0) {
        touchDown(-s.vy, s.vx, s.vz);
        swing = null;
        releaseRope(s);
        vy = 0;
        onGround = true;
        airVel.x = airVel.z = 0;
      }
    }
  }
  // swung into a wall: plant the feet and push off it (still on the web)
  if (hitWall < -8 && swing) {
    const push = Math.min(9, -hitWall * 0.45) + 1.5;
    s.vx += lastWN.x * push;
    s.vz += lastWN.z * push;
    s.vy += 2;
    braceT = 0.45;
    if (hitWall < -12) {
      shake = Math.max(shake, clamp(-hitWall / 80, 0.1, 0.35));
      sfx.bump(-hitWall * 0.5, "wall");
    }
  }
  if (!swing) return;
  if (!home) {
    pos.x = clamp(pos.x, WORLD.x0 + 2, WORLD.x1 - 2);
    pos.z = clamp(pos.z, WORLD.z0 + 2, WORLD.z1 - 2);
  }
  // swung up level with the anchor, or let go → release with a fling
  if (taut && !s.launch && pos.y + HAND > s.ay - 1.2 && s.vy > 0)
    endSwing(true);
  else if (!webHeld && s.age > 0.12) endSwing(true);
}

// ---- web zip
function startZip() {
  if (!canWeb()) return false;
  scanZip();
  if (!zipT.ok) {
    webMissShot();
    return false;
  }
  const m = takeMomentum();
  const dx = zipT.x - pos.x,
    dy = zipT.y - pos.y - HAND,
    dz = zipT.z - pos.z,
    dist = Math.hypot(dx, dy, dz);
  swing = null;
  zip = {
    ax: zipT.x,
    ay: zipT.y,
    az: zipT.z,
    nx: zipT.nx,
    nz: zipT.nz,
    top: zipT.top,
    vx: m.x,
    vy: m.y,
    vz: m.z,
    t: 0,
    age: 0,
    shot: 0,
    shotDur: clamp(dist / 320, 0.05, 0.16),
    arm: armToward(zipT.x, zipT.z),
    best: Infinity,
    bestT: 0,
    puffed: false,
  };
  if (onGround) {
    zip.vy = Math.max(zip.vy, 3);
    pos.y += 0.05;
  } // hop off the ground
  onGround = false;
  ropeFx = null;
  airVel.x = airVel.z = 0;
  sfx.webShot(1.15);
  return true;
}
function endZip() {
  const z = zip;
  airVel.x = z.vx;
  airVel.z = z.vz;
  vy = z.vy;
  zip = null;
  releaseRope(z);
}
// Arrived under the rim: vault up over it and drift in onto the roof.
function arriveZip() {
  const z = zip;
  zip = null;
  releaseRope(z);
  vy = Math.sqrt(2 * GRAV * Math.max(0.6, z.top + 1.4 - pos.y));
  airVel.x = -z.nx * 5.5 + z.vx * 0.25;
  airVel.z = -z.nz * 5.5 + z.vz * 0.25;
  onGround = false;
  startTrick("vault"); // tucked flip up over the rim
}
function updateZip(dt) {
  const z = zip;
  z.age += dt;
  z.shot = Math.min(1, z.shot + dt / z.shotDur);
  if (z.shot >= 1) z.t += dt;
  const sp0 = Math.max(Math.hypot(z.vx, z.vy, z.vz), ZIP_MAX * 0.5);
  const n = Math.max(1, Math.ceil((sp0 * dt) / 0.3));
  const h = dt / n;
  let d = 0;
  for (let i = 0; i < n; i++) {
    const dx = z.ax - pos.x,
      dy = z.ay - (pos.y + 1.0),
      dz = z.az - pos.z;
    d = Math.hypot(dx, dy, dz);
    if (d < 0.9) {
      arriveZip();
      return;
    }
    if (z.shot >= 1) {
      // pulled along the web: speed ramps up, eases off on the final approach, and
      // the current velocity blends into it (no snap from whatever you were doing)
      const sp = Math.min(ZIP_MAX, 12 + z.t * 80, 6 + d * 5),
        k = 1 - Math.exp(-10 * h);
      z.vx += ((dx / d) * sp - z.vx) * k;
      z.vy += ((dy / d) * sp - z.vy) * k;
      z.vz += ((dz / d) * sp - z.vz) * k;
    } else z.vy -= GRAV * 0.5 * h; // web still flying out: keep drifting
    const px = pos.x,
      py = pos.y,
      pz = pos.z;
    pos.x += z.vx * h;
    pos.y += z.vy * h;
    pos.z += z.vz * h;
    wallSlide(z);
    unstick(px, py, pz, z);
    const gh = supportHeight(pos.x, pos.z, pos.y);
    if (pos.y < gh) {
      pos.y = gh;
      if (z.vy < 0) z.vy = 0;
    }
  }
  if (!home) {
    pos.x = clamp(pos.x, WORLD.x0 + 2, WORLD.x1 - 2);
    pos.z = clamp(pos.z, WORLD.z0 + 2, WORLD.z1 - 2);
  }
  // stuck behind something, or taking too long: let go with what we have
  if (d < z.best - 0.5) {
    z.best = d;
    z.bestT = z.age;
  } else if (z.age - z.bestT > 0.35 || z.age > 2.2) endZip();
}

// Pose while on a web (swing or zip): the shooting arm reaches up the line, the
// free arm balances, the body leans with the arc, knees tuck on the down-swing.
// Everything eases toward its target, so nothing snaps.
function poseWeb(dt, w, zipping) {
  airT = 1;
  const vx = w.vx,
    vyy = w.vy,
    vz = w.vz,
    hs = Math.hypot(vx, vz);
  if (hs > 1)
    facing += angDiff(Math.atan2(vx, vz), facing) * Math.min(1, dt * 7);
  player.position.copyFrom(pos);
  player.rotation.y = facing;
  blob.setEnabled(true);
  const shadowY = supportHeight(pos.x, pos.z, pos.y + 0.01);
  blob.position.set(pos.x, shadowY + 0.1, pos.z);
  blob.rotation.y = facing;
  const bs = Math.max(0.3, 1 - (pos.y - shadowY) * 0.25);
  blob.scaling.set(bs, 1, bs);
  const k = Math.min(1, dt * 7),
    ka = Math.min(1, dt * 14);
  const rising = clamp(vyy / 12, -1, 1);
  const tgtLean = zipping
    ? 0.5
    : 0.2 + (Math.min(hs, 30) / 30) * 0.35 - rising * 0.2;
  body.rotation.x += (tgtLean - body.rotation.x) * k;
  body.position.y += (0 - body.position.y) * k;
  // shooting arm: aim the shoulder at the anchor in body space
  const dx = w.ax - pos.x,
    dy = w.ay - (pos.y + 1.46),
    dz = w.az - pos.z;
  const c = Math.cos(facing),
    sn = Math.sin(facing);
  const fwd = dx * sn + dz * c,
    right = dx * c - dz * sn,
    r = Math.hypot(fwd, right, dy) || 1;
  const roll = Math.asin(clamp(right / r, -0.85, 0.85));
  let p = Math.atan2(-fwd, -dy);
  if (p > 0.5) p -= Math.PI * 2;
  p = clamp(p, -3.7, 0.4) - body.rotation.x;
  const A = w.arm,
    B = A === armR ? armL : armR,
    side = A === armR ? 1 : -1;
  A.sh.rotation.x += (p - A.sh.rotation.x) * ka;
  A.sh.rotation.z += (roll - A.sh.rotation.z) * ka;
  A.el.rotation.x += (-0.05 - A.el.rotation.x) * ka;
  B.sh.rotation.x += (-0.5 - rising * 0.4 - B.sh.rotation.x) * k;
  B.sh.rotation.z +=
    (-side * (0.5 + 0.4 * Math.max(0, -rising)) - B.sh.rotation.z) * k;
  B.el.rotation.x += (-0.9 - B.el.rotation.x) * k;
  const tuck = zipping ? 0.6 : clamp(-rising, 0, 1);
  legL.hip.rotation.x += (-0.4 - tuck * 0.9 - legL.hip.rotation.x) * k;
  legL.knee.rotation.x += (0.4 + tuck * 1.2 - legL.knee.rotation.x) * k;
  legR.hip.rotation.x += (0.15 - tuck * 0.5 - legR.hip.rotation.x) * k;
  legR.knee.rotation.x += (0.25 + tuck * 0.8 - legR.knee.rotation.x) * k;
}

// ---------------------------------------------------------------- stunts
// Body tricks layered over the normal poses, spun round the waist pivot:
//  · let go on a strong up-swing → front / back / side flip, 360 twirl or
//    corkscrew (a double flip when flung really high); a fast flat release →
//    twirl / corkscrew. Only when there's the air time to finish it.
//  · web zip onto a roof → a tucked vault flip over the rim
//  · fly into a wall off the web → kick off it with a backflip; on the web →
//    plant the feet and push off (see updateSwing)
//  · swinging / flying close along a wall → lean off it and run along it
//  · about to hit a wall → tuck and brace
//  · carving a turn → bank into it; a long fall → dive head-first, pulling
//    out in time for the landing
const TAU = Math.PI * 2;
const TRICKS = {
  frontflip: { x: TAU, dur: 0.62, tuck: 1 },
  backflip: { x: -TAU, dur: 0.68, tuck: 1 },
  sideflip: { z: TAU, dur: 0.66, tuck: 0.7, mirror: true },
  twirl: { y: TAU, dur: 0.6, tuck: 0.15, arms: 1, mirror: true },
  corkscrew: { y: TAU, z: TAU, dur: 0.85, tuck: 0.55, arms: 0.4, mirror: true },
  doubleflip: { x: TAU * 2, dur: 1.0, tuck: 1 },
  vault: { x: TAU, dur: 0.5, tuck: 1 },
};
const trick = { kind: null, t: 0, dur: 1, x: 0, y: 0, z: 0, tuck: 0, arms: 0 };
const srot = { x: 0, y: 0, z: 0 };
let lastTrick = "",
  bank = 0,
  dive = 0,
  wallAmt = 0,
  wallSide = 0,
  wallDir = 1,
  wallPhase = 0,
  wallTimer = 0,
  braceT = 0,
  prevHead = 0;
const wrapAng = (a) => a - TAU * Math.round(a / TAU);
function startTrick(kind) {
  const d = TRICKS[kind],
    s = d.mirror && Math.random() < 0.5 ? -1 : 1;
  trick.kind = kind;
  trick.t = 0;
  trick.dur = d.dur;
  trick.x = d.x || 0;
  trick.y = (d.y || 0) * s;
  trick.z = (d.z || 0) * s;
  trick.tuck = d.tuck || 0;
  trick.arms = d.arms || 0;
  lastTrick = kind;
}
// Seconds until we'd hit whatever is below, at the current vertical speed.
function airTime() {
  const h = Math.max(0, pos.y - supportHeight(pos.x, pos.z, pos.y + 0.01));
  return (vy + Math.sqrt(Math.max(0, vy * vy + 2 * GRAV * h))) / GRAV;
}
function pickTrick(list) {
  const l = list.filter((k) => k !== lastTrick);
  return l[Math.floor(Math.random() * l.length)];
}
// Just let go of a web with a fling: maybe throw a trick.
function stuntOnRelease() {
  if (trick.kind) return;
  const hs = Math.hypot(airVel.x, airVel.z),
    t = airTime();
  let kind = null;
  if (vy > 13 && t > 1.25)
    kind = pickTrick(["doubleflip", "corkscrew", "frontflip"]);
  else if (vy > 6)
    kind =
      Math.random() < 0.8
        ? pickTrick(["frontflip", "backflip", "sideflip", "twirl"])
        : null;
  else if (hs > 22)
    kind = Math.random() < 0.6 ? pickTrick(["twirl", "corkscrew"]) : null;
  if (kind && t > TRICKS[kind].dur + 0.2) startTrick(kind);
}
function mixRot(node, axis, v, a) {
  if (a > 0.001)
    node.rotation[axis] += (v - node.rotation[axis]) * Math.min(1, a);
}
function resetStunts() {
  trick.kind = null;
  srot.x = srot.y = srot.z = 0;
  bank = dive = wallAmt = braceT = 0;
  stuntPivot.rotation.set(0, 0, 0);
}
function updateStunts(dt) {
  if (vehicle || home || swimming || downTimer > 0) {
    resetStunts();
    return;
  }
  const w = swing || zip,
    air = !!w || !onGround;
  const v = playerVel(),
    hs = Math.hypot(v.x, v.z);
  const hAbove = pos.y - supportHeight(pos.x, pos.z, pos.y + 0.01);

  // the trick in progress (eased spin); cut short by a new web or the ground,
  // then the body unwinds to upright the short way round
  let tuck = 0,
    arms = 0;
  if (trick.kind) {
    trick.t += dt;
    const p = Math.min(1, trick.t / trick.dur),
      e = 0.5 - 0.5 * Math.cos(Math.PI * p),
      b = Math.sin(Math.PI * p);
    srot.x = trick.x * e;
    srot.y = trick.y * e;
    srot.z = trick.z * e;
    tuck = trick.tuck * Math.min(1, b * 1.6);
    arms = trick.arms * b;
    if (p >= 1 || !air || w) {
      trick.kind = null;
      srot.x = wrapAng(srot.x);
      srot.y = wrapAng(srot.y);
      srot.z = wrapAng(srot.z);
    }
  } else {
    const k = Math.min(1, dt * 10);
    srot.x -= srot.x * k;
    srot.y -= srot.y * k;
    srot.z -= srot.z * k;
  }

  // bank into turns (from how fast the travel direction is turning)
  const head = Math.atan2(v.x, v.z);
  let bankT = 0;
  if (air && hs > 6) {
    bankT = clamp(
      -(angDiff(head, prevHead) / Math.max(dt, 1e-3)) * 0.3,
      -0.6,
      0.6,
    );
    if (swing) bankT -= (swing.arm === armR ? 1 : -1) * 0.12; // hang toward the web arm
  }
  prevHead = head;
  bank += (bankT - bank) * Math.min(1, dt * 5);

  // walls beside / ahead (probed ~12× a second, not every frame)
  wallTimer -= dt;
  if (wallTimer <= 0) {
    wallTimer = 0.08;
    wallSide = 0;
    if (air && hs > 7 && hAbove > 2 && !trick.kind) {
      const rx = Math.cos(facing),
        rz = -Math.sin(facing),
        y = pos.y + 1;
      if (pointBlocked(pos.x + rx * 1.8, y, pos.z + rz * 1.8)) wallSide = 1;
      else if (pointBlocked(pos.x - rx * 1.8, y, pos.z - rz * 1.8))
        wallSide = -1;
      const la = clamp(hs * 0.3, 2, 7);
      if (pointBlocked(pos.x + (v.x / hs) * la, y, pos.z + (v.z / hs) * la))
        braceT = Math.max(braceT, 0.35);
    }
    if (wallSide) wallDir = wallSide;
  }
  wallAmt += ((wallSide ? 1 : 0) - wallAmt) * Math.min(1, dt * 6);
  braceT = Math.max(0, braceT - dt);

  // long fall: dive head-first, pull out in time to land on the feet
  let diveT = 0;
  if (!w && !onGround && !trick.kind && vy < -9 && hAbove > 6 + -vy * 0.45)
    diveT = clamp((-vy - 9) / 12, 0, 1);
  dive += (diveT - dive) * Math.min(1, dt * (diveT > dive ? 2.5 : 6));

  stuntPivot.rotation.set(
    srot.x + dive * 1.15,
    srot.y,
    srot.z + bank + wallDir * 0.55 * wallAmt,
  );

  // limbs on top of the pose (the arm holding a web is left alone)
  const A = w ? w.arm : null,
    gunArm = aiming || aimTimer > 0;
  const tk = Math.max(tuck, Math.min(1, braceT / 0.35) * 0.6);
  if (tk > 0.01) {
    mixRot(legL.hip, "x", -1.6, tk);
    mixRot(legR.hip, "x", -1.5, tk);
    mixRot(legL.knee, "x", 2.1, tk);
    mixRot(legR.knee, "x", 2.0, tk);
    if (A !== armL) {
      mixRot(armL.sh, "x", -0.9, tk);
      mixRot(armL.sh, "z", -0.35, tk);
      mixRot(armL.el, "x", -1.5, tk);
    }
    if (A !== armR && !gunArm) {
      mixRot(armR.sh, "x", -0.9, tk);
      mixRot(armR.sh, "z", 0.35, tk);
      mixRot(armR.el, "x", -1.5, tk);
    }
  }
  const ao = Math.max(arms, dive) * (1 - tk); // arms out: twirls, spread-eagle dive
  if (ao > 0.01) {
    if (A !== armL) {
      mixRot(armL.sh, "z", -1.4, ao);
      mixRot(armL.sh, "x", -0.3, ao);
      mixRot(armL.el, "x", -0.2, ao);
    }
    if (A !== armR && !gunArm) {
      mixRot(armR.sh, "z", 1.4, ao);
      mixRot(armR.sh, "x", -0.3, ao);
      mixRot(armR.el, "x", -0.2, ao);
    }
  }
  const wr = wallAmt * (1 - tk); // running along a wall
  if (wr > 0.01) {
    wallPhase += dt * 13;
    const s1 = Math.sin(wallPhase);
    mixRot(legL.hip, "x", -0.4 - s1 * 0.8, wr);
    mixRot(legR.hip, "x", -0.4 + s1 * 0.8, wr);
    mixRot(legL.knee, "x", 0.6 + Math.max(0, s1) * 1.0, wr);
    mixRot(legR.knee, "x", 0.6 + Math.max(0, -s1) * 1.0, wr);
  }
  if (dive > 0.01) {
    // legs trailing in the dive
    mixRot(legL.hip, "x", 0.25, dive);
    mixRot(legR.hip, "x", 0.1, dive);
    mixRot(legL.knee, "x", 0.5, dive);
    mixRot(legR.knee, "x", 0.3, dive);
  }
}

// Swimming: on foot, at the surface of open water (river away from bridges,
// pond, sea). Slower, the gun goes away, the body sits half under the water
// tilted forward doing a front crawl; Space kicks up onto a bank / wall.
let swimming = false,
  swimMove = 0,
  swimPhase = 0,
  lastSplashAt = 0;
let airT = 0,
  landT = 0; // air-pose blend (0 grounded … 1 airborne), landing crouch (decays)
function easeRot(node, axis, v, k) {
  node.rotation[axis] += (v - node.rotation[axis]) * k;
}
function updatePlayer(dt) {
  if (swing || zip) {
    if (swing) updateSwing(dt);
    else updateZip(dt);
    if (swing || zip) poseWeb(dt, swing || zip, !swing);
    else {
      player.position.copyFrom(pos);
      player.rotation.y = facing;
    }
    swimming = false;
    return;
  }
  const wasSwimming = swimming;
  swimming = !home && onGround && pos.y < 0.3 && inWater(pos.x, pos.z);
  if (swimming) {
    aiming = false;
    firing = false;
    aimTimer = 0;
    if (!wasSwimming && performance.now() - lastSplashAt > 600) {
      sfx.splash(4);
      lastSplashAt = performance.now();
    }
  }
  gun.setEnabled(weapon === "gun" && !swimming);
  const fwdX = Math.sin(yaw),
    fwdZ = Math.cos(yaw),
    rightX = Math.cos(yaw),
    rightZ = -Math.sin(yaw);
  let mx = 0,
    mz = 0;
  const downed = downTimer > 0; // thrown from a crash: lie there for a moment
  if (downed) downTimer -= dt;
  if (!downed) {
    if (keys.KeyW || keys.ArrowUp) {
      mx += fwdX;
      mz += fwdZ;
    }
    if (keys.KeyS || keys.ArrowDown) {
      mx -= fwdX;
      mz -= fwdZ;
    }
    if (keys.KeyD || keys.ArrowRight) {
      mx += rightX;
      mz += rightZ;
    }
    if (keys.KeyA || keys.ArrowLeft) {
      mx -= rightX;
      mz -= rightZ;
    }
  }
  const len = Math.hypot(mx, mz);
  const running = (keys.ShiftLeft || keys.ShiftRight) && !aiming;
  const speed = swimming
    ? running
      ? 3.6
      : 2.3
    : aiming
      ? 2.6
      : running
        ? 9
        : 4.2;
  const gunUp = aiming || aimTimer > 0;

  // momentum left over from a web swing / zip carries us through the air; the
  // keys steer it (and can slow it) but can't push it past a run
  const flying = !onGround && (airVel.x !== 0 || airVel.z !== 0);
  let dx = 0,
    dz = 0;
  if (flying) {
    if (len > 0) {
      const cap = Math.max(Math.hypot(airVel.x, airVel.z), 9);
      airVel.x += (mx / len) * 14 * dt;
      airVel.z += (mz / len) * 14 * dt;
      const hs = Math.hypot(airVel.x, airVel.z);
      if (hs > cap) {
        airVel.x *= cap / hs;
        airVel.z *= cap / hs;
      }
    }
    // mouse steering carries on between swings (same feel as on the web)
    const turn =
      Math.hypot(airVel.x, airVel.z) > 4
        ? mouseSteer(airVel.x, airVel.z, false) * 0.8 * dt
        : 0;
    if (turn) {
      const c = Math.cos(turn),
        sn = Math.sin(turn),
        nvx = airVel.x * c + airVel.z * sn;
      airVel.z = -airVel.x * sn + airVel.z * c;
      airVel.x = nvx;
    }
    const ak = Math.exp(-0.12 * dt);
    airVel.x *= ak;
    airVel.z *= ak;
    dx += airVel.x * dt;
    dz += airVel.z * dt;
  } else if (len > 0) {
    dx += (mx / len) * speed * dt;
    dz += (mz / len) * speed * dt;
  }
  dx += pushX * dt;
  dz += pushZ * dt;
  const pk = Math.exp(-4 * dt);
  pushX *= pk;
  pushZ *= pk;
  const sx = pos.x,
    sz = pos.z,
    wantX = dx,
    wantZ = dz;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.15));
  for (let i = 0; i < n; i++) {
    pos.x += dx / n;
    pos.z += dz / n;
    collideHoriz(pos);
    if (onGround) {
      const g = supportHeight(pos.x, pos.z, pos.y);
      if (g > pos.y) pos.y = g;
    }
  }
  // flew into a wall: keep the speed along it, lose only the part going into it
  if (flying) {
    const gx = wantX - (pos.x - sx),
      gz = wantZ - (pos.z - sz),
      gl = Math.hypot(gx, gz);
    if (gl > 1e-4) {
      const vn = (airVel.x * gx + airVel.z * gz) / gl;
      if (vn > 0) {
        airVel.x -= (gx / gl) * vn;
        airVel.z -= (gz / gl) * vn;
        // hit a wall hard off the web: kick off it with a backflip
        if (vn > 9 && pos.y - supportHeight(pos.x, pos.z, pos.y + 0.01) > 3) {
          const k = vn * 0.45 + 2;
          airVel.x -= (gx / gl) * k;
          airVel.z -= (gz / gl) * k;
          vy = Math.max(vy, 6.5);
          startTrick("backflip");
          shake = Math.max(shake, 0.12);
        }
      }
    }
  }
  // bump into pedestrians
  for (const p of peds) {
    if (
      p.state === "down" ||
      Math.abs(p.x - pos.x) > 1 ||
      Math.abs(p.z - pos.z) > 1 ||
      aboveGround() > 1.5
    )
      continue;
    const ddx = pos.x - p.x,
      ddz = pos.z - p.z,
      d = Math.hypot(ddx, ddz);
    if (d < 0.7 && d > 0.01) {
      pos.x += (ddx / d) * (0.7 - d) * 0.5;
      pos.z += (ddz / d) * (0.7 - d) * 0.5;
    }
  }
  if (gunUp) {
    // face the point under the crosshair (not just the camera yaw — the
    // camera sits over the right shoulder, so they differ up close)
    const { o, d } = aimRay();
    poseToward(o.x + d.x * 30, o.y + d.y * 30, o.z + d.z * 30, dt);
  } else if (flying && Math.hypot(airVel.x, airVel.z) > 2)
    facing +=
      angDiff(Math.atan2(airVel.x, airVel.z), facing) * Math.min(1, dt * 6);
  else if (len > 0)
    facing += angDiff(Math.atan2(mx, mz), facing) * Math.min(1, dt * 12);
  moveAmt +=
    ((len > 0 ? (running ? 1 : 0.6) : 0) - moveAmt) * Math.min(1, dt * 10);

  if (onGround && keys.Space && !downed) {
    vy = swimming ? 6.8 : 7.2;
    onGround = false;
  }
  vy = Math.max(-45, vy - GRAV * dt);
  const gh = supportHeight(pos.x, pos.z, pos.y);
  let ny = pos.y + vy * dt;
  if (vy > 0) {
    const c = ceilingAt(pos.x, pos.z, pos.y);
    if (ny + HEIGHT > c) {
      ny = c - HEIGHT;
      vy = 0;
    }
  }
  if (!onGround && vy <= 0 && ny <= gh) touchDown(-vy, airVel.x, airVel.z);
  if (vy <= 0 && ny <= gh) {
    pos.y = gh;
    vy = 0;
    onGround = true;
    airVel.x = airVel.z = 0;
  } else if (onGround && vy <= 0 && pos.y - gh < 0.45) {
    pos.y = gh;
    vy = 0;
  } else {
    pos.y = ny;
    onGround = false;
  }
  if (!home) {
    pos.x = clamp(pos.x, WORLD.x0 + 2, WORLD.x1 - 2);
    pos.z = clamp(pos.z, WORLD.z0 + 2, WORLD.z1 - 2);
  }

  for (const t of traffic) {
    const ddx = pos.x - t.vx,
      ddz = pos.z - t.vz,
      d = Math.hypot(ddx, ddz);
    if (d < 2.6 && d > 0.01 && aboveGround() < 1.5) {
      pos.x += (ddx / d) * (2.6 - d);
      pos.z += (ddz / d) * (2.6 - d);
    }
  }

  player.position.copyFrom(pos);
  player.rotation.y = facing;
  const shadowY = supportHeight(pos.x, pos.z, pos.y + 0.01);
  blob.position.set(pos.x, shadowY + 0.1, pos.z);
  blob.rotation.y = facing;
  const s = Math.max(0.3, 1 - (pos.y - shadowY) * 0.25);
  blob.scaling.set(s, 1, s);

  if (swimming) {
    airT = 0;
    landT = 0;
    poseSwim(dt, len > 0, running);
    return;
  }
  blob.setEnabled(true);
  const stepBefore = Math.floor(walkPhase / Math.PI);
  walkPhase += dt * (running ? 11 : 7.5) * (len > 0 ? 1 : 0);
  if (
    onGround &&
    len > 0 &&
    !downed &&
    Math.floor(walkPhase / Math.PI) !== stepBefore
  )
    sfx.footstep(running);
  // Pose = walk cycle blended with an air pose (knees tucked rising, legs reaching
  // and arms out falling), plus a landing crouch; every joint eases toward it.
  airT += ((onGround ? 0 : 1) - airT) * Math.min(1, dt * (onGround ? 16 : 8));
  landT = Math.max(0, landT - dt * 3);
  const a = moveAmt * 0.75,
    sw = Math.sin(walkPhase),
    g = 1 - airT,
    au = airT,
    L = landT;
  const up = clamp(vy / 9, -1, 1) * 0.5 + 0.5,
    fall = au * (1 - up);
  const k = Math.min(1, dt * 18);
  easeRot(
    legL.hip,
    "x",
    -sw * a * g + au * (-0.75 * up - 0.15 * (1 - up)) - L * 0.75,
    k,
  );
  easeRot(
    legR.hip,
    "x",
    sw * a * g + au * (-0.15 * up + 0.2 * (1 - up)) - L * 0.55,
    k,
  );
  easeRot(
    legL.knee,
    "x",
    Math.max(0, Math.sin(walkPhase + 1.2)) * a * 1.3 * g +
      au * (1.15 * up + 0.35 * (1 - up)) +
      L * 1.3,
    k,
  );
  easeRot(
    legR.knee,
    "x",
    Math.max(0, -Math.sin(walkPhase + 1.2)) * a * 1.3 * g +
      au * (0.55 * up + 0.25 * (1 - up)) +
      L * 1.1,
    k,
  );
  easeRot(armL.sh, "x", sw * a * 0.9 * g - au * (0.45 + 0.9 * (1 - up)), k);
  easeRot(armL.sh, "z", -0.16 - fall * 0.9, k);
  easeRot(armL.el, "x", (-0.3 - moveAmt * 0.5) * g - au * 0.6, k);
  if (gunUp) {
    armR.sh.rotation.x = -Math.PI / 2 - aimElev;
    armR.sh.rotation.z = 0.05;
    armR.el.rotation.x = 0;
  } else {
    easeRot(armR.sh, "x", -sw * a * 0.9 * g - au * (0.45 + 0.9 * (1 - up)), k);
    easeRot(armR.sh, "z", 0.16 + fall * 0.9, k);
    easeRot(armR.el, "x", (-0.3 - moveAmt * 0.5) * g - au * 0.6, k);
  }
  aimTimer = Math.max(0, aimTimer - dt);
  body.position.y =
    (Math.abs(Math.cos(walkPhase)) * 0.05 * moveAmt +
      Math.sin(performance.now() / 500) * 0.006) *
      g -
    L * 0.24;
  // thrown: tumble flat onto the back, then get up again
  const lean = downed ? -1.5 : L * 0.35 + fall * 0.12;
  body.rotation.x +=
    (lean - body.rotation.x) * Math.min(1, dt * (downed ? 7 : 5));
  if (downed) {
    body.position.y = 0.12;
    legL.hip.rotation.x = -0.3;
    legR.hip.rotation.x = 0.15;
    legL.knee.rotation.x = 0.5;
    legR.knee.rotation.x = 0.2;
    armL.sh.rotation.x = -2.4;
    armR.sh.rotation.x = -2.1;
  }
  if (strikeT > 0) poseStrike(dt);
}

// Front crawl: body sunk to the waist and tilted forward (more upright when
// treading water), arms windmilling in turn, a flutter kick, a gentle bob.
function poseSwim(dt, moving, sprint) {
  const k = Math.min(1, dt * 5);
  swimMove += ((moving ? 1 : 0) - swimMove) * k;
  swimPhase += dt * (moving ? (sprint ? 7 : 5) : 1.6);
  const lean = 0.15 + 0.45 * swimMove; // forward tilt
  const sink = 1.1 - 0.15 * swimMove; // waist under, shoulders / head above
  const bob = Math.sin(performance.now() / 420) * 0.04;
  player.position.set(pos.x, pos.y - sink + bob, pos.z);
  player.rotation.y = facing;
  blob.setEnabled(false);
  body.position.y = 0;
  body.rotation.x += (lean - body.rotation.x) * k;
  if (moving) {
    // each arm goes all the way round, half a turn apart
    armR.sh.rotation.x = -(swimPhase % (Math.PI * 2));
    armR.sh.rotation.z = 0.25;
    armR.el.rotation.x = -0.25;
    armL.sh.rotation.x = -((swimPhase + Math.PI) % (Math.PI * 2));
    armL.sh.rotation.z = -0.25;
    armL.el.rotation.x = -0.25;
  } else {
    // treading water: arms sculling out to the sides
    const s = Math.sin(swimPhase * 2.4) * 0.35;
    armR.sh.rotation.x = -1.2 + s;
    armR.sh.rotation.z = 0.6;
    armR.el.rotation.x = -0.5;
    armL.sh.rotation.x = -1.2 - s;
    armL.sh.rotation.z = -0.6;
    armL.el.rotation.x = -0.5;
  }
  const kick =
    Math.sin(swimPhase * (moving ? 2.2 : 3)) * (moving ? 0.35 : 0.25);
  legL.hip.rotation.x = kick;
  legR.hip.rotation.x = -kick;
  legL.knee.rotation.x = 0.25 + Math.max(0, kick);
  legR.knee.rotation.x = 0.25 + Math.max(0, -kick);
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
  swing = null;
  zip = null;
  ropeFx = null;
  hideRope();
  airVel.x = airVel.z = 0;
  vehicle = v;
  sfx.door();
  sfx.engineStart(specOf(v).name);
  v.solid.off = true;
  v.speed = 0;
  v.mesh.unfreezeWorldMatrix();
  firing = false;
  aiming = false;
  aimTimer = 0;
  resetStunts();
  blob.setEnabled(false);
  gun.setEnabled(false);
  yaw = v.heading;
  lastMouseAt = 0;
  if (v.kind === "car") player.setEnabled(false);
  else {
    player.parent = v.mesh;
    // (rider origin sits ~0.82 m below the seat top, as on the bikes)
    if (v.kind === "boat") player.position.set(0.2, -0.1, -0.3);
    else player.position.set(0, 0.1, -0.22);
    player.rotation.y = 0;
    body.position.y = 0;
    body.rotation.x = 0.28;
    legL.hip.rotation.x = legR.hip.rotation.x = -1.35;
    legL.knee.rotation.x = legR.knee.rotation.x = 1.3;
    armL.sh.rotation.x = armR.sh.rotation.x = -1.05;
    armL.el.rotation.x = armR.el.rotation.x = -0.35;
    armR.sh.rotation.z = 0.16;
  }
}
function exitVehicle() {
  const v = vehicle,
    c = specOf(v);
  v.speed = 0;
  sfx.door();
  const p = v.mesh.position,
    h = v.heading,
    side = c.hw + 0.9;
  const opts = [
    [-Math.cos(h) * side, Math.sin(h) * side],
    [Math.cos(h) * side, -Math.sin(h) * side],
    [-Math.sin(h) * (c.hd + 1), -Math.cos(h) * (c.hd + 1)],
    [Math.sin(h) * (c.hd + 1), Math.cos(h) * (c.hd + 1)],
  ];
  let spot = null;
  if (v.kind === "boat") {
    // look round the boat for somewhere dry to step onto (jetty, beach)
    for (let r = c.hw + 0.8; r <= 6 && !spot; r += 0.8) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2,
          x = p.x + Math.sin(a) * r,
          z = p.z + Math.cos(a) * r,
          y = supportHeight(x, z, 1.5);
        if (!inWater(x, z, y) && playerFits(x, y, z)) {
          spot = [x, y, z];
          break;
        }
      }
    }
    // nowhere to stand: over the side into the water
    if (!spot) spot = [opts[0][0] + p.x, 0, opts[0][1] + p.z];
  } else
    for (const [ox, oz] of opts) {
      const x = p.x + ox,
        z = p.z + oz,
        y = supportHeight(x, z, p.y + 0.3);
      if (playerFits(x, y, z)) {
        spot = [x, y, z];
        break;
      }
    }
  if (!spot) spot = [p.x, p.y + c.ht + 0.1, p.z];
  vehicle = null;
  v.solid = vehicleSolid(v);
  v.mesh.rotation.z = 0;
  v.mesh.rotation.x = v.pitch || 0;   // a car left on a hill stays tilted with it
  if (v.kind === "boat") {
    v.vx = v.vz = 0;
    v.lean = 0;
  }
  v.wobble = 0;
  v.mesh.freezeWorldMatrix();
  beam.setEnabled(false);
  player.parent = null;
  player.setEnabled(true);
  body.rotation.x = 0;
  armR.sh.rotation.z = 0.16;
  blob.setEnabled(true);
  gun.setEnabled(weapon === "gun");
  pos.set(spot[0], spot[1], spot[2]);
  vy = 0;
  onGround = true;
  facing = h;
}
const vehicleIsBoat = () => !!vehicle && vehicle.kind === "boat";
// The player's car / bike has gone into the water: out you come, swimming,
// and the vehicle goes down (and is gone for good).
function drownVehicle(v) {
  const sp = v.speed;
  exitVehicle();
  if (v.solid) removeSolid(v.solid);
  v.solid = null;
  if (v.smokePS) {
    v.smokePS.dispose();
    v.smokePS = null;
  }
  const i = vehicles.indexOf(v);
  if (i >= 0) vehicles.splice(i, 1);
  sinkMesh(v.mesh, Math.sin(v.heading) * sp * 0.4, Math.cos(v.heading) * sp * 0.4);
  // in the water beside it, swimming
  pos.y = 0;
  vy = 0;
  onGround = true;
  sfx.splash(Math.min(12, 4 + Math.abs(sp) * 0.4));
  lastSplashAt = performance.now();
  shake = Math.max(shake, 0.15);
}
function nearestUsable() {
  let best = null,
    bestD = Infinity;
  for (const v of vehicles) {
    if (v.wrecked || v.locked) continue;
    const d =
      v.kind === "boat"
        ? Math.hypot(v.mesh.position.x - pos.x, v.mesh.position.z - pos.z)
        : V3.Distance(v.mesh.position, pos);
    const reach =
      v.kind === "car" ? specOf(v).hd + 1.6 : v.kind === "boat" ? specOf(v).hd + 1.2 : 2.6;
    if (d < reach && d < bestD) {
      best = v;
      bestD = d;
    }
  }
  for (const t of traffic) {
    const d = Math.hypot(t.vx - pos.x, t.vz - pos.z);
    if (d < t.spec.hd + 1.6 && d < bestD && aboveGround() < 2) {
      best = t;
      bestD = d;
    }
  }
  return best;
}
function updateVehicle(dt) {
  const v = vehicle;
  const boat = v.kind === "boat";
  const res = boat
    ? driveBoat(v, dt, keys)
    : driveVehicle(v, dt, keys, enterables, supportHeight);
  if (res.impact > 5) {
    onCrash(v, res);
    if (vehicle !== v) return;
  } // may have thrown us out
  else if (res.impact > 1.5) {
    shake = Math.max(shake, 0.08);
    if (res.impact > 2.5)
      sfx.bump(res.impact, res.traffic || res.vehicle ? "vehicle" : "wall");
  }
  if (res.scrape && Math.random() < 0.6) {
    // grinding along a wall
    const side = Math.random() < 0.5 ? -1 : 1,
      sp = specOf(v);
    crashSparks.emitter = new V3(
      v.mesh.position.x + Math.cos(v.heading) * sp.hw * side,
      0.5,
      v.mesh.position.z - Math.sin(v.heading) * sp.hw * side,
    );
    crashSparks.manualEmitCount = 6;
  }
  // body wobble after an impact (pitch + a little roll, decaying), on top of
  // the slope the vehicle is sitting on (boats rock on their own)
  if (boat) {
    /* driveBoat sets the hull's attitude */
  } else if (v.wobble > 0.002) {
    const t = performance.now() / 1000;
    v.mesh.rotation.x = (v.pitch || 0) + Math.sin(t * 28) * v.wobble;
    if (v.kind === "car") v.mesh.rotation.z = Math.sin(t * 21) * v.wobble * 0.6;
    v.wobble *= Math.exp(-5 * dt);
  } else {
    v.mesh.rotation.x = v.pitch || 0;
    if (v.kind === "car") v.mesh.rotation.z = 0;
  }
  // drove into the sea / river: you're thrown out, the vehicle sinks
  if (!boat && inWater(v.mesh.position.x, v.mesh.position.z, v.mesh.position.y)) {
    drownVehicle(v);
    return;
  }
  if (performance.now() - lastMouseAt > 1200 && Math.abs(v.speed) > 2)
    yaw += angDiff(v.heading, yaw) * Math.min(1, dt * 2.5);
  pos.copyFrom(v.mesh.position);
  if (state.night) {
    beam.setEnabled(true);
    const off = specOf(v).hd + 7.8;
    beam.position.set(
      pos.x + Math.sin(v.heading) * off,
      pos.y + 0.2,
      pos.z + Math.cos(v.heading) * off,
    );
    beam.rotation.y = v.heading;
  } else beam.setEnabled(false);
}

// ---------------------------------------------------------------- shooting
const pedBox = {
  rot: null,
  lx0: 0,
  lx1: 0,
  lz0: 0,
  lz1: 0,
  minY: 0,
  maxY: 1.8,
};
function raycast(o, d, tmin, tmax) {
  let best = tmax,
    hit = null;
  for (let t = tmin; t < best; t += 6) {
    const t2 = Math.min(t + 6, best);
    const ax = o.x + d.x * t,
      az = o.z + d.z * t,
      bx = o.x + d.x * t2,
      bz = o.z + d.z * t2;
    for (const s of query(
      Math.min(ax, bx),
      Math.max(ax, bx),
      Math.min(az, bz),
      Math.max(az, bz),
    )) {
      const th = rayBox(o, d, s, tmin, best);
      if (th !== null && th < best) {
        best = th;
        hit = { solid: s };
      }
    }
  }
  for (const t of traffic) {
    if (Math.abs(t.vx - o.x) > tmax || Math.abs(t.vz - o.z) > tmax) continue;
    const th = rayBox(o, d, t.box, tmin, best);
    if (th !== null && th < best) {
      best = th;
      hit = { traffic: t };
    }
  }
  for (const m of missionShootables()) {
    const th = rayBox(o, d, m.box, tmin, best);
    if (th !== null && th < best) {
      best = th;
      hit = { mission: m };
    }
  }
  for (const p of peds) {
    if (Math.abs(p.x - o.x) > 120 || Math.abs(p.z - o.z) > 120) continue;
    const down = p.state === "down";
    pedBox.lx0 = p.x - (down ? 0.9 : 0.3);
    pedBox.lx1 = p.x + (down ? 0.9 : 0.3);
    pedBox.lz0 = p.z - (down ? 0.9 : 0.3);
    pedBox.lz1 = p.z + (down ? 0.9 : 0.3);
    const py = terrainH(p.x, p.z);
    pedBox.minY = py;
    pedBox.maxY = py + (down ? 0.45 : 1.8);
    const th = rayBox(o, d, pedBox, tmin, best);
    if (th !== null && th < best) {
      best = th;
      hit = { ped: p };
    }
  }
  const tg = groundHit(o, d, tmin, best);
  if (tg !== null) {
    best = tg;
    hit = { ground: true };
  }
  return { t: best, hit };
}
// Where a ray meets the ground (the y = 0 plane, or Kathmandu's hillside).
function groundHit(o, d, tmin, tmax) {
  const T = TERRAIN_BOX;
  const ex = o.x + d.x * tmax,
    ez = o.z + d.z * tmax;
  const overHills =
    Math.max(o.x, ex) > T.x0 &&
    Math.min(o.x, ex) < T.x1 &&
    Math.max(o.z, ez) > T.z0 &&
    Math.min(o.z, ez) < T.z1;
  if (!overHills) {
    if (d.y >= 0) return null;
    const tg = -o.y / d.y;
    return tg > tmin && tg < tmax ? tg : null;
  }
  // march along the ray, then refine the crossing
  const above = (t) =>
    o.y + d.y * t - terrainH(o.x + d.x * t, o.z + d.z * t);
  const end = Math.min(tmax, 600);
  let ta = tmin,
    fa = above(ta);
  if (fa < 0) return null;
  for (let t = tmin + 1.5; ; t += 1.5) {
    const tb = Math.min(t, end),
      fb = above(tb);
    if (fb < 0) {
      let lo = ta,
        hi = tb;
      for (let k = 0; k < 8; k++) {
        const m = (lo + hi) / 2;
        if (above(m) < 0) hi = m;
        else lo = m;
      }
      return hi < tmax ? hi : null;
    }
    if (tb >= end) return null;
    ta = tb;
    fa = fb;
  }
}
function explode(at, scale = 1) {
  sfx.explosion(
    Math.hypot(at.x - pos.x, at.z - pos.z),
    scale,
    panOf(at.x, at.z),
  );
  const f = flashT.createInstance("boom");
  f.position.copyFrom(at);
  addEffect(f, 0.45, (k, m) =>
    m.scaling.setAll((1.5 + k * 7) * scale * (1 - k * 0.4)),
  );
  smoke(at, 12);
  scare(at.x, at.z, 70);
  for (const p of peds) {
    const dx = p.x - at.x,
      dz = p.z - at.z,
      d = Math.hypot(dx, dz);
    if (d < 7) knockDown(p, (dx / (d || 1)) * 9, (dz / (d || 1)) * 9);
  }
  if (!vehicle) {
    const dx = pos.x - at.x,
      dz = pos.z - at.z,
      d = Math.hypot(dx, dz);
    if (d < 7) {
      const k = 1 - d / 7;
      pushX += (dx / (d || 1)) * 14 * k;
      pushZ += (dz / (d || 1)) * 14 * k;
      vy = Math.max(vy, 7 * k);
      onGround = false;
    }
  }
}
function wreck(v) {
  if (v.smokePS) {
    v.smokePS.dispose();
    v.smokePS = null;
  }
  swapToBurnt(v);
  explode(v.mesh.position.add(new V3(0, 0.6, 0)), v.kind === "car" ? 1 : 0.6);
}

// ---------------------------------------------------------------- crashes
// Shared particle systems (emit on demand with manualEmitCount).
const crashSparks = new BABYLON.ParticleSystem("crashSparks", 600, scene);
crashSparks.particleTexture = smokeTex;
crashSparks.emitter = new V3(0, -100, 0);
crashSparks.minEmitBox = new V3(-0.4, -0.2, -0.4);
crashSparks.maxEmitBox = new V3(0.4, 0.3, 0.4);
crashSparks.color1 = new BABYLON.Color4(1, 0.9, 0.45, 1);
crashSparks.color2 = new BABYLON.Color4(1, 0.55, 0.1, 1);
crashSparks.colorDead = new BABYLON.Color4(0.4, 0.1, 0, 0);
crashSparks.minSize = 0.06;
crashSparks.maxSize = 0.2;
crashSparks.minLifeTime = 0.25;
crashSparks.maxLifeTime = 0.75;
crashSparks.direction1 = new V3(-5, 2, -5);
crashSparks.direction2 = new V3(5, 8, 5);
crashSparks.minEmitPower = 1;
crashSparks.maxEmitPower = 2.6;
crashSparks.gravity = new V3(0, -16, 0);
crashSparks.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
crashSparks.emitRate = 0;
crashSparks.start();
const crashDust = new BABYLON.ParticleSystem("crashDust", 300, scene);
crashDust.particleTexture = smokeTex;
crashDust.emitter = new V3(0, -100, 0);
crashDust.minEmitBox = new V3(-0.8, 0, -0.8);
crashDust.maxEmitBox = new V3(0.8, 0.8, 0.8);
crashDust.color1 = new BABYLON.Color4(0.55, 0.52, 0.48, 0.55);
crashDust.color2 = new BABYLON.Color4(0.35, 0.33, 0.3, 0.45);
crashDust.colorDead = new BABYLON.Color4(0.3, 0.3, 0.3, 0);
crashDust.minSize = 0.6;
crashDust.maxSize = 1.8;
crashDust.minLifeTime = 0.7;
crashDust.maxLifeTime = 1.6;
crashDust.direction1 = new V3(-1.5, 0.6, -1.5);
crashDust.direction2 = new V3(1.5, 2.2, 1.5);
crashDust.minEmitPower = 0.6;
crashDust.maxEmitPower = 1.4;
crashDust.gravity = new V3(0, 0.4, 0);
crashDust.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
crashDust.emitRate = 0;
crashDust.start();
// Debris chunks + glass shards fly off and fall.
const debrisT = MB.CreateBox("debris", { size: 1 }, scene);
debrisT.material = litMat("debrisM", hex("#2a2b2e"), 0.3);
debrisT.setEnabled(false);
const shardT = MB.CreateBox("shard", { size: 1 }, scene);
shardT.material = litMat("shardM", hex("#9fc3d6"), 0.8);
shardT.setEnabled(false);
function debris(at, n, power) {
  for (let i = 0; i < n; i++) {
    const glass = Math.random() < 0.45;
    const m = (glass ? shardT : debrisT).createInstance("d");
    const s = glass ? 0.05 + Math.random() * 0.08 : 0.08 + Math.random() * 0.22;
    m.scaling.set(s, s * (glass ? 0.3 : 0.6), s * (glass ? 1 : 1.3));
    const a = Math.random() * Math.PI * 2,
      sp = power * (0.3 + Math.random() * 0.7);
    const vx = Math.cos(a) * sp,
      vz = Math.sin(a) * sp,
      vy0 = 2 + Math.random() * power * 0.5;
    const spin = new V3(
      Math.random() * 12,
      Math.random() * 12,
      Math.random() * 12,
    );
    const life = 1.6 + Math.random() * 1.2;
    m.position.copyFrom(at);
    addEffect(m, life, (k, mesh) => {
      const t = k * life;
      const y = at.y + vy0 * t - 9.8 * t * t;
      const tt =
        y > 0.05 ? t : (vy0 + Math.sqrt(vy0 * vy0 + 19.6 * at.y)) / 19.6; // stop where it lands
      mesh.position.set(at.x + vx * tt, Math.max(0.05, y), at.z + vz * tt);
      if (y > 0.05) mesh.rotation.set(spin.x * t, spin.y * t, spin.z * t);
    });
  }
}

// Sound lives in sound.js; the browser only lets it start after a click / key.
canvas.addEventListener("pointerdown", () => sfx.unlock());
// Is (x, z) open water — the sea (unless you're up on a bridge deck over it)
// or the London river (not on one of its bridges)? y = your height.
function inWater(x, z, y = pos.y) {
  if (home) return false; // (interiors are built far out in what is now open sea)
  if (seaAt(x, z)) return !(onBridge(x, z) && y >= deckAt(x, z) - 1.6);
  return riverDist(x, z) < RW - 0.3 && roadDist(x, z) > 0;
}
// Left/right placement (-1..1) of a world point relative to the camera.
function panOf(x, z) {
  const dx = x - pos.x,
    dz = z - pos.z,
    d = Math.hypot(dx, dz) || 1;
  return (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / d;
}
// People: a cry when someone is knocked down; a casual remark when you walk
// up to someone (at most one every few seconds, so a crowd isn't a chorus).
let nextTalkAt = 0;
pedHooks.onDown = (p, force) => {
  sfx.npcDeath(Math.hypot(p.x - pos.x, p.z - pos.z), panOf(p.x, p.z));
  missionOnPedDown(p, force);
};
pedHooks.onNear = (p, d) => {
  const now = performance.now();
  if (now < nextTalkAt || inConversation()) return;
  nextTalkAt = now + 3500;
  sfx.npcTalk(d, panOf(p.x, p.z));
};

let shake = 0; // camera shake amount (0..1)
// A story character shoves the player away (dx, dz = unit push direction).
function shovePlayer(dx, dz) {
  if (vehicle) return;
  pushX = dx * 8;
  pushZ = dz * 8;
  shake = Math.max(shake, 0.35);
}
let downTimer = 0; // player lying on the ground after being thrown
function crashFX(at, impact, what = "wall") {
  crashSparks.emitter = at.clone();
  crashSparks.manualEmitCount = Math.round(20 + impact * 4);
  crashDust.emitter = at.clone();
  crashDust.manualEmitCount = Math.round(4 + impact * 0.6);
  debris(
    at,
    Math.round(clamp(impact / 2.5, 3, 22)),
    clamp(impact * 0.35, 3, 14),
  );
  shake = Math.max(shake, clamp(impact / 28, 0.15, 1));
  sfx.crash(impact, what);
}
// Engine smoke once a vehicle is badly damaged (grey → black as it gets worse).
function updateDamageSmoke(v) {
  const sp = specOf(v),
    frac = v.health / (sp.hits * 10);
  if (frac > 0.45 || v.wrecked) return;
  if (!v.smokePS) {
    const ps = new BABYLON.ParticleSystem("engineSmoke", 120, scene);
    ps.particleTexture = smokeTex;
    ps.emitter = v.mesh;
    ps.minEmitBox = new V3(-0.3, sp.ht * 0.65, sp.hd * 0.55);
    ps.maxEmitBox = new V3(0.3, sp.ht * 0.75, sp.hd * 0.75);
    ps.minSize = 0.4;
    ps.maxSize = 1.2;
    ps.minLifeTime = 1;
    ps.maxLifeTime = 2.2;
    ps.direction1 = new V3(-0.4, 1.5, -0.4);
    ps.direction2 = new V3(0.4, 2.5, 0.4);
    ps.colorDead = new BABYLON.Color4(0, 0, 0, 0);
    ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    ps.start();
    v.smokePS = ps;
  }
  const dark = frac < 0.2;
  v.smokePS.emitRate = dark ? 40 : 16;
  v.smokePS.color1 = dark
    ? new BABYLON.Color4(0.08, 0.08, 0.08, 0.7)
    : new BABYLON.Color4(0.6, 0.6, 0.6, 0.45);
  v.smokePS.color2 = dark
    ? new BABYLON.Color4(0.15, 0.13, 0.12, 0.6)
    : new BABYLON.Color4(0.45, 0.45, 0.45, 0.35);
}
// Throw the player off a bike / out of a totalled car.
function throwPlayer(v, impact, dirSign) {
  const h = v.heading;
  exitVehicle();
  if (v.kind === "bike" && !v.wrecked) {
    // the bike falls over where it stopped
    v.mesh.unfreezeWorldMatrix();
    v.mesh.rotation.z = 1.35;
    v.mesh.position.y = terrainH(v.mesh.position.x, v.mesh.position.z) + 0.15;
    v.mesh.freezeWorldMatrix();
  }
  const p = v.mesh.position;
  pos.set(p.x, p.y + 1.0, p.z);
  const fling = clamp(impact * 0.45, 4, 18) * dirSign;
  pushX = Math.sin(h) * fling;
  pushZ = Math.cos(h) * fling;
  vy = clamp(3 + impact * 0.14, 4, 9);
  onGround = false;
  downTimer = clamp(1.2 + impact * 0.04, 1.4, 3);
  facing = h + (dirSign < 0 ? Math.PI : 0);
}
// Called when the player's vehicle hits something hard.
function onCrash(v, res) {
  const sp = specOf(v),
    I = res.impact;
  if (v.health === undefined) v.health = sp.hits * 10;
  const at = new V3(
    res.x,
    v.mesh.position.y + Math.min(sp.ht * 0.5, 1.0),
    res.z,
  );
  crashFX(at, I, res.traffic || res.vehicle ? "vehicle" : "wall");
  scare(at.x, at.z, 35);
  v.wobble = Math.min(0.14, I * 0.006);
  v.health -= Math.max(0, I - 4) * (res.traffic ? 0.9 : 1.1);
  if (res.traffic) {
    const t = res.traffic;
    const myMass = sp.hd * sp.hw;
    knockTraffic(
      t,
      t.vx - v.mesh.position.x,
      t.vz - v.mesh.position.z,
      I,
      myMass / 2.1,
    );
    t.hits += I / 7;
    if (t.hits >= t.spec.hits) {
      const w = stealTraffic(t);
      w.solid.off = true;
      wreck(w);
      w.solid = vehicleSolid(w);
    }
  }
  if (v.health <= 0) {
    // totalled: thrown clear, then it blows
    throwPlayer(v, I, res.dir);
    v.solid.off = true;
    wreck(v);
    v.solid = vehicleSolid(v);
    return;
  }
  if (v.kind === "bike" && I > 9) {
    throwPlayer(v, I, res.dir);
    return;
  }
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
  const dx = x - pos.x,
    dz = z - pos.z;
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
  sfx.gunshot();
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
  for (const n of [
    player,
    stuntPivot,
    stuntOff,
    body,
    armR.sh,
    armR.el,
    gun,
    muzzle,
  ])
    n.computeWorldMatrix(true);
  const m = muzzle.getAbsolutePosition().clone();
  // 3) the bullet travels from the muzzle to that point; a wall or car in
  //    between (e.g. shooting round a corner) stops it first
  const toAim = aimPt.subtract(m);
  const dist = toAim.length();
  let end = aimPt,
    hit = aim.hit,
    dir = d;
  if (dist > 0.05) {
    dir = toAim.scale(1 / dist);
    const block = raycast(m, dir, 0.02, dist - 0.25);
    if (block.hit) {
      end = m.add(dir.scale(block.t));
      hit = block.hit;
    }
  }
  tracer(m, end);
  spark(m, 0.18, 0.05);
  scare(pos.x, pos.z, 45);
  if (hit) {
    spark(end.subtract(dir.scale(0.05)));
    if (hit.solid && hit.solid.vehicle) damageVehicle(hit.solid.vehicle);
    else if (hit.traffic) damageTraffic(hit.traffic);
    else if (hit.mission) hit.mission.onHit();
    else if (hit.ped && hit.ped.goon) missionHitGoon(hit.ped, 1, dir.x, dir.z);
    else if (hit.ped) knockDown(hit.ped, dir.x * 3, dir.z * 3);
  }
}

// ---------------------------------------------------------------- camera
const camTarget = new V3();
// bigOnly: only buildings / big walls count (lamp posts, trees, signs, cars and
// low clutter are ignored) — used by the swing camera so props flashing past
// don't yank it into the player
function pointBlocked(x, y, z, m = 0.18, bigOnly = false) {
  for (const b of query(
    x - m - 0.02,
    x + m + 0.02,
    z - m - 0.02,
    z + m + 0.02,
  )) {
    if (
      bigOnly &&
      (b.vehicle ||
        b.maxY - b.minY < 3.5 ||
        (b.lx1 - b.lx0 < 3 && b.lz1 - b.lz0 < 3))
    )
      continue;
    if (pointIn(b, x, y, z, m)) return true;
  }
  return false;
}
// Clear distance from the camera pivot along (dx, dy, dz), up to dist.
function camProbe(dx, dy, dz, dist, m, big, step = 0.25) {
  for (let s = 0.3; s <= dist; s += step) {
    if (
      pointBlocked(
        camTarget.x + dx * s,
        camTarget.y + dy * s,
        camTarget.z + dz * s,
        m,
        big,
      )
    )
      return Math.max(0.35, s - 0.3);
  }
  return dist;
}
let camSide = 0.6,
  camPivotY = pos.y,
  camExtra = 0,
  camOcc = camDist,
  swingCam = 0,
  camRaise = 0,
  camSlope = 0, // smoothed slope of the road ahead (hills / bridge ramps)
  camLift = 0; // smoothed lift to keep the camera off rising ground behind you
const SWING_EXTRA_DIST = 4; // how much further back the camera sits while swinging
const camLook = { x: 0, z: 0 },
  camWant = new V3(),
  lookAt = new V3();
const ORBIT_MIN = -0.45; // lowest the camera orbits (looking up past this tilts the view instead)
const SWING_ORBIT = 0.2; // while web-swinging the camera rides a little above, looking along the street
let lookUp = 0;
function updateCamera(dt) {
  // On foot the camera sits over the right shoulder so the crosshair (screen
  // centre) is never hidden behind the player; aiming pulls it in tighter.
  let dist = camDist,
    h = 1.7,
    side = 1.0;
  if (vehicle) {
    const c = specOf(vehicle);
    dist = Math.max(camDist, c.camDist);
    h = c.camH;
    side = 0;
  } else if (home) {
    dist = Math.min(dist, 3.4);
    side = Math.min(side, 0.6);
  } else if (aiming) {
    dist = 2.8;
    side = 0.85;
    h = 1.72;
  }
  const v = playerVel(),
    hs = Math.hypot(v.x, v.z),
    sp = Math.hypot(hs, v.y);
  const free = !vehicle && !home && !aiming;
  const airborne = !vehicle && !home && (!!swing || !!zip || !onGround);
  // swing camera (blended in / out): centred behind the player, slightly above,
  // rigidly attached (no trailing into walls), slow to zoom back out after a
  // building has passed behind
  // (held for a moment after letting go, so slowing between swings doesn't
  // pump the camera in and out)
  if (swing || zip) lastWebAt = performance.now();
  const webbing =
    airborne &&
    !aiming &&
    (!!swing || !!zip || hs > 8 || performance.now() - lastWebAt < 1200);
  swingCam +=
    ((webbing ? 1 : 0) - swingCam) * Math.min(1, dt * (webbing ? 4 : 2));
  side += (0.3 - side) * swingCam;
  // in the air with the mouse left alone, ease the view round behind the direction of travel
  if (free && airborne && hs > 10 && performance.now() - lastMouseAt > 1500)
    yaw += angDiff(Math.atan2(v.x, v.z), yaw) * Math.min(1, dt * 0.9);
  // faster → pull back a little, and look a little ahead of where we're heading
  camExtra +=
    ((free ? clamp((sp - 8) / 30, 0, 1) * 2 : 0) - camExtra) *
    Math.min(1, dt * 2.5);
  dist += camExtra + SWING_EXTRA_DIST * swingCam; // swinging: sit further back to see more of the city
  const la = free && airborne && hs > 0.5 ? Math.min(hs * 0.08, 2.4) / hs : 0;
  const kl = Math.min(1, dt * 3);
  camLook.x += (v.x * la - camLook.x) * kl;
  camLook.z += (v.z * la - camLook.z) * kl;
  // the pivot trails the body's height a little in the air, so the arc of a
  // swing doesn't jerk the view up and down
  // (it catches up faster the further it falls behind, instead of hitting a
  // hard limit — that limit was a jerk at the top and bottom of big arcs)
  if (airborne) {
    const lag = pos.y - camPivotY;
    camPivotY += lag * Math.min(1, dt * (7 + Math.max(0, Math.abs(lag) - 0.8) * 9));
    camPivotY = clamp(camPivotY, pos.y - 3, pos.y + 3);
  } else camPivotY += (pos.y - camPivotY) * Math.min(1, dt * 20);
  if (Math.abs(camPivotY - pos.y) > 6) camPivotY = pos.y; // teleported
  const py = camPivotY;
  // don't push the pivot into a wall the player is hugging on the right
  const rx = Math.cos(yaw),
    rz = -Math.sin(yaw);
  for (let s = 0.15; s <= side; s += 0.15) {
    if (pointBlocked(pos.x + rx * (s + 0.2), py + h, pos.z + rz * (s + 0.2))) {
      side = Math.max(0, s - 0.15);
      break;
    }
  }
  camSide += (side - camSide) * Math.min(1, dt * 10);
  camTarget.set(
    pos.x + rx * camSide + camLook.x,
    py + h,
    pos.z + rz * camSide + camLook.z,
  );
  if (
    (camLook.x || camLook.z) &&
    pointBlocked(camTarget.x, camTarget.y, camTarget.z)
  ) {
    camTarget.x -= camLook.x;
    camTarget.z -= camLook.z;
    camLook.x = camLook.z = 0;
  }
  // The camera only orbits a little below the shoulder (any lower and it hits the
  // street); looking up further than that tilts the view up from where it sits.
  const p0 = Math.max(
    pitch,
    vehicle ? 0.05 : ORBIT_MIN + (SWING_ORBIT - ORBIT_MIN) * swingCam,
  );
  // occlusion: walk out from the pivot; a fatter probe while swinging keeps the
  // near plane from clipping into walls the camera brushes past
  const m = 0.18 + 0.22 * swingCam,
    big = swingCam > 0.5;
  // swinging low between buildings: if the view behind is blocked, lift the
  // camera up over the obstacle (smoothly) rather than zooming into the body
  let raiseT = 0;
  if (big) {
    const sy0 = Math.sin(yaw),
      cy0 = Math.cos(yaw);
    let bestD = camProbe(
      -sy0 * Math.cos(p0),
      Math.sin(p0),
      -cy0 * Math.cos(p0),
      dist,
      m,
      true,
      0.35,
    );
    if (bestD < dist * 0.75) {
      for (const r of [0.35, 0.7, 1.0]) {
        const pr = Math.min(1.25, p0 + r),
          dr = camProbe(
            -sy0 * Math.cos(pr),
            Math.sin(pr),
            -cy0 * Math.cos(pr),
            dist,
            m,
            true,
            0.35,
          );
        if (dr > bestD + 0.5) {
          bestD = dr;
          raiseT = r;
        }
        if (bestD >= dist * 0.9) break;
      }
    }
  }
  camRaise +=
    (raiseT - camRaise) * Math.min(1, dt * (raiseT > camRaise ? 5 : 1.5));
  // On hills and bridge ramps the view tips with the road, like a driving
  // game: downhill the camera rises behind you and looks down the slope,
  // uphill it settles lower. The slope is smoothed so bumps don't jolt it.
  let slopeT = 0;
  if (!home && !airborne) {
    const hd = vehicle ? vehicle.heading : yaw;
    slopeT = terrainSlope(pos.x, pos.z, Math.sin(hd) * 3, Math.cos(hd) * 3) / 3;
  }
  camSlope += (slopeT - camSlope) * Math.min(1, dt * 2.5);
  const p = clamp(
    p0 + camRaise * swingCam - Math.atan(camSlope) * (vehicle ? 0.85 : 0.6),
    -0.35,
    1.25,
  );
  const cp = Math.cos(p);
  const dx = -Math.sin(yaw) * cp,
    dy = Math.sin(p),
    dz = -Math.cos(yaw) * cp;
  let d = camProbe(dx, dy, dz, dist, m, big);
  // (the swing camera used to be held at least 3 m back even when a wall was
  // closer than that — which parked it inside the building)
  // zoom in quickly when something gets in the way (instantly if the camera would
  // be inside it), back out slowly — no pumping in and out down a street
  if (camOcc > dist) camOcc = dist;
  if (d < camOcc) {
    camOcc += (d - camOcc) * Math.min(1, dt * 20);
    if (
      pointBlocked(
        camTarget.x + dx * camOcc,
        camTarget.y + dy * camOcc,
        camTarget.z + dz * camOcc,
        m,
      )
    )
      camOcc = d;
  } else
    camOcc += (d - camOcc) * Math.min(1, dt * (2.5 + 9.5 * (1 - swingCam)));
  const dd = vehicle || home ? d : camOcc;
  const cwx = camTarget.x + dx * dd,
    cwz = camTarget.z + dz * dd;
  // keep clear of the ground under (and around) the camera, but ease the
  // lift in and out — following every bump of a hillside made the view judder
  const want = camTarget.y + dy * dd;
  const gnd = Math.max(
    landH(cwx, cwz),
    landH(cwx + 1.5, cwz),
    landH(cwx - 1.5, cwz),
    landH(cwx, cwz + 1.5),
    landH(cwx, cwz - 1.5),
  );
  const liftT = Math.max(0, gnd + 0.9 - want);
  camLift += (liftT - camLift) * Math.min(1, dt * (liftT > camLift ? 9 : 3));
  camWant.set(cwx, want + camLift, cwz);
  const cur = V3.Distance(camera.position, camTarget);
  // snap in front of a wall; otherwise follow smoothly. In the air the camera is
  // rigid (its smoothing comes from the pivot / zoom above), so it can't lag into a wall
  const snap = d < cur - 0.05 || (airborne && swingCam > 0.5);
  const k = snap ? 1 : Math.min(1, dt * (vehicle ? 8 : 12));
  V3.LerpToRef(camera.position, camWant, k, camera.position);
  // last line of defence: never leave the camera inside a building — pull it
  // in along the view line to the probed free distance
  if (!home && pointBlocked(camera.position.x, camera.position.y, camera.position.z, 0.12, big)) {
    camera.position.set(camTarget.x + dx * d, camTarget.y + dy * d + camLift, camTarget.z + dz * d);
    if (pointBlocked(camera.position.x, camera.position.y, camera.position.z, 0.12, big))
      camera.position.set(camTarget.x + dx * d, camTarget.y + dy * d, camTarget.z + dz * d);
    camOcc = Math.min(camOcc, d);
  }
  {
    const gy = landH(camera.position.x, camera.position.z) + 0.15; // last-resort only
    if (camera.position.y < gy) camera.position.y = gy;
  }
  if (shake > 0.001) {
    // crash shake
    const s = shake * shake * 0.45;
    camera.position.addInPlaceFromFloats(
      (Math.random() - 0.5) * s,
      (Math.random() - 0.5) * s,
      (Math.random() - 0.5) * s,
    );
    shake = Math.max(0, shake - dt * 1.6);
  }
  // extra look-up beyond the orbit: rotate the view direction up (smoothly, so
  // there's no seam where the orbit stops and the tilt starts)
  lookUp += (Math.max(0, p0 - pitch) - lookUp) * Math.min(1, dt * 20);
  if (lookUp > 0.001) {
    const vx = camTarget.x - camera.position.x,
      vy2 = camTarget.y - camera.position.y,
      vz = camTarget.z - camera.position.z;
    const hl = Math.hypot(vx, vz) || 1e-3,
      len = Math.hypot(hl, vy2);
    const a = Math.min(1.5, Math.atan2(vy2, hl) + lookUp),
      ch = (Math.cos(a) * len) / hl;
    lookAt.set(
      camera.position.x + vx * ch,
      camera.position.y + Math.sin(a) * len,
      camera.position.z + vz * ch,
    );
    camera.setTarget(lookAt);
  } else camera.setTarget(camTarget);
  const airSpeed = airborne ? sp : 0;
  const fovT =
    aiming && !vehicle
      ? 0.62
      : vehicle
        ? 1.05 + clamp(Math.abs(vehicle.speed) / 40, 0, 1) * 0.15
        : 1.0 + clamp(airSpeed / SWING_MAX, 0, 1) * 0.25; // widen while web-swinging
  camera.fov += (fovT - camera.fov) * Math.min(1, dt * 10);
}

// ---------------------------------------------------------------- HUD
const el = (id) => document.getElementById(id);
const weaponEl = el("weapon");
const locEl = el("location"),
  promptEl = el("prompt"),
  speedEl = el("speed"),
  crossEl = el("crosshair"),
  distEl = el("district");
const hud = {};
function setHud(key, node, html) {
  if (hud[key] === html) return;
  hud[key] = html;
  node.innerHTML = html;
  node.style.display = html ? "block" : "none";
}
const DISTRICTS = {
  city: ["MIDTOWN", "Babylon City"],
  paris: ["SAINT-CLAIR", "Residential quarter"],
  park: ["THE BAY", "Between the islands"],
  beach: ["THE COAST", "Saint-Clair beach"],
  sea: ["THE BAY", "Open water between the islands"],
  bridge: ["THE BRIDGE", "Over the bay"],
  london: ["LONDON", "Mind the maze of streets"],
  kathmandu: ["KATHMANDU", "Alleys, temples and Basantapur Durbar Square"],
  river: ["THE THAMES", "Crossing the river"],
};
let curDistrict = null,
  districtTimer = null,
  hudTimer = 0;
// Brief message in the district banner (e.g. "SOUND OFF").
function toast(html) {
  distEl.innerHTML = html;
  distEl.classList.add("show");
  clearTimeout(districtTimer);
  districtTimer = setTimeout(() => distEl.classList.remove("show"), 1600);
}

// ---------------------------------------------------------------- sound state
// Everything sound.js needs to know this frame: the engine (speed, throttle,
// boost), how fast the air is rushing past, the horn, the nearest traffic car
// (for its pass-by engine), day/night and whether we're indoors.
function updateSound(dt) {
  const boost = !!(keys.ShiftLeft || keys.ShiftRight);
  let veh = null,
    windSpeed = 0;
  if (vehicle) {
    const vs = specOf(vehicle);
    const fwd = keys.KeyW || keys.ArrowUp,
      back = keys.KeyS || keys.ArrowDown;
    veh = {
      name: vs.name,
      speed: vehicle.speed,
      max: vs.max * (boost ? vs.boost : 1),
      throttle: fwd ? 1 : back ? 0.6 : 0,
      boost: boost && fwd,
    };
    windSpeed = Math.abs(vehicle.speed);
  } else if (swing || zip || !onGround) {
    const v = playerVel();
    windSpeed = Math.hypot(v.x, v.y, v.z);
  }
  let traf = null;
  if (!home) {
    let bd = 45;
    for (const t of traffic) {
      if (Math.abs(t.vx - pos.x) > bd || Math.abs(t.vz - pos.z) > bd) continue;
      const d = Math.hypot(t.vx - pos.x, t.vz - pos.z);
      if (d < bd) {
        bd = d;
        traf = { dist: d, speed: Math.abs(t.speed), pan: panOf(t.vx, t.vz) };
      }
    }
  }
  const swim = swimming && !vehicle && !swing && !zip ? swimMove : -1; // -1 = not in the water
  sfx.update(dt, {
    vehicle: veh,
    windSpeed,
    horn: !!(vehicle && keys.KeyH),
    night: state.night,
    inside: !!home,
    traffic: traf,
    swim,
  });
}
function webPrompt(what) {
  const parts = [];
  if (anchorT.ok) parts.push(`<kbd>Left click</kbd> ${what}`);
  if (zipT.ok) parts.push("<kbd>Right click</kbd> Web zip");
  return parts.join(" · ");
}
function updateHud(dt) {
  let loc = home ? `${home.typeLabel || home.label} · No. ${home.no}` : "";
  for (const e of enterables) {
    if (inEnterable(e, pos.x, pos.z)) {
      const fl = Math.floor((pos.y + 0.4) / e.fh);
      loc = `${e.name} · ${fl === 0 ? "Lobby" : fl >= e.F ? "Roof" : "Floor " + fl}`;
      break;
    }
  }
  if (!loc && !vehicle && aboveGround() > 8 && onGround) loc = "Rooftop";
  if (!loc && !vehicle && swimming)
    loc = "Swimming · <kbd>Space</kbd> climb out";
  setHud("loc", locEl, loc);
  setHud(
    "speed",
    speedEl,
    vehicle
      ? `${Math.round(Math.abs(vehicle.speed) * 3.6)} <small>km/h</small>`
      : "",
  );
  setHud("weapon", weaponEl, vehicle ? "" : weaponLabel());
  const cls = aiming
    ? "hud aim"
    : weapon === "web"
      ? anchorT.ok && anchorT.aimed
        ? "hud web lock"
        : "hud web"
      : "hud";
  if (crossEl.className !== cls) crossEl.className = cls;
  crossEl.style.display = locked() && !vehicle ? "block" : "none";

  hudTimer -= dt;
  if (hudTimer > 0) return;
  hudTimer = 0.12;
  // out on the water (or on a bridge over it) the islands' names don't apply
  const dname = home
    ? curDistrict
    : seaAt(pos.x, pos.z)
      ? onBridge(pos.x, pos.z) && !vehicleIsBoat()
        ? "bridge"
        : "sea"
      : districtAt(pos.x, pos.z);
  if (dname !== curDistrict) {
    curDistrict = dname;
    const [t, s] = DISTRICTS[dname];
    distEl.innerHTML = `${t}<small>${s}</small>`;
    distEl.classList.add("show");
    clearTimeout(districtTimer);
    districtTimer = setTimeout(() => distEl.classList.remove("show"), 2800);
  }
  let pr = "";
  if (homeBusy) pr = "";
  else if (home) pr = atExit(pos.x, pos.z) ? "<kbd>E</kbd> Leave" : "";
  else if (vehicle) pr = "<kbd>E</kbd> Get out";
  else if (swing)
    pr =
      "Release <kbd>Left click</kbd> to let go · <kbd>W</kbd> pump · <kbd>A</kbd><kbd>D</kbd> steer";
  else if (zip) pr = "";
  else if (weapon === "web" && !home && !onGround) pr = webPrompt("Web swing");
  else {
    const u = nearestUsable(),
      hm = onGround ? nearestHome(pos.x, pos.z, pos.y) : null;
    if (u)
      pr = `<kbd>E</kbd> ${u.e ? "Take the " + u.spec.name : u.spec.label}`;
    else if (talkPrompt()) pr = talkPrompt();
    else if (hm) pr = `<kbd>E</kbd> Enter ${hm.label.toLowerCase()}`;
    else if (weapon === "web" && !home) pr = webPrompt("Web launch");
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
  c.fillStyle = "#1c2a1f";
  c.fillRect(0, 0, baked.width, baked.height);
  c.fillStyle = "#17181e";
  const [cx0, cz0] = toMap(CITY.x0, CITY.z1);
  c.fillRect(cx0, cz0, CITY.x1 - CITY.x0 + 30, CITY.z1 - CITY.z0);
  const [px, pz] = toMap(PARIS.x, PARIS.z);
  c.fillStyle = "#211f1c";
  c.beginPath();
  c.arc(px, pz, 216, 0, Math.PI * 2);
  c.fill();
  const [lx0, lz0] = toMap(752, 620);
  c.fillStyle = "#1d1b1e";
  c.fillRect(lx0, lz0, WORLD.x1 - 752, 1240);
  const [kx0, kz0] = toMap(KTM.x0, KTM.z1);
  c.fillStyle = "#2a231e";
  c.fillRect(kx0, kz0, KTM.x1 - KTM.x0, KTM.z1 - KTM.z0);
  c.fillStyle = "#4a463f";
  for (const q of [
    ...(landmarks.ktmSquares || []),
    ...(landmarks.ktmDurbar ? [landmarks.ktmDurbar] : []),
  ]) {
    const [qx, qz] = toMap(q.x, q.z);
    c.beginPath();
    c.arc(qx, qz, q.r + 2, 0, Math.PI * 2);
    c.fill();
  }
  // the sea round the islands (from the same coastline as the 3D world), with
  // a light edge of beach; painted per 2 m pixel block
  {
    const img = c.getImageData(0, 0, baked.width, baked.height),
      d = img.data,
      W = baked.width,
      H = baked.height;
    for (let my = 0; my < H; my += 2)
      for (let mx = 0; mx < W; mx += 2) {
        const v = landSdf(mx + WORLD.x0, WORLD.z1 - my);
        if (v < -6) continue;
        const [r, g, b] = v > 0 ? [31, 95, 128] : [138, 124, 92];
        for (let yy = my; yy < Math.min(H, my + 2); yy++)
          for (let xx = mx; xx < Math.min(W, mx + 2); xx++) {
            const k = (yy * W + xx) * 4;
            d[k] = r;
            d[k + 1] = g;
            d[k + 2] = b;
          }
      }
    c.putImageData(img, 0, 0);
  }
  c.strokeStyle = "#2a6d8f";
  c.lineWidth = RW * 2;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.beginPath();
  river.forEach(([x, z], i) => {
    const [mx, mz] = toMap(x, z);
    i ? c.lineTo(mx, mz) : c.moveTo(mx, mz);
  });
  c.stroke();
  c.fillStyle = "#2f5a2a";
  for (const s of landmarks.londonSquares || []) {
    const [sx, sz] = toMap(s.x, s.z);
    c.beginPath();
    c.arc(sx, sz, s.r - 1, 0, Math.PI * 2);
    c.fill();
  }
  c.lineCap = "round";
  c.lineJoin = "round";
  for (const pass of [0, 1]) {
    for (const e of edges) {
      c.strokeStyle = pass ? "#6d7178" : "#3a3d44";
      c.lineWidth = pass ? e.w : e.w + e.sw * 2;
      c.beginPath();
      for (let i = 0; i < e.xs.length; i++) {
        const [x, z] = toMap(e.xs[i], e.zs[i]);
        i ? c.lineTo(x, z) : c.moveTo(x, z);
      }
      c.stroke();
    }
  }
  for (const b of mapBuildings) {
    c.fillStyle = b.color;
    c.beginPath();
    b.pts.forEach(([x, z], i) => {
      const [mx, mz] = toMap(x, z);
      i ? c.lineTo(mx, mz) : c.moveTo(mx, mz);
    });
    c.closePath();
    c.fill();
    if (b.door) {
      const [dx, dz] = toMap(b.door[0], b.door[1]);
      c.fillStyle = "#ffe08a";
      c.beginPath();
      c.arc(dx, dz, 3, 0, Math.PI * 2);
      c.fill();
    }
    if (b.homeDoor) {
      const [dx, dz] = toMap(b.homeDoor[0], b.homeDoor[1]);
      c.fillStyle = "#8fd3ff";
      c.beginPath();
      c.arc(dx, dz, 1.8, 0, Math.PI * 2);
      c.fill();
    }
  }
}
function drawMinimap() {
  mm.style.display = home ? "none" : "";
  if (home) return;
  const W = mm.width,
    R = W / 2;
  mctx.save();
  mctx.clearRect(0, 0, W, W);
  mctx.beginPath();
  mctx.arc(R, R, R, 0, Math.PI * 2);
  mctx.clip();
  mctx.fillStyle = "#16171d";
  mctx.fillRect(0, 0, W, W);
  mctx.translate(R, R);
  mctx.rotate(-yaw);
  mctx.scale(0.9, 0.9);
  const [px, pz] = toMap(pos.x, pos.z);
  // only the patch of the baked map around the player (not the whole image every frame)
  {
    const r = Math.ceil((R / 0.9) * 1.42) + 2;
    const sx0 = Math.max(0, Math.floor(px - r)), sz0 = Math.max(0, Math.floor(pz - r));
    const sx1 = Math.min(baked.width, Math.ceil(px + r)), sz1 = Math.min(baked.height, Math.ceil(pz + r));
    if (sx1 > sx0 && sz1 > sz0) mctx.drawImage(baked, sx0, sz0, sx1 - sx0, sz1 - sz0, sx0 - px, sz0 - pz, sx1 - sx0, sz1 - sz0);
  }
  const dot = (x, z, r, col) => {
    const [tx, tz] = toMap(x, z);
    const dx = tx - px,
      dz = tz - pz;
    if (Math.abs(dx) > 160 || Math.abs(dz) > 160) return;
    mctx.fillStyle = col;
    mctx.beginPath();
    mctx.arc(dx, dz, r, 0, Math.PI * 2);
    mctx.fill();
  };
  // story characters: pink dots with a white ring
  for (const m of characterMarkers()) {
    dot(m.x, m.z, 5.2, "#ffffff");
    dot(m.x, m.z, 3.8, "#ff4fb8");
  }
  // mission objective: a navigation arrow on the line from you to it, pointing the
  // way to go (its tip on the objective, or pinned to the rim when it's off the map),
  // with a dashed guide line from you; a pulsing ring once you're right there
  const obj = missionObjective();
  if (obj) {
    const [ox, oz] = toMap(obj.x, obj.z);
    const dx = ox - px,
      dz = oz - pz,
      d = Math.hypot(dx, dz),
      rim = R / 0.9 - 16;
    const pulse = 1 + 0.1 * Math.sin(performance.now() / 170);
    if (d < 16) {
      mctx.lineWidth = 3;
      mctx.strokeStyle = "#1a1a1a";
      mctx.beginPath();
      mctx.arc(dx, dz, 9 * pulse + 1, 0, Math.PI * 2);
      mctx.stroke();
      mctx.strokeStyle = "#ffcf4a";
      mctx.beginPath();
      mctx.arc(dx, dz, 9 * pulse, 0, Math.PI * 2);
      mctx.stroke();
    } else {
      const a = Math.atan2(dz, dx),
        r = Math.min(d, rim) - 11;
      mctx.save();
      mctx.setLineDash([5, 6]);
      mctx.lineWidth = 2.5;
      mctx.strokeStyle = "rgba(255,207,74,0.55)";
      mctx.beginPath();
      mctx.moveTo(Math.cos(a) * 14, Math.sin(a) * 14);
      mctx.lineTo(Math.cos(a) * (r - 8), Math.sin(a) * (r - 8));
      mctx.stroke();
      mctx.setLineDash([]);
      mctx.translate(Math.cos(a) * r, Math.sin(a) * r);
      mctx.rotate(a);
      mctx.scale(pulse, pulse);
      mctx.beginPath();
      mctx.moveTo(13, 0);
      mctx.lineTo(-9, 10);
      mctx.lineTo(-4, 0);
      mctx.lineTo(-9, -10);
      mctx.closePath();
      mctx.lineJoin = "round";
      mctx.lineWidth = 4;
      mctx.strokeStyle = "#1a1a1a";
      mctx.stroke();
      mctx.fillStyle = "#ffcf4a";
      mctx.fill();
      mctx.restore();
    }
  }
  mctx.restore();
  mctx.save();
  mctx.translate(R, R);
  mctx.rotate((vehicle ? vehicle.heading : facing) - yaw);
  mctx.fillStyle = "#fff";
  mctx.strokeStyle = "#222";
  mctx.lineWidth = 1.5;
  mctx.beginPath();
  mctx.moveTo(0, -10);
  mctx.lineTo(7, 8);
  mctx.lineTo(0, 4);
  mctx.lineTo(-7, 8);
  mctx.closePath();
  mctx.fill();
  mctx.stroke();
  mctx.restore();
  const nr = R - 16;
  mctx.fillStyle = "#fff";
  mctx.font = "bold 15px Segoe UI, sans-serif";
  mctx.textAlign = "center";
  mctx.textBaseline = "middle";
  mctx.fillText("N", R - nr * Math.sin(yaw), R - nr * Math.cos(yaw));
}

// ---------------------------------------------------------------- full map (M)
// Reuses the baked minimap image (1 px = 1 m, north up). Scroll to zoom,
// drag to pan, C to centre on the player, M / Esc to close.
const bigEl = el("bigmap"),
  big = el("bigmapCanvas"),
  bctx = big.getContext("2d");
let bigMapOpen = false,
  bigZoom = 1,
  bigFit = 1,
  bigCx = 0,
  bigCz = 0,
  bigDrag = null,
  bigTimer = 0;
const MAP_LABELS = [
  { x: 330, z: 0, t: "MIDTOWN", s: "Babylon City" },
  { x: PARIS.x, z: PARIS.z + 120, t: "SAINT-CLAIR", s: "Residential quarter" },
  { x: -330, z: 470, t: "THE BAY", s: "Boats at the jetties" },
  { x: SHORE_X + 10, z: -420, t: "OPEN SEA", s: "" },
  { x: 1000, z: 120, t: "LONDON", s: "Old town" },
  { x: 1470, z: -260, t: "THE THAMES", s: "" },
  { x: KTM_CORE.x, z: KTM.z1 - 40, t: "KATHMANDU", s: "Old Newar town" },
];
function bigToScreen(x, z) {
  const [mx, mz] = toMap(x, z);
  return [
    big.width / 2 + (mx - bigCx) * bigZoom,
    big.height / 2 + (mz - bigCz) * bigZoom,
  ];
}
function centerBigMap() {
  [bigCx, bigCz] = toMap(pos.x, pos.z);
  drawBigMap();
}
function toggleBigMap(force) {
  bigMapOpen = force ?? !bigMapOpen;
  bigEl.classList.toggle("show", bigMapOpen);
  setMissionUIHidden(bigMapOpen); // the mission card / waypoint shouldn't sit over the map
  if (!bigMapOpen) return;
  for (const k in keys) keys[k] = false;
  firing = false;
  aiming = false;
  webHeld = false;
  zipHeld = false;
  if (locked()) document.exitPointerLock();
  big.width = window.innerWidth;
  big.height = window.innerHeight;
  bigFit = Math.min(big.width / baked.width, big.height / baked.height) * 0.94;
  bigZoom = bigFit;
  bigCx = baked.width / 2;
  bigCz = baked.height / 2;
  drawBigMap();
}
function drawBigMap() {
  const W = big.width,
    H = big.height,
    z = bigZoom;
  bctx.fillStyle = "#0e0f13";
  bctx.fillRect(0, 0, W, H);
  bctx.save();
  bctx.translate(W / 2, H / 2);
  bctx.scale(z, z);
  bctx.translate(-bigCx, -bigCz);
  bctx.imageSmoothingEnabled = z < 2;
  bctx.drawImage(baked, 0, 0);
  bctx.restore();

  const dot = (x, zz, r, col) => {
    const [sx, sy] = bigToScreen(x, zz);
    if (sx < -10 || sy < -10 || sx > W + 10 || sy > H + 10) return;
    bctx.fillStyle = col;
    bctx.beginPath();
    bctx.arc(sx, sy, r, 0, Math.PI * 2);
    bctx.fill();
  };
  const r = clamp(z * 1.6, 1.5, 5);
  // story characters: pink dots, named once zoomed in a little
  for (const m of characterMarkers()) {
    dot(m.x, m.z, r * 1.5 + 1.5, "#ffffff");
    dot(m.x, m.z, r * 1.5, "#ff4fb8");
    if (z > bigFit * 1.4) {
      const [sx, sy] = bigToScreen(m.x, m.z);
      bctx.font = "700 12px Segoe UI, sans-serif";
      bctx.textAlign = "center";
      bctx.fillStyle = "rgba(0,0,0,.65)";
      bctx.fillText(m.label, sx + 1, sy - 11);
      bctx.fillStyle = "#ff8fd0";
      bctx.fillText(m.label, sx, sy - 12);
    }
  }
  // mission objective
  const obj = missionObjective();
  if (obj) {
    dot(obj.x, obj.z, r * 2.4 + 3, "#1a1a1a");
    dot(obj.x, obj.z, r * 2.4, "#ffcf4a");
    const [sx, sy] = bigToScreen(obj.x, obj.z);
    bctx.font = "800 14px Segoe UI, sans-serif";
    bctx.textAlign = "center";
    bctx.fillStyle = "rgba(0,0,0,.7)";
    bctx.fillText("★ " + obj.label, sx + 1, sy - 15);
    bctx.fillStyle = "#ffcf4a";
    bctx.fillText("★ " + obj.label, sx, sy - 16);
  }

  bctx.textAlign = "center";
  bctx.textBaseline = "middle";
  // enterable buildings — names once zoomed in a little
  for (const e of enterables) {
    const [x, zz] = xfp(e.xf, 0, e.minZ);
    const [sx, sy] = bigToScreen(x, zz);
    bctx.fillStyle = "#ffe08a";
    bctx.beginPath();
    bctx.arc(sx, sy, Math.max(3, r), 0, Math.PI * 2);
    bctx.fill();
    if (z > bigFit * 1.6) {
      bctx.font = "600 12px Segoe UI, sans-serif";
      bctx.fillStyle = "rgba(0,0,0,.6)";
      bctx.fillText(e.name, sx + 1, sy - 13);
      bctx.fillStyle = "#ffe08a";
      bctx.fillText(e.name, sx, sy - 14);
    }
  }
  // district labels
  for (const l of MAP_LABELS) {
    const [sx, sy] = bigToScreen(l.x, l.z);
    bctx.font = `800 ${Math.round(clamp(z * 30, 16, 34))}px Segoe UI, sans-serif`;
    bctx.fillStyle = "rgba(0,0,0,.55)";
    bctx.fillText(l.t, sx + 2, sy + 2);
    bctx.fillStyle = "#f4f1ea";
    bctx.fillText(l.t, sx, sy);
    if (l.s) {
      bctx.font = "500 14px Segoe UI, sans-serif";
      bctx.fillStyle = "rgba(244,241,234,.8)";
      bctx.fillText(l.s, sx, sy + Math.round(clamp(z * 30, 16, 34)) * 0.8);
    }
  }
  // the player (north-up: heading 0 points up the screen)
  const [px, py] = bigToScreen(pos.x, pos.z);
  bctx.save();
  bctx.translate(px, py);
  bctx.rotate(vehicle ? vehicle.heading : facing);
  bctx.fillStyle = "#fff";
  bctx.strokeStyle = "#e0322b";
  bctx.lineWidth = 2.5;
  bctx.beginPath();
  bctx.moveTo(0, -13);
  bctx.lineTo(9, 10);
  bctx.lineTo(0, 5);
  bctx.lineTo(-9, 10);
  bctx.closePath();
  bctx.fill();
  bctx.stroke();
  bctx.restore();
  // compass
  bctx.font = "800 20px Segoe UI, sans-serif";
  bctx.fillStyle = "#fff";
  bctx.fillText("N ↑", W - 50, 40);
}
big.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    // zoom around the cursor: the map point under it stays put
    const mx = bigCx + (e.offsetX - big.width / 2) / bigZoom,
      mz = bigCz + (e.offsetY - big.height / 2) / bigZoom;
    bigZoom = clamp(bigZoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), bigFit * 0.8, 8);
    bigCx = mx - (e.offsetX - big.width / 2) / bigZoom;
    bigCz = mz - (e.offsetY - big.height / 2) / bigZoom;
    drawBigMap();
  },
  { passive: false },
);
big.addEventListener("pointerdown", (e) => {
  bigDrag = { x: e.clientX, y: e.clientY };
  big.setPointerCapture(e.pointerId);
});
big.addEventListener("pointermove", (e) => {
  if (!bigDrag) return;
  bigCx -= (e.clientX - bigDrag.x) / bigZoom;
  bigCz -= (e.clientY - bigDrag.y) / bigZoom;
  bigDrag = { x: e.clientX, y: e.clientY };
  drawBigMap();
});
big.addEventListener("pointerup", () => {
  bigDrag = null;
});
el("bigmapClose").addEventListener("click", () => toggleBigMap(false));
window.addEventListener("resize", () => {
  if (bigMapOpen) {
    big.width = window.innerWidth;
    big.height = window.innerHeight;
    drawBigMap();
  }
});

// ---------------------------------------------------------------- start + debug params
// ?night=1  ?time=<hours>  ?ride=car|bike  ?b=<enterable>&f=<floor>  ?jump=1  ?at=x,z,yaw  ?pitch= ?dist=
window.__city = {
  pos,
  enterables,
  roofs,
  vehicles,
  traffic,
  peds,
  setTime,
  fire,
  edges,
};
yaw = START.yaw; // look into the junction
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
    const r = roofs
      .filter((rf) => !rf.landing && rf.top > 20)
      .sort(
        (a, b) =>
          Math.hypot(a.xf.cx - START.x, a.xf.cz - START.z) -
          Math.hypot(b.xf.cx - START.x, b.xf.cz - START.z),
      )[0];
    const [x, z] = xfp(r.xf, 0, -r.hd - 1.5);
    pos.set(x, terrainH(x, z), z);
    yaw = r.xf.yaw;
  }
  if (q.get("at")) {
    const [x, z, y2] = q.get("at").split(",").map(Number);
    pos.set(x, terrainH(x, z), z);
    if (!isNaN(y2)) yaw = y2;
  }
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
camera.position.set(
  pos.x - Math.sin(yaw) * 6,
  pos.y + 2.5,
  pos.z - Math.cos(yaw) * 6,
);

// ---------------------------------------------------------------- homes
// Fade to black, build (or tear down) the interior, swap which layer the
// camera draws, move the player, fade back in.
const fadeEl = document.getElementById("fade");
for (const m of player.getChildMeshes(false)) m.layerMask = BOTH_MASK;
blob.layerMask = BOTH_MASK;
function homeTransition(entering, h) {
  homeBusy = true;
  sfx.door();
  for (const k in keys) keys[k] = false;
  firing = false;
  aiming = false;
  fadeEl.classList.add("on");
  setTimeout(() => {
    const at = entering ? enterHome(h) : leaveHome();
    home = entering ? h : null;
    camera.layerMask = entering ? INSIDE_MASK : WORLD_MASK;
    pos.set(at.x, at.y, at.z);
    vy = 0;
    onGround = true;
    airVel.x = airVel.z = 0;
    yaw = facing = at.yaw;
    camera.position.set(pos.x, pos.y + 1.8, pos.z);
    updateCamera(1); // snap the camera behind the player, inside the walls
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        fadeEl.classList.remove("on");
        homeBusy = false;
      }),
    );
  }, 380);
}

// ---------------------------------------------------------------- health, getting hurt, going down
// 100 health; it comes back after a few seconds out of the fire. A vehicle
// takes half the sting out of bullets. At zero: down, a fade, and back on
// your feet at the mission's last checkpoint (or where you were).
let playerHP = 100,
  hurtAt = -1e9,
  hurtFlash = 0,
  playerDead = false;
const hpWrap = document.createElement("div");
hpWrap.style.cssText =
  "position:fixed;left:34px;bottom:330px;width:230px;height:9px;background:rgba(0,0,0,.55);border-radius:5px;overflow:hidden;z-index:15;pointer-events:none;box-shadow:0 1px 6px rgba(0,0,0,.4)";
const hpBar = document.createElement("div");
hpBar.style.cssText = "height:100%;width:100%;background:#58c25a;transition:width .15s";
hpWrap.appendChild(hpBar);
document.body.appendChild(hpWrap);
const hurtEl = document.createElement("div");
hurtEl.style.cssText =
  "position:fixed;inset:0;pointer-events:none;z-index:14;opacity:0;background:radial-gradient(ellipse at center,rgba(150,0,0,0) 45%,rgba(170,0,0,.85) 100%)";
document.body.appendChild(hurtEl);
let hpShown = -1,
  hurtShown = -1;
function hurtPlayer(n, fx = 0, fz = 0) {
  if (playerDead || home || homeBusy) return;
  if (vehicle) n *= 0.5;
  playerHP -= n;
  hurtAt = performance.now();
  hurtFlash = Math.min(1, hurtFlash + 0.25 + n / 30);
  shake = Math.max(shake, 0.05 + n * 0.006);
  sfx.hurt();
  if (!vehicle && n > 14 && onGround) {
    pushX += fx * 1.5;
    pushZ += fz * 1.5;
  }
  if (playerHP <= 0) die();
}
function updateHealth(dt) {
  if (!playerDead && performance.now() - hurtAt > 5000 && playerHP < 100)
    playerHP = Math.min(100, playerHP + 14 * dt);
  hurtFlash = Math.max(0, hurtFlash - dt * 1.2);
  // health bar: hidden at full health out of a fight
  const v = Math.round(Math.max(0, playerHP));
  if (v !== hpShown) {
    hpShown = v;
    hpBar.style.width = v + "%";
    hpBar.style.background = v > 50 ? "#58c25a" : v > 25 ? "#e0b13a" : "#d8423a";
  }
  hpWrap.style.opacity = playerHP >= 99.5 && performance.now() - hurtAt > 8000 ? "0" : "1";
  const f = Math.round((hurtFlash * 0.8 + (playerHP < 30 ? 0.25 + 0.1 * Math.sin(performance.now() / 180) : 0)) * 100) / 100;
  if (f !== hurtShown) {
    hurtShown = f;
    hurtEl.style.opacity = String(Math.max(0, f));
  }
}
function die() {
  if (playerDead) return;
  playerDead = true;
  if (vehicle) exitVehicle();
  swing = null;
  zip = null;
  hideRope();
  downTimer = 2.5;
  homeBusy = true; // freeze input while the screen goes dark
  const span = fadeEl.querySelector("span");
  const old = span ? span.textContent : "";
  if (span) span.textContent = "YOU WERE TAKEN DOWN";
  fadeEl.classList.add("on");
  setTimeout(() => {
    const r = missionRespawn() || { x: pos.x, z: pos.z, yaw };
    pos.set(r.x, terrainH(r.x, r.z) + 0.05, r.z);
    if (r.yaw !== undefined) yaw = facing = r.yaw;
    vy = 0;
    onGround = true;
    airVel.x = airVel.z = 0;
    pushX = pushZ = 0;
    downTimer = 0;
    playerHP = 100;
    hurtFlash = 0;
    playerDead = false;
    camera.position.set(pos.x, pos.y + 2, pos.z);
    updateCamera(1);
    missionOnRespawn();
    setTimeout(() => {
      fadeEl.classList.remove("on");
      homeBusy = false;
      if (span) span.textContent = old;
    }, 300);
  }, 2400);
}
// Is the straight line a → b clear of buildings / walls / crates (for enemy fire)?
function shotClear(a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    dz = b.z - a.z,
    dist = Math.hypot(dx, dy, dz);
  if (dist < 0.5) return true;
  _ro.set(a.x, a.y, a.z);
  _rd.set(dx / dist, dy / dist, dz / dist);
  for (let t = 0; t < dist; t += 6) {
    const t2 = Math.min(t + 6, dist);
    for (const s of query(
      Math.min(a.x + _rd.x * t, a.x + _rd.x * t2) - 0.5,
      Math.max(a.x + _rd.x * t, a.x + _rd.x * t2) + 0.5,
      Math.min(a.z + _rd.z * t, a.z + _rd.z * t2) - 0.5,
      Math.max(a.z + _rd.z * t, a.z + _rd.z * t2) + 0.5,
    )) {
      if (s.off || s.maxY - s.minY < 0.6) continue;
      const th = rayBox(_ro, _rd, s, 0.3, dist - 0.4);
      if (th !== null) return false;
    }
  }
  return true;
}

// ---- melee: Q — jab, cross, then a knock-down kick
let strikeT = 0,
  strikeN = 0,
  strikeKind = 0,
  lastStrikeAt = 0;
const STRIKE_LEN = 0.28;
function melee() {
  const now = performance.now();
  if (strikeT > STRIKE_LEN * 0.45) return; // still mid-swing
  strikeN = now - lastStrikeAt < 750 ? (strikeN + 1) % 3 : 0;
  lastStrikeAt = now;
  strikeKind = strikeN; // 0 jab (left), 1 cross (right), 2 kick
  strikeT = STRIKE_LEN * (strikeKind === 2 ? 1.35 : 1);
  // face where you're looking and hit whoever's in front
  facing = yaw;
  const fx = Math.sin(yaw),
    fz = Math.cos(yaw);
  let best = null,
    bd = strikeKind === 2 ? 2.6 : 2.3;
  for (const p of peds) {
    if (p.state === "down" || p.state === "away" || p.dormant) continue;
    const dx = p.x - pos.x,
      dz = p.z - pos.z,
      d = Math.hypot(dx, dz);
    if (d > bd || (dx * fx + dz * fz) / (d || 1) < 0.3) continue;
    bd = d;
    best = p;
  }
  sfx.punch(!!best);
  if (!best) return;
  const kick = strikeKind === 2;
  if (best.goon) missionHitGoon(best, kick ? 2 : 1, fx, fz, kick ? "kick" : "punch");
  else if (kick) knockDown(best, fx * 6, fz * 6);
  else {
    best.state = "annoyed";
    best.timer = 1.2;
  }
  shake = Math.max(shake, kick ? 0.12 : 0.06);
  pushX += fx * 0.6;
  pushZ += fz * 0.6;
}
function poseStrike(dt) {
  const len = STRIKE_LEN * (strikeKind === 2 ? 1.35 : 1);
  const k = 1 - strikeT / len; // 0 → 1 through the strike
  const out = Math.sin(Math.min(1, k * 1.6) * Math.PI); // snap out, pull back
  if (strikeKind === 2) {
    legR.hip.rotation.x = -1.55 * out;
    legR.knee.rotation.x = 0.9 * (1 - out);
    body.rotation.x = -0.25 * out;
    armL.sh.rotation.x = -0.9;
    armR.sh.rotation.x = -0.9;
  } else {
    const arm = strikeKind === 0 ? armL : armR,
      other = strikeKind === 0 ? armR : armL;
    arm.sh.rotation.x = -1.2 - 0.45 * out;
    arm.el.rotation.x = -1.4 * (1 - out);
    other.sh.rotation.x = -1.0;
    other.el.rotation.x = -1.6;
  }
  strikeT = Math.max(0, strikeT - dt);
}

// ---------------------------------------------------------------- loop
let mapTimer = 0;
engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05) * missionTimeScale();
  const now = performance.now();
  if (interactQueued) {
    interactQueued = false;
    if (homeBusy) {
      /* mid-fade */
    } else if (home) {
      if (atExit(pos.x, pos.z)) homeTransition(false);
    } else if (vehicle) exitVehicle();
    else if (downTimer <= 0) {
      const u = nearestUsable();
      if (u) enterVehicle(u.e ? stealTraffic(u) : u);
      else if (onGround && !swing) {
        const h = nearestHome(pos.x, pos.z, pos.y);
        if (h) homeTransition(true, h);
      }
    }
  }
  if (meleeQueued) {
    meleeQueued = false;
    if (!vehicle && !home && !homeBusy && !swing && !zip && !swimming && downTimer <= 0) melee();
  }
  updateHealth(dt);
  if (swingQueued) {
    swingQueued = false;
    if (!vehicle && !homeBusy) startSwing();
  }
  if (zipQueued) {
    zipQueued = false;
    if (!vehicle && !homeBusy) startZip();
  }

  // in a conversation: stand still and listen (number keys pick replies)
  if (inConversation()) {
    for (const k in keys) keys[k] = false;
    firing = false;
    aiming = false;
  }
  if (!home) updateTraffic(dt, now, { pos, vehicle, peds });
  if (homeBusy) {
    /* frozen while the screen is black */
  } else if (vehicle) updateVehicle(dt);
  else {
    updatePlayer(dt);
    updateStunts(dt);
    updateRope(dt);
    shotCooldown -= dt;
    if (firing && locked() && shotCooldown <= 0 && downTimer <= 0) fire();
  }
  if (!home)
    updatePeds(dt, {
      pos,
      vehicle,
      vehicleSpeed: vehicle ? vehicle.speed : 0,
      traffic,
      armed: !vehicle && weapon === "gun" && (aiming || firing),
      aimYaw: yaw,
    });
  if (!home)
    updateCharacters(dt, tod, {
      pos,
      vehicle,
      armed: !vehicle && weapon === "gun" && (aiming || firing),
      shove: shovePlayer,
    });
  else hideCharacterUI();
  updateMission(dt, { pos, vehicle, inside: !!home });
  if (!homeBusy) trackVelocity(dt);
  updateCamera(dt);
  updateWebTargets(dt);
  updateTimeOfDay(dt);
  updateEffects(dt);
  updateHud(dt);
  if (!home) {
    animateBillboards(dt);
    updateLondon(dt, tod);
    updateKathmandu(dt, camera);
    pulseHomeMarkers(now / 1000);
  }
  updateSound(dt);
  updateAmbient(dt, camera.position.x, camera.position.z);
  animateSea(dt);
  updateSinking(dt);
  mapTimer += dt;
  if (mapTimer > 1 / 30) {
    mapTimer = 0;
    drawMinimap();
  }
  if (bigMapOpen && (bigTimer += dt) > 0.2) {
    bigTimer = 0;
    drawBigMap();
  } // live player position
  if (home) renderIndoors();
  else scene.render();
});

// Interiors are drawn near (0, 0) (see RENDER_SHIFT in interiors.js) to keep
// GPU float precision: shift everything visible indoors into that frame for
// the draw, then put it back so gameplay never sees the offset.
function renderIndoors() {
  const dx = RENDER_SHIFT.x,
    dz = RENDER_SHIFT.z;
  const movers = [camera, blob];
  if (!player.parent) movers.push(player);
  for (const n of movers) {
    n.position.x -= dx;
    n.position.z -= dz;
  }
  scene.render();
  for (const n of movers) {
    n.position.x += dx;
    n.position.z += dz;
  }
}
window.addEventListener("resize", () => engine.resize());
// Keep "Building the city…" up until every shader is compiled and a few real
// frames have been drawn: otherwise the first second shows the world popping
// in piece by piece (bare ground tiles first), and the compile hitches land
// in gameplay instead of here.
{
  const el = document.getElementById("loading");
  let revealed = false;
  const reveal = () => {
    if (revealed || !el) return;
    revealed = true;
    let n = 0;
    const tick = () => {
      if (++n < 4) return requestAnimationFrame(tick);
      el.classList.add("done");
      setTimeout(() => el.remove(), 500);
    };
    requestAnimationFrame(tick);
  };
  // poll readiness ourselves (a bounded number of times: Babylon's own
  // whenReady keeps polling forever if anything never becomes ready)
  const t0 = performance.now();
  const check = () => {
    if (revealed) return;
    if (scene.isReady() || performance.now() - t0 > 10000) reveal();
    else setTimeout(check, 250);
  };
  setTimeout(check, 100);
}
