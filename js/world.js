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

// ---------------- Hilly terrain ----------------
// The city stays perfectly flat inside CITY_RADIUS so buildings, walls and
// roads line up. Past R_FLAT the terrain rises into a ring of hills, and the
// circular ring-road highway runs around the whole world on top of them.

const CITY_RADIUS = 370; // city content is confined within this radius
const R_FLAT = 380; // terrain is flat up to this radius
const R_EDGE = 492; // terrain envelope completes at this radius
const RING_INNER = 440; // ring-road inner radius
const RING_OUTER = 476; // ring-road outer radius

const hills = [];
(function buildHills() {
  const rand = mulberry32(0x5eed1234);
  for (let i = 0; i < 16; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = 400 + rand() * 88; // 400..488
    hills.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      r: 110 + rand() * 80, // 110..190
      h: 14 + rand() * 22, // 14..36
    });
  }
})();

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Ground surface height (Y) at world coordinates (x, z). Flat inside the city,
// smooth hills + a gentle ring undulation around the outside.
export function getGroundHeight(x, z) {
  const r = Math.hypot(x, z);
  if (r <= R_FLAT) return 0;

  const theta = Math.atan2(z, x);
  let h = 0;
  for (const hill of hills) {
    const d = Math.hypot(x - hill.x, z - hill.z) / hill.r;
    if (d < 1) h += hill.h * 0.5 * (1 + Math.cos(Math.PI * d));
  }
  // Rolling undulation along the ring so the highway visibly climbs/descends.
  h += 14 * Math.sin(theta * 3 + 1.7) + 7 * Math.sin(theta * 5 + 0.4);

  return h * smoothstep(R_FLAT, R_EDGE, r);
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

// ---------------- European city districts ----------------
const DISTRICT = {
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

const EUROPEAN_STYLES = [
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
const roofMeshes = [];

function addFacadeBox(target, cx, cy, cz, w, h, d, color) {
  target.push({ cx, cy, cz, w, h, d, color });
}

function addRoofMesh(mesh) {
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  roofMeshes.push(mesh);
}

function addEuropeanRoof(x, z, width, depth, height, style, roofColor, rand) {
  const roofY = height + 0.15;

  if (style === "parisian" || style === "neoHaussmann") {
    const mansard = new THREE.Mesh(
      new THREE.ConeGeometry(
        Math.max(width, depth) * 0.68,
        3.3 + rand() * 1.2,
        4,
      ),
      new THREE.MeshPhongMaterial({ color: roofColor, shininess: 12 }),
    );
    mansard.scale.z = Math.min(1, depth / Math.max(width, depth));
    mansard.position.set(x, roofY + 1.45, z);
    mansard.rotation.y = Math.PI / 4;
    addRoofMesh(mansard);

    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.72, 0.35, depth * 0.72),
      new THREE.MeshPhongMaterial({
        color: FACADE_DARK[Math.floor(rand() * FACADE_DARK.length)],
        shininess: 18,
      }),
    );
    cap.position.set(x, roofY + 3.15, z);
    addRoofMesh(cap);
    return;
  }

  if (
    style === "oldTown" ||
    style === "brickTownhouse" ||
    style === "artNouveau"
  ) {
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(
        Math.max(width, depth) * 0.62,
        2.4 + rand() * 1.1,
        4,
      ),
      new THREE.MeshPhongMaterial({ color: roofColor, shininess: 9 }),
    );
    roof.scale.z = Math.min(1, depth / Math.max(width, depth));
    roof.position.set(x, roofY + 1.0, z);
    roof.rotation.y = Math.PI / 4;
    addRoofMesh(roof);
    return;
  }

  const parapet = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.7, 0.8, depth + 0.7),
    new THREE.MeshPhongMaterial({ color: roofColor, shininess: 10 }),
  );
  parapet.position.set(x, height + 0.55, z);
  addRoofMesh(parapet);
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

function roofColorFor(style, rand) {
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

const HOUSE_COLORS = [
  0xb05a4a, 0x6a9a5a, 0xc9b04a, 0x8a5a3a, 0x8a8a8a, 0x5a7a9a, 0xa86a3a,
  0xd8d0c0,
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

function buildInstancedBoxes(rects, color) {
  if (!rects.length) return;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ color, shininess: 10 }),
    rects.length,
  );
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const box = new THREE.Box3();

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    p.set(r.cx, r.cy, r.cz);
    s.set(r.w, r.h, r.d);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);

    const rMax = Math.max(r.w, r.h, r.d) / 2;
    box.expandByPoint(new THREE.Vector3(r.cx - rMax, r.cy - rMax, r.cz - rMax));
    box.expandByPoint(new THREE.Vector3(r.cx + rMax, r.cy + rMax, r.cz + rMax));
  }

  mesh.instanceMatrix.needsUpdate = true;
  mesh.boundingSphere = new THREE.Sphere();
  box.getBoundingSphere(mesh.boundingSphere);
  mesh.frustumCulled = true;

  state.scene.add(mesh);
}

function buildInstancedColoredBoxes(rects, fallbackColor) {
  if (!rects.length) return;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ color: fallbackColor, shininess: 10 }),
    rects.length,
  );
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  const box = new THREE.Box3();

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    p.set(r.cx, r.cy, r.cz);
    s.set(r.w, r.h, r.d);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    c.setHex(r.color ?? fallbackColor);
    mesh.setColorAt(i, c);

    const rMax = Math.max(r.w, r.h, r.d) / 2;
    box.expandByPoint(new THREE.Vector3(r.cx - rMax, r.cy - rMax, r.cz - rMax));
    box.expandByPoint(new THREE.Vector3(r.cx + rMax, r.cy + rMax, r.cz + rMax));
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  mesh.boundingSphere = new THREE.Sphere();
  box.getBoundingSphere(mesh.boundingSphere);
  mesh.frustumCulled = true;

  state.scene.add(mesh);
}

function buildInstancedWindows(rects) {
  buildInstancedBoxes(rects, 0x7fb8d8);
}

function buildInstancedWalls(rects) {
  buildInstancedColoredBoxes(rects, 0xffffff);
}

function buildHollowInstances() {
  buildInstancedWalls(hollowWalls);
  buildInstancedWindows(hollowWindows);
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

  for (const mesh of roofMeshes) state.scene.add(mesh);
}

function chooseEuropeanStyle(district, rand) {
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

function chooseStoryCount(cfg, district, rand) {
  let stories =
    cfg.minStories + Math.floor(rand() * (cfg.maxStories - cfg.minStories + 1));

  // Keep the skyline low and believable: the core may have occasional 9–10
  // storey accents, but most buildings remain 3–7 storeys.
  if (district === "downtown" && rand() < 0.08)
    stories = Math.min(10, Math.max(stories, 9));
  if (district !== "downtown") stories = Math.min(stories, 7);

  return Math.max(2, Math.min(10, stories));
}

function buildingHeightFromStories(stories, style, rand) {
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

// ---------------- Road network ----------------
function buildRoadNetwork() {
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
      minZ: -RING_INNER,
      maxZ: RING_INNER,
      type: v.type,
    });
  }
  for (const h of horizontals) {
    roads.push({
      minX: -RING_INNER,
      maxX: RING_INNER,
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

// ---------------- Safe placement helpers ----------------
const BUILDING_EDGE_MARGIN = 10.0; // never place buildings this close to a road edge
const BUILDING_GAP = 5.5; // minimum free pedestrian space between buildings
const TREE_CLEARANCE = 1.25;
const WALL_INSET = 2.0;
const WALL_CORNER_LENGTH = 6.0;

function boxOverlapsAnyRoad(box, extra = 0) {
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

function boxOverlapsAnyBox(box, boxes) {
  for (const other of boxes) {
    if (box.intersectsBox(other)) return true;
  }
  return false;
}

// True only when a proposed static object has clearance from roads and
// everything already generated. Generation is intentionally ordered:
// buildings -> community walls -> trees/decoration.
function isStaticPlacementClear(
  box,
  { roadPadding = 0, ignoreTrees = false } = {},
) {
  if (boxOverlapsAnyRoad(box, roadPadding)) return false;
  if (boxOverlapsAnyBox(box, state.buildingBoxes)) return false;
  if (!ignoreTrees && boxOverlapsAnyBox(box, state.treeBoxes)) return false;
  if (boxOverlapsAnyBox(box, state.wallBoxes)) return false;
  return true;
}

function placeTree(x, z, treePositions) {
  const treeBox = new THREE.Box3(
    new THREE.Vector3(x - TREE_CLEARANCE, 0, z - TREE_CLEARANCE),
    new THREE.Vector3(x + TREE_CLEARANCE, 5, z + TREE_CLEARANCE),
  );

  if (!isStaticPlacementClear(treeBox)) return false;

  treePositions.push({ x, z });
  state.treeBoxes.push(
    new THREE.Box3(
      new THREE.Vector3(x - 0.5, 0, z - 0.5),
      new THREE.Vector3(x + 0.5, 5, z + 0.5),
    ),
  );
  return true;
}

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

function isClearPointForDecoration(x, z) {
  const box = new THREE.Box3(
    new THREE.Vector3(x - 0.9, 0, z - 0.9),
    new THREE.Vector3(x + 0.9, 4, z + 0.9),
  );
  return isStaticPlacementClear(box);
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
  state.scene.add(mesh);

  state.wallBoxes.push(box);
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

  placeLampPosts(verticals, horizontals);
  placeIntersectionMarkings(verticals, horizontals);

  return { roads, treePositions };
}

// ---------------- Visual meshes ----------------
// A plane laid flat in the XZ plane whose vertices follow the terrain height
// (plus a small offset to avoid z-fighting). Used for roads, lane markings
// and the ring road.
function addDisplacedPlane(
  minX,
  maxX,
  minZ,
  maxZ,
  yOffset,
  material,
  segX,
  segZ,
) {
  const w = maxX - minX;
  const d = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const geo = new THREE.PlaneGeometry(w, d, segX, segZ);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const ly = pos.getY(i);
    pos.setZ(i, getGroundHeight(cx + lx, cz - ly) + yOffset);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cx, 0, cz);
  mesh.receiveShadow = false;
  state.scene.add(mesh);
  return mesh;
}

function addRoadSurface(road) {
  const vertical = road.maxX - road.minX < road.maxZ - road.minZ;
  const segX = vertical
    ? 1
    : Math.max(1, Math.ceil((road.maxX - road.minX) / 2));
  const segZ = vertical
    ? Math.max(1, Math.ceil((road.maxZ - road.minZ) / 2))
    : 1;
  addDisplacedPlane(
    road.minX,
    road.maxX,
    road.minZ,
    road.maxZ,
    vertical ? 0.011 : 0.01,
    new THREE.MeshPhongMaterial({ color: 0x2c2f33, shininess: 5 }),
    segX,
    segZ,
  );
}

function addCenterLine(road, color, yOffset) {
  const w = road.maxX - road.minX;
  const d = road.maxZ - road.minZ;
  const vertical = w < d;
  let minX, maxX, minZ, maxZ;
  if (vertical) {
    const cx = (road.minX + road.maxX) / 2;
    minX = cx - 0.3;
    maxX = cx + 0.3;
    minZ = road.minZ;
    maxZ = road.maxZ;
  } else {
    const cz = (road.minZ + road.maxZ) / 2;
    minZ = cz - 0.3;
    maxZ = cz + 0.3;
    minX = road.minX;
    maxX = road.maxX;
  }
  const segX = vertical ? 1 : Math.max(1, Math.ceil(w / 2));
  const segZ = vertical ? Math.max(1, Math.ceil(d / 2)) : 1;
  addDisplacedPlane(
    minX,
    maxX,
    minZ,
    maxZ,
    yOffset,
    new THREE.MeshBasicMaterial({ color }),
    segX,
    segZ,
  );
}

// Circular ring-road highway around the whole world, following the hills.
function addRingRoad() {
  const geo = new THREE.RingGeometry(RING_INNER, RING_OUTER, 360, 16);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const ly = pos.getY(i);
    pos.setZ(i, getGroundHeight(lx, -ly) + 0.02);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshPhongMaterial({ color: 0x2c2f33, shininess: 5 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = false;
  state.scene.add(mesh);

  // Centerline marking.
  const mid = (RING_INNER + RING_OUTER) / 2;
  const lineGeo = new THREE.RingGeometry(mid - 0.4, mid + 0.4, 360, 1);
  const lpos = lineGeo.attributes.position;
  for (let i = 0; i < lpos.count; i++) {
    const lx = lpos.getX(i);
    const ly = lpos.getY(i);
    lpos.setZ(i, getGroundHeight(lx, -ly) + 0.06);
  }
  lpos.needsUpdate = true;
  lineGeo.computeVertexNormals();
  const lineMesh = new THREE.Mesh(
    lineGeo,
    new THREE.MeshBasicMaterial({ color: 0xffd75e }),
  );
  lineMesh.rotation.x = -Math.PI / 2;
  state.scene.add(lineMesh);
}

function buildTreeInstances(positions) {
  const count = positions.length;
  if (count === 0) return;

  const trunkGeometry = new THREE.CylinderGeometry(0.5, 0.5, 5);
  const trunkMaterial = new THREE.MeshPhongMaterial({ color: 0x8b4513 });
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, count);
  trunks.castShadow = false;
  trunks.receiveShadow = false;

  const foliageGeometry = new THREE.SphereGeometry(3, 10, 10);
  const foliageMaterial = new THREE.MeshPhongMaterial({ color: 0x228b22 });
  const foliage = new THREE.InstancedMesh(
    foliageGeometry,
    foliageMaterial,
    count,
  );
  foliage.castShadow = false;
  foliage.receiveShadow = false;

  const matrix = new THREE.Matrix4();
  const treeBox = new THREE.Box3();

  for (let i = 0; i < count; i++) {
    const { x, z } = positions[i];
    matrix.setPosition(x, 2.5, z);
    trunks.setMatrixAt(i, matrix);
    matrix.setPosition(x, 6, z);
    foliage.setMatrixAt(i, matrix);

    treeBox.expandByPoint(new THREE.Vector3(x, 6, z));
  }

  treeBox.min.subScalar(3);
  treeBox.max.addScalar(3);

  trunks.boundingSphere = new THREE.Sphere();
  treeBox.getBoundingSphere(trunks.boundingSphere);
  trunks.frustumCulled = true;

  foliage.boundingSphere = new THREE.Sphere();
  treeBox.getBoundingSphere(foliage.boundingSphere);
  foliage.frustumCulled = true;

  trunks.instanceMatrix.needsUpdate = true;
  foliage.instanceMatrix.needsUpdate = true;
  state.scene.add(trunks);
  state.scene.add(foliage);
}

// ---------------- Water, nature & street furniture ----------------
// A curated first pass at making the city feel dressed rather than empty:
// animated ponds and fountains, benches, lamp posts, flower beds, hedges,
// fire hydrants, and crosswalk/stop-line road markings. None of this is
// instanced (unlike the trees/buildings above) since counts are kept
// modest by design — see the placement functions below for the knobs.

const roadMarkingMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });

// A point is clear of buildings/trees/walls/roads within `radius` — used to
// find spots for ponds and fountains that won't overlap anything else.
function isAreaClear(x, z, radius) {
  if (Math.hypot(x, z) > CITY_RADIUS - 15) return false;
  const box = new THREE.Box3(
    new THREE.Vector3(x - radius, 0, z - radius),
    new THREE.Vector3(x + radius, 3, z + radius),
  );
  for (const t of state.treeBoxes) if (box.intersectsBox(t)) return false;
  for (const b of state.buildingBoxes) if (box.intersectsBox(b)) return false;
  for (const w of state.wallBoxes) if (box.intersectsBox(w)) return false;
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

function findClearSpot(radius, rand, tries = 40) {
  const range = CITY_RADIUS - 20;
  for (let i = 0; i < tries; i++) {
    const x = (rand() - 0.5) * 2 * range;
    const z = (rand() - 0.5) * 2 * range;
    if (isAreaClear(x, z, radius)) return { x, z };
  }
  return null;
}

// ── Ponds — animated ripple plane + a rim of reeds and rocks ──────────────
const ripplePonds = []; // { geo }, animated each frame by updateEnvironment

function createReed(x, z, rand) {
  const h = 1.1 + rand() * 1.0;
  const mat = new THREE.MeshLambertMaterial({ color: 0x4a7c3a });
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.05, h, 5),
    mat,
  );
  mesh.position.set(x, getGroundHeight(x, z) + h / 2, z);
  mesh.rotation.z = (rand() - 0.5) * 0.25;
  mesh.rotation.x = (rand() - 0.5) * 0.15;
  mesh.castShadow = false;
  state.scene.add(mesh);
}

function createRock(x, z, rand) {
  const s = 0.28 + rand() * 0.4;
  const mat = new THREE.MeshLambertMaterial({
    color: 0x77787a,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), mat);
  mesh.position.set(x, getGroundHeight(x, z) + s * 0.35, z);
  mesh.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  state.scene.add(mesh);
}

function createPond(x, z, radiusX, radiusZ, rand) {
  const baseY = getGroundHeight(x, z) + 0.05;
  const geo = new THREE.PlaneGeometry(radiusX * 2, radiusZ * 2, 10, 10);
  const mat = new THREE.MeshLambertMaterial({
    color: 0x2f7a6f,
    transparent: true,
    opacity: 0.78,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, baseY, z);
  mesh.receiveShadow = false;
  state.scene.add(mesh);
  ripplePonds.push({ geo, seed: rand() * 100 });

  const ringCount = 8 + Math.floor(rand() * 6);
  for (let i = 0; i < ringCount; i++) {
    const a = (i / ringCount) * Math.PI * 2 + rand() * 0.3;
    const rr = 1.05 + rand() * 0.25;
    const px = x + Math.cos(a) * radiusX * rr;
    const pz = z + Math.sin(a) * radiusZ * rr;
    if (rand() < 0.55) createReed(px, pz, rand);
    else createRock(px, pz, rand);
  }

  // Water blocks movement — reuses the same obstacle list the player, cars
  // and NPCs already check, so nobody walks or drives across the pond.
  state.wallBoxes.push(
    new THREE.Box3(
      new THREE.Vector3(x - radiusX, 0, z - radiusZ),
      new THREE.Vector3(x + radiusX, 1.2, z + radiusZ),
    ),
  );
}

// ── Fountains — tiered basin + a looping ring of falling water droplets ───
const fountainJets = []; // { center, particles: [{mesh, phase, angle}] }

function createFountain(x, z, rand) {
  const baseY = getGroundHeight(x, z);
  const stoneMat = new THREE.MeshPhongMaterial({
    color: 0xb8b0a0,
    shininess: 20,
  });
  const waterMat = new THREE.MeshPhongMaterial({
    color: 0x5fb8d8,
    transparent: true,
    opacity: 0.75,
    shininess: 80,
  });

  const tiers = [
    { r: 3.2, h: 0.5, y: 0.25 },
    { r: 2.1, h: 0.5, y: 0.85 },
    { r: 1.1, h: 0.4, y: 1.35 },
  ];
  for (const t of tiers) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(t.r, t.r * 1.08, t.h, 20),
      stoneMat,
    );
    mesh.position.set(x, baseY + t.y, z);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    state.scene.add(mesh);
  }

  const waterMesh = new THREE.Mesh(new THREE.CircleGeometry(2.9, 20), waterMat);
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.position.set(x, baseY + 0.5, z);
  state.scene.add(waterMesh);

  const particles = [];
  const dropGeo = new THREE.SphereGeometry(0.09, 6, 6);
  const dropCount = 10;
  for (let i = 0; i < dropCount; i++) {
    const mesh = new THREE.Mesh(dropGeo, waterMat);
    state.scene.add(mesh);
    particles.push({
      mesh,
      phase: rand() * Math.PI * 2,
      angle: (i / dropCount) * Math.PI * 2,
    });
  }
  fountainJets.push({
    center: new THREE.Vector3(x, baseY + 1.6, z),
    particles,
  });

  state.wallBoxes.push(
    new THREE.Box3(
      new THREE.Vector3(x - 3.4, 0, z - 3.4),
      new THREE.Vector3(x + 3.4, 2, z + 3.4),
    ),
  );
}

function placeGlobalWaterFeatures(rand) {
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

// ── Benches — 5 boxes: two end supports, a seat, a backrest, a stretcher ──
function createBench(x, z, yaw, rand) {
  const woodMat = new THREE.MeshPhongMaterial({
    color: 0x8a5a34,
    shininess: 15,
  });
  const metalMat = new THREE.MeshPhongMaterial({
    color: 0x3a3a3a,
    shininess: 60,
  });
  const group = new THREE.Group();
  const add = (geo, mat, lx, ly, lz) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(lx, ly, lz);
    m.castShadow = false;
    m.receiveShadow = false;
    group.add(m);
  };
  add(new THREE.BoxGeometry(0.12, 0.45, 0.7), metalMat, -0.75, 0.225, 0);
  add(new THREE.BoxGeometry(0.12, 0.45, 0.7), metalMat, 0.75, 0.225, 0);
  add(new THREE.BoxGeometry(1.7, 0.08, 0.7), woodMat, 0, 0.46, 0);
  add(new THREE.BoxGeometry(1.7, 0.5, 0.08), woodMat, 0, 0.7, -0.32);
  add(new THREE.BoxGeometry(1.5, 0.06, 0.06), metalMat, 0, 0.25, 0);
  group.position.set(x, getGroundHeight(x, z), z);
  group.rotation.y = yaw + (rand() < 0.5 ? 0 : Math.PI); // face either way along the sidewalk
  state.scene.add(group);
}

// ── Lamp posts — pole + arm + emissive bulb, lining the major roads ───────
function createLampPost(x, z, yaw) {
  const poleMat = new THREE.MeshPhongMaterial({
    color: 0x2a2a2a,
    shininess: 40,
  });
  const bulbMat = new THREE.MeshPhongMaterial({
    color: 0xfff4c0,
    emissive: 0xffe37a,
    emissiveIntensity: 0.9,
  });
  const group = new THREE.Group();
  const poleH = 5.2;
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, poleH, 8),
    poleMat,
  );
  pole.position.y = poleH / 2;
  pole.castShadow = false;
  group.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.08), poleMat);
  arm.position.set(0.45, poleH - 0.15, 0);
  group.add(arm);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), bulbMat);
  bulb.position.set(0.9, poleH - 0.35, 0);
  group.add(bulb);
  group.position.set(x, getGroundHeight(x, z), z);
  group.rotation.y = yaw;
  state.scene.add(group);
}

function placeLampPosts(verticals, horizontals) {
  const spacing = 70;
  const range = CITY_RADIUS - 10;
  for (const v of verticals) {
    if (v.type === "local") continue;
    const off = v.width / 2 + 1.8;
    for (let z = -range; z <= range; z += spacing) {
      createLampPost(v.x - off, z, Math.PI / 2);
      createLampPost(v.x + off, z, -Math.PI / 2);
    }
  }
  for (const h of horizontals) {
    if (h.type === "local") continue;
    const off = h.width / 2 + 1.8;
    for (let x = -range; x <= range; x += spacing) {
      createLampPost(x, h.z - off, 0);
      createLampPost(x, h.z + off, Math.PI);
    }
  }
}

// ── Flower beds — a soil patch with a handful of bright color swatches ────
function createFlowerBed(x, z, rand) {
  const colors = [0xd6336c, 0xf4d03f, 0xff6f61, 0xffffff, 0xba55d3];
  const w = 1.2 + rand() * 0.8;
  const d = 1.2 + rand() * 0.8;
  const soilMat = new THREE.MeshLambertMaterial({ color: 0x3d2b1f });
  const soil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), soilMat);
  soil.rotation.x = -Math.PI / 2;
  soil.position.set(x, getGroundHeight(x, z) + 0.02, z);
  soil.receiveShadow = false;
  state.scene.add(soil);

  const petalCount = 4 + Math.floor(rand() * 4);
  for (let i = 0; i < petalCount; i++) {
    const color = colors[Math.floor(rand() * colors.length)];
    const mat = new THREE.MeshLambertMaterial({ color });
    const s = 0.18 + rand() * 0.14;
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(s, s), mat);
    patch.rotation.x = -Math.PI / 2;
    const ox = (rand() - 0.5) * (w - s);
    const oz = (rand() - 0.5) * (d - s);
    patch.position.set(x + ox, getGroundHeight(x + ox, z + oz) + 0.03, z + oz);
    state.scene.add(patch);
  }
}

// ── Hedges — a short run of flat-shaded low-poly icosahedron "bushes" ─────
function createHedge(x, z, yaw, length, rand) {
  const mat = new THREE.MeshLambertMaterial({
    color: 0x2d6e2d,
    flatShading: true,
  });
  const segCount = Math.max(2, Math.round(length / 1.2));
  const group = new THREE.Group();
  for (let i = 0; i < segCount; i++) {
    const jitter = 0.85 + rand() * 0.3;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), mat);
    m.scale.set(1.15 * jitter, 0.6 * jitter, 0.75 * jitter);
    m.position.set(-length / 2 + (i + 0.5) * (length / segCount), 0.4, 0);
    m.castShadow = false;
    m.receiveShadow = false;
    group.add(m);
  }
  group.position.set(x, getGroundHeight(x, z), z);
  group.rotation.y = yaw;
  state.scene.add(group);
}

// ── Fire hydrants — sidewalk corners ───────────────────────────────────────
function createFireHydrant(x, z) {
  const bodyMat = new THREE.MeshPhongMaterial({
    color: 0xcc2222,
    shininess: 60,
  });
  const capMat = new THREE.MeshPhongMaterial({
    color: 0x991111,
    shininess: 60,
  });
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.2, 0.6, 10),
    bodyMat,
  );
  body.position.y = 0.3;
  body.castShadow = false;
  group.add(body);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.18), capMat);
  cap.position.y = 0.66;
  group.add(cap);
  const nozzleGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.18, 8);
  const nL = new THREE.Mesh(nozzleGeo, capMat);
  nL.rotation.z = Math.PI / 2;
  nL.position.set(-0.2, 0.38, 0);
  group.add(nL);
  const nR = new THREE.Mesh(nozzleGeo, capMat);
  nR.rotation.z = Math.PI / 2;
  nR.position.set(0.2, 0.38, 0);
  group.add(nR);
  group.position.set(x, getGroundHeight(x, z), z);
  state.scene.add(group);
}

// ── Road markings — crosswalks + stop lines at the city's major crossroads ─
function addStripeBandX(centerAlong, halfSpan, zStart, zEnd) {
  const stripeW = 0.55;
  const count = 5;
  const totalAlong = halfSpan * 2 - 1.2;
  if (totalAlong <= stripeW) return;
  const step = totalAlong / (count - 1);
  const start = centerAlong - totalAlong / 2;
  for (let i = 0; i < count; i++) {
    const cx = start + step * i;
    addDisplacedPlane(
      cx - stripeW / 2,
      cx + stripeW / 2,
      zStart,
      zEnd,
      0.025,
      roadMarkingMat,
      1,
      1,
    );
  }
}

function addStripeBandZ(centerAlong, halfSpan, xStart, xEnd) {
  const stripeW = 0.55;
  const count = 5;
  const totalAlong = halfSpan * 2 - 1.2;
  if (totalAlong <= stripeW) return;
  const step = totalAlong / (count - 1);
  const start = centerAlong - totalAlong / 2;
  for (let i = 0; i < count; i++) {
    const cz = start + step * i;
    addDisplacedPlane(
      xStart,
      xEnd,
      cz - stripeW / 2,
      cz + stripeW / 2,
      0.025,
      roadMarkingMat,
      1,
      1,
    );
  }
}

function addIntersectionMarkings(vx, vHalfW, hz, hHalfW) {
  const crossDepth = 3.4; // how far each crosswalk band extends from the crossing road
  const gap = 0.3;
  const stopOffset = gap + crossDepth + 0.6;
  const stopHalf = 0.25;

  // Crosswalks: on the horizontal road (north & south of the vertical road)
  // and on the vertical road (east & west of the horizontal road).
  addStripeBandX(vx, vHalfW, hz + hHalfW + gap, hz + hHalfW + gap + crossDepth);
  addStripeBandX(vx, vHalfW, hz - hHalfW - gap - crossDepth, hz - hHalfW - gap);
  addStripeBandZ(hz, hHalfW, vx + vHalfW + gap, vx + vHalfW + gap + crossDepth);
  addStripeBandZ(hz, hHalfW, vx - vHalfW - gap - crossDepth, vx - vHalfW - gap);

  // Stop lines just outside each crosswalk band.
  addDisplacedPlane(
    vx - vHalfW,
    vx + vHalfW,
    hz + hHalfW + stopOffset - stopHalf,
    hz + hHalfW + stopOffset + stopHalf,
    0.025,
    roadMarkingMat,
    1,
    1,
  );
  addDisplacedPlane(
    vx - vHalfW,
    vx + vHalfW,
    hz - hHalfW - stopOffset - stopHalf,
    hz - hHalfW - stopOffset + stopHalf,
    0.025,
    roadMarkingMat,
    1,
    1,
  );
  addDisplacedPlane(
    vx + vHalfW + stopOffset - stopHalf,
    vx + vHalfW + stopOffset + stopHalf,
    hz - hHalfW,
    hz + hHalfW,
    0.025,
    roadMarkingMat,
    1,
    1,
  );
  addDisplacedPlane(
    vx - vHalfW - stopOffset - stopHalf,
    vx - vHalfW - stopOffset + stopHalf,
    hz - hHalfW,
    hz + hHalfW,
    0.025,
    roadMarkingMat,
    1,
    1,
  );
}

export function placeIntersectionMarkings(verticals, horizontals) {
  for (const v of verticals) {
    if (v.type === "local") continue;
    for (const h of horizontals) {
      if (h.type === "local") continue;
      addIntersectionMarkings(v.x, v.width / 2, h.z, h.width / 2);
    }
  }
}

let environmentTime = 0;

// Animates pond ripples and fountain jets — call once per frame.
export function updateEnvironment(dt) {
  environmentTime += dt / 60;

  for (const p of ripplePonds) {
    const pos = p.geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const ly = pos.getY(i);
      pos.setZ(
        i,
        Math.sin((lx + ly) * 0.6 + environmentTime * 1.6 + p.seed) * 0.04,
      );
    }
    pos.needsUpdate = true;
  }

  for (const f of fountainJets) {
    for (const p of f.particles) {
      const t =
        ((environmentTime * 0.9 + p.phase) % (Math.PI * 2)) / (Math.PI * 2);
      const height = Math.sin(t * Math.PI) * 1.6;
      const spread = t * 0.5;
      p.mesh.position.set(
        f.center.x + Math.cos(p.angle) * spread,
        f.center.y + height,
        f.center.z + Math.sin(p.angle) * spread,
      );
    }
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
  facadeTrim.length = 0;
  facadeBalconies.length = 0;
  facadeRailings.length = 0;
  facadeShutters.length = 0;
  facadeAwnings.length = 0;
  facadeColumns.length = 0;
  facadeShopfronts.length = 0;
  facadeParapets.length = 0;
  roofMeshes.length = 0;
  ripplePonds.length = 0;
  fountainJets.length = 0;
  environmentTime = 0;

  // Base ground (grass — visible in parks and gaps).
  const groundGeometry = new THREE.PlaneGeometry(
    groundSize,
    groundSize,
    240,
    240,
  );
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

  // Displace the terrain: flat in the city center, rising into a hilly ring.
  {
    const pos = groundGeometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const ly = pos.getY(i);
      pos.setZ(i, getGroundHeight(lx, -ly));
    }
    pos.needsUpdate = true;
    groundGeometry.computeVertexNormals();
  }
  state.scene.add(ground);

  // Generate the city layout (buildings + trees + collision boxes + road data).
  const rand = mulberry32(CITY_SEED);
  const { roads, treePositions } = generateCity(rand);

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

  // Hollow buildings (instanced walls/floors/roofs).
  buildHollowInstances();

  // Hilly ring-road highway around the whole world (replaces the old
  // perimeter walls).
  addRingRoad();
  state.ringRoad = { inner: RING_INNER, outer: RING_OUTER };
}

// Returns a ground position (x, z) that is clear of all static obstacles
// (buildings, trees, walls), so entities never spawn trapped inside geometry.
export function findClearSpawnPosition() {
  const half = 1.0; // half footprint (0.5) + clearance margin
  const range = CITY_RADIUS - 10; // stay in the flat city area

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
