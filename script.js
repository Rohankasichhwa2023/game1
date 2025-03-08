import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

// ---------------- Scene Setup ----------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Light blue sky

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 3000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// ---------------- Ground with Procedural Grass Texture ----------------
const groundSize = 1000;
const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);

function generateGrassTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  // Base green fill
  ctx.fillStyle = "#228B22";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Add noise to simulate grass
  for (let i = 0; i < 5000; i++) {
    const x = Math.floor(Math.random() * canvas.width);
    const y = Math.floor(Math.random() * canvas.height);
    const shade = 220 + Math.floor(Math.random() * 35); // 220-254
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

// ---------------- HUD: Life Display ----------------
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
// Reuse bullet objects to reduce garbage collection overhead.
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
  // Trunk
  const trunkGeometry = new THREE.CylinderGeometry(0.5, 0.5, 5);
  const trunkMaterial = new THREE.MeshPhongMaterial({ color: 0x8B4513 });
  const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  trunk.position.set(x, 2.5, z);
  
  // Foliage
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

// Generate 600 trees
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
  
  // Add windows on front and side
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

// Generate 100 buildings
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

// Generate 300 walls
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

// Generate 10 enemies
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

// ---------------- Sun (Directional Light) & Ambient Light ----------------
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

document.addEventListener('keydown', (event) => {
  if (event.code === 'Space') event.preventDefault();
  if (keys.hasOwnProperty(event.code)) keys[event.code] = true;
});
document.addEventListener('keyup', (event) => {
  if (keys.hasOwnProperty(event.code)) keys[event.code] = false;
});

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

// ---------------- Update Functions ----------------
function updateMovement() {
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
  
  const playerBox = new THREE.Box3().setFromObject(player);
  const newPlayerBox = playerBox.clone().translate(moveVector);
  
  let canMove = true;
  // Check collisions with trees, buildings, walls, and enemies
  for (const treeBox of treeBoxes) {
    if (newPlayerBox.intersectsBox(treeBox)) { canMove = false; break; }
  }
  if (canMove) {
    for (const buildingBox of buildingBoxes) {
      if (newPlayerBox.intersectsBox(buildingBox)) { canMove = false; break; }
    }
  }
  if (canMove) {
    for (const wallBox of wallBoxes) {
      if (newPlayerBox.intersectsBox(wallBox)) { canMove = false; break; }
    }
  }
  if (canMove) {
    for (const enemy of enemies) {
      const enemyBox = new THREE.Box3().setFromObject(enemy.mesh);
      if (newPlayerBox.intersectsBox(enemyBox)) {
        triggerGameOver("An enemy caught you.");
        return;
      }
    }
  }
  
  if (canMove) {
    player.position.add(moveVector);
    camera.position.set(player.position.x, player.position.y + 2, player.position.z);
  }
  
  // Jumping logic
  if (keys['Space'] && !isJumping && Math.abs(player.position.y - 1) < 0.01) {
    velocity.y = 0.5;
    isJumping = true;
  }
  velocity.y -= 0.02;
  player.position.y += velocity.y;
  if (player.position.y < 1) {
    player.position.y = 1;
    velocity.y = 0;
    isJumping = false;
  }
}

function updateBullets() {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const bullet = bullets[i];
    bullet.position.addScaledVector(bullet.userData.direction, bulletSpeed);
    if (bullet.position.distanceTo(camera.position) > 100) {
      scene.remove(bullet);
      bullets.splice(i, 1);
      returnBullet(bullet, false);
      continue;
    }
    // Check collision with enemies
    for (let j = enemies.length - 1; j >= 0; j--) {
      const enemy = enemies[j];
      const enemyBox = new THREE.Box3().setFromObject(enemy.mesh);
      if (enemyBox.containsPoint(bullet.position)) {
        enemy.life -= 1;
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
  // Restart game after a delay
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

// ---------------- Animation Loop ----------------
function animate() {
  requestAnimationFrame(animate);
  updateMovement();
  updateBullets();
  updateEnemyBullets();
  updateEnemies();
  renderer.render(scene, camera);
}

animate();

// ---------------- Resize Handling ----------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------- Shooting on Mouse Click ----------------
document.addEventListener('mousedown', (event) => {
  if (event.button === 0) {
    shootBullet();
  }
});
