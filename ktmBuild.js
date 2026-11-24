// ktmBuild.js — Kathmandu's buildings and landmarks, built the same cheap way
// as the rest of the world (boxes + polygons merged into a few big meshes, all
// detail in procedural textures):
//
//   • Newar houses: red brick, dark timber bands, carved lattice windows, a
//     wide tiled hip roof on rows of diagonal struts (tunala); some with a
//     projecting carved window bay
//   • modern plastered concrete houses: flat roofs with parapet, sunshade
//     ledges (chajja), water tanks and stair heads on top
//   • shopfronts with roll-up shutters on the busy roads
//   • tiered pagoda temples on the squares (tole)
//   • Durbar Square: a Newar palace complex round a stone courtyard
//     (createNewarPalace) — long 2-storey wing, 3-storey central block with a
//     barrel-roofed tower, 5-tier pagoda tower, whitewashed shrine, white
//     neoclassical wing
//
// Performance: Kathmandu's geometry goes into per-tile accumulators (a 3×3
// grid over the district), so each tile is one mesh per material that the
// camera can cull, and tiles past the fog are switched off entirely.
import {
  scene, hex, clamp, litMat, texMat, flatTexMat, canvasTex, makeAcc, addBox, addPoly, addSolid,
  setXF, clearXF, makeXF, xfp, setLift, terrainH, landH,
} from "./engine.js";
import { TERRAIN_BOX } from "./terrain.js";
import { FAC, noiseTex, slabTex } from "./textures.js";
import { KTM, KTM_CORE, krand, krr, kpick } from "./kathmandu.js";

// CONFIG — colours and sizes in one place
export const KCFG = {
  wood: "#3b2418", woodLight: "#4a2c1b", stone: "#8e8a82", plinth: "#7a7770", whitewash: "#efeae0",
  gold: "#c9a227", metal: "#4f5a55", concrete: "#9a968e", tank: "#1f2124",
  groundFloor: 3.2, storey: 2.8, modernStorey: 3.0,
  eave: 1.1, roofPitch: 0.42, strutSpacing: 1.4,
};

// ---------------------------------------------------------------- materials + tiles
let M = null;
function initMats() {
  if (M) return;
  const tile = canvasTex("ktmTile", 256, (ctx, S) => {
    ctx.fillStyle = "#9a4b34"; ctx.fillRect(0, 0, S, S);
    for (let r = 0; r < 16; r++) {
      const y = (r * S) / 16;
      for (let x = (r % 2) * 8; x < S; x += 16) {
        ctx.fillStyle = `rgba(${Math.random() < 0.5 ? "60,25,15" : "190,110,80"},${0.08 + Math.random() * 0.18})`;
        ctx.fillRect(x, y, 15, S / 16 - 2);
      }
      ctx.fillStyle = "rgba(40,15,8,0.45)"; ctx.fillRect(0, y + S / 16 - 3, S, 3);
    }
    for (let i = 0; i < 14; i++) {                                         // weathered patches
      ctx.fillStyle = `rgba(50,40,30,${0.1 + Math.random() * 0.15})`;
      ctx.beginPath(); ctx.arc(Math.random() * S, Math.random() * S, 10 + Math.random() * 30, 0, Math.PI * 2); ctx.fill();
    }
  });
  const brick = canvasTex("ktmBrick", 256, (ctx, S) => {
    ctx.fillStyle = "#b5543a"; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? "230,150,110" : "70,25,12"},${0.05 + Math.random() * 0.15})`;
      ctx.fillRect(Math.random() * S, Math.random() * S, 3 + Math.random() * 6, 2);
    }
    ctx.fillStyle = "rgba(201,183,156,0.35)";
    for (let y = 0; y < S; y += 5) ctx.fillRect(0, y, S, 1);
  });
  const lat = canvasTex("ktmLattice", 128, (ctx, S) => {
    ctx.fillStyle = "#1c110b"; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = "#6a4428"; ctx.lineWidth = 2; ctx.beginPath();
    for (let k = -S; k < 2 * S; k += 10) { ctx.moveTo(k, 0); ctx.lineTo(k + S, S); ctx.moveTo(k + S, 0); ctx.lineTo(k, S); }
    ctx.stroke();
    ctx.strokeStyle = "#3b2418"; ctx.lineWidth = 8; ctx.strokeRect(0, 0, S, S);
  });
  const slab = slabTex("ktmSlab", "#8e8a82", "rgba(60,58,54,0.35)", 4);
  M = {
    tile: [texMat("ktmTileM", tile, 0.04), 2.4, 2.4],
    brick: [texMat("ktmBrickM", brick, 0.03), 2.4, 2.4],
    lattice: [texMat("ktmLatticeM", lat, 0.05), 1.2, 1.2],
    slab: [texMat("ktmSlabM", slab, 0.02), 4, 4],
    wood: [litMat("ktmWoodM", hex(KCFG.wood), 0.05), 1, 1],
    stone: [litMat("ktmStoneM", hex(KCFG.plinth), 0.03), 1, 1],
    white: [litMat("ktmWhiteM", hex(KCFG.whitewash), 0.05), 1, 1],
    gold: [(() => { const m = litMat("ktmGoldM", hex(KCFG.gold), 0.6); m.emissiveColor = hex("#3a2a08"); return m; })(), 1, 1],
    metal: [litMat("ktmMetalM", hex(KCFG.metal), 0.25), 1, 1],
    concrete: [litMat("ktmConcreteM", hex(KCFG.concrete), 0.03), 1, 1],
    tank: [litMat("ktmTankM", hex(KCFG.tank), 0.3), 1, 1],
  };
  M.slab[0].zOffset = -3;                    // courtyard paving sits just over the ground discs
  const fac = (key, f) => { M[key] = [f.mat, f.style.cols * f.style.cellW, f.style.rows * f.style.cellH]; };
  fac("brickDark", FAC.ktm.brickDark); fac("brickLight", FAC.ktm.brickLight); fac("brickGround", FAC.ktm.brickGround);
  FAC.ktm.shops.forEach((f, i) => fac("shop" + i, f));
  FAC.ktm.grocery.forEach((f, i) => fac("grocery" + i, f));
  ["#1f6fb2", "#c0392b", "#2e8b57"].forEach((c, i) => { M["tarp" + i] = [litMat("ktmTarpM" + i, hex(c), 0.08), 1, 1]; });
  M.sack = [litMat("ktmSackM", hex("#cdb48a"), 0.02), 1, 1];
  FAC.ktm.plaster.forEach((f, i) => fac("plaster" + i, f));
  fac("whiteFac", FAC.ktm.white);
}
// One tile: the engine already splits every accumulator into 400 m map chunks
// that cull on their own; a finer grid on top only multiplied draw calls.
const TX = 1, TZ = 1, tiles = [];
let cur = 0;
function useTile(x, z) {
  const ix = clamp(Math.floor(((x - KTM.x0) / (KTM.x1 - KTM.x0)) * TX), 0, TX - 1);
  const iz = clamp(Math.floor(((z - KTM.z0) / (KTM.z1 - KTM.z0)) * TZ), 0, TZ - 1);
  cur = iz * TX + ix;
  if (!tiles[cur]) {
    tiles[cur] = {
      accs: {}, meshes: [], on: true,
      x0: KTM.x0 + ((KTM.x1 - KTM.x0) * ix) / TX, x1: KTM.x0 + ((KTM.x1 - KTM.x0) * (ix + 1)) / TX,
      z0: KTM.z0 + ((KTM.z1 - KTM.z0) * iz) / TZ, z1: KTM.z0 + ((KTM.z1 - KTM.z0) * (iz + 1)) / TZ,
    };
  }
}
// The accumulator for a material in the current tile.
function A(key) {
  const t = tiles[cur];
  if (!t.accs[key]) { const [mat, tw, th] = M[key]; t.accs[key] = makeAcc(`ktm_${key}_${cur}`, mat, tw, th); }
  return t.accs[key];
}
const sides = (acc) => (d) => (d === "+y" || d === "-y" ? null : acc);
const noBottom = (acc) => (d) => (d === "-y" ? null : acc);

// ---------------------------------------------------------------- shared pieces
// Hip roof over [cx±hw, cz±hd] from height y: eaves `ov` out, ridge along the
// longer side (a pyramid when square). Faces point up/out.
function hipRoof(cx, cz, hw, hd, y, ov, pitch, acc) {
  const X = hw + ov, Z = hd + ov, m = Math.min(X, Z), R = y + m * pitch;
  const rx = Math.max(0, X - Z), rz = Math.max(0, Z - X);
  const b = [[cx - X, y, cz - Z], [cx + X, y, cz - Z], [cx + X, y, cz + Z], [cx - X, y, cz + Z]];
  const t = [[cx - rx, R, cz - rz], [cx + rx, R, cz - rz], [cx + rx, R, cz + rz], [cx - rx, R, cz + rz]];
  const ref = [cx, y - 2, cz];
  const uvX = (p) => [p[0] / 2.4, (p[1] - y) * 2.4 / 2.4];
  const uvZ = (p) => [p[2] / 2.4, (p[1] - y) * 2.4 / 2.4];
  addPoly(acc, [b[0], b[1], t[1], t[0]], ref, uvX);
  addPoly(acc, [b[2], b[3], t[3], t[2]], ref, uvX);
  addPoly(acc, [b[1], b[2], t[2], t[1]], ref, uvZ);
  addPoly(acc, [b[3], b[0], t[0], t[3]], ref, uvZ);
  return R;
}
// Carved diagonal struts (tunala) from the wall up to the eave, along one face.
// face: "-z" | "+z" | "-x" | "+x" of the box [cx±hw, cz±hd]; wall top at y.
function struts(cx, cz, hw, hd, y, ov, face, acc) {
  const alongX = face[1] === "z", half = alongX ? hw : hd, sd = face[0] === "-" ? -1 : 1;
  const n = Math.max(2, Math.round((half * 2) / KCFG.strutSpacing));
  const wall = alongX ? cz + sd * hd : cx + sd * hw, reach = sd * ov * 0.85;
  for (let k = 0; k < n; k++) {
    const a = -half + ((k + 0.5) * half * 2) / n;
    const P = (t, lo) => {           // t 0 = wall foot, 1 = under the eave
      const off = wall + reach * t + sd * 0.02, yy = lo ? y - 1.15 + t * 1.05 : y - 1.15 + t * 1.05;
      return alongX ? [cx + a + (lo ? -0.07 : 0.07), yy, off] : [off, yy, cz + a + (lo ? -0.07 : 0.07)];
    };
    const ref = alongX ? [cx + a, y - 2, cz] : [cx, y - 2, cz + a];
    addPoly(acc, [P(0, true), P(0, false), P(1, false), P(1, true)], ref, () => [0, 0]);
  }
}
// Thin timber band round a box at height y.
function band(cx, cz, hw, hd, y, acc) {
  addBox(cx - hw - 0.06, y - 0.14, cz - hd - 0.06, cx + hw + 0.06, y + 0.06, cz + hd + 0.06, sides(acc));
}

// ---------------------------------------------------------------- planning
export function planKathmandu(e, px, pz) {
  const dCore = Math.hypot(px - KTM_CORE.x, pz - KTM_CORE.z);
  const busy = e.kind !== "galli";
  // most ground floors are shops — almost half of them little grocery shops
  const shop = krand() < (busy ? 0.9 : 0.6)
    ? (krand() < 0.45 ? "grocery" + Math.floor(krand() * 3) : "shop" + Math.floor(krand() * 3)) : null;
  if (krand() < clamp(0.85 - dCore / 620, 0.2, 0.8)) {
    return {
      cat: "ktm", style: "newar", brick: krand() < 0.5 ? 1 : 0, floors: kpick([3, 3, 4, 4, 5]), shopKey: shop,
      bay: krand() < 0.3, w: krr(6, 11), d: krr(10, 15), cellW: 2.4, setback: 0.2, gap: 0,
    };
  }
  return {
    cat: "ktm", style: "modern", color: Math.floor(krand() * 4), floors: busy ? kpick([4, 5, 5, 6]) : kpick([3, 4, 4, 5]),
    shopKey: shop, tank: krand() < 0.75, stair: krand() < 0.45,
    w: krr(7, 12), d: krr(10, 15), cellW: 2.4, setback: 0.2, gap: krand() < 0.85 ? 0 : krr(0.4, 1),   // packed shoulder to shoulder
  };
}
export const KTM_MAPC = { newar: "#5a3326", modern: "#4d4842" };

// ---------------------------------------------------------------- houses
// Called by buildings.js with the building's frame already set (local -z =
// the street). Returns a roof-landing entry (flat roofs) or null.
// On the hillside the house stands at the height of the street in front of
// it (buildings.js has already set that lift); where the ground falls away
// under it, a brick plinth fills the gap down to the lowest corner.
export function buildKtm(sp, lift = 0) {
  initMats();
  useTile(sp.xf.cx, sp.xf.cz);
  const { hw, hd } = sp;
  let low = lift;
  for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
    const [x, z] = xfp(sp.xf, lx, lz);
    low = Math.min(low, terrainH(x, z));
  }
  if (low < lift - 0.03) {
    const y0 = low - lift - 0.3;
    addBox(-hw, y0, -hd, hw, 0, hd, sides(A("stone")));
    addSolid(-hw, y0, -hd, hw, 0, hd);
  }
  return sp.style === "newar" ? buildNewar(sp) : buildModern(sp);
}
function buildNewar(sp) {
  const { hw, hd } = sp, GF = KCFG.groundFloor, FH = KCFG.storey;
  const H = GF + (sp.floors - 1) * FH;
  const ground = A(sp.shopKey || "brickGround");
  const upper = A(sp.brick ? "brickLight" : "brickDark");
  addBox(-hw, 0, -hd, hw, GF, hd, sides(ground), { x: -hw, y: 0, z: -hd });
  addBox(-hw, GF, -hd, hw, H, hd, sides(upper), { x: -hw, y: GF, z: -hd });
  addSolid(-hw, 0, -hd, hw, H, hd);
  shopFront(sp);
  const wood = A("wood");
  for (let f = 1; f < sp.floors; f++) band(0, 0, hw, hd, GF + (f - 1) * FH, wood);
  band(0, 0, hw, hd, H, wood);
  // projecting carved window bay on the first floor (street side)
  if (sp.bay && hw >= 3.5) {
    const bw = Math.min(hw - 0.8, 2.6), y0 = GF + 0.5;
    addBox(-bw, y0, -hd - 0.5, bw, y0 + 1.7, -hd, (d) => (d === "-z" ? A("lattice") : d === "-y" || d === "+z" ? null : wood), { x: -bw, y: y0, z: 0 });
    addBox(-bw - 0.15, y0 + 1.7, -hd - 0.65, bw + 0.15, y0 + 1.85, -hd, noBottom(wood));
  }
  // wide tiled hip roof on struts
  const ov = KCFG.eave, R = hipRoof(0, 0, hw, hd, H, ov, KCFG.roofPitch, A("tile"));
  struts(0, 0, hw, hd, H, ov, "-z", wood);
  if (hd > 5.5) struts(0, 0, hw, hd, H, ov, "+z", wood);
  addSolid(-hw, H, -hd, hw, H + (R - H) * 0.55, hd);
  sp.h = R;
  return null;
}
// Grocery shops: a coloured tarp awning over the shopfront and sacks of
// grain set out on the step (not solid, so the pavement stays walkable).
function shopFront(sp) {
  if (!sp.shopKey || !sp.shopKey.startsWith("grocery")) return;
  const { hw, hd } = sp, tarp = A("tarp" + (Math.floor(krand() * 3)));
  addBox(-hw + 0.2, 2.75, -hd - 1.05, hw - 0.2, 2.82, -hd, (d) => (d === "+z" ? null : tarp));
  for (const sx of [-hw + 0.25, hw - 0.3]) addBox(sx, 0, -hd - 1.02, sx + 0.05, 2.75, -hd - 0.97, A("wood"));   // poles
  const sk = A("sack"), n = Math.max(1, Math.floor((hw * 2 - 1.2) / 0.75));
  for (let k = 0; k < n; k++) {
    const x = -hw + 0.6 + k * 0.75;
    addBox(x, 0, -hd - 0.5, x + 0.55, 0.55 + (k % 2) * 0.08, -hd - 0.08, (d) => (d === "-y" || d === "+z" ? null : sk));
  }
}
function buildModern(sp) {
  const { hw, hd } = sp, FH = KCFG.modernStorey;
  const H = sp.floors * FH;
  const P = A("plaster" + sp.color);
  if (sp.shopKey) {
    addBox(-hw, 0, -hd, hw, FH, hd, sides(A(sp.shopKey)), { x: -hw, y: 0, z: -hd });
    shopFront(sp);
    addBox(-hw, FH, -hd, hw, H, hd, sides(P), { x: -hw, y: FH, z: -hd });
  } else addBox(-hw, 0, -hd, hw, H, hd, sides(P), { x: -hw, y: 0, z: -hd });
  // sunshade ledges over each floor's windows (street side)
  const conc = A("concrete");
  for (let f = 1; f <= sp.floors; f++) addBox(-hw, f * FH - 0.42, -hd - 0.5, hw, f * FH - 0.32, -hd, (d) => (d === "+z" ? null : conc));
  // parapet hiding the flat roof
  addBox(-hw, H, -hd, hw, H + 0.9, hd, (d) => (d === "+y" ? conc : d === "-y" ? null : P), { x: -hw, y: H - FH, z: -hd });
  addSolid(-hw, 0, -hd, hw, H + 0.9, hd);
  const top = H + 0.9, mechs = [];
  if (sp.stair && hw > 3 && hd > 3) {                // stair head-room hut
    const sx = hw - 1.4, sz = hd - 1.5;
    addBox(sx - 1.2, top, sz - 1.3, sx + 1.2, top + 2.5, sz + 1.3, noBottom(P), { x: sx - 1.2, y: top, z: sz - 1.3 });
    addSolid(sx - 1.2, top, sz - 1.3, sx + 1.2, top + 2.5, sz + 1.3);
    mechs.push({ x: sx, z: sz, r: 2 });
  }
  if (sp.tank) {                                     // black plastic water tank on a stand
    const tx = -hw + 1.2, tz = hd - 1.2, tk = A("tank");
    addBox(tx - 0.65, top + 0.6, tz - 0.65, tx + 0.65, top + 1.9, tz + 0.65, tk);
    addBox(tx - 0.7, top, tz - 0.7, tx + 0.7, top + 0.6, tz + 0.7, sides(conc));
    addSolid(tx - 0.7, top, tz - 0.7, tx + 0.7, top + 1.9, tz + 0.7);
    mechs.push({ x: tx, z: tz, r: 1.4 });
  }
  sp.h = top;
  return { xf: sp.xf, hw, hd, lhw: hw - 0.8, lhd: hd - 0.8, top, mechs };
}

// ---------------------------------------------------------------- temples
// createTieredPagoda: stepped stone plinth, brick tiers with carved timber,
// each with its own tiled roof + strut ring, gilded finial. In the current frame.
export function createTieredPagoda({ cx = 0, cz = 0, y0 = 0, tiers = 3, baseWidth = 8, tierHeight = 3, setback = 0.9, eave = 1.3, plinth = 3 } = {}) {
  const stone = A("stone"), brick = A("brick"), wood = A("wood"), tile = A("tile");
  let y = y0, w = baseWidth / 2 + plinth * 1.1;
  for (let i = 0; i < plinth; i++) {
    addBox(cx - w, y, cz - w, cx + w, y + 0.6, cz + w, noBottom(stone));
    addSolid(cx - w, y, cz - w, cx + w, y + 0.6, cz + w);
    y += 0.6; w -= 1.1;
  }
  let hw = baseWidth / 2, top = y;
  for (let t = 0; t < tiers; t++) {
    const th = tierHeight * (t === 0 ? 1.15 : 0.85);
    addBox(cx - hw, y, cz - hw, cx + hw, y + th, cz + hw, sides(brick));
    addSolid(cx - hw, y, cz - hw, cx + hw, y + th, cz + hw);
    if (t === 0) {
      // carved doorways on all four sides
      for (const [dx, dz, ax] of [[0, -1, true], [0, 1, true], [-1, 0, false], [1, 0, false]]) {
        const fx = cx + dx * (hw + 0.05), fz = cz + dz * (hw + 0.05), dw = Math.min(1.1, hw * 0.35);
        if (ax) addBox(fx - dw, y + 0.05, fz - 0.06, fx + dw, y + th * 0.75, fz + 0.06, wood);
        else addBox(fx - 0.06, y + 0.05, fz - dw, fx + 0.06, y + th * 0.75, fz + dw, wood);
      }
    }
    band(cx, cz, hw, hw, y + th, wood);
    top = hipRoof(cx, cz, hw, hw, y + th, eave, 0.55, tile);
    for (const f of ["-z", "+z", "-x", "+x"]) struts(cx, cz, hw, hw, y + th, eave, f, wood);
    y += th;
    hw = Math.max(0.9, hw - setback - (t === 0 ? 0.4 : 0));
  }
  // gilded finial
  const g = A("gold");
  addBox(cx - 0.45, top - 0.2, cz - 0.45, cx + 0.45, top + 0.5, cz + 0.45, noBottom(g));
  addBox(cx - 0.25, top + 0.5, cz - 0.25, cx + 0.25, top + 1.5, cz + 0.25, noBottom(g));
  addBox(cx - 0.1, top + 1.5, cz - 0.1, cx + 0.1, top + 2.3, cz + 0.1, noBottom(g));
  return top + 2.3;
}
// Little whitewashed shrine with a rounded (stepped) top and a gilded tip.
function shrine(cx, cz) {
  const st = A("stone"), wh = A("white");
  addBox(cx - 1.6, 0, cz - 1.6, cx + 1.6, 0.5, cz + 1.6, noBottom(st));
  addBox(cx - 1.1, 0.5, cz - 1.1, cx + 1.1, 2.6, cz + 1.1, sides(wh));
  addBox(cx - 0.45, 0.6, cz - 1.12, cx + 0.45, 1.8, cz - 1.1, A("wood"));
  let r = 1.2, y = 2.6;
  for (const h of [0.45, 0.4, 0.35, 0.3]) { addBox(cx - r, y, cz - r, cx + r, y + h, cz + r, noBottom(wh)); y += h; r *= 0.72; }
  addBox(cx - 0.12, y, cz - 0.12, cx + 0.12, y + 0.6, cz + 0.12, noBottom(A("gold")));
  addSolid(cx - 1.6, 0, cz - 1.6, cx + 1.6, y, cz + 1.6);
}
// Lattice window panel (a projecting carved window) on the -z face at depth z.
export function createLatticeWindow({ x = 0, y = 0, z = 0, width = 2, height = 1.6, depth = 0.5 } = {}) {
  const wood = A("wood");
  addBox(x - width / 2, y, z - depth, x + width / 2, y + height, z, (d) => (d === "-z" ? A("lattice") : d === "+z" ? null : wood), { x: x - width / 2, y, z: 0 });
  addBox(x - width / 2 - 0.15, y + height, z - depth - 0.15, x + width / 2 + 0.15, y + height + 0.15, z, noBottom(wood));
  addBox(x - width / 2 - 0.1, y - 0.12, z - depth - 0.1, x + width / 2 + 0.1, y, z, (d) => (d === "+z" ? null : wood));
}
// A ring of struts round a box (helper per the palace spec).
export function createStrutRing({ cx = 0, cz = 0, hw = 4, hd = 4, y = 0, eave = 1.3 } = {}) {
  for (const f of ["-z", "+z", "-x", "+x"]) struts(cx, cz, hw, hd, y, eave, f, A("wood"));
}

// ---------------------------------------------------------------- Durbar Square palace
// In its own frame: the courtyard (chowk) faces local -z, the palace row runs
// along the back (+z). Returns minimap shapes (local rectangles).
export function createNewarPalace({ towerTiers = 5, wingLength = 26 } = {}) {
  const GF = 3.2, F2 = 2.9, F3 = 2.6, P0 = 0.6;
  const wood = A("wood"), shapes = [];
  const rect = (x0, z0, x1, z1, color) => shapes.push({ x0, z0, x1, z1, color });
  // stone courtyard + plinth with steps at the central door
  addBox(-34, 0, -26, 34, 0.06, 6, (d) => (d === "+y" ? A("slab") : null), { x: 0, y: 0, z: 0 });
  addBox(-34, 0, 4.8, 18, P0, 18.6, noBottom(A("stone")));
  addSolid(-34, 0, 4.8, 18, P0, 18.6);
  for (let k = 0; k < 3; k++) {
    const z = 4.8 - (k + 1) * 0.35;
    addBox(-3.5, 0, z, 1.5, P0 - (k + 1) * 0.15, z + 0.35, noBottom(A("stone")));
  }
  // left wing: 2 storeys, long lattice balcony, one big low roof
  const lx1 = -8, lx0 = lx1 - wingLength, lcx = (lx0 + lx1) / 2, lhw = wingLength / 2;
  addBox(lx0, P0, 6, lx1, P0 + GF, 18, sides(A("brickGround")), { x: lx0, y: P0, z: 6 });
  addBox(lx0, P0 + GF, 6, lx1, P0 + GF + F2, 18, sides(A("brickDark")), { x: lx0, y: P0 + GF, z: 6 });
  addSolid(lx0, 0, 6, lx1, P0 + GF + F2, 18);
  band(lcx, 12, lhw, 6, P0 + GF, wood); band(lcx, 12, lhw, 6, P0 + GF + F2, wood);
  for (let k = 0; k < 3; k++) createLatticeWindow({ x: lcx - 7.5 + k * 7.5, y: P0 + GF + 0.45, z: 6, width: 6.2, height: 1.9, depth: 0.55 });
  const wingR = hipRoof(lcx, 12, lhw, 6, P0 + GF + F2, 1.5, 0.33, A("tile"));
  struts(lcx, 12, lhw, 6, P0 + GF + F2, 1.5, "-z", wood);
  addSolid(lx0, P0 + GF + F2, 6, lx1, wingR - 1, 18);
  rect(lx0, 6, lx1, 18, "#6a3a2a");
  // central block: 3 storeys, arched openings, the projecting window group, tower
  const cx = -1, chw = 7;
  const y1 = P0 + GF, y2 = y1 + F2, y3 = y2 + F3;
  addBox(cx - chw, P0, 6, cx + chw, y1, 18, sides(A("brickGround")), { x: cx - chw, y: P0, z: 6 });
  addBox(cx - chw, y1, 6, cx + chw, y3, 18, sides(A("brickLight")), { x: cx - chw, y: y1, z: 6 });
  addSolid(cx - chw, 0, 6, cx + chw, y3, 18);
  for (let k = -1; k <= 1; k++) {                                     // three openings with carved posts
    const ox = cx + k * 4;
    addBox(ox - 1.2, P0, 5.92, ox + 1.2, P0 + 2.6, 6.0, A("lattice"), { x: ox - 1.2, y: P0, z: 0 });
    for (const sx of [-1.35, 1.35]) addBox(ox + sx - 0.15, P0, 5.6, ox + sx + 0.15, P0 + 2.9, 6.0, noBottom(wood));
  }
  createLatticeWindow({ x: cx, y: y1 + 0.4, z: 6, width: 8.5, height: 2.1, depth: 0.75 });   // the sajhya window group
  band(cx, 12, chw, 6, y1, wood); band(cx, 12, chw, 6, y2, wood); band(cx, 12, chw, 6, y3, wood);
  hipRoof(cx, 12, chw, 6, y3, 1.2, 0.4, A("tile"));
  struts(cx, 12, chw, 6, y3, 1.2, "-z", wood);
  const thw = 3.5, ty1 = y3 + 0.6, ty2 = ty1 + 5.0;
  addBox(cx - thw, ty1 - 1.2, 12 - thw, cx + thw, ty2, 12 + thw, sides(A("brickDark")), { x: cx - thw, y: ty1, z: 12 - thw });
  addSolid(cx - thw, y3, 12 - thw, cx + thw, ty2, 12 + thw);
  band(cx, 12, thw, thw, ty2, wood);
  // barrel-vaulted metal roof: half a cylinder lying along x, ends capped
  const RR = thw + 0.5, segs = 8, metal = A("metal"), arc = [];
  for (let k = 0; k <= segs; k++) { const a = (k / segs) * Math.PI; arc.push([12 + Math.cos(a) * RR, ty2 + Math.sin(a) * RR * 0.85]); }
  for (let k = 0; k < segs; k++) {
    const [z0, yy0] = arc[k], [z1, yy1] = arc[k + 1];
    addPoly(metal, [[cx - thw - 0.6, yy0, z0], [cx + thw + 0.6, yy0, z0], [cx + thw + 0.6, yy1, z1], [cx - thw - 0.6, yy1, z1]], [cx, ty2, 12], (p) => [p[0], p[2]]);
  }
  for (const ex of [cx - thw - 0.6, cx + thw + 0.6]) addPoly(metal, arc.map(([z, yy]) => [ex, yy, z]), [cx, ty2 + 1, 12], (p) => [p[2], p[1]]);
  addSolid(cx - thw, ty2, 12 - thw, cx + thw, ty2 + RR * 0.85, 12 + thw);
  for (const [ex, ez] of [[cx - thw - 0.6, 12 - RR], [cx + thw + 0.6, 12 - RR], [cx - thw - 0.6, 12 + RR], [cx + thw + 0.6, 12 + RR]]) {
    addBox(ex - 0.15, ty2 - 0.1, ez - 0.15, ex + 0.15, ty2 + 0.6, ez + 0.15, noBottom(A("gold")));   // curled corner tips
  }
  rect(cx - chw, 6, cx + chw, 18, "#7a4030");
  // pagoda tower on the right: brick base, then stacked tiers
  const px = 12, phw = 6;
  addBox(px - phw, P0, 6, px + phw, y2, 18, sides(A("brickGround")), { x: px - phw, y: P0, z: 6 });
  addSolid(px - phw, 0, 6, px + phw, y2, 18);
  band(px, 12, phw, 6, y1, wood);
  createTieredPagoda({ cx: px, cz: 12, y0: y2, tiers: towerTiers, baseWidth: 10.4, tierHeight: 2.6, setback: 0.8, eave: 1.3, plinth: 0 });
  rect(px - phw, 6, px + phw, 18, "#8a4a32");
  // whitewashed neoclassical wing at the far right
  const nx = 27, nhw = 7, nH = 3 * 3.2;
  addBox(nx - nhw, 0, 4, nx + nhw, nH, 18, sides(A("whiteFac")), { x: nx - nhw, y: 0, z: 4 });
  addBox(nx - nhw - 0.3, nH, 3.7, nx + nhw + 0.3, nH + 0.9, 18.3, (d) => (d === "+y" ? A("concrete") : d === "-y" ? null : A("white")));
  addSolid(nx - nhw, 0, 4, nx + nhw, nH + 0.9, 18);
  rect(nx - nhw, 4, nx + nhw, 18, "#9c9a92");
  // small shrine in the left foreground
  shrine(-27, -18);
  return { shapes, neo: { x: nx, z: 11, hw: nhw, hd: 7, top: nH + 0.9 } };
}

// ---------------------------------------------------------------- the district
// Ground, squares with temples, Durbar Square. Returns minimap shapes and
// roof-landing entries for buildings.js / main.js.
export function buildKathmanduWorld(landmarks) {
  initMats();
  const MB = BABYLON.MeshBuilder, map = [], roofsOut = [];
  // dusty brick-and-earth ground under the district
  const gt = noiseTex("ktmGroundT", "#9c8770", 6000, "200,175,140", "80,60,45", 256, [1, 3]);
  const W = KTM.x1 - KTM.x0 + 40, D = KTM.z1 - KTM.z0 + 40;
  gt.uScale = W / 10; gt.vScale = D / 10;
  // (a few cm under the roads: on the slopes its 6 m grid sags differently
  // from the road strips, so it needs the margin not to poke through)
  const g = draped("ktmGround", (KTM.x0 + KTM.x1) / 2, (KTM.z0 + KTM.z1) / 2, W, D, -0.03);
  g.material = flatTexMat("ktmGroundM", gt, 0.2); g.material.zOffset = -1;
  // (the hillside round the town is the island's own grass now — coast.js)
  const slab = slabTex("ktmSquareT", "#8e8a82", "rgba(60,58,54,0.4)", 5);
  const discM = flatTexMat("ktmSquareM", slab, 0.22); discM.zOffset = -2;
  const disc = (x, z, r, name) => {
    const d = MB.CreateDisc(name, { radius: r, tessellation: 40 }, scene);
    d.rotation.x = Math.PI / 2; d.position.set(x, terrainH(x, z) + 0.035, z); d.material = discM;
    d.freezeWorldMatrix(); d.isPickable = false;
  };
  slab.uScale = slab.vScale = 10;
  // squares (tole): stone paving and a tiered pagoda in the middle
  for (const [i, q] of (landmarks.ktmSquares || []).entries()) {
    disc(q.x, q.z, q.r + 2, "ktmSquare" + i);
    useTile(q.x, q.z);
    setLift(terrainH(q.x, q.z));
    setXF(makeXF(q.x, q.z, krr(0, Math.PI / 2)));
    const base = clamp(q.r * 0.42, 6.5, 8.5);
    createTieredPagoda({ tiers: kpick([2, 3, 3]), baseWidth: base, tierHeight: krr(2.8, 3.3) });
    if (krand() < 0.7) shrine(q.r * 0.62, q.r * 0.3);
    clearXF();
    setLift(0);
    const half = base / 2 + 3.3;
    map.push({ pts: [[q.x - half, q.z - half], [q.x + half, q.z - half], [q.x + half, q.z + half], [q.x - half, q.z + half]], color: "#8a4a32" });
  }
  // Durbar Square
  const d = landmarks.ktmDurbar;
  if (d) {
    disc(d.x, d.z, d.r + 2, "ktmDurbar");
    useTile(d.x, d.z);
    const xf = makeXF(d.x, d.z, d.yaw);
    const dy = terrainH(d.x, d.z);
    setLift(dy);
    setXF(xf);
    const { shapes, neo } = createNewarPalace({ towerTiers: 5, wingLength: 26 });
    clearXF();
    setLift(0);
    for (const s of shapes) map.push({ pts: [[s.x0, s.z0], [s.x1, s.z0], [s.x1, s.z1], [s.x0, s.z1]].map(([x, z]) => xfp(xf, x, z)), color: s.color });
    const [nx, nz] = xfp(xf, neo.x, neo.z);
    roofsOut.push({ xf: makeXF(nx, nz, d.yaw), hw: neo.hw, hd: neo.hd, lhw: neo.hw - 1, lhd: neo.hd - 1, top: neo.top + dy, mechs: [] });
  }
  return { map, roofs: roofsOut };
}

// A ground mesh (w × d, centred on cx, cz) with its vertices following the
// terrain, `y` above it.
function draped(name, cx, cz, w, d, y) {
  const g = BABYLON.MeshBuilder.CreateGround(name, {
    width: w, height: d, subdivisionsX: Math.ceil(w / 6), subdivisionsY: Math.ceil(d / 6),
  }, scene);
  const p = g.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  for (let i = 0; i < p.length; i += 3) p[i + 1] = landH(cx + p[i], cz + p[i + 2]) + y;
  g.setVerticesData(BABYLON.VertexBuffer.PositionKind, p);
  g.position.set(cx, 0, cz);
  g.refreshBoundingInfo();
  g.freezeWorldMatrix(); g.isPickable = false;
  return g;
}

// ---------------------------------------------------------------- culling
// After flushAccs: collect each tile's meshes; then every quarter second turn
// off tiles further away than the fog end (they'd be fully fogged anyway).
export function initKathmanduCulling() {
  for (const t of tiles) {
    if (!t) continue;
    for (const a of Object.values(t.accs)) t.meshes.push(...(a.meshes.length ? a.meshes : a.mesh ? [a.mesh] : []));
  }
}
let cullT = 0;
export function updateKathmandu(dt, cam) {
  cullT -= dt;
  if (cullT > 0) return;
  cullT = 0.25;
  const far = scene.fogEnd + 40, x = cam.position.x, z = cam.position.z;
  for (const t of tiles) {
    if (!t) continue;
    const dx = Math.max(t.x0 - x, 0, x - t.x1), dz = Math.max(t.z0 - z, 0, z - t.z1);
    const on = Math.hypot(dx, dz) < far;
    if (on === t.on) continue;
    t.on = on;
    for (const m of t.meshes) m.setEnabled(on);
  }
}
