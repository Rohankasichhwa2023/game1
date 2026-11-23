// buildings.js — street-frontage placement along every (curved) road and the
// building builders: New York towers / Art Deco setbacks / brownstones,
// Paris Haussmann blocks with mansard roofs, European town houses with
// pitched roofs and gardens, plus the 10 enterable buildings with interiors.
//
// Every building is built in its own local frame (setXF): local -z is the
// street front, +z the back, so geometry and colliders follow the curves.
import {
  scene, glow, rand, rr, pick, clamp, hex, C3, litMat, texMat, indoor, canvasTex, makeAcc,
  addBox, solidBox, addSolid, addPoly, setXF, clearXF, currentXF, makeXF, xfp, xfl, mergedTemplate,
} from "./engine.js";
import { FAC, tileRoofTex, slateRoofTex, zincRoofTex, dormerTex, railingTex } from "./textures.js";
import { edges, pathAt, roadDist, districtAt, PARIS, reserved, landmarks, WORLD } from "./roads.js";
import { LON_CORE, lrand, lrr, lpick } from "./london.js";
import { planKathmandu, buildKtm, KTM_MAPC } from "./ktmBuild.js";

export const mapBuildings = [];  // minimap: {pts, color}
export const roofs = [];         // double-jump targets
export const enterables = [];
export const billboards = [];
export const gardenTrees = [];   // spots for nature.js
export const postFlush = [];
export const homes = [];          // houses you can walk into (interiors are built on entry)

const DT = { x: 300, z: -40 };   // downtown peak
let A = null;

function initMats() {
  const iLit = (n, h, sp) => indoor(litMat(n, hex(h), sp));
  const withEm = (m, h) => { m.emissiveColor = hex(h); return m; };
  const tileT = tileRoofTex(), slateT = slateRoofTex(), zincT = zincRoofTex(), railT = railingTex();
  const railM = texMat("railM2", railT, 0.2);
  railM.useAlphaFromDiffuseTexture = true;
  railM.transparencyMode = BABYLON.Material.MATERIAL_ALPHATEST;
  const dormerM = texMat("dormerM", dormerTex());

  const woodFloorTex = canvasTex("woodFloor", 256, (ctx, S) => {
    const tones = ["#a0714c", "#a87a54", "#97683f", "#b08259", "#9c6c47"];
    const ph = S / 8;
    for (let r = 0; r < 8; r++) {
      let x = -rand() * 120;
      while (x < S) {
        const len = rr(70, 140);
        ctx.fillStyle = pick(tones); ctx.fillRect(x, r * ph, len, ph);
        ctx.fillStyle = "rgba(60,35,20,0.5)"; ctx.fillRect(x, r * ph, 2, ph);
        x += len;
      }
      ctx.fillStyle = "rgba(60,35,20,0.45)"; ctx.fillRect(0, r * ph, S, 1.5);
    }
  });
  const tileFloorTex = canvasTex("tileFloor", 256, (ctx, S) => {
    ctx.fillStyle = "#dcd6ca"; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = "#cfc8ba"; ctx.fillRect(0, 0, S / 2, S / 2); ctx.fillRect(S / 2, S / 2, S / 2, S / 2);
    ctx.strokeStyle = "#a9a296"; ctx.lineWidth = 3; ctx.strokeRect(0, 0, S, S);
    ctx.beginPath(); ctx.moveTo(S / 2, 0); ctx.lineTo(S / 2, S); ctx.moveTo(0, S / 2); ctx.lineTo(S, S / 2); ctx.stroke();
  });
  const carpetTex = canvasTex("carpet", 128, (ctx, S) => {
    ctx.fillStyle = "#6d7079"; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 1500; i++) {
      ctx.fillStyle = `rgba(${rand() < 0.5 ? "40,42,50" : "140,144,155"},0.25)`;
      ctx.fillRect(rand() * S, rand() * S, 1.5, 1.5);
    }
  });

  A = {
    roof: makeAcc("roofFlat", litMat("roofFlatM", hex("#77797b"))),
    cornice: makeAcc("cornice", litMat("corniceM", hex("#b9b0a0"))),
    stone: makeAcc("stone", litMat("stoneM", hex("#e3d7bd"))),
    stoneDark: makeAcc("stoneDark", litMat("stoneDarkM", hex("#9c968a"))),
    tile: makeAcc("roofTile", texMat("roofTileM", tileT), 2.4, 2.4),
    slate: makeAcc("roofSlate", texMat("roofSlateM", slateT, 0.1), 2.4, 2.4),
    zinc: makeAcc("roofZinc", texMat("roofZincM", zincT, 0.15), 1.6, 1.6),
    ridge: makeAcc("ridge", litMat("ridgeM", hex("#5a3a2c"))),
    chimney: makeAcc("chimney", litMat("chimneyM", hex("#8a5640"))),
    pots: makeAcc("pots", litMat("potsM", hex("#b0603c"))),
    door: makeAcc("door", litMat("doorM", hex("#3b2a20"), 0.2)),
    doorTrim: makeAcc("doorTrim", litMat("doorTrimM", hex("#f2efe8"))),
    hedge: makeAcc("hedge", litMat("hedgeM", hex("#3f6a35"))),
    railing: makeAcc("railing", railM, 1, 0.96),
    dormer: makeAcc("dormer", dormerM, 1.2, 1.75),
    // interiors
    plaster: makeAcc("plaster", indoor(withEm(litMat("plasterM", hex("#e3ddd2")), "#3c3a36"))),
    ceiling: makeAcc("ceiling", indoor(withEm(litMat("ceilingM", hex("#d8d6d0")), "#46443f"))),
    rail: makeAcc("rail", iLit("railM", "#9aa0a6", 0.3)),
    wood: makeAcc("woodFloor", indoor(texMat("woodFloorM", woodFloorTex, 0.1)), 2.4, 2.4),
    tileF: makeAcc("tileFloor", indoor(texMat("tileFloorM", tileFloorTex, 0.15)), 1.6, 1.6),
    carpet: makeAcc("carpet", indoor(texMat("carpetM", carpetTex)), 2, 2),
    stairs: makeAcc("stairs", iLit("stairsM", "#a19d96")),
    metal: makeAcc("metal", iLit("metalM", "#2f3236", 0.3)),
    furnWood: makeAcc("furnWood", iLit("furnWoodM", "#8a5a3b", 0.12)),
    darkWood: makeAcc("darkWood", iLit("darkWoodM", "#4e3424", 0.12)),
    white: makeAcc("white", iLit("whiteM", "#ebe9e3", 0.15)),
    blue: makeAcc("fabricBlue", iLit("blueM", "#3f5f8a")),
    red: makeAcc("fabricRed", iLit("redM", "#8c3d3a")),
    gray: makeAcc("fabricGray", iLit("grayM", "#6f7378")),
    green: makeAcc("fabricGreen", iLit("greenM", "#4d6b48")),
    mustard: makeAcc("fabricMustard", iLit("mustardM", "#b88a2e")),
    counter: makeAcc("counter", iLit("counterM", "#bdb8ae", 0.2)),
    pot: makeAcc("pot", iLit("potM", "#7a4a32")),
    screen: makeAcc("screen", withEm(litMat("screenM", hex("#14202b"), 0.6), "#1d3f5c")),
    light: makeAcc("ceilLight", (() => { const m = new BABYLON.StandardMaterial("ceilLightM", scene); m.disableLighting = true; m.emissiveColor = hex("#fffbe8"); return m; })()),
  };
  A.fabrics = [A.blue, A.red, A.gray, A.green, A.mustard];
  // London: front doors in the classic colours, plain wall colour per facade
  A.lonDoors = ["#151515", "#7e1820", "#1d3461", "#24513a", "#d6a72c", "#5b2d4f", "#e9e5da"]
    .map((c, i) => makeAcc("lonDoor" + i, litMat("lonDoorM" + i, hex(c), 0.35)));
  A.fan = makeAcc("lonFan", litMat("lonFanM", hex("#2a3038"), 0.6));
  A.iron = makeAcc("lonIron", litMat("lonIronM", hex("#17191b"), 0.3));
  A.lonPlain = {};
  for (const [k, F] of Object.entries(FAC.lon)) A.lonPlain[k] = makeAcc("lonPlain_" + k, litMat("lonPlainM_" + k, hex(F.style.wall)));
  A.mansionPlain = makeAcc("lonPlainMansion", litMat("lonPlainMansionM", hex(FAC.lonMansion.style.wall)));
  postFlush.push(() => { for (const m of A.light.meshes) glow.addIncludedOnlyMesh(m); });
}

// ---------------------------------------------------------------- templates
let leafT, waterTowerT, spireT;
function initTemplates() {
  leafT = BABYLON.MeshBuilder.CreateSphere("leaf", { diameter: 1, segments: 5 }, scene);
  leafT.material = indoor(litMat("leafM", hex("#3f7a3a")));
  leafT.setEnabled(false);

  const MB = BABYLON.MeshBuilder;
  const woodM = litMat("wtWood", hex("#6e4c34")), darkM = litMat("wtDark", hex("#2b2622"), 0.2);
  const parts = [];
  const tank = MB.CreateCylinder("tank", { diameter: 3.2, height: 3.2, tessellation: 14 }, scene);
  tank.position.y = 4.6; parts.push({ mesh: tank, mat: woodM });
  const cone = MB.CreateCylinder("cone", { diameterTop: 0, diameterBottom: 3.6, height: 1.4, tessellation: 14 }, scene);
  cone.position.y = 6.9; parts.push({ mesh: cone, mat: darkM });
  for (const y of [3.7, 5.4]) {
    const hoop = MB.CreateCylinder("hoop", { diameter: 3.28, height: 0.1, tessellation: 14 }, scene);
    hoop.position.y = y; parts.push({ mesh: hoop, mat: darkM });
  }
  for (const [x, z] of [[-1.1, -1.1], [1.1, -1.1], [1.1, 1.1], [-1.1, 1.1]]) {
    const leg = MB.CreateBox("leg", { width: 0.18, height: 3.0, depth: 0.18 }, scene);
    leg.position.set(x, 1.5, z); parts.push({ mesh: leg, mat: darkM });
  }
  const deck = MB.CreateBox("deck", { width: 3.4, height: 0.15, depth: 3.4 }, scene);
  deck.position.y = 3.0; parts.push({ mesh: deck, mat: darkM });
  waterTowerT = mergedTemplate("waterTower", parts);

  const steel = litMat("spireM", hex("#c9ccd0"), 0.6);
  const sp1 = MB.CreateCylinder("spire", { diameterTop: 0.12, diameterBottom: 2.2, height: 24, tessellation: 8 }, scene);
  sp1.position.y = 12;
  const sp2 = MB.CreateBox("spireBase", { width: 5, height: 3, depth: 5 }, scene);
  sp2.position.y = 1.5;
  spireT = mergedTemplate("spire", [{ mesh: sp1, mat: steel }, { mesh: sp2, mat: steel }]);
}
function instanceAt(tpl, lx, ly, lz, rotY = 0, scale = 1) {
  const xf = currentXF();
  const [wx, wz] = xfp(xf, lx, lz);
  const m = tpl.createInstance("i");
  m.position.set(wx, ly, wz);
  m.rotation.y = xf.yaw + rotY;
  m.scaling.setAll(scale);
  m.freezeWorldMatrix();
  return m;
}

// ---------------------------------------------------------------- footprint index
const FG = 24;
const fgrid = new Map();
const fkey = (ix, iz) => (ix + 2000) * 8192 + (iz + 2000);
function fpCorners(fp, hwi = fp.hw, hdi = fp.hd) {
  return [[-hwi, -hdi], [hwi, -hdi], [hwi, hdi], [-hwi, hdi]].map(([x, z]) => xfp(fp.xf, x, z));
}
function fpSamples(fp, inset = 0.05) {
  const a = fp.hw - inset, b = fp.hd - inset, out = [];
  for (const x of [-a, 0, a]) for (const z of [-b, 0, b]) out.push(xfp(fp.xf, x, z));
  return out;
}
function fpCells(fp, cb) {
  const cs = fpCorners(fp);
  const xs = cs.map((c) => c[0]), zs = cs.map((c) => c[1]);
  for (let ix = Math.floor(Math.min(...xs) / FG); ix <= Math.floor(Math.max(...xs) / FG); ix++) {
    for (let iz = Math.floor(Math.min(...zs) / FG); iz <= Math.floor(Math.max(...zs) / FG); iz++) cb(fkey(ix, iz));
  }
}
function fpInside(fp, x, z, m = 0.15) {
  const [lx, lz] = xfl(fp.xf, x, z);
  return Math.abs(lx) < fp.hw - m && Math.abs(lz) < fp.hd - m;
}
function fpOverlaps(cand) {
  const seen = new Set();
  let hit = false;
  const candPts = fpSamples(cand, 0.1);
  fpCells(cand, (k) => {
    if (hit) return;
    const c = fgrid.get(k);
    if (!c) return;
    for (const o of c) {
      if (seen.has(o)) continue;
      seen.add(o);
      if (candPts.some(([x, z]) => fpInside(o, x, z))) { hit = true; return; }
      if (fpSamples(o, 0.1).some(([x, z]) => fpInside(cand, x, z))) { hit = true; return; }
    }
  });
  return hit;
}
function fpAdd(fp) {
  fpCells(fp, (k) => {
    let c = fgrid.get(k);
    if (!c) { c = []; fgrid.set(k, c); }
    c.push(fp);
  });
}
export function insideAnyFootprint(x, z) {
  const c = fgrid.get(fkey(Math.floor(x / FG), Math.floor(z / FG)));
  return !!c && c.some((fp) => fpInside(fp, x, z, -0.5));
}
function validFP(fp, district) {
  for (const [x, z] of fpSamples(fp)) {
    if (x < WORLD.x0 + 5 || x > WORLD.x1 - 5 || z < WORLD.z0 + 5 || z > WORLD.z1 - 5) return false;
    if (districtAt(x, z) !== district) return false;
    if (roadDist(x, z) < 0.12) return false;
    for (const r of reserved) if (Math.hypot(x - r.x, z - r.z) < r.r) return false;
  }
  return !fpOverlaps(fp);
}

// ---------------------------------------------------------------- planning
function planFor(e, district, px, pz) {
  if (district === "city") {
    const d = Math.hypot(px - DT.x, pz - DT.z);
    const mul = e.kind === "street" ? 0.72 : e.kind === "roundabout" ? 0.9 : 1.1;
    const h = (16 + 210 * Math.exp(-d / 240) * rr(0.5, 1.15)) * mul;
    let type;
    if (h > 120) type = pick(["glass", "glass", "deco", "deco", "office"]);
    else if (h > 60) type = pick(["glass", "office", "deco", "beige"]);
    else if (h > 30) type = pick(["brick", "brick", "beige", "office"]);
    else type = e.kind === "street" && rand() < 0.75 ? "brown" : pick(["brick", "beige"]);
    const avenue = e.kind === "avenue" || e.kind === "broadway";
    if (type === "brown") {
      return { cat: "brown", type, h, w: rr(7.8, 11), d: rr(13, 16), cellW: 2.6, setback: 0.4, gap: 0 };
    }
    return {
      cat: type === "deco" ? "deco" : "tower", type, h,
      w: rr(16, 34), d: avenue ? rr(22, 30) : e.kind === "street" ? rr(16, 26) : rr(18, 24),
      cellW: FAC[type].style.cellW, setback: 0.3, gap: 0,
      shop: avenue && ["brick", "beige", "deco"].includes(type) && rand() < 0.7,
    };
  }
  if (district === "paris") {
    const r = Math.hypot(px - PARIS.x, pz - PARIS.z);
    const inner = r < 212 || (e.kind === "radial" && r < 300) || e.kind === "plaza";
    if (inner) {
      return {
        cat: "haus", w: rr(14, 24), d: rr(12, 15), cellW: 3.0, setback: 0.25, gap: 0,
        floors: pick([4, 5, 5, 6]), shop: ["radial", "major", "plaza"].includes(e.kind) && rand() < 0.8,
      };
    }
    return {
      cat: "house", w: rr(7.8, 13), d: rr(8, 10.4), cellW: 2.6, setback: rr(3, 5), gap: rr(2, 5),
      floors: rand() < 0.55 ? 2 : 3, color: Math.floor(rand() * FAC.house.length),
      roof: rand() < 0.6 ? "tile" : "slate", ridgeX: rand() < 0.75,
    };
  }
  return null;
}

// London: terraces come in runs of identical houses (same style, height,
// door side); high streets get shops and the odd pub; mansion blocks dot the
// residential streets; the old core mixes in glass towers.
const LON_BRICK = ["stock", "stock", "stock", "red", "dark"];
const LON_STUCCO = ["white", "white", "cream", "cream", "pink", "blue", "mint", "lemon"];
function newRun(e, dCore) {
  const stucco = e.kind === "mews" ? lrand() < 0.8 : lrand() < (dCore < 320 ? 0.45 : 0.25);
  return {
    left: Math.floor(lrr(4, 10)),
    style: stucco ? lpick(LON_STUCCO) : lpick(LON_BRICK),
    floors: e.kind === "mews" ? 2 : lpick([3, 3, 4, 4, 5]),
    doorLeft: lrand() < 0.5,
    bay: lrand() < 0.45,
    w: lpick([5.2, 5.2, 7.8]),
  };
}
function planLondon(e, run, px, pz) {
  const dCore = Math.hypot(px - LON_CORE.x, pz - LON_CORE.z);
  if (dCore < 170 && e.kind !== "mews" && lrand() < 0.4 * (1 - dCore / 170) + 0.12) {
    const h = 30 + 120 * Math.exp(-dCore / 90) * lrr(0.5, 1.1);
    const type = h > 80 ? lpick(["glass", "glass", "office"]) : lpick(["glass", "office", "beige"]);
    return { cat: "tower", type, h, w: lrr(18, 30), d: lrr(18, 26), cellW: FAC[type].style.cellW, setback: 0.4, gap: 0 };
  }
  if (e.kind !== "mews" && e.kind !== "high" && lrand() < 0.09) {
    return { cat: "mansion", w: lrr(18, 30), d: lrr(13, 16), cellW: 3.0, setback: 1.2, gap: lrr(0, 3), floors: lpick([5, 5, 6]) };
  }
  if (!run.cur || run.cur.left <= 0) run.cur = newRun(e, dCore);
  const r = run.cur;
  r.left--;
  const shop = e.kind === "high" || e.kind === "circus";
  return {
    cat: "lterr", style: r.style, floors: Math.max(r.floors, shop ? 3 : 2), doorLeft: r.doorLeft,
    bay: r.bay && !shop && !FAC.lon[r.style].style.stucco,
    shop: shop ? (lrand() < 0.1 ? lpick(FAC.lonPubs) : lpick(FAC.lonShops)) : null,
    w: shop ? lpick([5.2, 7.8, 7.8]) : r.w, d: lrr(10.5, 13.5), cellW: 2.6,
    setback: shop || e.kind === "mews" ? 0.3 : 2.1, gap: 0,
    door: lrand() < 0.85 ? lpick(A.lonDoors.slice(0, 6)) : A.lonDoors[6],
  };
}

export const specs = [];
export function planBuildings(START) {
  initMats();
  initTemplates();
  for (const e of edges) {
    if (e.district === "park") continue;
    for (const side of [-1, 1]) {
      let s = 4;
      const run = {};
      while (s < e.len - 4) {
        const p = pathAt(e, s, {});
        const rx = p.tz * side, rz = -p.tx * side;
        const probeOff = e.w / 2 + e.sw + 6;
        const district = districtAt(p.x + rx * probeOff, p.z + rz * probeOff);
        const plan = district === "london"
          ? planLondon(e, run, p.x + rx * probeOff, p.z + rz * probeOff)
          : district === "kathmandu"
            ? planKathmandu(e, p.x + rx * probeOff, p.z + rz * probeOff)
            : planFor(e, district, p.x + rx * probeOff, p.z + rz * probeOff);
        if (!plan) { s += 6; continue; }
        let ok = false;
        for (let attempt = 0; attempt < 4 && !ok; attempt++) {
          const cw = plan.cellW;
          const w = Math.max(cw * 2, Math.floor((plan.w * (1 - attempt * 0.2)) / cw) * cw);
          const d = Math.max(cw * 2, Math.floor((plan.d * (attempt >= 2 ? 0.72 : 1)) / cw) * cw);
          if (s + w > e.len - 2) continue;
          const pc = pathAt(e, s + w / 2, {});
          const crx = pc.tz * side, crz = -pc.tx * side;
          const off = e.w / 2 + e.sw + plan.setback + d / 2;
          const xf = makeXF(pc.x + crx * off, pc.z + crz * off, Math.atan2(crx, crz));
          const fp = { xf, hw: w / 2, hd: d / 2 };
          if (!validFP(fp, district)) continue;
          fpAdd(fp);
          specs.push({ ...plan, xf, hw: w / 2, hd: d / 2, district, edge: e });
          s += w + plan.gap;
          ok = true;
        }
        if (!ok) { s += 3; if (run.cur) run.cur.left = 0; }
      }
    }
  }
  chooseEnterables(START);
  chooseHomes();
}

// About a third of the houses / brownstones / terraces / apartment blocks get
// a working front door. A hash of the index (not the RNG) picks them, so the
// rest of the world is unaffected.
const HOME_KINDS = { brown: "Brownstone", house: "Town house", haus: "Apartment", lterr: "Terrace house", mansion: "Mansion flat" };
function chooseHomes() {
  specs.forEach((sp, i) => {
    if (!HOME_KINDS[sp.cat] || sp.enter || sp.shop) return;
    if (((Math.imul(i + 1, 2654435761) >>> 0) % 100) >= 35) return;
    sp.home = true;
  });
}
// Enterable homes are marked so you can spot them from down the street: a
// glowing, pulsing cyan diamond over the door, two lit lanterns beside it and
// a welcome mat.
let markT = null, lampT = null, homeMarkMat = null;
function initHomeMarkers() {
  homeMarkMat = new BABYLON.StandardMaterial("homeMarkM", scene);
  homeMarkMat.disableLighting = true;
  homeMarkMat.emissiveColor = hex("#3fd0ff");
  markT = BABYLON.MeshBuilder.CreatePolyhedron("homeMark", { type: 1, size: 0.24 }, scene);
  markT.scaling.set(1, 1.6, 1); markT.bakeCurrentTransformIntoVertices();
  markT.material = homeMarkMat; markT.isPickable = false; markT.setEnabled(false);
  glow.addIncludedOnlyMesh(markT);
  const lm = new BABYLON.StandardMaterial("homeLampM", scene);
  lm.disableLighting = true; lm.emissiveColor = hex("#ffd58a");
  lampT = BABYLON.MeshBuilder.CreateBox("homeLamp", { width: 0.17, height: 0.28, depth: 0.17 }, scene);
  lampT.material = lm; lampT.isPickable = false; lampT.setEnabled(false);
  glow.addIncludedOnlyMesh(lampT);
}
export function pulseHomeMarkers(t) {
  if (!homeMarkMat) return;
  const k = 0.6 + 0.4 * Math.sin(t * 3);
  homeMarkMat.emissiveColor.set(0.25 * k, 0.82 * k, 1.0 * k);
}
function markDoor(sp, dx) {
  if (!markT) initHomeMarkers();
  const { hd } = sp;
  const H = { brown: [4.4, 2.8, 1.0], house: [3.4, 2.15, 0.95], lterr: [4.1, 2.3, 0.95], haus: [4.1, 2.5, 1.15], mansion: [4.5, 2.4, 1.5] }[sp.cat];
  const inst = (t, lx, y, lz) => {
    const [x, z] = xfp(sp.xf, lx, lz);
    const m = t.createInstance("hm");
    m.position.set(x, y, z); m.rotation.y = sp.xf.yaw; m.isPickable = false; m.freezeWorldMatrix();
  };
  inst(markT, dx, H[0], -hd - 0.5);
  setXF(sp.xf);
  for (const sx of [-1, 1]) {
    inst(lampT, dx + sx * H[2], H[1], -hd - 0.2);
    addBox(dx + sx * H[2] - 0.03, H[1] + 0.12, -hd - 0.22, dx + sx * H[2] + 0.03, H[1] + 0.18, -hd, A.iron);
  }
  if (sp.cat === "house") addBox(-0.55, 0.165, -hd - 0.6, 0.55, 0.185, -hd - 0.05, A.red);
  else if (sp.cat === "haus" || sp.cat === "mansion") addBox(-0.6, 0.01, -hd - 0.85, 0.6, 0.035, -hd - 0.1, A.red);
  clearXF();
}
function registerHome(sp) {
  const { hw, hd } = sp;
  let dx = 0, stoop = 0.9;
  if (sp.cat === "brown") { dx = hw > 4.5 ? -hw + 1.3 : 0; stoop = 1.9; }
  else if (sp.cat === "lterr") dx = sp.doorLeft ? -hw + 1.3 : hw - 1.3;
  const [tx, tz] = xfp(sp.xf, dx, -hd - stoop * 0.6);
  const [ox, oz] = xfp(sp.xf, dx, -hd - stoop - 0.7);
  markDoor(sp, dx);
  homes.push({
    kind: sp.cat, label: HOME_KINDS[sp.cat], no: homes.length + 1, district: sp.district,
    hw, hd, floors: sp.floors ?? 3, doorLX: dx, style: sp.style,
    tx, tz, ox, oz, outYaw: sp.xf.yaw + Math.PI,
  });
}

// Interiors reuse the furniture builders below, pointed at a fresh set of
// accumulators (same materials) so nothing merges into the city meshes.
export function furnishWith(makeAcc2, fn) {
  const prev = A, memo = new Map();
  const map = (v) => {
    if (!v || typeof v !== "object") return v;
    if (v.mat) { if (!memo.has(v)) memo.set(v, makeAcc2(v)); return memo.get(v); }
    if (Array.isArray(v)) return v.map(map);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, map(x)]));
  };
  A = map(prev);
  try { fn(A, FURN); } finally { A = prev; }
  return [...memo.values()];
}
const FURN = { bed, sofa, table, chair, desk, bookshelf, plant, item, bedroom, living, kitchen, partition };

// ---------------------------------------------------------------- enterables selection
const FLOOR_TIERS = [3, 3, 4, 5, 6, 7, 9, 11, 14, 18];
const NAMES_APT = ["Harbor Apartments", "Pine Street Lofts", "Bayview House", "Cedar Court", "Elm Residences"];
const NAMES_OFF = ["Mercer Tower", "Atlas Offices", "Orion Plaza", "Summit Center", "Meridian Tower", "Union Works"];
function chooseEnterables(START) {
  const cands = specs
    .filter((s) => s.district === "city" && s.cat === "tower" && s.hw * 2 >= 16.4 && s.hd * 2 >= 16.4)
    .sort((a, b) => Math.hypot(a.xf.cx - START.x, a.xf.cz - START.z) - Math.hypot(b.xf.cx - START.x, b.xf.cz - START.z));
  const chosen = [];
  const tiers = FLOOR_TIERS.slice().sort(() => rand() - 0.5);
  let ai = 0, oi = 0;
  for (const s of cands) {
    if (!tiers.length) break;
    if (chosen.some((c) => Math.hypot(c.xf.cx - s.xf.cx, c.xf.cz - s.xf.cz) < 45)) continue;
    const F = tiers[tiers.length - 1];
    const kind = F <= 7 && rand() < 0.6 ? "apartment" : "office";
    const type = kind === "apartment" ? (F <= 4 ? "brick" : "beige") : F <= 6 ? "office" : "glass";
    const cw = FAC[type].style.cellW;
    const w = Math.floor((s.hw * 2) / cw) * cw, d = Math.floor((s.hd * 2) / cw) * cw;
    if (w < 16 || d < 16) continue;
    tiers.pop();
    s.enter = {
      F, kind, type,
      name: kind === "apartment" ? NAMES_APT[ai++ % NAMES_APT.length] : NAMES_OFF[oi++ % NAMES_OFF.length],
    };
    s.hw = w / 2; s.hd = d / 2;
    chosen.push(s);
  }
}

// ---------------------------------------------------------------- builders
// Facade box: facade on the 4 sides, `top` on the roof, UVs anchored at (x0,y0,z0).
function fbox(F, x0, y0, z0, x1, y1, z1, top = A.roof) {
  addBox(x0, y0, z0, x1, y1, z1, (dir) => (dir === "+y" ? top : dir === "-y" ? null : F.out), { x: x0, y: y0, z: z0 });
}

function buildTower(sp) {
  const F = FAC[sp.type], ch = F.style.cellH;
  const { hw, hd } = sp;
  const base = sp.shop ? 4.5 : 0;
  const h = base + Math.max(2, Math.round((sp.h - base) / ch)) * ch;
  if (sp.shop) fbox(FAC.shopCity, -hw, 0, -hd, hw, base, hd, null);
  fbox(F, -hw, base, -hd, hw, h, hd);
  addSolid(-hw, 0, -hd, hw, h + 0.55, hd);
  const brickish = sp.type === "brick" || sp.type === "beige";
  if (brickish) addBox(-hw - 0.35, h - 0.2, -hd - 0.35, hw + 0.35, h + 0.55, hd + 0.35, A.cornice);
  else addBox(-hw - 0.15, h, -hd - 0.15, hw + 0.15, h + 0.55, hd + 0.15, A.roof);
  const top = h + 0.55, mechs = [];
  if (h > 45) {
    const n = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const mw = rr(3, hw * 0.7), md = rr(3, hd * 0.7), mh = rr(2, 5);
      const mx = rr(-hw / 2, hw / 2), mz = rr(-hd / 2, hd / 2);
      solidBox(mx - mw / 2, top, mz - md / 2, mx + mw / 2, top + mh, mz + md / 2, A.roof);
      mechs.push({ x: mx, z: mz, r: Math.max(mw, md) / 2 + 1 });
    }
  }
  if (brickish && h < 95 && rand() < 0.6) {
    const wx = rr(-hw + 3, hw - 3), wz = rr(-hd + 3, hd - 3);
    if (!mechs.some((m) => Math.hypot(m.x - wx, m.z - wz) < m.r + 2.5)) {
      instanceAt(waterTowerT, wx, top, wz, rr(0, 6), rr(0.9, 1.15));
      addSolid(wx - 1.8, top, wz - 1.8, wx + 1.8, top + 7.5, wz + 1.8);
      mechs.push({ x: wx, z: wz, r: 3 });
    }
  }
  sp.h = h;
  roofs.push({ xf: sp.xf, hw, hd, lhw: hw - 1.5, lhd: hd - 1.5, top, mechs });
}

function buildDeco(sp) {
  const F = FAC.deco, cw = F.style.cellW, ch = F.style.cellH;
  const { hw, hd } = sp;
  const H = Math.max(14 * ch, Math.round(sp.h / ch) * ch);
  let y = 0, firstTop = 0, tw = hw, td = hd;
  const tiers = [[0.58, 1], [0.24, 0.74], [0.12, 0.5]];
  tiers.forEach(([frac, ins], i) => {
    const th = Math.max(2, Math.round((H * frac) / ch)) * ch;
    tw = Math.max(cw, Math.floor((hw * 2 * ins) / cw / 2) * cw);
    td = Math.max(cw, Math.floor((hd * 2 * ins) / cw / 2) * cw);
    if (i === 0 && sp.shop) {
      fbox(FAC.shopCity, -tw, 0, -td, tw, 4.5, td, null);
      fbox(F, -tw, 4.5, -td, tw, th, td);
    } else fbox(F, -tw, y, -td, tw, y + th, td);
    addSolid(-tw, y, -td, tw, y + th + 0.45, td);
    addBox(-tw - 0.3, y + th, -td - 0.3, tw + 0.3, y + th + 0.45, td + 0.3, A.cornice);
    y += th;
    if (i === 0) firstTop = y + 0.45;
  });
  if (H > 110) instanceAt(spireT, 0, y + 0.45, 0, 0, clamp(H / 170, 0.8, 1.5));
  sp.h = y;
  roofs.push({ xf: sp.xf, hw, hd, lhw: hw - 1.2, lhd: hd - 1.2, top: firstTop, mechs: [], landing: { x: -hw + 2.2, z: -hd + 1.6 } });
}

function buildBrown(sp) {
  const F = FAC.brown;
  const { hw, hd } = sp;
  const h = (rand() < 0.5 ? 3 : 4) * F.style.cellH;
  fbox(F, -hw, 0, -hd, hw, h, hd);
  addSolid(-hw, 0, -hd, hw, h + 0.6, hd);
  addBox(-hw - 0.05, h - 0.1, -hd - 0.5, hw + 0.05, h + 0.6, hd + 0.05, A.ridge);   // heavy cornice
  // stoop + door
  const dx = hw > 4.5 ? -hw + 1.3 : 0;
  for (let k = 0; k < 4; k++) solidBox(dx - 0.8, 0, -hd - 0.4 - (3 - k) * 0.35, dx + 0.8, 0.22 * (k + 1), -hd - 0.4 - (3 - k) * 0.35 + 0.36, A.stoneDark);
  solidBox(dx - 0.8, 0, -hd - 0.4, dx + 0.8, 0.9, -hd, A.stoneDark);
  addBox(dx - 0.55, 0.9, -hd - 0.06, dx + 0.55, 3.1, -hd, A.door);
  let top = h + 0.6;
  const mechs = [];
  if (rand() < 0.2) { instanceAt(waterTowerT, 0, top, hd * 0.3, 0, 0.8); mechs.push({ x: 0, z: hd * 0.3, r: 2.6 }); }
  roofs.push({ xf: sp.xf, hw, hd, lhw: hw - 1, lhd: hd - 1, top, mechs });
}

function buildHaus(sp) {
  const F = FAC.haus, FH = F.style.cellH, GF = 4.5;
  const { hw, hd, floors } = sp;
  const H = GF + floors * FH;
  if (sp.shop) fbox(pick(FAC.shopParis), -hw, 0, -hd, hw, GF, hd, null);
  else fbox(F, -hw, 0, -hd, hw, GF, hd, null);
  if (sp.home) {                                                       // street door
    addBox(-1.0, 0, -hd - 0.08, 1.0, 3.3, -hd, A.stone);
    addBox(-0.75, 0.02, -hd - 0.13, 0.75, 3.0, -hd, A.door);
  }
  fbox(F, -hw, GF, -hd, hw, H, hd, null);
  addBox(-hw - 0.12, GF - 0.12, -hd - 0.12, hw + 0.12, GF + 0.12, hd + 0.12, A.stone);       // string course
  addBox(-hw - 0.3, H - 0.1, -hd - 0.3, hw + 0.3, H + 0.45, hd + 0.3, A.stone);             // cornice
  // continuous balconies on the 2nd and top floors (street side)
  for (const fl of new Set([1, floors - 1])) {
    const y = GF + fl * FH;
    addBox(-hw + 0.25, y - 0.04, -hd - 0.62, hw - 0.25, y + 0.12, -hd, A.stone);
    addBox(-hw + 0.25, y + 0.12, -hd - 0.62, hw - 0.25, y + 1.05, -hd - 0.58, A.railing, { x: 0, y: y + 0.12, z: 0 });
  }
  // mansard roof
  const y0 = H + 0.45, mh = 3.0, m = 1.5;
  const b = [[-hw + 0.1, y0, -hd + 0.1], [hw - 0.1, y0, -hd + 0.1], [hw - 0.1, y0, hd - 0.1], [-hw + 0.1, y0, hd - 0.1]];
  const t = [[-hw + m, y0 + mh, -hd + m], [hw - m, y0 + mh, -hd + m], [hw - m, y0 + mh, hd - m], [-hw + m, y0 + mh, hd - m]];
  const ref = [0, y0 + 0.5, 0];
  const uv = (p) => [(p[0] + p[2]) / 1.6, p[1] / 1.6];
  for (let i = 0; i < 4; i++) addPoly(A.zinc, [b[i], b[(i + 1) % 4], t[(i + 1) % 4], t[i]], ref, uv);
  addPoly(A.roof, [t[0], t[1], t[2], t[3]], [0, y0, 0], (p) => [p[0] / 4, p[2] / 4]);
  // dormers on the front and back slopes
  const n = Math.max(1, Math.floor((hw * 2 - 2.5) / 3));
  for (let k = 0; k < n; k++) {
    const x = -((n - 1) * 3) / 2 + k * 3;
    for (const sd of [-1, 1]) {
      const zf = sd * (hd - 0.45), zb = sd * (hd - 1.6);
      const face = sd < 0 ? "-z" : "+z";
      addBox(x - 0.6, y0 + 0.2, Math.min(zf, zb), x + 0.6, y0 + 1.95, Math.max(zf, zb),
        (dir) => (dir === face ? A.dormer : dir === "-y" ? null : A.zinc), { x: x - 0.6, y: y0 + 0.2, z: 0 });
      addBox(x - 0.75, y0 + 1.95, Math.min(zf - sd * 0.1, zb), x + 0.75, y0 + 2.12, Math.max(zf - sd * 0.1, zb), A.zinc);
    }
  }
  // chimney stacks
  const mechs = [];
  for (const cx of [-(hw - m - 0.8), hw - m - 0.8]) {
    if (rand() < 0.25) continue;
    solidBox(cx - 0.45, y0 + mh, -0.8, cx + 0.45, y0 + mh + 1.3, 0.8, A.chimney);
    for (const pz of [-0.45, 0, 0.45]) addBox(cx - 0.12, y0 + mh + 1.3, pz - 0.12, cx + 0.12, y0 + mh + 1.62, pz + 0.12, A.pots);
    mechs.push({ x: cx, z: 0, r: 1.6 });
  }
  addSolid(-hw, 0, -hd, hw, y0 + mh, hd);
  roofs.push({ xf: sp.xf, hw, hd, lhw: hw - m - 0.3, lhd: hd - m - 0.3, top: y0 + mh, mechs });
}

function buildHouse(sp) {
  const F = FAC.house[sp.color], FH = F.style.cellH;
  const { hw, hd } = sp;
  const H = sp.floors * FH;
  fbox(F, -hw, 0, -hd, hw, H, hd, null);
  addSolid(-hw, 0, -hd, hw, H, hd);
  addBox(-hw - 0.05, 0, -hd - 0.05, hw + 0.05, 0.45, hd + 0.05, A.stoneDark);          // plinth
  addBox(-0.72, 0.05, -hd - 0.05, 0.72, 2.5, -hd, A.doorTrim);
  addBox(-0.55, 0.12, -hd - 0.09, 0.55, 2.35, -hd, A.door);
  solidBox(-0.9, 0, -hd - 0.65, 0.9, 0.16, -hd, A.stoneDark);
  // pitched roof
  const roofAcc = sp.roof === "tile" ? A.tile : A.slate;
  const ov = 0.45, pitch = 0.8;
  const gableUV = () => [0.004, 0.004];
  if (sp.ridgeX) {
    const R = H + (hd + ov) * pitch;
    for (const sd of [-1, 1]) {
      addPoly(roofAcc, [[-hw - ov, H, sd * (hd + ov)], [hw + ov, H, sd * (hd + ov)], [hw + ov, R, 0], [-hw - ov, R, 0]],
        [0, H, 0], (p) => [p[0] / 2.4, (p[1] - H) * 1.28 / 2.4]);
      addPoly(F.out, [[sd * hw, H, -hd], [sd * hw, H, hd], [sd * hw, R - ov * pitch, 0]], [0, H, 0], gableUV);
    }
    addBox(-hw - ov, R - 0.08, -0.16, hw + ov, R + 0.1, 0.16, A.ridge);
    addSolid(-hw, H, -hd / 2, hw, H + (hd / 2) * pitch, hd / 2);
    const cx = rr(-hw + 1, hw - 1);
    addBox(cx - 0.4, H, hd * 0.25, cx + 0.4, R + 0.9, hd * 0.25 + 0.8, A.chimney);
  } else {
    const R = H + (hw + ov) * pitch;
    for (const sd of [-1, 1]) {
      addPoly(roofAcc, [[sd * (hw + ov), H, -hd - ov], [sd * (hw + ov), H, hd + ov], [0, R, hd + ov], [0, R, -hd - ov]],
        [0, H, 0], (p) => [p[2] / 2.4, (p[1] - H) * 1.28 / 2.4]);
      addPoly(F.out, [[-hw, H, sd * hd], [hw, H, sd * hd], [0, R - ov * pitch, sd * hd]], [0, H, 0], gableUV);
    }
    addBox(-0.16, R - 0.08, -hd - ov, 0.16, R + 0.1, hd + ov, A.ridge);
    addSolid(-hw / 2, H, -hd, hw / 2, H + (hw / 2) * pitch, hd);
    const cz = rr(-hd + 1, hd - 1);
    addBox(hw * 0.25, H, cz - 0.4, hw * 0.25 + 0.8, R + 0.9, cz + 0.4, A.chimney);
  }
  // front garden hedge with a gate gap + garden path
  const zEdge = -hd - sp.setback + 0.4;
  if (sp.setback > 2) {
    solidBox(-hw - 0.6, 0, zEdge - 0.3, -0.75, 0.95, zEdge + 0.3, A.hedge);
    solidBox(0.75, 0, zEdge - 0.3, hw + 0.6, 0.95, zEdge + 0.3, A.hedge);
    addBox(-0.55, 0.01, zEdge, 0.55, 0.06, -hd - 0.65, A.stoneDark);
  }
  const [gx, gz] = xfp(sp.xf, rr(-hw + 1, hw - 1), hd + rr(2.5, 4.5));
  gardenTrees.push([gx, gz]);
}

// ---------------------------------------------------------------- London
// Terrace house: brick or stucco front, stone cornice, parapet hiding a flat
// roof, chimney stack on the party wall, panelled door with fanlight and
// steps, black railings round the front area; optional bay window or shop.
function buildLTerrace(sp) {
  const F = FAC.lon[sp.style], FH = F.style.cellH, P = A.lonPlain[sp.style];
  const { hw, hd } = sp;
  const GF = sp.shop ? 4.2 : FH;
  const H = GF + (sp.floors - 1) * FH;
  const wallFace = (dir) => (dir === "+y" || dir === "-y" ? null : F.out);
  if (sp.shop) {
    fbox(sp.shop, -hw, 0, -hd, hw, GF, hd, null);
    // upper floors keep the facade's own floor rows (UV origin one storey down)
    addBox(-hw, GF, -hd, hw, H, hd, wallFace, { x: -hw, y: GF - FH, z: -hd });
    addBox(-hw - 0.05, GF - 0.05, -hd - 0.35, hw + 0.05, GF + 0.12, -hd, A.stoneDark);   // shop cornice
  } else {
    fbox(F, -hw, 0, -hd, hw, H, hd, null);
    addBox(-hw - 0.03, 0, -hd - 0.04, hw + 0.03, 0.45, -hd, A.stoneDark);                // plinth
  }
  addSolid(-hw, 0, -hd, hw, H + 0.9, hd);
  // cornice + parapet + flat roof
  addBox(-hw - 0.02, H - 0.12, -hd - 0.22, hw + 0.02, H + 0.12, -hd, A.stone);
  addBox(-hw, H, -hd, hw, H + 0.9, hd, (dir) => (dir === "+y" ? A.roof : dir === "-y" ? null : P));
  addBox(-hw - 0.02, H + 0.9, -hd - 0.06, hw + 0.02, H + 1.0, hd + 0.02, A.stone);
  // chimney stack straddling the +x party wall, with a row of pots
  const top = H + 1.0;
  solidBox(hw - 0.42, top, -1.5, hw + 0.42, top + 1.7, 1.5, P);
  addBox(hw - 0.5, top + 1.6, -1.58, hw + 0.5, top + 1.8, 1.58, A.stone);
  for (const pz of [-1.05, -0.35, 0.35, 1.05]) addBox(hw - 0.13, top + 1.8, pz - 0.13, hw + 0.13, top + 2.25, pz + 0.13, A.pots);
  roofs.push({ xf: sp.xf, hw, hd, lhw: hw - 0.8, lhd: hd - 0.8, top, mechs: [{ x: hw, z: 0, r: 1.9 }] });
  sp.h = top;
  if (sp.shop) return;

  // front door bay
  const dx = sp.doorLeft ? -hw + 1.3 : hw - 1.3;
  addBox(dx - 0.78, 0.3, -hd - 0.07, dx + 0.78, 3.1, -hd, A.doorTrim);
  addBox(dx - 0.55, 0.32, -hd - 0.11, dx + 0.55, 2.5, -hd, sp.door);
  addBox(dx - 0.5, 2.58, -hd - 0.11, dx + 0.5, 2.98, -hd, A.fan);
  addBox(dx - 0.04, 1.35, -hd - 0.16, dx + 0.04, 1.47, -hd - 0.1, A.pots);              // knocker
  solidBox(dx - 0.85, 0, -hd - 0.95, dx + 0.85, 0.16, -hd, A.stoneDark);
  solidBox(dx - 0.85, 0.16, -hd - 0.55, dx + 0.85, 0.3, -hd, A.stoneDark);
  if (F.style.stucco) {
    // portico: two columns carrying a little entablature
    for (const sx of [-0.78, 0.78]) solidBox(dx + sx - 0.14, 0.3, -hd - 1.0, dx + sx + 0.14, 3.15, -hd - 0.72, A.doorTrim);
    addBox(dx - 1.05, 3.15, -hd - 1.12, dx + 1.05, 3.45, -hd, A.doorTrim);
  }
  // bay window on the other bay (two storeys)
  if (sp.bay && hw * 2 >= 5.1) {
    const bx = sp.doorLeft ? hw - 1.3 : -hw + 1.3;
    addBox(bx - 1.3, 0.3, -hd - 0.75, bx + 1.3, 2 * FH - 0.25, -hd,
      (dir) => (dir === "+y" ? A.slate : dir === "-y" ? null : F.out), { x: bx - 1.3, y: 0, z: -hd - 0.75 });
    addBox(bx - 1.36, 2 * FH - 0.3, -hd - 0.82, bx + 1.36, 2 * FH - 0.15, -hd, A.stone);
    addSolid(bx - 1.3, 0, -hd - 0.75, bx + 1.3, 2 * FH, -hd);
  }
  // area railings along the front, with a gap at the steps
  if (sp.setback > 1.5) {
    const zr = -hd - sp.setback + 0.3;
    for (const [x0, x1] of [[-hw, dx - 0.95], [dx + 0.95, hw]]) {
      if (x1 - x0 < 0.2) continue;
      addBox(x0, 0, zr - 0.03, x1, 1.05, zr + 0.03, A.railing, { x: 0, y: 0, z: 0 });
      addBox(x0, 1.0, zr - 0.05, x1, 1.08, zr + 0.05, A.iron);
      addSolid(x0, 0, zr - 0.05, x1, 1.08, zr + 0.05);
    }
    for (const sx of [dx - 0.95, dx + 0.95]) solidBox(sx - 0.07, 0, zr - 0.07, sx + 0.07, 1.25, zr + 0.07, A.iron);
  }
}

// Edwardian mansion block: red brick + stone bands, slate roof with gables.
function buildMansion(sp) {
  const F = FAC.lonMansion, FH = F.style.cellH, P = A.mansionPlain;
  const { hw, hd } = sp;
  const H = sp.floors * FH;
  fbox(F, -hw, 0, -hd, hw, H, hd, null);
  addSolid(-hw, 0, -hd, hw, H, hd);
  addBox(-hw - 0.05, 0, -hd - 0.05, hw + 0.05, 0.6, hd + 0.05, A.stoneDark);
  addBox(-hw - 0.25, H - 0.15, -hd - 0.25, hw + 0.25, H + 0.2, hd + 0.25, A.stone);
  // entrance
  addBox(-1.3, 0.05, -hd - 0.4, 1.3, 3.6, -hd, A.stone);
  addBox(-0.9, 0.05, -hd - 0.45, 0.9, 2.9, -hd, A.door);
  addBox(-1.6, 3.6, -hd - 0.9, 1.6, 3.85, -hd, A.stone);
  // slate roof, ridge parallel to the street
  const ov = 0.35, pitch = 0.75, R = H + (hd + ov) * pitch;
  const g = [0.004, 0.004];
  for (const sd of [-1, 1]) {
    addPoly(A.slate, [[-hw - ov, H, sd * (hd + ov)], [hw + ov, H, sd * (hd + ov)], [hw + ov, R, 0], [-hw - ov, R, 0]],
      [0, H, 0], (p) => [p[0] / 2.4, (p[1] - H) * 1.25 / 2.4]);
    addPoly(P, [[sd * hw, H, -hd], [sd * hw, H, hd], [sd * hw, R - ov * pitch, 0]], [0, H, 0], () => g);
  }
  addBox(-hw - ov, R - 0.08, -0.16, hw + ov, R + 0.1, 0.16, A.ridge);
  addSolid(-hw, H, -hd / 2, hw, H + (hd / 2) * pitch, hd / 2);
  // street-facing gables
  const n = Math.max(1, Math.floor((hw * 2) / 9));
  for (let k = 0; k < n; k++) {
    const gx = -hw + (hw * 2 * (k + 0.5)) / n, gw = 2.6, gh = 3.4, z0 = -hd - 0.02, z1 = -hd + 4.2;
    addPoly(P, [[gx - gw, H, z0], [gx + gw, H, z0], [gx, H + gh, z0]], [gx, H, z1], () => g);
    for (const sd of [-1, 1]) {
      addPoly(A.slate, [[gx + sd * (gw + 0.25), H - 0.15, z0 - 0.25], [gx, H + gh + 0.2, z0 - 0.25], [gx, H + gh + 0.2, z1], [gx + sd * (gw + 0.25), H - 0.15, z1]],
        [gx, H, z1 + 2], (p) => [p[2] / 2.4, p[1] / 2.4]);
    }
    addBox(gx - 0.5, H + 0.6, z0 - 0.08, gx + 0.5, H + 2.0, z0, A.fan);              // gable window
  }
  for (const cx of [-hw + 1.5, hw - 1.5]) {
    addBox(cx - 0.5, H, -0.6, cx + 0.5, R + 1.4, 0.6, P);
    for (const pz of [-0.3, 0.3]) addBox(cx - 0.14, R + 1.4, pz - 0.14, cx + 0.14, R + 1.85, pz + 0.14, A.pots);
  }
  sp.h = R;
}

// ---------------------------------------------------------------- enterable buildings
function plant(cx, cz, y, big = false) {
  const s = big ? 1.25 : 1;
  solidBox(cx - 0.225 * s, y, cz - 0.225 * s, cx + 0.225 * s, y + 0.45 * s, cz + 0.225 * s, A.pot);
  const leaf = instanceAt(leafT, cx, y + 0.85 * s, cz);
  leaf.unfreezeWorldMatrix();
  leaf.scaling.set(0.75 * s, 0.95 * s, 0.75 * s);
  leaf.freezeWorldMatrix();
}
function item(cx, cz, y, w, d, h, acc, solid = true) {
  (solid ? solidBox : addBox)(cx - w / 2, y, cz - d / 2, cx + w / 2, y + h, cz + d / 2, acc);
}
function bed(cx, cz, y, alongZ) {
  const w = alongZ ? 1.6 : 2.1, d = alongZ ? 2.1 : 1.6;
  solidBox(cx - w / 2, y, cz - d / 2, cx + w / 2, y + 0.38, cz + d / 2, A.darkWood);
  addBox(cx - w / 2 + 0.05, y + 0.38, cz - d / 2 + 0.05, cx + w / 2 - 0.05, y + 0.55, cz + d / 2 - 0.05, A.white);
  const blanket = pick(A.fabrics);
  if (alongZ) {
    addBox(cx - w / 2 + 0.02, y + 0.4, cz - d / 2 + 0.02, cx + w / 2 - 0.02, y + 0.58, cz + 0.25, blanket);
    addBox(cx - 0.6, y + 0.55, cz + d / 2 - 0.5, cx + 0.6, y + 0.68, cz + d / 2 - 0.12, A.white);
    solidBox(cx - w / 2, y, cz + d / 2, cx + w / 2, y + 1.05, cz + d / 2 + 0.08, A.darkWood);
  } else {
    addBox(cx - w / 2 + 0.02, y + 0.4, cz - d / 2 + 0.02, cx + 0.25, y + 0.58, cz + d / 2 - 0.02, blanket);
    addBox(cx + w / 2 - 0.5, y + 0.55, cz - 0.6, cx + w / 2 - 0.12, y + 0.68, cz + 0.6, A.white);
    solidBox(cx + w / 2, y, cz - d / 2, cx + w / 2 + 0.08, y + 1.05, cz + d / 2, A.darkWood);
  }
}
function sofa(cx, cz, y, faceZ, fab) {
  const w = 2.2, d = 0.9;
  solidBox(cx - w / 2, y, cz - d / 2, cx + w / 2, y + 0.45, cz + d / 2, fab);
  const bz = faceZ > 0 ? cz - d / 2 : cz + d / 2 - 0.25;
  solidBox(cx - w / 2, y + 0.45, bz, cx + w / 2, y + 0.9, bz + 0.25, fab);
  addBox(cx - w / 2, y + 0.45, cz - d / 2, cx - w / 2 + 0.2, y + 0.65, cz + d / 2, fab);
  addBox(cx + w / 2 - 0.2, y + 0.45, cz - d / 2, cx + w / 2, y + 0.65, cz + d / 2, fab);
}
function table(cx, cz, y, w, d, h, top = A.furnWood) {
  addBox(cx - w / 2, y + h - 0.05, cz - d / 2, cx + w / 2, y + h, cz + d / 2, top);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const lx = cx + sx * (w / 2 - 0.08), lz = cz + sz * (d / 2 - 0.08);
    addBox(lx - 0.035, y, lz - 0.035, lx + 0.035, y + h - 0.05, lz + 0.035, A.metal);
  }
  addSolid(cx - w / 2, y, cz - d / 2, cx + w / 2, y + h, cz + d / 2);
}
function chair(cx, cz, y, bz, fab = A.darkWood) {
  item(cx, cz, y, 0.45, 0.45, 0.46, fab);
  const z0 = bz > 0 ? cz + 0.17 : cz - 0.225, z1 = bz < 0 ? cz - 0.17 : cz + 0.225;
  addBox(cx - 0.225, y + 0.46, z0, cx + 0.225, y + 0.95, z1, fab);
}
function desk(cx, cz, y, faceZ) {
  table(cx, cz, y, 1.4, 0.75, 0.75, A.white);
  const mz = cz - faceZ * 0.22;
  addBox(cx - 0.3, y + 0.82, mz - 0.025, cx + 0.3, y + 1.18, mz + 0.025, A.screen);
  addBox(cx - 0.04, y + 0.75, mz - 0.04, cx + 0.04, y + 0.82, mz + 0.04, A.metal);
  chair(cx, cz + faceZ * 0.7, y, faceZ, A.gray);
}
function bookshelf(cx, cz, y) {
  item(cx, cz, y, 1.0, 0.4, 1.9, A.darkWood);
  for (let s = 0; s < 4; s++) {
    let x = cx - 0.45;
    while (x < cx + 0.4) {
      const bw = rr(0.04, 0.09);
      addBox(x, y + 0.12 + s * 0.45, cz - 0.21, x + bw, y + 0.12 + s * 0.45 + rr(0.24, 0.34), cz + 0.21, pick(A.fabrics));
      x += bw + 0.01;
    }
  }
}
const cornersOf = (r, m) => [[r.x0 + m, r.z0 + m], [r.x1 - m, r.z0 + m], [r.x0 + m, r.z1 - m], [r.x1 - m, r.z1 - m]];
const roomC = (r) => [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2];
function bedroom(r, y) {
  const [cx, cz] = roomC(r);
  bed(cx, cz, y, rand() < 0.5);
  const cs = cornersOf(r, 0.75);
  item(cs[0][0], cs[0][1], y, 1.1, 0.6, 2.0, A.furnWood);
  plant(cs[3][0], cs[3][1], y);
  item(cs[1][0], cs[1][1], y, 0.5, 0.45, 0.55, A.furnWood);
}
function living(r, y) {
  const [cx, cz] = roomC(r);
  sofa(cx, cz - 0.9, y, 1, pick(A.fabrics));
  table(cx, cz + 0.4, y, 1.1, 0.6, 0.42, A.darkWood);
  item(cx, cz + 1.7, y, 1.6, 0.45, 0.45, A.darkWood);
  addBox(cx - 0.7, y + 0.5, cz + 1.8, cx + 0.7, y + 1.3, cz + 1.86, A.screen);
  const cs = cornersOf(r, 0.65);
  plant(cs[0][0], cs[0][1], y, true);
  bookshelf(cs[1][0], cs[1][1] - 0.1, y);
}
function kitchen(r, y) {
  const [cx, cz] = roomC(r);
  table(cx, cz, y, 1.6, 0.9, 0.76);
  for (const dx of [-0.45, 0.45]) { chair(cx + dx, cz - 0.75, y, -1); chair(cx + dx, cz + 0.75, y, 1); }
  const cs = cornersOf(r, 0.4);
  const [kx, kz] = cs[3];
  item(kx - 1.2, kz, y, 2.4, 0.6, 0.9, A.counter);
  item(cs[1][0], cs[1][1], y, 0.75, 0.7, 1.9, A.white);
}
function offices(r, y) {
  const [cx, cz] = roomC(r);
  for (const dx of [-0.72, 0.72]) { desk(cx + dx, cz - 0.4, y, -1); desk(cx + dx, cz + 0.4, y, 1); }
  const cs = cornersOf(r, 0.6);
  plant(cs[0][0], cs[0][1], y, true);
  plant(cs[3][0], cs[3][1], y);
  item(cs[1][0], cs[1][1], y, 0.5, 0.6, 1.3, A.gray);
}
function meeting(r, y) {
  const [cx, cz] = roomC(r);
  table(cx, cz, y, 3.0, 1.2, 0.76, A.white);
  for (const dx of [-1.0, 0, 1.0]) { chair(cx + dx, cz - 0.95, y, -1, A.gray); chair(cx + dx, cz + 0.95, y, 1, A.gray); }
  const cs = cornersOf(r, 0.6);
  plant(cs[1][0], cs[1][1], y, true);
  plant(cs[3][0], cs[3][1], y);
}
function partition(alongX, fixed, a0, a1, gaps, y0, y1) {
  const T2 = 0.075, GW = 0.7, DH = 2.3;
  let s = a0;
  const seg = (b0, b1, yy0, yy1) => {
    if (b1 - b0 < 0.02) return;
    if (alongX) solidBox(b0, yy0, fixed - T2, b1, yy1, fixed + T2, A.plaster);
    else solidBox(fixed - T2, yy0, b0, fixed + T2, yy1, b1, A.plaster);
  };
  for (const g of gaps.slice().sort((p, q) => p - q)) { seg(s, g - GW, y0, y1); seg(g - GW, g + GW, y0 + DH, y1); s = g + GW; }
  seg(s, a1, y0, y1);
}
function makeSign(text, lx, y, lz) {
  const xf = currentXF();
  const tex = new BABYLON.DynamicTexture("sign", { width: 512, height: 96 }, scene, true);
  const ctx = tex.getContext();
  ctx.fillStyle = "#1c1e22"; ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = "#ffd36b"; ctx.font = "bold 46px Segoe UI, Arial, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text.toUpperCase(), 256, 50);
  tex.update();
  const m = new BABYLON.StandardMaterial("signM", scene);
  m.diffuseTexture = tex; m.emissiveTexture = tex; m.disableLighting = true;
  const p = BABYLON.MeshBuilder.CreatePlane("signP", { width: 3.4, height: 0.64 }, scene);
  const [wx, wz] = xfp(xf, lx, lz);
  p.material = m; p.position.set(wx, y, wz); p.rotation.y = xf.yaw;
  p.freezeWorldMatrix();
  glow.addIncludedOnlyMesh(p);
}

function buildEnterable(sp) {
  const { F, kind, type, name } = sp.enter;
  const Fac = FAC[type], fh = Fac.style.cellH;
  const T = 0.3, h = F * fh;
  const minX = -sp.hw, maxX = sp.hw, minZ = -sp.hd, maxZ = sp.hd;
  const w = maxX - minX, d = maxZ - minZ;
  const o = { x: minX, y: 0, z: minZ };
  const X0 = minX + T, X1 = maxX - T, Z0 = minZ + T, Z1 = maxZ - T;
  const near = (a, b) => Math.abs(a - b) < 1e-4;
  const shellFace = (dir, c) => {
    if ((dir === "+x" && near(c, maxX)) || (dir === "-x" && near(c, minX)) ||
        (dir === "+z" && near(c, maxZ)) || (dir === "-z" && near(c, minZ))) return Fac.out;
    if ((dir === "-x" && near(c, X1)) || (dir === "+x" && near(c, X0)) ||
        (dir === "-z" && near(c, Z1)) || (dir === "+z" && near(c, Z0))) return Fac.inn;
    return dir === "-y" ? null : A.plaster;
  };
  const shell = (x0, y0, z0, x1, y1, z1) => solidBox(x0, y0, z0, x1, y1, z1, shellFace, o);
  const DW = 1.2, DHt = 2.6;
  // front wall (street side, -z) with the door, then back + sides
  shell(minX, 0, minZ, -DW, h, Z0);
  shell(DW, 0, minZ, maxX, h, Z0);
  shell(-DW, DHt, minZ, DW, h, Z0);
  shell(minX, 0, Z1, maxX, h, maxZ);
  shell(minX, 0, Z0, X0, h, Z1);
  shell(X1, 0, Z0, maxX, h, Z1);
  // parapet
  solidBox(minX, h, minZ, maxX, h + 1.0, Z0, A.roof);
  solidBox(minX, h, Z1, maxX, h + 1.0, maxZ, A.roof);
  solidBox(minX, h, Z0, X0, h + 1.0, Z1, A.roof);
  solidBox(X1, h, Z0, maxX, h + 1.0, Z1, A.roof);
  // door frame, canopy, sign
  addBox(-DW - 0.12, 0, minZ - 0.06, -DW, DHt + 0.12, minZ, A.metal);
  addBox(DW, 0, minZ - 0.06, DW + 0.12, DHt + 0.12, minZ, A.metal);
  addBox(-DW - 0.12, DHt, minZ - 0.06, DW + 0.12, DHt + 0.12, minZ, A.metal);
  addBox(-1.9, DHt + 0.15, minZ - 1.3, 1.9, DHt + 0.3, minZ, A.metal);
  makeSign(name, 0, DHt + 0.62, minZ - 0.08);

  // switchback stair core in the back-left corner
  const ax0 = X0, ax1 = X0 + 1.4, bx1 = X0 + 2.8, zb = Z1, holeZ0 = zb - 3.8;
  const STEPS = 8, TREAD = 0.3, rise = fh / 2 / STEPS;
  for (let i = 0; i < F; i++) {
    const y0 = i * fh;
    for (let k = 1; k <= STEPS; k++) {
      const z0 = holeZ0 + (k - 1) * TREAD, top = y0 + k * rise;
      solidBox(ax0, Math.max(y0, top - 0.35), z0, ax1, top, z0 + TREAD, A.stairs);
    }
    solidBox(ax0, y0 + fh / 2 - 0.3, zb - 1.4, bx1, y0 + fh / 2, zb, A.stairs);
    for (let k = 1; k <= STEPS; k++) {
      const z1 = zb - 1.4 - (k - 1) * TREAD, top = y0 + fh / 2 + k * rise;
      solidBox(ax1, top - 0.35, z1 - TREAD, bx1, top, z1, A.stairs);
    }
    for (let k = 1; k <= STEPS; k++) {
      const z = holeZ0 + (k - 0.5) * TREAD, top1 = y0 + k * rise;
      addBox(ax1 - 0.02, top1, z - 0.02, ax1 + 0.02, top1 + 0.9, z + 0.02, A.metal);
    }
  }
  // floors
  solidBox(X0, -0.05, Z0, X1, 0.09, Z1, (dir) => (dir === "+y" ? A.tileF : null));
  for (let j = 1; j <= F; j++) {
    const top = j * fh, bot = top - 0.25, roof = j === F;
    const floorAcc = roof ? A.roof : kind === "office" ? A.carpet : A.wood;
    const slabFace = (dir) => (dir === "+y" ? floorAcc : dir === "-y" ? A.ceiling : A.plaster);
    solidBox(X0, bot, Z0, X1, top, holeZ0, slabFace);
    solidBox(bx1, bot, holeZ0, X1, top, Z1, slabFace);
    solidBox(bx1, top, holeZ0, bx1 + 0.06, top + 1.0, Z1, A.rail);
    if (roof) solidBox(ax0, top, holeZ0 - 0.06, ax1, top + 1.0, holeZ0, A.rail);
  }
  // lobby
  {
    const y = 0.09;
    item(-3.4, minZ + 4.2, y, 2.4, 0.8, 1.05, A.darkWood);
    addBox(-4.65, y + 1.05, minZ + 3.75, -2.15, y + 1.1, minZ + 4.65, A.counter);
    sofa(3.6, minZ + 4.2, y, -1, A.gray);
    plant(-2.2, minZ + 0.9, y, true);
    plant(2.2, minZ + 0.9, y, true);
    for (let lx = X0 + 3; lx < X1 - 1; lx += 4.5) for (let lz = Z0 + 3; lz < Z1 - 1; lz += 4.5) {
      addBox(lx - 0.6, fh - 0.29, lz - 0.3, lx + 0.6, fh - 0.25, lz + 0.3, A.light);
    }
  }
  // upper floors: four rooms
  const xW = minX + w * 0.5, xB = minX + w * 0.62, zW = minZ + d * 0.45;
  for (let j = 1; j < F; j++) {
    const y0 = j * fh, y1 = (j + 1) * fh - 0.25;
    partition(true, zW, X0, X1, [minX + w * 0.25, minX + w * 0.75], y0, y1);
    partition(false, xW, Z0, zW - 0.075, [(Z0 + zW) / 2], y0, y1);
    partition(false, xB, zW + 0.075, Z1, [(zW + Z1) / 2], y0, y1);
    const FL = { x0: X0, x1: xW - 0.075, z0: Z0, z1: zW - 0.075 };
    const FR = { x0: xW + 0.075, x1: X1, z0: Z0, z1: zW - 0.075 };
    const BR = { x0: xB + 0.075, x1: X1, z0: zW + 0.075, z1: Z1 };
    const BL = { x0: X0, x1: xB - 0.075, z0: zW + 0.075, z1: Z1 };
    if (kind === "office") { offices(FL, y0); offices(FR, y0); meeting(BR, y0); }
    else {
      const ps = [bedroom, living, kitchen].sort(() => rand() - 0.5);
      ps[0](FL, y0); ps[1](FR, y0); ps[2](BR, y0);
    }
    plant(BL.x1 - 0.6, BL.z0 + 0.6, y0);
    for (const r of [FL, FR, BR, BL]) {
      const [cx, cz] = roomC(r);
      addBox(cx - 0.6, y1 - 0.04, cz - 0.3, cx + 0.6, y1, cz + 0.3, A.light);
    }
  }
  enterables.push({ name, xf: sp.xf, minX: X0, maxX: X1, minZ: Z0, maxZ: Z1, fh, F });
  roofs.push({ xf: sp.xf, hw: sp.hw, hd: sp.hd, lhw: 2, lhd: 2, top: h, rim: h + 1.0, mechs: [], landing: { x: (xW + X1) / 2, z: (Z0 + zW) / 2 } });
  sp.h = h;
}

// ---------------------------------------------------------------- billboards
const ADS = [
  { t: "NOVA COLA", s: "Taste the spark", c: ["#d4142a", "#ffffff", "#ffcf3a"] },
  { t: "ZENITH X", s: "The phone that thinks ahead", c: ["#101820", "#7cf0ff", "#ffffff"] },
  { t: "BROADWAY NIGHTS", s: "Now playing · 8 PM", c: ["#3a0b52", "#ffd447", "#ff5fa2"] },
  { t: "SKYLINE AIR", s: "Fly further for less", c: ["#0b4ea2", "#ffffff", "#9fd3ff"] },
  { t: "ORBIT BURGER", s: "Out of this world", c: ["#ff8c1a", "#2b1300", "#fff2c2"] },
  { t: "LUMEN", s: "Watches for the bold", c: ["#121212", "#e8c46a", "#ffffff"] },
  { t: "METRO BANK", s: "Your city. Your money.", c: ["#0f6b3f", "#ffffff", "#bff5d6"] },
  { t: "AURORA", s: "Eau de parfum", c: ["#f3c6d7", "#4a1630", "#ffffff"] },
];
export function drawAd(b, frame) {
  const ctx = b.tex.getContext(), W = 512, H = 288, [c0, c1, c2] = b.ad.c;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, c0); g.addColorStop(1, frame % 2 ? c2 : c0);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = c2; ctx.lineWidth = 10; ctx.strokeRect(8, 8, W - 16, H - 16);
  ctx.fillStyle = frame % 3 === 2 ? c2 : c1;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "900 70px Impact, Arial Black, sans-serif";
  ctx.fillText(b.ad.t, W / 2, H * 0.42);
  ctx.font = "600 30px Segoe UI, Arial, sans-serif";
  ctx.fillStyle = frame % 2 ? c1 : c2;
  ctx.fillText(b.ad.s, W / 2, H * 0.72);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = (i + frame) % 2 ? c2 : c1;
    ctx.beginPath(); ctx.arc(40 + i * 86, H - 26, 6, 0, Math.PI * 2); ctx.fill();
  }
  b.tex.update();
}
function buildBillboards() {
  const ts = landmarks.times;
  let ai = 0;
  for (const sp of specs) {
    if (billboards.length >= 18) break;
    if (sp.district !== "city" || sp.enter || sp.cat === "brown" || sp.h < 24) continue;
    if (Math.hypot(sp.xf.cx - ts.x, sp.xf.cz - ts.z) > 95) continue;
    const bw = Math.min(sp.hw * 1.6, 16), bh = bw * 0.56;
    const y = rr(9, Math.max(9.5, Math.min(sp.h - bh - 2, 24)));
    const lx = rr(-sp.hw + bw / 2 + 0.3, sp.hw - bw / 2 - 0.3);
    const [wx, wz] = xfp(sp.xf, lx, -sp.hd - 0.3);
    const tex = new BABYLON.DynamicTexture("ad", { width: 512, height: 288 }, scene, true);
    const m = new BABYLON.StandardMaterial("adM", scene);
    m.disableLighting = true; m.emissiveTexture = tex; m.diffuseTexture = tex;
    const p = BABYLON.MeshBuilder.CreatePlane("billboard", { width: bw, height: bh }, scene);
    p.material = m; p.position.set(wx, y + bh / 2, wz); p.rotation.y = sp.xf.yaw;
    p.freezeWorldMatrix();
    glow.addIncludedOnlyMesh(p);
    const b = { tex, ad: ADS[ai++ % ADS.length], frame: 0 };
    drawAd(b, 0);
    billboards.push(b);
    // frame + backing box
    setXF(sp.xf);
    addBox(lx - bw / 2 - 0.25, y - 0.25, -sp.hd - 0.28, lx + bw / 2 + 0.25, y + bh + 0.25, -sp.hd, A.ridge);
    clearXF();
  }
}

// ---------------------------------------------------------------- build everything
const MAPC = { tower: "#2c2e36", deco: "#34363f", brown: "#3e2f28", haus: "#4a4236", house: "#5b4a3c", lterr: "#4b3d35", mansion: "#5a3328" };
export function buildBuildings() {
  for (const sp of specs) {
    setXF(sp.xf);
    if (sp.enter) buildEnterable(sp);
    else if (sp.cat === "tower") buildTower(sp);
    else if (sp.cat === "deco") buildDeco(sp);
    else if (sp.cat === "brown") buildBrown(sp);
    else if (sp.cat === "haus") buildHaus(sp);
    else if (sp.cat === "lterr") buildLTerrace(sp);
    else if (sp.cat === "mansion") buildMansion(sp);
    else if (sp.cat === "ktm") { const r = buildKtm(sp); if (r) roofs.push(r); }
    else buildHouse(sp);
    clearXF();
    if (sp.home) registerHome(sp);
    mapBuildings.push({
      pts: fpCorners(sp),
      color: sp.enter ? "#c4902f" : sp.cat === "ktm" ? KTM_MAPC[sp.style] : MAPC[sp.cat],
      door: sp.enter ? xfp(sp.xf, 0, -sp.hd) : null,
      homeDoor: sp.home ? [homes[homes.length - 1].tx, homes[homes.length - 1].tz] : null,
    });
  }
  buildBillboards();
}
