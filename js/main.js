// main.js
// Entry point: wires up all modules, bootstraps the world, and runs the game loop.

import {
  state,
  updateGoldHud,
  isPlayerIndoors,
  setNightMode,
} from "./state.js";
import {
  initWorld,
  findPlayerSpawnPosition,
  updateEnvironment,
} from "./world.js";
import { initEnemies, updateEnemies } from "./enemies.js";
import {
  initPlayer,
  updateMovement,
  updateCamera,
  initCar,
  updateCar,
} from "./player.js";
import { initNpcs, updateNpcs } from "./npc.js";
import { updateBullets, updateEnemyBullets } from "./bullets.js";
import {
  initPickups,
  updateLifelines,
  updateGoldCoins,
  updateGunPickups,
} from "./pickups.js";
import { updatePortalCollision, animatePortal } from "./portal.js";
import { initMinimap, updateMinimap } from "./minimap.js";
import { initUI } from "./ui.js";
import { initPause } from "./pause.js";

// Hide the instructions overlay when clicked.
document.addEventListener("DOMContentLoaded", () => {
  const overlay = document.getElementById("instructionsOverlay");
  overlay.addEventListener("click", () => {
    overlay.style.display = "none";
    state.started = true;
  });
});

// Bootstrap (order matters: world first, then the player's spawn position so
// enemies can keep their distance from it, then everything else).
initWorld();

// Place the player at the fixed neighbourhood spawn (guaranteed clear of
// buildings, trees, walls, roads, and building interiors) BEFORE enemies are
// created. Logged so the spot is easy to sanity-check in the console.
const spawn = findPlayerSpawnPosition();
state.player.position.set(spawn.x, 1, spawn.z);
console.log(
  `Player spawn: (${spawn.x.toFixed(1)}, ${spawn.z.toFixed(1)}) — dist ${Math.hypot(spawn.x, spawn.z).toFixed(0)} from center`,
);

initEnemies();
initNpcs();

initPlayer();
initCar();
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
    if (state.inCar) {
      updateCar(dt);
    } else {
      updateMovement(dt);
    }
    state.playerIndoors = isPlayerIndoors();
    updateBullets(dt);
    updateEnemyBullets(dt);
    updateEnemies(dt);
    updateLifelines();
    updateGoldCoins();
    updateGunPickups();
    updatePortalCollision();
    animatePortal(dt);
    updateNpcs(dt);
    updateEnvironment(dt);
    updateMinimap();
    updateCamera();
  }
  state.renderer.render(state.scene, state.camera);
}
animate(performance.now());

// ---------------- Resize Handling ----------------
window.addEventListener("resize", () => {
  state.camera.aspect = window.innerWidth / window.innerHeight;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------- Debug Shortcuts ----------------
document.addEventListener("keydown", (event) => {
  if (event.key === "t" || event.key === "T") {
    state.goldCount = 5;
    updateGoldHud();
    console.log("Debug: goldCount set to 5");
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "y" || event.key === "Y") {
    if (state.bossEnemy) {
      state.bossEnemy.life = 0;
      console.log("Debug: Boss enemy defeated");
    } else {
      console.log("Debug: No boss enemy present.");
    }
  }
});

// Night mode toggle.
document.addEventListener("keydown", (event) => {
  if (event.key === "n" || event.key === "N") {
    setNightMode(!state.nightMode);
  }
});
