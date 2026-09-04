// terrain.js
// Deterministic PRNG, the hilly terrain heightmap, and the ground mesh.

import * as THREE from "three";
import { state } from "./state.js";
import { addFrozenStatic } from "./placement.js";

// Deterministic PRNG (mulberry32) so the same seed always produces the same world.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------- Hilly terrain ----------------
// The city stays perfectly flat inside CITY_RADIUS so buildings, walls and
// roads line up. Past R_FLAT the terrain rises into a ring of hills, and the
// circular ring-road highway runs around the whole world on top of them.

export const CITY_RADIUS = 370; // city content is confined within this radius
export const R_FLAT = 380; // terrain is flat up to this radius
export const R_EDGE = 492; // terrain envelope completes at this radius
export const RING_INNER = 440; // ring-road inner radius
export const RING_OUTER = 476; // ring-road outer radius

const hills = [];
(function buildHills() {
  const rand = mulberry32(0x5eed1234);
  for (let i = 0; i < 16; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = 400 + rand() * 88; // 400..488
    hills.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      r: 110 + rand() * 80, // 110..190
      h: 14 + rand() * 22, // 14..36
    });
  }
})();

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Ground surface height (Y) at world coordinates (x, z). Flat inside the city,
// smooth hills + a gentle ring undulation around the outside.
export function getGroundHeight(x, z) {
  const r = Math.hypot(x, z);
  if (r <= R_FLAT) return 0;

  const theta = Math.atan2(z, x);
  let h = 0;
  for (const hill of hills) {
    const d = Math.hypot(x - hill.x, z - hill.z) / hill.r;
    if (d < 1) h += hill.h * 0.5 * (1 + Math.cos(Math.PI * d));
  }
  // Rolling undulation along the ring so the highway visibly climbs/descends.
  h += 14 * Math.sin(theta * 3 + 1.7) + 7 * Math.sin(theta * 5 + 0.4);

  return h * smoothstep(R_FLAT, R_EDGE, r);
}

// ---------------- Ground texture ----------------
function generateGrassTexture() {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#3f7a2e";
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 220; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 40 + Math.random() * 160;
    const light = Math.random();
    const rgb = light > 0.5 ? "90, 170, 65" : "40, 90, 30";
    const alpha = 0.04 + Math.random() * 0.08;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${rgb}, ${alpha})`);
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 40000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const bladeW = 1 + Math.random() * 1.5;
    const bladeH = 2 + Math.random() * 4;
    const green = 85 + Math.floor(Math.random() * 75);
    const red = 35 + Math.floor(Math.random() * 30);
    const blue = 25 + Math.floor(Math.random() * 25);
    ctx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
    ctx.fillRect(x, y, bladeW, bladeH);
  }

  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = `rgba(60, 45, 25, ${0.1 + Math.random() * 0.25})`;
    ctx.fillRect(x, y, 1, 1);
  }

  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = `rgba(200, 220, 120, ${0.05 + Math.random() * 0.1})`;
    ctx.fillRect(x, y, 1, 1);
  }

  return canvas;
}

// Builds the displaced ground plane: flat in the city center, rising into a
// hilly ring toward the map edge.
export function createGroundMesh(groundSize) {
  const groundGeometry = new THREE.PlaneGeometry(
    groundSize,
    groundSize,
    240,
    240,
  );
  const grassTextureCanvas = generateGrassTexture();
  const grassTexture = new THREE.CanvasTexture(grassTextureCanvas);
  grassTexture.wrapS = THREE.RepeatWrapping;
  grassTexture.wrapT = THREE.RepeatWrapping;
  grassTexture.repeat.set(groundSize / 5, groundSize / 5);
  grassTexture.colorSpace = THREE.SRGBColorSpace;
  grassTexture.anisotropy = Math.min(
    16,
    state.renderer.capabilities.getMaxAnisotropy(),
  );

  const groundMaterial = new THREE.MeshPhongMaterial({
    map: grassTexture,
    side: THREE.DoubleSide,
  });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;

  // Displace the terrain: flat in the city center, rising into a hilly ring.
  const pos = groundGeometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const ly = pos.getY(i);
    pos.setZ(i, getGroundHeight(lx, -ly));
  }
  pos.needsUpdate = true;
  groundGeometry.computeVertexNormals();

  addFrozenStatic(ground);
  return ground;
}
