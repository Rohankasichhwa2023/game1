// placement.js
// Shared building blocks for world generation: static-object freezing, the
// spatial placement index, shared geometry/materials, and the clearance tests
// used by every generator (buildings, roads, props, spawn points).

import * as THREE from "three";
import { state } from "./state.js";

// ---------------- Performance helpers ----------------
// Static world geometry never changes after generation. Freezing local/world
// matrices removes unnecessary per-frame matrix updates without changing the
// visible scene or gameplay.
export function freezeStaticObject(object) {
  object.updateMatrixWorld(true);
  object.traverse((child) => {
    if (!child.isObject3D) return;
    child.updateMatrix();
    child.matrixAutoUpdate = false;
    child.matrixWorldAutoUpdate = false;
  });
  return object;
}

export function addFrozenStatic(object) {
  state.scene.add(freezeStaticObject(object));
  return object;
}

export function addIndexedBox(stateArray, index, box) {
  stateArray.push(box);
  index.add(box);
}

// The generation code performs many placement/collision queries. Keep the
// original state arrays intact for the rest of the game, but use a spatial
// index internally so generation/spawn checks do not scan every object.
const PLACEMENT_CELL_SIZE = 32;

class PlacementIndex {
  constructor() {
    this.cells = new Map();
  }

  clear() {
    this.cells.clear();
  }

  _range(box) {
    const minX = Math.floor(box.min.x / PLACEMENT_CELL_SIZE);
    const maxX = Math.floor(box.max.x / PLACEMENT_CELL_SIZE);
    const minZ = Math.floor(box.min.z / PLACEMENT_CELL_SIZE);
    const maxZ = Math.floor(box.max.z / PLACEMENT_CELL_SIZE);
    return { minX, maxX, minZ, maxZ };
  }

  add(box) {
    const { minX, maxX, minZ, maxZ } = this._range(box);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const key = `${cx}:${cz}`;
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        bucket.push(box);
      }
    }
  }

  intersects(box) {
    const { minX, maxX, minZ, maxZ } = this._range(box);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const bucket = this.cells.get(`${cx}:${cz}`);
        if (!bucket) continue;
        for (const other of bucket) {
          if (box.intersectsBox(other)) return true;
        }
      }
    }
    return false;
  }
}

export const buildingIndex = new PlacementIndex();
export const treeIndex = new PlacementIndex();
export const wallIndex = new PlacementIndex();

// ---------------- Shared temp objects ----------------
export const _v1 = new THREE.Vector3();
export const _v2 = new THREE.Vector3();
export const _v3 = new THREE.Vector3();
export const _matrix = new THREE.Matrix4();
export const _quaternion = new THREE.Quaternion();
export const _color = new THREE.Color();

// ---------------- Shared geometry/materials ----------------
export const sharedUnitBoxGeometry = new THREE.BoxGeometry(1, 1, 1);
const boxMaterialCache = new Map();
export const sharedColoredBoxMaterial = new THREE.MeshPhongMaterial({
  color: 0xffffff,
  shininess: 10,
});

export function getBoxMaterial(color) {
  let material = boxMaterialCache.get(color);
  if (!material) {
    material = new THREE.MeshPhongMaterial({ color, shininess: 10 });
    boxMaterialCache.set(color, material);
  }
  return material;
}

// ---------------- Safe placement helpers ----------------
export function boxOverlapsAnyRoad(box, extra = 0) {
  for (const r of state.roads) {
    if (
      box.max.x + extra > r.minX &&
      box.min.x - extra < r.maxX &&
      box.max.z + extra > r.minZ &&
      box.min.z - extra < r.maxZ
    ) {
      return true;
    }
  }
  return false;
}

export function boxOverlapsAnyBox(box, boxes) {
  if (boxes === state.buildingBoxes) return buildingIndex.intersects(box);
  if (boxes === state.treeBoxes) return treeIndex.intersects(box);
  if (boxes === state.wallBoxes) return wallIndex.intersects(box);
  for (const other of boxes) {
    if (box.intersectsBox(other)) return true;
  }
  return false;
}

// True only when a proposed static object has clearance from roads and
// everything already generated. Generation is intentionally ordered:
// buildings -> community walls -> trees/decoration.
export function isStaticPlacementClear(
  box,
  { roadPadding = 0, ignoreTrees = false } = {},
) {
  if (boxOverlapsAnyRoad(box, roadPadding)) return false;
  if (boxOverlapsAnyBox(box, state.buildingBoxes)) return false;
  if (!ignoreTrees && boxOverlapsAnyBox(box, state.treeBoxes)) return false;
  if (boxOverlapsAnyBox(box, state.wallBoxes)) return false;
  return true;
}

// A point is clear of buildings/trees/walls/roads within `radius` — used to
// find spots for ponds and fountains that won't overlap anything else.
export function isAreaClear(x, z, radius) {
  if (Math.hypot(x, z) > CITY_CLEAR_RADIUS) return false;
  const box = new THREE.Box3(
    new THREE.Vector3(x - radius, 0, z - radius),
    new THREE.Vector3(x + radius, 3, z + radius),
  );
  if (treeIndex.intersects(box)) return false;
  if (buildingIndex.intersects(box)) return false;
  if (wallIndex.intersects(box)) return false;
  for (const r of state.roads) {
    if (
      x + radius > r.minX &&
      x - radius < r.maxX &&
      z + radius > r.minZ &&
      z - radius < r.maxZ
    )
      return false;
  }
  return true;
}

// Small local constant to avoid a circular import with terrain.js — the
// original code used CITY_RADIUS - 15 here.
const CITY_CLEAR_RADIUS = 355;

export function findClearSpot(radius, rand, tries = 40) {
  const range = CITY_CLEAR_RADIUS - 5;
  for (let i = 0; i < tries; i++) {
    const x = (rand() - 0.5) * 2 * range;
    const z = (rand() - 0.5) * 2 * range;
    if (isAreaClear(x, z, radius)) return { x, z };
  }
  return null;
}

const TREE_CLEARANCE = 1.25;

export function placeTree(x, z, treePositions) {
  const treeBox = new THREE.Box3(
    _v1.set(x - TREE_CLEARANCE, 0, z - TREE_CLEARANCE),
    _v2.set(x + TREE_CLEARANCE, 5, z + TREE_CLEARANCE),
  );

  if (!isStaticPlacementClear(treeBox)) return false;

  treePositions.push({ x, z });
  const storedBox = new THREE.Box3(
    _v1.set(x - 0.5, 0, z - 0.5),
    _v2.set(x + 0.5, 5, z + 0.5),
  );
  addIndexedBox(state.treeBoxes, treeIndex, storedBox);
  return true;
}

export function resetPlacementIndices() {
  buildingIndex.clear();
  treeIndex.clear();
  wallIndex.clear();
}
