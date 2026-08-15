// ui.js
// DOM-based UI: crosshair and the game-over overlay.

import { state } from './state.js';

export function initUI() {
  const pointer = document.createElement('div');
  pointer.id = 'crosshair';

  const cross = document.createElement('div');
  cross.className = 'line line--a';

  const cross2 = document.createElement('div');
  cross2.className = 'line line--b';

  pointer.appendChild(cross);
  pointer.appendChild(cross2);
  document.body.appendChild(pointer);
}

export function triggerGameOver(message) {
  if (state.gameOver) return;
  state.gameOver = true;

  const overlay = document.createElement('div');
  overlay.className = 'game-over-overlay';
  overlay.textContent = `Game Over! ${message}`;
  document.body.appendChild(overlay);

  setTimeout(() => window.location.reload(), 3000);
}
