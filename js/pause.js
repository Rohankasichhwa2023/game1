// pause.js
// Pause/resume overlay and the logic that freezes the game loop.

import { state, controls } from './state.js';

let pauseOverlay = null;
let resumeButton = null;

function buildOverlay() {
  pauseOverlay = document.createElement('div');
  pauseOverlay.id = 'pauseOverlay';
  pauseOverlay.innerHTML = `
    <div class="pause-panel">
      <h1>⏸ Paused</h1>
      <p>Take a breather — the action is frozen.</p>
      <button id="resumeButton" type="button">▶ Resume</button>
      <p class="pause-hint">or press <kbd>Esc</kbd></p>
    </div>
  `;
  document.body.appendChild(pauseOverlay);
  resumeButton = pauseOverlay.querySelector('#resumeButton');
  resumeButton.addEventListener('click', resumeGame);
}

function showOverlay() {
  pauseOverlay.style.display = 'flex';
}

function hideOverlay() {
  pauseOverlay.style.display = 'none';
}

function pauseGame() {
  state.paused = true;
  showOverlay();
  controls.unlock();
}

function resumeGame() {
  state.paused = false;
  hideOverlay();
  controls.lock();
}

export function togglePause() {
  if (state.paused) resumeGame();
  else pauseGame();
}

export function initPause() {
  buildOverlay();

  // When pointer lock is exited while playing (e.g. the browser consumes the
  // Escape key), treat it as a pause request.
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement !== null;
    if (!locked && state.started && !state.paused && !state.gameOver) {
      pauseGame();
    }
  });

  // 'p' toggles pause in both directions. Escape resumes while paused (while
  // playing, Escape is consumed by pointer lock and handled above).
  document.addEventListener('keydown', (event) => {
    if (!state.started || state.gameOver) return;

    if (event.key === 'p' || event.key === 'P') {
      togglePause();
    } else if (event.key === 'Escape' && state.paused) {
      resumeGame();
    }
  });
}
