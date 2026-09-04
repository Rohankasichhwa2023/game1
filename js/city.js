// city.js
// City layout generation: road-separated blocks, districts, decorative brick
// colony walls with gates, building lots, park ponds, and the top-level
// generateCity() orchestrator.

import * as THREE from "three";
import { state } from "./state.js";
import {
  addFrozenStatic,
  addIndexedBox,
  wallIndex,
  isStaticPlacementClear,
  isAreaClear,
  findClearSpot,
  placeTree,
} from "./placement.js";
import { CITY_RADIUS } from "./terrain.js";
import { buildRoadNetwork } from "./roads.js";
import {
  DISTRICT,
  HOUSE_COLORS,
  INDUSTRIAL_COLORS,
  createHollowBuilding,
  chooseEuropeanStyle,
  chooseStoryCount,
  buildingHeightFromStories,
  roofColorFor,
} from "./buildings.js";
import {
  createPond,
  createFountain,
  createBench,
  createFlowerBed,
  createHedge,
  createFireHydrant,
} from "./props.js";

// ---------------- Brick-textured colony walls ----------------
const COLONY_WALL_HEIGHT = 2.5;
const COLONY_WALL_THICKNESS = 0.5;
const COLONY_GATE_WIDTH = 6;

let baseBrickTexture = null;
function getBrickTexture() {
  if (baseBrickTexture) return baseBrickTexture;

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  // Mortar base.
  ctx.fillStyle = "#c9c4ba";
  ctx.fillRect(0, 0, size, size);

  // Running-bond brick pattern.
  const brickH = 32;
  const brickW = 64;
  const mortar = 4;
  const rows = Math.ceil(size / brickH);
  for (let row = 0; row < rows; row++) {
    const offset = row % 2 === 0 ? 0 : brickW / 2;
    for (let col = -1; col <= Math.ceil(size / brickW); col++) {
      const x = col * brickW + offset;
      const y = row * brickH;
      const v = Math.floor(Math.random() * 30) - 15;
      ctx.fillStyle = `rgb(${150 + v}, ${78 + v}, ${58 + v})`;
      ctx.fillRect(
        x + mortar / 2,
        y + mortar / 2,
        brickW - mortar,
        brickH - mortar,
      );
    }
  }

  baseBrickTexture = new THREE.CanvasTexture(canvas);
  baseBrickTexture.wrapS = THREE.RepeatWrapping;
  baseBrickTexture.wrapT = THREE.RepeatWrapping;
  baseBrickTexture.colorSpace = THREE.SRGBColorSpace;
  return baseBrickTexture;
}

const brickMaterialCache = new Map();
function brickMaterial(length) {
  const repeat = Math.max(1, Math.round(length / 4));
  let cached = brickMaterialCache.get(repeat);
  if (cached) return cached;
  const tex = getBrickTexture().clone();
  tex.needsUpdate = true;
  tex.repeat.set(repeat, 1);
  cached = new THREE.MeshPhongMaterial({ map: tex, shininess: 5 });
  brickMaterialCache.set(repeat, cached);
  return cached;
}

// Adds a single low wall segment (w = size along X, d = size along Z).
function addColonyWallSegment(cx, cz, w, d) {
  const h = COLONY_WALL_HEIGHT;
  const box = new THREE.Box3(
    new THREE.Vector3(cx - w / 2, 0, cz - d / 2),
    new THREE.Vector3(cx + w / 2, h, cz + d / 2),
  );

  // Walls are decorative only. Never allow them onto paved roads or through
  // a building/tree/previous wall. This makes placement order deterministic
  // and prevents merged collision geometry.
  if (!isStaticPlacementClear(box, { roadPadding: 0.2 })) return false;

  const length = Math.max(w, d);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    brickMaterial(length),
  );
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.position.set(cx, h / 2, cz);
  addFrozenStatic(mesh);

  addIndexedBox(state.wallBoxes, wallIndex, box);
  return true;
}

// Returns the road type whose edge coincides with `edgeValue` on the given
// axis (vertical or horizontal roads), or null if it's the map boundary.
function adjacentRoadType(edgeValue, roads, isVertical) {
  for (const r of roads) {
    const pos = isVertical ? r.x : r.z;
    const halfW = r.width / 2;
    if (
      Math.abs(pos - halfW - edgeValue) < 0.01 ||
      Math.abs(pos + halfW - edgeValue) < 0.01
    )
      return r.type;
  }
  return null;
}

// Low jumpable brick wall around a city block, with one gate opening.
// Sides that border a narrow "local" road are skipped so small streets don't
// feel walled in.
function addColonyWallsForBlock(block, rand, verticals, horizontals) {
  const { x0, x1, z0, z1 } = block;
  const t = COLONY_WALL_THICKNESS;
  const gateW = COLONY_GATE_WIDTH;
  const inset = 1.0;
  const eps = 0.15;

  const sides = ["south", "north", "east", "west"];
  const gateSide = sides[Math.floor(rand() * sides.length)];

  // Preserve the original community-wall behavior: a wall runs around the
  // whole block, with one real gate opening. Local roads remain open just as
  // before, but wall geometry is now tested against existing buildings.
  const southLocal = adjacentRoadType(z0, horizontals, false) === "local";
  const northLocal = adjacentRoadType(z1, horizontals, false) === "local";
  const westLocal = adjacentRoadType(x0, verticals, true) === "local";
  const eastLocal = adjacentRoadType(x1, verticals, true) === "local";

  function getBlockedIntervals(isVertical, fixed, a, b) {
    const intervals = [];

    // Slightly inset the wall from the block boundary. This keeps it on the
    // green community side rather than straddling the paved road edge.
    const wallFixed = fixed;

    for (const box of state.buildingBoxes) {
      if (isVertical) {
        // Wall runs along Z at constant X.
        if (
          wallFixed >= box.min.x - t - eps &&
          wallFixed <= box.max.x + t + eps
        ) {
          const lo = Math.max(a, box.min.z - t - eps);
          const hi = Math.min(b, box.max.z + t + eps);
          if (hi > lo) intervals.push([lo, hi]);
        }
      } else {
        // Wall runs along X at constant Z.
        if (
          wallFixed >= box.min.z - t - eps &&
          wallFixed <= box.max.z + t + eps
        ) {
          const lo = Math.max(a, box.min.x - t - eps);
          const hi = Math.min(b, box.max.x + t + eps);
          if (hi > lo) intervals.push([lo, hi]);
        }
      }
    }

    if (intervals.length < 2) return intervals;

    intervals.sort((a1, b1) => a1[0] - b1[0]);
    const merged = [intervals[0].slice()];
    for (let i = 1; i < intervals.length; i++) {
      const cur = intervals[i];
      const last = merged[merged.length - 1];
      if (cur[0] <= last[1] + 0.1) last[1] = Math.max(last[1], cur[1]);
      else merged.push(cur.slice());
    }
    return merged;
  }

  // Add a continuous wall side, splitting around the gate and any building
  // footprint that would otherwise cause the wall to merge into a building.
  const addRun = (isVertical, fixed, a, b, isGateSide, skip) => {
    if (skip || b - a < 1.0) return;

    const cutouts = getBlockedIntervals(isVertical, fixed, a, b);
    const cuts = [];

    // Gate opening is exactly the old behavior: one opening centered at a
    // random point between 30% and 70% of the side.
    if (isGateSide) {
      const gateCenter = a + (b - a) * (0.3 + rand() * 0.4);
      const g0 = Math.max(a, gateCenter - gateW / 2);
      const g1 = Math.min(b, gateCenter + gateW / 2);
      if (g1 > g0) cuts.push([g0, g1]);
    }

    for (const interval of cutouts) cuts.push(interval);

    if (cuts.length === 0) {
      if (isVertical) {
        addColonyWallSegment(fixed, (a + b) / 2, t, b - a);
      } else {
        addColonyWallSegment((a + b) / 2, fixed, b - a, t);
      }
      return;
    }

    cuts.sort((a1, b1) => a1[0] - b1[0]);
    const merged = [cuts[0].slice()];
    for (let i = 1; i < cuts.length; i++) {
      const cur = cuts[i];
      const last = merged[merged.length - 1];
      if (cur[0] <= last[1] + 0.15) last[1] = Math.max(last[1], cur[1]);
      else merged.push(cur.slice());
    }

    let cursor = a;
    for (const [cut0, cut1] of merged) {
      const segStart = cursor;
      const segEnd = Math.min(b, cut0);
      if (segEnd - segStart > 0.8) {
        const wallA = segStart + inset;
        const wallB = segEnd - inset;
        if (wallB - wallA > 0.8) {
          if (isVertical) {
            addColonyWallSegment(
              fixed + (fixed < 0 ? inset : -inset),
              (wallA + wallB) / 2,
              t,
              wallB - wallA,
            );
          } else {
            addColonyWallSegment(
              (wallA + wallB) / 2,
              fixed + (fixed < 0 ? inset : -inset),
              wallB - wallA,
              t,
            );
          }
        }
      }
      cursor = Math.max(cursor, cut1);
    }

    if (b - cursor > 0.8) {
      const wallA = cursor + inset;
      const wallB = b - inset;
      if (wallB - wallA > 0.8) {
        if (isVertical) {
          addColonyWallSegment(
            fixed + (fixed < 0 ? inset : -inset),
            (wallA + wallB) / 2,
            t,
            wallB - wallA,
          );
        } else {
          addColonyWallSegment(
            (wallA + wallB) / 2,
            fixed + (fixed < 0 ? inset : -inset),
            wallB - wallA,
            t,
          );
        }
      }
    }
  };

  // Same four-sided community perimeter as the original implementation.
  // Only the parts that would intersect a building are cut out.
  addRun(
    false,
    z0 + (z0 < 0 ? inset : -inset),
    x0,
    x1,
    gateSide === "south",
    southLocal,
  );
  addRun(
    false,
    z1 + (z1 < 0 ? inset : -inset),
    x0,
    x1,
    gateSide === "north",
    northLocal,
  );
  addRun(
    true,
    x0 + (x0 < 0 ? inset : -inset),
    z0,
    z1,
    gateSide === "west",
    westLocal,
  );
  addRun(
    true,
    x1 + (x1 < 0 ? inset : -inset),
    z0,
    z1,
    gateSide === "east",
    eastLocal,
  );
}

// ---------------- City blocks & districts ----------------
// Bands (clear areas) between roads along one axis.
function buildBands(centers, half) {
  const sorted = [...centers].sort((a, b) => a.pos - b.pos);
  const bands = [];
  let prev = -half;
  for (const c of sorted) {
    const left = c.pos - c.width / 2;
    const right = c.pos + c.width / 2;
    if (left - prev >= 1) bands.push({ lo: prev, hi: left });
    prev = right;
  }
  if (half - prev >= 1) bands.push({ lo: prev, hi: half });
  return bands;
}

function buildBlocks(verticals, horizontals) {
  const half = state.groundSize / 2;
  const vCenters = verticals.map((v) => ({ pos: v.x, width: v.width }));
  const hCenters = horizontals.map((h) => ({ pos: h.z, width: h.width }));
  const xBands = buildBands(vCenters, half);
  const zBands = buildBands(hCenters, half);

  const blocks = [];
  for (const xb of xBands) {
    for (const zb of zBands) {
      blocks.push({ x0: xb.lo, x1: xb.hi, z0: zb.lo, z1: zb.hi });
    }
  }
  return blocks;
}

export function districtFor(cx, cz) {
  // A grass park band in the north-east.
  if (cx > 120 && cx < 368 && cz > 240) return "park";
  const dist = Math.hypot(cx, cz);
  if (dist < 150) return "downtown";
  if (cx > 120 && cz < -120) return "industrial";
  if (dist > 320) return "residential";
  return "commercial";
}

// ---------------- Block content ----------------
const BUILDING_EDGE_MARGIN = 10.0; // never place buildings this close to a road edge
const BUILDING_GAP = 5.5; // minimum free pedestrian space between buildings

function chooseDoorSidesForLot(cx, cz, block) {
  // Doors are always on opposite sides. That guarantees two genuinely
  // different entrances and, because buildings are surrounded by a generous
  // lot gap, a pedestrian can approach either side.
  const distances = [
    { side: "south", d: Math.abs(cz - block.z0) },
    { side: "north", d: Math.abs(block.z1 - cz) },
    { side: "west", d: Math.abs(cx - block.x0) },
    { side: "east", d: Math.abs(block.x1 - cx) },
  ];
  distances.sort((a, b) => a.d - b.d);

  const primary = distances[0].side;
  const opposite = {
    south: "north",
    north: "south",
    west: "east",
    east: "west",
  }[primary];

  return [primary, opposite];
}

function generateBlockBuildings(block, district, rand, treePositions) {
  // Keep a broad green/pedestrian strip between the roads and the buildings.
  const x0 = block.x0 + BUILDING_EDGE_MARGIN;
  const x1 = block.x1 - BUILDING_EDGE_MARGIN;
  const z0 = block.z0 + BUILDING_EDGE_MARGIN;
  const z1 = block.z1 - BUILDING_EDGE_MARGIN;
  const bw = x1 - x0;
  const bd = z1 - z0;
  if (bw < 12 || bd < 12) return;

  const cfg = DISTRICT[district];

  // Adaptive lot grid. Small blocks get one building, normal blocks get 2x2,
  // and larger blocks may get 2x3/3x2. We never use a grid that forces the
  // building footprint to touch a road or another building.
  const desiredCols = bw >= 72 ? 3 : bw >= 42 ? 2 : 1;
  const desiredRows = bd >= 72 ? 3 : bd >= 42 ? 2 : 1;
  const cols = Math.max(1, desiredCols);
  const rows = Math.max(1, desiredRows);
  const cw = bw / cols;
  const cd = bd / rows;

  const placedCenters = [];

  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const lx0 = x0 + i * cw;
      const lx1 = x0 + (i + 1) * cw;
      const lz0 = z0 + j * cd;
      const lz1 = z0 + (j + 1) * cd;

      // Keep some lots as open green courtyards. More empty space outside the
      // core gives the city a breathable European community feel.
      const emptyChance =
        district === "downtown"
          ? 0.1
          : district === "commercial"
            ? 0.18
            : district === "residential"
              ? 0.28
              : 0.42;

      if (rand() < emptyChance) continue;

      // Building footprint is deliberately smaller than the lot, leaving a
      // continuous walking gap around every side.
      const lotInset = Math.max(BUILDING_GAP / 2, 2.5);
      const availableW = cw - lotInset * 2;
      const availableD = cd - lotInset * 2;
      if (availableW < 7 || availableD < 7) continue;

      const targetW = Math.min(
        availableW,
        Math.max(7, cfg.lotW * (0.64 + rand() * 0.2)),
      );
      const targetD = Math.min(
        availableD,
        Math.max(7, cfg.lotD * (0.64 + rand() * 0.2)),
      );

      const w = Math.min(availableW, Math.max(7, targetW - rand() * 1.25));
      const d = Math.min(availableD, Math.max(7, targetD - rand() * 1.25));

      let cx = (lx0 + lx1) / 2;
      let cz = (lz0 + lz1) / 2;

      // Small jitter, but never enough to erase the pedestrian gap.
      const maxJitterX = Math.max(0, (availableW - w) / 2 - 0.75);
      const maxJitterZ = Math.max(0, (availableD - d) / 2 - 0.75);
      cx += (rand() - 0.5) * Math.min(2.0, maxJitterX);
      cz += (rand() - 0.5) * Math.min(2.0, maxJitterZ);

      const footprint = new THREE.Box3(
        new THREE.Vector3(cx - w / 2, 0, cz - d / 2),
        new THREE.Vector3(cx + w / 2, 1, cz + d / 2),
      );

      // This is the critical road/building test. If a footprint touches a
      // paved road or a previous building, this lot is rejected and left green.
      if (!isStaticPlacementClear(footprint, { roadPadding: 0.4 })) continue;

      const style = chooseEuropeanStyle(district, rand);
      const stories = chooseStoryCount(cfg, district, rand);
      const h = buildingHeightFromStories(stories, style, rand);

      const palette =
        district === "residential"
          ? HOUSE_COLORS
          : district === "industrial"
            ? INDUSTRIAL_COLORS
            : cfg.colors;

      const wallColor = palette[Math.floor(rand() * palette.length)];
      const doorSides = chooseDoorSidesForLot(cx, cz, block);

      createHollowBuilding(
        cx,
        cz,
        w,
        h,
        d,
        doorSides,
        wallColor,
        style,
        stories,
        rand,
        district,
        roofColorFor(style, rand),
      );

      placedCenters.push({ cx, cz, w, d, doorSides });

      // Residential fronts get hedges only after the building exists. The hedge
      // helper itself is positioned outside the facade and cannot close the door.
      if (district === "residential" && rand() < 0.45) {
        const front = doorSides[0];
        const hedgeGap = 1.6;
        if (front === "south")
          createHedge(
            cx,
            cz - d / 2 - hedgeGap,
            0,
            Math.max(2, w * 0.62),
            rand,
          );
        else if (front === "north")
          createHedge(
            cx,
            cz + d / 2 + hedgeGap,
            Math.PI,
            Math.max(2, w * 0.62),
            rand,
          );
        else if (front === "west")
          createHedge(
            cx - w / 2 - hedgeGap,
            cz,
            -Math.PI / 2,
            Math.max(2, d * 0.62),
            rand,
          );
        else
          createHedge(
            cx + w / 2 + hedgeGap,
            cz,
            Math.PI / 2,
            Math.max(2, d * 0.62),
            rand,
          );
      }
    }
  }

  // Keep a tree/plaza pocket only in genuinely empty green space.
  for (
    let i = 0;
    i < Math.min(4, Math.max(1, Math.floor((bw * bd) / 2500)));
    i++
  ) {
    const tx = x0 + 3 + rand() * Math.max(1, bw - 6);
    const tz = z0 + 3 + rand() * Math.max(1, bd - 6);
    if (placeTree(tx, tz, treePositions) && rand() < 0.35) {
      createFlowerBed(tx + 1.0, tz + 1.0, rand);
    }
  }

  // Sidewalk dressing is generated last, after buildings and walls, and each
  // tree checks the obstacle lists before being committed.
  const sidewalkInset = 4.0;
  const decorateSidewalk = (axis, fixed, a, b) => {
    for (let pos = a + 3.5; pos <= b - 3.5; pos += 11) {
      const roll = rand();
      const x = axis === "x" ? pos : fixed;
      const z = axis === "x" ? fixed : pos;

      if (roll < 0.34) {
        placeTree(x, z, treePositions);
      } else if (roll < 0.43) {
        // Benches are visual only; keep them away from roads/buildings/walls.
        const clearanceBox = new THREE.Box3(
          new THREE.Vector3(x - 1.25, 0, z - 0.8),
          new THREE.Vector3(x + 1.25, 1.2, z + 0.8),
        );
        if (isStaticPlacementClear(clearanceBox)) {
          const yaw = axis === "x" ? 0 : Math.PI / 2;
          createBench(x, z, yaw, rand);
        }
      } else if (roll < 0.48) {
        const clearanceBox = new THREE.Box3(
          new THREE.Vector3(x - 0.45, 0, z - 0.45),
          new THREE.Vector3(x + 0.45, 1, z + 0.45),
        );
        if (isStaticPlacementClear(clearanceBox)) createFireHydrant(x, z);
      }
    }
  };

  // These positions are inside the block, not on the road itself.
  decorateSidewalk("x", block.z0 + sidewalkInset, block.x0 + 1, block.x1 - 1);
  decorateSidewalk("x", block.z1 - sidewalkInset, block.x0 + 1, block.x1 - 1);
  decorateSidewalk("z", block.x0 + sidewalkInset, block.z0 + 1, block.z1 - 1);
  decorateSidewalk("z", block.x1 - sidewalkInset, block.z0 + 1, block.z1 - 1);
}

// ---------------- Top-level generation ----------------
export function generateCity(rand) {
  const { roads, verticals, horizontals } = buildRoadNetwork();
  state.roads = roads;

  const blocks = buildBlocks(verticals, horizontals);
  const treePositions = [];

  // Generation order is deliberate:
  //   1. determine clean road-separated blocks
  //   2. place buildings with collision/road clearance
  //   3. place decorative brick wall fragments with collision/road clearance
  //   4. place trees/furniture only where nothing else exists
  // This prevents later objects from merging into earlier geometry.
  for (const block of blocks) {
    const cx = (block.x0 + block.x1) / 2;
    const cz = (block.z0 + block.z1) / 2;

    if (Math.hypot(cx, cz) > CITY_RADIUS) continue;

    const district = districtFor(cx, cz);

    if (district === "park") {
      const area = (block.x1 - block.x0) * (block.z1 - block.z0);
      const n = Math.max(4, Math.floor(area / 400));
      for (let i = 0; i < n * 2; i++) {
        const tx =
          block.x0 + 5 + rand() * Math.max(1, block.x1 - block.x0 - 10);
        const tz =
          block.z0 + 5 + rand() * Math.max(1, block.z1 - block.z0 - 10);
        placeTree(tx, tz, treePositions);
        if (rand() < 0.24) {
          createFlowerBed(tx + 1.2, tz - 1.2, rand);
        }
      }

      if (rand() < 0.7) {
        const px = block.x0 + (block.x1 - block.x0) * (0.3 + rand() * 0.4);
        const pz = block.z0 + (block.z1 - block.z0) * (0.3 + rand() * 0.4);
        const rx = 5 + rand() * 4;
        const rz = 4 + rand() * 3;
        if (isAreaClear(px, pz, Math.max(rx, rz) + 1)) {
          createPond(px, pz, rx, rz, rand);
          for (let i = 0; i < 3; i++) {
            const a = rand() * Math.PI * 2;
            const bx = px + Math.cos(a) * (Math.max(rx, rz) + 2.5);
            const bz = pz + Math.sin(a) * (Math.max(rx, rz) + 2.5);
            const benchBox = new THREE.Box3(
              new THREE.Vector3(bx - 1.3, 0, bz - 1.0),
              new THREE.Vector3(bx + 1.3, 1.2, bz + 1.0),
            );
            if (isStaticPlacementClear(benchBox)) {
              createBench(bx, bz, a + Math.PI, rand);
            }
          }
        }
      }
      continue;
    }

    // Build the block in a strict collision-safe order. Wall fragments are
    // created first, then buildings reject them, and finally trees/furniture
    // reject both walls and buildings. The generous 10m building edge margin
    // keeps doors and pedestrian lanes well clear of the wall corners.
    addColonyWallsForBlock(block, rand, verticals, horizontals);
    generateBlockBuildings(block, district, rand, treePositions);
  }

  return { roads, verticals, horizontals, treePositions };
}

// A few extra ponds/fountains outside the park district (parks already got
// their own inside generateCity).
export function placeGlobalWaterFeatures(rand) {
  for (let tries = 0, placed = 0; tries < 40 && placed < 2; tries++) {
    const spot = findClearSpot(9, rand);
    if (!spot) continue;
    const d = districtFor(spot.x, spot.z);
    if (d === "park") continue;
    createPond(spot.x, spot.z, 6 + rand() * 3, 5 + rand() * 2, rand);
    placed++;
  }

  for (let tries = 0, placed = 0; tries < 60 && placed < 4; tries++) {
    const spot = findClearSpot(4.5, rand);
    if (!spot) continue;
    const d = districtFor(spot.x, spot.z);
    if (d !== "downtown" && d !== "commercial") continue;
    createFountain(spot.x, spot.z, rand);
    placed++;
  }
}
