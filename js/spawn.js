// spawn.js
// Spawn-point logic: clearance tests against all static obstacles, the fixed
// center-of-map player spawn, and the general clear-position finder used for
// enemies and NPCs (with optional keep-away distance from the player).

import * as THREE from "three";
import { buildingIndex, treeIndex, wallIndex } from "./placement.js";
import { CITY_RADIUS, mulberry32 } from "./terrain.js";
import { districtFor } from "./city.js";
import { state } from "./state.js";

// Shared clear-spot test: no trees, buildings, walls, or building interiors.
function isSpawnClear(x, z, half) {
  const box = new THREE.Box3(
    new THREE.Vector3(x - half, 0, z - half),
    new THREE.Vector3(x + half, 2, z + half),
  );
  if (treeIndex.intersects(box)) return false;
  if (buildingIndex.intersects(box)) return false;
  if (wallIndex.intersects(box)) return false;
  // Don't spawn inside a hollow building's interior.
  for (const b of state.buildingInteriors) {
    if (
      box.min.x < b.maxX &&
      box.max.x > b.minX &&
      box.min.z < b.maxZ &&
      box.max.z > b.minZ
    ) {
      return false;
    }
  }
  return true;
}

// Is this point comfortably off every road? `margin` keeps the player from
// spawning on asphalt or its edge — e.g. the middle of the main intersection.
function isOffRoad(x, z, margin) {
  for (const r of state.roads) {
    if (
      x > r.minX - margin &&
      x < r.maxX + margin &&
      z > r.minZ - margin &&
      z < r.maxZ + margin
    ) {
      return false;
    }
  }
  return true;
}

// Player spawn: a quiet residential neighbourhood spot — on grass/sidewalk
// near houses, never in the middle of a road. The search is seeded so the
// player starts at the exact same place every run (the city layout itself is
// seeded too). Preference order:
//   1. residential district, off-road, clear of buildings/trees/walls
//   2. commercial district, off-road, clear
//   3. anywhere off-road and clear (rarely needed)
export function findPlayerSpawnPosition() {
  const half = 1.0; // half footprint (0.5) + clearance margin
  const ROAD_MARGIN = 6; // stay well back from road edges
  const rand = mulberry32(0x5eedcafe);

  // Ring where each district lives, matching districtFor() in city.js:
  // residential is the outer band, commercial the mid band.
  const wants = [
    {
      ok: (x, z) => districtFor(x, z) === "residential",
      rMin: 322,
      rMax: CITY_RADIUS - 25,
    },
    {
      ok: (x, z) => districtFor(x, z) === "commercial",
      rMin: 155,
      rMax: 318,
    },
    {
      ok: () => true,
      rMin: 40,
      rMax: CITY_RADIUS - 25,
    },
  ];

  for (const w of wants) {
    for (let i = 0; i < 500; i++) {
      const a = rand() * Math.PI * 2;
      const r = w.rMin + rand() * (w.rMax - w.rMin);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (
        isSpawnClear(x, z, half) &&
        isOffRoad(x, z, ROAD_MARGIN) &&
        w.ok(x, z)
      ) {
        return { x, z };
      }
    }
  }

  // Guaranteed fallback: the deterministic grid scan (original behavior).
  for (let x = -360; x <= 360; x += 5) {
    for (let z = -360; z <= 360; z += 5) {
      if (isSpawnClear(x, z, half) && isOffRoad(x, z, ROAD_MARGIN)) {
        return { x, z };
      }
    }
  }

  return { x: 0, z: 0 };
}

// Returns a clear position for dynamic entities (enemies, etc.). When
// `avoid` is given, candidates closer than `minDist` to that point are
// rejected — used so no enemy can spawn right on top of the player.
export function findClearSpawnPosition(avoid = null, minDist = 0) {
  const half = 1.0; // half footprint (0.5) + clearance margin
  const range = CITY_RADIUS - 10; // stay in the flat city area

  const isClear = (x, z) => {
    if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < minDist) return false;
    return isSpawnClear(x, z, half);
  };

  // Random attempts (usually succeeds on the first try).
  for (let i = 0; i < 300; i++) {
    const x = (Math.random() - 0.5) * 2 * range;
    const z = (Math.random() - 0.5) * 2 * range;
    if (isClear(x, z)) return { x, z };
  }

  // Deterministic fallback: scan a coarse grid for any clear cell.
  for (let x = -range; x <= range; x += 5) {
    for (let z = -range; z <= range; z += 5) {
      if (isClear(x, z)) return { x, z };
    }
  }

  // Last resort (should never be reached).
  return { x: 0, z: 0 };
}
