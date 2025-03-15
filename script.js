import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

// ---------------- Global Minimap Constants ----------------
const minimapWorldSize = 300; // World units shown in minimap (diameter)
const entityScale = 2;        // Multiplier to draw entities larger on minimap

// ---------------- Scene Setup ----------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Light blue sky

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 3000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// ---------------- Create Circular Minimap Canvas ----------------
const minimapCanvas = document.createElement('canvas');
minimapCanvas.width = 150;
minimapCanvas.height = 150;
minimapCanvas.style.position = 'absolute';
minimapCanvas.style.bottom = '10px';
minimapCanvas.style.right = '10px';
minimapCanvas.style.border = '2px solid black';
minimapCanvas.style.borderRadius = '50%';
document.body.appendChild(minimapCanvas);
const minimapContext = minimapCanvas.getContext('2d');

// Helper: Convert world coordinates to minimap canvas coordinates,
// centering the view around the player's position.
function worldToMinimap(x, z) {
  const scale = minimapCanvas.width / minimapWorldSize; // e.g. 150/300 = 0.5
  const dx = x - player.position.x;
  const dz = z - player.position.z;
  return {
    x: minimapCanvas.width / 2 + dx * scale,
    y: minimapCanvas.height / 2 - dz * scale // Invert z to match canvas y-axis.
  };
}

// ---------------- Ground with Procedural Grass Texture ----------------
const groundSize = 1000;
const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);

function generateGrassTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = "#228B22";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 5000; i++) {
    const x = Math.floor(Math.random() * canvas.width);
    const y = Math.floor(Math.random() * canvas.height);
    const shade = 220 + Math.floor(Math.random() * 35);
    ctx.fillStyle = `rgb(0, ${shade}, 0)`;
    ctx.fillRect(x, y, 1, 1);
  }
  return canvas;
}

const grassTextureCanvas = generateGrassTexture();
const grassTexture = new THREE.CanvasTexture(grassTextureCanvas);
grassTexture.wrapS = THREE.RepeatWrapping;
grassTexture.wrapT = THREE.RepeatWrapping;
grassTexture.repeat.set(groundSize / 50, groundSize / 50);

const groundMaterial = new THREE.MeshPhongMaterial({ map: grassTexture, side: THREE.DoubleSide });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ---------------- HUD: Life & Gold Displays ----------------
let playerLife = 10;
const lifeDisplay = document.createElement('div');
lifeDisplay.style.position = 'absolute';
lifeDisplay.style.top = '10px';
lifeDisplay.style.left = '10px';
lifeDisplay.style.color = 'red';
lifeDisplay.style.fontSize = '24px';
lifeDisplay.style.fontFamily = 'Arial, sans-serif';
lifeDisplay.innerHTML = `Life: ${playerLife}`;
document.body.appendChild(lifeDisplay);

let goldCount = 0;
const goldDisplay = document.createElement('div');
goldDisplay.style.position = 'absolute';
goldDisplay.style.top = '10px';
goldDisplay.style.right = '10px';
goldDisplay.style.color = 'gold';
goldDisplay.style.fontSize = '24px';
goldDisplay.style.fontFamily = 'Arial, sans-serif';
goldDisplay.innerHTML = `Gold: ${goldCount}/5`;
document.body.appendChild(goldDisplay);

// ---------------- Gun System ----------------
let currentGun = { name: "default", damage: 1 };
const gunPickups = [];

function createGunPickup(gunType) {
  const group = new THREE.Group();
  const bodyGeometry = new THREE.BoxGeometry(1, 0.3, 0.2);
  let bodyMaterial;
  if (gunType === "rifle") {
    bodyMaterial = new THREE.MeshPhongMaterial({ color: 0x0000ff });
  } else if (gunType === "shotgun") {
    bodyMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
  }
  const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
  group.add(bodyMesh);
  const barrelGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.8, 8);
  const barrelMaterial = new THREE.MeshPhongMaterial({ color: 0x333333 });
  const barrelMesh = new THREE.Mesh(barrelGeometry, barrelMaterial);
  barrelMesh.rotation.z = Math.PI / 2;
  barrelMesh.position.set(0.6, 0, 0);
  group.add(barrelMesh);
  const textSprite = createTextSprite(gunType.charAt(0).toUpperCase() + gunType.slice(1));
  textSprite.position.set(0, 0.5, 0);
  group.add(textSprite);
  group.userData.gunType = gunType;
  group.scale.set(0.5, 0.5, 0.5);
  return group;
}

function createTextSprite(message) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = 256;
  canvas.height = 128;
  context.fillStyle = "white";
  context.font = "40px Arial";
  context.textAlign = "center";
  context.fillText(message, canvas.width / 2, 80);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3, 3, 3);
  return sprite;
}

function scatterGunPickups() {
  let rifle = createGunPickup("rifle");
  let distance = 100 + Math.random() * 100;
  let angle = Math.random() * 2 * Math.PI;
  let x = player.position.x + distance * Math.cos(angle);
  let z = player.position.z + distance * Math.sin(angle);
  rifle.position.set(x, 0.5, z);
  scene.add(rifle);
  gunPickups.push(rifle);
  
  let shotgun = createGunPickup("shotgun");
  distance = 200 + Math.random() * 200;
  angle = Math.random() * 2 * Math.PI;
  x = player.position.x + distance * Math.cos(angle);
  z = player.position.z + distance * Math.sin(angle);
  shotgun.position.set(x, 0.5, z);
  scene.add(shotgun);
  gunPickups.push(shotgun);
}

function updateGunPickups() {
  let gunPowerText = document.getElementById("gunPowerDisplay");
  for (let i = gunPickups.length - 1; i >= 0; i--) {
    const gunMesh = gunPickups[i];
    if (player.position.distanceTo(gunMesh.position) < 2) {
      const newGunType = gunMesh.userData.gunType;
      if (newGunType === "rifle") {
        currentGun = { name: "rifle", damage: 2 };
        if (gunPowerText) gunPowerText.textContent = " Rifle Damage: 2";
      } else if (newGunType === "shotgun") {
        currentGun = { name: "shotgun", damage: 5 };
        if (gunPowerText) gunPowerText.textContent = "ShotGun Damage: 5";
      }
      console.log("Picked up " + currentGun.name);
      scene.remove(gunMesh);
      gunPickups.splice(i, 1);
    }
  }
}

// ---------------- Object Arrays for Collisions & Bullets ----------------
const treeBoxes = [];
const buildingBoxes = [];
const wallBoxes = [];
const enemies = [];
const enemyBullets = [];
let bullets = [];
let gameOver = false;
const bulletSpeed = 1;

// ---------------- Bullet Pooling ----------------
const bulletPool = [];
const enemyBulletPool = [];

function getBullet(color, isEnemy = false) {
  const pool = isEnemy ? enemyBulletPool : bulletPool;
  if (pool.length > 0) {
    const bullet = pool.pop();
    bullet.visible = true;
    bullet.material.color.set(color);
    return bullet;
  } else {
    const geometry = new THREE.SphereGeometry(0.1, 10, 10);
    const material = new THREE.MeshPhongMaterial({ color: color });
    const bullet = new THREE.Mesh(geometry, material);
    bullet.castShadow = true;
    return bullet;
  }
}

function returnBullet(bullet, isEnemy = false) {
  bullet.visible = false;
  const pool = isEnemy ? enemyBulletPool : bulletPool;
  pool.push(bullet);
}

// ---------------- Object Creation Functions ----------------
function createTree(x, z) {
  const trunkGeometry = new THREE.CylinderGeometry(0.5, 0.5, 5);
  const trunkMaterial = new THREE.MeshPhongMaterial({ color: 0x8B4513 });
  const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  trunk.position.set(x, 2.5, z);
  
  const foliageGeometry = new THREE.SphereGeometry(3, 10, 10);
  const foliageMaterial = new THREE.MeshPhongMaterial({ color: 0x228B22 });
  const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
  foliage.castShadow = true;
  foliage.receiveShadow = true;
  foliage.position.set(x, 6, z);
  
  scene.add(trunk);
  scene.add(foliage);
  
  const treeBox = new THREE.Box3().setFromObject(trunk);
  return treeBox;
}

for (let i = 0; i < 600; i++) {
  const x = Math.random() * groundSize - groundSize / 2;
  const z = Math.random() * groundSize - groundSize / 2;
  treeBoxes.push(createTree(x, z));
}

function createBuilding(x, z, width, height, depth) {
  const buildingColors = [
    0x808080, 0xa0a0a0, 0xc0c0c0, 0xdcdcdc, 0xaaaaaa, 0xffffff,
    0x7f3300, 0x993d00, 0x5c3c1e, 0x4a2c2a,
    0x1f3c88, 0x2a4d69, 0x556b2f, 0x228b22, 0xb22222
  ];
  const baseColor = buildingColors[Math.floor(Math.random() * buildingColors.length)];
  
  const baseGeometry = new THREE.BoxGeometry(width, height, depth);
  const baseMaterial = new THREE.MeshPhongMaterial({
    color: baseColor,
    shininess: 100,
    specular: 0xffffff,
  });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.castShadow = true;
  base.receiveShadow = true;
  base.position.set(x, height / 2, z);
  scene.add(base);
  
  const windowGeometry = new THREE.PlaneGeometry(2, 2);
  const windowMaterial = new THREE.MeshPhongMaterial({ color: 0xadd8e6, shininess: 100 });
  for (let i = 1; i <= 3; i++) {
    let windowMesh = new THREE.Mesh(windowGeometry, windowMaterial);
    windowMesh.position.set(x - width / 4 + (i * width / 6), height / 2, z + depth / 2 + 0.1);
    scene.add(windowMesh);
  }
  for (let i = 1; i <= 3; i++) {
    let windowMesh = new THREE.Mesh(windowGeometry, windowMaterial);
    windowMesh.rotation.y = Math.PI / 2;
    windowMesh.position.set(x + width / 2 + 0.1, height / 2, z - depth / 4 + (i * depth / 6));
    scene.add(windowMesh);
  }
  
  return new THREE.Box3().setFromObject(base);
}

for (let i = 0; i < 100; i++) {
  const x = Math.random() * groundSize - groundSize / 2;
  const z = Math.random() * groundSize - groundSize / 2;
  const width = Math.random() * 40 + 10;
  const height = Math.random() * 180 + 20;
  const depth = Math.random() * 40 + 10;
  buildingBoxes.push(createBuilding(x, z, width, height, depth));
}

function createWall(x, z, width, height, depth) {
  const wallGeometry = new THREE.BoxGeometry(width, height, depth);
  const wallMaterial = new THREE.MeshPhongMaterial({ color: 0xaaaaaa });
  const wall = new THREE.Mesh(wallGeometry, wallMaterial);
  wall.castShadow = true;
  wall.receiveShadow = true;
  wall.position.set(x, height / 2, z);
  scene.add(wall);
  
  const wallBox = new THREE.Box3().setFromObject(wall);
  return wallBox;
}

for (let i = 0; i < 300; i++) {
  const x = Math.random() * groundSize - groundSize / 2;
  const z = Math.random() * groundSize - groundSize / 2;
  const width = Math.random() * 20 + 10;
  const height = Math.random() * 3 + 2;
  const depth = Math.random() * 2 + 1;
  wallBoxes.push(createWall(x, z, width, height, depth));
}

function createEnemy(x, z) {
  const enemyGeometry = new THREE.BoxGeometry(2, 2, 2);
  const enemyMaterial = new THREE.MeshPhongMaterial({ color: 0xff00ff });
  const enemyMesh = new THREE.Mesh(enemyGeometry, enemyMaterial);
  enemyMesh.castShadow = true;
  enemyMesh.receiveShadow = true;
  enemyMesh.position.set(x, 1, z);
  scene.add(enemyMesh);
  
  return { mesh: enemyMesh, life: 10, lastShot: Date.now(), shootInterval: 2000 };
}

for (let i = 0; i < 5; i++) {
  const x = Math.random() * groundSize - groundSize / 2;
  const z = Math.random() * groundSize - groundSize / 2;
  enemies.push(createEnemy(x, z));
}

// ---------------- Player Setup ----------------
const playerGeometry = new THREE.BoxGeometry(1, 2, 1);
const playerMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 });
const player = new THREE.Mesh(playerGeometry, playerMaterial);
player.castShadow = true;
player.receiveShadow = true;
player.position.y = 1;
scene.add(player);

// ---------------- Sun & Ambient Light ----------------
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.position.set(100, 200, 100);
sun.castShadow = true;
sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 500;
scene.add(sun);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

// ---------------- Controls ----------------
const controls = new PointerLockControls(camera, document.body);
document.addEventListener('click', () => controls.lock());

// ---------------- Movement & Input ----------------
const moveSpeed = 0.3;
let isJumping = false;
let velocity = new THREE.Vector3();
let directionVec = new THREE.Vector3();
const keys = { KeyW: false, KeyS: false, KeyA: false, KeyD: false, Space: false };

// ------------- Double Space Jump Implementation -------------
// Add these global variables near your other movement variables.
let lastSpacePressTime = 0;
const doubleSpaceThreshold = 300; // in milliseconds

// Modify your keydown event listener:
document.addEventListener('keydown', (event) => {
  if (event.code === 'Space') {
    event.preventDefault();
    const now = Date.now();
    // If the space key is pressed twice quickly, trigger building jump.
    if (now - lastSpacePressTime < doubleSpaceThreshold) {
      jumpToBuilding();
    }
    lastSpacePressTime = now;
    keys[event.code] = true;
  } else if (keys.hasOwnProperty(event.code)) {
    keys[event.code] = true;
  }
});

// The existing keyup listener can remain unchanged.
document.addEventListener('keyup', (event) => {
  if (keys.hasOwnProperty(event.code)) keys[event.code] = false;
});

// Define the jumpToBuilding function.
function jumpToBuilding() {
  let candidateBuilding = null;
  let minDistance = Infinity;
  const margin = 2; // Allow a small margin for near misses.
  
  // Loop over all building bounding boxes.
  for (const buildingBox of buildingBoxes) {
    // Check if player's x and z are within the building's footprint (with a margin).
    if (
      player.position.x >= buildingBox.min.x - margin &&
      player.position.x <= buildingBox.max.x + margin &&
      player.position.z >= buildingBox.min.z - margin &&
      player.position.z <= buildingBox.max.z + margin
    ) {
      // Calculate horizontal distance from the center of the building.
      const center = new THREE.Vector3();
      buildingBox.getCenter(center);
      const horizontalDistance = Math.sqrt(
        (player.position.x - center.x) ** 2 +
        (player.position.z - center.z) ** 2
      );
      if (horizontalDistance < minDistance) {
        minDistance = horizontalDistance;
        candidateBuilding = buildingBox;
      }
    }
  }
  
  // If a nearby building is found, teleport the player to its top.
  if (candidateBuilding) {
    // The building's top is at candidateBuilding.max.y.
    // Add half the player's height (player height is 2 so offset by 1) to place the player on top.
    player.position.y = candidateBuilding.max.y + 1;
    // Also update the camera position accordingly.
    camera.position.set(player.position.x, player.position.y + 2, player.position.z);
  }
}


// ---------------- Player Shooting ----------------
let shootCooldown = false;
function shootBullet() {
  if (shootCooldown) return;
  
  const bullet = getBullet(0xff0000, false);
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2(0, 0);
  raycaster.setFromCamera(mouse, camera);
  const bulletDirection = raycaster.ray.direction.clone();
  const bulletStart = camera.position.clone().add(bulletDirection.clone().multiplyScalar(1.1));
  bullet.position.copy(bulletStart);
  bullet.userData.direction = bulletDirection.clone();
  
  scene.add(bullet);
  bullets.push(bullet);
  
  shootCooldown = true;
  setTimeout(() => { shootCooldown = false; }, 200);
}

// ---------------- Enemy Shooting ----------------
function shootEnemyBullet(enemy) {
  const bullet = getBullet(0x0000ff, true);
  const enemyPos = enemy.mesh.position.clone();
  const playerPos = player.position.clone();
  const bulletDir = new THREE.Vector3().subVectors(playerPos, enemyPos).normalize();
  const bulletStart = enemyPos.clone().add(bulletDir.clone().multiplyScalar(1.1));
  bullet.position.copy(bulletStart);
  bullet.userData.direction = bulletDir.clone();
  
  scene.add(bullet);
  enemyBullets.push(bullet);
}

// ---------------- New Variables for Sniper Mode ----------------
const defaultFOV = 75;
const sniperFOV = 20;
let isSniperMode = false;
let sniperShootCooldown = false;

document.addEventListener('mousedown', (event) => {
  if (event.button === 0) {
    shootBullet();
  } else if (event.button === 2) {
    isSniperMode = true;
    camera.fov = sniperFOV;
    camera.updateProjectionMatrix();
  }
});

document.addEventListener('mouseup', (event) => {
  if (event.button === 2 && isSniperMode) {
    isSniperMode = false;
    camera.fov = defaultFOV;
    camera.updateProjectionMatrix();
    shootSniperBullet();
  }
});

document.addEventListener('contextmenu', event => event.preventDefault());

function shootSniperBullet() {
  if (sniperShootCooldown) return;
  
  const bullet = getBullet(0xff0000, false);
  bullet.userData.isSniper = true;
  
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2(0, 0);
  raycaster.setFromCamera(mouse, camera);
  const bulletDirection = raycaster.ray.direction.clone();
  const bulletStart = camera.position.clone().add(bulletDirection.clone().multiplyScalar(1.1));
  bullet.position.copy(bulletStart);
  bullet.userData.direction = bulletDirection.clone();
  
  scene.add(bullet);
  bullets.push(bullet);
  
  sniperShootCooldown = true;
  setTimeout(() => { sniperShootCooldown = false; }, 500);
}

// ---------------- Update Functions ----------------
// Helper to get the building the player is standing on, if any.
function getCurrentSupportingBuilding() {
  const margin = 2; // Allowable margin for footprint check.
  for (const buildingBox of buildingBoxes) {
    if (
      player.position.x >= buildingBox.min.x - margin &&
      player.position.x <= buildingBox.max.x + margin &&
      player.position.z >= buildingBox.min.z - margin &&
      player.position.z <= buildingBox.max.z + margin
    ) {
      // Calculate what the player's y should be when on this building.
      const targetY = buildingBox.max.y + 1; // 1 = half of player's height.
      if (Math.abs(player.position.y - targetY) < 0.5) {
        return buildingBox;
      }
    }
  }
  return null;
}

function updateMovement() {
  // Get the current supporting building (if any) to determine ground level.
  const supportingBuilding = getCurrentSupportingBuilding();
  let currentGround = 1; // Flat ground level.
  if (supportingBuilding) {
    currentGround = supportingBuilding.max.y + 1;
  }
  
  // Get the camera direction and prepare the movement vector.
  camera.getWorldDirection(directionVec);
  directionVec.y = 0;
  directionVec.normalize();
  
  const right = new THREE.Vector3();
  right.crossVectors(new THREE.Vector3(0, 1, 0), directionVec).normalize();
  
  const moveVector = new THREE.Vector3();
  if (keys['KeyW']) moveVector.addScaledVector(directionVec, moveSpeed);
  if (keys['KeyS']) moveVector.addScaledVector(directionVec, -moveSpeed);
  if (keys['KeyA']) moveVector.addScaledVector(right, moveSpeed);
  if (keys['KeyD']) moveVector.addScaledVector(right, -moveSpeed);
  
  // Create a new bounding box to test movement.
  const playerBox = new THREE.Box3().setFromObject(player);
  const newPlayerBox = playerBox.clone().translate(moveVector);
  
  let canMove = true;
  // Check collisions with trees.
  for (const treeBox of treeBoxes) {
    if (newPlayerBox.intersectsBox(treeBox)) { 
      canMove = false; 
      break; 
    }
  }
  // Check collisions with buildings, but ignore the one currently supporting the player.
  if (canMove) {
    for (const buildingBox of buildingBoxes) {
      if (supportingBuilding === buildingBox) continue;
      if (newPlayerBox.intersectsBox(buildingBox)) { 
        canMove = false; 
        break; 
      }
    }
  }
  // Check collisions with walls.
  if (canMove) {
    for (const wallBox of wallBoxes) {
      if (newPlayerBox.intersectsBox(wallBox)) { 
        canMove = false; 
        break; 
      }
    }
  }
  // Check collisions with enemies.
  if (canMove) {
    const playerBoxNew = new THREE.Box3().setFromObject(player);
    for (const enemy of enemies) {
      const enemyBox = new THREE.Box3().setFromObject(enemy.mesh);
      if (playerBoxNew.intersectsBox(enemyBox)) {
        triggerGameOver("An enemy caught you.");
        return;
      }
    }
  }
  
  // If no collisions, apply horizontal movement.
  if (canMove) {
    player.position.add(moveVector);
    camera.position.set(player.position.x, player.position.y + 2, player.position.z);
  }
  
  // Allow jumping if the player is at the current ground level.
  if (keys['Space'] && !isJumping && Math.abs(player.position.y - currentGround) < 0.01) {
    velocity.y = 0.5;
    isJumping = true;
  }
  
  // Apply gravity.
  velocity.y -= 0.02;
  player.position.y += velocity.y;
  
  // Check landing: if below current ground, snap the player up.
  if (player.position.y < currentGround) {
    player.position.y = currentGround;
    velocity.y = 0;
    isJumping = false;
  }
}


function updateBullets() {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const bullet = bullets[i];
    bullet.position.addScaledVector(bullet.userData.direction, bulletSpeed);
    
    const rangeThreshold = bullet.userData.isSniper ? 300 : 100;
    if (bullet.position.distanceTo(camera.position) > rangeThreshold) {
      scene.remove(bullet);
      bullets.splice(i, 1);
      returnBullet(bullet, false);
      continue;
    }
    
    for (let j = enemies.length - 1; j >= 0; j--) {
      const enemy = enemies[j];
      const enemyBox = new THREE.Box3().setFromObject(enemy.mesh);
      if (enemyBox.containsPoint(bullet.position)) {
        enemy.life -= currentGun.damage;
        scene.remove(bullet);
        bullets.splice(i, 1);
        returnBullet(bullet, false);
        if (enemy.life <= 0) {
          scene.remove(enemy.mesh);
          enemies.splice(j, 1);
        }
        break;
      }
    }
  }
}

function updateEnemyBullets() {
  const playerBox = new THREE.Box3().setFromObject(player);
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    const bullet = enemyBullets[i];
    bullet.position.addScaledVector(bullet.userData.direction, bulletSpeed);
    
    let collided = false;
    for (const treeBox of treeBoxes) {
      if (treeBox.containsPoint(bullet.position)) { collided = true; break; }
    }
    if (!collided) {
      for (const buildingBox of buildingBoxes) {
        if (buildingBox.containsPoint(bullet.position)) { collided = true; break; }
      }
    }
    if (!collided) {
      for (const wallBox of wallBoxes) {
        if (wallBox.containsPoint(bullet.position)) { collided = true; break; }
      }
    }
    if (collided) {
      scene.remove(bullet);
      enemyBullets.splice(i, 1);
      returnBullet(bullet, true);
      continue;
    }
    
    if (bullet.position.distanceTo(player.position) > 200) {
      scene.remove(bullet);
      enemyBullets.splice(i, 1);
      returnBullet(bullet, true);
      continue;
    }
    
    if (playerBox.containsPoint(bullet.position)) {
      playerLife -= 1;
      lifeDisplay.innerHTML = `Life: ${playerLife}`;
      scene.remove(bullet);
      enemyBullets.splice(i, 1);
      returnBullet(bullet, true);
      if (playerLife <= 0 && !gameOver) {
        triggerGameOver("You were shot by an enemy.");
      }
      continue;
    }
  }
}

function rotateVectorY(vector, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return new THREE.Vector3(
    vector.x * cos - vector.z * sin,
    vector.y,
    vector.x * sin + vector.z * cos
  );
}

function checkObstaclesCollision(box) {
  for (const treeBox of treeBoxes) {
    if (box.intersectsBox(treeBox)) return true;
  }
  for (const buildingBox of buildingBoxes) {
    if (box.intersectsBox(buildingBox)) return true;
  }
  for (const wallBox of wallBoxes) {
    if (box.intersectsBox(wallBox)) return true;
  }
  return false;
}

function updateEnemies() {
  const playerBox = new THREE.Box3().setFromObject(player);
  for (const enemy of enemies) {
    const directChaseDir = new THREE.Vector3().subVectors(player.position, enemy.mesh.position).normalize();
    const enemySpeed = 0.1;
    let bestVector = directChaseDir.clone().multiplyScalar(enemySpeed);
    
    const enemyBox = new THREE.Box3().setFromObject(enemy.mesh);
    let newEnemyBox = enemyBox.clone().translate(bestVector);
    let canMove = !checkObstaclesCollision(newEnemyBox);
    
    if (!canMove) {
      const alternatives = [];
      for (let angle = -Math.PI/2; angle <= Math.PI/2; angle += Math.PI/12) {
        const altDir = rotateVectorY(directChaseDir, angle);
        const altVector = altDir.clone().multiplyScalar(enemySpeed);
        const altBox = enemyBox.clone().translate(altVector);
        if (!checkObstaclesCollision(altBox)) {
          const predictedPos = enemy.mesh.position.clone().add(altVector);
          const distance = predictedPos.distanceTo(player.position);
          alternatives.push({ vector: altVector, distance });
        }
      }
      if (alternatives.length > 0) {
        alternatives.sort((a, b) => a.distance - b.distance);
        bestVector = alternatives[0].vector;
        canMove = true;
      } else {
        bestVector = new THREE.Vector3((Math.random() - 0.5) * enemySpeed, 0, (Math.random() - 0.5) * enemySpeed);
        if (!checkObstaclesCollision(enemyBox.clone().translate(bestVector))) {
          canMove = true;
        } else {
          canMove = false;
        }
      }
    }
    
    if (canMove) {
      enemy.mesh.position.add(bestVector);
    }
    
    const updatedEnemyBox = new THREE.Box3().setFromObject(enemy.mesh);
    if (updatedEnemyBox.intersectsBox(playerBox)) {
      triggerGameOver("An enemy caught you.");
      return;
    }
    
    if (Date.now() - enemy.lastShot > enemy.shootInterval) {
      enemy.lastShot = Date.now();
      shootEnemyBullet(enemy);
    }
  }
}

// ------------- Create a Small Heart Lifeline Geometry -------------
function createSmallHeartGeometry() {
  const x = 0, y = 0;
  const heartShape = new THREE.Shape();
  heartShape.moveTo(x + 5, y + 5);
  heartShape.bezierCurveTo(x + 5, y + 5, x + 4, y, x, y);
  heartShape.bezierCurveTo(x - 6, y, x - 6, y + 7, x - 6, y + 7);
  heartShape.bezierCurveTo(x - 6, y + 11, x - 3, y + 15.4, x + 5, y + 19);
  heartShape.bezierCurveTo(x + 12, y + 15.4, x + 16, y + 11, x + 16, y + 7);
  heartShape.bezierCurveTo(x + 16, y + 7, x + 16, y, x + 10, y);
  heartShape.bezierCurveTo(x + 7, y, x + 5, y + 5, x + 5, y + 5);
  
  const extrudeSettings = {
    depth: 2,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 2,
    bevelSize: 1,
    bevelThickness: 1
  };
  const geometry = new THREE.ExtrudeGeometry(heartShape, extrudeSettings);
  geometry.center();
  geometry.scale(0.03, 0.03, 0.03);
  return geometry;
}

const smallHeartGeometry = createSmallHeartGeometry();
const heartMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 });
const lifelines = [];

function createHeartLifeline(distanceMin, distanceMax) {
  const distance = distanceMin + Math.random() * (distanceMax - distanceMin);
  const angle = Math.random() * 2 * Math.PI;
  const x = player.position.x + distance * Math.cos(angle);
  const z = player.position.z + distance * Math.sin(angle);
  const heartMesh = new THREE.Mesh(smallHeartGeometry, heartMaterial);
  heartMesh.rotation.z = Math.PI;
  heartMesh.position.set(x, 1, z);
  scene.add(heartMesh);
  lifelines.push(heartMesh);
}

createHeartLifeline(50, 100);
createHeartLifeline(100, 150);
createHeartLifeline(150, 200);

function updateLifelines() {
  for (let i = lifelines.length - 1; i >= 0; i--) {
    const heart = lifelines[i];
    if (player.position.distanceTo(heart.position) < 3) {
      playerLife += 2;
      lifeDisplay.innerHTML = `Life: ${playerLife}`;
      scene.remove(heart);
      lifelines.splice(i, 1);
    }
  }
}

// ---------------- Gold Coin Creation ----------------
const goldCoinGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 32);
const goldCoinMaterial = new THREE.MeshPhongMaterial({ color: 0xffd700 });
const goldCoins = [];

function createGoldCoin(minDistance, maxDistance) {
  const distance = minDistance + Math.random() * (maxDistance - minDistance);
  const angle = Math.random() * 2 * Math.PI;
  const x = player.position.x + distance * Math.cos(angle);
  const z = player.position.z + distance * Math.sin(angle);
  const coinMesh = new THREE.Mesh(goldCoinGeometry, goldCoinMaterial);
  coinMesh.rotation.x = Math.PI / 2;
  coinMesh.position.set(x, 0.5, z);
  scene.add(coinMesh);
  goldCoins.push(coinMesh);
}

for (let i = 0; i < 5; i++) {
  createGoldCoin(250, 400);
}

function updateGoldCoins() {
  for (let i = goldCoins.length - 1; i >= 0; i--) {
    const coin = goldCoins[i];
    if (player.position.distanceTo(coin.position) < 2) {
      goldCount++;
      goldDisplay.innerHTML = `Gold: ${goldCount}/5`;
      scene.remove(coin);
      goldCoins.splice(i, 1);
      
      if (goldCount >= 5) {
        triggerGameOver("You win! You collected all gold coins.");
      }
    }
  }
}

// ---------------- Game Over Function ----------------
function triggerGameOver(message) {
  if (gameOver) return;
  gameOver = true;
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  overlay.style.top = '50%';
  overlay.style.left = '50%';
  overlay.style.transform = 'translate(-50%, -50%)';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
  overlay.style.color = 'white';
  overlay.style.padding = '20px';
  overlay.style.fontSize = '32px';
  overlay.innerHTML = `Game Over! ${message}`;
  document.body.appendChild(overlay);
  setTimeout(() => window.location.reload(), 3000);
}

// ---------------- Aiming Pointer (Crosshair) ----------------
const pointer = document.createElement('div');
pointer.style.position = 'absolute';
pointer.style.top = '50%';
pointer.style.left = '50%';
pointer.style.width = '40px';
pointer.style.height = '40px';
pointer.style.backgroundColor = 'rgba(255, 0, 0, 0.4)';
pointer.style.borderRadius = '50%';
pointer.style.transform = 'translate(-50%, -50%)';
const cross = document.createElement('div');
cross.style.position = 'absolute';
cross.style.top = '50%';
cross.style.left = '50%';
cross.style.width = '16px';
cross.style.height = '2px';
cross.style.backgroundColor = 'red';
cross.style.transform = 'translate(-50%, -50%) rotate(45deg)';
pointer.appendChild(cross);
const cross2 = document.createElement('div');
cross2.style.position = 'absolute';
cross2.style.top = '50%';
cross2.style.left = '50%';
cross2.style.width = '16px';
cross2.style.height = '2px';
cross2.style.backgroundColor = 'red';
cross2.style.transform = 'translate(-50%, -50%) rotate(-45deg)';
pointer.appendChild(cross2);
document.body.appendChild(pointer);

// ---------------- Set Initial Camera Position ----------------
camera.position.set(player.position.x, player.position.y + 2, player.position.z);

// ---------------- Scatter Gun Pickups ----------------
scatterGunPickups();

// ---------------- Minimap Update Function ----------------
function updateMinimap() {
  // Clear the canvas.
  minimapContext.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);
  
  // Clip drawing to a circular area.
  minimapContext.save();
  minimapContext.beginPath();
  minimapContext.arc(minimapCanvas.width / 2, minimapCanvas.height / 2, minimapCanvas.width / 2, 0, Math.PI * 2);
  minimapContext.closePath();
  minimapContext.clip();
  
  // Draw background.
  minimapContext.fillStyle = '#333';
  minimapContext.fillRect(0, 0, minimapCanvas.width, minimapCanvas.height);
  
  // Draw trees as green circles (bigger than before).
  minimapContext.fillStyle = '#008000';
  const centerVec = new THREE.Vector3();
  treeBoxes.forEach(treeBox => {
    treeBox.getCenter(centerVec);
    const pos = worldToMinimap(centerVec.x, centerVec.z);
    minimapContext.beginPath();
    minimapContext.arc(pos.x, pos.y, 2 * entityScale, 0, 2 * Math.PI);
    minimapContext.fill();
  });
  
  // Draw buildings as light grey rectangles (entities scaled up).
  minimapContext.fillStyle = '#999';
  buildingBoxes.forEach(buildingBox => {
    const center = new THREE.Vector3();
    buildingBox.getCenter(center);
    const min = buildingBox.min;
    const max = buildingBox.max;
    const widthWorld = max.x - min.x;
    const heightWorld = max.z - min.z;
    const scale = minimapCanvas.width / minimapWorldSize;
    const width = widthWorld * scale * entityScale;
    const height = heightWorld * scale * entityScale;
    const pos = worldToMinimap(center.x, center.z);
    minimapContext.fillRect(pos.x - width/2, pos.y - height/2, width, height);
  });
  
  // Draw walls as darker grey rectangles.
  minimapContext.fillStyle = '#666';
  wallBoxes.forEach(wallBox => {
    const center = new THREE.Vector3();
    wallBox.getCenter(center);
    const min = wallBox.min;
    const max = wallBox.max;
    const widthWorld = max.x - min.x;
    const heightWorld = max.z - min.z;
    const scale = minimapCanvas.width / minimapWorldSize;
    const width = widthWorld * scale * entityScale;
    const height = heightWorld * scale * entityScale;
    const pos = worldToMinimap(center.x, center.z);
    minimapContext.fillRect(pos.x - width/2, pos.y - height/2, width, height);
  });
  
  // Draw enemies as red circles.
  minimapContext.fillStyle = '#ff0000';
  enemies.forEach(enemy => {
    const pos = worldToMinimap(enemy.mesh.position.x, enemy.mesh.position.z);
    minimapContext.beginPath();
    minimapContext.arc(pos.x, pos.y, 3 * entityScale, 0, 2 * Math.PI);
    minimapContext.fill();
  });
  
  // Draw player as a golden circle.
  minimapContext.fillStyle = '#FFD700';
  const playerPos = worldToMinimap(player.position.x, player.position.z);
  minimapContext.beginPath();
  minimapContext.arc(playerPos.x, playerPos.y, 4 * entityScale, 0, 2 * Math.PI);
  minimapContext.fill();
  
  minimapContext.restore();
}

// ---------------- Animation Loop ----------------
function animate() {
  requestAnimationFrame(animate);
  updateMovement();
  updateBullets();
  updateEnemyBullets();
  updateEnemies();
  updateLifelines();
  updateGoldCoins();
  updateGunPickups();
  renderer.render(scene, camera);
  updateMinimap();
}

animate();

// ---------------- Resize Handling ----------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
