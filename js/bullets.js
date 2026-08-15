// bullets.js
// Bullet pooling, enemy shooting, and per-frame bullet update logic.

import * as THREE from 'three';
import { state, updateLifeHud } from './state.js';
import { makeBox } from './character.js';
import { triggerGameOver } from './ui.js';

const bulletSpeed = 1;
const bulletPool = [];
const enemyBulletPool = [];
const enemyBullets = [];

export function getBullet(color, isEnemy = false) {
  const pool = isEnemy ? enemyBulletPool : bulletPool;
  if (pool.length > 0) {
    const bullet = pool.pop();
    bullet.visible = true;
    bullet.material.color.set(color);
    return bullet;
  }

  const geometry = new THREE.SphereGeometry(0.1, 10, 10);
  const material = new THREE.MeshPhongMaterial({ color });
  const bullet = new THREE.Mesh(geometry, material);
  bullet.castShadow = true;
  return bullet;
}

function returnBullet(bullet, isEnemy = false) {
  bullet.visible = false;
  const pool = isEnemy ? enemyBulletPool : bulletPool;
  pool.push(bullet);
}

export function shootEnemyBullet(enemy) {
  const bullet = getBullet(0x0000ff, true);
  const enemyPos = enemy.mesh.position.clone();
  const playerPos = state.player.position.clone();
  const bulletDir = new THREE.Vector3().subVectors(playerPos, enemyPos).normalize();
  const bulletStart = enemyPos.clone().add(bulletDir.clone().multiplyScalar(1.1));
  bullet.position.copy(bulletStart);
  bullet.userData.direction = bulletDir.clone();

  state.scene.add(bullet);
  enemyBullets.push(bullet);
}

export function updateBullets(dt) {
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const bullet = state.bullets[i];
    bullet.position.addScaledVector(bullet.userData.direction, bulletSpeed * dt);

    const rangeThreshold = bullet.userData.isSniper ? 300 : 100;
    if (bullet.position.distanceTo(state.camera.position) > rangeThreshold) {
      state.scene.remove(bullet);
      state.bullets.splice(i, 1);
      returnBullet(bullet, false);
      continue;
    }

    for (let j = state.enemies.length - 1; j >= 0; j--) {
      const enemy = state.enemies[j];
      const enemyBox = makeBox(enemy.mesh.position, enemy.halfWidth, enemy.halfHeight, enemy.halfDepth);
      if (enemyBox.containsPoint(bullet.position)) {
        enemy.life -= state.currentGun.damage;
        state.scene.remove(bullet);
        state.bullets.splice(i, 1);
        returnBullet(bullet, false);
        if (enemy.life <= 0) {
          state.scene.remove(enemy.mesh);
          state.enemies.splice(j, 1);
        }
        break;
      }
    }
  }
}

export function updateEnemyBullets(dt) {
  const playerBox = makeBox(state.player.position, 0.5, 1, 0.5);
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    const bullet = enemyBullets[i];
    bullet.position.addScaledVector(bullet.userData.direction, bulletSpeed * dt);

    let collided = false;
    for (const treeBox of state.treeBoxes) {
      if (treeBox.containsPoint(bullet.position)) { collided = true; break; }
    }
    if (!collided) {
      for (const buildingBox of state.buildingBoxes) {
        if (buildingBox.containsPoint(bullet.position)) { collided = true; break; }
      }
    }
    if (!collided) {
      for (const wallBox of state.wallBoxes) {
        if (wallBox.containsPoint(bullet.position)) { collided = true; break; }
      }
    }
    if (collided) {
      state.scene.remove(bullet);
      enemyBullets.splice(i, 1);
      returnBullet(bullet, true);
      continue;
    }

    if (bullet.position.distanceTo(state.player.position) > 200) {
      state.scene.remove(bullet);
      enemyBullets.splice(i, 1);
      returnBullet(bullet, true);
      continue;
    }

    if (playerBox.containsPoint(bullet.position)) {
      state.playerLife -= 1;
      updateLifeHud();
      state.scene.remove(bullet);
      enemyBullets.splice(i, 1);
      returnBullet(bullet, true);
      if (state.playerLife <= 0 && !state.gameOver) {
        triggerGameOver('You were shot by an enemy.');
      }
      continue;
    }
  }
}
