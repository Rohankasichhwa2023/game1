// pickups.js
// Gun pickups, lifelines (hearts), and gold coins.

import * as THREE from 'three';
import { state } from './state.js';
import { triggerGameOver } from './ui.js';

const gunPickups = [];
const lifelines = [];
const goldCoins = [];

// ---------------- Guns ----------------
function createTextSprite(message) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = 256;
  canvas.height = 128;
  context.fillStyle = 'white';
  context.font = '40px Arial';
  context.textAlign = 'center';
  context.fillText(message, canvas.width / 2, 80);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3, 3, 3);
  return sprite;
}

function createGunPickup(gunType) {
  const group = new THREE.Group();

  const bodyGeometry = new THREE.BoxGeometry(1, 0.3, 0.2);
  let bodyMaterial;
  if (gunType === 'rifle') {
    bodyMaterial = new THREE.MeshPhongMaterial({ color: 0x0000ff });
  } else if (gunType === 'shotgun') {
    bodyMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
  }
  const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
  group.add(bodyMesh);

  const barrelGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.8, 8);
  const barrelMaterial = new THREE.MeshPhongMaterial({ color: 0x333333 });
  const barrelMesh = new THREE.Mesh(barrelGeometry, barrelMaterial);
  barrelMesh.rotation.z = Math.PI / 2;
  barrelMesh.position.set(0.6, 0, 0);
  group.add(barrelMesh);

  const textSprite = createTextSprite(gunType.charAt(0).toUpperCase() + gunType.slice(1));
  textSprite.position.set(0, 0.5, 0);
  group.add(textSprite);

  group.userData.gunType = gunType;
  group.scale.set(0.5, 0.5, 0.5);
  return group;
}

function scatterGunPickups() {
  const rifle = createGunPickup('rifle');
  let distance = 100 + Math.random() * 100;
  let angle = Math.random() * 2 * Math.PI;
  let x = state.player.position.x + distance * Math.cos(angle);
  let z = state.player.position.z + distance * Math.sin(angle);
  rifle.position.set(x, 0.5, z);
  state.scene.add(rifle);
  gunPickups.push(rifle);

  const shotgun = createGunPickup('shotgun');
  distance = 200 + Math.random() * 200;
  angle = Math.random() * 2 * Math.PI;
  x = state.player.position.x + distance * Math.cos(angle);
  z = state.player.position.z + distance * Math.sin(angle);
  shotgun.position.set(x, 0.5, z);
  state.scene.add(shotgun);
  gunPickups.push(shotgun);
}

export function updateGunPickups() {
  const gunPowerText = document.getElementById('gunPowerDisplay');
  for (let i = gunPickups.length - 1; i >= 0; i--) {
    const gunMesh = gunPickups[i];
    if (state.player.position.distanceTo(gunMesh.position) < 2) {
      const newGunType = gunMesh.userData.gunType;
      if (newGunType === 'rifle') {
        state.currentGun = { name: 'rifle', damage: 2 };
        if (gunPowerText) gunPowerText.textContent = ' Rifle Damage: 2';
      } else if (newGunType === 'shotgun') {
        state.currentGun = { name: 'shotgun', damage: 5 };
        if (gunPowerText) gunPowerText.textContent = 'ShotGun Damage: 5';
      }
      console.log('Picked up ' + state.currentGun.name);
      state.scene.remove(gunMesh);
      gunPickups.splice(i, 1);
    }
  }
}

// ---------------- Lifelines (hearts) ----------------
function createSmallHeartGeometry() {
  const x = 0, y = 0;
  const heartShape = new THREE.Shape();
  heartShape.moveTo(x + 5, y + 5);
  heartShape.bezierCurveTo(x + 5, y + 5, x + 4, y, x, y);
  heartShape.bezierCurveTo(x - 6, y, x - 6, y + 7, x - 6, y + 7);
  heartShape.bezierCurveTo(x - 6, y + 11, x - 3, y + 15.4, x + 5, y + 19);
  heartShape.bezierCurveTo(x + 12, y + 15.4, x + 16, y + 11, x + 16, y + 7);
  heartShape.bezierCurveTo(x + 16, y + 7, x + 16, y, x + 10, y);
  heartShape.bezierCurveTo(x + 7, y, x + 5, y + 5, x + 5, y + 5);

  const extrudeSettings = {
    depth: 2,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 2,
    bevelSize: 1,
    bevelThickness: 1,
  };
  const geometry = new THREE.ExtrudeGeometry(heartShape, extrudeSettings);
  geometry.center();
  geometry.scale(0.03, 0.03, 0.03);
  return geometry;
}

const smallHeartGeometry = createSmallHeartGeometry();
const heartMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 });

function createHeartLifeline(distanceMin, distanceMax) {
  const distance = distanceMin + Math.random() * (distanceMax - distanceMin);
  const angle = Math.random() * 2 * Math.PI;
  const x = state.player.position.x + distance * Math.cos(angle);
  const z = state.player.position.z + distance * Math.sin(angle);
  const heartMesh = new THREE.Mesh(smallHeartGeometry, heartMaterial);
  heartMesh.rotation.z = Math.PI;
  heartMesh.position.set(x, 1, z);
  state.scene.add(heartMesh);
  lifelines.push(heartMesh);
}

export function updateLifelines() {
  for (let i = lifelines.length - 1; i >= 0; i--) {
    const heart = lifelines[i];
    if (state.player.position.distanceTo(heart.position) < 3) {
      state.playerLife += 2;
      state.lifeDisplay.textContent = `Life: ${state.playerLife}`;
      state.scene.remove(heart);
      lifelines.splice(i, 1);
    }
  }
}

// ---------------- Gold coins ----------------
const goldCoinGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 32);
const goldCoinMaterial = new THREE.MeshPhongMaterial({ color: 0xffd700 });

function createGoldCoin(minDistance, maxDistance) {
  const distance = minDistance + Math.random() * (maxDistance - minDistance);
  const angle = Math.random() * 2 * Math.PI;
  const x = state.player.position.x + distance * Math.cos(angle);
  const z = state.player.position.z + distance * Math.sin(angle);
  const coinMesh = new THREE.Mesh(goldCoinGeometry, goldCoinMaterial);
  coinMesh.rotation.x = Math.PI / 2;
  coinMesh.position.set(x, 0.5, z);
  state.scene.add(coinMesh);
  goldCoins.push(coinMesh);
}

export function updateGoldCoins() {
  for (let i = goldCoins.length - 1; i >= 0; i--) {
    const coin = goldCoins[i];
    if (state.player.position.distanceTo(coin.position) < 2) {
      state.goldCount++;
      state.goldDisplay.textContent = `Gold: ${state.goldCount}/5`;
      state.scene.remove(coin);
      goldCoins.splice(i, 1);

      if (state.goldCount >= 5) {
        triggerGameOver('You win! You collected all gold coins.');
      }
    }
  }
}

// ---------------- Initialization ----------------
export function initPickups() {
  scatterGunPickups();

  createHeartLifeline(50, 100);
  createHeartLifeline(100, 150);
  createHeartLifeline(150, 200);

  for (let i = 0; i < 5; i++) {
    createGoldCoin(250, 400);
  }
}
