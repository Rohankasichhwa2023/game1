// nature.js — ground surfaces, trees, the park (pond, benches), the Paris
// plaza fountain, the city roundabout monument, and street furniture that
// makes the streets feel inhabited: boulevard trees, café terraces, hydrants.
import {
  scene, rand, rr, pick, hex, litMat, flatMat, flatTexMat, mergedTemplate, addSolid, addSolidR, makeAcc, addBox,
  setXF, clearXF, makeXF, V3, radialTex,
} from "./engine.js";
import { noiseTex, slabTex, cobbleTex } from "./textures.js";
import { edges, pathAt, roadDist, asphaltDist, districtAt, PARIS, CITY, SHORE_X, reserved, landmarks, lampSpots } from "./roads.js";
import { gardenTrees, insideAnyFootprint } from "./buildings.js";

export const POND = { x: -172, z: 128, r: 26 };
const MB = BABYLON.MeshBuilder;

// ---------------------------------------------------------------- ground
export function buildGround() {
  const grassTex = noiseTex("grass", "#6f9a4e", 9000, "150,190,100", "40,70,30", 256, [1, 3]);
  grassTex.uScale = grassTex.vScale = 4000 / 14;
  const g = MB.CreateGround("grass", { width: 4000, height: 4000 }, scene);
  g.material = flatTexMat("grassM", grassTex, 0.16);

  const conc = slabTex("concrete", "#a6a49e", "rgba(80,80,80,0.25)", 3);
  const cw = CITY.x1 - CITY.x0 + 30, ch = CITY.z1 - CITY.z0;
  conc.uScale = cw / 9; conc.vScale = ch / 9;
  const c = MB.CreateGround("cityGround", { width: cw, height: ch }, scene);
  c.position.set((CITY.x0 + CITY.x1) / 2 + 15, 0.015, (CITY.z0 + CITY.z1) / 2);
  c.material = flatTexMat("cityGroundM", conc, 0.18);

  const cob = cobbleTex();
  const pr = 216;
  cob.uScale = cob.vScale = (pr * 2) / 4;
  const pd = MB.CreateDisc("parisPave", { radius: pr, tessellation: 96 }, scene);
  pd.rotation.x = Math.PI / 2;
  pd.position.set(PARIS.x, 0.02, PARIS.z);
  pd.material = flatTexMat("parisPaveM", cob, 0.18);

  const lawn = (x, z, r, name) => {
    const d = MB.CreateDisc(name, { radius: r, tessellation: 48 }, scene);
    d.rotation.x = Math.PI / 2; d.position.set(x, 0.03, z);
    d.material = flatMat(name + "M", hex("#5f8f42"), 0.16);
  };
  lawn(PARIS.x, PARIS.z, 31, "plazaLawn");
  lawn(landmarks.roundabout.x, landmarks.roundabout.z, landmarks.roundabout.r + 1, "rbLawn");

  const sand = noiseTex("sand", "#d6c8a8", 1800, "255,250,235", "120,100,70", 256, [1, 3]);
  const bz0 = -600, bz1 = 1340;              // the full length of the world
  sand.uScale = 55 / 12; sand.vScale = (bz1 - bz0) / 12;
  const beach = MB.CreateGround("beach", { width: 55, height: bz1 - bz0 }, scene);
  beach.position.set(SHORE_X + 27.5, 0.015, (bz0 + bz1) / 2);
  beach.material = flatTexMat("beachM", sand, 0.2);
  const ocean = MB.CreateGround("ocean", { width: 2400, height: 4000 }, scene);
  ocean.position.set(SHORE_X - 1200, 0.06, 0);
  ocean.material = flatMat("oceanM", hex("#4fa3d6"), 0.18);

  const pond = MB.CreateDisc("pond", { radius: POND.r, tessellation: 64 }, scene);
  pond.rotation.x = Math.PI / 2; pond.position.set(POND.x, 0.05, POND.z);
  pond.material = flatMat("pondM", hex("#5aa6c8"), 0.18);
  const rim = MB.CreateTorus("pondRim", { diameter: POND.r * 2, thickness: 1.0, tessellation: 64 }, scene);
  rim.position.set(POND.x, 0.05, POND.z); rim.scaling.y = 0.35;
  rim.material = litMat("pondRimM", hex("#b8b0a0"));
  reserved.push({ x: POND.x, z: POND.z, r: POND.r + 3 });
  // Layered flat surfaces are only cm apart: polygon offsets keep them from
  // z-fighting at distance (roads/sidewalks use -3…-5, decals -6/-7).
  c.material.zOffset = -1; pd.material.zOffset = -1; beach.material.zOffset = -1;
  pond.material.zOffset = -2;
  scene.getMaterialByName("plazaLawnM").zOffset = -2;
  scene.getMaterialByName("rbLawnM").zOffset = -2;
  for (const m of [g, c, pd, beach, ocean, pond, rim]) { m.freezeWorldMatrix(); m.isPickable = false; }
}

// ---------------------------------------------------------------- trees
const T = {};
function initTreeTemplates() {
  const bark = litMat("bark", hex("#6b5a48"));
  const mk = (name, trunkH, trunkD, blobs, leafHex) => {
    const leaf = litMat(name + "Leaf", hex(leafHex));
    const parts = [];
    const tr = MB.CreateCylinder("trunk", { diameterTop: trunkD * 0.7, diameterBottom: trunkD, height: trunkH, tessellation: 7 }, scene);
    tr.position.y = trunkH / 2; parts.push({ mesh: tr, mat: bark });
    for (const [x, y, z, d, sy] of blobs) {
      const s = MB.CreateSphere("blob", { diameter: d, segments: 6 }, scene);
      s.position.set(x, y, z); s.scaling.y = sy ?? 0.85;
      parts.push({ mesh: s, mat: leaf });
    }
    return mergedTemplate(name, parts);
  };
  T.plane = mk("plane", 3.4, 0.4, [[0, 4.9, 0, 3.8], [1.0, 5.6, 0.4, 3.0], [-0.9, 5.4, -0.5, 3.0], [0.2, 6.3, -0.2, 2.6]], "#5d8238");
  T.oak = mk("oak", 2.8, 0.55, [[0, 4.4, 0, 4.6], [1.3, 4.9, 0.6, 3.4], [-1.2, 5.0, -0.7, 3.6], [0.3, 5.9, 0.2, 3.2]], "#4a7334");
  T.street = mk("streetTree", 2.6, 0.28, [[0, 3.6, 0, 2.6, 1], [0, 4.4, 0, 1.9, 1]], "#66923f");
  const pineLeaf = litMat("pineLeaf", hex("#2f5a35"));
  const pparts = [];
  const ptr = MB.CreateCylinder("ptrunk", { diameter: 0.35, height: 1.6, tessellation: 6 }, scene);
  ptr.position.y = 0.8; pparts.push({ mesh: ptr, mat: bark });
  [[1.6, 3.6, 2.2], [3.0, 2.8, 2.0], [4.3, 2.0, 1.8]].forEach(([y, d, h]) => {
    const cn = MB.CreateCylinder("cone", { diameterTop: 0, diameterBottom: d, height: h, tessellation: 8 }, scene);
    cn.position.y = y + h / 2 - 0.3; pparts.push({ mesh: cn, mat: pineLeaf });
  });
  T.pine = mergedTemplate("pine", pparts);
}
export function addTree(x, z, kind, scale = 1) {
  const t = T[kind].createInstance(kind);
  t.position.set(x, 0, z);
  t.rotation.y = rand() * Math.PI * 2;
  t.scaling.setAll(scale);
  t.freezeWorldMatrix();
  addSolid(x - 0.25 * scale, 0, z - 0.25 * scale, x + 0.25 * scale, 3.2 * scale, z + 0.25 * scale);
  return t;
}
const nearLamp = (x, z, r = 3) => lampSpots.some((l) => Math.abs(l.x - x) < r && Math.abs(l.z - z) < r);

// ---------------------------------------------------------------- furniture templates
let benchT, cafeT, hydrantT, binT;
function initFurniture() {
  const wood = litMat("benchWood", hex("#7a5434")), iron = litMat("iron", hex("#25282c"), 0.3);
  const bp = [];
  const box = (w, h, d, x, y, z, mat, list) => { const b = MB.CreateBox("b", { width: w, height: h, depth: d }, scene); b.position.set(x, y, z); list.push({ mesh: b, mat }); };
  box(1.8, 0.06, 0.5, 0, 0.45, 0, wood, bp);
  box(1.8, 0.45, 0.06, 0, 0.75, 0.25, wood, bp);
  for (const x of [-0.8, 0.8]) box(0.06, 0.45, 0.5, x, 0.22, 0, iron, bp);
  benchT = mergedTemplate("bench", bp);

  const cp = [];
  const top = MB.CreateCylinder("ct", { diameter: 0.75, height: 0.04, tessellation: 12 }, scene);
  top.position.y = 0.74; cp.push({ mesh: top, mat: litMat("marble", hex("#e9e5dc"), 0.3) });
  box(0.06, 0.74, 0.06, 0, 0.37, 0, iron, cp);
  for (const [x, z] of [[-0.62, 0], [0.62, 0]]) {
    box(0.42, 0.04, 0.42, x, 0.45, z, litMat("rattan", hex("#a8763f")), cp);
    box(0.42, 0.45, 0.04, x + Math.sign(x) * 0.2 * 0, 0.68, z + 0.2, litMat("rattan2", hex("#8f6232")), cp);
  }
  box(0.04, 2.3, 0.04, 0, 1.15, 0, iron, cp);
  const um = MB.CreateCylinder("umb", { diameterTop: 0, diameterBottom: 2.4, height: 0.6, tessellation: 8 }, scene);
  um.position.y = 2.3; cp.push({ mesh: um, mat: litMat("umbrella", hex(pick(["#a3262a", "#2d6a3e", "#e8dcc0"]))) });
  cafeT = mergedTemplate("cafe", cp);

  const hp = [];
  const red = litMat("hydrant", hex("#b8261f"), 0.3);
  const hb = MB.CreateCylinder("hb", { diameter: 0.3, height: 0.6, tessellation: 8 }, scene); hb.position.y = 0.3; hp.push({ mesh: hb, mat: red });
  const hc = MB.CreateSphere("hc", { diameter: 0.3, segments: 6 }, scene); hc.position.y = 0.62; hp.push({ mesh: hc, mat: red });
  box(0.5, 0.1, 0.1, 0, 0.4, 0, red, hp);
  hydrantT = mergedTemplate("hydrant", hp);

  const bin = MB.CreateCylinder("bin", { diameter: 0.55, height: 0.95, tessellation: 10 }, scene);
  bin.position.y = 0.47;
  binT = mergedTemplate("bin", [{ mesh: bin, mat: litMat("binM", hex("#2f4a3a"), 0.2) }]);
}
function place(tpl, x, z, yaw, solidHW = 0, solidHD = 0, h = 1) {
  const m = tpl.createInstance("f");
  m.position.set(x, 0, z); m.rotation.y = yaw; m.freezeWorldMatrix();
  if (solidHW) addSolidR(x, z, yaw, solidHW, solidHD, 0, h);
  return m;
}

// ---------------------------------------------------------------- landmarks
function buildFountain() {
  const { x, z } = landmarks.parisPlaza;
  const stone = litMat("fountainStone", hex("#d9cfba"));
  const water = flatMat("fountainWater", hex("#6fb6d6"), 0.25);
  const basin = MB.CreateCylinder("basin", { diameter: 18, height: 0.8, tessellation: 40 }, scene);
  basin.position.set(x, 0.4, z); basin.material = stone;
  const pool = MB.CreateCylinder("basinWater", { diameter: 16.8, height: 0.1, tessellation: 40 }, scene);
  pool.position.set(x, 0.78, z); pool.material = water;
  const col = MB.CreateCylinder("fcol", { diameterTop: 1.0, diameterBottom: 1.8, height: 3.2, tessellation: 16 }, scene);
  col.position.set(x, 2.0, z); col.material = stone;
  const bowl = MB.CreateCylinder("fbowl", { diameterTop: 5, diameterBottom: 1.2, height: 0.9, tessellation: 24 }, scene);
  bowl.position.set(x, 3.8, z); bowl.material = stone;
  const top = MB.CreateCylinder("ftop", { diameterTop: 0.3, diameterBottom: 0.8, height: 1.8, tessellation: 12 }, scene);
  top.position.set(x, 5.1, z); top.material = stone;
  for (const m of [basin, pool, col, bowl, top]) m.freezeWorldMatrix();
  addSolid(x - 6.4, 0, z - 6.4, x + 6.4, 0.8, z + 6.4);
  addSolid(x - 1, 0, z - 1, x + 1, 6, z + 1);

  const tex = radialTex("spray", [[0, "rgba(255,255,255,0.95)"], [1, "rgba(220,240,255,0)"]], 32);
  const ps = new BABYLON.ParticleSystem("fountain", 900, scene);
  ps.particleTexture = tex;
  ps.emitter = new V3(x, 6.0, z);
  ps.minEmitBox = new V3(-0.1, 0, -0.1); ps.maxEmitBox = new V3(0.1, 0, 0.1);
  ps.direction1 = new V3(-1.6, 7, -1.6); ps.direction2 = new V3(1.6, 8.5, 1.6);
  ps.gravity = new V3(0, -9.8, 0);
  ps.minEmitPower = 0.8; ps.maxEmitPower = 1.1;
  ps.minLifeTime = 1.4; ps.maxLifeTime = 1.9;
  ps.minSize = 0.18; ps.maxSize = 0.4;
  ps.color1 = new BABYLON.Color4(0.85, 0.93, 1, 0.8); ps.color2 = new BABYLON.Color4(0.7, 0.85, 1, 0.6);
  ps.colorDead = new BABYLON.Color4(0.7, 0.85, 1, 0);
  ps.emitRate = 420;
  ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
  ps.start();
  // flower beds sit between the 8 boulevards so the street axes (and the
  // view down them) stay open
  for (let k = 0; k < 8; k++) { const a = (k + 0.5) * Math.PI / 4; plantBed(x + Math.cos(a) * 22, z + Math.sin(a) * 22); }
}
function plantBed(x, z) {
  for (let i = 0; i < 3; i++) addTree(x + rr(-2, 2), z + rr(-2, 2), "street", rr(0.6, 0.8));
}
function buildMonument() {
  const { x, z } = landmarks.roundabout;
  const granite = litMat("granite", hex("#8f8a82"), 0.2), bronze = litMat("bronze", hex("#5d4a2e"), 0.5);
  const ped = MB.CreateBox("pedestal", { width: 5, height: 3, depth: 5 }, scene);
  ped.position.set(x, 1.5, z); ped.material = granite;
  const col = MB.CreateCylinder("column", { diameterTop: 1.1, diameterBottom: 1.5, height: 18, tessellation: 16 }, scene);
  col.position.set(x, 12, z); col.material = granite;
  const cap = MB.CreateBox("capital", { width: 2.2, height: 0.8, depth: 2.2 }, scene);
  cap.position.set(x, 21.4, z); cap.material = granite;
  const statue = MB.CreateCapsule("statue", { radius: 0.45, height: 2.4, tessellation: 10 }, scene);
  statue.position.set(x, 23, z); statue.material = bronze;
  for (const m of [ped, col, cap, statue]) m.freezeWorldMatrix();
  addSolid(x - 2.5, 0, z - 2.5, x + 2.5, 3, z + 2.5);
  for (let k = 0; k < 6; k++) addTree(x + Math.cos(k) * 12, z + Math.sin(k) * 12, "street", 0.9);
}

// ---------------------------------------------------------------- populate
export function buildNature(START) {
  initTreeTemplates();
  initFurniture();
  buildFountain();
  buildMonument();

  // Park: scattered trees, keeping a clear view from the start point.
  let planted = 0;
  for (let i = 0; i < 4000 && planted < 460; i++) {
    const x = rr(SHORE_X + 60, CITY.x0 - 4), z = rr(-585, 585);
    if (districtAt(x, z) !== "park") continue;
    if (roadDist(x, z) < 3) continue;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 5) continue;
    if (Math.hypot(x - START.x, z - START.z) < 28) continue;
    if (x > START.x - 10 && Math.abs(z - START.z) < 32) continue;
    addTree(x, z, rand() < 0.6 ? "oak" : rand() < 0.65 ? "pine" : "plane", rr(0.85, 1.3));
    planted++;
  }
  // Paris quarter gardens + avenue trees
  for (const [x, z] of gardenTrees) {
    if (roadDist(x, z) > 2 && !insideAnyFootprint(x, z) && rand() < 0.8) addTree(x, z, rand() < 0.7 ? "oak" : "street", rr(0.7, 1));
  }

  for (const e of edges) {
    const paris = e.district === "paris", city = e.district === "city", park = e.district === "park";
    for (const side of [-1, 1]) {
      // curb-side trees
      const treeStep = paris ? (["radial", "major", "outer", "plaza"].includes(e.kind) ? 11 : 17) : city ? 18 : 0;
      if (treeStep) {
        for (let s = 9 + rand() * 5; s < e.len - 9; s += treeStep) {
          if (city && (e.kind === "street" || rand() < 0.35)) continue;
          if (paris && e.kind === "minor" && rand() < 0.4) continue;
          const p = pathAt(e, s);
          const rx = p.tz * side, rz = -p.tx * side;
          const off = e.w / 2 + 0.95;
          const x = p.x + rx * off, z = p.z + rz * off;
          if (asphaltDist(x, z) < 0.7 || nearLamp(x, z) || insideAnyFootprint(x, z)) continue;
          addTree(x, z, paris ? "plane" : "street", rr(0.85, 1.05));
        }
      }
      // furniture on the building side of the sidewalk
      for (let s = 15 + rand() * 20; s < e.len - 15; s += paris ? 55 : 45) {
        const p = pathAt(e, s);
        const rx = p.tz * side, rz = -p.tx * side;
        const yaw = Math.atan2(-rx, -rz);
        if (paris && ["radial", "major", "plaza"].includes(e.kind) &&
            Math.hypot(p.x - PARIS.x, p.z - PARIS.z) < 212 && rand() < 0.55) {
          // café terrace: 3 tables
          for (let k = -1; k <= 1; k++) {
            const off = e.w / 2 + e.sw - 0.95;
            const x = p.x + rx * off + p.tx * k * 2.1, z = p.z + rz * off + p.tz * k * 2.1;
            if (asphaltDist(x, z) < 1 || nearLamp(x, z, 2) || insideAnyFootprint(x, z)) continue;
            place(cafeT, x, z, yaw, 0.4, 0.4, 0.75);
          }
        } else if (city && rand() < 0.7) {
          const off = e.w / 2 + 0.45;
          const x = p.x + rx * off, z = p.z + rz * off;
          if (asphaltDist(x, z) < 0.3 || nearLamp(x, z, 2)) continue;
          place(rand() < 0.6 ? hydrantT : binT, x, z, yaw, 0.2, 0.2, 0.9);
        } else if ((paris || park) && rand() < 0.5) {
          const off = e.w / 2 + e.sw - 0.5;
          const x = p.x + rx * off, z = p.z + rz * off;
          if (asphaltDist(x, z) < 1 || nearLamp(x, z, 2.5) || insideAnyFootprint(x, z)) continue;
          place(benchT, x, z, yaw + Math.PI, 0.9, 0.3, 0.5);
        }
      }
    }
  }
  // benches around the pond
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const x = POND.x + Math.cos(a) * (POND.r + 3.5), z = POND.z + Math.sin(a) * (POND.r + 3.5);
    place(benchT, x, z, Math.atan2(Math.cos(a), Math.sin(a)), 0.9, 0.3, 0.5); // seat faces the water
  }
}
