// world.js
// Ground, trees, buildings and walls that make up the game world.

import * as THREE from 'three';
import { state } from './state.js';

function generateGrassTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#228B22';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 5000; i++) {
    const x = Math.floor(Math.random() * canvas.width);
    const y = Math.floor(Math.random() * canvas.height);
    const shade = 220 + Math.floor(Math.random() * 35);
    ctx.fillStyle = `rgb(0, ${shade}, 0)`;
    ctx.fillRect(x, y, 1, 1);
  }
  return canvas;
}

function createTree(x, z) {
  const trunkGeometry = new THREE.CylinderGeometry(0.5, 0.5, 5);
  const trunkMaterial = new THREE.MeshPhongMaterial({ color: 0x8B4513 });
  const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  trunk.position.set(x, 2.5, z);

  const foliageGeometry = new THREE.SphereGeometry(3, 10, 10);
  const foliageMaterial = new THREE.MeshPhongMaterial({ color: 0x228B22 });
  const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
  foliage.castShadow = true;
  foliage.receiveShadow = true;
  foliage.position.set(x, 6, z);

  state.scene.add(trunk);
  state.scene.add(foliage);

  return new THREE.Box3().setFromObject(trunk);
}

function clamp255(value) {
  return Math.min(255, Math.max(0, value));
}

// Generates a seamless facade tile: a wall-colored panel with a framed,
// sky-reflecting window. Tiled across each building it reads as a window grid.
function generateBuildingTexture(baseColor) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const r = (baseColor >> 16) & 0xff;
  const g = (baseColor >> 8) & 0xff;
  const b = baseColor & 0xff;

  // Wall background.
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, size, size);

  // Subtle per-pixel noise for a concrete/brick texture feel.
  for (let i = 0; i < 900; i++) {
    const nx = Math.floor(Math.random() * size);
    const ny = Math.floor(Math.random() * size);
    const v = Math.floor(Math.random() * 24) - 12;
    ctx.fillStyle = `rgba(${clamp255(r + v)}, ${clamp255(g + v)}, ${clamp255(b + v)}, 0.6)`;
    ctx.fillRect(nx, ny, 1, 1);
  }

  // Horizontal floor separation lines (drawn at tile edges so they stay seamless).
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(size, 0);
  ctx.moveTo(0, size - 1);
  ctx.lineTo(size, size - 1);
  ctx.stroke();

  // Window frame (dark trim).
  const margin = 22;
  const wx = margin;
  const wy = margin;
  const ww = size - margin * 2;
  const wh = size - margin * 2;
  ctx.fillStyle = '#2f2f2f';
  ctx.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);

  // Glass with a vertical sky-reflection gradient.
  const glass = ctx.createLinearGradient(0, wy, 0, wy + wh);
  glass.addColorStop(0, '#bfe6f7');
  glass.addColorStop(0.45, '#7cb9d8');
  glass.addColorStop(0.55, '#5b93b5');
  glass.addColorStop(1, '#35607f');
  ctx.fillStyle = glass;
  ctx.fillRect(wx, wy, ww, wh);

  // Diagonal reflection streaks.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(wx + ww * 0.15, wy + wh);
  ctx.lineTo(wx + ww * 0.5, wy);
  ctx.moveTo(wx + ww * 0.6, wy + wh);
  ctx.lineTo(wx + ww * 0.85, wy);
  ctx.stroke();

  // Window crossbars (mullions).
  ctx.strokeStyle = '#2f2f2f';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(wx + ww / 2, wy);
  ctx.lineTo(wx + ww / 2, wy + wh);
  ctx.moveTo(wx, wy + wh / 2);
  ctx.lineTo(wx + ww, wy + wh / 2);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createBuilding(x, z, width, height, depth) {
  const buildingColors = [
    0x808080, 0xa0a0a0, 0xc0c0c0, 0xdcdcdc, 0xaaaaaa, 0xffffff,
    0x7f3300, 0x993d00, 0x5c3c1e, 0x4a2c2a,
    0x1f3c88, 0x2a4d69, 0x556b2f, 0x228b22, 0xb22222,
  ];
  const baseColor = buildingColors[Math.floor(Math.random() * buildingColors.length)];

  // One window tile roughly every 5 world units, scaled to the building's size.
  const facadeTexture = generateBuildingTexture(baseColor);
  facadeTexture.repeat.set(
    Math.max(1, Math.round(width / 5)),
    Math.max(1, Math.round(height / 5))
  );

  const group = new THREE.Group();

  // Main body with the baked-in window-grid texture.
  const baseGeometry = new THREE.BoxGeometry(width, height, depth);
  const baseMaterial = new THREE.MeshPhongMaterial({ map: facadeTexture, shininess: 10 });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.castShadow = true;
  base.receiveShadow = true;
  base.position.set(x, height / 2, z);
  group.add(base);

  // Flat roof cap (parapet) that covers the top face.
  const roofGeometry = new THREE.BoxGeometry(width + 1.5, 1.5, depth + 1.5);
  const roofMaterial = new THREE.MeshPhongMaterial({ color: 0x777777, shininess: 10 });
  const roof = new THREE.Mesh(roofGeometry, roofMaterial);
  roof.castShadow = true;
  roof.receiveShadow = true;
  roof.position.set(x, height + 0.75, z);
  group.add(roof);

  state.scene.add(group);

  return new THREE.Box3().setFromObject(group);
}

function createWall(x, z, width, height, depth) {
  const wallGeometry = new THREE.BoxGeometry(width, height, depth);
  const wallMaterial = new THREE.MeshPhongMaterial({ color: 0xaaaaaa });
  const wall = new THREE.Mesh(wallGeometry, wallMaterial);
  wall.castShadow = true;
  wall.receiveShadow = true;
  wall.position.set(x, height / 2, z);
  state.scene.add(wall);

  return new THREE.Box3().setFromObject(wall);
}

export function initWorld() {
  const groundSize = state.groundSize;

  // Ground with procedural grass texture.
  const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
  const grassTextureCanvas = generateGrassTexture();
  const grassTexture = new THREE.CanvasTexture(grassTextureCanvas);
  grassTexture.wrapS = THREE.RepeatWrapping;
  grassTexture.wrapT = THREE.RepeatWrapping;
  grassTexture.repeat.set(groundSize / 50, groundSize / 50);

  const groundMaterial = new THREE.MeshPhongMaterial({ map: grassTexture, side: THREE.DoubleSide });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  state.scene.add(ground);

  // Trees.
  for (let i = 0; i < 600; i++) {
    const x = Math.random() * groundSize - groundSize / 2;
    const z = Math.random() * groundSize - groundSize / 2;
    state.treeBoxes.push(createTree(x, z));
  }

  // Buildings.
  for (let i = 0; i < 100; i++) {
    const x = Math.random() * groundSize - groundSize / 2;
    const z = Math.random() * groundSize - groundSize / 2;
    const width = Math.random() * 40 + 10;
    const height = Math.random() * 180 + 20;
    const depth = Math.random() * 40 + 10;
    state.buildingBoxes.push(createBuilding(x, z, width, height, depth));
  }

  // Walls.
  for (let i = 0; i < 300; i++) {
    const x = Math.random() * groundSize - groundSize / 2;
    const z = Math.random() * groundSize - groundSize / 2;
    const width = Math.random() * 20 + 10;
    const height = Math.random() * 3 + 2;
    const depth = Math.random() * 2 + 1;
    state.wallBoxes.push(createWall(x, z, width, height, depth));
  }
}
