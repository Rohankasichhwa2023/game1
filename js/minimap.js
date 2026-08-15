// minimap.js
// Circular minimap canvas and its per-frame update.

import * as THREE from 'three';
import { state } from './state.js';

const minimapWorldSize = 300; // World units shown in minimap (diameter)
const entityScale = 2;        // Multiplier to draw entities larger on minimap

const minimapCanvas = document.createElement('canvas');
minimapCanvas.width = 150;
minimapCanvas.height = 150;
minimapCanvas.id = 'minimap';
const minimapContext = minimapCanvas.getContext('2d');

function worldToMinimap(x, z) {
  const scale = minimapCanvas.width / minimapWorldSize;
  const dx = x - state.player.position.x;
  const dz = z - state.player.position.z;
  return {
    x: minimapCanvas.width / 2 + dx * scale,
    y: minimapCanvas.height / 2 - dz * scale, // Invert z to match canvas y-axis.
  };
}

export function initMinimap() {
  document.body.appendChild(minimapCanvas);
}

export function updateMinimap() {
  minimapContext.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);

  minimapContext.save();
  minimapContext.beginPath();
  minimapContext.arc(minimapCanvas.width / 2, minimapCanvas.height / 2, minimapCanvas.width / 2, 0, Math.PI * 2);
  minimapContext.closePath();
  minimapContext.clip();

  minimapContext.fillStyle = '#333';
  minimapContext.fillRect(0, 0, minimapCanvas.width, minimapCanvas.height);

  // Trees as green circles.
  minimapContext.fillStyle = '#008000';
  const centerVec = new THREE.Vector3();
  state.treeBoxes.forEach((treeBox) => {
    treeBox.getCenter(centerVec);
    const pos = worldToMinimap(centerVec.x, centerVec.z);
    minimapContext.beginPath();
    minimapContext.arc(pos.x, pos.y, 2 * entityScale, 0, 2 * Math.PI);
    minimapContext.fill();
  });

  // Buildings as light grey rectangles.
  minimapContext.fillStyle = '#999';
  state.buildingBoxes.forEach((buildingBox) => {
    const center = new THREE.Vector3();
    buildingBox.getCenter(center);
    const min = buildingBox.min;
    const max = buildingBox.max;
    const widthWorld = max.x - min.x;
    const heightWorld = max.z - min.z;
    const scale = minimapCanvas.width / minimapWorldSize;
    const width = widthWorld * scale * entityScale;
    const height = heightWorld * scale * entityScale;
    const pos = worldToMinimap(center.x, center.z);
    minimapContext.fillRect(pos.x - width / 2, pos.y - height / 2, width, height);
  });

  // Walls as darker grey rectangles.
  minimapContext.fillStyle = '#666';
  state.wallBoxes.forEach((wallBox) => {
    const center = new THREE.Vector3();
    wallBox.getCenter(center);
    const min = wallBox.min;
    const max = wallBox.max;
    const widthWorld = max.x - min.x;
    const heightWorld = max.z - min.z;
    const scale = minimapCanvas.width / minimapWorldSize;
    const width = widthWorld * scale * entityScale;
    const height = heightWorld * scale * entityScale;
    const pos = worldToMinimap(center.x, center.z);
    minimapContext.fillRect(pos.x - width / 2, pos.y - height / 2, width, height);
  });

  // Enemies as red circles.
  minimapContext.fillStyle = '#ff0000';
  state.enemies.forEach((enemy) => {
    const pos = worldToMinimap(enemy.mesh.position.x, enemy.mesh.position.z);
    minimapContext.beginPath();
    minimapContext.arc(pos.x, pos.y, 3 * entityScale, 0, 2 * Math.PI);
    minimapContext.fill();
  });

  // Player as a golden circle.
  minimapContext.fillStyle = '#FFD700';
  const playerPos = worldToMinimap(state.player.position.x, state.player.position.z);
  minimapContext.beginPath();
  minimapContext.arc(playerPos.x, playerPos.y, 4 * entityScale, 0, 2 * Math.PI);
  minimapContext.fill();

  minimapContext.restore();
}
