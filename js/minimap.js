// minimap.js
// Circular minimap canvas and its per-frame update.

import * as THREE from 'three';
import { state } from './state.js';
import { gunPickups, lifelines, goldCoins } from './pickups.js';

const minimapWorldSize = 300; // World units shown in minimap (diameter)
const entityScale = 2;        // Multiplier to draw entities larger on minimap

const minimapCanvas = document.createElement('canvas');
minimapCanvas.width = 150;
minimapCanvas.height = 150;
minimapCanvas.id = 'minimap';
const minimapContext = minimapCanvas.getContext('2d');

const minimapScale = minimapCanvas.width / minimapWorldSize;
const halfWidth = minimapCanvas.width / 2;
const halfHeight = minimapCanvas.height / 2;
const centerVec = new THREE.Vector3(); // reused to avoid per-frame allocations

export function initMinimap() {
  document.body.appendChild(minimapCanvas);
}

export function updateMinimap() {
  minimapContext.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);

  minimapContext.save();
  minimapContext.beginPath();
  minimapContext.arc(halfWidth, halfHeight, halfWidth, 0, Math.PI * 2);
  minimapContext.closePath();
  minimapContext.clip();

  minimapContext.fillStyle = '#4a4f55';
  minimapContext.fillRect(0, 0, minimapCanvas.width, minimapCanvas.height);

  const px = state.player.position.x;
  const pz = state.player.position.z;

  // Roads (dark) drawn first so the street network shows through.
  minimapContext.fillStyle = '#22262b';
  for (const road of state.roads) {
    const w = (road.maxX - road.minX) * minimapScale;
    const h = (road.maxZ - road.minZ) * minimapScale;
    const cx = (road.minX + road.maxX) / 2;
    const cz = (road.minZ + road.maxZ) / 2;
    const x = halfWidth + (cx - px) * minimapScale;
    const y = halfHeight - (cz - pz) * minimapScale;
    minimapContext.fillRect(x - w / 2, y - h / 2, w, h);
  }

  // Trees as green circles.
  minimapContext.fillStyle = '#008000';
  for (const treeBox of state.treeBoxes) {
    treeBox.getCenter(centerVec);
    const x = halfWidth + (centerVec.x - px) * minimapScale;
    const y = halfHeight - (centerVec.z - pz) * minimapScale;
    minimapContext.beginPath();
    minimapContext.arc(x, y, 2 * entityScale, 0, 2 * Math.PI);
    minimapContext.fill();
  }

  // Buildings as light grey rectangles.
  minimapContext.fillStyle = '#999';
  for (const buildingBox of state.buildingBoxes) {
    const width = (buildingBox.max.x - buildingBox.min.x) * minimapScale * entityScale;
    const height = (buildingBox.max.z - buildingBox.min.z) * minimapScale * entityScale;
    const cx = (buildingBox.min.x + buildingBox.max.x) / 2;
    const cz = (buildingBox.min.z + buildingBox.max.z) / 2;
    const x = halfWidth + (cx - px) * minimapScale;
    const y = halfHeight - (cz - pz) * minimapScale;
    minimapContext.fillRect(x - width / 2, y - height / 2, width, height);
  }

  // Walls as darker grey rectangles.
  minimapContext.fillStyle = '#666';
  for (const wallBox of state.wallBoxes) {
    const width = (wallBox.max.x - wallBox.min.x) * minimapScale * entityScale;
    const height = (wallBox.max.z - wallBox.min.z) * minimapScale * entityScale;
    const cx = (wallBox.min.x + wallBox.max.x) / 2;
    const cz = (wallBox.min.z + wallBox.max.z) / 2;
    const x = halfWidth + (cx - px) * minimapScale;
    const y = halfHeight - (cz - pz) * minimapScale;
    minimapContext.fillRect(x - width / 2, y - height / 2, width, height);
  }

  // Pickups as symbols (so the player can tell them apart).
  minimapContext.font = '11px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  minimapContext.textAlign = 'center';
  minimapContext.textBaseline = 'middle';

  // Guns 🔫.
  for (const gun of gunPickups) {
    const x = halfWidth + (gun.position.x - px) * minimapScale;
    const y = halfHeight - (gun.position.z - pz) * minimapScale;
    minimapContext.fillText('🔫', x, y);
  }

  // Lifelines ❤️.
  for (const heart of lifelines) {
    const x = halfWidth + (heart.position.x - px) * minimapScale;
    const y = halfHeight - (heart.position.z - pz) * minimapScale;
    minimapContext.fillText('❤️', x, y);
  }

  // Gold coins 🪙.
  for (const coin of goldCoins) {
    const x = halfWidth + (coin.position.x - px) * minimapScale;
    const y = halfHeight - (coin.position.z - pz) * minimapScale;
    minimapContext.fillText('🪙', x, y);
  }

  // Enemies as red circles.
  minimapContext.fillStyle = '#ff0000';
  for (const enemy of state.enemies) {
    const x = halfWidth + (enemy.mesh.position.x - px) * minimapScale;
    const y = halfHeight - (enemy.mesh.position.z - pz) * minimapScale;
    minimapContext.beginPath();
    minimapContext.arc(x, y, 3 * entityScale, 0, 2 * Math.PI);
    minimapContext.fill();
  }

  // Player as a golden circle (always centered).
  minimapContext.fillStyle = '#FFD700';
  minimapContext.beginPath();
  minimapContext.arc(halfWidth, halfHeight, 4 * entityScale, 0, 2 * Math.PI);
  minimapContext.fill();

  minimapContext.restore();
}
