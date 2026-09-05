// npc.js
// Ambient city population: pedestrians on the sidewalks, drivers circulating
// the road grid, and residents standing inside their homes. They're not just
// scenery: shoot near one and nearby civilians turn hostile and come after
// you on foot (fists only, they give up if you outrun them); any NPC-driven
// car can be carjacked exactly like the player's own cars; a moving NPC car
// hurts you if it runs you over; and drivers keep a lane and try to escape
// a jam instead of gridlocking forever.

import * as THREE from "three";
import { state, updateLifeHud, playerKnockback } from "./state.js";
import {
  createHumanFigure,
  updateWalkCycle,
  startPunch,
  updatePunch,
  makeBox,
} from "./character.js";
import { getGroundHeight, findClearSpawnPosition } from "./world.js";
import {
  createCarByStyle,
  CAR_STYLES,
  findCarOverlap,
  resolveCarVsCarOverlap,
  carHitsBox,
} from "./player.js";
import { triggerGameOver } from "./ui.js";

const PED_COUNT = 30;
const DRIVER_COUNT = 20;
const HOME_COUNT = 10; // total population = PED_COUNT + DRIVER_COUNT + HOME_COUNT

const SKIN_TONES = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffe0bd, 0xffcd94];
const SHIRT_COLORS = [
  0x2e86de, 0xe17055, 0x00b894, 0xfdcb6e, 0x6c5ce7, 0xd63031, 0x1abc9c,
  0xe84393, 0x0984e3, 0xf39c12, 0x00cec9,
];
const PANTS_COLORS = [
  0x2f3b4c, 0x34495e, 0x22313f, 0x4a4a4a, 0x1e272e, 0x574b60,
];

function randChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomCitizenMesh() {
  return createHumanFigure({
    shirtColor: randChoice(SHIRT_COLORS),
    pantsColor: randChoice(PANTS_COLORS),
    skinColor: randChoice(SKIN_TONES),
  });
}

// Eases a mesh's yaw toward the direction (dirX, dirZ) it's currently moving.
function faceDirection(mesh, dirX, dirZ, dt, rate = 0.15) {
  const targetYaw = Math.atan2(dirX, dirZ);
  let diff = targetYaw - mesh.rotation.y;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  mesh.rotation.y += diff * Math.min(1, rate * dt);
}

// A point is "clear" if it doesn't overlap any static obstacle — the same
// check world.js uses to keep spawns out of geometry.
function isClearPoint(x, z, half = 0.45) {
  const box = new THREE.Box3(
    new THREE.Vector3(x - half, 0, z - half),
    new THREE.Vector3(x + half, 2, z + half),
  );
  for (const t of state.treeBoxes) if (box.intersectsBox(t)) return false;
  for (const b of state.buildingBoxes) if (box.intersectsBox(b)) return false;
  for (const w of state.wallBoxes) if (box.intersectsBox(w)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// Civilians — pedestrians and home residents share one hostile/combat
// system (see below) on top of their own passive behavior. `kind` picks
// which passive routine runs while they're not aggro'd on the player.
// ─────────────────────────────────────────────────────────────────────────
const civilians = [];
const PED_SPEED = 0.09; // units per frame at ~60fps

function pickPedestrianTarget(c) {
  const p = c.mesh.position;
  for (let i = 0; i < 10; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 8 + Math.random() * 20;
    const x = p.x + Math.cos(angle) * dist;
    const z = p.z + Math.sin(angle) * dist;
    if (isClearPoint(x, z)) {
      c.targetX = x;
      c.targetZ = z;
      return true;
    }
  }
  return false;
}

function createPedestrian() {
  // Keep pedestrians from popping in right on top of the player.
  const spawn = findClearSpawnPosition(state.player.position, 30);
  const mesh = randomCitizenMesh();
  mesh.rotation.y = Math.random() * Math.PI * 2;
  mesh.position.set(spawn.x, getGroundHeight(spawn.x, spawn.z) + 1, spawn.z);
  state.scene.add(mesh);

  civilians.push({
    mesh,
    kind: "pedestrian",
    home: null,
    hostile: false,
    lastHit: 0,
    mode: "idle",
    timer: 1 + Math.random() * 3,
    targetX: spawn.x,
    targetZ: spawn.z,
  });
}

// Spawns the driver on foot beside their car the moment it's carjacked, so
// stealing a car actually throws someone out of it instead of the car just
// silently changing hands. They step off to whichever side is clear and
// then live on as an ordinary pedestrian.
function ejectDriver(car) {
  const heading = car.rotation.y;
  const sideX = Math.cos(heading);
  const sideZ = -Math.sin(heading);
  let x = car.position.x + sideX * 2.4;
  let z = car.position.z + sideZ * 2.4;
  if (!isClearPoint(x, z)) {
    x = car.position.x - sideX * 2.4;
    z = car.position.z - sideZ * 2.4;
  }

  const mesh = randomCitizenMesh();
  mesh.rotation.y = Math.random() * Math.PI * 2;
  mesh.position.set(x, getGroundHeight(x, z) + 1, z);
  state.scene.add(mesh);

  civilians.push({
    mesh,
    kind: "pedestrian",
    home: null,
    hostile: false,
    lastHit: 0,
    mode: "idle",
    timer: 0.5 + Math.random(),
    targetX: x,
    targetZ: z,
  });
}

function updatePedestrianPassive(c, dt) {
  const seconds = dt / 60;

  if (c.mode === "idle") {
    c.timer -= seconds;
    updateWalkCycle(c.mesh, dt, false);
    if (c.timer <= 0) {
      if (pickPedestrianTarget(c)) {
        c.mode = "walk";
        c.timer = 12; // safety timeout in case it gets stuck against something
      } else {
        c.timer = 1 + Math.random() * 2;
      }
    }
    return;
  }

  // "walk"
  const p = c.mesh.position;
  const dx = c.targetX - p.x;
  const dz = c.targetZ - p.z;
  const dist = Math.hypot(dx, dz);
  c.timer -= seconds;

  if (dist < 0.6 || c.timer <= 0) {
    c.mode = "idle";
    c.timer = 1.5 + Math.random() * 3.5;
    updateWalkCycle(c.mesh, dt, false);
    return;
  }

  const dirX = dx / dist;
  const dirZ = dz / dist;
  const step = PED_SPEED * dt;
  const nx = p.x + dirX * step;
  const nz = p.z + dirZ * step;

  if (isClearPoint(nx, nz)) {
    p.x = nx;
    p.z = nz;
    p.y = getGroundHeight(nx, nz) + 1;
    faceDirection(c.mesh, dirX, dirZ, dt);
    updateWalkCycle(c.mesh, dt, true);
  } else {
    // Something's in the way — stop and reconsider rather than push through.
    c.mode = "idle";
    c.timer = 0.4;
    updateWalkCycle(c.mesh, dt, false);
  }
}

// ─── Home residents (passive mode) ────────────────────────────────────────
const HOME_MARGIN = 0.8;

function pickHomeSpot(home) {
  return {
    x: THREE.MathUtils.lerp(
      home.minX + HOME_MARGIN,
      home.maxX - HOME_MARGIN,
      Math.random(),
    ),
    z: THREE.MathUtils.lerp(
      home.minZ + HOME_MARGIN,
      home.maxZ - HOME_MARGIN,
      Math.random(),
    ),
  };
}

function createResident() {
  if (state.buildingInteriors.length === 0) return;
  const home =
    state.buildingInteriors[
      Math.floor(Math.random() * state.buildingInteriors.length)
    ];
  const spot = pickHomeSpot(home);

  const mesh = randomCitizenMesh();
  mesh.rotation.y = Math.random() * Math.PI * 2;
  mesh.position.set(spot.x, 1, spot.z);
  state.scene.add(mesh);

  civilians.push({
    mesh,
    kind: "resident",
    home,
    hostile: false,
    lastHit: 0,
    mode: "idle",
    timer: 3 + Math.random() * 8,
    targetX: spot.x,
    targetZ: spot.z,
  });
}

function updateResidentPassive(c, dt) {
  const seconds = dt / 60;

  if (c.mode === "idle") {
    c.timer -= seconds;
    updateWalkCycle(c.mesh, dt, false);
    if (c.timer <= 0) {
      const spot = pickHomeSpot(c.home);
      c.targetX = spot.x;
      c.targetZ = spot.z;
      c.mode = "walk";
      c.timer = 8;
    }
    return;
  }

  const p = c.mesh.position;
  const dx = c.targetX - p.x;
  const dz = c.targetZ - p.z;
  const dist = Math.hypot(dx, dz);
  c.timer -= seconds;

  if (dist < 0.4 || c.timer <= 0) {
    c.mode = "idle";
    c.timer = 4 + Math.random() * 10;
    updateWalkCycle(c.mesh, dt, false);
    return;
  }

  const dirX = dx / dist;
  const dirZ = dz / dist;
  const step = 0.05 * dt;
  p.x += dirX * step;
  p.z += dirZ * step;
  faceDirection(c.mesh, dirX, dirZ, dt);
  updateWalkCycle(c.mesh, dt, true);
}

// ─── Hostile combat ────────────────────────────────────────────────────────
// Firing a shot alarms any civilian within AGGRO_RADIUS of the player (see
// pulseAggro, driven by state.lastShotAt). A hostile civilian chases on
// foot and, once in fist range, lands a 0.25-damage hit on a cooldown —
// far weaker than an enemy's 1-damage bullet, since it's just a punch.
// Getting far enough away (DEAGGRO_RADIUS) calls it off for good.
const AGGRO_RADIUS = 16;
const DEAGGRO_RADIUS = 24;
const MELEE_RANGE = 1.4;
const MELEE_DAMAGE = 0.25;
const MELEE_COOLDOWN_MS = 800;
const CHASE_SPEED = 0.16; // slower than the player's run speed — outrunning them works

function pulseAggro() {
  const p = state.player.position;
  for (const c of civilians) {
    if (c.hostile) continue;
    const dx = c.mesh.position.x - p.x;
    const dz = c.mesh.position.z - p.z;
    if (Math.hypot(dx, dz) < AGGRO_RADIUS) {
      c.hostile = true;
      c.lastHit = 0; // let them take a swing as soon as they're in range
    }
  }
}

function updateHostileCivilian(c, dt) {
  const mesh = c.mesh;
  const p = state.player.position;
  const dx = p.x - mesh.position.x;
  const dz = p.z - mesh.position.z;
  const dist = Math.hypot(dx, dz) || 0.001;

  if (dist > DEAGGRO_RADIUS) {
    c.hostile = false;
    c.kind = "pedestrian"; // may have chased far from home — just lives on the street now
    c.mode = "idle";
    c.timer = 0.5 + Math.random();
    // Drop any mid-swing punch so re-aggroing later can't fire a stale
    // strike that was frozen mid-animation.
    mesh.userData.punchState = null;
    updateWalkCycle(mesh, dt, false);
    return;
  }

  const dirX = dx / dist;
  const dirZ = dz / dist;

  if (dist > MELEE_RANGE) {
    const step = CHASE_SPEED * dt;
    const nx = mesh.position.x + dirX * step;
    const nz = mesh.position.z + dirZ * step;
    let moved = false;
    if (isClearPoint(nx, nz)) {
      mesh.position.x = nx;
      mesh.position.z = nz;
      mesh.position.y = getGroundHeight(nx, nz) + 1;
      moved = true;
    }
    faceDirection(mesh, dirX, dirZ, dt, 0.2);
    updateWalkCycle(mesh, dt, moved);
    return;
  }

  // Close enough to fight. The civilian plays a full punch animation
  // (windup → jab → recover) and the damage lands at the moment the fist
  // reaches extension — updatePunch() reports "strike" on exactly that frame.
  faceDirection(mesh, dirX, dirZ, dt, 0.3);
  updateWalkCycle(mesh, dt, false);

  if (state.playerIndoors) {
    // Player is safe inside a building — no swings at all.
    updatePunch(mesh, dt);
    return;
  }

  const swing = updatePunch(mesh, dt);

  // No swing running and the cooldown allows it → wind up the next punch,
  // alternating hands so a flurry looks natural.
  if (swing === false && Date.now() - c.lastHit >= MELEE_COOLDOWN_MS) {
    c.punchHand = c.punchHand === "R" ? "L" : "R";
    startPunch(mesh, c.punchHand);
  }

  // Damage connects exactly when the fist snaps forward.
  if (swing === "strike") {
    c.lastHit = Date.now();
    state.playerLife -= MELEE_DAMAGE;
    updateLifeHud();
    if (state.playerLife <= 0 && !state.gameOver) {
      triggerGameOver("You were beaten down by an angry mob.");
    }
  }
}

function updateCivilian(c, dt) {
  // Mid-air from a car hit — fly the ragdoll arc instead of normal AI.
  if (c.knockTime > 0) {
    updateCivilianKnockback(c, dt);
    return;
  }
  if (c.hostile) {
    updateHostileCivilian(c, dt);
    return;
  }
  if (c.kind === "resident") updateResidentPassive(c, dt);
  else updatePedestrianPassive(c, dt);
}

// ─── Car vs civilian ───────────────────────────────────────────────────────
// A moving car that reaches a civilian launches them out of the way — the
// same knockback arc the player gets from NPC traffic. Being flattened also
// interrupts any hostile chase.
function launchCivilian(c, car) {
  const dir = knockDirectionFor(car, c.mesh.position);

  c.knockVX = dir.x * CIV_KNOCKBACK_FORCE;
  c.knockVZ = dir.z * CIV_KNOCKBACK_FORCE;
  c.knockVY = CIV_KNOCKBACK_UP;
  c.knockTime = CIV_KNOCKBACK_DURATION;

  if (c.hostile) {
    c.hostile = false;
    c.mesh.userData.punchState = null;
  }
}

function updateCivilianKnockback(c, dt) {
  const p = c.mesh.position;

  c.knockTime -= dt / 60;

  p.x += c.knockVX * dt;
  p.z += c.knockVZ * dt;
  p.y += c.knockVY * dt;

  // Gravity + air resistance, matching the player's flight profile.
  c.knockVY -= CIV_KNOCKBACK_GRAVITY * dt;
  c.knockVX *= Math.pow(0.94, dt);
  c.knockVZ *= Math.pow(0.94, dt);

  const groundY = getGroundHeight(p.x, p.z) + 1;

  if (p.y <= groundY) {
    p.y = groundY;
    c.knockTime = 0;
    c.knockVX = 0;
    c.knockVY = 0;
    c.knockVZ = 0;
    // Stunned for a moment, then resume ordinary street life.
    c.mode = "idle";
    c.timer = 0.6 + Math.random();
    return;
  }

  // Safety timeout — never leave a civilian frozen mid-air.
  if (c.knockTime <= 0) {
    p.y = groundY;
    c.knockTime = 0;
    c.knockVX = 0;
    c.knockVY = 0;
    c.knockVZ = 0;
    c.mode = "idle";
    c.timer = 0.6 + Math.random();
  }
}

// Launch every civilian overlapping this car's footprint. Called with the
// player-driven car (its `velocity` is in units/frame) and with NPC cars
// (their per-frame `speed`). Parked cars don't fling anyone.
function pushCiviliansFromCar(car, speed) {
  if (Math.abs(speed) < CIV_HIT_MIN_SPEED) return;
  for (const c of civilians) {
    if (c.knockTime > 0) continue;
    const civBox = makeBox(c.mesh.position, 0.5, 1, 0.5);
    if (carHitsBox(car, civBox)) launchCivilian(c, car);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Drivers — circulate the Manhattan-grid road network built by world.js.
// Each one tracks which road it's on (`axis` + `fixedCoord`) and the
// upcoming coordinate where it must make a decision (`decisionCoord`). At
// every intersection it mostly continues straight, sometimes turns — the
// way a real driver picks a route rather than following a fixed rail.
// Movement always snaps exactly onto the grid (so a car can never clip into
// a building); only the visual chassis yaw eases into a turn, giving the
// pivot a natural feel without ever leaving the road. Opposite-direction
// traffic on the same road drives on opposite sides of the centerline
// (LANE_OFFSET), so two cars heading toward each other don't just meet
// head-on down the middle — the single biggest source of gridlock before
// this existed. A driver that still can't make progress for too long
// (STUCK_TIME_LIMIT) tries to escape rather than sit there forever: turn
// off if possible, otherwise reverse out of the jam.
//
// Every NPC car is also pushed into state.cars, so it's discoverable by the
// player's existing "nearest car" E-key handler in player.js — carjacking
// an NPC just means walking up and pressing E like any other car. Once the
// player has entered it (`state.car === car`), this module permanently
// hands off control: `drv.stolen` is set and the AI stops touching it, the
// same as any of the player's original cars from then on.
// ─────────────────────────────────────────────────────────────────────────
const drivers = [];
let roadNet = null;

const LANE_OFFSET = 2.2; // perpendicular offset from centerline per direction of travel
const STUCK_TIME_LIMIT = 1.4; // seconds with no progress before trying to escape a jam
const CAR_HIT_DAMAGE = 5;
const CAR_HIT_COOLDOWN_MS = 600;
let lastCarHitAt = 0;

// Car impact / knockback — the mutable `playerKnockback` object itself is
// shared via state.js so player.js can skip normal movement while active.
const CAR_KNOCKBACK_FORCE = 0.55;
const CAR_KNOCKBACK_UP = 0.32;
const CAR_KNOCKBACK_DURATION = 0.65;
const CAR_KNOCKBACK_GRAVITY = 0.025;

// Same treatment for civilians caught in a car's path — they get thrown the
// same way the player does instead of cars ghosting straight through them.
const CIV_KNOCKBACK_FORCE = 0.5;
const CIV_KNOCKBACK_UP = 0.3;
const CIV_KNOCKBACK_DURATION = 0.6;
const CIV_KNOCKBACK_GRAVITY = 0.025;
const CIV_HIT_MIN_SPEED = 0.05; // a parked / barely-rolling car won't launch anyone

// The direction from the car toward the target decides which way they are
// thrown: front hit → backward, left side → right, right side → left,
// angle hit → diagonal. A glancing (side) hit also mixes in the car's own
// movement for a more natural throw. Shared by the player and civilian
// knockback paths.
function knockDirectionFor(car, targetPos) {
  let hitX = targetPos.x - car.position.x;
  let hitZ = targetPos.z - car.position.z;

  const distance = Math.hypot(hitX, hitZ);

  if (distance < 0.001) {
    // Extremely unlikely fallback:
    // push in the direction the car is traveling.
    hitX = Math.sin(car.rotation.y);
    hitZ = Math.cos(car.rotation.y);
  } else {
    hitX /= distance;
    hitZ /= distance;
  }

  const carForwardX = Math.sin(car.rotation.y);
  const carForwardZ = Math.cos(car.rotation.y);

  // High when the car is driving into the target, near zero for side hits.
  const forwardImpact = carForwardX * hitX + carForwardZ * hitZ;

  let knockX;
  let knockZ;

  if (forwardImpact > 0.35) {
    // Strong frontal impact → mostly straight away from the car.
    knockX = hitX;
    knockZ = hitZ;
  } else {
    // Side / glancing impact → keep the hit direction but mix in some of
    // the vehicle's movement for a more natural throw.
    const mix = 0.7;

    knockX = hitX * (1 - mix) + carForwardX * mix;
    knockZ = hitZ * (1 - mix) + carForwardZ * mix;

    const len = Math.hypot(knockX, knockZ);

    if (len > 0.001) {
      knockX /= len;
      knockZ /= len;
    }
  }

  return { x: knockX, z: knockZ };
}

function classifyRoads() {
  const verticals = []; // travel along Z, fixed X
  const horizontals = []; // travel along X, fixed Z
  for (const r of state.roads) {
    const wx = r.maxX - r.minX;
    const wz = r.maxZ - r.minZ;
    if (wx < wz) {
      verticals.push({ x: (r.minX + r.maxX) / 2, minZ: r.minZ, maxZ: r.maxZ });
    } else {
      horizontals.push({
        z: (r.minZ + r.maxZ) / 2,
        minX: r.minX,
        maxX: r.maxX,
      });
    }
  }
  verticals.sort((a, b) => a.x - b.x);
  horizontals.sort((a, b) => a.z - b.z);
  return { verticals, horizontals };
}

// Nearest value in `sorted` strictly beyond `from` in the given direction;
// null if `from` is already at (or past) the edge of the grid.
function nextCoord(sorted, from, dir) {
  const eps = 0.5;
  if (dir > 0) {
    for (const v of sorted) if (v > from + eps) return v;
  } else {
    for (let i = sorted.length - 1; i >= 0; i--)
      if (sorted[i] < from - eps) return sorted[i];
  }
  return null;
}

function headingFor(axis, dir) {
  if (axis === "v") return dir > 0 ? 0 : Math.PI;
  return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
}

// Tries to turn onto the crossing road at the intersection just reached.
// Picks a direction at random, falling back to the other if that way is a
// dead end (only possible right at the edge of the grid).
function attemptTurn(drv, movingCoord) {
  const vXs = roadNet.verticals.map((v) => v.x);
  const hZs = roadNet.horizontals.map((h) => h.z);
  const searchList = drv.axis === "v" ? vXs : hZs;
  const firstDir = Math.random() < 0.5 ? 1 : -1;

  for (const dir of [firstDir, -firstDir]) {
    const next = nextCoord(searchList, drv.fixedCoord, dir);
    if (next !== null) {
      drv.axis = drv.axis === "v" ? "h" : "v";
      drv.fixedCoord = movingCoord;
      drv.dir = dir;
      drv.decisionCoord = next;
      return true;
    }
  }
  return false;
}

// Keeps going straight on the current road; false if that runs off the grid.
function continueStraight(drv, movingCoord) {
  const crossList =
    drv.axis === "v"
      ? roadNet.horizontals.map((h) => h.z)
      : roadNet.verticals.map((v) => v.x);
  const next = nextCoord(crossList, movingCoord, drv.dir);
  if (next === null) return false;
  drv.decisionCoord = next;
  return true;
}

// Decision logic at an intersection: mostly go straight, sometimes turn —
// and if the "straight" choice would drive off the edge of the city, turn
// is forced instead of stopping dead.
function chooseNextLeg(drv) {
  const movingCoord = drv.decisionCoord;
  const preferTurn = Math.random() < 0.35;
  if (preferTurn && attemptTurn(drv, movingCoord)) return;
  if (continueStraight(drv, movingCoord)) return;
  attemptTurn(drv, movingCoord);
}

// The fixed-axis coordinate a car should actually sit at while driving this
// leg: the road's true centerline plus a per-direction lane offset, so
// opposite-direction traffic on the same road doesn't share one line.
function laneCoordFor(drv) {
  return drv.fixedCoord + drv.dir * LANE_OFFSET;
}

// Snaps the car onto its current lane. Only needs calling right after axis
// or direction changes (turning, escaping a jam) — between those moments
// the fixed axis is never touched by ordinary forward movement, so it holds
// its lane on its own (and still gets nudged by resolveCarVsCarOverlap if
// something's overlapping it).
function snapToLane(drv, car) {
  if (drv.axis === "v") car.position.x = laneCoordFor(drv);
  else car.position.z = laneCoordFor(drv);
}

// Called when a driver has made no progress for STUCK_TIME_LIMIT seconds —
// gridlocked behind another car, or boxed in. Mostly tries to peel off onto
// a crossing road; failing that (or by chance), backs out the way it came.
// Either way it's a fresh direction to try, breaking a frozen standoff.
function attemptEscape(drv, car) {
  const movingCoord = drv.axis === "v" ? car.position.z : car.position.x;

  if (Math.random() < 0.5 && attemptTurn(drv, movingCoord)) {
    snapToLane(drv, car);
    return;
  }

  drv.dir *= -1;
  const crossList =
    drv.axis === "v"
      ? roadNet.horizontals.map((h) => h.z)
      : roadNet.verticals.map((v) => v.x);
  const next = nextCoord(crossList, movingCoord, drv.dir);
  drv.decisionCoord = next !== null ? next : movingCoord;
  snapToLane(drv, car);
}

// The direction from the car toward the player decides which way the player
// is thrown: front hit → backward, left side → right, right side → left,
// angle hit → diagonal. A glancing (side) hit also mixes in the car's own
// movement for a more natural throw.
function applyCarKnockback(car) {
  const player = state.player;

  const knock = knockDirectionFor(car, player.position);
  const knockX = knock.x;
  const knockZ = knock.z;

  playerKnockback.active = true;
  playerKnockback.velocityX = knockX * CAR_KNOCKBACK_FORCE;
  playerKnockback.velocityZ = knockZ * CAR_KNOCKBACK_FORCE;
  // Launch the player into the air.
  playerKnockback.velocityY = CAR_KNOCKBACK_UP;
  playerKnockback.time = CAR_KNOCKBACK_DURATION;
}

function updatePlayerKnockback(dt) {
  if (!playerKnockback.active) return;

  const player = state.player;

  playerKnockback.time -= dt / 60;

  // ------------------------------------------------------------
  // Move player horizontally
  // ------------------------------------------------------------

  player.position.x += playerKnockback.velocityX * dt;
  player.position.z += playerKnockback.velocityZ * dt;

  // ------------------------------------------------------------
  // Move player vertically
  // ------------------------------------------------------------

  player.position.y += playerKnockback.velocityY * dt;

  // Gravity
  playerKnockback.velocityY -= CAR_KNOCKBACK_GRAVITY * dt;

  // Air resistance
  playerKnockback.velocityX *= Math.pow(0.94, dt);
  playerKnockback.velocityZ *= Math.pow(0.94, dt);

  // ------------------------------------------------------------
  // Stop at the ground
  // ------------------------------------------------------------

  const groundY = getGroundHeight(player.position.x, player.position.z) + 1;

  if (player.position.y <= groundY) {
    player.position.y = groundY;

    playerKnockback.active = false;
    playerKnockback.velocityX = 0;
    playerKnockback.velocityY = 0;
    playerKnockback.velocityZ = 0;
  }

  // Safety timeout
  if (playerKnockback.time <= 0) {
    playerKnockback.active = false;

    if (player.position.y < groundY) {
      player.position.y = groundY;
    }
  }
}

// A moving NPC car running into the player on foot costs some life — cars
// don't hurt you while you're safely inside one (your own or a parked one).
function checkCarHitsPlayer(car) {
  if (state.inCar || state.playerIndoors) return;

  // Don't repeatedly hit the player every frame.
  if (Date.now() - lastCarHitAt < CAR_HIT_COOLDOWN_MS) {
    return;
  }

  const playerBox = makeBox(state.player.position, 0.5, 1, 0.5);
  if (!carHitsBox(car, playerBox)) return;

  lastCarHitAt = Date.now();

  // ------------------------------------------------------------
  // DAMAGE
  // ------------------------------------------------------------

  state.playerLife -= CAR_HIT_DAMAGE;
  updateLifeHud();

  // ------------------------------------------------------------
  // PHYSICAL IMPACT
  // ------------------------------------------------------------

  applyCarKnockback(car);

  // ------------------------------------------------------------
  // DEATH
  // ------------------------------------------------------------

  if (state.playerLife <= 0 && !state.gameOver) {
    triggerGameOver("You were run over by a car.");
  }
}

function createDriver() {
  const { verticals, horizontals } = roadNet;
  if (verticals.length === 0 || horizontals.length === 0) return;
  const vXs = verticals.map((v) => v.x);
  const hZs = horizontals.map((h) => h.z);

  const axis = Math.random() < 0.5 ? "v" : "h";
  const dir = Math.random() < 0.5 ? 1 : -1;
  let fixedCoord, movingCoord;
  if (axis === "v") {
    const road = verticals[Math.floor(Math.random() * verticals.length)];
    fixedCoord = road.x;
    movingCoord = road.minZ + Math.random() * (road.maxZ - road.minZ);
  } else {
    const road = horizontals[Math.floor(Math.random() * horizontals.length)];
    fixedCoord = road.z;
    movingCoord = road.minX + Math.random() * (road.maxX - road.minX);
  }

  const styleIdx = Math.floor(Math.random() * CAR_STYLES.length);
  const laneCoord = fixedCoord + dir * LANE_OFFSET;
  const x = axis === "v" ? laneCoord : movingCoord;
  const z = axis === "v" ? movingCoord : laneCoord;
  const car = createCarByStyle(x, z, styleIdx);
  car.rotation.y = headingFor(axis, dir);
  state.scene.add(car);
  state.cars.push(car); // discoverable/stealable via the normal car-entry flow

  const otherList = axis === "v" ? hZs : vXs;
  const decisionCoord = nextCoord(otherList, movingCoord, dir) ?? movingCoord;

  drivers.push({
    mesh: car,
    axis,
    fixedCoord,
    dir,
    decisionCoord,
    speed: 0.22 + Math.random() * 0.18,
    stolen: false,
    stuckTime: 0,
  });
}

function updateDriver(drv, dt) {
  const car = drv.mesh;

  // The player has taken this car — hand off control permanently, exactly
  // like carjacking in GTA. From here on player.js's own updateCar() drives
  // it, whether the player is currently in it or has since parked and left.
  if (state.inCar && state.car === car && !drv.stolen) {
    drv.stolen = true;
    ejectDriver(car);
  }
  if (drv.stolen) return;

  const ud = car.userData;
  const targetHeading = headingFor(drv.axis, drv.dir);
  const laneCoord = laneCoordFor(drv);

  // Position always follows the grid exactly (moving axis increments by
  // speed, fixed axis holds its lane); only the chassis yaw eases toward
  // the new heading, so a turn looks like a pivot rather than a teleport,
  // without the car ever leaving the road surface. If another car
  // (player-driven, stolen, or another driver) is in the way, it simply
  // waits rather than clipping through — same rule the player's own car
  // follows via findCarOverlap in player.js.
  const move = drv.speed * dt;
  let nextX, nextZ;
  if (drv.axis === "v") {
    nextX = laneCoord;
    nextZ = car.position.z + Math.cos(targetHeading) * move;
  } else {
    nextZ = laneCoord;
    nextX = car.position.x + Math.sin(targetHeading) * move;
  }
  let actualMove = 0;
  if (!findCarOverlap({ x: nextX, z: nextZ }, car.rotation.y, car, 0.1)) {
    car.position.x = nextX;
    car.position.z = nextZ;
    actualMove = move;
  }
  car.position.y = 0;

  // Gently un-stick from any other car it's already overlapping (e.g. two
  // drivers spawning close together) rather than staying wedged forever.
  resolveCarVsCarOverlap(car);

  // Stuck in traffic? Try to get out of it instead of gridlocking forever.
  if (actualMove > 0) {
    drv.stuckTime = 0;
  } else {
    drv.stuckTime += dt / 60;
    if (drv.stuckTime > STUCK_TIME_LIMIT) {
      attemptEscape(drv, car);
      drv.stuckTime = 0;
    }
  }

  checkCarHitsPlayer(car);

  // NPC traffic doesn't ghost through pedestrians either.
  if (actualMove > 0) pushCiviliansFromCar(car, drv.speed);

  let diff = targetHeading - car.rotation.y;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  car.rotation.y += diff * Math.min(1, 0.12 * dt);

  const movingCoord = drv.axis === "v" ? car.position.z : car.position.x;
  const reached =
    drv.dir > 0
      ? movingCoord >= drv.decisionCoord - 0.4
      : movingCoord <= drv.decisionCoord + 0.4;
  if (reached) {
    chooseNextLeg(drv);
    snapToLane(drv, car);
  }

  const steer = Math.max(-0.5, Math.min(0.5, diff));
  ud.steerPivotL.rotation.y = steer;
  ud.steerPivotR.rotation.y = steer;
  const spin = actualMove / 0.42;
  ud.wheelGroupFL.rotation.x += spin;
  ud.wheelGroupFR.rotation.x += spin;
  ud.wheelGroupRL.rotation.x += spin;
  ud.wheelGroupRR.rotation.x += spin;
}

// ─────────────────────────────────────────────────────────────────────────
let lastAggroShotAt = 0;

export function initNpcs() {
  roadNet = classifyRoads();

  for (let i = 0; i < PED_COUNT; i++) createPedestrian();
  for (let i = 0; i < DRIVER_COUNT; i++) createDriver();
  for (let i = 0; i < HOME_COUNT; i++) createResident();
}

export function updateNpcs(dt) {
  if (state.lastShotAt && state.lastShotAt !== lastAggroShotAt) {
    lastAggroShotAt = state.lastShotAt;
    pulseAggro();
  }

  for (const c of civilians) updateCivilian(c, dt);
  for (const drv of drivers) updateDriver(drv, dt);

  // The player's car flings pedestrians it reaches, exactly like NPC
  // traffic flings the player. velocity is units/frame; parked cars are
  // filtered out inside pushCiviliansFromCar.
  if (state.inCar && state.car) {
    pushCiviliansFromCar(state.car, state.car.userData.velocity || 0);
  }

  // Advance the car-knockback/ragdoll flight (if any).
  updatePlayerKnockback(dt);
}
