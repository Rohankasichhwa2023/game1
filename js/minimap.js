// minimap.js
// Circular minimap canvas and its per-frame update.

import * as THREE from "three";
import { state } from "./state.js";
import { gunPickups, lifelines, goldCoins } from "./pickups.js";

const minimapWorldSize = 300;
const entityScale = 2;

const minimapCanvas = document.createElement("canvas");
minimapCanvas.width = 150;
minimapCanvas.height = 150;
minimapCanvas.id = "minimap";

const minimapContext = minimapCanvas.getContext("2d");

const minimapScale = minimapCanvas.width / minimapWorldSize;

const halfWidth = minimapCanvas.width / 2;
const halfHeight = minimapCanvas.height / 2;

const centerVec = new THREE.Vector3();

export function initMinimap() {
  document.body.appendChild(minimapCanvas);

  minimapCanvas.style.width = "150px";
  minimapCanvas.style.height = "150px";
  minimapCanvas.style.borderRadius = "50%";
  minimapCanvas.style.display = "block";
}

export function updateMinimap() {
  minimapContext.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);

  // ============================================================
  // MINIMAP CIRCLE
  // ============================================================

  minimapContext.save();

  minimapContext.beginPath();

  minimapContext.arc(halfWidth, halfHeight, halfWidth, 0, Math.PI * 2);

  minimapContext.closePath();
  minimapContext.clip();

  // ============================================================
  // BACKGROUND
  // ============================================================

  minimapContext.fillStyle = "#4a4f55";

  minimapContext.fillRect(0, 0, minimapCanvas.width, minimapCanvas.height);

  const px = state.player.position.x;
  const pz = state.player.position.z;

  // ============================================================
  // ROADS
  // ============================================================

  minimapContext.fillStyle = "#22262b";

  for (const road of state.roads) {
    const w = (road.maxX - road.minX) * minimapScale;

    const h = (road.maxZ - road.minZ) * minimapScale;

    const cx = (road.minX + road.maxX) / 2;

    const cz = (road.minZ + road.maxZ) / 2;

    const x = halfWidth + (cx - px) * minimapScale;

    const y = halfHeight - (cz - pz) * minimapScale;

    minimapContext.fillRect(x - w / 2, y - h / 2, w, h);
  }

  // ============================================================
  // TREES
  // ============================================================

  minimapContext.fillStyle = "#008000";

  for (const treeBox of state.treeBoxes) {
    treeBox.getCenter(centerVec);

    const x = halfWidth + (centerVec.x - px) * minimapScale;

    const y = halfHeight - (centerVec.z - pz) * minimapScale;

    minimapContext.beginPath();

    minimapContext.arc(x, y, 2 * entityScale, 0, Math.PI * 2);

    minimapContext.fill();
  }

  // ============================================================
  // BUILDINGS
  // ============================================================

  minimapContext.fillStyle = "#999";

  for (const buildingBox of state.buildingBoxes) {
    const width =
      (buildingBox.max.x - buildingBox.min.x) * minimapScale * entityScale;

    const height =
      (buildingBox.max.z - buildingBox.min.z) * minimapScale * entityScale;

    const cx = (buildingBox.min.x + buildingBox.max.x) / 2;

    const cz = (buildingBox.min.z + buildingBox.max.z) / 2;

    const x = halfWidth + (cx - px) * minimapScale;

    const y = halfHeight - (cz - pz) * minimapScale;

    minimapContext.fillRect(x - width / 2, y - height / 2, width, height);
  }

  // ============================================================
  // WALLS
  // ============================================================

  minimapContext.fillStyle = "#666";

  for (const wallBox of state.wallBoxes) {
    const width = (wallBox.max.x - wallBox.min.x) * minimapScale * entityScale;

    const height = (wallBox.max.z - wallBox.min.z) * minimapScale * entityScale;

    const cx = (wallBox.min.x + wallBox.max.x) / 2;

    const cz = (wallBox.min.z + wallBox.max.z) / 2;

    const x = halfWidth + (cx - px) * minimapScale;

    const y = halfHeight - (cz - pz) * minimapScale;

    minimapContext.fillRect(x - width / 2, y - height / 2, width, height);
  }

  // ============================================================
  // PICKUPS
  // ============================================================

  minimapContext.font =
    '11px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

  minimapContext.textAlign = "center";
  minimapContext.textBaseline = "middle";

  // Guns
  for (const gun of gunPickups) {
    const x = halfWidth + (gun.position.x - px) * minimapScale;

    const y = halfHeight - (gun.position.z - pz) * minimapScale;

    minimapContext.fillText("🔫", x, y);
  }

  // Lifelines
  for (const heart of lifelines) {
    const x = halfWidth + (heart.position.x - px) * minimapScale;

    const y = halfHeight - (heart.position.z - pz) * minimapScale;

    minimapContext.fillText("❤️", x, y);
  }

  // Gold coins
  for (const coin of goldCoins) {
    const x = halfWidth + (coin.position.x - px) * minimapScale;

    const y = halfHeight - (coin.position.z - pz) * minimapScale;

    minimapContext.fillText("🪙", x, y);
  }

  // ============================================================
  // ENEMIES
  // ============================================================

  minimapContext.fillStyle = "#ff0000";

  for (const enemy of state.enemies) {
    const x = halfWidth + (enemy.mesh.position.x - px) * minimapScale;

    const y = halfHeight - (enemy.mesh.position.z - pz) * minimapScale;

    minimapContext.beginPath();

    minimapContext.arc(x, y, 3 * entityScale, 0, Math.PI * 2);

    minimapContext.fill();
  }

  // ============================================================
  // PLAYER GTA-STYLE DIRECTION ARROW
  // ============================================================
  //
  // IMPORTANT:
  //
  // The map is now NORTH-UP and DOES NOT ROTATE.
  //
  // The player arrow rotates instead.
  //
  //                 ▲
  //                / \
  //               /   \
  //              /  │  \
  //             /   │   \
  //            └────┴────┘
  //                 │
  //
  // The tip represents the direction the player is facing.
  //
  // ============================================================

  const playerRotation = state.player.rotation.y;

  const arrowSize = 7 * entityScale;

  const cx = halfWidth;
  const cy = halfHeight;

  minimapContext.save();

  // Move origin to player.
  minimapContext.translate(cx, cy);

  // ------------------------------------------------------------
  // IMPORTANT ANGLE CONVERSION
  // ------------------------------------------------------------
  //
  // Canvas:
  //   0 radians = right
  //
  // Three.js:
  //   rotation.y controls X/Z orientation
  //
  // We use -rotation so the arrow follows the player's
  // actual world heading on the north-up map.
  //
  // The -Math.PI / 2 converts canvas's right-facing zero
  // direction into an up-facing zero direction.
  //

  minimapContext.rotate(-playerRotation - Math.PI / 2);

  // ============================================================
  // ARROW GLOW
  // ============================================================

  minimapContext.shadowColor = "rgba(255, 215, 0, 0.7)";

  minimapContext.shadowBlur = 6;

  // ============================================================
  // MAIN ARROW
  // ============================================================

  minimapContext.fillStyle = "#FFD700";
  minimapContext.strokeStyle = "#111111";
  minimapContext.lineWidth = 2;

  minimapContext.beginPath();

  // Sharp tip
  minimapContext.moveTo(0, -arrowSize);

  // Left shoulder
  minimapContext.lineTo(-arrowSize * 0.65, arrowSize * 0.35);

  // Inner left
  minimapContext.lineTo(-arrowSize * 0.28, arrowSize * 0.25);

  // Left tail
  minimapContext.lineTo(-arrowSize * 0.28, arrowSize * 0.9);

  // Bottom tail
  minimapContext.lineTo(arrowSize * 0.28, arrowSize * 0.9);

  // Right tail
  minimapContext.lineTo(arrowSize * 0.28, arrowSize * 0.25);

  // Right shoulder
  minimapContext.lineTo(arrowSize * 0.65, arrowSize * 0.35);

  minimapContext.closePath();

  minimapContext.fill();
  minimapContext.stroke();

  // ============================================================
  // INNER WHITE DIRECTION MARK
  // ============================================================

  minimapContext.shadowBlur = 0;

  minimapContext.fillStyle = "rgba(255, 255, 255, 0.8)";

  minimapContext.beginPath();

  minimapContext.moveTo(0, -arrowSize * 0.55);

  minimapContext.lineTo(-arrowSize * 0.17, -arrowSize * 0.05);

  minimapContext.lineTo(arrowSize * 0.17, -arrowSize * 0.05);

  minimapContext.closePath();

  minimapContext.fill();

  // ============================================================
  // CENTER DOT
  // ============================================================

  minimapContext.fillStyle = "#FFFFFF";

  minimapContext.beginPath();

  minimapContext.arc(0, arrowSize * 0.3, 1.8, 0, Math.PI * 2);

  minimapContext.fill();

  minimapContext.restore();

  // ============================================================
  // NORTH INDICATOR
  // ============================================================

  minimapContext.fillStyle = "rgba(255, 255, 255, 0.95)";

  minimapContext.font = "bold 10px Arial";

  minimapContext.textAlign = "center";
  minimapContext.textBaseline = "middle";

  minimapContext.fillText("N", halfWidth, 9);

  // ============================================================
  // MINIMAP BORDER
  // ============================================================

  minimapContext.strokeStyle = "rgba(255, 255, 255, 0.35)";

  minimapContext.lineWidth = 2;

  minimapContext.beginPath();

  minimapContext.arc(halfWidth, halfHeight, halfWidth - 1, 0, Math.PI * 2);

  minimapContext.stroke();

  minimapContext.restore();
}
