// player.js
// Movement, jumping, player shooting, and multi-car system.

import * as THREE from "three";
import { state } from "./state.js";
import { makeBox } from "./character.js";
import { getBullet } from "./bullets.js";
import { triggerGameOver } from "./ui.js";
import { getGroundHeight } from "./world.js";

const moveSpeed = 0.3;
const keys = {
  KeyW: false,
  KeyS: false,
  KeyA: false,
  KeyD: false,
  ArrowUp: false,
  ArrowDown: false,
  ArrowLeft: false,
  ArrowRight: false,
  Space: false,
};
let isJumping = false;
const velocity = new THREE.Vector3();
const directionVec = new THREE.Vector3();
const upVector = new THREE.Vector3(0, 1, 0);
const rightVector = new THREE.Vector3();
const moveVector = new THREE.Vector3();

const doubleSpaceThreshold = 300;
let lastSpacePressTime = 0;

const defaultFOV = 75;
const sniperFOV = 20;
let isSniperMode = false;
let shootCooldown = false;
let sniperShootCooldown = false;

// Third-person camera
const thirdPersonDistance = 6;
const thirdPersonHeight = 3;
const cameraForward = new THREE.Vector3();
const cameraUpOffset = new THREE.Vector3();

// ─── Shared car physics constants ────────────────────────────────────────────
const CAR_MAX_SPEED = 1.0; // reduced from 1.4
const CAR_ACCEL = 0.038;
const CAR_BRAKE = 0.06;
const CAR_FRICTION = 0.014;
const CAR_REVERSE_MAX = 0.42;
const CAR_TURN_RATE = 0.052; // increased from 0.032
const MAX_STEER_ANGLE = Math.PI / 4.5; // ~40° — wider visual lock

// Suspension
const SUSP_TRAVEL = 0.22;
const SUSP_STIFFNESS = 18;
const SUSP_DAMPING = 3.5;

// Collision footprint (shared across all car styles)
const carHalfWidth = 1.1;
const carHalfHeight = 0.9;
const carHalfDepth = 2.3;

// ─── Per-car runtime state (keyed by car group uuid) ─────────────────────────
// We store physics state on userData so each parked car keeps its own state.
function initCarPhysics(car) {
  car.userData.velocity = 0;
  car.userData.steerAngle = 0;
  car.userData.suspOffsets = [0, 0, 0, 0];
  car.userData.suspVels = [0, 0, 0, 0];
  car.userData.bodyRoll = 0;
  car.userData.bodyPitch = 0;
  car.userData.prevVelocity = 0;
}

let carLookYawOffset = 0;
const carForwardVec = new THREE.Vector3();

// ─── Five car style definitions ───────────────────────────────────────────────
// Each entry: { name, paint, dark, fender, hubColor, style }
// style: 'sedan' | 'muscle' | 'suv' | 'sports' | 'pickup'
const CAR_STYLES = [
  // 0 — Classic Sedan (red, the original)
  {
    name: "Sedan",
    paint: 0xcc2222,
    dark: 0x991111,
    fender: 0xb81e1e,
    hub: 0xc8cfd8,
    style: "sedan",
  },
  // 1 — Muscle Car (deep blue, wide body)
  {
    name: "Muscle",
    paint: 0x1a3a8a,
    dark: 0x102266,
    fender: 0x152f70,
    hub: 0xe0c840,
    style: "muscle",
  },
  // 2 — SUV / Truck (army green, taller)
  {
    name: "SUV",
    paint: 0x3a5c2a,
    dark: 0x253d1a,
    fender: 0x2e4a20,
    hub: 0x888888,
    style: "suv",
  },
  // 3 — Sports Car (bright orange, low & long)
  {
    name: "Sports",
    paint: 0xe86010,
    dark: 0xb04808,
    fender: 0xc85508,
    hub: 0xd0d0d0,
    style: "sports",
  },
  // 4 — Pickup Truck (slate purple, open bed)
  {
    name: "Pickup",
    paint: 0x5a3080,
    dark: 0x3a1e58,
    fender: 0x4a2868,
    hub: 0xb0b0b0,
    style: "pickup",
  },
];

// ─── Wheel builder (shared) ───────────────────────────────────────────────────
function makeWheel(hubColor) {
  const TYRE_R = 0.42,
    TYRE_W = 0.28;
  const HUB_R = 0.24,
    HUB_W = 0.06;
  const LUG_R = 0.045,
    LUG_DIST = 0.155,
    LUG_CNT = 5;

  const rubberMat = new THREE.MeshPhongMaterial({
    color: 0x111111,
    shininess: 8,
  });
  const hubMat = new THREE.MeshPhongMaterial({
    color: hubColor,
    shininess: 160,
  });
  const lugMat = new THREE.MeshPhongMaterial({
    color: 0x707880,
    shininess: 80,
  });

  const wg = new THREE.Group();

  const tyreGeo = new THREE.CylinderGeometry(TYRE_R, TYRE_R, TYRE_W, 18);
  tyreGeo.rotateZ(Math.PI / 2);
  const tyre = new THREE.Mesh(tyreGeo, rubberMat);
  tyre.castShadow = true;
  wg.add(tyre);

  const hubGeo = new THREE.CylinderGeometry(HUB_R, HUB_R, HUB_W + 0.01, 16);
  hubGeo.rotateZ(Math.PI / 2);
  const hub = new THREE.Mesh(hubGeo, hubMat);
  hub.castShadow = true;
  wg.add(hub);

  for (let i = 0; i < LUG_CNT; i++) {
    const angle = (i / LUG_CNT) * Math.PI * 2;
    const lugGeo = new THREE.CylinderGeometry(LUG_R, LUG_R, HUB_W + 0.03, 6);
    lugGeo.rotateZ(Math.PI / 2);
    const lug = new THREE.Mesh(lugGeo, lugMat);
    lug.position.set(0, Math.sin(angle) * LUG_DIST, Math.cos(angle) * LUG_DIST);
    wg.add(lug);
  }
  return wg;
}

// ─── Wheel rig builder (suspension pivots + steer pivots) ─────────────────────
function attachWheels(group, hubColor, frontZ, rearZ, trackW, tyreR) {
  const chromeMat = new THREE.MeshPhongMaterial({
    color: 0xd0d8e0,
    shininess: 200,
  });

  // Axle rods (visual only)
  function addAxle(z) {
    const axleGeo = new THREE.CylinderGeometry(0.06, 0.06, trackW * 2 + 0.1, 8);
    axleGeo.rotateZ(Math.PI / 2);
    const axle = new THREE.Mesh(axleGeo, chromeMat);
    axle.position.set(0, tyreR, z);
    group.add(axle);
  }
  addAxle(frontZ);
  addAxle(rearZ);

  // Front steer pivots
  const spL = new THREE.Group();
  spL.position.set(-trackW, tyreR, frontZ);
  group.add(spL);
  const spR = new THREE.Group();
  spR.position.set(trackW, tyreR, frontZ);
  group.add(spR);
  const wFL = makeWheel(hubColor);
  spL.add(wFL);
  const wFR = makeWheel(hubColor);
  spR.add(wFR);

  // Rear fixed groups
  const rlG = new THREE.Group();
  rlG.position.set(-trackW, tyreR, rearZ);
  group.add(rlG);
  const rrG = new THREE.Group();
  rrG.position.set(trackW, tyreR, rearZ);
  group.add(rrG);
  rlG.add(makeWheel(hubColor));
  rrG.add(makeWheel(hubColor));

  group.userData.steerPivotL = spL;
  group.userData.steerPivotR = spR;
  group.userData.wheelGroupFL = wFL;
  group.userData.wheelGroupFR = wFR;
  group.userData.wheelGroupRL = rlG.children[0];
  group.userData.wheelGroupRR = rrG.children[0];
  group.userData.suspFL = spL;
  group.userData.suspFR = spR;
  group.userData.suspRL = rlG;
  group.userData.suspRR = rrG;
  group.userData.suspRestY = tyreR;
}

// ─── createCarByStyle ────────────────────────────────────────────────────────
function createCarByStyle(x, z, styleIdx) {
  const def = CAR_STYLES[styleIdx % CAR_STYLES.length];
  const group = new THREE.Group();

  const paintMat = new THREE.MeshPhongMaterial({
    color: def.paint,
    shininess: 90,
  });
  const darkMat = new THREE.MeshPhongMaterial({
    color: def.dark,
    shininess: 60,
  });
  const fenderMat = new THREE.MeshPhongMaterial({
    color: def.fender,
    shininess: 70,
  });
  const glassM = new THREE.MeshPhongMaterial({
    color: 0x7ab8d4,
    shininess: 120,
    transparent: true,
    opacity: 0.82,
  });
  const chromeMat = new THREE.MeshPhongMaterial({
    color: 0xd0d8e0,
    shininess: 200,
  });
  const lightMat = new THREE.MeshPhongMaterial({
    color: 0xfff5b0,
    shininess: 200,
    emissive: 0xffd040,
    emissiveIntensity: 0.35,
  });
  const tailMat = new THREE.MeshPhongMaterial({
    color: 0xff2200,
    shininess: 100,
    emissive: 0xdd1100,
    emissiveIntensity: 0.2,
  });
  const underMat = new THREE.MeshPhongMaterial({
    color: 0x1a1a1a,
    shininess: 10,
  });

  function add(geo, mat, lx, ly, lz, parent) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.set(lx, ly, lz);
    (parent || group).add(m);
    return m;
  }

  const s = def.style;

  if (s === "sedan") {
    // ── Sedan (original proportions) ────────────────────────────────────────
    add(new THREE.BoxGeometry(2.1, 0.28, 4.6), underMat, 0, 0.28, 0);
    add(new THREE.BoxGeometry(0.12, 0.22, 4.3), darkMat, -1.05, 0.5, 0);
    add(new THREE.BoxGeometry(0.12, 0.22, 4.3), darkMat, 1.05, 0.5, 0);
    add(new THREE.BoxGeometry(1.98, 0.38, 4.4), paintMat, 0, 0.61, 0);
    add(new THREE.BoxGeometry(1.8, 0.12, 1.3), paintMat, 0, 0.84, 1.52);
    add(new THREE.BoxGeometry(1.8, 0.14, 0.95), paintMat, 0, 0.84, -1.62);
    add(new THREE.BoxGeometry(1.62, 0.12, 1.7), paintMat, 0, 1.64, -0.18);
    add(new THREE.BoxGeometry(1.68, 0.56, 1.72), paintMat, 0, 1.22, -0.18);
    add(new THREE.BoxGeometry(1.46, 0.52, 0.1), glassM, 0, 1.28, 0.72);
    add(new THREE.BoxGeometry(1.46, 0.45, 0.1), glassM, 0, 1.28, -1.06);
    add(new THREE.BoxGeometry(0.06, 0.36, 1.3), glassM, -0.84, 1.28, -0.18);
    add(new THREE.BoxGeometry(0.06, 0.36, 1.3), glassM, 0.84, 1.28, -0.18);
    add(new THREE.BoxGeometry(0.08, 0.5, 0.08), chromeMat, -0.76, 1.22, 0.72);
    add(new THREE.BoxGeometry(0.08, 0.5, 0.08), chromeMat, 0.76, 1.22, 0.72);
    add(new THREE.BoxGeometry(0.44, 0.14, 0.1), lightMat, -0.58, 0.68, 2.26);
    add(new THREE.BoxGeometry(0.44, 0.14, 0.1), lightMat, 0.58, 0.68, 2.26);
    add(new THREE.BoxGeometry(0.2, 0.08, 0.08), lightMat, -0.72, 0.56, 2.24);
    add(new THREE.BoxGeometry(0.2, 0.08, 0.08), lightMat, 0.72, 0.56, 2.24);
    add(new THREE.BoxGeometry(1.4, 0.06, 0.08), chromeMat, 0, 0.5, 2.26);
    add(new THREE.BoxGeometry(0.5, 0.14, 0.1), tailMat, -0.62, 0.68, -2.26);
    add(new THREE.BoxGeometry(0.5, 0.14, 0.1), tailMat, 0.62, 0.68, -2.26);
    add(new THREE.BoxGeometry(1.8, 0.12, 0.1), chromeMat, 0, 0.4, -2.28);
    add(new THREE.BoxGeometry(1.8, 0.16, 0.12), chromeMat, 0, 0.36, 2.3);
    const aw = 0.14,
      ah = 0.18,
      ad = 0.98;
    add(new THREE.BoxGeometry(aw, ah, ad), fenderMat, -1.04, 0.76, 1.4);
    add(new THREE.BoxGeometry(aw, ah, ad), fenderMat, 1.04, 0.76, 1.4);
    add(new THREE.BoxGeometry(aw, ah, ad), fenderMat, -1.04, 0.76, -1.4);
    add(new THREE.BoxGeometry(aw, ah, ad), fenderMat, 1.04, 0.76, -1.4);
    attachWheels(group, def.hub, 1.42, -1.42, 1.02, 0.42);
  } else if (s === "muscle") {
    // ── Muscle Car — wide, long hood, fastback roofline ─────────────────────
    add(new THREE.BoxGeometry(2.3, 0.26, 4.8), underMat, 0, 0.26, 0);
    add(new THREE.BoxGeometry(0.14, 0.24, 4.5), darkMat, -1.15, 0.48, 0);
    add(new THREE.BoxGeometry(0.14, 0.24, 4.5), darkMat, 1.15, 0.48, 0);
    add(new THREE.BoxGeometry(2.18, 0.36, 4.7), paintMat, 0, 0.58, 0);
    // Long hood
    add(new THREE.BoxGeometry(2.0, 0.14, 1.8), paintMat, 0, 0.82, 1.6);
    // Hood scoop
    add(new THREE.BoxGeometry(0.6, 0.12, 0.7), darkMat, 0, 0.96, 1.4);
    // Short trunk
    add(new THREE.BoxGeometry(1.9, 0.12, 0.6), paintMat, 0, 0.82, -1.9);
    // Fastback cabin (sits further back)
    add(new THREE.BoxGeometry(1.8, 0.1, 1.5), paintMat, 0, 1.58, -0.5);
    add(new THREE.BoxGeometry(1.82, 0.58, 1.52), paintMat, 0, 1.18, -0.5);
    // Windscreen (raked)
    add(new THREE.BoxGeometry(1.58, 0.54, 0.1), glassM, 0, 1.26, 0.52);
    add(new THREE.BoxGeometry(1.58, 0.4, 0.1), glassM, 0, 1.26, -1.26);
    add(new THREE.BoxGeometry(0.06, 0.38, 1.1), glassM, -0.9, 1.26, -0.5);
    add(new THREE.BoxGeometry(0.06, 0.38, 1.1), glassM, 0.9, 1.26, -0.5);
    // Lights
    add(new THREE.BoxGeometry(0.52, 0.16, 0.1), lightMat, -0.64, 0.66, 2.38);
    add(new THREE.BoxGeometry(0.52, 0.16, 0.1), lightMat, 0.64, 0.66, 2.38);
    add(new THREE.BoxGeometry(0.6, 0.14, 0.1), tailMat, -0.66, 0.68, -2.38);
    add(new THREE.BoxGeometry(0.6, 0.14, 0.1), tailMat, 0.66, 0.68, -2.38);
    add(new THREE.BoxGeometry(1.9, 0.18, 0.12), chromeMat, 0, 0.34, 2.42);
    add(new THREE.BoxGeometry(1.9, 0.12, 0.1), chromeMat, 0, 0.38, -2.4);
    // Side exhausts
    add(new THREE.BoxGeometry(0.1, 0.1, 1.2), darkMat, -1.14, 0.3, -0.8);
    add(new THREE.BoxGeometry(0.1, 0.1, 1.2), darkMat, 1.14, 0.3, -0.8);
    // Wide fenders
    add(new THREE.BoxGeometry(0.18, 0.22, 1.1), fenderMat, -1.14, 0.76, 1.42);
    add(new THREE.BoxGeometry(0.18, 0.22, 1.1), fenderMat, 1.14, 0.76, 1.42);
    add(new THREE.BoxGeometry(0.18, 0.22, 1.1), fenderMat, -1.14, 0.76, -1.42);
    add(new THREE.BoxGeometry(0.18, 0.22, 1.1), fenderMat, 1.14, 0.76, -1.42);
    attachWheels(group, def.hub, 1.42, -1.42, 1.1, 0.42);
  } else if (s === "suv") {
    // ── SUV — tall, boxy, high ride ─────────────────────────────────────────
    add(new THREE.BoxGeometry(2.2, 0.32, 4.7), underMat, 0, 0.32, 0);
    add(new THREE.BoxGeometry(0.12, 0.28, 4.4), darkMat, -1.1, 0.58, 0);
    add(new THREE.BoxGeometry(0.12, 0.28, 4.4), darkMat, 1.1, 0.58, 0);
    add(new THREE.BoxGeometry(2.08, 0.46, 4.6), paintMat, 0, 0.7, 0);
    // Flat hood
    add(new THREE.BoxGeometry(1.96, 0.14, 1.2), paintMat, 0, 0.96, 1.62);
    // Flat roof rack suggestion
    add(new THREE.BoxGeometry(1.7, 0.1, 2.1), paintMat, 0, 1.9, -0.1);
    add(new THREE.BoxGeometry(0.05, 0.06, 2.0), darkMat, -0.82, 1.96, -0.1);
    add(new THREE.BoxGeometry(0.05, 0.06, 2.0), darkMat, 0.82, 1.96, -0.1);
    // Tall boxy cabin
    add(new THREE.BoxGeometry(1.84, 0.8, 2.2), paintMat, 0, 1.4, -0.1);
    add(new THREE.BoxGeometry(1.6, 0.7, 0.1), glassM, 0, 1.42, 0.98);
    add(new THREE.BoxGeometry(1.6, 0.7, 0.1), glassM, 0, 1.42, -1.18);
    add(new THREE.BoxGeometry(0.06, 0.58, 1.8), glassM, -0.91, 1.42, -0.1);
    add(new THREE.BoxGeometry(0.06, 0.58, 1.8), glassM, 0.91, 1.42, -0.1);
    // Roof lights bar
    add(new THREE.BoxGeometry(1.5, 0.08, 0.22), lightMat, 0, 1.98, 0.82);
    // Bumpers (chunky)
    add(new THREE.BoxGeometry(2.08, 0.28, 0.18), darkMat, 0, 0.44, 2.42);
    add(new THREE.BoxGeometry(2.08, 0.24, 0.18), darkMat, 0, 0.44, -2.42);
    add(new THREE.BoxGeometry(0.52, 0.18, 0.1), lightMat, -0.6, 0.7, 2.42);
    add(new THREE.BoxGeometry(0.52, 0.18, 0.1), lightMat, 0.6, 0.7, 2.42);
    add(new THREE.BoxGeometry(0.56, 0.16, 0.1), tailMat, -0.62, 0.72, -2.42);
    add(new THREE.BoxGeometry(0.56, 0.16, 0.1), tailMat, 0.62, 0.72, -2.42);
    // Step bars
    add(new THREE.BoxGeometry(0.14, 0.1, 3.2), darkMat, -1.1, 0.22, 0);
    add(new THREE.BoxGeometry(0.14, 0.1, 3.2), darkMat, 1.1, 0.22, 0);
    // Fenders
    add(new THREE.BoxGeometry(0.16, 0.24, 1.1), fenderMat, -1.1, 0.84, 1.44);
    add(new THREE.BoxGeometry(0.16, 0.24, 1.1), fenderMat, 1.1, 0.84, 1.44);
    add(new THREE.BoxGeometry(0.16, 0.24, 1.1), fenderMat, -1.1, 0.84, -1.44);
    add(new THREE.BoxGeometry(0.16, 0.24, 1.1), fenderMat, 1.1, 0.84, -1.44);
    attachWheels(group, def.hub, 1.44, -1.44, 1.05, 0.46);
  } else if (s === "sports") {
    // ── Sports Car — low, wide, long, wedge nose ─────────────────────────────
    add(new THREE.BoxGeometry(2.14, 0.22, 4.9), underMat, 0, 0.22, 0);
    add(new THREE.BoxGeometry(0.1, 0.18, 4.6), darkMat, -1.07, 0.38, 0);
    add(new THREE.BoxGeometry(0.1, 0.18, 4.6), darkMat, 1.07, 0.38, 0);
    add(new THREE.BoxGeometry(2.04, 0.32, 4.8), paintMat, 0, 0.48, 0);
    // Long low hood
    add(new THREE.BoxGeometry(1.92, 0.1, 2.0), paintMat, 0, 0.72, 1.7);
    // Aero splitter
    add(new THREE.BoxGeometry(2.1, 0.06, 0.3), darkMat, 0, 0.16, 2.5);
    // Rear diffuser
    add(new THREE.BoxGeometry(2.0, 0.08, 0.28), darkMat, 0, 0.2, -2.52);
    // Rear spoiler
    add(new THREE.BoxGeometry(1.8, 0.08, 0.22), darkMat, 0, 0.98, -2.3);
    add(new THREE.BoxGeometry(0.08, 0.28, 0.08), darkMat, -0.8, 0.86, -2.3);
    add(new THREE.BoxGeometry(0.08, 0.28, 0.08), darkMat, 0.8, 0.86, -2.3);
    // Low coupe cabin
    add(new THREE.BoxGeometry(1.74, 0.08, 1.4), paintMat, 0, 1.4, -0.1);
    add(new THREE.BoxGeometry(1.76, 0.46, 1.42), paintMat, 0, 1.1, -0.1);
    // Raked windscreen
    add(new THREE.BoxGeometry(1.54, 0.44, 0.1), glassM, 0, 1.16, 0.6);
    add(new THREE.BoxGeometry(1.54, 0.38, 0.1), glassM, 0, 1.16, -0.8);
    add(new THREE.BoxGeometry(0.06, 0.34, 1.0), glassM, -0.86, 1.14, -0.1);
    add(new THREE.BoxGeometry(0.06, 0.34, 1.0), glassM, 0.86, 1.14, -0.1);
    // Lights (thin, wide)
    add(new THREE.BoxGeometry(0.64, 0.1, 0.08), lightMat, -0.56, 0.6, 2.46);
    add(new THREE.BoxGeometry(0.64, 0.1, 0.08), lightMat, 0.56, 0.6, 2.46);
    add(new THREE.BoxGeometry(0.68, 0.1, 0.08), tailMat, -0.56, 0.62, -2.46);
    add(new THREE.BoxGeometry(0.68, 0.1, 0.08), tailMat, 0.56, 0.62, -2.46);
    add(new THREE.BoxGeometry(1.9, 0.1, 0.1), chromeMat, 0, 0.3, 2.5);
    // Side vents
    add(new THREE.BoxGeometry(0.08, 0.12, 0.4), darkMat, -1.06, 0.56, 0.6);
    add(new THREE.BoxGeometry(0.08, 0.12, 0.4), darkMat, 1.06, 0.56, 0.6);
    // Fenders (flared)
    add(new THREE.BoxGeometry(0.18, 0.18, 1.0), fenderMat, -1.06, 0.68, 1.44);
    add(new THREE.BoxGeometry(0.18, 0.18, 1.0), fenderMat, 1.06, 0.68, 1.44);
    add(new THREE.BoxGeometry(0.18, 0.18, 1.0), fenderMat, -1.06, 0.68, -1.44);
    add(new THREE.BoxGeometry(0.18, 0.18, 1.0), fenderMat, 1.06, 0.68, -1.44);
    attachWheels(group, def.hub, 1.44, -1.44, 1.0, 0.4);
  } else {
    // ── Pickup Truck — cab + open flat bed ───────────────────────────────────
    add(new THREE.BoxGeometry(2.2, 0.3, 5.0), underMat, 0, 0.3, 0);
    add(new THREE.BoxGeometry(0.12, 0.26, 4.7), darkMat, -1.1, 0.54, 0);
    add(new THREE.BoxGeometry(0.12, 0.26, 4.7), darkMat, 1.1, 0.54, 0);
    add(new THREE.BoxGeometry(2.08, 0.4, 4.9), paintMat, 0, 0.62, 0);
    // Short cab (front half)
    add(new THREE.BoxGeometry(2.0, 0.12, 1.6), paintMat, 0, 0.88, 1.5);
    add(new THREE.BoxGeometry(1.88, 0.12, 1.8), paintMat, 0, 1.68, 0.7);
    add(new THREE.BoxGeometry(1.9, 0.64, 1.82), paintMat, 0, 1.36, 0.7);
    add(new THREE.BoxGeometry(1.68, 0.58, 0.1), glassM, 0, 1.38, 1.58);
    add(new THREE.BoxGeometry(1.68, 0.5, 0.1), glassM, 0, 1.38, -0.18);
    add(new THREE.BoxGeometry(0.06, 0.44, 1.5), glassM, -0.93, 1.38, 0.7);
    add(new THREE.BoxGeometry(0.06, 0.44, 1.5), glassM, 0.93, 1.38, 0.7);
    // Open flat bed (rear half)
    add(new THREE.BoxGeometry(2.0, 0.1, 2.0), paintMat, 0, 0.8, -1.5);
    // Bed walls
    add(new THREE.BoxGeometry(2.0, 0.42, 0.1), paintMat, 0, 1.0, -2.48);
    add(new THREE.BoxGeometry(0.1, 0.42, 1.9), paintMat, -0.99, 1.0, -1.5);
    add(new THREE.BoxGeometry(0.1, 0.42, 1.9), paintMat, 0.99, 1.0, -1.5);
    // Lights
    add(new THREE.BoxGeometry(0.5, 0.18, 0.1), lightMat, -0.6, 0.7, 2.48);
    add(new THREE.BoxGeometry(0.5, 0.18, 0.1), lightMat, 0.6, 0.7, 2.48);
    add(new THREE.BoxGeometry(0.54, 0.18, 0.1), tailMat, -0.6, 0.72, -2.5);
    add(new THREE.BoxGeometry(0.54, 0.18, 0.1), tailMat, 0.6, 0.72, -2.5);
    add(new THREE.BoxGeometry(2.08, 0.22, 0.16), darkMat, 0, 0.4, 2.52);
    add(new THREE.BoxGeometry(2.08, 0.2, 0.14), darkMat, 0, 0.38, -2.52);
    // Chrome grille
    add(new THREE.BoxGeometry(1.6, 0.14, 0.08), chromeMat, 0, 0.6, 2.5);
    // Step bars
    add(new THREE.BoxGeometry(0.12, 0.08, 2.8), darkMat, -1.1, 0.24, 0.4);
    add(new THREE.BoxGeometry(0.12, 0.08, 2.8), darkMat, 1.1, 0.24, 0.4);
    // Fenders
    add(new THREE.BoxGeometry(0.16, 0.24, 1.1), fenderMat, -1.1, 0.8, 1.44);
    add(new THREE.BoxGeometry(0.16, 0.24, 1.1), fenderMat, 1.1, 0.8, 1.44);
    add(new THREE.BoxGeometry(0.16, 0.24, 1.1), fenderMat, -1.1, 0.8, -1.44);
    add(new THREE.BoxGeometry(0.16, 0.24, 1.1), fenderMat, 1.1, 0.8, -1.44);
    attachWheels(group, def.hub, 1.44, -1.44, 1.04, 0.44);
  }

  group.userData.styleIndex = styleIdx;
  group.userData.styleName = def.name;
  group.position.set(x, 0, z);
  initCarPhysics(group);
  return group;
}

// ─── SAT collision helpers ────────────────────────────────────────────────────
function carOverlapWithAabb(carPos, yaw, aabb, shrink = 0) {
  if (
    carPos.y + carHalfHeight < aabb.min.y ||
    carPos.y - carHalfHeight > aabb.max.y
  )
    return null;
  const cosY = Math.cos(yaw),
    sinY = Math.sin(yaw);
  const carAxisX = { x: cosY, z: sinY };
  const carAxisZ = { x: -sinY, z: cosY };
  const axes = [carAxisX, carAxisZ, { x: 1, z: 0 }, { x: 0, z: 1 }];
  const hw = carHalfWidth - shrink,
    hd = carHalfDepth - shrink;
  const aabbCx = (aabb.min.x + aabb.max.x) / 2,
    aabbCz = (aabb.min.z + aabb.max.z) / 2;
  const aabbHx = (aabb.max.x - aabb.min.x) / 2,
    aabbHz = (aabb.max.z - aabb.min.z) / 2;
  const dx = carPos.x - aabbCx,
    dz = carPos.z - aabbCz;
  let minDepth = Infinity,
    n = { x: 0, z: 0 };
  for (const axis of axes) {
    const carRadius =
      hw * Math.abs(axis.x * carAxisX.x + axis.z * carAxisX.z) +
      hd * Math.abs(axis.x * carAxisZ.x + axis.z * carAxisZ.z);
    const aabbRadius = aabbHx * Math.abs(axis.x) + aabbHz * Math.abs(axis.z);
    const distance = axis.x * dx + axis.z * dz;
    const overlap = carRadius + aabbRadius - Math.abs(distance);
    if (overlap < 0) return null;
    if (overlap < minDepth) {
      minDepth = overlap;
      const sign = distance >= 0 ? 1 : -1;
      n = { x: axis.x * sign, z: axis.z * sign };
    }
  }
  return { depth: minDepth, nx: n.x, nz: n.z };
}
function carIntersectsAabb(carPos, yaw, aabb) {
  return carOverlapWithAabb(carPos, yaw, aabb, 0) !== null;
}
function carCollides(position, yaw, shrink = 0) {
  for (const t of state.treeBoxes)
    if (carOverlapWithAabb(position, yaw, t, shrink)) return true;
  for (const b of state.buildingBoxes)
    if (carOverlapWithAabb(position, yaw, b, shrink)) return true;
  for (const w of state.wallBoxes)
    if (carOverlapWithAabb(position, yaw, w, shrink)) return true;
  return false;
}
function resolveCarOverlaps(car) {
  for (let iter = 0; iter < 4; iter++) {
    let worst = null;
    for (const list of [state.treeBoxes, state.buildingBoxes, state.wallBoxes])
      for (const box of list) {
        const o = carOverlapWithAabb(car.position, car.rotation.y, box, 0);
        if (o && (!worst || o.depth > worst.depth)) worst = o;
      }
    if (!worst) break;
    car.position.x += worst.nx * (worst.depth + 0.02);
    car.position.z += worst.nz * (worst.depth + 0.02);
  }
}
function staticCollides(box) {
  for (const t of state.treeBoxes) if (box.intersectsBox(t)) return true;
  for (const b of state.buildingBoxes) if (box.intersectsBox(b)) return true;
  for (const w of state.wallBoxes) if (box.intersectsBox(w)) return true;
  return false;
}
function runOverEnemies(car) {
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const enemy = state.enemies[i];
    const enemyBox = makeBox(
      enemy.mesh.position,
      enemy.halfWidth,
      enemy.halfHeight,
      enemy.halfDepth,
    );
    if (carIntersectsAabb(car.position, car.rotation.y, enemyBox)) {
      state.scene.remove(enemy.mesh);
      state.enemies.splice(i, 1);
    }
  }
}

// ─── Enter / exit ─────────────────────────────────────────────────────────────
function enterCar(car) {
  state.car = car;
  state.inCar = true;
  state.player.visible = false;
  carLookYawOffset = 0;
  car.userData.velocity = 0;
}
function exitCar() {
  const car = state.car;
  state.inCar = false;
  state.player.visible = true;
  car.userData.velocity = 0;
  const carPos = car.position;
  const offsets = [
    [2.5, 0],
    [-2.5, 0],
    [0, 2.5],
    [0, -2.5],
    [2.5, 2.5],
    [-2.5, -2.5],
    [2.5, -2.5],
    [-2.5, 2.5],
  ];
  for (const [dx, dz] of offsets) {
    const pos = new THREE.Vector3(
      carPos.x + dx,
      getGroundHeight(carPos.x + dx, carPos.z + dz) + 1,
      carPos.z + dz,
    );
    if (!staticCollides(makeBox(pos, 0.5, 1, 0.5))) {
      state.player.position.copy(pos);
      return;
    }
  }
  const boundary = state.groundSize / 2 - 1;
  const fx = Math.max(-boundary, Math.min(boundary, carPos.x + 2.5));
  const fz = Math.max(-boundary, Math.min(boundary, carPos.z));
  state.player.position.set(fx, getGroundHeight(fx, fz) + 1, fz);
}

// ─── Spawn clear spot near player ────────────────────────────────────────────
function findSpawnSpot(avoidPositions) {
  const p = state.player.position;
  for (let i = 0; i < 80; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 40;
    const x = p.x + Math.cos(a) * r,
      z = p.z + Math.sin(a) * r;
    const pos = new THREE.Vector3(x, 0, z);
    if (carCollides(pos, 0)) continue;
    // Keep away from other cars
    let tooClose = false;
    for (const ap of avoidPositions) {
      if (Math.hypot(x - ap.x, z - ap.z) < 12) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) return { x, z };
  }
  // Fallback: scatter in cardinal directions
  return { x: p.x + 15 + Math.random() * 5, z: p.z + 15 + Math.random() * 5 };
}

// ─── initCar — spawn 5 cars ───────────────────────────────────────────────────
export function initCar() {
  // state.cars will hold all car groups; state.car = currently driven one
  if (!state.cars) state.cars = [];

  const spawnedPositions = [];

  for (let i = 0; i < 5; i++) {
    const spot = findSpawnSpot(spawnedPositions);
    spawnedPositions.push(spot);

    const car = createCarByStyle(spot.x, spot.z, i);
    car.position.y = getGroundHeight(spot.x, spot.z);
    car.rotation.y = Math.random() * Math.PI * 2; // random heading
    state.scene.add(car);
    state.cars.push(car);

    // First car is the default driveable one
    if (i === 0) state.car = car;
  }

  // E / Enter — enter nearest car, or exit current
  document.addEventListener("keydown", (event) => {
    if (event.code !== "KeyE" && event.code !== "Enter") return;
    if (state.inCar) {
      exitCar();
      return;
    }
    // Find closest car within range
    let closest = null,
      closestDist = 6;
    for (const car of state.cars) {
      const d = state.player.position.distanceTo(car.position);
      if (d < closestDist) {
        closestDist = d;
        closest = car;
      }
    }
    if (closest) enterCar(closest);
  });

  document.addEventListener("mousemove", (event) => {
    if (state.inCar) carLookYawOffset += event.movementX * 0.002;
  });
}

// ─── updateCar — drives state.car ────────────────────────────────────────────
export function updateCar(dt) {
  const car = state.car;
  if (!car) return;

  const ud = car.userData;
  let carVelocity = ud.velocity;
  const absVel = Math.abs(carVelocity);

  // ── Steering ──────────────────────────────────────────────────────────────
  const speedRatio = Math.min(absVel / CAR_MAX_SPEED, 1);
  const turnScale = 1 - speedRatio * 0.4; // less taper = more turn at speed
  let turnInput = 0;
  if (keys["KeyA"] || keys["ArrowLeft"]) turnInput = 1;
  if (keys["KeyD"] || keys["ArrowRight"]) turnInput = -1;

  if (absVel > 0.01) {
    const dir = carVelocity >= 0 ? 1 : -1;
    car.rotation.y += turnInput * CAR_TURN_RATE * turnScale * dt * dir;
  }

  // Visual steer angle — snappier tracking
  const targetSteer = turnInput * MAX_STEER_ANGLE * turnScale;
  ud.steerAngle += (targetSteer - ud.steerAngle) * 0.22 * dt;

  // ── Acceleration / braking ────────────────────────────────────────────────
  if (keys["KeyW"] || keys["ArrowUp"]) {
    carVelocity = Math.min(carVelocity + CAR_ACCEL * dt, CAR_MAX_SPEED);
  } else if (keys["KeyS"] || keys["ArrowDown"]) {
    if (carVelocity > 0.05) {
      carVelocity = Math.max(0, carVelocity - CAR_BRAKE * dt);
    } else {
      carVelocity = Math.max(
        carVelocity - CAR_ACCEL * 0.55 * dt,
        -CAR_REVERSE_MAX,
      );
    }
  } else {
    const friction = CAR_FRICTION * dt;
    if (carVelocity > 0) carVelocity = Math.max(0, carVelocity - friction);
    else carVelocity = Math.min(0, carVelocity + friction);
  }

  // ── Movement & slope ──────────────────────────────────────────────────────
  if (Math.abs(carVelocity) > 0.001) {
    carForwardVec.set(Math.sin(car.rotation.y), 0, Math.cos(car.rotation.y));
    const s = 1.5;
    const slopeH =
      (getGroundHeight(
        car.position.x + carForwardVec.x * s,
        car.position.z + carForwardVec.z * s,
      ) -
        getGroundHeight(
          car.position.x - carForwardVec.x * s,
          car.position.z - carForwardVec.z * s,
        )) /
      (2 * s);
    const slopeScale = Math.max(0.35, Math.min(1.5, 1 - slopeH * 1.2));
    const move = carForwardVec
      .clone()
      .multiplyScalar(carVelocity * slopeScale * dt);
    if (!carCollides(car.position.clone().add(move), car.rotation.y, 0.12)) {
      car.position.add(move);
    } else {
      carVelocity *= 0.3;
    }
  }

  resolveCarOverlaps(car);

  const boundary = state.groundSize / 2 - 2;
  car.position.x = Math.max(-boundary, Math.min(boundary, car.position.x));
  car.position.z = Math.max(-boundary, Math.min(boundary, car.position.z));

  // ── Terrain following ─────────────────────────────────────────────────────
  const fy = car.rotation.y;
  const fxA = Math.sin(fy),
    fzA = Math.cos(fy);
  const rxA = Math.cos(fy),
    rzA = -Math.sin(fy);
  const L = 1.42,
    W = 0.95,
    CLEAR = 0.055;

  const hFL = getGroundHeight(
    car.position.x + fxA * L - rxA * W,
    car.position.z + fzA * L - rzA * W,
  );
  const hFR = getGroundHeight(
    car.position.x + fxA * L + rxA * W,
    car.position.z + fzA * L + rzA * W,
  );
  const hRL = getGroundHeight(
    car.position.x - fxA * L - rxA * W,
    car.position.z - fzA * L - rzA * W,
  );
  const hRR = getGroundHeight(
    car.position.x - fxA * L + rxA * W,
    car.position.z - fzA * L + rzA * W,
  );

  const frontH = (hFL + hFR) / 2,
    rearH = (hRL + hRR) / 2;
  const leftH = (hFL + hRL) / 2,
    rightH = (hFR + hRR) / 2;

  // Use the HIGHEST of all four corners so the body never clips into the slope.
  // Averaging or using center-point alone undershoots on steep terrain because
  // the tilted chassis geometry reaches lower than the sampled center height.
  const highestCorner = Math.max(hFL, hFR, hRL, hRR);
  car.position.y = highestCorner + CLEAR;

  // ── Suspension ────────────────────────────────────────────────────────────
  const cornerHeights = [hFL, hFR, hRL, hRR];
  const suspGroups = [ud.suspFL, ud.suspFR, ud.suspRL, ud.suspRR];
  const restY = ud.suspRestY;

  for (let i = 0; i < 4; i++) {
    const groundLocal = cornerHeights[i] - car.position.y;
    const compression = Math.max(
      0,
      Math.min(SUSP_TRAVEL, restY - groundLocal - CLEAR),
    );
    const springF = SUSP_STIFFNESS * (compression - ud.suspOffsets[i]);
    const dampF = SUSP_DAMPING * ud.suspVels[i];
    const accelS = springF - dampF;
    ud.suspVels[i] += accelS * 0.016;
    ud.suspOffsets[i] += ud.suspVels[i] * 0.016;
    ud.suspOffsets[i] = Math.max(0, Math.min(SUSP_TRAVEL, ud.suspOffsets[i]));
    suspGroups[i].position.y = restY - ud.suspOffsets[i];
  }

  // ── Body roll & pitch ─────────────────────────────────────────────────────
  const targetRoll = -turnInput * speedRatio * 0.055;
  const accelDelta = carVelocity - ud.prevVelocity;
  const targetPitch = -accelDelta * 12;
  ud.prevVelocity = carVelocity;

  ud.bodyRoll += (targetRoll - ud.bodyRoll) * 0.1 * dt;
  ud.bodyPitch += (targetPitch - ud.bodyPitch) * 0.08 * dt;
  ud.bodyPitch = Math.max(-0.08, Math.min(0.08, ud.bodyPitch));

  // Add cosmetic lean on top of terrain angles (assignment already set above).
  // Must be += because terrain pitch/roll were already written two lines up.
  // To prevent double-accumulation we store the PREVIOUS cosmetic offsets and
  // remove them before re-adding the new ones.
  car.rotation.z = Math.atan2(rightH - leftH, 2 * W) + ud.bodyRoll;
  car.rotation.x = Math.atan2(frontH - rearH, 2 * L) + ud.bodyPitch;

  // ── Steering visual ───────────────────────────────────────────────────────
  ud.steerPivotL.rotation.y = ud.steerAngle;
  ud.steerPivotR.rotation.y = ud.steerAngle;

  // ── Wheel spin ────────────────────────────────────────────────────────────
  const spinDelta = (carVelocity * dt) / 0.42;
  ud.wheelGroupFL.rotation.x += spinDelta;
  ud.wheelGroupFR.rotation.x += spinDelta;
  ud.wheelGroupRL.rotation.x += spinDelta;
  ud.wheelGroupRR.rotation.x += spinDelta;

  // Save velocity back
  ud.velocity = carVelocity;

  runOverEnemies(car);

  state.player.position.set(car.position.x, car.position.y + 1, car.position.z);
}

// ─── updateCamera ─────────────────────────────────────────────────────────────
export function updateCamera() {
  if (state.inCar && state.car) {
    const yaw = state.car.rotation.y + carLookYawOffset;
    carForwardVec.set(Math.sin(yaw), 0, Math.cos(yaw));

    // Ideal camera position: 8 units behind, 3 units above the car.
    const idealX = state.car.position.x - carForwardVec.x * 8;
    const idealZ = state.car.position.z - carForwardVec.z * 8;
    const idealY = state.car.position.y + 3;

    // Clamp camera Y so it never goes below the terrain at the camera's XZ.
    const groundAtCam = getGroundHeight(idealX, idealZ) + 0.5;
    const camY = Math.max(idealY, groundAtCam);

    state.camera.position.set(idealX, camY, idealZ);

    // LookAt target: car center raised by 1 unit — always above ground.
    const lookY = Math.max(
      state.car.position.y + 1,
      getGroundHeight(state.car.position.x, state.car.position.z) + 0.5,
    );
    state.camera.lookAt(state.car.position.x, lookY, state.car.position.z);
    return;
  }
  if (state.thirdPerson) {
    state.camera.getWorldDirection(cameraForward);
    cameraForward.y = 0;
    if (cameraForward.lengthSq() < 1e-6) cameraForward.set(0, 0, -1);
    cameraForward.normalize();
    state.camera.position
      .copy(state.player.position)
      .add(cameraUpOffset.set(0, thirdPersonHeight, 0))
      .addScaledVector(cameraForward, -thirdPersonDistance);
  } else {
    state.camera.position.set(
      state.player.position.x,
      state.player.position.y + 2,
      state.player.position.z,
    );
  }
}

// ─── Player movement ──────────────────────────────────────────────────────────
function jumpToBuilding() {
  if (state.playerIndoors) return;
  let candidateBuilding = null,
    minDistance = Infinity;
  const margin = 2;
  for (const buildingBox of state.buildingBoxes) {
    if (
      state.player.position.x >= buildingBox.min.x - margin &&
      state.player.position.x <= buildingBox.max.x + margin &&
      state.player.position.z >= buildingBox.min.z - margin &&
      state.player.position.z <= buildingBox.max.z + margin
    ) {
      const center = new THREE.Vector3();
      buildingBox.getCenter(center);
      const d = Math.sqrt(
        (state.player.position.x - center.x) ** 2 +
          (state.player.position.z - center.z) ** 2,
      );
      if (d < minDistance) {
        minDistance = d;
        candidateBuilding = buildingBox;
      }
    }
  }
  if (candidateBuilding) state.player.position.y = candidateBuilding.max.y + 1;
}

function shootBullet() {
  if (shootCooldown) return;
  const bullet = getBullet(0xff0000, false);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), state.camera);
  const dir = raycaster.ray.direction.clone();
  bullet.position.copy(
    state.camera.position.clone().add(dir.clone().multiplyScalar(1.1)),
  );
  bullet.userData.direction = dir;
  state.scene.add(bullet);
  state.bullets.push(bullet);
  shootCooldown = true;
  setTimeout(() => {
    shootCooldown = false;
  }, 200);
}

function shootSniperBullet() {
  if (sniperShootCooldown) return;
  const bullet = getBullet(0xff0000, false);
  bullet.userData.isSniper = true;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), state.camera);
  const dir = raycaster.ray.direction.clone();
  bullet.position.copy(
    state.camera.position.clone().add(dir.clone().multiplyScalar(1.1)),
  );
  bullet.userData.direction = dir;
  state.scene.add(bullet);
  state.bullets.push(bullet);
  sniperShootCooldown = true;
  setTimeout(() => {
    sniperShootCooldown = false;
  }, 500);
}

function getCurrentSupportingBuilding() {
  const margin = 2;
  for (const buildingBox of state.buildingBoxes) {
    if (
      state.player.position.x >= buildingBox.min.x - margin &&
      state.player.position.x <= buildingBox.max.x + margin &&
      state.player.position.z >= buildingBox.min.z - margin &&
      state.player.position.z <= buildingBox.max.z + margin
    ) {
      const targetY = buildingBox.max.y + 1;
      if (Math.abs(state.player.position.y - targetY) < 0.5) return buildingBox;
    }
  }
  return null;
}

export function updateMovement(dt) {
  const supportingBuilding = getCurrentSupportingBuilding();
  const supportingGround = supportingBuilding
    ? supportingBuilding.max.y + 1
    : null;

  state.camera.getWorldDirection(directionVec);
  directionVec.y = 0;
  directionVec.normalize();
  state.player.rotation.y = Math.atan2(directionVec.x, directionVec.z);
  rightVector.crossVectors(upVector, directionVec).normalize();

  const speed = moveSpeed * dt;
  moveVector.set(0, 0, 0);
  if (keys["KeyW"] || keys["ArrowUp"])
    moveVector.addScaledVector(directionVec, speed);
  if (keys["KeyS"] || keys["ArrowDown"])
    moveVector.addScaledVector(directionVec, -speed);
  if (keys["KeyA"] || keys["ArrowLeft"])
    moveVector.addScaledVector(rightVector, speed);
  if (keys["KeyD"] || keys["ArrowRight"])
    moveVector.addScaledVector(rightVector, -speed);

  const horiz = Math.hypot(moveVector.x, moveVector.z);
  if (horiz > 1e-6) {
    const curH = getGroundHeight(
      state.player.position.x,
      state.player.position.z,
    );
    const newH = getGroundHeight(
      state.player.position.x + moveVector.x,
      state.player.position.z + moveVector.z,
    );
    const slope = (newH - curH) / horiz;
    moveVector.multiplyScalar(Math.max(0.45, Math.min(1.4, 1 - slope * 1.1)));
  }

  const playerBox = makeBox(state.player.position, 0.5, 1, 0.5);
  const newPlayerBox = playerBox.clone().translate(moveVector);
  let canMove = true;
  for (const treeBox of state.treeBoxes) {
    if (newPlayerBox.intersectsBox(treeBox)) {
      canMove = false;
      break;
    }
  }
  if (canMove)
    for (const buildingBox of state.buildingBoxes) {
      if (supportingBuilding === buildingBox) continue;
      if (newPlayerBox.intersectsBox(buildingBox)) {
        canMove = false;
        break;
      }
    }
  if (canMove)
    for (const wallBox of state.wallBoxes) {
      if (newPlayerBox.intersectsBox(wallBox)) {
        canMove = false;
        break;
      }
    }
  if (canMove) {
    const playerBoxNew = makeBox(state.player.position, 0.5, 1, 0.5);
    for (const enemy of state.enemies) {
      const enemyBox = makeBox(
        enemy.mesh.position,
        enemy.halfWidth,
        enemy.halfHeight,
        enemy.halfDepth,
      );
      if (playerBoxNew.intersectsBox(enemyBox)) {
        triggerGameOver("An enemy caught you.");
        return;
      }
    }
  }
  if (canMove) state.player.position.add(moveVector);

  const groundY = supportingGround
    ? supportingGround
    : getGroundHeight(state.player.position.x, state.player.position.z) + 1;

  if (
    keys["Space"] &&
    !isJumping &&
    Math.abs(state.player.position.y - groundY) < 0.01
  ) {
    velocity.y = 0.5;
    isJumping = true;
  }
  velocity.y -= 0.02 * dt;
  state.player.position.y += velocity.y * dt;
  if (state.player.position.y < groundY) {
    state.player.position.y = groundY;
    velocity.y = 0;
    isJumping = false;
  }

  const boundary = state.groundSize / 2 - 1;
  state.player.position.x = Math.max(
    -boundary,
    Math.min(boundary, state.player.position.x),
  );
  state.player.position.z = Math.max(
    -boundary,
    Math.min(boundary, state.player.position.z),
  );
}

// ─── Input listeners & initial camera ─────────────────────────────────────────
export function initPlayer() {
  document.addEventListener("keydown", (event) => {
    if (event.code === "KeyV") state.thirdPerson = !state.thirdPerson;
  });
  document.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      const now = Date.now();
      if (now - lastSpacePressTime < doubleSpaceThreshold) jumpToBuilding();
      lastSpacePressTime = now;
      keys[event.code] = true;
    } else if (keys.hasOwnProperty(event.code)) {
      if (event.code.startsWith("Arrow")) event.preventDefault();
      keys[event.code] = true;
    }
  });
  document.addEventListener("keyup", (event) => {
    if (keys.hasOwnProperty(event.code)) keys[event.code] = false;
  });
  document.addEventListener("mousedown", (event) => {
    if (state.inCar) return;
    if (event.button === 0) {
      shootBullet();
    } else if (event.button === 2) {
      isSniperMode = true;
      state.camera.fov = sniperFOV;
      state.camera.updateProjectionMatrix();
    }
  });
  document.addEventListener("mouseup", (event) => {
    if (event.button === 2 && isSniperMode) {
      isSniperMode = false;
      state.camera.fov = defaultFOV;
      state.camera.updateProjectionMatrix();
      if (!state.inCar) shootSniperBullet();
    }
  });
  document.addEventListener("contextmenu", (event) => event.preventDefault());
  state.camera.position.set(
    state.player.position.x,
    state.player.position.y + 2,
    state.player.position.z,
  );
}
