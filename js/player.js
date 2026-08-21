// player.js
// Movement, jumping, and player shooting input (including sniper mode).

import * as THREE from "three";
import { state } from "./state.js";
import { makeBox } from "./character.js";
import { getBullet } from "./bullets.js";
import { triggerGameOver } from "./ui.js";

const moveSpeed = 0.3;
const keys = {
  KeyW: false,
  KeyS: false,
  KeyA: false,
  KeyD: false,
  ArrowUp: false,
  ArrowDown: false,
  ArrowLeft: false,
  ArrowRight: false,
  Space: false,
};
let isJumping = false;
const velocity = new THREE.Vector3();
const directionVec = new THREE.Vector3();
const upVector = new THREE.Vector3(0, 1, 0);
const rightVector = new THREE.Vector3();
const moveVector = new THREE.Vector3();

const doubleSpaceThreshold = 300; // milliseconds
let lastSpacePressTime = 0;

const defaultFOV = 75;
const sniperFOV = 20;
let isSniperMode = false;
let shootCooldown = false;
let sniperShootCooldown = false;

// Third-person camera settings.
const thirdPersonDistance = 6;
const thirdPersonHeight = 3;
const cameraForward = new THREE.Vector3();
const cameraUpOffset = new THREE.Vector3();

// Car settings.
const carSpeed = 0.85;
const carTurnRate = 0.04;
const carForward = new THREE.Vector3();
const carHalfWidth = 1.1;
const carHalfHeight = 0.9;
const carHalfDepth = 2.3;
// Extra yaw the mouse adds on top of the car's heading while driving.
let carLookYawOffset = 0;

// ---------------- Building Jump ----------------
function jumpToBuilding() {
  // Don't teleport to the roof while inside a hollow building (stay safe).
  if (state.playerIndoors) return;

  let candidateBuilding = null;
  let minDistance = Infinity;
  const margin = 2;

  for (const buildingBox of state.buildingBoxes) {
    if (
      state.player.position.x >= buildingBox.min.x - margin &&
      state.player.position.x <= buildingBox.max.x + margin &&
      state.player.position.z >= buildingBox.min.z - margin &&
      state.player.position.z <= buildingBox.max.z + margin
    ) {
      const center = new THREE.Vector3();
      buildingBox.getCenter(center);
      const horizontalDistance = Math.sqrt(
        (state.player.position.x - center.x) ** 2 +
          (state.player.position.z - center.z) ** 2,
      );
      if (horizontalDistance < minDistance) {
        minDistance = horizontalDistance;
        candidateBuilding = buildingBox;
      }
    }
  }

  if (candidateBuilding) {
    state.player.position.y = candidateBuilding.max.y + 1;
  }
}

// ---------------- Player Shooting ----------------
function shootBullet() {
  if (shootCooldown) return;

  const bullet = getBullet(0xff0000, false);
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2(0, 0);
  raycaster.setFromCamera(mouse, state.camera);
  const bulletDirection = raycaster.ray.direction.clone();
  const bulletStart = state.camera.position
    .clone()
    .add(bulletDirection.clone().multiplyScalar(1.1));
  bullet.position.copy(bulletStart);
  bullet.userData.direction = bulletDirection.clone();

  state.scene.add(bullet);
  state.bullets.push(bullet);

  shootCooldown = true;
  setTimeout(() => {
    shootCooldown = false;
  }, 200);
}

function shootSniperBullet() {
  if (sniperShootCooldown) return;

  const bullet = getBullet(0xff0000, false);
  bullet.userData.isSniper = true;

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2(0, 0);
  raycaster.setFromCamera(mouse, state.camera);
  const bulletDirection = raycaster.ray.direction.clone();
  const bulletStart = state.camera.position
    .clone()
    .add(bulletDirection.clone().multiplyScalar(1.1));
  bullet.position.copy(bulletStart);
  bullet.userData.direction = bulletDirection.clone();

  state.scene.add(bullet);
  state.bullets.push(bullet);

  sniperShootCooldown = true;
  setTimeout(() => {
    sniperShootCooldown = false;
  }, 500);
}

// ---------------- Movement ----------------
function getCurrentSupportingBuilding() {
  const margin = 2;
  for (const buildingBox of state.buildingBoxes) {
    if (
      state.player.position.x >= buildingBox.min.x - margin &&
      state.player.position.x <= buildingBox.max.x + margin &&
      state.player.position.z >= buildingBox.min.z - margin &&
      state.player.position.z <= buildingBox.max.z + margin
    ) {
      const targetY = buildingBox.max.y + 1;
      if (Math.abs(state.player.position.y - targetY) < 0.5) {
        return buildingBox;
      }
    }
  }
  return null;
}

export function updateMovement(dt) {
  const supportingBuilding = getCurrentSupportingBuilding();
  let currentGround = 1;
  if (supportingBuilding) {
    currentGround = supportingBuilding.max.y + 1;
  }

  state.camera.getWorldDirection(directionVec);
  directionVec.y = 0;
  directionVec.normalize();

  // Face the player toward the look/movement direction.
  state.player.rotation.y = Math.atan2(directionVec.x, directionVec.z);

  rightVector.crossVectors(upVector, directionVec).normalize();

  const speed = moveSpeed * dt;
  moveVector.set(0, 0, 0);
  if (keys["KeyW"] || keys["ArrowUp"])
    moveVector.addScaledVector(directionVec, speed);
  if (keys["KeyS"] || keys["ArrowDown"])
    moveVector.addScaledVector(directionVec, -speed);
  if (keys["KeyA"] || keys["ArrowLeft"])
    moveVector.addScaledVector(rightVector, speed);
  if (keys["KeyD"] || keys["ArrowRight"])
    moveVector.addScaledVector(rightVector, -speed);

  const playerBox = makeBox(state.player.position, 0.5, 1, 0.5);
  const newPlayerBox = playerBox.clone().translate(moveVector);

  let canMove = true;
  for (const treeBox of state.treeBoxes) {
    if (newPlayerBox.intersectsBox(treeBox)) {
      canMove = false;
      break;
    }
  }
  if (canMove) {
    for (const buildingBox of state.buildingBoxes) {
      if (supportingBuilding === buildingBox) continue;
      if (newPlayerBox.intersectsBox(buildingBox)) {
        canMove = false;
        break;
      }
    }
  }
  if (canMove) {
    for (const wallBox of state.wallBoxes) {
      if (newPlayerBox.intersectsBox(wallBox)) {
        canMove = false;
        break;
      }
    }
  }
  if (canMove) {
    const playerBoxNew = makeBox(state.player.position, 0.5, 1, 0.5);
    for (const enemy of state.enemies) {
      const enemyBox = makeBox(
        enemy.mesh.position,
        enemy.halfWidth,
        enemy.halfHeight,
        enemy.halfDepth,
      );
      if (playerBoxNew.intersectsBox(enemyBox)) {
        triggerGameOver("An enemy caught you.");
        return;
      }
    }
  }

  if (canMove) {
    state.player.position.add(moveVector);
  }

  if (
    keys["Space"] &&
    !isJumping &&
    Math.abs(state.player.position.y - currentGround) < 0.01
  ) {
    velocity.y = 0.5;
    isJumping = true;
  }

  velocity.y -= 0.02 * dt;
  state.player.position.y += velocity.y * dt;

  if (state.player.position.y < currentGround) {
    state.player.position.y = currentGround;
    velocity.y = 0;
    isJumping = false;
  }

  // Keep the player inside the generated world.
  const boundary = state.groundSize / 2 - 1;
  state.player.position.x = Math.max(
    -boundary,
    Math.min(boundary, state.player.position.x),
  );
  state.player.position.z = Math.max(
    -boundary,
    Math.min(boundary, state.player.position.z),
  );
}

// ---------------- Camera (first / third person / car) ----------------
export function updateCamera() {
  if (state.inCar && state.car) {
    // Follow camera behind the car, with mouse look-around added on top of the
    // car's heading instead of fighting the pointer-lock controls.
    const yaw = state.car.rotation.y + carLookYawOffset;
    carForward.set(Math.sin(yaw), 0, Math.cos(yaw));
    state.camera.position
      .copy(state.car.position)
      .add(cameraUpOffset.set(0, 3, 0))
      .addScaledVector(carForward, -8);
    state.camera.lookAt(
      state.car.position.x,
      state.car.position.y + 1,
      state.car.position.z,
    );
    return;
  }

  if (state.thirdPerson) {
    // Orbit behind the player using the current look direction (yaw only).
    state.camera.getWorldDirection(cameraForward);
    cameraForward.y = 0;
    if (cameraForward.lengthSq() < 1e-6) cameraForward.set(0, 0, -1);
    cameraForward.normalize();

    state.camera.position
      .copy(state.player.position)
      .add(cameraUpOffset.set(0, thirdPersonHeight, 0))
      .addScaledVector(cameraForward, -thirdPersonDistance);
  } else {
    state.camera.position.set(
      state.player.position.x,
      state.player.position.y + 2,
      state.player.position.z,
    );
  }
}

// ---------------- Car ----------------
function createCar(x, z) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshPhongMaterial({
    color: 0xc03030,
    shininess: 40,
  });
  const glassMat = new THREE.MeshPhongMaterial({
    color: 0x9fc4dc,
    shininess: 60,
  });
  const darkMat = new THREE.MeshPhongMaterial({
    color: 0x1a1a1a,
    shininess: 12,
  });
  const lightMat = new THREE.MeshPhongMaterial({
    color: 0xfff2b0,
    shininess: 60,
  });

  const add = (geometry, material, lx, ly, lz) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(lx, ly, lz);
    group.add(mesh);
    return mesh;
  };

  // Body + cabin.
  add(new THREE.BoxGeometry(2, 0.6, 4.4), bodyMat, 0, 0.7, 0);
  add(new THREE.BoxGeometry(1.7, 0.55, 2.1), glassMat, 0, 1.28, -0.25);

  // Headlights.
  add(new THREE.BoxGeometry(0.4, 0.15, 0.1), lightMat, -0.6, 0.65, 2.2);
  add(new THREE.BoxGeometry(0.4, 0.15, 0.1), lightMat, 0.6, 0.65, 2.2);

  // Wheels (axle along X).
  const wheelGeometry = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12);
  wheelGeometry.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [lx, lz] of [
    [-0.95, 1.4],
    [0.95, 1.4],
    [-0.95, -1.4],
    [0.95, -1.4],
  ]) {
    wheels.push(add(wheelGeometry, darkMat, lx, 0.42, lz));
  }
  group.userData.wheels = wheels;

  group.position.set(x, 0, z);
  return group;
}

// Oriented car footprint vs an axis-aligned box. Uses 2D separating-axis tests
// on the XZ plane (the car's yaw only rotates it around Y) plus a vertical
// height test, so collisions stay correct while the car is rotated.
//
// Returns the minimum-overlap penetration { depth, nx, nz } (normal pointing
// away from the obstacle) or null when there is no collision. `shrink` lets us
// treat the car as slightly smaller for a little clearance around edges.
function carOverlapWithAabb(carPos, yaw, aabb, shrink = 0) {
  // Vertical test: the car spans y in [pos.y - halfHeight, pos.y + halfHeight].
  if (
    carPos.y + carHalfHeight < aabb.min.y ||
    carPos.y - carHalfHeight > aabb.max.y
  )
    return null;

  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  // Car local axes in the XZ plane.
  const carAxisX = { x: cosY, z: sinY };
  const carAxisZ = { x: -sinY, z: cosY };
  const axes = [carAxisX, carAxisZ, { x: 1, z: 0 }, { x: 0, z: 1 }];

  const hw = carHalfWidth - shrink;
  const hd = carHalfDepth - shrink;
  const aabbCx = (aabb.min.x + aabb.max.x) / 2;
  const aabbCz = (aabb.min.z + aabb.max.z) / 2;
  const aabbHx = (aabb.max.x - aabb.min.x) / 2;
  const aabbHz = (aabb.max.z - aabb.min.z) / 2;
  const dx = carPos.x - aabbCx;
  const dz = carPos.z - aabbCz;

  let minDepth = Infinity;
  let n = { x: 0, z: 0 };

  for (const axis of axes) {
    const carRadius =
      hw * Math.abs(axis.x * carAxisX.x + axis.z * carAxisX.z) +
      hd * Math.abs(axis.x * carAxisZ.x + axis.z * carAxisZ.z);
    const aabbRadius = aabbHx * Math.abs(axis.x) + aabbHz * Math.abs(axis.z);
    const distance = axis.x * dx + axis.z * dz;
    const overlap = carRadius + aabbRadius - Math.abs(distance);
    if (overlap < 0) return null; // Separated on this axis.
    if (overlap < minDepth) {
      minDepth = overlap;
      const sign = distance >= 0 ? 1 : -1;
      n = { x: axis.x * sign, z: axis.z * sign };
    }
  }

  return { depth: minDepth, nx: n.x, nz: n.z };
}

function carIntersectsAabb(carPos, yaw, aabb) {
  return carOverlapWithAabb(carPos, yaw, aabb, 0) !== null;
}

function carCollides(position, yaw, shrink = 0) {
  for (const t of state.treeBoxes)
    if (carOverlapWithAabb(position, yaw, t, shrink)) return true;
  for (const b of state.buildingBoxes)
    if (carOverlapWithAabb(position, yaw, b, shrink)) return true;
  for (const w of state.wallBoxes)
    if (carOverlapWithAabb(position, yaw, w, shrink)) return true;
  return false;
}

// Push the car out of any obstacle it has clipped into (e.g. after steering
// while close to a wall). This stops the car from getting "stuck on nothing".
function resolveCarOverlaps() {
  const car = state.car;
  if (!car) return;

  for (let iter = 0; iter < 4; iter++) {
    let worst = null;
    for (const list of [
      state.treeBoxes,
      state.buildingBoxes,
      state.wallBoxes,
    ]) {
      for (const box of list) {
        const o = carOverlapWithAabb(car.position, car.rotation.y, box, 0);
        if (o && (!worst || o.depth > worst.depth)) worst = o;
      }
    }
    if (!worst) break;
    // Nudge the car out along the minimum translation vector (+ small buffer).
    car.position.x += worst.nx * (worst.depth + 0.02);
    car.position.z += worst.nz * (worst.depth + 0.02);
  }
}

// Check whether a player-sized box would hit any static obstacle.
function staticCollides(box) {
  for (const t of state.treeBoxes) if (box.intersectsBox(t)) return true;
  for (const b of state.buildingBoxes) if (box.intersectsBox(b)) return true;
  for (const w of state.wallBoxes) if (box.intersectsBox(w)) return true;
  return false;
}

// Kill any normal enemy the car is currently overlapping (running them over).
function runOverEnemies() {
  const car = state.car;
  if (!car) return;
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const enemy = state.enemies[i];
    const enemyBox = makeBox(
      enemy.mesh.position,
      enemy.halfWidth,
      enemy.halfHeight,
      enemy.halfDepth,
    );
    if (carIntersectsAabb(car.position, car.rotation.y, enemyBox)) {
      state.scene.remove(enemy.mesh);
      state.enemies.splice(i, 1);
    }
  }
}

function enterCar() {
  state.inCar = true;
  state.player.visible = false;
  carLookYawOffset = 0;
}

function exitCar() {
  state.inCar = false;
  state.player.visible = true;

  // Find a clear spot around the car so the player never pops inside geometry.
  const carPos = state.car.position;
  const offsets = [
    [2.5, 0],
    [-2.5, 0],
    [0, 2.5],
    [0, -2.5],
    [2.5, 2.5],
    [-2.5, -2.5],
    [2.5, -2.5],
    [-2.5, 2.5],
  ];
  for (const [dx, dz] of offsets) {
    const pos = new THREE.Vector3(carPos.x + dx, 1, carPos.z + dz);
    if (!staticCollides(makeBox(pos, 0.5, 1, 0.5))) {
      state.player.position.copy(pos);
      return;
    }
  }

  // Fallback (kept inside the world boundary).
  const boundary = state.groundSize / 2 - 1;
  state.player.position.set(
    Math.max(-boundary, Math.min(boundary, carPos.x + 2.5)),
    1,
    Math.max(-boundary, Math.min(boundary, carPos.z)),
  );
}

export function initCar() {
  // Spawn a car on a clear spot near the player.
  const p = state.player.position;
  let spot = null;
  for (let i = 0; i < 50; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 6 + Math.random() * 10;
    const x = p.x + Math.cos(a) * r;
    const z = p.z + Math.sin(a) * r;
    if (!carCollides(new THREE.Vector3(x, 0, z), 0)) {
      spot = { x, z };
      break;
    }
  }
  if (!spot) spot = { x: p.x + 8, z: p.z };

  const car = createCar(spot.x, spot.z);
  state.scene.add(car);
  state.car = car;

  // 'E' or 'Enter' to enter / exit the car.
  document.addEventListener("keydown", (event) => {
    if (event.code !== "KeyE" && event.code !== "Enter") return;
    if (state.inCar) {
      exitCar();
    } else if (state.car) {
      if (state.player.position.distanceTo(state.car.position) < 5) enterCar();
    }
  });

  // Mouse look-around while driving (instead of fighting the pointer lock).
  document.addEventListener("mousemove", (event) => {
    if (state.inCar) carLookYawOffset += event.movementX * 0.002;
  });
}

export function updateCar(dt) {
  const car = state.car;
  if (!car) return;

  // Steering: A/Left turns left, D/Right turns right.
  if (keys["KeyA"] || keys["ArrowLeft"]) car.rotation.y += carTurnRate * dt;
  if (keys["KeyD"] || keys["ArrowRight"]) car.rotation.y -= carTurnRate * dt;

  // Forward / backward.
  let accel = 0;
  if (keys["KeyW"] || keys["ArrowUp"]) accel = carSpeed * dt;
  if (keys["KeyS"] || keys["ArrowDown"]) accel = -carSpeed * 0.5 * dt;

  if (accel !== 0) {
    carForward.set(Math.sin(car.rotation.y), 0, Math.cos(car.rotation.y));
    const move = carForward.clone().multiplyScalar(accel);
    // Small clearance so the car doesn't stick on barely-touching edges.
    if (!carCollides(car.position.clone().add(move), car.rotation.y, 0.12)) {
      car.position.add(move);
    }

    // Spin the wheels based on distance travelled (arc length = radius × angle).
    for (const wheel of car.userData.wheels) wheel.rotation.x += accel / 0.42;
  }

  // Push the car back out if steering/movement clipped it into geometry.
  resolveCarOverlaps();

  // Keep the car inside the world.
  const boundary = state.groundSize / 2 - 2;
  car.position.x = Math.max(-boundary, Math.min(boundary, car.position.x));
  car.position.z = Math.max(-boundary, Math.min(boundary, car.position.z));

  // Run over normal enemies the car is touching.
  runOverEnemies();

  // Sync the (hidden) player position for the minimap / indoors checks.
  state.player.position.set(car.position.x, 1, car.position.z);
}

// ---------------- Input listeners & initial camera position ----------------
export function initPlayer() {
  document.addEventListener("keydown", (event) => {
    if (event.code === "KeyV") {
      state.thirdPerson = !state.thirdPerson;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      const now = Date.now();
      if (now - lastSpacePressTime < doubleSpaceThreshold) {
        jumpToBuilding();
      }
      lastSpacePressTime = now;
      keys[event.code] = true;
    } else if (keys.hasOwnProperty(event.code)) {
      // Prevent arrow keys from scrolling the page.
      if (event.code.startsWith("Arrow")) event.preventDefault();
      keys[event.code] = true;
    }
  });

  document.addEventListener("keyup", (event) => {
    if (keys.hasOwnProperty(event.code)) keys[event.code] = false;
  });

  document.addEventListener("mousedown", (event) => {
    if (state.inCar) return; // No shooting while driving.
    if (event.button === 0) {
      shootBullet();
    } else if (event.button === 2) {
      isSniperMode = true;
      state.camera.fov = sniperFOV;
      state.camera.updateProjectionMatrix();
    }
  });

  document.addEventListener("mouseup", (event) => {
    if (event.button === 2 && isSniperMode) {
      isSniperMode = false;
      state.camera.fov = defaultFOV;
      state.camera.updateProjectionMatrix();
      if (!state.inCar) shootSniperBullet();
    }
  });

  document.addEventListener("contextmenu", (event) => event.preventDefault());

  state.camera.position.set(
    state.player.position.x,
    state.player.position.y + 2,
    state.player.position.z,
  );
}
