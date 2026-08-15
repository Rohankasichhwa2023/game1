// player.js
// Movement, jumping, and player shooting input (including sniper mode).

import * as THREE from 'three';
import { state } from './state.js';
import { getBullet } from './bullets.js';
import { triggerGameOver } from './ui.js';

const moveSpeed = 0.3;
const keys = { KeyW: false, KeyS: false, KeyA: false, KeyD: false, Space: false };
let isJumping = false;
const velocity = new THREE.Vector3();
const directionVec = new THREE.Vector3();

const doubleSpaceThreshold = 300; // milliseconds
let lastSpacePressTime = 0;

const defaultFOV = 75;
const sniperFOV = 20;
let isSniperMode = false;
let shootCooldown = false;
let sniperShootCooldown = false;

// ---------------- Building Jump ----------------
function jumpToBuilding() {
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
        (state.player.position.z - center.z) ** 2
      );
      if (horizontalDistance < minDistance) {
        minDistance = horizontalDistance;
        candidateBuilding = buildingBox;
      }
    }
  }

  if (candidateBuilding) {
    state.player.position.y = candidateBuilding.max.y + 1;
    state.camera.position.set(state.player.position.x, state.player.position.y + 2, state.player.position.z);
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
  const bulletStart = state.camera.position.clone().add(bulletDirection.clone().multiplyScalar(1.1));
  bullet.position.copy(bulletStart);
  bullet.userData.direction = bulletDirection.clone();

  state.scene.add(bullet);
  state.bullets.push(bullet);

  shootCooldown = true;
  setTimeout(() => { shootCooldown = false; }, 200);
}

function shootSniperBullet() {
  if (sniperShootCooldown) return;

  const bullet = getBullet(0xff0000, false);
  bullet.userData.isSniper = true;

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2(0, 0);
  raycaster.setFromCamera(mouse, state.camera);
  const bulletDirection = raycaster.ray.direction.clone();
  const bulletStart = state.camera.position.clone().add(bulletDirection.clone().multiplyScalar(1.1));
  bullet.position.copy(bulletStart);
  bullet.userData.direction = bulletDirection.clone();

  state.scene.add(bullet);
  state.bullets.push(bullet);

  sniperShootCooldown = true;
  setTimeout(() => { sniperShootCooldown = false; }, 500);
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

export function updateMovement() {
  const supportingBuilding = getCurrentSupportingBuilding();
  let currentGround = 1;
  if (supportingBuilding) {
    currentGround = supportingBuilding.max.y + 1;
  }

  state.camera.getWorldDirection(directionVec);
  directionVec.y = 0;
  directionVec.normalize();

  const right = new THREE.Vector3();
  right.crossVectors(new THREE.Vector3(0, 1, 0), directionVec).normalize();

  const moveVector = new THREE.Vector3();
  if (keys['KeyW']) moveVector.addScaledVector(directionVec, moveSpeed);
  if (keys['KeyS']) moveVector.addScaledVector(directionVec, -moveSpeed);
  if (keys['KeyA']) moveVector.addScaledVector(right, moveSpeed);
  if (keys['KeyD']) moveVector.addScaledVector(right, -moveSpeed);

  const playerBox = new THREE.Box3().setFromObject(state.player);
  const newPlayerBox = playerBox.clone().translate(moveVector);

  let canMove = true;
  for (const treeBox of state.treeBoxes) {
    if (newPlayerBox.intersectsBox(treeBox)) { canMove = false; break; }
  }
  if (canMove) {
    for (const buildingBox of state.buildingBoxes) {
      if (supportingBuilding === buildingBox) continue;
      if (newPlayerBox.intersectsBox(buildingBox)) { canMove = false; break; }
    }
  }
  if (canMove) {
    for (const wallBox of state.wallBoxes) {
      if (newPlayerBox.intersectsBox(wallBox)) { canMove = false; break; }
    }
  }
  if (canMove) {
    const playerBoxNew = new THREE.Box3().setFromObject(state.player);
    for (const enemy of state.enemies) {
      const enemyBox = new THREE.Box3().setFromObject(enemy.mesh);
      if (playerBoxNew.intersectsBox(enemyBox)) {
        triggerGameOver('An enemy caught you.');
        return;
      }
    }
  }

  if (canMove) {
    state.player.position.add(moveVector);
    state.camera.position.set(state.player.position.x, state.player.position.y + 2, state.player.position.z);
  }

  if (keys['Space'] && !isJumping && Math.abs(state.player.position.y - currentGround) < 0.01) {
    velocity.y = 0.5;
    isJumping = true;
  }

  velocity.y -= 0.02;
  state.player.position.y += velocity.y;

  if (state.player.position.y < currentGround) {
    state.player.position.y = currentGround;
    velocity.y = 0;
    isJumping = false;
  }
}

// ---------------- Input listeners & initial camera position ----------------
export function initPlayer() {
  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      event.preventDefault();
      const now = Date.now();
      if (now - lastSpacePressTime < doubleSpaceThreshold) {
        jumpToBuilding();
      }
      lastSpacePressTime = now;
      keys[event.code] = true;
    } else if (keys.hasOwnProperty(event.code)) {
      keys[event.code] = true;
    }
  });

  document.addEventListener('keyup', (event) => {
    if (keys.hasOwnProperty(event.code)) keys[event.code] = false;
  });

  document.addEventListener('mousedown', (event) => {
    if (event.button === 0) {
      shootBullet();
    } else if (event.button === 2) {
      isSniperMode = true;
      state.camera.fov = sniperFOV;
      state.camera.updateProjectionMatrix();
    }
  });

  document.addEventListener('mouseup', (event) => {
    if (event.button === 2 && isSniperMode) {
      isSniperMode = false;
      state.camera.fov = defaultFOV;
      state.camera.updateProjectionMatrix();
      shootSniperBullet();
    }
  });

  document.addEventListener('contextmenu', (event) => event.preventDefault());

  state.camera.position.set(state.player.position.x, state.player.position.y + 2, state.player.position.z);
}
