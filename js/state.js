// state.js
// Core THREE bootstrap and the single shared mutable game state object.
// Every module imports `state` from here so they can read/write the same values.

import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { createHumanFigure } from "./character.js";

// ---------------- Scene, Camera, Renderer ----------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // Light blue sky

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  3000,
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// ---------------- Player ----------------
const player = createHumanFigure({
  shirtColor: 0xe53935,
  pantsColor: 0x2f3b4c,
  skinColor: 0xf1c27d,
});
player.position.y = 1;
scene.add(player);

// ---------------- Sun & Ambient Light ----------------
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.position.set(100, 200, 100);
sun.castShadow = true;
sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 500;
scene.add(sun);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

// ---------------- Controls ----------------
export const controls = new PointerLockControls(camera, document.body);
// Re-lock the pointer on click only while the game is running (not paused).
document.addEventListener("click", () => {
  if (!state.paused) controls.lock();
});

// ---------------- HUD: Life & Gold Displays ----------------
const lifeDisplay = document.createElement("div");
lifeDisplay.id = "lifeDisplay";
lifeDisplay.className = "hud-pill";
lifeDisplay.innerHTML = `
  <span class="hud-icon">❤️</span>
  <div class="hud-bar"><div class="hud-bar-fill" id="lifeBarFill"></div></div>
  <span class="hud-value" id="lifeValue">10</span>
`;
document.body.appendChild(lifeDisplay);
const lifeBarFill = lifeDisplay.querySelector("#lifeBarFill");
const lifeValue = lifeDisplay.querySelector("#lifeValue");

const goldDisplay = document.createElement("div");
goldDisplay.id = "goldDisplay";
goldDisplay.className = "hud-pill";
goldDisplay.innerHTML = `
  <span class="hud-icon">🪙</span>
  <span class="hud-value" id="goldValue">0<span class="hud-value-dim">/5</span></span>
`;
document.body.appendChild(goldDisplay);
const goldValue = goldDisplay.querySelector("#goldValue");

// ---------------- Shared game state ----------------
export const state = {
  // Core THREE objects.
  scene,
  camera,
  renderer,
  player,

  // HUD elements.
  lifeDisplay,
  goldDisplay,

  // Mutable player stats.
  playerLife: 10,
  goldCount: 0,

  // Currently equipped gun.
  currentGun: { name: "default", damage: 1 },

  // Collision boxes for the static world.
  treeBoxes: [],
  buildingBoxes: [],
  wallBoxes: [],

  // Road rectangles (for the minimap) — { minX, maxX, minZ, maxZ }.
  roads: [],

  // Ring-road highway around the world — { inner, outer } radii.
  ringRoad: null,

  // Enterable building interiors (safe zones) + whether the player is inside.
  buildingInteriors: [],
  playerIndoors: false,

  // Drivable car.
  car: null,
  inCar: false,

  // Dynamic entities.
  enemies: [],
  bullets: [],
  gameOver: false,

  // Flow-control flags.
  started: false,
  paused: false,

  // Camera mode: false = first person, true = third person (default).
  thirdPerson: true,

  // Boss / portal lifecycle flags.
  bossSpawned: false,
  bossEnemy: null,
  goldenGateSpawned: false,
  goldenGateDoor: null,

  // Shared constant.
  groundSize: 1000,
};

// ---------------- HUD update helpers ----------------
export function isPlayerIndoors() {
  const p = state.player.position;
  for (const b of state.buildingInteriors) {
    if (
      p.x >= b.minX &&
      p.x <= b.maxX &&
      p.z >= b.minZ &&
      p.z <= b.maxZ &&
      p.y >= b.minY &&
      p.y <= b.maxY
    ) {
      return true;
    }
  }
  return false;
}

export function updateLifeHud() {
  const life = state.playerLife;
  lifeValue.textContent = life;
  const pct = Math.min(100, Math.max(0, (life / 10) * 100));
  lifeBarFill.style.width = `${pct}%`;
  if (pct <= 25) lifeBarFill.style.background = "#e74c3c";
  else if (pct <= 50) lifeBarFill.style.background = "#f1c40f";
  else
    lifeBarFill.style.background = "linear-gradient(90deg, #2ecc71, #7bed9f)";
}

export function updateGoldHud() {
  goldValue.innerHTML = `${state.goldCount}<span class="hud-value-dim">/5</span>`;
}

// Initialize the HUD to the starting values.
updateLifeHud();
updateGoldHud();
