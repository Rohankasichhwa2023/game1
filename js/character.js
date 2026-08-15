// character.js
// Low-poly humanoid figures built from primitives, plus a small collision helper.

import * as THREE from 'three';

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

  const add = (geometry, material, x, y, z) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // Legs (feet at y = -1).
  add(new THREE.BoxGeometry(0.26, 0.9, 0.26), pants, -0.15, -0.55, 0);
  add(new THREE.BoxGeometry(0.26, 0.9, 0.26), pants, 0.15, -0.55, 0);

  // Torso (hips ~ -0.1, shoulders ~ +0.65).
  add(new THREE.BoxGeometry(0.7, 0.75, 0.4), shirt, 0, 0.275, 0);

  // Arms hanging at the sides.
  add(new THREE.BoxGeometry(0.16, 0.7, 0.16), shirt, -0.46, 0.2, 0);
  add(new THREE.BoxGeometry(0.16, 0.7, 0.16), shirt, 0.46, 0.2, 0);

  // Hands.
  add(new THREE.BoxGeometry(0.14, 0.12, 0.14), skin, -0.46, -0.22, 0);
  add(new THREE.BoxGeometry(0.14, 0.12, 0.14), skin, 0.46, -0.22, 0);

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

  return group;
}

// Axis-aligned collision box centered on `position`. Using an explicit box
// (rather than the visual mesh's bounding box) keeps hit detection stable
// regardless of how a character is rotated.
export function makeBox(position, halfWidth, halfHeight, halfDepth) {
  return new THREE.Box3(
    new THREE.Vector3(position.x - halfWidth, position.y - halfHeight, position.z - halfDepth),
    new THREE.Vector3(position.x + halfWidth, position.y + halfHeight, position.z + halfDepth)
  );
}
