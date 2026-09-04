// props.js
// Street furniture and nature: trees (instanced), benches, lamp posts (with
// night-mode point lights), flower beds, hedges, fire hydrants, ponds and
// fountains — plus the per-frame environment animation (ripples + jets).

import * as THREE from "three";
import { state } from "./state.js";
import {
  addFrozenStatic,
  addIndexedBox,
  wallIndex,
  isStaticPlacementClear,
  isAreaClear,
  findClearSpot,
} from "./placement.js";
import { getGroundHeight } from "./terrain.js";

// ---------------- Trees (instanced) ----------------
const sharedTrunkGeometry = new THREE.CylinderGeometry(0.5, 0.5, 5);
const sharedTrunkMaterial = new THREE.MeshPhongMaterial({ color: 0x8b4513 });
const sharedFoliageGeometry = new THREE.SphereGeometry(3, 10, 10);
const sharedFoliageMaterial = new THREE.MeshPhongMaterial({ color: 0x228b22 });

function buildTreeChunk(positions) {
  const count = positions.length;
  if (!count) return;

  const trunks = new THREE.InstancedMesh(
    sharedTrunkGeometry,
    sharedTrunkMaterial,
    count,
  );
  const foliage = new THREE.InstancedMesh(
    sharedFoliageGeometry,
    sharedFoliageMaterial,
    count,
  );
  trunks.castShadow = false;
  trunks.receiveShadow = false;
  foliage.castShadow = false;
  foliage.receiveShadow = false;

  const box = new THREE.Box3();
  for (let i = 0; i < count; i++) {
    const { x, z } = positions[i];
    trunks.setMatrixAt(i, _tmpMatrix.makeTranslation(x, 2.5, z));
    foliage.setMatrixAt(i, _tmpMatrix.makeTranslation(x, 6, z));

    box.expandByPoint(_tmpVec.set(x - 3, 0, z - 3));
    box.expandByPoint(_tmpVec.set(x + 3, 9, z + 3));
  }

  trunks.instanceMatrix.needsUpdate = true;
  foliage.instanceMatrix.needsUpdate = true;
  trunks.boundingSphere = new THREE.Sphere();
  foliage.boundingSphere = new THREE.Sphere();
  box.getBoundingSphere(trunks.boundingSphere);
  box.getBoundingSphere(foliage.boundingSphere);
  trunks.frustumCulled = true;
  foliage.frustumCulled = true;
  addFrozenStatic(trunks);
  addFrozenStatic(foliage);
}

const _tmpMatrix = new THREE.Matrix4();
const _tmpVec = new THREE.Vector3();

export function buildTreeInstances(positions) {
  const count = positions.length;
  if (count === 0) return;

  // Small sets are kept as a single pair of instanced meshes (lowest draw-call
  // count). Larger sets are split spatially so distant trees can be frustum
  // culled at chunk granularity instead of keeping the entire forest visible.
  const TREE_CHUNK_SIZE = 96;
  const CHUNK_THRESHOLD = 700;
  if (count <= CHUNK_THRESHOLD) {
    buildTreeChunk(positions);
    return;
  }

  const chunks = new Map();
  for (const p of positions) {
    const cx = Math.floor(p.x / TREE_CHUNK_SIZE);
    const cz = Math.floor(p.z / TREE_CHUNK_SIZE);
    const key = `${cx}:${cz}`;
    let chunk = chunks.get(key);
    if (!chunk) {
      chunk = [];
      chunks.set(key, chunk);
    }
    chunk.push(p);
  }

  for (const chunk of chunks.values()) buildTreeChunk(chunk);
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
  addFrozenStatic(mesh);
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
  addFrozenStatic(mesh);
}

export function createPond(x, z, radiusX, radiusZ, rand) {
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
  addFrozenStatic(mesh);
  const base = new Float32Array(geo.attributes.position.count * 2);
  const pondPos = geo.attributes.position;
  for (let i = 0; i < pondPos.count; i++) {
    base[i * 2] = pondPos.getX(i);
    base[i * 2 + 1] = pondPos.getY(i);
  }
  ripplePonds.push({ geo, seed: rand() * 100, base });

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
  addIndexedBox(
    state.wallBoxes,
    wallIndex,
    new THREE.Box3(
      new THREE.Vector3(x - radiusX, 0, z - radiusZ),
      new THREE.Vector3(x + radiusX, 1.2, z + radiusZ),
    ),
  );
}

// ── Fountains — tiered basin + a looping ring of falling water droplets ───
const fountainJets = []; // { center, particles: [{mesh, phase, angle}] }

export function createFountain(x, z, rand) {
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
    addFrozenStatic(mesh);
  }

  const waterMesh = new THREE.Mesh(new THREE.CircleGeometry(2.9, 20), waterMat);
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.position.set(x, baseY + 0.5, z);
  addFrozenStatic(waterMesh);

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

  addIndexedBox(
    state.wallBoxes,
    wallIndex,
    new THREE.Box3(
      new THREE.Vector3(x - 3.4, 0, z - 3.4),
      new THREE.Vector3(x + 3.4, 2, z + 3.4),
    ),
  );
}

// ── Benches — 5 boxes: two end supports, a seat, a backrest, a stretcher ──
export function createBench(x, z, yaw, rand) {
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
  addFrozenStatic(group);
}

// ── Lamp posts — pole + arm + emissive bulb, lining the major roads ───────
let lampLightCounter = 0;

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
  addFrozenStatic(group);

  // A subset of posts also carry a real point light (toggled by night mode).
  lampLightCounter++;
  if (lampLightCounter % 4 === 0) {
    const light = new THREE.PointLight(0xffc37a, 0, 40, 1.5);
    light.position.set(x, getGroundHeight(x, z) + 5, z);
    state.scene.add(light);
    state.streetLights.push(light);
  }
}

export function placeLampPosts(verticals, horizontals) {
  const spacing = 70;
  const range = 360; // CITY_RADIUS - 10
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
export function createFlowerBed(x, z, rand) {
  const colors = [0xd6336c, 0xf4d03f, 0xff6f61, 0xffffff, 0xba55d3];
  const w = 1.2 + rand() * 0.8;
  const d = 1.2 + rand() * 0.8;
  const soilMat = new THREE.MeshLambertMaterial({ color: 0x3d2b1f });
  const soil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), soilMat);
  soil.rotation.x = -Math.PI / 2;
  soil.position.set(x, getGroundHeight(x, z) + 0.02, z);
  soil.receiveShadow = false;
  addFrozenStatic(soil);

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
    addFrozenStatic(patch);
  }
}

// ── Hedges — a short run of flat-shaded low-poly icosahedron "bushes" ─────
export function createHedge(x, z, yaw, length, rand) {
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
  addFrozenStatic(group);
}

// ── Fire hydrants — sidewalk corners ───────────────────────────────────────
export function createFireHydrant(x, z) {
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
  addFrozenStatic(group);
}

// Keeps the placement-clearance helpers importable from a single props module.
export { isStaticPlacementClear, isAreaClear, findClearSpot };

// ---------------- Environment animation ----------------
let environmentTime = 0;

// Animates pond ripples and fountain jets — call once per frame.
export function updateEnvironment(dt) {
  environmentTime += dt / 60;

  for (const p of ripplePonds) {
    const pos = p.geo.attributes.position;
    const base = p.base;
    for (let i = 0; i < pos.count; i++) {
      const lx = base[i * 2];
      const ly = base[i * 2 + 1];
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

export function resetPropCollections() {
  ripplePonds.length = 0;
  fountainJets.length = 0;
  environmentTime = 0;
  lampLightCounter = 0;
}
