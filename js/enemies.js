// enemies.js
// Normal enemy and boss enemy creation, AI, and per-frame updates.

import * as THREE from 'three';
import { state } from './state.js';
import { shootEnemyBullet } from './bullets.js';
import { triggerGameOver } from './ui.js';
import { spawnPortal } from './portal.js';

function createEnemy(x, z) {
  const enemyGeometry = new THREE.BoxGeometry(2, 2, 2);
  const enemyMaterial = new THREE.MeshPhongMaterial({ color: 0xff00ff });
  const enemyMesh = new THREE.Mesh(enemyGeometry, enemyMaterial);
  enemyMesh.castShadow = true;
  enemyMesh.receiveShadow = true;
  enemyMesh.position.set(x, 1, z);
  state.scene.add(enemyMesh);

  return { mesh: enemyMesh, life: 10, lastShot: Date.now(), shootInterval: 2000 };
}

function createBossEnemy(x, z) {
  const bossGeometry = new THREE.BoxGeometry(4, 4, 4);
  const bossMaterial = new THREE.MeshPhongMaterial({ color: 0x800080 });
  const bossMesh = new THREE.Mesh(bossGeometry, bossMaterial);
  bossMesh.castShadow = true;
  bossMesh.receiveShadow = true;
  bossMesh.position.set(x, 2, z);
  state.scene.add(bossMesh);

  return { mesh: bossMesh, life: 100, lastShot: Date.now(), shootInterval: 1000, isBoss: true };
}

function rotateVectorY(vector, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return new THREE.Vector3(
    vector.x * cos - vector.z * sin,
    vector.y,
    vector.x * sin + vector.z * cos
  );
}

function checkObstaclesCollision(box) {
  for (const treeBox of state.treeBoxes) {
    if (box.intersectsBox(treeBox)) return true;
  }
  for (const buildingBox of state.buildingBoxes) {
    if (box.intersectsBox(buildingBox)) return true;
  }
  for (const wallBox of state.wallBoxes) {
    if (box.intersectsBox(wallBox)) return true;
  }
  return false;
}

export function initEnemies() {
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * state.groundSize - state.groundSize / 2;
    const z = Math.random() * state.groundSize - state.groundSize / 2;
    state.enemies.push(createEnemy(x, z));
  }
}

function updateBossEnemy() {
  if (!state.bossEnemy) return;

  const playerBox = new THREE.Box3().setFromObject(state.player);
  const enemyBox = new THREE.Box3().setFromObject(state.bossEnemy.mesh);

  const directChaseDir = new THREE.Vector3().subVectors(state.player.position, state.bossEnemy.mesh.position).normalize();
  const bossSpeed = 0.05;
  const moveVector = directChaseDir.clone().multiplyScalar(bossSpeed);

  const enemyBoxAfterMove = enemyBox.clone().translate(moveVector);
  if (!checkObstaclesCollision(enemyBoxAfterMove)) {
    state.bossEnemy.mesh.position.add(moveVector);
  }

  const updatedEnemyBox = new THREE.Box3().setFromObject(state.bossEnemy.mesh);
  if (updatedEnemyBox.intersectsBox(playerBox)) {
    triggerGameOver('The boss caught you.');
    return;
  }

  if (Date.now() - state.bossEnemy.lastShot > state.bossEnemy.shootInterval) {
    state.bossEnemy.lastShot = Date.now();
    shootEnemyBullet(state.bossEnemy);
  }

  if (state.bossEnemy.life <= 0) {
    const bossDefeatPosition = state.bossEnemy.mesh.position.clone();
    state.scene.remove(state.bossEnemy.mesh);
    state.bossEnemy = null;

    if (!state.goldenGateSpawned) spawnPortal(bossDefeatPosition);
  }
}

export function updateEnemies() {
  const playerBox = new THREE.Box3().setFromObject(state.player);

  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const enemy = state.enemies[i];
    const directChaseDir = new THREE.Vector3().subVectors(state.player.position, enemy.mesh.position).normalize();
    const enemySpeed = 0.1;
    let bestVector = directChaseDir.clone().multiplyScalar(enemySpeed);

    const enemyBox = new THREE.Box3().setFromObject(enemy.mesh);
    const newEnemyBox = enemyBox.clone().translate(bestVector);
    let canMove = !checkObstaclesCollision(newEnemyBox);

    if (!canMove) {
      const alternatives = [];
      for (let angle = -Math.PI / 2; angle <= Math.PI / 2; angle += Math.PI / 12) {
        const altDir = rotateVectorY(directChaseDir, angle);
        const altVector = altDir.clone().multiplyScalar(enemySpeed);
        const altBox = enemyBox.clone().translate(altVector);
        if (!checkObstaclesCollision(altBox)) {
          const predictedPos = enemy.mesh.position.clone().add(altVector);
          const distance = predictedPos.distanceTo(state.player.position);
          alternatives.push({ vector: altVector, distance });
        }
      }
      if (alternatives.length > 0) {
        alternatives.sort((a, b) => a.distance - b.distance);
        bestVector = alternatives[0].vector;
        canMove = true;
      }
    }

    if (canMove) {
      enemy.mesh.position.add(bestVector);
    }

    const updatedEnemyBox = new THREE.Box3().setFromObject(enemy.mesh);
    if (updatedEnemyBox.intersectsBox(playerBox)) {
      triggerGameOver('An enemy caught you.');
      return;
    }

    if (Date.now() - enemy.lastShot > enemy.shootInterval) {
      enemy.lastShot = Date.now();
      shootEnemyBullet(enemy);
    }
  }

  // Spawn the boss once all normal enemies are defeated.
  if (state.enemies.length === 0 && !state.bossSpawned && !state.bossEnemy) {
    state.bossSpawned = true;
    const offset = 20;
    const angle = Math.random() * 2 * Math.PI;
    const bossX = state.player.position.x + offset * Math.cos(angle);
    const bossZ = state.player.position.z + offset * Math.sin(angle);
    state.bossEnemy = createBossEnemy(bossX, bossZ);
    console.log('Boss enemy spawned near the player!');
  }

  updateBossEnemy();
}
