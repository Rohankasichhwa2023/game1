// enemies.js
// Normal enemy and boss enemy creation, AI, and per-frame updates.

import * as THREE from "three";
import { state } from "./state.js";
import { createHumanFigure, makeBox } from "./character.js";
import { findClearSpawnPosition } from "./world.js";
import { shootEnemyBullet } from "./bullets.js";
import { triggerGameOver } from "./ui.js";
import { spawnPortal } from "./portal.js";

function createEnemy(x, z) {
  const enemyMesh = createHumanFigure({
    shirtColor: 0xe91e63,
    pantsColor: 0x263238,
    skinColor: 0xf1c27d,
  });
  enemyMesh.position.set(x, 1, z);
  state.scene.add(enemyMesh);

  return {
    mesh: enemyMesh,
    life: 5,
    lastShot: Date.now(),
    shootInterval: 2000,
    halfWidth: 0.6,
    halfHeight: 1.1,
    halfDepth: 0.6,
  };
}

function createBossEnemy(x, z) {
  const bossMesh = createHumanFigure({
    shirtColor: 0x6a1b9a,
    pantsColor: 0x1b1b2f,
    skinColor: 0x8d6e63,
    scale: 2,
  });
  bossMesh.position.set(x, 2, z);
  state.scene.add(bossMesh);

  return {
    mesh: bossMesh,
    life: 100,
    lastShot: Date.now(),
    shootInterval: 1000,
    isBoss: true,
    halfWidth: 1.2,
    halfHeight: 2.2,
    halfDepth: 1.2,
  };
}

function rotateVectorY(vector, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return new THREE.Vector3(
    vector.x * cos - vector.z * sin,
    vector.y,
    vector.x * sin + vector.z * cos,
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
    const spawn = findClearSpawnPosition();
    state.enemies.push(createEnemy(spawn.x, spawn.z));
  }
}

function updateBossEnemy(dt) {
  if (!state.bossEnemy) return;

  const playerBox = makeBox(state.player.position, 0.5, 1, 0.5);
  const enemyBox = makeBox(
    state.bossEnemy.mesh.position,
    state.bossEnemy.halfWidth,
    state.bossEnemy.halfHeight,
    state.bossEnemy.halfDepth,
  );

  const directChaseDir = new THREE.Vector3()
    .subVectors(state.player.position, state.bossEnemy.mesh.position)
    .normalize();
  const bossSpeed = 0.05;
  const moveVector = directChaseDir.clone().multiplyScalar(bossSpeed * dt);

  const enemyBoxAfterMove = enemyBox.clone().translate(moveVector);
  if (!checkObstaclesCollision(enemyBoxAfterMove)) {
    state.bossEnemy.mesh.position.add(moveVector);
  }

  // Face the player.
  state.bossEnemy.mesh.rotation.y = Math.atan2(
    directChaseDir.x,
    directChaseDir.z,
  );

  const updatedEnemyBox = makeBox(
    state.bossEnemy.mesh.position,
    state.bossEnemy.halfWidth,
    state.bossEnemy.halfHeight,
    state.bossEnemy.halfDepth,
  );
  if (updatedEnemyBox.intersectsBox(playerBox)) {
    triggerGameOver("The boss caught you.");
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

export function updateEnemies(dt) {
  const playerBox = makeBox(state.player.position, 0.5, 1, 0.5);

  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const enemy = state.enemies[i];
    const directChaseDir = new THREE.Vector3()
      .subVectors(state.player.position, enemy.mesh.position)
      .normalize();
    const enemySpeed = 0.1;
    let bestVector = directChaseDir.clone().multiplyScalar(enemySpeed * dt);

    const enemyBox = makeBox(
      enemy.mesh.position,
      enemy.halfWidth,
      enemy.halfHeight,
      enemy.halfDepth,
    );
    const newEnemyBox = enemyBox.clone().translate(bestVector);
    let canMove = !checkObstaclesCollision(newEnemyBox);

    if (!canMove) {
      const alternatives = [];
      for (
        let angle = -Math.PI / 2;
        angle <= Math.PI / 2;
        angle += Math.PI / 12
      ) {
        const altDir = rotateVectorY(directChaseDir, angle);
        const altVector = altDir.clone().multiplyScalar(enemySpeed * dt);
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

    // Face the player.
    enemy.mesh.rotation.y = Math.atan2(directChaseDir.x, directChaseDir.z);

    const updatedEnemyBox = makeBox(
      enemy.mesh.position,
      enemy.halfWidth,
      enemy.halfHeight,
      enemy.halfDepth,
    );
    if (updatedEnemyBox.intersectsBox(playerBox)) {
      triggerGameOver("An enemy caught you.");
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
    const boundary = state.groundSize / 2 - 2;
    const bossX = Math.max(
      -boundary,
      Math.min(boundary, state.player.position.x + offset * Math.cos(angle)),
    );
    const bossZ = Math.max(
      -boundary,
      Math.min(boundary, state.player.position.z + offset * Math.sin(angle)),
    );
    state.bossEnemy = createBossEnemy(bossX, bossZ);
    console.log("Boss enemy spawned near the player!");
  }

  updateBossEnemy(dt);
}
