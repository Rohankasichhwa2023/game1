// world.js
// Procedural GTA-style city:
//   road network → city blocks → sidewalks → building lots → buildings.
// Collision boxes (buildings/trees) are stored on `state` so the existing
// collision, minimap, and spawning systems keep working unchanged.

import * as THREE from "three";
import { state } from "./state.js";

const CITY_SEED = 20240815;

// Deterministic PRNG (mulberry32) so the same seed always produces the same city.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------- Textures ----------------
function generateGrassTexture() {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#3f7a2e";
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 220; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 40 + Math.random() * 160;
    const light = Math.random();
    const rgb = light > 0.5 ? "90, 170, 65" : "40, 90, 30";
    const alpha = 0.04 + Math.random() * 0.08;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${rgb}, ${alpha})`);
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 40000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const bladeW = 1 + Math.random() * 1.5;
    const bladeH = 2 + Math.random() * 4;
    const green = 85 + Math.floor(Math.random() * 75);
    const red = 35 + Math.floor(Math.random() * 30);
    const blue = 25 + Math.floor(Math.random() * 25);
    ctx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
    ctx.fillRect(x, y, bladeW, bladeH);
  }

  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = `rgba(60, 45, 25, ${0.1 + Math.random() * 0.25})`;
    ctx.fillRect(x, y, 1, 1);
  }

  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = `rgba(200, 220, 120, ${0.05 + Math.random() * 0.1})`;
    ctx.fillRect(x, y, 1, 1);
  }

  return canvas;
}

function clamp255(value) {
  return Math.min(255, Math.max(0, value));
}

// Seamless facade tile: a wall-colored panel with a framed, sky-reflecting window.
function generateBuildingTexture(baseColor) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const r = (baseColor >> 16) & 0xff;
  const g = (baseColor >> 8) & 0xff;
  const b = baseColor & 0xff;

  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 900; i++) {
    const nx = Math.floor(Math.random() * size);
    const ny = Math.floor(Math.random() * size);
    const v = Math.floor(Math.random() * 24) - 12;
    ctx.fillStyle = `rgba(${clamp255(r + v)}, ${clamp255(g + v)}, ${clamp255(b + v)}, 0.6)`;
    ctx.fillRect(nx, ny, 1, 1);
  }

  ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(size, 0);
  ctx.moveTo(0, size - 1);
  ctx.lineTo(size, size - 1);
  ctx.stroke();

  const margin = 22;
  const wx = margin;
  const wy = margin;
  const ww = size - margin * 2;
  const wh = size - margin * 2;
  ctx.fillStyle = "#2f2f2f";
  ctx.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);

  const glass = ctx.createLinearGradient(0, wy, 0, wy + wh);
  glass.addColorStop(0, "#bfe6f7");
  glass.addColorStop(0.45, "#7cb9d8");
  glass.addColorStop(0.55, "#5b93b5");
  glass.addColorStop(1, "#35607f");
  ctx.fillStyle = glass;
  ctx.fillRect(wx, wy, ww, wh);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(wx + ww * 0.15, wy + wh);
  ctx.lineTo(wx + ww * 0.5, wy);
  ctx.moveTo(wx + ww * 0.6, wy + wh);
  ctx.lineTo(wx + ww * 0.85, wy);
  ctx.stroke();

  ctx.strokeStyle = "#2f2f2f";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(wx + ww / 2, wy);
  ctx.lineTo(wx + ww / 2, wy + wh);
  ctx.moveTo(wx, wy + wh / 2);
  ctx.lineTo(wx + ww, wy + wh / 2);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ---------------- Districts ----------------
const DISTRICT = {
  downtown: {
    lotW: 18,
    lotD: 18,
    gap: 8,
    fill: 0.7,
    minH: 60,
    maxH: 200,
    colors: [
      0x6b7280, 0x4b5563, 0x9ca3af, 0x374151, 0x1f2937, 0x7c8899, 0x5b7a9d,
      0x8a97a8, 0x7a5a4a, 0x5a7a5a, 0x9a5a4a, 0x9a8a5a,
    ],
  },
  commercial: {
    lotW: 22,
    lotD: 22,
    gap: 10,
    fill: 0.5,
    minH: 24,
    maxH: 70,
    colors: [
      0x9c8a6a, 0x8a9a9a, 0x7a8a9a, 0xa0a0a0, 0x8f7f6f, 0x5f7f8f, 0x9a8a8a,
      0x6a8a8a, 0xb06a4a, 0x6a9a6a, 0xb0a050, 0x8a6a4a,
    ],
  },
  residential: {
    lotW: 16,
    lotD: 18,
    gap: 8,
    fill: 0.4,
    minH: 8,
    maxH: 22,
    colors: [0xd9c7a7, 0xc7b795, 0xb0a890, 0xd2b48c, 0xc7c0b0, 0xbfae8a],
  },
  industrial: {
    lotW: 30,
    lotD: 30,
    gap: 12,
    fill: 0.45,
    minH: 12,
    maxH: 30,
    colors: [0x8a8f95, 0x6f7478, 0x9aa0a6, 0x7f7f6f, 0x6a6f75],
  },
};

// ---------------- Building ----------------
function createBuilding(x, z, width, height, depth, palette) {
  const colors = palette || [
    0x808080, 0xa0a0a0, 0xc0c0c0, 0xdcdcdc, 0xaaaaaa, 0xffffff,
  ];
  const baseColor = colors[Math.floor(Math.random() * colors.length)];

  const facadeTexture = generateBuildingTexture(baseColor);
  facadeTexture.repeat.set(
    Math.max(1, Math.round(width / 5)),
    Math.max(1, Math.round(height / 5)),
  );

  const group = new THREE.Group();

  const baseGeometry = new THREE.BoxGeometry(width, height, depth);
  const baseMaterial = new THREE.MeshPhongMaterial({
    map: facadeTexture,
    shininess: 10,
  });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.castShadow = true;
  base.receiveShadow = true;
  base.position.set(x, height / 2, z);
  group.add(base);

  const roofGeometry = new THREE.BoxGeometry(width + 1.5, 1.5, depth + 1.5);
  const roofMaterial = new THREE.MeshPhongMaterial({
    color: 0x777777,
    shininess: 10,
  });
  const roof = new THREE.Mesh(roofGeometry, roofMaterial);
  roof.castShadow = true;
  roof.receiveShadow = true;
  roof.position.set(x, height + 0.75, z);
  group.add(roof);

  state.scene.add(group);

  return new THREE.Box3().setFromObject(group);
}

// ---------------- Hollow (enterable) buildings ----------------
// Residential houses and industrial warehouses are hollow: walls with a door
// opening, a floor, and a roof. Their parts are collected here and built as
// instanced meshes after generation for performance.

const hollowWalls = []; // { cx, cy, cz, w, h, d }
const hollowFloors = [];
const hollowRoofs = [];
const hollowWindows = [];

const HOLLOW_WALL_T = 0.4;
const HOLLOW_DOOR_W = 4.4; // entrance opening width
const HOLLOW_DOOR_H = 2.5; // normal door height
const WINDOW_W = 1.2;
const WINDOW_H = 1.5;
const WINDOW_Y = 1.8;

// Wall palettes for hollow buildings (houses vs warehouses).
const HOUSE_COLORS = [
  0xb05a4a, // reddish
  0x6a9a5a, // green
  0xc9b04a, // yellow
  0x8a5a3a, // brown
  0x8a8a8a, // grey
  0x5a7a9a, // blue
  0xa86a3a, // orange-brown
  0xd8d0c0, // cream
];
const INDUSTRIAL_COLORS = [
  0x8a8a8a, 0x9a9aa0, 0x6a6a6a, 0x7a5a4a, 0x8a6a5a, 0x5a5a5a,
];

function createHollowBuilding(
  x,
  z,
  width,
  height,
  depth,
  doorSides,
  wallColor,
) {
  const wallT = HOLLOW_WALL_T;
  const doorW = HOLLOW_DOOR_W;
  const doorH = HOLLOW_DOOR_H;
  const halfW = width / 2;
  const halfD = depth / 2;

  // Floor (visual).
  hollowFloors.push({
    cx: x,
    cy: 0.15,
    cz: z,
    w: width - wallT * 2,
    h: 0.3,
    d: depth - wallT * 2,
  });

  // Roof (visual + collision; also lets the player stand on top).
  hollowRoofs.push({
    cx: x,
    cy: height + 0.5,
    cz: z,
    w: width + 0.5,
    h: 1,
    d: depth + 0.5,
  });
  state.buildingBoxes.push(
    new THREE.Box3(
      new THREE.Vector3(x - (width + 0.5) / 2, height, z - (depth + 0.5) / 2),
      new THREE.Vector3(
        x + (width + 0.5) / 2,
        height + 1,
        z + (depth + 0.5) / 2,
      ),
    ),
  );

  // Interior footprint (used as the "safe zone" while inside).
  state.buildingInteriors.push({
    minX: x - halfW + wallT,
    maxX: x + halfW - wallT,
    minZ: z - halfD + wallT,
    maxZ: z + halfD - wallT,
    minY: 0,
    maxY: height,
  });

  // Add a wall segment (axis 'x' = runs along X, 'z' = runs along Z).
  const addWallSegment = (axis, fixed, a, b, y0, y1) => {
    const cy = (y0 + y1) / 2,
      h = y1 - y0;
    if (axis === "x") {
      hollowWalls.push({
        cx: (a + b) / 2,
        cy,
        cz: fixed,
        w: b - a,
        h,
        d: wallT,
        color: wallColor,
      });
      state.buildingBoxes.push(
        new THREE.Box3(
          new THREE.Vector3(a, y0, fixed - wallT / 2),
          new THREE.Vector3(b, y1, fixed + wallT / 2),
        ),
      );
    } else {
      hollowWalls.push({
        cx: fixed,
        cy,
        cz: (a + b) / 2,
        w: wallT,
        h,
        d: b - a,
        color: wallColor,
      });
      state.buildingBoxes.push(
        new THREE.Box3(
          new THREE.Vector3(fixed - wallT / 2, y0, a),
          new THREE.Vector3(fixed + wallT / 2, y1, b),
        ),
      );
    }
  };

  // Add windows along a wall run.
  const addWindows = (axis, fixed, a, b, withDoor, doorCenter) => {
    const winD = wallT + 0.2;
    const step = 3.2;
    const rowStep = 3.2;
    for (let wy = WINDOW_Y; wy < height - WINDOW_H / 2; wy += rowStep) {
      for (let pos = a + step / 2; pos < b - WINDOW_W / 2; pos += step) {
        // Skip windows around the door opening (ground floor only).
        if (
          withDoor &&
          wy < doorH &&
          Math.abs(pos - doorCenter) < doorW / 2 + WINDOW_W
        )
          continue;
        if (axis === "x") {
          hollowWindows.push({
            cx: pos,
            cy: wy,
            cz: fixed,
            w: WINDOW_W,
            h: WINDOW_H,
            d: winD,
          });
        } else {
          hollowWindows.push({
            cx: fixed,
            cy: wy,
            cz: pos,
            w: winD,
            h: WINDOW_H,
            d: WINDOW_W,
          });
        }
      }
    }
  };

  // Build the four walls; a side gets a door-height opening if it's an entrance.
  const buildSide = (axis, fixed, a, b, side) => {
    const center = (a + b) / 2;
    const isDoorSide = doorSides.includes(side);
    if (isDoorSide) {
      const d0 = center - doorW / 2;
      const d1 = center + doorW / 2;
      if (d0 > a + 0.1) addWallSegment(axis, fixed, a, d0, 0, height);
      if (d1 < b - 0.1) addWallSegment(axis, fixed, d1, b, 0, height);
      if (height > doorH) addWallSegment(axis, fixed, d0, d1, doorH, height); // lintel
      // Open entrance below the lintel (door-height gap).
    } else {
      addWallSegment(axis, fixed, a, b, 0, height);
    }
    addWindows(axis, fixed, a, b, isDoorSide, center);
  };

  buildSide("x", z + halfD, x - halfW, x + halfW, "north");
  buildSide("x", z - halfD, x - halfW, x + halfW, "south");
  buildSide("z", x + halfW, z - halfD, z + halfD, "east");
  buildSide("z", x - halfW, z - halfD, z + halfD, "west");
}

// Build the collected hollow-building parts as instanced meshes.
function buildInstancedBoxes(rects, color) {
  if (!rects.length) return;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ color, shininess: 5 }),
    rects.length,
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    p.set(r.cx, r.cy, r.cz);
    s.set(r.w, r.h, r.d);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  state.scene.add(mesh);
}

function buildInstancedWalls(rects) {
  if (!rects.length) return;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 5 }),
    rects.length,
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    p.set(r.cx, r.cy, r.cz);
    s.set(r.w, r.h, r.d);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setHex(r.color));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  state.scene.add(mesh);
}

function buildHollowInstances() {
  buildInstancedWalls(hollowWalls); // per-building wall colors
  buildInstancedBoxes(hollowWindows, 0x7fb8d8); // sky-blue glass
  buildInstancedBoxes(hollowFloors, 0x9c7a4c); // wood floor
  buildInstancedBoxes(hollowRoofs, 0x666666); // dark roof/ceiling
}

// ---------------- Road network ----------------
function buildRoadNetwork() {
  const half = state.groundSize / 2;

  // Hierarchy: arterial (widest), secondary, local streets.
  const verticals = [
    { x: -360, width: 18, type: "secondary" },
    { x: -240, width: 12, type: "local" },
    { x: -120, width: 12, type: "local" },
    { x: 0, width: 38, type: "arterial" },
    { x: 120, width: 12, type: "local" },
    { x: 240, width: 12, type: "local" },
    { x: 360, width: 18, type: "secondary" },
  ];
  const horizontals = [
    { z: -360, width: 18, type: "secondary" },
    { z: -240, width: 12, type: "local" },
    { z: -120, width: 12, type: "local" },
    { z: 0, width: 38, type: "arterial" },
    { z: 120, width: 12, type: "local" },
    { z: 240, width: 12, type: "local" },
    { z: 360, width: 18, type: "secondary" },
  ];

  const roads = [];
  for (const v of verticals) {
    roads.push({
      minX: v.x - v.width / 2,
      maxX: v.x + v.width / 2,
      minZ: -half,
      maxZ: half,
      type: v.type,
    });
  }
  for (const h of horizontals) {
    roads.push({
      minX: -half,
      maxX: half,
      minZ: h.z - h.width / 2,
      maxZ: h.z + h.width / 2,
      type: h.type,
    });
  }

  return { roads, verticals, horizontals };
}

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

function districtFor(cx, cz) {
  // A grass park band in the north-east.
  if (cx > 120 && cx < 368 && cz > 240) return "park";
  const dist = Math.hypot(cx, cz);
  if (dist < 150) return "downtown";
  if (cx > 120 && cz < -120) return "industrial";
  if (dist > 320) return "residential";
  return "commercial";
}

function placeTree(x, z, treePositions) {
  treePositions.push({ x, z });
  state.treeBoxes.push(
    new THREE.Box3(
      new THREE.Vector3(x - 0.5, 0, z - 0.5),
      new THREE.Vector3(x + 0.5, 5, z + 0.5),
    ),
  );
}

function generateBlockBuildings(block, district, rand, treePositions) {
  const sidewalk = 5; // sidewalk inset around the block
  const x0 = block.x0 + sidewalk,
    x1 = block.x1 - sidewalk;
  const z0 = block.z0 + sidewalk,
    z1 = block.z1 - sidewalk;
  const bw = x1 - x0,
    bd = z1 - z0;
  if (bw < 8 || bd < 8) return;

  const cfg = DISTRICT[district];
  const cols = Math.max(1, Math.floor(bw / (cfg.lotW + cfg.gap)));
  const rows = Math.max(1, Math.floor(bd / (cfg.lotD + cfg.gap)));
  const cw = bw / cols,
    cd = bd / rows;

  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const lx0 = x0 + i * cw,
        lx1 = lx0 + cw;
      const lz0 = z0 + j * cd,
        lz1 = lz0 + cd;

      // Empty lot / plaza: plant a tree so the ground doesn't look bare.
      if (rand() > cfg.fill) {
        if (rand() < 0.9) {
          const tx = (lx0 + lx1) / 2 + (rand() - 0.5) * cw * 0.4;
          const tz = (lz0 + lz1) / 2 + (rand() - 0.5) * cd * 0.4;
          placeTree(tx, tz, treePositions);
        }
        continue;
      }

      const margin = 1.5;
      const maxW = lx1 - lx0 - margin * 2;
      const maxD = lz1 - lz0 - margin * 2;
      if (maxW < 3 || maxD < 3) continue;

      const w = Math.max(3, Math.min(maxW, cfg.lotW * (0.6 + rand() * 0.5)));
      const d = Math.max(3, Math.min(maxD, cfg.lotD * (0.6 + rand() * 0.5)));
      const cx = lx0 + margin + (maxW - w) / 2 + (rand() - 0.5) * 2;
      const cz = lz0 + margin + (maxD - d) / 2 + (rand() - 0.5) * 2;
      const h = cfg.minH + rand() * (cfg.maxH - cfg.minH);

      // All buildings are hollow (enterable), with the door facing the
      // nearest road (block edge).
      const edges = [
        { side: "south", d: cz - block.z0 },
        { side: "north", d: block.z1 - cz },
        { side: "west", d: cx - block.x0 },
        { side: "east", d: block.x1 - cx },
      ];
      edges.sort((a, b) => a.d - b.d);
      const palette =
        district === "residential"
          ? HOUSE_COLORS
          : district === "industrial"
            ? INDUSTRIAL_COLORS
            : cfg.colors;
      const wallColor = palette[Math.floor(rand() * palette.length)];
      const doorSides = [edges[0].side, edges[1].side]; // entrances on two sides
      createHollowBuilding(cx, cz, w, h, d, doorSides, wallColor);
    }
  }

  // Street trees along the sidewalk perimeter to fill the empty green edges.
  const s = sidewalk / 2;
  const addStreetTrees = (axis, fixed, a, b) => {
    for (let pos = a + 2.5; pos <= b - 2.5; pos += 10) {
      if (rand() < 0.45) {
        if (axis === "x") placeTree(pos, fixed, treePositions);
        else placeTree(fixed, pos, treePositions);
      }
    }
  };
  addStreetTrees("x", block.z0 + s, block.x0, block.x1); // south sidewalk
  addStreetTrees("x", block.z1 - s, block.x0, block.x1); // north sidewalk
  addStreetTrees("z", block.x0 + s, block.z0, block.z1); // west sidewalk
  addStreetTrees("z", block.x1 - s, block.z0, block.z1); // east sidewalk
}

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

function brickMaterial(length) {
  const tex = getBrickTexture().clone();
  tex.needsUpdate = true;
  tex.repeat.set(Math.max(1, Math.round(length / 4)), 1);
  return new THREE.MeshPhongMaterial({ map: tex, shininess: 5 });
}

// Adds a single low wall segment (w = size along X, d = size along Z).
function addColonyWallSegment(cx, cz, w, d) {
  const h = COLONY_WALL_HEIGHT;
  const length = Math.max(w, d);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    brickMaterial(length),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(cx, h / 2, cz);
  state.scene.add(mesh);

  state.wallBoxes.push(
    new THREE.Box3(
      new THREE.Vector3(cx - w / 2, 0, cz - d / 2),
      new THREE.Vector3(cx + w / 2, h, cz + d / 2),
    ),
  );
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

  const sides = ["south", "north", "east", "west"];
  const gateSide = sides[Math.floor(rand() * sides.length)];

  // Determine which sides border a narrow local road.
  const southLocal = adjacentRoadType(z0, horizontals, false) === "local";
  const northLocal = adjacentRoadType(z1, horizontals, false) === "local";
  const westLocal = adjacentRoadType(x0, verticals, true) === "local";
  const eastLocal = adjacentRoadType(x1, verticals, true) === "local";

  // Add a wall run along one axis; split around the gate if it's the gate side.
  const addRun = (isVertical, fixed, a, b, isGateSide, skip) => {
    if (skip) return;
    if (isGateSide) {
      const gateCenter = a + (b - a) * (0.3 + rand() * 0.4);
      const g0 = gateCenter - gateW / 2;
      const g1 = gateCenter + gateW / 2;
      if (g0 > a + 0.5) {
        if (isVertical) addColonyWallSegment(fixed, (a + g0) / 2, t, g0 - a);
        else addColonyWallSegment((a + g0) / 2, fixed, g0 - a, t);
      }
      if (g1 < b - 0.5) {
        if (isVertical) addColonyWallSegment(fixed, (g1 + b) / 2, t, b - g1);
        else addColonyWallSegment((g1 + b) / 2, fixed, b - g1, t);
      }
    } else {
      if (isVertical) addColonyWallSegment(fixed, (a + b) / 2, t, b - a);
      else addColonyWallSegment((a + b) / 2, fixed, b - a, t);
    }
  };

  addRun(false, z0, x0, x1, gateSide === "south", southLocal); // south
  addRun(false, z1, x0, x1, gateSide === "north", northLocal); // north
  addRun(true, x0, z0, z1, gateSide === "west", westLocal); // west
  addRun(true, x1, z0, z1, gateSide === "east", eastLocal); // east
}

function generateCity(rand) {
  const { roads, verticals, horizontals } = buildRoadNetwork();
  state.roads = roads;

  const blocks = buildBlocks(verticals, horizontals);
  const treePositions = [];

  for (const block of blocks) {
    const cx = (block.x0 + block.x1) / 2;
    const cz = (block.z0 + block.z1) / 2;
    const district = districtFor(cx, cz);

    if (district === "park") {
      // Open grass area with trees, no buildings.
      const area = (block.x1 - block.x0) * (block.z1 - block.z0);
      const n = Math.max(4, Math.floor(area / 400));
      for (let i = 0; i < n; i++) {
        const tx = block.x0 + 4 + rand() * (block.x1 - block.x0 - 8);
        const tz = block.z0 + 4 + rand() * (block.z1 - block.z0 - 8);
        placeTree(tx, tz, treePositions);
      }
      continue;
    }

    generateBlockBuildings(block, district, rand, treePositions);

    // Every block gets a low brick boundary wall with a gate opening
    // (skipped on sides that border narrow local roads).
    addColonyWallsForBlock(block, rand, verticals, horizontals);
  }

  return { roads, treePositions };
}

// ---------------- Visual meshes ----------------
function addFlatPlane(minX, maxX, minZ, maxZ, y, color, shininess) {
  const w = maxX - minX;
  const d = maxZ - minZ;
  const geo = new THREE.PlaneGeometry(w, d);
  const mat = new THREE.MeshPhongMaterial({ color, shininess });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((minX + maxX) / 2, y, (minZ + maxZ) / 2);
  mesh.receiveShadow = true;
  state.scene.add(mesh);
  return mesh;
}

function addCenterLine(rect, color, y) {
  const w = rect.maxX - rect.minX;
  const d = rect.maxZ - rect.minZ;
  const vertical = w < d;
  const geo = vertical
    ? new THREE.PlaneGeometry(0.6, d)
    : new THREE.PlaneGeometry(w, 0.6);
  const mat = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(
    (rect.minX + rect.maxX) / 2,
    y,
    (rect.minZ + rect.maxZ) / 2,
  );
  state.scene.add(mesh);
}

function buildTreeInstances(positions) {
  const count = positions.length;
  if (count === 0) return;

  const trunkGeometry = new THREE.CylinderGeometry(0.5, 0.5, 5);
  const trunkMaterial = new THREE.MeshPhongMaterial({ color: 0x8b4513 });
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, count);
  trunks.castShadow = true;
  trunks.receiveShadow = true;
  trunks.frustumCulled = false;

  const foliageGeometry = new THREE.SphereGeometry(3, 10, 10);
  const foliageMaterial = new THREE.MeshPhongMaterial({ color: 0x228b22 });
  const foliage = new THREE.InstancedMesh(
    foliageGeometry,
    foliageMaterial,
    count,
  );
  foliage.castShadow = true;
  foliage.receiveShadow = true;
  foliage.frustumCulled = false;

  const matrix = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const { x, z } = positions[i];
    matrix.setPosition(x, 2.5, z);
    trunks.setMatrixAt(i, matrix);
    matrix.setPosition(x, 6, z);
    foliage.setMatrixAt(i, matrix);
  }
  trunks.instanceMatrix.needsUpdate = true;
  foliage.instanceMatrix.needsUpdate = true;
  state.scene.add(trunks);
  state.scene.add(foliage);
}

// Perimeter boundary wall around the map edge so the city feels enclosed.
function addPerimeterWalls() {
  const half = state.groundSize / 2;
  const thickness = 2;
  const height = 6;
  const inset = half - 1; // wall center, just inside the ground edge
  const length = half * 2 + thickness * 2;
  const material = new THREE.MeshPhongMaterial({
    color: 0x9aa0a6,
    shininess: 5,
  });

  const walls = [
    { w: length, d: thickness, x: 0, z: -inset }, // south
    { w: length, d: thickness, x: 0, z: inset }, // north
    { w: thickness, d: length, x: -inset, z: 0 }, // west
    { w: thickness, d: length, x: inset, z: 0 }, // east
  ];

  for (const w of walls) {
    const geo = new THREE.BoxGeometry(w.w, height, w.d);
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(w.x, height / 2, w.z);
    state.scene.add(mesh);

    state.wallBoxes.push(
      new THREE.Box3(
        new THREE.Vector3(w.x - w.w / 2, 0, w.z - w.d / 2),
        new THREE.Vector3(w.x + w.w / 2, height, w.z + w.d / 2),
      ),
    );
  }
}

// ---------------- World initialization ----------------
export function initWorld() {
  const groundSize = state.groundSize;

  // Reset world data (initWorld may be called once, but keep it safe).
  state.treeBoxes.length = 0;
  state.buildingBoxes.length = 0;
  state.wallBoxes.length = 0;
  state.roads = [];
  state.buildingInteriors = [];
  hollowWalls.length = 0;
  hollowFloors.length = 0;
  hollowRoofs.length = 0;
  hollowWindows.length = 0;

  // Base ground (grass — visible in parks and gaps).
  const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
  const grassTextureCanvas = generateGrassTexture();
  const grassTexture = new THREE.CanvasTexture(grassTextureCanvas);
  grassTexture.wrapS = THREE.RepeatWrapping;
  grassTexture.wrapT = THREE.RepeatWrapping;
  grassTexture.repeat.set(groundSize / 5, groundSize / 5);
  grassTexture.colorSpace = THREE.SRGBColorSpace;
  grassTexture.anisotropy = Math.min(
    16,
    state.renderer.capabilities.getMaxAnisotropy(),
  );

  const groundMaterial = new THREE.MeshPhongMaterial({
    map: grassTexture,
    side: THREE.DoubleSide,
  });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  state.scene.add(ground);

  // Generate the city layout (buildings + trees + collision boxes + road data).
  const rand = mulberry32(CITY_SEED);
  const { roads, treePositions } = generateCity(rand);

  // Road surfaces (asphalt). Slightly offset by orientation to avoid
  // z-fighting where roads cross at intersections.
  for (const road of roads) {
    const vertical = road.maxX - road.minX < road.maxZ - road.minZ;
    addFlatPlane(
      road.minX,
      road.maxX,
      road.minZ,
      road.maxZ,
      vertical ? 0.011 : 0.01,
      0x2c2f33,
      5,
    );
  }

  // Lane markings.
  for (const road of roads) {
    if (road.type === "arterial") addCenterLine(road, 0xffd75e, 0.03);
    else if (road.type === "secondary") addCenterLine(road, 0xffffff, 0.03);
  }

  // Trees (instanced).
  buildTreeInstances(treePositions);

  // Hollow buildings (instanced walls/floors/roofs).
  buildHollowInstances();

  // Perimeter walls (city boundary).
  addPerimeterWalls();
}

// Returns a ground position (x, z) that is clear of all static obstacles
// (buildings, trees, walls), so entities never spawn trapped inside geometry.
export function findClearSpawnPosition() {
  const half = 1.0; // half footprint (0.5) + clearance margin
  const range = state.groundSize / 2 - 20;

  const isClear = (x, z) => {
    const box = new THREE.Box3(
      new THREE.Vector3(x - half, 0, z - half),
      new THREE.Vector3(x + half, 2, z + half),
    );
    for (const treeBox of state.treeBoxes) {
      if (box.intersectsBox(treeBox)) return false;
    }
    for (const buildingBox of state.buildingBoxes) {
      if (box.intersectsBox(buildingBox)) return false;
    }
    for (const wallBox of state.wallBoxes) {
      if (box.intersectsBox(wallBox)) return false;
    }
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
