// swayambhu.js — Swayambhu: the great stupa on its forested hill, north of
// Kathmandu.
//
//   • The hill (terrain.js, SWAY) rises ~95 m above the ridge, 400 m across,
//     covered in forest, with a wall round its foot and ONE gate (town side).
//   • From the gate, stone stairways zig-zag up the south and west faces — a
//     maze of flights, landings and junctions. Only one way reaches the
//     summit; the other branches wander off and end at a wall (one gets
//     almost to the top). On the stairs you're safe. The forest between them
//     is the dangerous way (wildlife.js).
//   • On the flat summit: the white dome with its golden spire (thirteen
//     rings, the eyes on the harmika), two white shikhara towers, red brick
//     monastery buildings, little chaityas, a parapet, and prayer flags
//     strung from the spire out to the edge.
// Built during the world build (static meshes / thin-instanced trees).
import {
  scene, hex, litMat, texMat, canvasTex, makeAcc, addBox, solidBox, addSolid, setXF, clearXF, makeXF, landH,
  SWAY, SWAY_ROUTES, SWAY_SEGS, swayPath,
} from "./engine.js";
import { noiseTex, slabTex } from "./textures.js";
import { addTree } from "./nature.js";

const MB = BABYLON.MeshBuilder;
// own random numbers (the world's seeded ones lay out the city)
let seed = 9071;
const R = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

export const GATE = { x: SWAY.x, z: SWAY.z - SWAY.RW, hw: 6 };
// stood on a stairway (or its walls)? in the courtyard inside the gate?
export const onStairs = (x, z) => { const p = swayPath(x, z); return !!p && p.d < SWAY.hw + 0.9; };
export const inCourtyard = (x, z) => Math.abs(x - GATE.x) < 9 && z < GATE.z + 15;
export const swayR = (x, z) => Math.hypot(x - SWAY.x, z - SWAY.z);
const stairHW = () => SWAY.hw;

let TOP = 0;      // summit height
export function buildSwayambhu() {
  TOP = landH(SWAY.x, SWAY.z);
  forestFloor();
  wallAndGate();
  stairways();
  forest();
  summit();
  const ring = (x, z, r) => Array.from({ length: 40 }, (_, i) => [x + Math.sin((i / 40) * Math.PI * 2) * r, z + Math.cos((i / 40) * Math.PI * 2) * r]);
  const map = [
    { pts: ring(SWAY.x, SWAY.z, SWAY.RW), color: "#26391f" },
    { pts: ring(SWAY.x, SWAY.z, SWAY.R0), color: "#6d675d" },
  ];
  // the stairways as thin strips on the map
  for (const s of SWAY_SEGS) {
    const nx = -s.uz * 2.2, nz = s.ux * 2.2;
    map.push({ pts: [[s.ax + nx, s.az + nz], [s.bx + nx, s.bz + nz], [s.bx - nx, s.bz - nz], [s.ax - nx, s.az - nz]], color: "#9a9488" });
  }
  map.push({ pts: ring(SWAY.x, SWAY.z + 2, 10), color: "#ece6d8" });
  return { map };
}

// ---------------------------------------------------------------- the ground
// A dark leaf-litter skin over the whole hill (lit, with real slope normals,
// so the hill has a sunny side and a shade side). Under the stairways it
// tucks down out of sight.
function forestFloor() {
  const tex = noiseTex("swayFloorT", "#3f4a2c", 7000, "120,110,70", "20,26,14", 256, [1, 4]);
  const m = texMat("swayFloorM", tex, 0);
  m.zOffset = -1.5;
  const r0 = SWAY.R0 - 1, r1 = SWAY.RW + 3, RINGS = 92, SEG = 240;
  const pos = [], nrm = [], uv = [], idx = [];
  const n = (x, z) => {
    const e = 1, dx = (landH(x + e, z) - landH(x - e, z)) / (2 * e), dz = (landH(x, z + e) - landH(x, z - e)) / (2 * e);
    const l = Math.hypot(dx, 1, dz);
    return [-dx / l, 1 / l, -dz / l];
  };
  for (let i = 0; i <= RINGS; i++) {
    const r = r0 + (r1 - r0) * (i / RINGS);
    for (let j = 0; j <= SEG; j++) {
      const a = (j / SEG) * Math.PI * 2, x = SWAY.x + Math.sin(a) * r, z = SWAY.z + Math.cos(a) * r;
      const p = swayPath(x, z), under = p && p.d < stairHW() + 1.5;
      pos.push(x, landH(x, z) + (under ? -0.2 : 0.06), z);
      nrm.push(...n(x, z));
      uv.push(x / 7, z / 7);
    }
  }
  for (let i = 0; i < RINGS; i++) for (let j = 0; j < SEG; j++) {
    const a = i * (SEG + 1) + j, b = a + SEG + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const mesh = new BABYLON.Mesh("swayFloor", scene);
  const vd = new BABYLON.VertexData();
  vd.positions = pos; vd.normals = nrm; vd.uvs = uv; vd.indices = idx;
  vd.applyToMesh(mesh);
  mesh.material = m;
  m.backFaceCulling = false;
  mesh.freezeWorldMatrix(); mesh.isPickable = false;
  // the summit paving
  const top = MB.CreateDisc("swaySummit", { radius: SWAY.R0 + 0.5, tessellation: 64 }, scene);
  top.rotation.x = Math.PI / 2; top.position.set(SWAY.x, TOP + 0.08, SWAY.z);
  const tm = texMat("swaySummitM", slabTex("swaySummitT", "#b3ab9c", "rgba(80,74,66,0.4)", 6), 0.02);
  tm.diffuseTexture.uScale = tm.diffuseTexture.vScale = 14; tm.zOffset = -2;
  top.material = tm; top.freezeWorldMatrix(); top.isPickable = false;
  // the courtyard inside the gate and a path down to the town's edge
  const slab = slabTex("swayPaveT", "#a49d90", "rgba(70,66,60,0.45)", 4);
  const pave = makeAcc("swayPave", texMat("swayPaveM", slab, 0.02), 3, 3);
  pave.mat.zOffset = -2;
  const start = SWAY_ROUTES[0].pts[0];
  for (let z = GATE.z - 30; z < start.z + 1; z += 1.5) {
    const hw = z > GATE.z - 1 ? 7 : 3;
    const h0 = landH(GATE.x, z), h1 = landH(GATE.x, z + 1.5);
    addBox(GATE.x - hw, Math.min(h0, h1) - 0.3, z, GATE.x + hw, Math.max(h0, h1) + 0.07, z + 1.5, (d) => (d === "+y" ? pave : null), { x: 0, y: 0, z: 0 });
  }
}

// ---------------------------------------------------------------- the wall + gate
function wallAndGate() {
  const wt = noiseTex("swayWallT", "#cfc7b6", 4000, "240,235,220", "110,100,85", 256, [1, 3]);
  const wall = makeAcc("swayWall", texMat("swayWallM", wt, 0.02), 4, 4);
  const cap = makeAcc("swayWallCap", litMat("swayWallCapM", hex("#7a3a2a"), 0.05));
  const red = makeAcc("swayRed", litMat("swayRedM", hex("#8e2f24"), 0.05));
  const gold = makeAcc("swayGold", litMat("swayGoldM", hex("#c9972e"), 0.5));
  const roof = makeAcc("swayRoof", litMat("swayRoofM", hex("#3a3330"), 0.05));
  const RW = SWAY.RW, SEGL = 5;
  const n = Math.ceil((Math.PI * 2 * RW) / SEGL);
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    // the gate: a gap facing the town (due south, a = π)
    const off = Math.abs(Math.atan2(Math.sin(am - Math.PI), Math.cos(am - Math.PI))) * RW;
    if (off < GATE.hw + 1) continue;
    const x0 = SWAY.x + Math.sin(a0) * RW, z0 = SWAY.z + Math.cos(a0) * RW, x1 = SWAY.x + Math.sin(a1) * RW, z1 = SWAY.z + Math.cos(a1) * RW;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, len = Math.hypot(x1 - x0, z1 - z0) + 0.4;
    const g0 = Math.min(landH(x0, z0), landH(x1, z1)), g1 = Math.max(landH(x0, z0), landH(x1, z1));
    setXF(makeXF(cx, cz, Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2));
    solidBox(-len / 2, g0 - 1.5, -0.35, len / 2, g1 + 3.4, 0.35, wall);
    addBox(-len / 2 - 0.02, g1 + 3.4, -0.45, len / 2 + 0.02, g1 + 3.65, 0.45, cap);
    clearXF();
  }
  // the gate: two red-and-white pillars, a carved lintel, a little pagoda roof
  const gy = landH(GATE.x, GATE.z);
  for (const s of [-1, 1]) {
    const x = GATE.x + s * (GATE.hw + 0.7);
    solidBox(x - 0.8, gy - 1, GATE.z - 0.8, x + 0.8, gy + 6, GATE.z + 0.8, wall);
    addBox(x - 0.85, gy + 0.2, GATE.z - 0.85, x + 0.85, gy + 1.0, GATE.z + 0.85, red);
    addBox(x - 0.85, gy + 5.4, GATE.z - 0.85, x + 0.85, gy + 6.0, GATE.z + 0.85, red);
  }
  addBox(GATE.x - GATE.hw - 1.6, gy + 6, GATE.z - 1.0, GATE.x + GATE.hw + 1.6, gy + 7.0, GATE.z + 1.0, red);
  addBox(GATE.x - GATE.hw - 1.6, gy + 6.25, GATE.z - 1.05, GATE.x + GATE.hw + 1.6, gy + 6.55, GATE.z + 1.05, gold);
  addBox(GATE.x - GATE.hw - 2.4, gy + 7.0, GATE.z - 1.8, GATE.x + GATE.hw + 2.4, gy + 7.4, GATE.z + 1.8, roof);
  addBox(GATE.x - GATE.hw - 1.2, gy + 7.4, GATE.z - 1.2, GATE.x + GATE.hw + 1.2, gy + 8.0, GATE.z + 1.2, roof);
  addBox(GATE.x - 0.25, gy + 8.0, GATE.z - 0.25, GATE.x + 0.25, gy + 9.2, GATE.z + 0.25, gold);
}

// ---------------------------------------------------------------- the stairways
// Each flight: low even steps (no more than 20 cm, so going up them looks and
// feels like walking), walled on both sides; a landing at every turn and
// junction (the walls open there: the branches lead off, and you can also
// step out into the trees). Every branch that is not the way up ends at a
// wall with a little shrine.
function stairways() {
  const st = slabTex("swayStepT", "#9a948a", "rgba(60,56,50,0.5)", 2);
  const step = makeAcc("swayStep", texMat("swayStepM", st, 0.02), 2.5, 2.5);
  const side = makeAcc("swaySide", texMat("swaySideM", noiseTex("swaySideT", "#8b857a", 3000, "200,195,180", "60,55,48", 128, [1, 3]), 0.02), 2, 2);
  const capA = makeAcc("swaySideCap", litMat("swaySideCapM", hex("#6f6a61"), 0.04));
  const flagCols = ["#2f5fb3", "#f2f0ea", "#c0392b", "#2e8b4a", "#e3b52a"];
  const flags = flagCols.map((c, i) => makeAcc("swayFlag" + i, litMat("swayFlagM" + i, hex(c), 0.02)));
  const white = makeAcc("swayShrine", litMat("swayShrineM", hex("#ece6d8"), 0.05));
  const gold = makeAcc("swayShrineGold", litMat("swayShrineGoldM", hex("#c9972e"), 0.5));
  const hw = stairHW(), OPEN = hw + 1.4;
  for (const s of SWAY_SEGS) {
    const yaw = Math.atan2(s.ux, s.uz);
    setXF(makeXF(s.ax, s.az, yaw));
    let sp = 0, hp = s.ah, lastFlag = 0;
    for (let d = 0.05; d <= s.len + 0.001; d += 0.05) {
      const h = s.ah + (s.bh - s.ah) * (d / s.len);
      const end = d + 0.05 > s.len;
      if (Math.abs(h - hp) < 0.2 && d - sp < 2.2 && !end) continue;
      const top = Math.max(h, hp), lo = Math.min(h, hp);
      // one step: you stand on it, but never bump into it
      solidBox(-hw, lo - 1.6, sp, hw, top, d, step).walkOver = true;
      // walls either side (open near the landings)
      if (sp > OPEN && d < s.len - OPEN) {
        solidBox(hw, lo - 1.8, sp, hw + 0.5, top + 1.0, d, side);
        solidBox(-hw - 0.5, lo - 1.8, sp, -hw, top + 1.0, d, side);
        addBox(hw - 0.04, top + 1.0, sp, hw + 0.54, top + 1.12, d, capA);
        addBox(-hw - 0.54, top + 1.0, sp, -hw + 0.04, top + 1.12, d, capA);
      }
      // prayer flags across the stairs every ~12 m
      if (d - lastFlag > 12 && d < s.len - 4) {
        lastFlag = d;
        for (let k = 0; k <= 12; k++) {
          const t = k / 12, fx = -hw - 0.3 + (hw * 2 + 0.6) * t, fy = top + 3.4 - Math.sin(t * Math.PI) * 0.6;
          addBox(fx - 0.17, fy - 0.3, d - 0.01, fx + 0.17, fy, d + 0.01, flags[k % 5]);
        }
      }
      sp = d; hp = h;
    }
    clearXF();
  }
  // a flat landing at every turn and junction
  for (const r of SWAY_ROUTES) {
    r.pts.forEach((p, i) => {
      if (Math.hypot(p.x - SWAY.x, p.z - SWAY.z) < SWAY.R0 + 0.5) return;           // (the summit itself)
      solidBox(p.x - hw - 0.6, p.h - 1.8, p.z - hw - 0.6, p.x + hw + 0.6, p.h, p.z + hw + 0.6, step).walkOver = true;
      // a dead end: a wall across, and a little shrine before it
      if (r.name !== "main" && i === r.pts.length - 1) {
        const prev = r.pts[i - 1], ux = (p.x - prev.x), uz = (p.z - prev.z), l = Math.hypot(ux, uz) || 1;
        const yaw = Math.atan2(ux / l, uz / l);
        setXF(makeXF(p.x, p.z, yaw));
        solidBox(-hw - 0.6, p.h - 1, hw + 0.6, hw + 0.6, p.h + 1.6, hw + 1.2, side);
        solidBox(-0.7, p.h, hw - 1.0, 0.7, p.h + 0.7, hw + 0.4, white);
        addBox(-0.45, p.h + 0.7, hw - 0.75, 0.45, p.h + 1.35, hw + 0.15, white);
        addBox(-0.18, p.h + 1.35, hw - 0.48, 0.18, p.h + 2.0, hw - 0.12, gold);
        clearXF();
      }
    });
  }
}

// ---------------------------------------------------------------- the forest
// A big, dense forest: every bit of the hill that is not stairway or summit.
function forest() {
  const SP = 9.4;                     // (bigger trees, a little further apart: as dense, far fewer to draw)
  const kinds = ["pine", "pine", "oak", "pine", "plane", "oak", "pine"];
  for (let gx = SWAY.x - SWAY.RW; gx <= SWAY.x + SWAY.RW; gx += SP) {
    for (let gz = SWAY.z - SWAY.RW; gz <= SWAY.z + SWAY.RW; gz += SP) {
      const x = gx + (R() - 0.5) * SP * 0.85, z = gz + (R() - 0.5) * SP * 0.85;
      const r = Math.hypot(x - SWAY.x, z - SWAY.z);
      if (r < SWAY.R0 + 4 || r > SWAY.RW - 2) continue;
      if (inCourtyard(x, z)) continue;
      const p = swayPath(x, z);
      if (p && p.d < stairHW() + 3.2) continue;                     // keep the stairways clear
      addTree(x, z, kinds[Math.floor(R() * kinds.length)], 1.6 + R() * 1.0);
    }
  }
}

// ---------------------------------------------------------------- the summit
// The stupa, towers and buildings are made from primitives and merged per
// material: a handful of draw calls for the whole summit.
function summit() {
  const T = TOP;
  const last = SWAY_ROUTES[0].pts[SWAY_ROUTES[0].pts.length - 1];
  const ARR = Math.atan2(last.x - SWAY.x, last.z - SWAY.z);          // compass angle of the stair head
  const offArr = (a) => Math.abs(Math.atan2(Math.sin(a - ARR), Math.cos(a - ARR)));
  const parts = {};
  const P = (key, mesh) => { (parts[key] ||= []).push(mesh); return mesh; };
  // the stupa is built at its old size, then scaled up (SK) about its base;
  // everything else on the summit spreads out with the bigger summit (PK)
  const SK = 1.45, PK = SWAY.R0 / 32;
  let LK = 1;
  const at = (lx, lz) => [SWAY.x + lx * LK, SWAY.z + lz * LK];
  const cyl = (key, dt, db, h, lx, y, lz, tess = 32) => { const [x, z] = at(lx, lz); const m = MB.CreateCylinder("c", { diameterTop: dt, diameterBottom: db, height: h, tessellation: tess }, scene); m.position.set(x, y + h / 2, z); return P(key, m); };
  const box = (key, w, h, d, lx, y, lz) => { const [x, z] = at(lx, lz); const m = MB.CreateBox("b", { width: w, height: h, depth: d }, scene); m.position.set(x, y + h / 2, z); return P(key, m); };
  const SX = 0, SZ = 2;                               // the stupa sits a little north of centre
  // plinth tiers and the great dome
  cyl("sWhite", 23.4, 23.8, 0.9, SX, T, SZ, 48);
  cyl("sWhite", 21.6, 22, 0.9, SX, T + 0.9, SZ, 48);
  cyl("sRed", 21.7, 21.7, 0.18, SX, T + 1.55, SZ, 48);
  {
    const [x, z] = at(SX, SZ);
    const d = MB.CreateSphere("dome", { diameter: 19.4, segments: 28, slice: 0.5 }, scene);
    d.position.set(x, T + 1.8, z); d.scaling.y = 0.86;
    P("sWhite", d);
  }
  const DT = T + 1.8 + 9.7 * 0.86;                      // top of the dome
  // four small golden shrines on the dome's foot (N, E, S, W)
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2, lx = SX + Math.sin(a) * 10.2, lz = SZ + Math.cos(a) * 10.2;
    const s = box("sGold", 1.8, 2.4, 1.8, lx, T + 1.8, lz);
    s.rotation.y = a;
    const roofS = cyl("sGold", 0.2, 2.2, 1.0, lx, T + 4.2, lz, 4);
    roofS.rotation.y = a + Math.PI / 4;
  }
  // harmika (the eyes), then thirteen golden rings, canopy, finial
  cyl("sGold", 5.6, 6.0, 0.5, SX, DT - 0.2, SZ, 4).rotation.y = Math.PI / 4;
  const harmika = (() => {
    const [x, z] = at(SX, SZ);
    const m = MB.CreateBox("harmika", { width: 4.6, height: 3.0, depth: 4.6 }, scene);
    m.position.set(x, DT + 0.3 + 1.5, z);
    return m;
  })();
  cyl("sGold", 5.4, 5.2, 0.45, SX, DT + 3.3, SZ, 4).rotation.y = Math.PI / 4;
  let y = DT + 3.75;
  for (let i = 0; i < 13; i++) {
    const r = 2.5 - i * 0.13;
    cyl("sGold", r * 2, r * 2 + 0.1, 0.38, SX, y, SZ, 24);
    cyl("sGoldDark", r * 1.8, r * 1.8, 0.14, SX, y + 0.38, SZ, 24);
    y += 0.52;
  }
  cyl("sGold", 0.7, 3.6, 1.3, SX, y, SZ, 24);               // the canopy
  cyl("sGold", 0.35, 0.5, 1.2, SX, y + 1.3, SZ, 12);
  {
    const [x, z] = at(SX, SZ);
    const b = MB.CreateSphere("finial", { diameter: 0.9, segments: 10 }, scene); b.position.set(x, y + 2.8, z); P("sGold", b);
  }
  cyl("sGold", 0, 0.45, 1.4, SX, y + 3.1, SZ, 10);
  const spireTop = T + (y + 4.4 - T) * SK;
  LK = PK;
  // two white shikhara towers, banded red, golden tops
  for (const [lx, lz] of [[-15, 13], [14, 15]]) {
    box("white", 4.8, 2.4, 4.8, lx, T, lz);
    let w = 4.2, yy = T + 2.4;
    for (let k = 0; k < 4; k++) {
      box("white", w, 1.9, w, lx, yy, lz);
      box("red", w + 0.1, 0.22, w + 0.1, lx, yy + 1.55, lz);
      yy += 1.9; w -= 0.55;
    }
    cyl("white", 0.8, w * 1.2, 3.6, lx, yy, lz, 16);
    cyl("gold", 0, 0.9, 1.6, lx, yy + 3.6, lz, 12);
    const [x, z] = at(lx, lz);
    addSolid(x - 2.4, T, z - 2.4, x + 2.4, yy + 4, z + 2.4);
  }
  // red brick monastery buildings round the edge, dark tile roofs
  for (const [lx, lz, w, d, h] of [[-19, -7, 8, 10, 5.6], [20, -5, 9, 8, 5], [3, 22, 13, 6, 6.2], [-20, 6, 6, 7, 4.6]]) {
    box("brick", w, h, d, lx, T, lz);
    box("roof", w + 1.0, 0.5, d + 1.0, lx, T + h, lz);
    box("roof", w * 0.6, 0.7, d * 0.6, lx, T + h + 0.5, lz);
    box("white", w + 0.05, 0.3, d + 0.05, lx, T + 0.6, lz);
    // a row of dark windows on the long sides
    for (let k = -1; k <= 1; k++) {
      box("dark", 0.9, 1.2, d + 0.06, lx + k * w * 0.28, T + h * 0.5, lz);
    }
    const [x, z] = at(lx, lz);
    addSolid(x - w / 2, T, z - d / 2, x + w / 2, T + h + 1, z + d / 2);
  }
  // little white chaityas
  for (const [lx, lz] of [[-8, -15], [-2, -21], [-17, -2], [15, 6], [-6, 17], [-11, -22]]) {
    cyl("white", 1.6, 1.8, 0.8, lx, T, lz, 16);
    const [x, z] = at(lx, lz);
    const h = MB.CreateSphere("ch", { diameter: 1.5, segments: 10, slice: 0.5 }, scene); h.position.set(x, T + 0.8, z); P("white", h);
    box("gold", 0.5, 0.4, 0.5, lx, T + 1.5, lz);
    cyl("gold", 0, 0.45, 1.1, lx, T + 1.9, lz, 8);
    addSolid(x - 0.9, T, z - 0.9, x + 0.9, T + 2.2, z + 0.9);
  }
  // the dome is solid (an octagon of two boxes)
  {
    const x = SWAY.x + SX, z = SWAY.z + SZ;
    for (const yaw of [0, Math.PI / 4]) {
      setXF(makeXF(x, z, yaw));
      addSolid(-11.4 * SK, T, -11.4 * SK, 11.4 * SK, T + 2.0 * SK, 11.4 * SK);
      addSolid(-8.6 * SK, T, -8.6 * SK, 8.6 * SK, T + (DT + 3 - T) * SK, 8.6 * SK);
      clearXF();
    }
  }
  // parapet round the summit (open where the stairs arrive)
  const par = makeAcc("swayParapet", litMat("swayParapetM", hex("#d5cdbd"), 0.03));
  const PR = SWAY.R0 - 0.4, n = 48;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    if (offArr(am) * PR < SWAY.hw + 1.4) continue;
    const x0 = SWAY.x + Math.sin(a0) * PR, z0 = SWAY.z + Math.cos(a0) * PR, x1 = SWAY.x + Math.sin(a1) * PR, z1 = SWAY.z + Math.cos(a1) * PR;
    setXF(makeXF((x0 + x1) / 2, (z0 + z1) / 2, Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2));
    solidBox(-Math.hypot(x1 - x0, z1 - z0) / 2 - 0.1, T - 0.5, -0.3, Math.hypot(x1 - x0, z1 - z0) / 2 + 0.1, T + 0.95, 0.3, par);
    clearXF();
  }
  // prayer flags: strings from the spire out to the parapet
  const flagCols = ["#2f5fb3", "#f2f0ea", "#c0392b", "#2e8b4a", "#e3b52a"];
  const flags = flagCols.map((c, i) => makeAcc("swaySFlag" + i, litMat("swaySFlagM" + i, hex(c), 0.02)));
  const sx = SWAY.x + SX, sz = SWAY.z + SZ;          // (the spire, at the stupa centre)
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2 + 0.1;
    if (offArr(a) < 0.18) continue;   // not across the stair head
    const ex = SWAY.x + Math.sin(a) * PR, ez = SWAY.z + Math.cos(a) * PR, ey = T + 1.2;
    const L = Math.hypot(ex - sx, ez - sz), N = Math.floor(L / 0.55);
    const yaw = Math.atan2(ex - sx, ez - sz);
    for (let i = 1; i < N; i++) {
      const t = i / N, fx = sx + (ex - sx) * t, fz = sz + (ez - sz) * t;
      const fy = spireTop - 3.5 + (ey - (spireTop - 3.5)) * t - Math.sin(t * Math.PI) * 2.2;
      setXF(makeXF(fx, fz, yaw + Math.PI / 2));
      addBox(-0.17, fy - 0.3, -0.01, 0.17, fy, 0.01, flags[i % 5]);
      clearXF();
    }
  }
  // merge each material's parts into one mesh
  const mats = {
    white: litMat("swayWhiteM", hex("#efe9dc"), 0.06),
    red: litMat("swayRedBandM", hex("#9b2f24"), 0.05),
    gold: litMat("swayGoldPartM", hex("#d3a13a"), 0.6),
    goldDark: litMat("swayGoldDarkM", hex("#8e6420"), 0.4),
    brick: texMat("swayBrickM", noiseTex("swayBrickT", "#93432f", 5000, "180,100,80", "60,25,18", 256, [2, 3]), 0.03),
    roof: litMat("swayTileM", hex("#3b3330"), 0.05),
    dark: litMat("swayWinM", hex("#231c18"), 0.1),
  };
  mats.gold.specularPower = 40;
  Object.assign(mats, { sWhite: mats.white, sRed: mats.red, sGold: mats.gold, sGoldDark: mats.goldDark });
  const cx = SWAY.x + SX, cz = SWAY.z + SZ;
  const grow = (m) => {                     // scale the stupa up about the centre of its base
    const v = m.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    for (let i = 0; i < v.length; i += 3) { v[i] = cx + (v[i] - cx) * SK; v[i + 1] = T + (v[i + 1] - T) * SK; v[i + 2] = cz + (v[i + 2] - cz) * SK; }
    m.setVerticesData(BABYLON.VertexBuffer.PositionKind, v);
    m.refreshBoundingInfo();
  };
  for (const [key, list] of Object.entries(parts)) {
    const m = BABYLON.Mesh.MergeMeshes(list, true, true, undefined, false, false);
    if (!m) continue;
    if (key[0] === "s") grow(m);
    m.name = "sway_" + key; m.material = mats[key]; m.isPickable = false; m.freezeWorldMatrix();
  }
  // the eyes of the Buddha on all four sides of the harmika
  const eyes = canvasTex("swayEyesT", 256, (ctx, S) => {
    ctx.fillStyle = "#e9c46a"; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = "#f4efe2"; ctx.fillRect(14, 14, S - 28, S - 28);
    ctx.strokeStyle = "#2a1c12"; ctx.fillStyle = "#2a1c12"; ctx.lineWidth = 7;
    for (const s of [-1, 1]) {
      const cx = S / 2 + s * 58, cy = S * 0.42;
      ctx.beginPath(); ctx.moveTo(cx - 44, cy - 4); ctx.quadraticCurveTo(cx, cy - 36, cx + 44, cy - 4); ctx.stroke();      // brow
      ctx.beginPath(); ctx.moveTo(cx - 40, cy + 14); ctx.quadraticCurveTo(cx, cy - 14, cx + 40, cy + 14); ctx.quadraticCurveTo(cx, cy + 22, cx - 40, cy + 14); ctx.fill();   // lid + eye
      ctx.fillStyle = "#1f5aa8"; ctx.beginPath(); ctx.arc(cx, cy + 6, 8, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#2a1c12";
    }
    // the "nose" (the numeral one) and the third eye
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(S / 2 - 14, S * 0.56); ctx.quadraticCurveTo(S / 2 + 18, S * 0.6, S / 2 + 2, S * 0.68); ctx.quadraticCurveTo(S / 2 - 10, S * 0.74, S / 2 + 10, S * 0.8); ctx.stroke();
    ctx.fillStyle = "#1f5aa8"; ctx.beginPath(); ctx.arc(S / 2, S * 0.28, 7, 0, Math.PI * 2); ctx.fill();
  });
  const hm = texMat("swayHarmikaM", eyes, 0.05);
  harmika.bakeCurrentTransformIntoVertices();
  grow(harmika);
  harmika.material = hm; harmika.isPickable = false; harmika.freezeWorldMatrix();
}
