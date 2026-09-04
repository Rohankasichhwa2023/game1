// player.js
// Movement, jumping, player shooting, and multi-car system.

import * as THREE from "three";
import { state, playerKnockback } from "./state.js";
import { makeBox, updateWalkCycle } from "./character.js";
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
const CAR_MAX_SPEED = 1.0;
const CAR_ACCEL = 0.038;
const CAR_BRAKE = 0.06;
const CAR_FRICTION = 0.014;
const CAR_REVERSE_MAX = 0.42;
const CAR_TURN_RATE = 0.052;
const MAX_STEER_ANGLE = Math.PI / 4.5;

// Handbrake / drift
const HANDBRAKE_DECEL = 0.05;
const DRIFT_TURN_BOOST = 1.55;
const GRIP_RATE = 0.9;
const DRIFT_GRIP_RATE = 0.07;
const DRIFT_MIN_SPEED = 0.15;

// Suspension
const SUSP_TRAVEL = 0.22;
const SUSP_STIFFNESS = 18;
const SUSP_DAMPING = 3.5;

// Collision footprint
const carHalfWidth = 1.1;
const carHalfHeight = 0.9;
const carHalfDepth = 2.3;

// ─── Per-car runtime state ────────────────────────────────────────────────────
function initCarPhysics(car) {
  car.userData.velocity = 0;
  car.userData.steerAngle = 0;
  car.userData.suspOffsets = [0, 0, 0, 0];
  car.userData.suspVels = [0, 0, 0, 0];
  car.userData.bodyRoll = 0;
  car.userData.bodyPitch = 0;
  car.userData.prevVelocity = 0;
  car.userData.moveHeading = 0;
  car.userData.isDrifting = false;
}

// ─── Free-look yaw — CLAMPED so you can't spin inside the car ────────────────
// Positive = look right, negative = look left. Limited to ±60° so the
// windscreen pillars are always visible and the road stays in frame.
let carLookYawOffset = 0;
const CAR_LOOK_MAX_YAW = Math.PI / 3; // 60° each side

const carForwardVec = new THREE.Vector3();

// ─── Five car style definitions ───────────────────────────────────────────────
export const CAR_STYLES = [
  {
    name: "Sedan",
    paint: 0xcc2222,
    dark: 0x991111,
    fender: 0xb81e1e,
    hub: 0xc8cfd8,
    style: "sedan",
  },
  {
    name: "Muscle",
    paint: 0x1a3a8a,
    dark: 0x102266,
    fender: 0x152f70,
    hub: 0xe0c840,
    style: "muscle",
  },
  {
    name: "SUV",
    paint: 0x3a5c2a,
    dark: 0x253d1a,
    fender: 0x2e4a20,
    hub: 0x888888,
    style: "suv",
  },
  {
    name: "Sports",
    paint: 0xe86010,
    dark: 0xb04808,
    fender: 0xc85508,
    hub: 0xd0d0d0,
    style: "sports",
  },
  {
    name: "Pickup",
    paint: 0x5a3080,
    dark: 0x3a1e58,
    fender: 0x4a2868,
    hub: 0xb0b0b0,
    style: "pickup",
  },
];

// ─── Wheel builder ────────────────────────────────────────────────────────────
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

// ─── Wheel rig builder ────────────────────────────────────────────────────────
function attachWheels(group, hubColor, frontZ, rearZ, trackW, tyreR) {
  const chromeMat = new THREE.MeshPhongMaterial({
    color: 0xd0d8e0,
    shininess: 200,
  });

  function addAxle(z) {
    const axleGeo = new THREE.CylinderGeometry(0.06, 0.06, trackW * 2 + 0.1, 8);
    axleGeo.rotateZ(Math.PI / 2);
    const axle = new THREE.Mesh(axleGeo, chromeMat);
    axle.position.set(0, tyreR, z);
    group.add(axle);
  }
  addAxle(frontZ);
  addAxle(rearZ);

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

// ─── COCKPIT CAMERA POSITIONS ──────────────────────────────────────────────────
// These are LOCAL positions inside the car group (car forward = +Z).
// eyeX : 0   = perfectly centred — no offset into the car body
// eyeY       = driver's eye height above car origin
// eyeZ       = forward position; POSITIVE = toward the FRONT of the car.
//              Push forward enough so the camera sits behind the windscreen
//              glass, not inside any solid panel.
// lookAheadY : how far below eye-level the look-at target sits
//              (a small negative makes you see the top of the dashboard)
//
//  Car body extents for reference (from createCarByStyle):
//    Sedan  : cabin panel at z=-0.18, windscreen glass front at z=+0.72
//    Muscle : cabin at z=-0.5,  windscreen at z=+0.52
//    SUV    : cabin at z=-0.1,  windscreen at z=+0.98
//    Sports : cabin at z=-0.1,  windscreen at z=+0.60
//    Pickup : cabin at z=+0.7,  windscreen at z=+1.58
//
// Rule: eyeZ must be LESS than the windscreen front Z so the camera is
// behind the glass, not poking through it.
// eyeY raised above the cabin roof panels (roof panels sit at ~1.64 for sedan,
// ~1.58 for muscle, ~1.9 for suv, ~1.4 for sports, ~1.68 for pickup) so the
// camera never clips into the roof geometry and gets the brown tint.
// lookAheadY: small negative = horizon sits in the upper-third of the screen
// (natural driving perspective). Zero = dead level.
const COCKPIT_EYE = {
  sedan: { x: 0, y: 1.5, z: 0.3, lookAheadY: -0.15 },
  muscle: { x: 0, y: 1.48, z: 0.1, lookAheadY: -0.15 },
  suv: { x: 0, y: 1.72, z: 0.5, lookAheadY: -0.18 },
  sports: { x: 0, y: 1.32, z: 0.2, lookAheadY: -0.12 },
  pickup: { x: 0, y: 1.68, z: 1.1, lookAheadY: -0.18 },
};

// ─── Cockpit overlay: dashboard panel + steering wheel ───────────────────────
// Sits entirely in local car space, positioned just below the camera eye so
// it's visible at the bottom quarter of the screen in first-person view.
// The steering wheel "spin" group is stored so updateCar() can rotate it
// to match the actual steer angle — same technique as the original interior.
function buildCockpitOverlay(group, styleKey) {
  const eye = COCKPIT_EYE[styleKey] || COCKPIT_EYE.sedan;

  const dashMat = new THREE.MeshPhongMaterial({
    color: 0x141618,
    shininess: 18,
  });
  const rimMat = new THREE.MeshPhongMaterial({
    color: 0x0d0e10,
    shininess: 55,
  });
  const spokeMat = new THREE.MeshPhongMaterial({
    color: 0x1a1c20,
    shininess: 30,
  });
  const hubMat = new THREE.MeshPhongMaterial({
    color: 0x111214,
    shininess: 60,
  });
  const chromeMat = new THREE.MeshPhongMaterial({
    color: 0xb8c2cc,
    shininess: 180,
  });

  const overlay = new THREE.Group();
  overlay.visible = false;

  // ── Dashboard panel — wide, shallow box sitting at eye-Y - 0.30 ──────────
  // Tilted slightly toward the driver so it fills the bottom of the screen.
  const dashGeo = new THREE.BoxGeometry(1.8, 0.16, 0.55);
  const dash = new THREE.Mesh(dashGeo, dashMat);
  dash.position.set(0, eye.y - 0.3, eye.z + 0.46);
  dash.rotation.x = 0.22; // lean top of dash away from camera
  dash.castShadow = false;
  overlay.add(dash);

  // Thin chrome trim strip along the top edge of the dash
  const trimGeo = new THREE.BoxGeometry(1.82, 0.025, 0.04);
  const trim = new THREE.Mesh(trimGeo, chromeMat);
  trim.position.set(0, eye.y - 0.225, eye.z + 0.24);
  trim.castShadow = false;
  overlay.add(trim);

  // ── Steering wheel ────────────────────────────────────────────────────────
  // Pivot group: handles column angle and sits slightly right-of-centre
  // (left-hand drive) just like a real car.
  const WHEEL_R = 0.175; // rim radius
  const TUBE_R = 0.018; // rim tube radius
  const SPOKE_R = 0.012;

  const pivot = new THREE.Group();
  // Position: below eye, slightly forward, offset a little to the right
  pivot.position.set(0.14, eye.y - 0.28, eye.z + 0.36);
  pivot.rotation.x = 0.38; // column rake — top leans toward dash

  overlay.add(pivot);

  // spin group — this is what rotates when the player steers
  const spin = new THREE.Group();
  pivot.add(spin);

  // Rim torus
  const rimGeo = new THREE.TorusGeometry(WHEEL_R, TUBE_R, 10, 36);
  const rim = new THREE.Mesh(rimGeo, rimMat);
  spin.add(rim);

  // Hub centre
  const hubGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.04, 12);
  hubGeo.rotateX(Math.PI / 2);
  const hub = new THREE.Mesh(hubGeo, hubMat);
  spin.add(hub);

  // Three spokes (at 0°, 120°, 240°)
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const spokeGeo = new THREE.CylinderGeometry(
      SPOKE_R,
      SPOKE_R,
      WHEEL_R * 0.85,
      8,
    );
    const spoke = new THREE.Mesh(spokeGeo, spokeMat);
    // Rotate so the spoke points radially outward from centre
    spoke.rotation.z = angle + Math.PI / 2;
    spoke.position.set(
      Math.cos(angle) * (WHEEL_R * 0.425),
      Math.sin(angle) * (WHEEL_R * 0.425),
      0,
    );
    spin.add(spoke);
  }

  // Steering column tube (visible below the wheel)
  const colGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.18, 10);
  colGeo.rotateX(Math.PI / 2);
  const col = new THREE.Mesh(colGeo, dashMat);
  col.position.set(0, -0.014, 0.1);
  pivot.add(col);

  // Store references
  group.userData.cockpitOverlay = overlay;
  group.userData.cockpitWheelSpin = spin; // rotated each frame in updateCar
  overlay.visible = false;
  group.add(overlay);

  // Legacy alias so enterCar/exitCar visibility toggles still work
  group.userData.dashStrip = overlay;
}

// ─── createCarByStyle ────────────────────────────────────────────────────────
export function createCarByStyle(x, z, styleIdx) {
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
  // Glass is fully invisible from the driver's POV — the tinted box was
  // darkening the cockpit view. Side windows still provide collision geometry
  // but render at zero opacity so the view stays clear in all directions.
  const glassM = new THREE.MeshPhongMaterial({
    color: 0x7ab8d4,
    shininess: 120,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
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
    add(new THREE.BoxGeometry(2.3, 0.26, 4.8), underMat, 0, 0.26, 0);
    add(new THREE.BoxGeometry(0.14, 0.24, 4.5), darkMat, -1.15, 0.48, 0);
    add(new THREE.BoxGeometry(0.14, 0.24, 4.5), darkMat, 1.15, 0.48, 0);
    add(new THREE.BoxGeometry(2.18, 0.36, 4.7), paintMat, 0, 0.58, 0);
    add(new THREE.BoxGeometry(2.0, 0.14, 1.8), paintMat, 0, 0.82, 1.6);
    add(new THREE.BoxGeometry(0.6, 0.12, 0.7), darkMat, 0, 0.96, 1.4);
    add(new THREE.BoxGeometry(1.9, 0.12, 0.6), paintMat, 0, 0.82, -1.9);
    add(new THREE.BoxGeometry(1.8, 0.1, 1.5), paintMat, 0, 1.58, -0.5);
    add(new THREE.BoxGeometry(1.82, 0.58, 1.52), paintMat, 0, 1.18, -0.5);
    add(new THREE.BoxGeometry(1.58, 0.54, 0.1), glassM, 0, 1.26, 0.52);
    add(new THREE.BoxGeometry(1.58, 0.4, 0.1), glassM, 0, 1.26, -1.26);
    add(new THREE.BoxGeometry(0.06, 0.38, 1.1), glassM, -0.9, 1.26, -0.5);
    add(new THREE.BoxGeometry(0.06, 0.38, 1.1), glassM, 0.9, 1.26, -0.5);
    add(new THREE.BoxGeometry(0.52, 0.16, 0.1), lightMat, -0.64, 0.66, 2.38);
    add(new THREE.BoxGeometry(0.52, 0.16, 0.1), lightMat, 0.64, 0.66, 2.38);
    add(new THREE.BoxGeometry(0.6, 0.14, 0.1), tailMat, -0.66, 0.68, -2.38);
    add(new THREE.BoxGeometry(0.6, 0.14, 0.1), tailMat, 0.66, 0.68, -2.38);
    add(new THREE.BoxGeometry(1.9, 0.18, 0.12), chromeMat, 0, 0.34, 2.42);
    add(new THREE.BoxGeometry(1.9, 0.12, 0.1), chromeMat, 0, 0.38, -2.4);
    add(new THREE.BoxGeometry(0.1, 0.1, 1.2), darkMat, -1.14, 0.3, -0.8);
    add(new THREE.BoxGeometry(0.1, 0.1, 1.2), darkMat, 1.14, 0.3, -0.8);
    add(new THREE.BoxGeometry(0.18, 0.22, 1.1), fenderMat, -1.14, 0.76, 1.42);
    add(new THREE.BoxGeometry(0.18, 0.22, 1.1), fenderMat, 1.14, 0.76, 1.42);
    add(new THREE.BoxGeometry(0.18, 0.22, 1.1), fenderMat, -1.14, 0.76, -1.42);
    add(new THREE.BoxGeometry(0.18, 0.22, 1.1), fenderMat, 1.14, 0.76, -1.42);
    attachWheels(group, def.hub, 1.42, -1.42, 1.1, 0.42);
  } else if (s === "suv") {
    add(new THREE.BoxGeometry(2.2, 0.32, 4.7), underMat, 0, 0.32, 0);
    add(new THREE.BoxGeometry(0.12, 0.28, 4.4), darkMat, -1.1, 0.58, 0);
    add(new THREE.BoxGeometry(0.12, 0.28, 4.4), darkMat, 1.1, 0.58, 0);
    add(new THREE.BoxGeometry(2.08, 0.46, 4.6), paintMat, 0, 0.7, 0);
    add(new THREE.BoxGeometry(1.96, 0.14, 1.2), paintMat, 0, 0.96, 1.62);
    add(new THREE.BoxGeometry(1.7, 0.1, 2.1), paintMat, 0, 1.9, -0.1);
    add(new THREE.BoxGeometry(0.05, 0.06, 2.0), darkMat, -0.82, 1.96, -0.1);
    add(new THREE.BoxGeometry(0.05, 0.06, 2.0), darkMat, 0.82, 1.96, -0.1);
    add(new THREE.BoxGeometry(1.84, 0.8, 2.2), paintMat, 0, 1.4, -0.1);
    add(new THREE.BoxGeometry(1.6, 0.7, 0.1), glassM, 0, 1.42, 0.98);
    add(new THREE.BoxGeometry(1.6, 0.7, 0.1), glassM, 0, 1.42, -1.18);
    add(new THREE.BoxGeometry(0.06, 0.58, 1.8), glassM, -0.91, 1.42, -0.1);
    add(new THREE.BoxGeometry(0.06, 0.58, 1.8), glassM, 0.91, 1.42, -0.1);
    add(new THREE.BoxGeometry(1.5, 0.08, 0.22), lightMat, 0, 1.98, 0.82);
    add(new THREE.BoxGeometry(2.08, 0.28, 0.18), darkMat, 0, 0.44, 2.42);
    add(new THREE.BoxGeometry(2.08, 0.24, 0.18), darkMat, 0, 0.44, -2.42);
    add(new THREE.BoxGeometry(0.52, 0.18, 0.1), lightMat, -0.6, 0.7, 2.42);
    add(new THREE.BoxGeometry(0.52, 0.18, 0.1), lightMat, 0.6, 0.7, 2.42);
    add(new THREE.BoxGeometry(0.56, 0.16, 0.1), tailMat, -0.62, 0.72, -2.42);
    add(new THREE.BoxGeometry(0.56, 0.16, 0.1), tailMat, 0.62, 0.72, -2.42);
    add(new THREE.BoxGeometry(0.14, 0.1, 3.2), darkMat, -1.1, 0.22, 0);
    add(new THREE.BoxGeometry(0.14, 0.1, 3.2), darkMat, 1.1, 0.22, 0);
    add(new THREE.BoxGeometry(0.16, 0.24, 1.1), fenderMat, -1.1, 0.84, 1.44);
    add(new THREE.BoxGeometry(0.16, 0.24, 1.1), fenderMat, 1.1, 0.84, 1.44);
    add(new THREE.BoxGeometry(0.16, 0.24, 1.1), fenderMat, -1.1, 0.84, -1.44);
    add(new THREE.BoxGeometry(0.16, 0.24, 1.1), fenderMat, 1.1, 0.84, -1.44);
    attachWheels(group, def.hub, 1.44, -1.44, 1.05, 0.46);
  } else if (s === "sports") {
    add(new THREE.BoxGeometry(2.14, 0.22, 4.9), underMat, 0, 0.22, 0);
    add(new THREE.BoxGeometry(0.1, 0.18, 4.6), darkMat, -1.07, 0.38, 0);
    add(new THREE.BoxGeometry(0.1, 0.18, 4.6), darkMat, 1.07, 0.38, 0);
    add(new THREE.BoxGeometry(2.04, 0.32, 4.8), paintMat, 0, 0.48, 0);
    add(new THREE.BoxGeometry(1.92, 0.1, 2.0), paintMat, 0, 0.72, 1.7);
    add(new THREE.BoxGeometry(2.1, 0.06, 0.3), darkMat, 0, 0.16, 2.5);
    add(new THREE.BoxGeometry(2.0, 0.08, 0.28), darkMat, 0, 0.2, -2.52);
    add(new THREE.BoxGeometry(1.8, 0.08, 0.22), darkMat, 0, 0.98, -2.3);
    add(new THREE.BoxGeometry(0.08, 0.28, 0.08), darkMat, -0.8, 0.86, -2.3);
    add(new THREE.BoxGeometry(0.08, 0.28, 0.08), darkMat, 0.8, 0.86, -2.3);
    add(new THREE.BoxGeometry(1.74, 0.08, 1.4), paintMat, 0, 1.4, -0.1);
    add(new THREE.BoxGeometry(1.76, 0.46, 1.42), paintMat, 0, 1.1, -0.1);
    add(new THREE.BoxGeometry(1.54, 0.44, 0.1), glassM, 0, 1.16, 0.6);
    add(new THREE.BoxGeometry(1.54, 0.38, 0.1), glassM, 0, 1.16, -0.8);
    add(new THREE.BoxGeometry(0.06, 0.34, 1.0), glassM, -0.86, 1.14, -0.1);
    add(new THREE.BoxGeometry(0.06, 0.34, 1.0), glassM, 0.86, 1.14, -0.1);
    add(new THREE.BoxGeometry(0.64, 0.1, 0.08), lightMat, -0.56, 0.6, 2.46);
    add(new THREE.BoxGeometry(0.64, 0.1, 0.08), lightMat, 0.56, 0.6, 2.46);
    add(new THREE.BoxGeometry(0.68, 0.1, 0.08), tailMat, -0.56, 0.62, -2.46);
    add(new THREE.BoxGeometry(0.68, 0.1, 0.08), tailMat, 0.56, 0.62, -2.46);
    add(new THREE.BoxGeometry(1.9, 0.1, 0.1), chromeMat, 0, 0.3, 2.5);
    add(new THREE.BoxGeometry(0.08, 0.12, 0.4), darkMat, -1.06, 0.56, 0.6);
    add(new THREE.BoxGeometry(0.08, 0.12, 0.4), darkMat, 1.06, 0.56, 0.6);
    add(new THREE.BoxGeometry(0.18, 0.18, 1.0), fenderMat, -1.06, 0.68, 1.44);
    add(new THREE.BoxGeometry(0.18, 0.18, 1.0), fenderMat, 1.06, 0.68, 1.44);
    add(new THREE.BoxGeometry(0.18, 0.18, 1.0), fenderMat, -1.06, 0.68, -1.44);
    add(new THREE.BoxGeometry(0.18, 0.18, 1.0), fenderMat, 1.06, 0.68, -1.44);
    attachWheels(group, def.hub, 1.44, -1.44, 1.0, 0.4);
  } else {
    // Pickup
    add(new THREE.BoxGeometry(2.2, 0.3, 5.0), underMat, 0, 0.3, 0);
    add(new THREE.BoxGeometry(0.12, 0.26, 4.7), darkMat, -1.1, 0.54, 0);
    add(new THREE.BoxGeometry(0.12, 0.26, 4.7), darkMat, 1.1, 0.54, 0);
    add(new THREE.BoxGeometry(2.08, 0.4, 4.9), paintMat, 0, 0.62, 0);
    add(new THREE.BoxGeometry(2.0, 0.12, 1.6), paintMat, 0, 0.88, 1.5);
    add(new THREE.BoxGeometry(1.88, 0.12, 1.8), paintMat, 0, 1.68, 0.7);
    add(new THREE.BoxGeometry(1.9, 0.64, 1.82), paintMat, 0, 1.36, 0.7);
    add(new THREE.BoxGeometry(1.68, 0.58, 0.1), glassM, 0, 1.38, 1.58);
    add(new THREE.BoxGeometry(1.68, 0.5, 0.1), glassM, 0, 1.38, -0.18);
    add(new THREE.BoxGeometry(0.06, 0.44, 1.5), glassM, -0.93, 1.38, 0.7);
    add(new THREE.BoxGeometry(0.06, 0.44, 1.5), glassM, 0.93, 1.38, 0.7);
    add(new THREE.BoxGeometry(2.0, 0.1, 2.0), paintMat, 0, 0.8, -1.5);
    add(new THREE.BoxGeometry(2.0, 0.42, 0.1), paintMat, 0, 1.0, -2.48);
    add(new THREE.BoxGeometry(0.1, 0.42, 1.9), paintMat, -0.99, 1.0, -1.5);
    add(new THREE.BoxGeometry(0.1, 0.42, 1.9), paintMat, 0.99, 1.0, -1.5);
    add(new THREE.BoxGeometry(0.5, 0.18, 0.1), lightMat, -0.6, 0.7, 2.48);
    add(new THREE.BoxGeometry(0.5, 0.18, 0.1), lightMat, 0.6, 0.7, 2.48);
    add(new THREE.BoxGeometry(0.54, 0.18, 0.1), tailMat, -0.6, 0.72, -2.5);
    add(new THREE.BoxGeometry(0.54, 0.18, 0.1), tailMat, 0.6, 0.72, -2.5);
    add(new THREE.BoxGeometry(2.08, 0.22, 0.16), darkMat, 0, 0.4, 2.52);
    add(new THREE.BoxGeometry(2.08, 0.2, 0.14), darkMat, 0, 0.38, -2.52);
    add(new THREE.BoxGeometry(1.6, 0.14, 0.08), chromeMat, 0, 0.6, 2.5);
    add(new THREE.BoxGeometry(0.12, 0.08, 2.8), darkMat, -1.1, 0.24, 0.4);
    add(new THREE.BoxGeometry(0.12, 0.08, 2.8), darkMat, 1.1, 0.24, 0.4);
    add(new THREE.BoxGeometry(0.16, 0.24, 1.1), fenderMat, -1.1, 0.8, 1.44);
    add(new THREE.BoxGeometry(0.16, 0.24, 1.1), fenderMat, 1.1, 0.8, 1.44);
    add(new THREE.BoxGeometry(0.16, 0.24, 1.1), fenderMat, -1.1, 0.8, -1.44);
    add(new THREE.BoxGeometry(0.16, 0.24, 1.1), fenderMat, 1.1, 0.8, -1.44);
    attachWheels(group, def.hub, 1.44, -1.44, 1.04, 0.44);
  }

  // Build cockpit overlay: dashboard panel + steering wheel
  buildCockpitOverlay(group, def.style);

  // ── Headlights (night mode) ────────────────────────────────────────────────
  // Two spotlights mounted at the nose, aimed down the road. Intensity 0
  // during the day; setNightMode() switches them on for every car at once.
  const headLights = [];
  const headZ = s === "pickup" ? 2.5 : s === "sports" ? 2.44 : 2.3;
  for (const side of [-1, 1]) {
    const spot = new THREE.SpotLight(0xfff0c4, 0, 95, Math.PI / 6.5, 0.45, 1.1);
    spot.position.set(side * 0.6, 0.72, headZ);
    spot.target.position.set(side * 0.6, 0, headZ + 22);
    spot.castShadow = false;
    group.add(spot);
    group.add(spot.target);
    headLights.push(spot);
  }
  group.userData.headLights = headLights;

  // Cars spawned while already in night mode start lit (e.g. stolen NPC cars).
  for (const l of headLights) l.intensity = state.nightMode ? 2.6 : 0;

  // Store cockpit eye data directly on userData for updateCamera()
  group.userData.cockpitEye = COCKPIT_EYE[def.style] || COCKPIT_EYE.sedan;
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
export function carHitsBox(car, box) {
  return carIntersectsAabb(car.position, car.rotation.y, box);
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
function carOverlapWithCar(posA, yawA, posB, yawB, shrink = 0) {
  const cosA = Math.cos(yawA),
    sinA = Math.sin(yawA);
  const cosB = Math.cos(yawB),
    sinB = Math.sin(yawB);
  const axisAx = { x: cosA, z: sinA };
  const axisAz = { x: -sinA, z: cosA };
  const axisBx = { x: cosB, z: sinB };
  const axisBz = { x: -sinB, z: cosB };
  const axes = [axisAx, axisAz, axisBx, axisBz];
  const hw = carHalfWidth - shrink,
    hd = carHalfDepth - shrink;
  const dx = posA.x - posB.x,
    dz = posA.z - posB.z;
  let minDepth = Infinity,
    n = { x: 0, z: 0 };
  for (const axis of axes) {
    const radiusA =
      hw * Math.abs(axis.x * axisAx.x + axis.z * axisAx.z) +
      hd * Math.abs(axis.x * axisAz.x + axis.z * axisAz.z);
    const radiusB =
      hw * Math.abs(axis.x * axisBx.x + axis.z * axisBx.z) +
      hd * Math.abs(axis.x * axisBz.x + axis.z * axisBz.z);
    const distance = axis.x * dx + axis.z * dz;
    const overlap = radiusA + radiusB - Math.abs(distance);
    if (overlap < 0) return null;
    if (overlap < minDepth) {
      minDepth = overlap;
      const sign = distance >= 0 ? 1 : -1;
      n = { x: axis.x * sign, z: axis.z * sign };
    }
  }
  return { depth: minDepth, nx: n.x, nz: n.z };
}
export function findCarOverlap(position, yaw, selfCar, shrink = 0) {
  for (const other of state.cars) {
    if (other === selfCar) continue;
    const o = carOverlapWithCar(
      position,
      yaw,
      other.position,
      other.rotation.y,
      shrink,
    );
    if (o) return o;
  }
  return null;
}
export function resolveCarVsCarOverlap(car) {
  for (let iter = 0; iter < 4; iter++) {
    const o = findCarOverlap(car.position, car.rotation.y, car, 0);
    if (!o) break;
    car.position.x += o.nx * (o.depth + 0.02);
    car.position.z += o.nz * (o.depth + 0.02);
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
  carLookYawOffset = 0; // always reset look to dead-ahead on entry
  car.userData.velocity = 0;
  car.userData.moveHeading = car.rotation.y;

  // Show the dash strip for this car
  if (car.userData.dashStrip) car.userData.dashStrip.visible = false; // hidden by default; shown in updateCamera
}
function exitCar() {
  const car = state.car;
  state.inCar = false;
  state.player.visible = true;
  car.userData.velocity = 0;

  // Hide dash strip
  if (car.userData.dashStrip) car.userData.dashStrip.visible = false;

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
    let tooClose = false;
    for (const ap of avoidPositions) {
      if (Math.hypot(x - ap.x, z - ap.z) < 12) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) return { x, z };
  }
  return { x: p.x + 15 + Math.random() * 5, z: p.z + 15 + Math.random() * 5 };
}

// ─── initCar ─────────────────────────────────────────────────────────────────
export function initCar() {
  const spawnedPositions = [];
  for (let i = 0; i < 5; i++) {
    const spot = findSpawnSpot(spawnedPositions);
    spawnedPositions.push(spot);
    const car = createCarByStyle(spot.x, spot.z, i);
    car.position.y = getGroundHeight(spot.x, spot.z);
    car.rotation.y = Math.random() * Math.PI * 2;
    state.scene.add(car);
    state.cars.push(car);
    if (i === 0) state.car = car;
  }

  document.addEventListener("keydown", (event) => {
    if (event.code !== "KeyE" && event.code !== "Enter") return;
    if (state.inCar) {
      exitCar();
      return;
    }
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
    if (!state.inCar || state.thirdPerson) return;
    // Accumulate and CLAMP — no spinning inside the car body
    carLookYawOffset = Math.max(
      -CAR_LOOK_MAX_YAW,
      Math.min(CAR_LOOK_MAX_YAW, carLookYawOffset + event.movementX * 0.002),
    );
  });
}

// ─── updateCar ────────────────────────────────────────────────────────────────
export function updateCar(dt) {
  const car = state.car;
  if (!car) return;

  const ud = car.userData;
  let carVelocity = ud.velocity;
  const absVel = Math.abs(carVelocity);

  // Steering
  const speedRatio = Math.min(absVel / CAR_MAX_SPEED, 1);
  const turnScale = 1 - speedRatio * 0.4;
  let turnInput = 0;
  if (keys["KeyA"] || keys["ArrowLeft"]) turnInput = 1;
  if (keys["KeyD"] || keys["ArrowRight"]) turnInput = -1;

  const handbrake = keys["Space"];
  const isDrifting = handbrake && absVel > DRIFT_MIN_SPEED && turnInput !== 0;
  ud.isDrifting = isDrifting;

  const turnRateMult = isDrifting ? DRIFT_TURN_BOOST : 1;
  if (absVel > 0.01) {
    const dir = carVelocity >= 0 ? 1 : -1;
    car.rotation.y +=
      turnInput * CAR_TURN_RATE * turnScale * turnRateMult * dt * dir;
  }

  const targetSteer = turnInput * MAX_STEER_ANGLE * turnScale;
  ud.steerAngle += (targetSteer - ud.steerAngle) * 0.22 * dt;

  // Acceleration / braking
  if (handbrake) {
    const scrub = HANDBRAKE_DECEL * dt;
    if (keys["KeyW"] || keys["ArrowUp"]) {
      carVelocity = Math.min(
        carVelocity + CAR_ACCEL * 0.4 * dt,
        CAR_MAX_SPEED * 0.85,
      );
      carVelocity -= scrub * 0.35;
    } else if (carVelocity > 0) {
      carVelocity = Math.max(0, carVelocity - scrub);
    } else {
      carVelocity = Math.min(0, carVelocity + scrub);
    }
  } else if (keys["KeyW"] || keys["ArrowUp"]) {
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

  // Drift slip
  const gripRate = isDrifting ? DRIFT_GRIP_RATE : GRIP_RATE;
  let headingDiff = car.rotation.y - ud.moveHeading;
  headingDiff = Math.atan2(Math.sin(headingDiff), Math.cos(headingDiff));
  ud.moveHeading += headingDiff * Math.min(1, gripRate * dt);

  // Movement & slope
  if (Math.abs(carVelocity) > 0.001) {
    carForwardVec.set(Math.sin(ud.moveHeading), 0, Math.cos(ud.moveHeading));
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
    const nextPos = car.position.clone().add(move);
    if (
      !carCollides(nextPos, car.rotation.y, 0.12) &&
      !findCarOverlap(nextPos, car.rotation.y, car, 0.08)
    ) {
      car.position.add(move);
    } else {
      carVelocity *= 0.3;
    }
  }

  resolveCarOverlaps(car);
  resolveCarVsCarOverlap(car);

  const boundary = state.groundSize / 2 - 2;
  car.position.x = Math.max(-boundary, Math.min(boundary, car.position.x));
  car.position.z = Math.max(-boundary, Math.min(boundary, car.position.z));

  // Terrain following
  const fy = car.rotation.y;
  const fxA = Math.sin(fy),
    fzA = Math.cos(fy);
  const rxA = Math.cos(fy),
    rzA = -Math.sin(fy);
  const L = 1.42,
    W = 0.95,
    CLEAR = 0.15;

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

  const frontH = (hFL + hFR) / 2;
  const rearH = (hRL + hRR) / 2;
  const leftH = (hFL + hRL) / 2;
  const rightH = (hFR + hRR) / 2;

  car.position.y = Math.max(hFL, hFR, hRL, hRR) + CLEAR;

  // Suspension
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

  // Body roll & pitch
  const targetRoll = -turnInput * speedRatio * (isDrifting ? 0.1 : 0.055);
  const accelDelta = carVelocity - ud.prevVelocity;
  const targetPitch = -accelDelta * 12;
  ud.prevVelocity = carVelocity;
  ud.bodyRoll += (targetRoll - ud.bodyRoll) * 0.1 * dt;
  ud.bodyPitch += (targetPitch - ud.bodyPitch) * 0.08 * dt;
  ud.bodyPitch = Math.max(-0.08, Math.min(0.08, ud.bodyPitch));

  const terrainRoll = Math.atan2(rightH - leftH, 2 * W);
  const terrainPitch = -Math.atan2(frontH - rearH, 2 * L);

  car.rotation.z = terrainRoll + ud.bodyRoll;
  car.rotation.x = terrainPitch + ud.bodyPitch;

  // Steer visual — front wheel pivots
  ud.steerPivotL.rotation.y = ud.steerAngle;
  ud.steerPivotR.rotation.y = ud.steerAngle;

  // Cockpit steering wheel — spins with steer angle (×3.5 for drama,
  // matching the lock-to-lock feel of a real steering column)
  if (ud.cockpitWheelSpin) {
    ud.cockpitWheelSpin.rotation.z = -ud.steerAngle * 3.5;
  }

  // Wheel spin
  const spinDelta = (carVelocity * dt) / 0.42;
  const rearSpinDelta = isDrifting
    ? spinDelta + Math.sign(carVelocity || 1) * 0.3 * dt
    : spinDelta;
  ud.wheelGroupFL.rotation.x += spinDelta;
  ud.wheelGroupFR.rotation.x += spinDelta;
  ud.wheelGroupRL.rotation.x += rearSpinDelta;
  ud.wheelGroupRR.rotation.x += rearSpinDelta;

  ud.velocity = carVelocity;

  runOverEnemies(car);

  state.player.position.set(car.position.x, car.position.y + 1, car.position.z);
}

// ─── updateCamera ─────────────────────────────────────────────────────────────
// Re-usable vectors — allocated once, reused every frame.
const _eyeLocal = new THREE.Vector3();
const _eyeWorld = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();

export function updateCamera() {
  if (state.inCar && state.car) {
    const car = state.car;

    // ── First-person cockpit (V not pressed) ──────────────────────────────
    if (!state.thirdPerson) {
      const eye = car.userData.cockpitEye; // { x, y, z, lookAheadY }

      // 1. Set local-space eye position (centred, in front of windscreen)
      _eyeLocal.set(eye.x, eye.y, eye.z);

      // 2. Convert to world space — automatically inherits the car's terrain
      //    pitch and body-roll rotations so the view tilts naturally on hills.
      car.localToWorld(_eyeLocal);
      state.camera.position.copy(_eyeLocal);

      // 3. Build look-at target: ahead along the car's heading, with a slight
      //    downward pitch so a sliver of dashboard is visible at the bottom.
      //    carLookYawOffset lets the driver glance left/right (clamped ±60°).
      const yaw = car.rotation.y + carLookYawOffset;
      _lookTarget.set(
        _eyeLocal.x + Math.sin(yaw) * 20,
        _eyeLocal.y + eye.lookAheadY,
        _eyeLocal.z + Math.cos(yaw) * 20,
      );
      state.camera.lookAt(_lookTarget);

      // Show dash strip only in first-person cockpit
      if (car.userData.dashStrip) car.userData.dashStrip.visible = true;
      return;
    }

    // Hide dash strip in third-person
    if (car.userData.dashStrip) car.userData.dashStrip.visible = false;

    // ── Third-person chase cam (V pressed while driving) ──────────────────
    const yaw = car.rotation.y + carLookYawOffset;
    carForwardVec.set(Math.sin(yaw), 0, Math.cos(yaw));

    const idealX = state.car.position.x - carForwardVec.x * 8;
    const idealZ = state.car.position.z - carForwardVec.z * 8;
    const idealY = state.car.position.y + 3;

    const CAMERA_GROUND_CLEARANCE = 1.0;
    const groundAtCam =
      getGroundHeight(idealX, idealZ) + CAMERA_GROUND_CLEARANCE;
    const camY = Math.max(idealY, groundAtCam);

    state.camera.position.set(idealX, camY, idealZ);

    const cameraLookClearance = 0.8;
    const lookGroundY =
      getGroundHeight(state.car.position.x, state.car.position.z) +
      cameraLookClearance;
    const lookY = Math.max(state.car.position.y + 1, lookGroundY);
    state.camera.lookAt(state.car.position.x, lookY, state.car.position.z);
    return;
  }

  // ── On-foot cameras ───────────────────────────────────────────────────────
  // Make sure all car dash strips are hidden
  for (const car of state.cars) {
    if (car.userData.dashStrip) car.userData.dashStrip.visible = false;
  }

  if (state.thirdPerson) {
    state.camera.getWorldDirection(cameraForward);
    cameraForward.y = 0;
    if (cameraForward.lengthSq() < 1e-6) cameraForward.set(0, 0, -1);
    cameraForward.normalize();

    const idealThirdX =
      state.player.position.x - cameraForward.x * thirdPersonDistance;
    const idealThirdZ =
      state.player.position.z - cameraForward.z * thirdPersonDistance;
    const idealThirdY = state.player.position.y + thirdPersonHeight;

    const thirdPersonGroundClearance = 1.0;
    const thirdPersonGroundY =
      getGroundHeight(idealThirdX, idealThirdZ) + thirdPersonGroundClearance;
    const safeThirdY = Math.max(idealThirdY, thirdPersonGroundY);

    state.camera.position.set(idealThirdX, safeThirdY, idealThirdZ);
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
  state.lastShotAt = Date.now();
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
  state.lastShotAt = Date.now();
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
  if (playerKnockback.active) {
    updateWalkCycle(state.player, dt, false);
    return;
  }

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

  updateWalkCycle(state.player, dt, canMove && horiz > 1e-6);
}

// ─── Input listeners & initial camera ─────────────────────────────────────────
export function initPlayer() {
  document.addEventListener("keydown", (event) => {
    if (event.code === "KeyV") {
      state.thirdPerson = !state.thirdPerson;
      // Reset look offset when toggling so you don't snap sideways
      if (!state.thirdPerson) carLookYawOffset = 0;
    }
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
