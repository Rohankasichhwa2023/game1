// buildings.js
// European-style hollow (enterable) buildings: district palettes, facade
// decoration (trim/shutters/balconies/shopfronts), roofs, and the instanced
// meshes that render every collected wall/window/facade part.

import * as THREE from "three";
import { state } from "./state.js";
import {
  addFrozenStatic,
  addIndexedBox,
  buildingIndex,
  sharedUnitBoxGeometry,
  sharedColoredBoxMaterial,
  getBoxMaterial,
  _v1,
  _v2,
  _matrix,
  _quaternion,
  _color,
} from "./placement.js";

// ---------------- European city districts ----------------
export const DISTRICT = {
  downtown: {
    lotW: 22,
    lotD: 20,
    gap: 5,
    fill: 0.9,
    minStories: 4,
    maxStories: 10,
    colors: [
      0xd8c1a2, 0xc9b49a, 0xe0d2bb, 0xb7a48d, 0xa9a9a2, 0xc6c7c1, 0x8f9aa3,
      0xb77a5c, 0x9c6f5b, 0xd4a373, 0xc4b6a0,
    ],
    roofColors: [0x4b3c35, 0x5a4a40, 0x6b5548, 0x75604d],
  },
  commercial: {
    lotW: 25,
    lotD: 22,
    gap: 6,
    fill: 0.78,
    minStories: 3,
    maxStories: 7,
    colors: [
      0xe4d2b5, 0xd9c2a5, 0xcab89e, 0xefe2ca, 0xa89b8a, 0xc7a88a, 0xb86f59,
      0x8e9a9a, 0x9a7b68, 0xd0c0a5,
    ],
    roofColors: [0x4b4038, 0x604e42, 0x6c5a4d, 0x7b6c5a],
  },
  residential: {
    lotW: 18,
    lotD: 20,
    gap: 5,
    fill: 0.68,
    minStories: 3,
    maxStories: 6,
    colors: [
      0xe8d9bc, 0xd7c19e, 0xcbb08e, 0xf0e3cc, 0xb7c2c6, 0xb9a59d, 0xd1a58d,
      0x9f7770, 0xc5b69b, 0xd9c6ae,
    ],
    roofColors: [0x6a4f43, 0x73554a, 0x655048, 0x806252],
  },
  industrial: {
    lotW: 28,
    lotD: 28,
    gap: 10,
    fill: 0.5,
    minStories: 3,
    maxStories: 5,
    colors: [0x8c8178, 0x7e8888, 0x9a8f83, 0x766f68, 0x9a785f, 0x7b858a],
    roofColors: [0x4f5151, 0x5a5a57, 0x665c52],
  },
};

export const EUROPEAN_STYLES = [
  "parisian",
  "belgian",
  "neoHaussmann",
  "oldTown",
  "brickTownhouse",
  "artNouveau",
  "modernEuropean",
];

const FACADE_LIGHT = [0xf5ead7, 0xe8dcc8, 0xded4c2, 0xf2e5d0];
const FACADE_DARK = [0x51453f, 0x625149, 0x4a4a47, 0x735f50];
const ACCENT_COLORS = [0x5f7180, 0x6d4f42, 0x7e5e50, 0x53676d, 0x7b6a56];

// Decorative geometry is collected and instanced for performance.
const facadeTrim = [];
const facadeBalconies = [];
const facadeRailings = [];
const facadeShutters = [];
const facadeAwnings = [];
const facadeColumns = [];
const facadeShopfronts = [];
const facadeParapets = [];
const roofConeInstances = [];
const roofBoxInstances = [];

function addFacadeBox(target, cx, cy, cz, w, h, d, color) {
  target.push({ cx, cy, cz, w, h, d, color });
}

function addEuropeanRoof(x, z, width, depth, height, style, roofColor, rand) {
  const roofY = height + 0.15;
  const maxDim = Math.max(width, depth);

  if (style === "parisian" || style === "neoHaussmann") {
    const coneHeight = 3.3 + rand() * 1.2;
    roofConeInstances.push({
      x,
      y: roofY + 1.45,
      z,
      radiusScale: maxDim * 0.68,
      height: coneHeight,
      depthScale: Math.min(1, depth / maxDim),
      rotation: Math.PI / 4,
      color: roofColor,
    });

    roofBoxInstances.push({
      x,
      y: roofY + 3.15,
      z,
      w: width * 0.72,
      h: 0.35,
      d: depth * 0.72,
      color: FACADE_DARK[Math.floor(rand() * FACADE_DARK.length)],
    });
    return;
  }

  if (
    style === "oldTown" ||
    style === "brickTownhouse" ||
    style === "artNouveau"
  ) {
    const coneHeight = 2.4 + rand() * 1.1;
    roofConeInstances.push({
      x,
      y: roofY + 1.0,
      z,
      radiusScale: maxDim * 0.62,
      height: coneHeight,
      depthScale: Math.min(1, depth / maxDim),
      rotation: Math.PI / 4,
      color: roofColor,
    });
    return;
  }

  roofBoxInstances.push({
    x,
    y: height + 0.55,
    z,
    w: width + 0.7,
    h: 0.8,
    d: depth + 0.7,
    color: roofColor,
  });
}

function decorateEuropeanFacade({
  x,
  z,
  width,
  height,
  depth,
  stories,
  style,
  wallColor,
  rand,
  district,
}) {
  const floorH = height / Math.max(1, stories);
  const frontIsX = rand() < 0.5;
  const frontSign = frontIsX ? 1 : 1;
  const frontOffset = frontIsX ? depth / 2 : width / 2;
  const facadeSpan = frontIsX ? width : depth;
  const facadeDepth = 0.08;
  const trimColor =
    style === "brickTownhouse"
      ? 0xc8b9a1
      : FACADE_LIGHT[Math.floor(rand() * FACADE_LIGHT.length)];
  const darkTrim = FACADE_DARK[Math.floor(rand() * FACADE_DARK.length)];
  const accent = ACCENT_COLORS[Math.floor(rand() * ACCENT_COLORS.length)];

  // Ground-floor shopfronts make downtown/commercial blocks feel European.
  if (district === "downtown" || district === "commercial") {
    if (frontIsX) {
      addFacadeBox(
        facadeShopfronts,
        x,
        Math.max(1.8, floorH * 0.46),
        z + frontOffset + frontSign * 0.08,
        facadeSpan * 0.82,
        Math.min(3.0, floorH * 0.72),
        0.12,
        rand() < 0.5 ? 0x6c7779 : accent,
      );
      addFacadeBox(
        facadeAwnings,
        x,
        Math.min(3.6, floorH * 0.92),
        z + frontOffset + 0.32,
        facadeSpan * 0.72,
        0.18,
        0.9,
        accent,
      );
    } else {
      addFacadeBox(
        facadeShopfronts,
        x + frontOffset + 0.08,
        Math.max(1.8, floorH * 0.46),
        z,
        0.12,
        Math.min(3.0, floorH * 0.72),
        facadeSpan * 0.82,
        rand() < 0.5 ? 0x6c7779 : accent,
      );
      addFacadeBox(
        facadeAwnings,
        x + frontOffset + 0.32,
        Math.min(3.6, floorH * 0.92),
        z,
        0.9,
        0.18,
        facadeSpan * 0.72,
        accent,
      );
    }
  }

  // Strong horizontal cornices: characteristic of Parisian/Belgian streets.
  const addHorizontalTrim = (y, thickness = 0.16, depthOut = 0.2) => {
    if (frontIsX) {
      addFacadeBox(
        facadeTrim,
        x,
        y,
        z + frontOffset + 0.03,
        facadeSpan * 0.96,
        thickness,
        depthOut,
        trimColor,
      );
    } else {
      addFacadeBox(
        facadeTrim,
        x + frontOffset + 0.03,
        y,
        z,
        depthOut,
        thickness,
        facadeSpan * 0.96,
        trimColor,
      );
    }
  };

  for (let floor = 1; floor <= stories; floor++) {
    const floorY = floor * floorH;

    if (floor < stories) {
      const trimChance =
        style === "neoHaussmann" || style === "parisian" ? 0.75 : 0.38;
      if (rand() < trimChance) addHorizontalTrim(floorY + 0.02);
    }

    // Window/balcony rhythm.
    const windowCount = Math.max(2, Math.min(7, Math.floor(facadeSpan / 3.1)));
    const margin = facadeSpan / Math.max(2, windowCount + 1);
    const step = facadeSpan / (windowCount + 1);

    for (let i = 1; i <= windowCount; i++) {
      if (rand() < (style === "oldTown" ? 0.16 : 0.06)) continue;

      const along = -facadeSpan / 2 + i * step;
      const windowW = style === "artNouveau" ? 1.35 : 1.15;
      const windowH = Math.min(1.85, floorH * 0.58);
      const windowY = floorY - floorH * 0.5;

      // Projected window surround.
      if (frontIsX) {
        addFacadeBox(
          facadeTrim,
          x + along,
          windowY,
          z + frontOffset + 0.11,
          windowW + 0.22,
          windowH + 0.22,
          0.14,
          trimColor,
        );
        addFacadeBox(
          facadeTrim,
          x + along,
          windowY,
          z + frontOffset + 0.18,
          windowW * 0.86,
          windowH * 0.86,
          0.08,
          0x6b9ab5,
        );
      } else {
        addFacadeBox(
          facadeTrim,
          x + frontOffset + 0.11,
          windowY,
          z + along,
          0.14,
          windowH + 0.22,
          windowW + 0.22,
          trimColor,
        );
        addFacadeBox(
          facadeTrim,
          x + frontOffset + 0.18,
          windowY,
          z + along,
          0.08,
          windowH * 0.86,
          windowW * 0.86,
          0x6b9ab5,
        );
      }

      // Shutters on older French/Belgian styles.
      const shutterChance =
        style === "parisian" || style === "oldTown" || style === "artNouveau"
          ? 0.7
          : 0.2;
      if (rand() < shutterChance) {
        const shutterW = 0.22;
        if (frontIsX) {
          addFacadeBox(
            facadeShutters,
            x + along - windowW * 0.62,
            windowY,
            z + frontOffset + 0.16,
            shutterW,
            windowH * 0.9,
            0.06,
            accent,
          );
          addFacadeBox(
            facadeShutters,
            x + along + windowW * 0.62,
            windowY,
            z + frontOffset + 0.16,
            shutterW,
            windowH * 0.9,
            0.06,
            accent,
          );
        } else {
          addFacadeBox(
            facadeShutters,
            x + frontOffset + 0.16,
            windowY,
            z + along - windowW * 0.62,
            0.06,
            windowH * 0.9,
            shutterW,
            accent,
          );
          addFacadeBox(
            facadeShutters,
            x + frontOffset + 0.16,
            windowY,
            z + along + windowW * 0.62,
            0.06,
            windowH * 0.9,
            shutterW,
            accent,
          );
        }
      }

      // Juliet/French balcony every few floors.
      const balconyChance =
        style === "parisian" || style === "neoHaussmann"
          ? 0.3
          : style === "artNouveau"
            ? 0.38
            : 0.12;
      if (floor >= 2 && rand() < balconyChance && i % 2 === 1) {
        const balconyW = Math.min(2.5, windowW + 0.8);
        const balconyDepth = 0.75;
        const balconyY = windowY - windowH * 0.45;
        if (frontIsX) {
          addFacadeBox(
            facadeBalconies,
            x + along,
            balconyY,
            z + frontOffset + 0.45,
            balconyW,
            0.13,
            balconyDepth,
            trimColor,
          );
          addFacadeBox(
            facadeRailings,
            x + along,
            balconyY + 0.5,
            z + frontOffset + 0.7,
            balconyW,
            0.75,
            0.07,
            darkTrim,
          );
          addFacadeBox(
            facadeRailings,
            x + along - balconyW / 2,
            balconyY + 0.35,
            z + frontOffset + 0.47,
            0.07,
            0.55,
            0.07,
            darkTrim,
          );
          addFacadeBox(
            facadeRailings,
            x + along + balconyW / 2,
            balconyY + 0.35,
            z + frontOffset + 0.47,
            0.07,
            0.55,
            0.07,
            darkTrim,
          );
        } else {
          addFacadeBox(
            facadeBalconies,
            x + frontOffset + 0.45,
            balconyY,
            z + along,
            balconyDepth,
            0.13,
            balconyW,
            trimColor,
          );
          addFacadeBox(
            facadeRailings,
            x + frontOffset + 0.7,
            balconyY + 0.5,
            z + along,
            0.07,
            0.75,
            balconyW,
            darkTrim,
          );
          addFacadeBox(
            facadeRailings,
            x + frontOffset + 0.47,
            balconyY + 0.35,
            z + along - balconyW / 2,
            0.07,
            0.55,
            0.07,
            darkTrim,
          );
          addFacadeBox(
            facadeRailings,
            x + frontOffset + 0.47,
            balconyY + 0.35,
            z + along + balconyW / 2,
            0.07,
            0.55,
            0.07,
            darkTrim,
          );
        }
      }
    }
  }

  // Corner pilasters, especially on Haussmann/art-nouveau façades.
  if (
    style === "neoHaussmann" ||
    style === "parisian" ||
    style === "artNouveau"
  ) {
    const pilasterW = 0.28;
    const pilasterD = 0.24;
    const pilasterX = [x - width / 2 + 0.22, x + width / 2 - 0.22];
    const pilasterZ = [z - depth / 2 + 0.22, z + depth / 2 - 0.22];
    for (const px of pilasterX) {
      addFacadeBox(
        facadeColumns,
        px,
        height / 2,
        z - depth / 2 - 0.03,
        pilasterW,
        height * 0.92,
        pilasterD,
        trimColor,
      );
      addFacadeBox(
        facadeColumns,
        px,
        height / 2,
        z + depth / 2 + 0.03,
        pilasterW,
        height * 0.92,
        pilasterD,
        trimColor,
      );
    }
    for (const pz of pilasterZ) {
      addFacadeBox(
        facadeColumns,
        x - width / 2 - 0.03,
        height / 2,
        pz,
        pilasterD,
        height * 0.92,
        pilasterW,
        trimColor,
      );
      addFacadeBox(
        facadeColumns,
        x + width / 2 + 0.03,
        height / 2,
        pz,
        pilasterD,
        height * 0.92,
        pilasterW,
        trimColor,
      );
    }
  }

  // Decorative top cornice/parapet.
  if (style !== "modernEuropean") {
    if (frontIsX) {
      addFacadeBox(
        facadeParapets,
        x,
        height + 0.32,
        z + frontOffset + 0.04,
        facadeSpan * 1.02,
        0.55,
        0.35,
        trimColor,
      );
    } else {
      addFacadeBox(
        facadeParapets,
        x + frontOffset + 0.04,
        height + 0.32,
        z,
        0.35,
        0.55,
        facadeSpan * 1.02,
        trimColor,
      );
    }
  }

  // A compact sign band on commercial frontage.
  if (district === "commercial" && rand() < 0.5) {
    const signColor = rand() < 0.5 ? 0x35424a : 0x675043;
    if (frontIsX) {
      addFacadeBox(
        facadeAwnings,
        x,
        Math.min(height - 0.9, floorH * 2.05),
        z + frontOffset + 0.26,
        facadeSpan * 0.56,
        0.32,
        0.12,
        signColor,
      );
    } else {
      addFacadeBox(
        facadeAwnings,
        x + frontOffset + 0.26,
        Math.min(height - 0.9, floorH * 2.05),
        z,
        0.12,
        0.32,
        facadeSpan * 0.56,
        signColor,
      );
    }
  }

  addEuropeanRoof(
    x,
    z,
    width,
    depth,
    height,
    style,
    roofColorFor(style, rand),
    rand,
  );
}

export function roofColorFor(style, rand) {
  if (style === "brickTownhouse" || style === "oldTown") {
    return [0x743f32, 0x6c4638, 0x855041, 0x59443b][Math.floor(rand() * 4)];
  }
  if (style === "modernEuropean") {
    return [0x4a4e50, 0x55595a, 0x64605a][Math.floor(rand() * 3)];
  }
  return [0x4e4039, 0x5a4940, 0x6b5345, 0x72594a][Math.floor(rand() * 4)];
}

// ---------------- Hollow (enterable) buildings ----------------
const hollowWalls = []; // { cx, cy, cz, w, h, d, color }
const hollowFloors = [];
const hollowRoofs = [];
const hollowWindows = [];

const HOLLOW_WALL_T = 0.4;
const HOLLOW_DOOR_W = 3.2;
const HOLLOW_DOOR_H = 2.5;
const WINDOW_W = 1.2;
const WINDOW_H = 1.5;
const WINDOW_Y = 1.8;

export const HOUSE_COLORS = [
  0xb05a4a, 0x6a9a5a, 0xc9b04a, 0x8a5a3a, 0x8a8a8a, 0x5a7a9a, 0xa86a3a,
  0xd8d0c0,
];
export const INDUSTRIAL_COLORS = [
  0x8a8a8a, 0x9a9aa0, 0x6a6a6a, 0x7a5a4a, 0x8a6a5a, 0x5a5a5a,
];

export function createHollowBuilding(
  x,
  z,
  width,
  height,
  depth,
  doorSides,
  wallColor,
  buildingStyle = "parisian",
  stories = 4,
  rand = Math.random,
  district = "commercial",
  roofColor = 0x5c4a40,
) {
  const wallT = HOLLOW_WALL_T;
  const doorW = HOLLOW_DOOR_W;
  const doorH = HOLLOW_DOOR_H;
  const halfW = width / 2;
  const halfD = depth / 2;

  hollowFloors.push({
    cx: x,
    cy: 0.15,
    cz: z,
    w: width - wallT * 2,
    h: 0.3,
    d: depth - wallT * 2,
  });

  hollowRoofs.push({
    cx: x,
    cy: height + 0.15,
    cz: z,
    w: width + 0.5,
    h: 0.3,
    d: depth + 0.5,
  });

  addIndexedBox(
    state.buildingBoxes,
    buildingIndex,
    new THREE.Box3(
      new THREE.Vector3(x - (width + 0.5) / 2, height, z - (depth + 0.5) / 2),
      new THREE.Vector3(
        x + (width + 0.5) / 2,
        height + 1,
        z + (depth + 0.5) / 2,
      ),
    ),
  );

  state.buildingInteriors.push({
    minX: x - halfW + wallT,
    maxX: x + halfW - wallT,
    minZ: z - halfD + wallT,
    maxZ: z + halfD - wallT,
    minY: 0,
    maxY: height,
  });

  const addWallSegment = (axis, fixed, a, b, y0, y1) => {
    const cy = (y0 + y1) / 2;
    const h = y1 - y0;
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
      addIndexedBox(
        state.buildingBoxes,
        buildingIndex,
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
      addIndexedBox(
        state.buildingBoxes,
        buildingIndex,
        new THREE.Box3(
          new THREE.Vector3(fixed - wallT / 2, y0, a),
          new THREE.Vector3(fixed + wallT / 2, y1, b),
        ),
      );
    }
  };

  const addWindows = (axis, fixed, a, b, withDoor, doorCenter) => {
    const winD = wallT + 0.14;
    const step = 3.0;
    const rowStep = Math.max(3.0, height / Math.max(1, stories));
    for (let wy = WINDOW_Y; wy < height - WINDOW_H / 2; wy += rowStep) {
      for (let pos = a + step / 2; pos < b - WINDOW_W / 2; pos += step) {
        if (
          withDoor &&
          wy < doorH + 0.2 &&
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

  const buildSide = (axis, fixed, a, b, side) => {
    const center = (a + b) / 2;
    const isDoorSide = doorSides.includes(side);
    if (isDoorSide) {
      const d0 = center - doorW / 2;
      const d1 = center + doorW / 2;
      if (d0 > a + 0.1) addWallSegment(axis, fixed, a, d0, 0, height);
      if (d1 < b - 0.1) addWallSegment(axis, fixed, d1, b, 0, height);
      if (height > doorH) addWallSegment(axis, fixed, d0, d1, doorH, height);
    } else {
      addWallSegment(axis, fixed, a, b, 0, height);
    }
    addWindows(axis, fixed, a, b, isDoorSide, center);
  };

  buildSide("x", z + halfD, x - halfW, x + halfW, "north");
  buildSide("x", z - halfD, x - halfW, x + halfW, "south");
  buildSide("z", x + halfW, z - halfD, z + halfD, "east");
  buildSide("z", x - halfW, z - halfD, z + halfD, "west");

  decorateEuropeanFacade({
    x,
    z,
    width,
    height,
    depth,
    stories,
    style: buildingStyle,
    wallColor,
    rand,
    district,
  });
}

// ---------------- Style / height choosers ----------------
export function chooseEuropeanStyle(district, rand) {
  if (district === "downtown") {
    const r = rand();
    if (r < 0.26) return "neoHaussmann";
    if (r < 0.44) return "parisian";
    if (r < 0.61) return "artNouveau";
    if (r < 0.8) return "belgian";
    return "modernEuropean";
  }
  if (district === "commercial") {
    const r = rand();
    if (r < 0.26) return "belgian";
    if (r < 0.46) return "parisian";
    if (r < 0.64) return "artNouveau";
    if (r < 0.82) return "brickTownhouse";
    return "modernEuropean";
  }
  if (district === "residential") {
    const r = rand();
    if (r < 0.28) return "belgian";
    if (r < 0.5) return "oldTown";
    if (r < 0.68) return "brickTownhouse";
    if (r < 0.84) return "parisian";
    return "artNouveau";
  }
  return "brickTownhouse";
}

export function chooseStoryCount(cfg, district, rand) {
  let stories =
    cfg.minStories + Math.floor(rand() * (cfg.maxStories - cfg.minStories + 1));

  // Keep the skyline low and believable: the core may have occasional 9–10
  // storey accents, but most buildings remain 3–7 storeys.
  if (district === "downtown" && rand() < 0.08)
    stories = Math.min(10, Math.max(stories, 9));
  if (district !== "downtown") stories = Math.min(stories, 7);

  return Math.max(2, Math.min(10, stories));
}

export function buildingHeightFromStories(stories, style, rand) {
  const floorHeight =
    style === "neoHaussmann" || style === "parisian"
      ? 3.45
      : style === "artNouveau"
        ? 3.35
        : style === "modernEuropean"
          ? 3.2
          : 3.25;

  const crown = style === "neoHaussmann" || style === "parisian" ? 1.1 : 0.7;
  return stories * floorHeight + crown + rand() * 0.45;
}

// ---------------- Instanced mesh builders ----------------
function prepareInstanceBounds(mesh, rects, precise = false) {
  if (!rects.length) return;
  const box = new THREE.Box3();
  const temp = _v1;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const hx = r.w / 2;
    const hy = r.h / 2;
    const hz = r.d / 2;
    temp.set(r.cx - hx, r.cy - hy, r.cz - hz);
    box.expandByPoint(temp);
    temp.set(r.cx + hx, r.cy + hy, r.cz + hz);
    box.expandByPoint(temp);
  }
  mesh.boundingSphere = new THREE.Sphere();
  box.getBoundingSphere(mesh.boundingSphere);
  mesh.frustumCulled = true;
}

function buildInstancedBoxes(rects, color) {
  if (!rects.length) return;
  const mesh = new THREE.InstancedMesh(
    sharedUnitBoxGeometry,
    getBoxMaterial(color),
    rects.length,
  );
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    _v1.set(r.cx, r.cy, r.cz);
    _v2.set(r.w, r.h, r.d);
    _matrix.compose(_v1, _quaternion, _v2);
    mesh.setMatrixAt(i, _matrix);
  }

  mesh.instanceMatrix.needsUpdate = true;
  prepareInstanceBounds(mesh, rects);
  addFrozenStatic(mesh);
}

function buildInstancedColoredBoxes(rects, fallbackColor) {
  if (!rects.length) return;
  const mesh = new THREE.InstancedMesh(
    sharedUnitBoxGeometry,
    sharedColoredBoxMaterial,
    rects.length,
  );
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    _v1.set(r.cx, r.cy, r.cz);
    _v2.set(r.w, r.h, r.d);
    _matrix.compose(_v1, _quaternion, _v2);
    mesh.setMatrixAt(i, _matrix);
    _color.setHex(r.color ?? fallbackColor);
    mesh.setColorAt(i, _color);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  prepareInstanceBounds(mesh, rects);
  addFrozenStatic(mesh);
}

function buildRoofInstances() {
  if (roofConeInstances.length) {
    const geometry = new THREE.ConeGeometry(1, 1, 4);
    const material = new THREE.MeshPhongMaterial({
      color: 0xffffff,
      shininess: 10,
    });
    const mesh = new THREE.InstancedMesh(
      geometry,
      material,
      roofConeInstances.length,
    );
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    const box = new THREE.Box3();
    for (let i = 0; i < roofConeInstances.length; i++) {
      const r = roofConeInstances[i];
      _v1.set(r.x, r.y, r.z);
      _quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.rotation);
      _v2.set(r.radiusScale, r.height, r.radiusScale * r.depthScale);
      _matrix.compose(_v1, _quaternion, _v2);
      mesh.setMatrixAt(i, _matrix);
      _color.setHex(r.color);
      mesh.setColorAt(i, _color);

      const radius = r.radiusScale;
      _v3box(box, r.x - radius, r.y - r.height / 2, r.z - radius);
      _v3box(box, r.x + radius, r.y + r.height / 2, r.z + radius);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.boundingSphere = new THREE.Sphere();
    box.getBoundingSphere(mesh.boundingSphere);
    mesh.frustumCulled = true;
    addFrozenStatic(mesh);
  }

  if (roofBoxInstances.length) {
    const mesh = new THREE.InstancedMesh(
      sharedUnitBoxGeometry,
      sharedColoredBoxMaterial,
      roofBoxInstances.length,
    );
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const box = new THREE.Box3();

    for (let i = 0; i < roofBoxInstances.length; i++) {
      const r = roofBoxInstances[i];
      _v1.set(r.x, r.y, r.z);
      _v2.set(r.w, r.h, r.d);
      _matrix.compose(_v1, _quaternion, _v2);
      mesh.setMatrixAt(i, _matrix);
      _color.setHex(r.color);
      mesh.setColorAt(i, _color);
      _v3box(box, r.x - r.w / 2, r.y - r.h / 2, r.z - r.d / 2);
      _v3box(box, r.x + r.w / 2, r.y + r.h / 2, r.z + r.d / 2);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.boundingSphere = new THREE.Sphere();
    box.getBoundingSphere(mesh.boundingSphere);
    mesh.frustumCulled = true;
    addFrozenStatic(mesh);
  }
}

function _v3box(box, x, y, z) {
  _v1.set(x, y, z);
  box.expandByPoint(_v1);
}

export function buildHollowInstances() {
  buildInstancedColoredBoxes(hollowWalls, 0xffffff);
  buildInstancedBoxes(hollowWindows, 0x7fb8d8);
  buildInstancedBoxes(hollowFloors, 0x9c7a4c);
  buildInstancedBoxes(hollowRoofs, 0x574940);

  buildInstancedColoredBoxes(facadeTrim, 0xe8dcc8);
  buildInstancedColoredBoxes(facadeBalconies, 0xd1c7b4);
  buildInstancedColoredBoxes(facadeRailings, 0x51453f);
  buildInstancedColoredBoxes(facadeShutters, 0x5f7180);
  buildInstancedColoredBoxes(facadeAwnings, 0x675043);
  buildInstancedColoredBoxes(facadeColumns, 0xe8dcc8);
  buildInstancedColoredBoxes(facadeShopfronts, 0x667276);
  buildInstancedColoredBoxes(facadeParapets, 0xe8dcc8);
  buildRoofInstances();
}

export function resetBuildingCollections() {
  hollowWalls.length = 0;
  hollowFloors.length = 0;
  hollowRoofs.length = 0;
  hollowWindows.length = 0;
  facadeTrim.length = 0;
  facadeBalconies.length = 0;
  facadeRailings.length = 0;
  facadeShutters.length = 0;
  facadeAwnings.length = 0;
  facadeColumns.length = 0;
  facadeShopfronts.length = 0;
  facadeParapets.length = 0;
  roofConeInstances.length = 0;
  roofBoxInstances.length = 0;
}
