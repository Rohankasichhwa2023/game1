// portal.js
// Portal spawning, collision detection, and animation.

import * as THREE from 'three';
import { state } from './state.js';
import { makeBox } from './character.js';
import { triggerGameOver } from './ui.js';

export function spawnPortal(spawnPosition) {
  const innerRadius = 4;
  const outerRadius = 6;
  const segments = 32;

  const portalRingGeometry = new THREE.RingGeometry(innerRadius, outerRadius, segments);
  const portalRingMaterial = new THREE.MeshBasicMaterial({
    color: 0x0000ff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.8,
  });
  const portalRing = new THREE.Mesh(portalRingGeometry, portalRingMaterial);

  portalRing.position.copy(spawnPosition);
  portalRing.position.y = outerRadius;
  portalRing.rotation.x = Math.PI / 2;

  const innerCircleGeometry = new THREE.CircleGeometry(innerRadius, segments);
  const innerCircleMaterial = new THREE.MeshBasicMaterial({
    color: 0x00aaff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.6,
  });
  const innerCircle = new THREE.Mesh(innerCircleGeometry, innerCircleMaterial);
  innerCircle.position.copy(portalRing.position);
  innerCircle.rotation.x = Math.PI / 2;

  const portalGroup = new THREE.Group();
  portalGroup.add(portalRing);
  portalGroup.add(innerCircle);

  portalGroup.userData.box = new THREE.Box3().setFromObject(portalGroup);

  state.scene.add(portalGroup);
  state.goldenGateSpawned = true;
  state.goldenGateDoor = portalGroup;

  console.log('Blue wormhole portal spawned at boss location!');
}

export function updatePortalCollision() {
  if (!state.goldenGateSpawned || !state.goldenGateDoor) return;

  state.goldenGateDoor.userData.box.setFromObject(state.goldenGateDoor);
  const playerBox = makeBox(state.player.position, 0.5, 1, 0.5);

  if (playerBox.intersectsBox(state.goldenGateDoor.userData.box)) {
    if (state.goldCount >= 5) {
      console.log('Portal activated!');
      triggerGameOver('You win! You passed through the portal with all 5 gold coins.');
    } else {
      console.log('You need 5 gold coins to activate the portal.');
    }
  }
}

export function animatePortal(dt) {
  if (!state.goldenGateSpawned || !state.goldenGateDoor) return;
  state.goldenGateDoor.rotation.y += 0.01 * dt;
}
