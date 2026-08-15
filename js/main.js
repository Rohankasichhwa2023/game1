// main.js
// Entry point: wires up all modules, bootstraps the world, and runs the game loop.

import { state, updateGoldHud, isPlayerIndoors } from './state.js';
import { initWorld, findClearSpawnPosition, updateDoors } from './world.js';
import { initEnemies, updateEnemies } from './enemies.js';
import { initPlayer, updateMovement, updateCamera } from './player.js';
import { updateBullets, updateEnemyBullets } from './bullets.js';
import { initPickups, updateLifelines, updateGoldCoins, updateGunPickups } from './pickups.js';
import { updatePortalCollision, animatePortal } from './portal.js';
import { initMinimap, updateMinimap } from './minimap.js';
import { initUI } from './ui.js';
import { initPause } from './pause.js';

// Hide the instructions overlay when clicked.
document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('instructionsOverlay');
  overlay.addEventListener('click', () => {
    overlay.style.display = 'none';
    state.started = true;
  });
});

// Bootstrap (order matters: world and enemies first, then things that use the player).
initWorld();
initEnemies();

// Place the player on clear ground so they never spawn inside a building/tree/wall.
const spawn = findClearSpawnPosition();
state.player.position.set(spawn.x, 1, spawn.z);

initPlayer();
initPickups();
initUI();
initMinimap();
initPause();

// ---------------- Animation Loop ----------------
let lastTime = performance.now();

function animate(now) {
  requestAnimationFrame(animate);

  // Frame-normalized delta (1.0 = one 60fps frame), clamped so a hitch or tab
  // switch can't cause a huge physics jump.
  const dt = Math.min((now - lastTime) / 1000, 0.05) * 60;
  lastTime = now;

  if (state.started && !state.paused) {
    updateMovement(dt);
    state.playerIndoors = isPlayerIndoors();
    updateDoors();
    updateBullets(dt);
    updateEnemyBullets(dt);
    updateEnemies(dt);
    updateLifelines();
    updateGoldCoins();
    updateGunPickups();
    updatePortalCollision();
    animatePortal(dt);
    updateMinimap();
    updateCamera();
  }
  state.renderer.render(state.scene, state.camera);
}
animate(performance.now());

// ---------------- Resize Handling ----------------
window.addEventListener('resize', () => {
  state.camera.aspect = window.innerWidth / window.innerHeight;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------- Debug Shortcuts ----------------
document.addEventListener('keydown', (event) => {
  if (event.key === 't' || event.key === 'T') {
    state.goldCount = 5;
    updateGoldHud();
    console.log('Debug: goldCount set to 5');
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'y' || event.key === 'Y') {
    if (state.bossEnemy) {
      state.bossEnemy.life = 0;
      console.log('Debug: Boss enemy defeated');
    } else {
      console.log('Debug: No boss enemy present.');
    }
  }
});
