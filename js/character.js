// character.js
// Low-poly humanoid figures built from primitives, plus a small collision helper.

import * as THREE from "three";

// Builds a simple human figure (head, torso, arms, hands, legs) facing +Z.
// The group origin is the body center: feet sit at y = -1 * scale and the
// top of the head at roughly y = +1.1 * scale.
export function createHumanFigure({
  shirtColor = 0xe53935,
  pantsColor = 0x2f3b4c,
  skinColor = 0xf1c27d,
  scale = 1,
} = {}) {
  const group = new THREE.Group();

  const shirt = new THREE.MeshPhongMaterial({ color: shirtColor });
  const pants = new THREE.MeshPhongMaterial({ color: pantsColor });
  const skin = new THREE.MeshPhongMaterial({ color: skinColor });

  const add = (geometry, material, x, y, z, parent) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    (parent || group).add(mesh);
    return mesh;
  };

  // Legs — each is a group pivoted at the hip (feet at y = -1 when idle) so
  // the walk-cycle animation can swing them like a real hinge joint.
  const LEG_LEN = 0.9;
  const HIP_Y = -0.1;
  const hipL = new THREE.Group();
  hipL.position.set(-0.15, HIP_Y, 0);
  group.add(hipL);
  add(
    new THREE.BoxGeometry(0.26, LEG_LEN, 0.26),
    pants,
    0,
    -LEG_LEN / 2,
    0,
    hipL,
  );

  const hipR = new THREE.Group();
  hipR.position.set(0.15, HIP_Y, 0);
  group.add(hipR);
  add(
    new THREE.BoxGeometry(0.26, LEG_LEN, 0.26),
    pants,
    0,
    -LEG_LEN / 2,
    0,
    hipR,
  );

  // Torso (hips ~ -0.1, shoulders ~ +0.65).
  add(new THREE.BoxGeometry(0.7, 0.75, 0.4), shirt, 0, 0.275, 0);

  // Arms — each pivoted at the shoulder so they can swing opposite the
  // same-side leg during the walk cycle. Hands ride along with the arm.
  const ARM_LEN = 0.7;
  const SHOULDER_Y = 0.55;
  const shoulderL = new THREE.Group();
  shoulderL.position.set(-0.46, SHOULDER_Y, 0);
  group.add(shoulderL);
  add(
    new THREE.BoxGeometry(0.16, ARM_LEN, 0.16),
    shirt,
    0,
    -ARM_LEN / 2,
    0,
    shoulderL,
  );
  add(
    new THREE.BoxGeometry(0.14, 0.12, 0.14),
    skin,
    0,
    -ARM_LEN - 0.07,
    0,
    shoulderL,
  );

  const shoulderR = new THREE.Group();
  shoulderR.position.set(0.46, SHOULDER_Y, 0);
  group.add(shoulderR);
  add(
    new THREE.BoxGeometry(0.16, ARM_LEN, 0.16),
    shirt,
    0,
    -ARM_LEN / 2,
    0,
    shoulderR,
  );
  add(
    new THREE.BoxGeometry(0.14, 0.12, 0.14),
    skin,
    0,
    -ARM_LEN - 0.07,
    0,
    shoulderR,
  );

  // Head.
  add(new THREE.SphereGeometry(0.24, 12, 10), skin, 0, 0.88, 0);

  // Eyes facing +Z so the figure has a visible front.
  const eyeGeometry = new THREE.SphereGeometry(0.04, 8, 8);
  const eyeMaterial = new THREE.MeshPhongMaterial({ color: 0x1a1a1a });
  const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
  leftEye.position.set(-0.08, 0.92, 0.2);
  group.add(leftEye);
  const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
  rightEye.position.set(0.08, 0.92, 0.2);
  group.add(rightEye);

  group.scale.setScalar(scale);

  // Hinge pivots exposed so callers can drive a walk-cycle animation.
  group.userData.limbs = { hipL, hipR, shoulderL, shoulderR };

  return group;
}

// ─── Shared walk-cycle animation ──────────────────────────────────────────
// Drives the hip/shoulder hinges exposed on `group.userData.limbs` (see
// createHumanFigure above) into a swinging gait. Cadence is constant
// (independent of how fast the figure is actually translating) so it looks
// right whether it's driving the player, a fast enemy, or a slow-strolling
// NPC — only whether it's `moving` matters. Per-figure phase/blend state is
// kept on `group.userData.walkState` so any number of figures can share
// this one function.
const WALK_PHASE_RATE = 0.175; // radians of stride phase per frame (~60fps) while moving
const WALK_BLEND_RATE = 0.25; // how fast the swing eases in/out of idle stance
const LEG_SWING_MAX = 0.6; // radians
const ARM_SWING_MAX = 0.5; // radians

export function updateWalkCycle(group, dt, moving) {
  const limbs = group.userData.limbs;
  if (!limbs) return;
  let ws = group.userData.walkState;
  if (!ws) {
    ws = { phase: 0, blend: 0 };
    group.userData.walkState = ws;
  }
  const targetBlend = moving ? 1 : 0;
  ws.blend += (targetBlend - ws.blend) * Math.min(1, WALK_BLEND_RATE * dt);
  if (moving) ws.phase += WALK_PHASE_RATE * dt;

  const swing = Math.sin(ws.phase);
  const legAngle = swing * LEG_SWING_MAX * ws.blend;
  const armAngle = swing * ARM_SWING_MAX * ws.blend;

  // Legs and opposite-side arms swing together, like a real gait.
  limbs.hipL.rotation.x = legAngle;
  limbs.hipR.rotation.x = -legAngle;
  limbs.shoulderL.rotation.x = -armAngle;
  limbs.shoulderR.rotation.x = armAngle;
}

// Axis-aligned collision box centered on `position`. Using an explicit box
// (rather than the visual mesh's bounding box) keeps hit detection stable
// regardless of how a character is rotated.
export function makeBox(position, halfWidth, halfHeight, halfDepth) {
  return new THREE.Box3(
    new THREE.Vector3(
      position.x - halfWidth,
      position.y - halfHeight,
      position.z - halfDepth,
    ),
    new THREE.Vector3(
      position.x + halfWidth,
      position.y + halfHeight,
      position.z + halfDepth,
    ),
  );
}

// ─── Punch / melee swing animation ────────────────────────────────────────
// Drives one arm through a windup → jab → recover arc using the same shoulder
// hinges as the walk cycle. Call updateWalkCycle() FIRST each frame, then
// updatePunch() — the punch overrides the swinging arm (and raises the other
// into a guard pose) while it is active. `dt` uses the game's frame-normalized
// units (1.0 = one 60fps frame), so time is converted to seconds internally.
const PUNCH_WINDUP_END = 0.15; // seconds — arm pulled back
const PUNCH_STRIKE_END = 0.28; // seconds — arm fully extended forward
const PUNCH_TOTAL = 0.55; // seconds — back to a relaxed stance
const PUNCH_WINDUP_ANGLE = 0.55; // radians behind the body
const PUNCH_STRIKE_ANGLE = -1.6; // radians forward (arm roughly horizontal)
const PUNCH_GUARD_ANGLE = -0.55; // idle guard raise for the off hand

// Starts a swing with the given hand ("L" | "R"). Returns false if a swing is
// already in progress so callers can't spam overlapping animations.
export function startPunch(group, hand = "R") {
  if (group.userData.punchState) return false;
  group.userData.punchState = { time: 0, hand, struck: false };
  return true;
}

// Advances an active punch. Returns:
//   false     — no swing running (callers may start a new one)
//   "strike"  — the frame the fist reaches full extension (damage moment)
//   "active"  — swing still animating
export function updatePunch(group, dt) {
  const ps = group.userData.punchState;
  const limbs = group.userData.limbs;
  if (!ps || !limbs) return false;
  if (group.visible === false) {
    group.userData.punchState = null;
    return false;
  }

  ps.time += dt / 60;
  const t = ps.time;

  let punchAngle;
  if (t < PUNCH_WINDUP_END) {
    // Windup: pull the fist back over the shoulder.
    punchAngle = (t / PUNCH_WINDUP_END) * PUNCH_WINDUP_ANGLE;
  } else if (t < PUNCH_STRIKE_END) {
    // Strike: snap the arm forward to full extension.
    const u = (t - PUNCH_WINDUP_END) / (PUNCH_STRIKE_END - PUNCH_WINDUP_END);
    punchAngle =
      PUNCH_WINDUP_ANGLE + (PUNCH_STRIKE_ANGLE - PUNCH_WINDUP_ANGLE) * (u * u); // ease-in snap
  } else {
    // Recover: ease the arm back down to the relaxed stance.
    const u = Math.min(
      1,
      (t - PUNCH_STRIKE_END) / (PUNCH_TOTAL - PUNCH_STRIKE_END),
    );
    punchAngle = PUNCH_STRIKE_ANGLE * (1 - u) * (1 - u * 0.5);
  }

  const punchShoulder = ps.hand === "R" ? limbs.shoulderR : limbs.shoulderL;
  const guardShoulder = ps.hand === "R" ? limbs.shoulderL : limbs.shoulderR;
  punchShoulder.rotation.x = punchAngle;
  // Off hand holds a loose guard near the chest for the whole swing.
  guardShoulder.rotation.x = PUNCH_GUARD_ANGLE;

  // Fire the strike signal exactly once — the frame the jab reaches extension.
  if (!ps.struck && t >= PUNCH_STRIKE_END * 0.85) {
    ps.struck = true;
    return "strike";
  }

  if (t >= PUNCH_TOTAL) {
    group.userData.punchState = null;
  }
  return "active";
}
