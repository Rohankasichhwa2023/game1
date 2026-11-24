// londonWorld.js — everything in London that isn't a road or a building:
// paving, the river with stone embankments and bridge parapets, railed
// garden squares, circus fountains, the Gothic clock tower, the turning
// observation wheel, plane trees, red phone boxes and pillar boxes.
import {
  scene, glow, hex, V3, litMat, flatMat, flatTexMat, texMat, makeAcc, addBox, solidBox, addSolid, addSolidR, addPoly,
  addFlatQuad, setXF, clearXF, makeXF, xfp, mergedTemplate, canvasTex, staticInstance, ambientParticles, seaAt,
} from "./engine.js";
import { makeWaterMat } from "./waterMat.js";
import { slabTex, noiseTex, railingTex } from "./textures.js";
import { edges, pathAt, roadDist, asphaltDist, landmarks, lampSpots, bulbMats } from "./roads.js";
import { LONDON, RW, river, riverDist, lrand, lrr, lpick } from "./london.js";
import { addTree } from "./nature.js";
import { insideAnyFootprint } from "./buildings.js";

const MB = BABYLON.MeshBuilder;
const nearLamp = (x, z, r = 3) => lampSpots.some((l) => Math.abs(l.x - x) < r && Math.abs(l.z - z) < r);
let M = null;
function initMats() {
  const rail = texMat("lonRailM", railingTex(), 0.2);
  rail.useAlphaFromDiffuseTexture = true;
  rail.transparencyMode = BABYLON.Material.MATERIAL_ALPHATEST;
  M = {
    stone: makeAcc("lonStone", litMat("lonStoneM", hex("#c9c0ad"))),
    stoneDark: makeAcc("lonStoneDark", litMat("lonStoneDarkM", hex("#8f887b"))),
    iron: makeAcc("lonIronW", litMat("lonIronWM", hex("#17191b"), 0.3)),
    rail: makeAcc("lonRail", rail, 1, 0.96),
    bronze: makeAcc("lonBronze", litMat("lonBronzeM", hex("#4f5a45"), 0.5)),
  };
}

// ---------------------------------------------------------------- ground + river
export function buildLondonGround() {
  const x0 = 752, x1 = LONDON.x1 + 40, z0 = -620, z1 = 620;
  const pave = slabTex("lonPave", "#8d8981", "rgba(60,58,54,0.3)", 4);
  pave.uScale = (x1 - x0) / 10; pave.vScale = (z1 - z0) / 10;
  const g = MB.CreateGround("londonGround", { width: x1 - x0, height: z1 - z0 }, scene);
  g.position.set((x0 + x1) / 2, 0.03, 0);                 // 0.015 loses to the grass at grazing angles
  g.material = flatTexMat("londonGroundM", pave, 0.18);
  g.material.zOffset = -1;
  g.freezeWorldMatrix(); g.isPickable = false;

  // water ribbon + stone coping strips along both banks
  const waterM = makeWaterMat("riverM", -2);       // same moving water as the sea it flows into
  const water = makeAcc("riverWater", waterM, 1, 1);
  const copeM = flatMat("embankM", hex("#b7b0a1"), 0.25); copeM.zOffset = -2;
  const cope = makeAcc("embankCope", copeM);
  const n = river.length;
  const R = river.map((_, i) => {
    const a = river[Math.max(0, i - 1)], b = river[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
  });
  const P = (i, off) => [river[i][0] + R[i][0] * off, river[i][1] + R[i][1] * off];
  let u = 0;
  for (let i = 0; i < n - 1; i++) {
    const du = Math.hypot(river[i + 1][0] - river[i][0], river[i + 1][1] - river[i][1]) / 24;
    // past London's shore the river has run out into the sea
    if (seaAt((river[i][0] + river[i + 1][0]) / 2, (river[i][1] + river[i + 1][1]) / 2)) { u += du; continue; }
    addFlatQuad(water, P(i, -RW), P(i, RW), P(i + 1, RW), P(i + 1, -RW), 0.042, [[0, u], [1.6, u], [1.6, u + du], [0, u + du]]);
    u += du;
    for (const sd of [-1, 1]) addFlatQuad(cope, P(i, sd * RW), P(i, sd * (RW + 2.4)), P(i + 1, sd * (RW + 2.4)), P(i + 1, sd * RW), 0.05, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
}

// Embankment walls (solid) except where a bridge crosses; bridge parapets
// with stone piers over the water.
function buildEmbankments() {
  const n = river.length;
  for (const sd of [-1, 1]) {
    for (let i = 0; i < n - 2; i += 2) {
      const a = river[i], b = river[i + 2];
      if (seaAt(a[0], a[1]) || seaAt(b[0], b[1])) continue;     // the river mouth: open sea
      const off = (j) => {
        const p = river[Math.max(0, j - 1)], q = river[Math.min(n - 1, j + 1)];
        const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        return [river[j][0] + ((q[1] - p[1]) / l) * sd * (RW + 0.35), river[j][1] - ((q[0] - p[0]) / l) * sd * (RW + 0.35)];
      };
      const [ax, az] = off(i), [bx, bz] = off(i + 2);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (roadDist(mx, mz) < 1.5 || roadDist(ax, az) < 1 || roadDist(bx, bz) < 1) continue;
      const L = Math.hypot(bx - ax, bz - az);
      setXF(makeXF(mx, mz, Math.atan2(bx - ax, bz - az)));
      solidBox(-0.28, 0, -L / 2 - 0.08, 0.28, 0.95, L / 2 + 0.08, M.stone);
      addBox(-0.36, 0.95, -L / 2 - 0.08, 0.36, 1.05, L / 2 + 0.08, M.stoneDark);
      clearXF();
    }
  }
  for (const e of landmarks.londonBridges || []) {
    let k = 0;
    for (let s = 2; s < e.len - 2; s += 4, k++) {
      const p = pathAt(e, s, {});
      if (riverDist(p.x, p.z) > RW + 3.5) continue;
      for (const sd of [-1, 1]) {
        const off = e.w / 2 + e.sw + 0.3;
        setXF(makeXF(p.x + p.tz * sd * off, p.z - p.tx * sd * off, Math.atan2(p.tx, p.tz)));
        solidBox(-0.3, 0, -2.05, 0.3, 1.1, 2.05, M.stone);
        addBox(-0.38, 1.1, -2.05, 0.38, 1.2, 2.05, M.stoneDark);
        if (k % 4 === 0) solidBox(-0.55, 0, -0.55, 0.55, 1.7, 0.55, M.stoneDark);
        clearXF();
      }
    }
  }
}

// ---------------------------------------------------------------- squares + circuses
let pedM = null;
function statue(x, z, h = 3.2) {
  pedM ??= litMat("lonPedM", hex("#bdb5a4"));
  const ped = MB.CreateBox("lonPed", { width: 2.4, height: h, depth: 2.4 }, scene);
  ped.position.set(x, h / 2, z); ped.material = pedM;
  const fig = MB.CreateCapsule("lonFig", { radius: 0.42, height: 2.3, tessellation: 10 }, scene);
  fig.position.set(x, h + 1.15, z); fig.material = scene.getMaterialByName("lonBronzeM");
  for (const m of [ped, fig]) { m.freezeWorldMatrix(); m.isPickable = false; }
  addSolid(x - 1.2, 0, z - 1.2, x + 1.2, h + 2.3, z + 1.2);
}
function buildSquares() {
  const lawnM = flatMat("lonLawnM", hex("#5d8c40"), 0.16); lawnM.zOffset = -2;
  const gravelM = flatMat("lonGravelM", hex("#c8b993"), 0.2); gravelM.zOffset = -3;
  const gravel = makeAcc("lonGravel", gravelM);
  for (const sq of landmarks.londonSquares || []) {
    const lawn = MB.CreateDisc("lonLawn", { radius: sq.r - 0.8, tessellation: 48 }, scene);
    lawn.rotation.x = Math.PI / 2; lawn.position.set(sq.x, 0.03, sq.z); lawn.material = lawnM;
    lawn.freezeWorldMatrix(); lawn.isPickable = false;
    const rot = lrr(0, Math.PI / 2);
    // railings with four gates
    const RR = sq.r - 1.2, N = 40;
    for (let k = 0; k < N; k++) {
      const a0 = rot + (k / N) * Math.PI * 2, a1 = rot + ((k + 1) / N) * Math.PI * 2;
      if (k % (N / 4) === 0) continue;                       // gate
      const ax = sq.x + Math.cos(a0) * RR, az = sq.z + Math.sin(a0) * RR;
      const bx = sq.x + Math.cos(a1) * RR, bz = sq.z + Math.sin(a1) * RR;
      const L = Math.hypot(bx - ax, bz - az);
      setXF(makeXF((ax + bx) / 2, (az + bz) / 2, Math.atan2(bx - ax, bz - az)));
      addBox(-0.03, 0, -L / 2, 0.03, 1.15, L / 2, M.rail, { x: 0, y: 0, z: -L / 2 });
      addBox(-0.05, 1.1, -L / 2, 0.05, 1.18, L / 2, M.iron);
      addSolid(-0.06, 0, -L / 2, 0.06, 1.2, L / 2);
      solidBox(-0.08, 0, -L / 2 - 0.08, 0.08, 1.35, -L / 2 + 0.08, M.iron);
      clearXF();
    }
    // gravel paths from the gates to the middle
    for (let k = 0; k < 4; k++) {
      const a = rot + (k / 4) * Math.PI * 2 + Math.PI / N;
      const dx = Math.cos(a), dz = Math.sin(a), nx = -dz * 1.2, nz = dx * 1.2;
      const ox = sq.x + dx * 3, oz = sq.z + dz * 3, ex = sq.x + dx * (sq.r - 0.5), ez = sq.z + dz * (sq.r - 0.5);
      addFlatQuad(gravel, [ox - nx, oz - nz], [ox + nx, oz + nz], [ex + nx, ez + nz], [ex - nx, ez - nz], 0.045, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    const ring = MB.CreateDisc("lonSqC", { radius: 4.2, tessellation: 32 }, scene);
    ring.rotation.x = Math.PI / 2; ring.position.set(sq.x, 0.05, sq.z); ring.material = gravelM;
    ring.freezeWorldMatrix(); ring.isPickable = false;
    statue(sq.x, sq.z);
    // mature trees
    const placed = [];
    for (let t = 0; t < 300 && placed.length < Math.round((sq.r * sq.r) / 55); t++) {
      const a = lrr(0, Math.PI * 2), r = Math.sqrt(lrand()) * (sq.r - 4);
      const x = sq.x + Math.cos(a) * r, z = sq.z + Math.sin(a) * r;
      if (r < 7) continue;
      const da = Math.abs(((a - rot - Math.PI / N) % (Math.PI / 2) + Math.PI / 2) % (Math.PI / 2));
      if (Math.min(da, Math.PI / 2 - da) * r < 3) continue;     // keep the paths clear
      if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 6.5)) continue;
      placed.push([x, z]);
      addTree(x, z, lrand() < 0.6 ? "plane" : "oak", lrr(1.0, 1.4));
    }
  }
}
function buildCircusFountains() {
  const stoneM = litMat("lonFountainM", hex("#cfc6b4"));
  const waterM = flatMat("lonFountainWaterM", hex("#6aa9c4"), 0.25);
  const sprayTex = canvasTex("lonSpray", 32, (ctx, S) => {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, "rgba(255,255,255,0.95)"); g.addColorStop(1, "rgba(220,240,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  }, false);
  sprayTex.hasAlpha = true;
  for (const c of landmarks.londonCircuses || []) {
    const basin = MB.CreateCylinder("lonBasin", { diameter: 9, height: 0.75, tessellation: 32 }, scene);
    basin.position.set(c.x, 0.375, c.z); basin.material = stoneM;
    const pool = MB.CreateCylinder("lonPool", { diameter: 8, height: 0.08, tessellation: 32 }, scene);
    pool.position.set(c.x, 0.74, c.z); pool.material = waterM;
    const steps = MB.CreateCylinder("lonSteps", { diameter: 11.5, height: 0.25, tessellation: 32 }, scene);
    steps.position.set(c.x, 0.125, c.z); steps.material = stoneM;
    for (const m of [basin, pool, steps]) { m.freezeWorldMatrix(); m.isPickable = false; }
    addSolid(c.x - 3.2, 0, c.z - 3.2, c.x + 3.2, 0.75, c.z + 3.2);
    statue(c.x, c.z, 4.2);
    const ps = new BABYLON.ParticleSystem("lonFountain", 260, scene);
    ps.particleTexture = sprayTex;
    ps.emitter = new V3(c.x, 4.4, c.z);
    ps.minEmitBox = new V3(-0.8, 0, -0.8); ps.maxEmitBox = new V3(0.8, 0, 0.8);
    ps.direction1 = new V3(-1.4, 3, -1.4); ps.direction2 = new V3(1.4, 4.5, 1.4);
    ps.gravity = new V3(0, -9.8, 0);
    ps.minLifeTime = 0.9; ps.maxLifeTime = 1.2;
    ps.minSize = 0.15; ps.maxSize = 0.32;
    ps.color1 = new BABYLON.Color4(0.85, 0.93, 1, 0.75); ps.color2 = new BABYLON.Color4(0.7, 0.85, 1, 0.55);
    ps.colorDead = new BABYLON.Color4(0.7, 0.85, 1, 0);
    ps.emitRate = 160;
    ps.start();
    ambientParticles(ps, c.x, c.z);
  }
}

// ---------------------------------------------------------------- clock tower
let clockTex = null, clockMin = -1;
function drawClock(hours) {
  const ctx = clockTex.getContext(), S = 256, c = S / 2;
  ctx.fillStyle = "#2a2f2a"; ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = "#c9a24a"; ctx.beginPath(); ctx.arc(c, c, c - 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#f4edd8"; ctx.beginPath(); ctx.arc(c, c, c - 16, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#1b1b1b";
  for (let k = 0; k < 60; k++) {
    const a = (k / 60) * Math.PI * 2, big = k % 5 === 0;
    ctx.lineWidth = big ? 7 : 2;
    const r0 = big ? c - 42 : c - 26, r1 = c - 20;
    ctx.beginPath(); ctx.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0); ctx.lineTo(c + Math.sin(a) * r1, c - Math.cos(a) * r1); ctx.stroke();
  }
  const h = hours % 12, m = (hours % 1) * 60;
  const hand = (a, len, w) => {
    ctx.lineWidth = w; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + Math.sin(a) * len, c - Math.cos(a) * len); ctx.stroke();
  };
  hand((h / 12) * Math.PI * 2, c * 0.45, 9);
  hand((m / 60) * Math.PI * 2, c * 0.7, 5);
  ctx.fillStyle = "#1b1b1b"; ctx.beginPath(); ctx.arc(c, c, 8, 0, Math.PI * 2); ctx.fill();
  clockTex.update();
}
function buildClockTower() {
  const p = landmarks.clockTower;
  if (!p) return;
  const gothic = canvasTex("lonGothic", 256, (ctx, S) => {
    ctx.fillStyle = "#cdb98d"; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 1400; i++) { ctx.fillStyle = `rgba(${lrand() < 0.5 ? "250,240,210" : "120,95,60"},${lrr(0.04, 0.1)})`; ctx.fillRect(lrand() * S, lrand() * S, 3, 2); }
    for (let k = 0; k < 4; k++) {
      const x = k * 64;
      ctx.fillStyle = "#b09a6e"; ctx.fillRect(x, 0, 6, S);                     // mullion rib
      ctx.fillStyle = "#3b3a36";
      ctx.fillRect(x + 22, 30, 20, 150);                                       // lancet
      ctx.beginPath(); ctx.moveTo(x + 22, 30); ctx.lineTo(x + 32, 12); ctx.lineTo(x + 42, 30); ctx.fill();
      ctx.fillStyle = "#b09a6e"; ctx.fillRect(x + 31, 30, 2, 150); ctx.fillRect(x + 22, 100, 20, 2);
      ctx.fillStyle = "#bca677"; ctx.fillRect(x + 10, 205, 44, 30);             // panel
    }
  });
  const stoneT = makeAcc("lonGothicA", texMat("lonGothicM", gothic, 0.05), 6, 6);
  const roofT = makeAcc("lonSpireA", litMat("lonSpireM", hex("#3b4a46"), 0.3));
  const gilt = makeAcc("lonGiltA", litMat("lonGiltM", hex("#c9a24a"), 0.6));
  const dark = makeAcc("lonBelfryA", litMat("lonBelfryM", hex("#1f2224")));
  const yaw = Math.atan2(p.nx, p.nz);
  const xf = makeXF(p.x, p.z, yaw);
  setXF(xf);
  solidBox(-6, 0, -6, 6, 2.2, 6, M.stoneDark);
  addBox(-4.6, 2.2, -4.6, 4.6, 46, 4.6, (d) => (d === "-y" ? null : stoneT), { x: -4.6, y: 2.2, z: -4.6 });
  addSolid(-4.6, 2.2, -4.6, 4.6, 60, 4.6);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    addBox(sx * 4.6 - 0.6, 2.2, sz * 4.6 - 0.6, sx * 4.6 + 0.6, 47.5, sz * 4.6 + 0.6, M.stone);
    addBox(sx * 5.4 - 0.4, 54, sz * 5.4 - 0.4, sx * 5.4 + 0.4, 58.5, sz * 5.4 + 0.4, M.stone);       // pinnacles
    addPoly(roofT, [[sx * 5.4 - 0.4, 58.5, sz * 5.4 - 0.4], [sx * 5.4 + 0.4, 58.5, sz * 5.4 - 0.4], [sx * 5.4, 61.5, sz * 5.4]], [sx * 5.4, 58, sz * 5.4 + 1], () => [0, 0]);
    addPoly(roofT, [[sx * 5.4 + 0.4, 58.5, sz * 5.4 + 0.4], [sx * 5.4 - 0.4, 58.5, sz * 5.4 + 0.4], [sx * 5.4, 61.5, sz * 5.4]], [sx * 5.4, 58, sz * 5.4 - 1], () => [0, 0]);
  }
  addBox(-5.6, 46, -5.6, 5.6, 54, 5.6, (d) => (d === "-y" ? M.stone : stoneT), { x: -5.6, y: 46, z: -5.6 });   // clock stage
  addBox(-5.9, 53.6, -5.9, 5.9, 54.2, 5.9, gilt);
  addBox(-4.8, 54.2, -4.8, 4.8, 59, 4.8, dark);                                                            // belfry
  for (const k of [-3, -1, 1, 3]) {                                                                        // belfry mullions
    addBox(k - 0.35, 54.2, -4.85, k + 0.35, 59, 4.85, M.stone);
    addBox(-4.85, 54.2, k - 0.35, 4.85, 59, k + 0.35, M.stone);
  }
  addBox(-5.3, 59, -5.3, 5.3, 59.6, 5.3, M.stone);
  const base = [[-5.0, 59.6, -5.0], [5.0, 59.6, -5.0], [5.0, 59.6, 5.0], [-5.0, 59.6, 5.0]], apex = [0, 80, 0];
  for (let i = 0; i < 4; i++) addPoly(roofT, [base[i], base[(i + 1) % 4], apex], [0, 62, 0], (q) => [q[0] / 3, q[1] / 3]);
  addBox(-0.25, 80, -0.25, 0.25, 84, 0.25, gilt);
  clearXF();
  // four clock faces
  clockTex = new BABYLON.DynamicTexture("lonClock", { width: 256, height: 256 }, scene, true);
  const fm = new BABYLON.StandardMaterial("lonClockM", scene);
  fm.diffuseTexture = clockTex; fm.emissiveTexture = clockTex; fm.disableLighting = true;
  drawClock(12);
  for (let k = 0; k < 4; k++) {
    const th = yaw + (k * Math.PI) / 2;
    const f = MB.CreatePlane("lonClockFace", { size: 7.4 }, scene);
    f.material = fm;
    f.position.set(p.x - Math.sin(th) * 5.65, 50, p.z - Math.cos(th) * 5.65);
    f.rotation.y = th;
    f.freezeWorldMatrix(); f.isPickable = false;
  }
}

// ---------------------------------------------------------------- observation wheel
let wheel = null;
function buildWheel() {
  const p = landmarks.wheel;
  if (!p) return;
  const HUB = 37, RIM = 30, POD = 32;
  const steel = litMat("lonWheelSteel", hex("#e4e7ea"), 0.4);
  const root = new BABYLON.TransformNode("lonWheel", scene);
  root.position.set(p.x, HUB, p.z);
  root.rotation.y = Math.atan2(-p.tz, p.tx);              // local x → along the bank, local z → across
  const spin = new BABYLON.TransformNode("lonWheelSpin", scene);
  spin.parent = root;
  const parts = [];
  for (const z of [-1.3, 1.3]) {
    const t = MB.CreateTorus("rim", { diameter: RIM * 2, thickness: 0.7, tessellation: 72 }, scene);
    t.rotation.x = Math.PI / 2; t.position.z = z; parts.push(t);
  }
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    const sp = MB.CreateBox("spoke", { width: 0.16, height: RIM, depth: 0.16 }, scene);
    sp.position.set(Math.cos(a) * RIM / 2, Math.sin(a) * RIM / 2, k % 2 ? 1.0 : -1.0);
    sp.rotation.z = a - Math.PI / 2; parts.push(sp);
    const cr = MB.CreateBox("brace", { width: 0.3, height: 0.3, depth: 2.6 }, scene);
    cr.position.set(Math.cos(a) * RIM, Math.sin(a) * RIM, 0); parts.push(cr);
  }
  const hub = MB.CreateCylinder("hub", { diameter: 3.2, height: 5, tessellation: 20 }, scene);
  hub.rotation.x = Math.PI / 2; parts.push(hub);
  const wheelMesh = BABYLON.Mesh.MergeMeshes(parts, true, true);
  wheelMesh.material = steel; wheelMesh.parent = spin; wheelMesh.isPickable = false;
  const lightsM = new BABYLON.StandardMaterial("lonWheelLights", scene);
  lightsM.disableLighting = true; lightsM.emissiveColor = hex("#c9ccd0");
  bulbMats.push({ m: lightsM, day: "#c9ccd0", night: "#9fd8ff" });
  const lights = MB.CreateTorus("wheelLights", { diameter: RIM * 2 + 1.0, thickness: 0.22, tessellation: 72 }, scene);
  lights.rotation.x = Math.PI / 2; lights.material = lightsM; lights.parent = spin; lights.isPickable = false;
  glow.addIncludedOnlyMesh(lights);
  // pods ride outside the rim and stay level
  const podM = litMat("lonPodM", hex("#a9cfe0"), 0.8); podM.specularPower = 96;
  const podT = MB.CreateSphere("pod", { diameter: 1, segments: 10 }, scene);
  podT.scaling.set(2.6, 2.4, 4.4); podT.bakeCurrentTransformIntoVertices();
  podT.material = podM; podT.isPickable = false;
  const pods = [];
  for (let k = 0; k < 32; k++) {
    const m = k ? podT.createInstance("pod") : podT;
    m.parent = root;
    pods.push({ m, a: (k / 32) * Math.PI * 2 });
  }
  // A-frame legs on both sides of the wheel, and the boarding platform
  const toWorld = (lx, ly, lz) => new V3(p.x + lx * p.tx - lz * p.tz, HUB + ly, p.z + lx * p.tz + lz * p.tx);
  const legs = [];
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    const A = toWorld(0, 0, sz * 3), B = toWorld(sx * 17, -HUB, sz * 8);
    const leg = MB.CreateCylinder("leg", { diameter: 1.1, height: V3.Distance(A, B), tessellation: 10 }, scene);
    leg.rotation.x = Math.PI / 2; leg.bakeCurrentTransformIntoVertices();
    leg.position = A.add(B).scaleInPlace(0.5); leg.lookAt(B);
    legs.push(leg);
    addSolidR(B.x, B.z, 0, 0.7, 0.7, 0, 4);
  }
  const legMesh = BABYLON.Mesh.MergeMeshes(legs, true, true);
  legMesh.material = steel; legMesh.isPickable = false; legMesh.freezeWorldMatrix();
  setXF(makeXF(p.x, p.z, Math.atan2(p.tx, p.tz)));
  addBox(-5, 0, -14, 5, 0.2, 14, M.stoneDark);
  clearXF();
  wheel = { spin, pods, POD, ang: 0 };
}

// ---------------------------------------------------------------- street furniture
let phoneT, postT;
function initFurniture() {
  const red = litMat("lonRed", hex("#c1121f"), 0.35);
  const glassM = litMat("lonBoothGlass", hex("#2b3a44"), 0.7);
  const signM = new BABYLON.StandardMaterial("lonBoothSign", scene);
  signM.disableLighting = true; signM.emissiveColor = hex("#f3efe2");
  const blackM = litMat("lonBlack", hex("#18191b"), 0.2);
  const box = (w, h, d, x, y, z, mat, list) => { const b = MB.CreateBox("b", { width: w, height: h, depth: d }, scene); b.position.set(x, y, z); list.push({ mesh: b, mat }); };
  const pp = [];
  box(1.0, 2.35, 1.0, 0, 1.175, 0, red, pp);
  box(1.12, 0.14, 1.12, 0, 0.07, 0, red, pp);
  box(1.08, 0.16, 1.08, 0, 2.43, 0, red, pp);
  const dome = MB.CreateCylinder("dome", { diameter: 1.05, height: 1.0, arc: 0.5, tessellation: 12, enclose: true }, scene);
  dome.rotation.z = Math.PI / 2; dome.scaling.set(0.24, 1, 1); dome.position.y = 2.5; pp.push({ mesh: dome, mat: red });
  box(0.72, 0.16, 1.03, 0, 2.2, 0, signM, pp);
  box(1.03, 0.16, 0.72, 0, 2.2, 0, signM, pp);
  for (const [w, d, x, z] of [[0.7, 0.02, 0, 0.51], [0.7, 0.02, 0, -0.51], [0.02, 0.7, 0.51, 0], [0.02, 0.7, -0.51, 0]]) box(w, 1.45, d, x, 1.3, z, glassM, pp);
  phoneT = mergedTemplate("phoneBox", pp);
  const bp = [];
  const cyl = (dia, h, y, mat) => { const c = MB.CreateCylinder("c", { diameter: dia, height: h, tessellation: 14 }, scene); c.position.y = y; bp.push({ mesh: c, mat }); };
  cyl(0.62, 0.12, 0.06, blackM);
  cyl(0.52, 1.2, 0.7, red);
  cyl(0.6, 0.1, 1.33, red);
  const cap = MB.CreateSphere("cap", { diameter: 0.58, segments: 8 }, scene);
  cap.scaling.y = 0.45; cap.position.y = 1.38; bp.push({ mesh: cap, mat: red });
  box(0.28, 0.05, 0.1, 0, 1.12, 0.24, blackM, bp);
  postT = mergedTemplate("pillarBox", bp);
}
function place(tpl, x, z, yaw, hw, hd, h) {
  staticInstance(tpl, x, 0, z, yaw);
  addSolidR(x, z, yaw, hw, hd, 0, h);
}
function buildStreetLife() {
  for (const e of edges) {
    if (e.district !== "london" || e.kind === "circus") continue;
    for (const side of [-1, 1]) {
      const step = e.kind === "high" ? 13 : e.kind === "bridge" ? 0 : 22;
      if (step) {
        for (let s = 8 + lrand() * 5; s < e.len - 8; s += step) {
          if (e.kind !== "high" && lrand() < 0.65) continue;
          const p = pathAt(e, s, {});
          const off = e.w / 2 + 0.9;
          const x = p.x + p.tz * side * off, z = p.z - p.tx * side * off;
          if (asphaltDist(x, z) < 0.7 || nearLamp(x, z) || insideAnyFootprint(x, z) || riverDist(x, z) < RW + 2) continue;
          addTree(x, z, "plane", lrr(0.8, 1.05));
        }
      }
      if (e.kind === "bridge") continue;
      for (let s = 12 + lrand() * 25; s < e.len - 12; s += lrr(45, 80)) {
        const p = pathAt(e, s, {});
        const rx = p.tz * side, rz = -p.tx * side;
        const off = e.w / 2 + e.sw - 0.65;
        const x = p.x + rx * off, z = p.z + rz * off;
        if (asphaltDist(x, z) < 0.9 || nearLamp(x, z, 2.2) || insideAnyFootprint(x, z)) continue;
        const yaw = Math.atan2(-rx, -rz);
        if (lrand() < 0.5) place(phoneT, x, z, yaw, 0.56, 0.56, 2.6);
        else place(postT, x, z, yaw, 0.3, 0.3, 1.4);
      }
    }
  }
}

// ---------------------------------------------------------------- entry points
export function buildLondonWorld() {
  initMats();
  initFurniture();
  buildEmbankments();
  buildSquares();
  buildCircusFountains();
  buildClockTower();
  buildWheel();
  buildStreetLife();
}

// hours: in-game time of day (0–24)
export function updateLondon(dt, hours) {
  if (wheel) {
    wheel.ang += dt * 0.025;
    wheel.spin.rotation.z = wheel.ang;
    for (const pd of wheel.pods) {
      const a = pd.a + wheel.ang;
      pd.m.position.set(Math.cos(a) * wheel.POD, Math.sin(a) * wheel.POD, 0);
    }
  }
  if (clockTex) {
    const m = Math.floor(hours * 60);
    if (m !== clockMin) { clockMin = m; drawClock(hours); }
  }
}
