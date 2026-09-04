// roads.js
// The road network: arterial/secondary/local streets, displaced asphalt
// surfaces that follow the terrain, lane markings, crosswalks, and the
// circular ring-road highway around the world.

import * as THREE from "three";
import { state } from "./state.js";
import { addFrozenStatic } from "./placement.js";
import { RING_INNER, RING_OUTER, getGroundHeight } from "./terrain.js";

const sharedRoadMaterial = new THREE.MeshPhongMaterial({
  color: 0x2c2f33,
  shininess: 5,
});
const sharedLineMaterials = new Map();

function getLineMaterial(color) {
  let material = sharedLineMaterials.get(color);
  if (!material) {
    material = new THREE.MeshBasicMaterial({ color });
    sharedLineMaterials.set(color, material);
  }
  return material;
}

// ---------------- Road network ----------------
export function buildRoadNetwork() {
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

// ---------------- Visual meshes ----------------
// A plane laid flat in the XZ plane whose vertices follow the terrain height
// (plus a small offset to avoid z-fighting). Used for roads, lane markings
// and the ring road.
export function addDisplacedPlane(
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
  addFrozenStatic(mesh);
  return mesh;
}

export function addRoadSurface(road) {
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
    sharedRoadMaterial,
    segX,
    segZ,
  );
}

export function addCenterLine(road, color, yOffset) {
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
    getLineMaterial(color),
    segX,
    segZ,
  );
}

// Circular ring-road highway around the whole world, following the hills.
export function addRingRoad() {
  const geo = new THREE.RingGeometry(RING_INNER, RING_OUTER, 360, 16);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const ly = pos.getY(i);
    pos.setZ(i, getGroundHeight(lx, -ly) + 0.02);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, sharedRoadMaterial);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = false;
  addFrozenStatic(mesh);

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
  const lineMesh = new THREE.Mesh(lineGeo, getLineMaterial(0xffd75e));
  lineMesh.rotation.x = -Math.PI / 2;
  addFrozenStatic(lineMesh);
}

// ---------------- Crosswalks & stop lines ----------------
const roadMarkingMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });

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
