// world.js
// World orchestration: builds the terrain, generates the city, and assembles
// all static geometry. The heavy lifting lives in the focused modules:
//
//   terrain.js   — PRNG, heightmap, ground mesh
//   placement.js — spatial index, shared geometry, clearance tests
//   roads.js     — road network, surfaces, markings, ring highway
//   buildings.js — districts, facades, hollow buildings, instancing
//   props.js     — trees, benches, lamps, water features, env animation
//   city.js      — colony walls, block/district generation, generateCity
//   spawn.js     — player/enemy/NPC spawn-point finders

import { state } from "./state.js";
import { mulberry32, createGroundMesh } from "./terrain.js";
import { resetPlacementIndices } from "./placement.js";
import {
  addRoadSurface,
  addCenterLine,
  addRingRoad,
  placeIntersectionMarkings,
} from "./roads.js";
import { resetBuildingCollections, buildHollowInstances } from "./buildings.js";
import {
  resetPropCollections,
  buildTreeInstances,
  placeLampPosts,
} from "./props.js";
import { generateCity, placeGlobalWaterFeatures } from "./city.js";

// Keep the original module API intact for the rest of the game (enemies,
// npcs, pickups, player, and main all import these from "./world.js").
export { getGroundHeight, mulberry32 } from "./terrain.js";
export { findClearSpawnPosition, findPlayerSpawnPosition } from "./spawn.js";
export { updateEnvironment } from "./props.js";
export { generateCity, districtFor } from "./city.js";
export { placeIntersectionMarkings } from "./roads.js";
export { placeTree } from "./placement.js";

const CITY_SEED = 20240815;

// ---------------- World initialization ----------------
export function initWorld() {
  const groundSize = state.groundSize;

  // Reset world data (initWorld may be called once, but keep it safe).
  state.treeBoxes.length = 0;
  state.buildingBoxes.length = 0;
  state.wallBoxes.length = 0;
  state.roads = [];
  state.buildingInteriors = [];
  resetPlacementIndices();
  resetBuildingCollections();
  resetPropCollections();

  // Base ground (grass — visible in parks and gaps), displaced into hills.
  createGroundMesh(groundSize);

  // Generate the city layout (buildings + trees + collision boxes + road data).
  const rand = mulberry32(CITY_SEED);
  const { roads, verticals, horizontals, treePositions } = generateCity(rand);

  // A few extra ponds/fountains outside the park district (parks already
  // got their own inside generateCity).
  placeGlobalWaterFeatures(rand);

  // Road surfaces (asphalt) that climb the hills up to the ring road.
  for (const road of roads) {
    addRoadSurface(road);
  }

  // Lane markings.
  for (const road of roads) {
    if (road.type === "arterial") addCenterLine(road, 0xffd75e, 0.03);
    else if (road.type === "secondary") addCenterLine(road, 0xffffff, 0.03);
  }

  // Trees (instanced).
  buildTreeInstances(treePositions);

  // Lamp posts along the major roads (subset carry night-mode point lights).
  placeLampPosts(verticals, horizontals);

  // Hollow buildings (instanced walls/floors/roofs/facades).
  buildHollowInstances();

  // Hilly ring-road highway around the whole world (replaces the old
  // perimeter walls).
  addRingRoad();
  state.ringRoad = { inner: 440, outer: 476 };
}
