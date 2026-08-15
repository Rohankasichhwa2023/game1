// main.js
// Entry point: wires up all modules, bootstraps the world, and runs the game loop.

import { state } from './state.js';
import { initWorld } from './world.js';
import { initEnemies, updateEnemies } from './enemies.js';
import { initPlayer, updateMovement } from './player.js';
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
initPlayer();
initPickups();
initUI();
initMinimap();
initPause();

// ---------------- Animation Loop ----------------
function animate() {
  requestAnimationFrame(animate);
  if (state.started && !state.paused) {
    updateMovement();
    updateBullets();
    updateEnemyBullets();
    updateEnemies();
    updateLifelines();
    updateGoldCoins();
    updateGunPickups();
    updatePortalCollision();
    animatePortal();
    updateMinimap();
  }
  state.renderer.render(state.scene, state.camera);
}
animate();

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
    state.goldDisplay.textContent = `Gold: ${state.goldCount}/5`;
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
