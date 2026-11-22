// engine.js — Babylon bootstrap and the shared toolkit every other module
// builds on: seeded RNG, material + canvas-texture helpers, the collision
// world (axis-aligned AND rotated boxes in one spatial hash), and mesh
// "accumulators" that batch thousands of boxes/polygons into one mesh per
// material.
//
// Local frames: setXF(makeXF(cx, cz, yaw)) makes addBox/addSolid/addPoly take
// building-local coordinates (local +z = the building's back, -z = its street
// front) and emit rotated world geometry + rotated colliders.

export const V3 = BABYLON.Vector3;
export const C3 = BABYLON.Color3;
export const canvas = document.getElementById("renderCanvas");
export const engine = new BABYLON.Engine(canvas, true, { stencil: false });
export const scene = new BABYLON.Scene(engine);
scene.skipPointerMovePicking = true;

export const SKY = new C3(0.62, 0.78, 0.93);
export const NIGHT_SKY = new C3(0.035, 0.05, 0.1);
scene.clearColor = new BABYLON.Color4(SKY.r, SKY.g, SKY.b, 1);
scene.ambientColor = new C3(0.25, 0.25, 0.27);
scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
scene.fogColor = SKY.clone();
scene.fogStart = 320;
scene.fogEnd = 1400;

export const hemi = new BABYLON.HemisphericLight(
  "hemi",
  new V3(0.2, 1, 0.1),
  scene,
);
hemi.intensity = 0.78;
hemi.groundColor = new C3(0.5, 0.5, 0.53);
hemi.specular = new C3(0, 0, 0);

export const sun = new BABYLON.DirectionalLight(
  "sun",
  new V3(-0.45, -1, 0.35),
  scene,
);
sun.intensity = 0.5;
sun.specular = new C3(0.25, 0.25, 0.25);

export const camera = new BABYLON.FreeCamera("cam", new V3(0, 5, -10), scene);
camera.fov = 1.0;
camera.minZ = 0.12;
camera.maxZ = 3200;
camera.inputs.clear();

// Glow only for things that should bloom (lamps, car lights, signs, tracers).
export const glow = new BABYLON.GlowLayer("glow", scene, {
  mainTextureFixedSize: 512,
  blurKernelSize: 32,
});
glow.intensity = 0.35;

// Mutable cross-module state.
export const state = { night: false };

// ---------------------------------------------------------------- RNG + math
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rand = mulberry32(20261118);
export const rr = (a, b) => a + (b - a) * rand();
export const pick = (arr) => arr[Math.floor(rand() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const hex = (h) => C3.FromHexString(h);
export const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// ---------------------------------------------------------------- materials
export const flatMats = []; // unlit outdoor surfaces, dimmed at night
export const interiorMats = []; // indoor surfaces, "lamp-lit" at night

export function flatMat(name, color, nightK = 0.2) {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.disableLighting = true;
  m.emissiveColor = color;
  if (nightK !== 1) flatMats.push({ m, day: color.clone(), k: nightK });
  return m;
}
export function flatTexMat(name, tex, nightK = 0.2) {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.disableLighting = true;
  m.emissiveTexture = tex;
  flatMats.push({ m, tex, k: nightK });
  return m;
}
export function litMat(name, color, spec = 0.05) {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseColor = color;
  m.specularColor = new C3(spec, spec, spec);
  return m;
}
export function texMat(name, tex, spec = 0.04) {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseTexture = tex;
  m.specularColor = new C3(spec, spec, spec);
  return m;
}
export function indoor(m) {
  m.__dayEm = m.emissiveColor.clone();
  interiorMats.push(m);
  return m;
}
export function canvasTex(name, w, draw, mips = true, h = w) {
  const t = new BABYLON.DynamicTexture(
    name,
    { width: w, height: h },
    scene,
    mips,
  );
  draw(t.getContext(), w, h);
  t.update();
  t.wrapU = t.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  t.anisotropicFilteringLevel = 8;
  return t;
}
export function radialTex(name, stops, size = 128) {
  const t = canvasTex(
    name,
    size,
    (ctx, S) => {
      ctx.clearRect(0, 0, S, S);
      const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      for (const [o, c] of stops) g.addColorStop(o, c);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
    },
    false,
  );
  t.hasAlpha = true;
  t.wrapU = t.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
  return t;
}
export function emissiveTemplate(name, mesh, color) {
  const m = new BABYLON.StandardMaterial(name + "M", scene);
  m.disableLighting = true;
  m.emissiveColor = color;
  mesh.material = m;
  mesh.setEnabled(false);
  glow.addIncludedOnlyMesh(mesh);
  return mesh;
}
// Merge parts [{mesh, mat}] into one template mesh (one submesh per part).
export function mergedTemplate(name, parts, glowIt = false) {
  for (const p of parts) p.mesh.material = p.mat;
  const mesh = BABYLON.Mesh.MergeMeshes(
    parts.map((p) => p.mesh),
    true,
    true,
    undefined,
    false,
    true,
  );
  mesh.name = name;
  mesh.setEnabled(false);
  if (glowIt) glow.addIncludedOnlyMesh(mesh);
  return mesh;
}

// ---------------------------------------------------------------- local frames
export function makeXF(cx, cz, yaw) {
  return { cx, cz, yaw, c: Math.cos(yaw), s: Math.sin(yaw) };
}
let XF = null;
export function setXF(xf) {
  XF = xf;
}
export function clearXF() {
  XF = null;
}
export function currentXF() {
  return XF;
}
// local → world
export function xfp(xf, lx, lz) {
  return [xf.cx + lx * xf.c + lz * xf.s, xf.cz - lx * xf.s + lz * xf.c];
}
// world → local
export function xfl(xf, x, z) {
  const dx = x - xf.cx,
    dz = z - xf.cz;
  return [dx * xf.c - dz * xf.s, dx * xf.s + dz * xf.c];
}

// ---------------------------------------------------------------- collision world
// Solid: world AABB (for the hash) + local box (lx0..lz1) + optional rotation.
const GRID = 8;
const grid = new Map();
const gkey = (ix, iz) => (ix + 4000) * 16384 + (iz + 4000);
function insertSolid(s) {
  for (
    let ix = Math.floor(s.minX / GRID);
    ix <= Math.floor(s.maxX / GRID);
    ix++
  ) {
    for (
      let iz = Math.floor(s.minZ / GRID);
      iz <= Math.floor(s.maxZ / GRID);
      iz++
    ) {
      const k = gkey(ix, iz);
      let cell = grid.get(k);
      if (!cell) {
        cell = [];
        grid.set(k, cell);
      }
      cell.push(s);
    }
  }
}
// While a capture list is set, every new solid is also pushed onto it (used
// by interiors, which are built on demand and removed again on exit).
let capture = null;
export function captureSolids(list) {
  capture = list;
}
export function removeSolid(s) {
  for (let ix = Math.floor(s.minX / GRID); ix <= Math.floor(s.maxX / GRID); ix++) {
    for (let iz = Math.floor(s.minZ / GRID); iz <= Math.floor(s.maxZ / GRID); iz++) {
      const k = gkey(ix, iz), cell = grid.get(k);
      if (!cell) continue;
      const i = cell.indexOf(s);
      if (i >= 0) cell.splice(i, 1);
      if (!cell.length) grid.delete(k);
    }
  }
}
export function makeSolid(xf, x0, y0, z0, x1, y1, z1) {
  let minX, maxX, minZ, maxZ;
  if (!xf) {
    minX = x0;
    maxX = x1;
    minZ = z0;
    maxZ = z1;
  } else {
    minX = minZ = Infinity;
    maxX = maxZ = -Infinity;
    for (const [lx, lz] of [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ]) {
      const [wx, wz] = xfp(xf, lx, lz);
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wz < minZ) minZ = wz;
      if (wz > maxZ) maxZ = wz;
    }
  }
  const s = {
    minX,
    maxX,
    minY: y0,
    maxY: y1,
    minZ,
    maxZ,
    lx0: x0,
    lx1: x1,
    lz0: z0,
    lz1: z1,
    rot: xf,
    stamp: 0,
    off: false,
    vehicle: null,
  };
  insertSolid(s);
  if (capture) capture.push(s);
  return s;
}
export function addSolid(x0, y0, z0, x1, y1, z1) {
  return makeSolid(XF, x0, y0, z0, x1, y1, z1);
}
export function addSolidR(cx, cz, yaw, hw, hd, y0, y1) {
  return makeSolid(makeXF(cx, cz, yaw), -hw, y0, -hd, hw, y1, hd);
}

let stamp = 0;
const qbuf = [];
export function query(minX, maxX, minZ, maxZ) {
  stamp++;
  qbuf.length = 0;
  for (let ix = Math.floor(minX / GRID); ix <= Math.floor(maxX / GRID); ix++) {
    for (
      let iz = Math.floor(minZ / GRID);
      iz <= Math.floor(maxZ / GRID);
      iz++
    ) {
      const cell = grid.get(gkey(ix, iz));
      if (!cell) continue;
      for (const s of cell) {
        if (s.stamp === stamp) continue;
        s.stamp = stamp;
        if (!s.off) qbuf.push(s);
      }
    }
  }
  return qbuf;
}
export const L = { x: 0, z: 0 };
export function toLocal(s, x, z) {
  const r = s.rot;
  if (!r) {
    L.x = x;
    L.z = z;
    return L;
  }
  const dx = x - r.cx,
    dz = z - r.cz;
  L.x = dx * r.c - dz * r.s;
  L.z = dx * r.s + dz * r.c;
  return L;
}
export function circleHit(s, x, z, r) {
  toLocal(s, x, z);
  const cx = clamp(L.x, s.lx0, s.lx1),
    cz = clamp(L.z, s.lz0, s.lz1);
  return (L.x - cx) * (L.x - cx) + (L.z - cz) * (L.z - cz) < r * r;
}
// Push circle (p.x, p.z, r) out of solid s. Returns true if it moved.
export function pushOut(s, p, r) {
  toLocal(s, p.x, p.z);
  const lx = L.x,
    lz = L.z;
  if (lx < s.lx0 - r || lx > s.lx1 + r || lz < s.lz0 - r || lz > s.lz1 + r)
    return false;
  const cx = clamp(lx, s.lx0, s.lx1),
    cz = clamp(lz, s.lz0, s.lz1);
  const dx = lx - cx,
    dz = lz - cz;
  const d2 = dx * dx + dz * dz;
  let px = 0,
    pz = 0;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    if (d >= r) return false;
    px = (dx / d) * (r - d);
    pz = (dz / d) * (r - d);
  } else {
    const pushes = [
      s.lx0 - r - lx,
      s.lx1 + r - lx,
      s.lz0 - r - lz,
      s.lz1 + r - lz,
    ];
    let best = 0;
    for (let i = 1; i < 4; i++)
      if (Math.abs(pushes[i]) < Math.abs(pushes[best])) best = i;
    if (best < 2) px = pushes[best];
    else pz = pushes[best];
  }
  if (s.rot) {
    const q = s.rot;
    p.x += px * q.c + pz * q.s;
    p.z += -px * q.s + pz * q.c;
  } else {
    p.x += px;
    p.z += pz;
  }
  return true;
}
export function pointIn(s, x, y, z, m) {
  if (y < s.minY - m || y > s.maxY + m) return false;
  toLocal(s, x, z);
  return (
    L.x > s.lx0 - m && L.x < s.lx1 + m && L.z > s.lz0 - m && L.z < s.lz1 + m
  );
}
// Ray (o + d t) vs solid; returns entry t or null.
export function rayBox(o, d, s, tmin, tmax) {
  let ox = o.x,
    oz = o.z,
    dx = d.x,
    dz = d.z;
  if (s.rot) {
    const r = s.rot;
    const ax = ox - r.cx,
      az = oz - r.cz;
    ox = ax * r.c - az * r.s;
    oz = ax * r.s + az * r.c;
    const ndx = dx * r.c - dz * r.s,
      ndz = dx * r.s + dz * r.c;
    dx = ndx;
    dz = ndz;
  }
  let t0 = tmin,
    t1 = tmax;
  const axes = [
    [ox, dx, s.lx0, s.lx1],
    [o.y, d.y, s.minY, s.maxY],
    [oz, dz, s.lz0, s.lz1],
  ];
  for (const [oc, dc, lo, hi] of axes) {
    if (Math.abs(dc) < 1e-9) {
      if (oc < lo || oc > hi) return null;
      continue;
    }
    let a = (lo - oc) / dc,
      c = (hi - oc) / dc;
    if (a > c) {
      const tmp = a;
      a = c;
      c = tmp;
    }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return null;
  }
  return t0;
}
export function solidCenter(s) {
  const lx = (s.lx0 + s.lx1) / 2,
    lz = (s.lz0 + s.lz1) / 2;
  return s.rot ? xfp(s.rot, lx, lz) : [lx, lz];
}

// ---------------------------------------------------------------- mesh accumulators
const accs = [];
export function makeAcc(name, mat, tw = 1, th = 1) {
  mat.backFaceCulling = false;
  const a = {
    name,
    mat,
    tw,
    th,
    pos: [],
    nrm: [],
    uv: [],
    idx: [],
    mesh: null,
  };
  accs.push(a);
  return a;
}
function vert(acc, x, y, z, nx, ny, nz, u, v) {
  if (XF) {
    acc.pos.push(XF.cx + x * XF.c + z * XF.s, y, XF.cz - x * XF.s + z * XF.c);
    acc.nrm.push(nx * XF.c + nz * XF.s, ny, -nx * XF.s + nz * XF.c);
  } else {
    acc.pos.push(x, y, z);
    acc.nrm.push(nx, ny, nz);
  }
  acc.uv.push(u, v);
}
const ZERO = { x: 0, y: 0, z: 0 };
// Box in current frame. faceFn(dir, planeCoord) → acc | null, or a single acc.
// UVs are planar from the (local) origin o so window grids line up.
export function addBox(x0, y0, z0, x1, y1, z1, faceFn, o = ZERO) {
  const faces = [
    ["+x", x1, 1, 0, 0],
    ["-x", x0, -1, 0, 0],
    ["+y", y1, 0, 1, 0],
    ["-y", y0, 0, -1, 0],
    ["+z", z1, 0, 0, 1],
    ["-z", z0, 0, 0, -1],
  ];
  for (const [dir, c, nx, ny, nz] of faces) {
    const acc = typeof faceFn === "function" ? faceFn(dir, c) : faceFn;
    if (!acc) continue;
    let v;
    if (dir[1] === "x")
      v = [
        [c, y0, z0],
        [c, y1, z0],
        [c, y1, z1],
        [c, y0, z1],
      ];
    else if (dir[1] === "y")
      v = [
        [x0, c, z0],
        [x1, c, z0],
        [x1, c, z1],
        [x0, c, z1],
      ];
    else
      v = [
        [x0, y0, c],
        [x1, y0, c],
        [x1, y1, c],
        [x0, y1, c],
      ];
    const base = acc.pos.length / 3;
    for (const p of v) {
      let u, w;
      if (dir[1] === "x") {
        u = (p[2] - o.z) / acc.tw;
        w = (p[1] - o.y) / acc.th;
      } else if (dir[1] === "y") {
        u = (p[0] - o.x) / acc.tw;
        w = (p[2] - o.z) / acc.th;
      } else {
        u = (p[0] - o.x) / acc.tw;
        w = (p[1] - o.y) / acc.th;
      }
      vert(acc, p[0], p[1], p[2], nx, ny, nz, u, w);
    }
    acc.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}
export function solidBox(x0, y0, z0, x1, y1, z1, faceFn, o) {
  addBox(x0, y0, z0, x1, y1, z1, faceFn, o);
  return addSolid(x0, y0, z0, x1, y1, z1);
}
// Convex polygon (pts in current frame). The normal is oriented away from
// `ref` (a point inside the solid). uvFn(p) → [u, v].
export function addPoly(acc, pts, ref, uvFn) {
  const [p0, p1, p2] = pts;
  const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  let nx = e1[1] * e2[2] - e1[2] * e2[1],
    ny = e1[2] * e2[0] - e1[0] * e2[2],
    nz = e1[0] * e2[1] - e1[1] * e2[0];
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  if (
    nx * (p0[0] - ref[0]) + ny * (p0[1] - ref[1]) + nz * (p0[2] - ref[2]) <
    0
  ) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const base = acc.pos.length / 3;
  for (const p of pts) {
    const [u, v] = uvFn(p);
    vert(acc, p[0], p[1], p[2], nx, ny, nz, u, v);
  }
  for (let i = 1; i < pts.length - 1; i++)
    acc.idx.push(base, base + i, base + i + 1);
}
// Flat world-space quad (no frame), used for road ribbons.
export function addFlatQuad(acc, a, b, c, d, y, uvs) {
  const base = acc.pos.length / 3;
  for (let i = 0; i < 4; i++) {
    const p = [a, b, c, d][i];
    acc.pos.push(p[0], y, p[1]);
    acc.nrm.push(0, 1, 0);
    acc.uv.push(uvs[i][0], uvs[i][1]);
  }
  acc.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
export function flushAccs() {
  for (const a of accs) {
    if (a.mesh || !a.pos.length) continue;
    const mesh = new BABYLON.Mesh(a.name, scene);
    const vd = new BABYLON.VertexData();
    vd.positions = a.pos;
    vd.normals = a.nrm;
    vd.uvs = a.uv;
    vd.indices = a.idx;
    vd.applyToMesh(mesh);
    mesh.material = a.mat;
    mesh.freezeWorldMatrix();
    mesh.isPickable = false;
    a.mesh = mesh;
    a.pos = a.nrm = a.uv = a.idx = null; // free the JS arrays
  }
}
