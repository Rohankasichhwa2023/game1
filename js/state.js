// state.js
// Core THREE bootstrap and the single shared mutable game state object.
// Every module imports `state` from here so they can read/write the same values.

import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

// ---------------- Scene, Camera, Renderer ----------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Light blue sky

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 3000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// ---------------- Player ----------------
const playerGeometry = new THREE.BoxGeometry(1, 2, 1);
const playerMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 });
const player = new THREE.Mesh(playerGeometry, playerMaterial);
player.castShadow = true;
player.receiveShadow = true;
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
document.addEventListener('click', () => {
  if (!state.paused) controls.lock();
});

// ---------------- HUD: Life & Gold Displays ----------------
const lifeDisplay = document.createElement('div');
lifeDisplay.id = 'lifeDisplay';
lifeDisplay.textContent = 'Life: 10';
document.body.appendChild(lifeDisplay);

const goldDisplay = document.createElement('div');
goldDisplay.id = 'goldDisplay';
goldDisplay.textContent = 'Gold: 0/5';
document.body.appendChild(goldDisplay);

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
  currentGun: { name: 'default', damage: 1 },

  // Collision boxes for the static world.
  treeBoxes: [],
  buildingBoxes: [],
  wallBoxes: [],

  // Dynamic entities.
  enemies: [],
  bullets: [],
  gameOver: false,

  // Flow-control flags.
  started: false,
  paused: false,

  // Boss / portal lifecycle flags.
  bossSpawned: false,
  bossEnemy: null,
  goldenGateSpawned: false,
  goldenGateDoor: null,

  // Shared constant.
  groundSize: 1000,
};
