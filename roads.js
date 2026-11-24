// roads.js — the road graph (nodes + curved edges), its generation for the
// three areas, road/sidewalk/marking meshes, street lamps, and fast
// "distance to the nearest road" queries used to place everything else.
//
//   Paris quarter  : a plaza roundabout, 8 radial boulevards, concentric ring
//                    boulevards and wavy minor ring streets.
//   New York city  : a warped (bending) avenue/street grid, a roundabout and
//                    a curving diagonal "Broadway".
//   Park           : three winding parkways linking the two.
//   London         : east of Midtown — organic streets, river, bridges (london.js).
//   Kathmandu      : north of Midtown — grown lanes off a few arterials (kathmandu.js).
import {
  scene, rand, rr, pick, clamp, hex, flatMat, flatTexMat, texMat, litMat, makeAcc, addFlatQuad,
  addBox, solidBox, setXF, clearXF, makeXF, radialTex, glow, setLift, terrainH, terrainSlope, staticInstance, onStaticFlush, staticMeshes,
} from "./engine.js";
import { noiseTex, slabTex } from "./textures.js";
import { LONDON, RW, riverDist, inLondon, generateLondonRoads, placeLondonLandmarks } from "./london.js";
import { inKathmandu, generateKathmanduRoads } from "./kathmandu.js";

export const PARIS = { x: -560, z: 0, R: 340 };
export const CITY = { x0: -114, x1: 720, z0: -560, z1: 560 };
export const SHORE_X = -960;
export const WORLD = { x0: -1000, x1: 1600, z0: -600, z1: 1340 };

export function districtAt(x, z) {
  if (inKathmandu(x, z)) return "kathmandu";
  if (Math.hypot(x - PARIS.x, z - PARIS.z) <= PARIS.R + 6) return "paris";
  if (x >= LONDON.x0 - 10 && inLondon(x, z)) return riverDist(x, z) < RW + 3 ? "river" : "london";
  if (x >= CITY.x0 && z > CITY.z0 && z < CITY.z1) return "city";
  if (x < SHORE_X + 55) return "beach";
  return "park";
}

export const nodes = [];
export const edges = [];
export const reserved = []; // {x, z, r} circles nothing may be built on
export const landmarks = {};

export function node(x, z) {
  const n = { x, z, edges: [], id: nodes.length };
  nodes.push(n);
  return n;
}
export function edge(a, b, pts, w, sw, kind, district) {
  pts[0] = [a.x, a.z];
  pts[pts.length - 1] = [b.x, b.z];
  const xs = [], zs = [], cum = [0];
  for (let i = 0; i < pts.length; i++) {
    xs.push(pts[i][0]); zs.push(pts[i][1]);
    if (i) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
  }
  const e = { a, b, xs, zs, cum, len: cum[cum.length - 1], w, sw, kind, district, id: edges.length };
  e.lane = w >= 10 ? 1.9 : w / 4;
  a.edges.push(e); b.edges.push(e);
  edges.push(e);
  return e;
}

// ---- curve samplers (≈3 m spacing) ----
const STEP = 3;
export function linePts(ax, az, bx, bz) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / STEP));
  const out = [];
  for (let k = 0; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  return out;
}
export function arcPts(cx, cz, R, a0, a1, bulge = 0) {
  const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * R) / STEP));
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, a = a0 + (a1 - a0) * t, r = R + bulge * Math.sin(Math.PI * t);
    out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return out;
}
function catmull(P) {
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(i - 1, 0)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(i + 2, P.length - 1)];
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / STEP));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(P[P.length - 1].slice());
  return out;
}

// Point + unit tangent at distance s along edge e.
const PA = { x: 0, z: 0, tx: 0, tz: 1 };
export function pathAt(e, s, out = PA) {
  s = clamp(s, 0, e.len);
  const c = e.cum;
  let lo = 0, hi = c.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
  const seg = c[hi] - c[lo] || 1;
  const t = (s - c[lo]) / seg;
  const dx = e.xs[hi] - e.xs[lo], dz = e.zs[hi] - e.zs[lo];
  const dl = Math.hypot(dx, dz) || 1;
  out.x = e.xs[lo] + dx * t;
  out.z = e.zs[lo] + dz * t;
  out.tx = dx / dl; out.tz = dz / dl;
  return out;
}
export const otherEnd = (e, n) => (e.a === n ? e.b : e.a);

// ---------------------------------------------------------------- generation
export function generateRoads() {
  // ---------- Paris quarter ----------
  const P = PARIS;
  const Rs = [44, 104, 150, 202, 252, 296, 334];
  const ringT = ["plaza", "minor", "major", "minor", "major", "minor", "outer"];
  const angs = [];
  for (let k = 0; k < 8; k++) angs.push(k * (Math.PI / 4) + ([0, 1, 4, 7].includes(k) ? 0 : rr(-0.13, 0.13)));
  const N = angs.map((a) => Rs.map((R) => node(P.x + Math.cos(a) * R, P.z + Math.sin(a) * R)));
  for (let k = 0; k < 8; k++) {
    for (let i = 0; i < Rs.length - 1; i++) {
      const a = N[k][i], b = N[k][i + 1];
      edge(a, b, linePts(a.x, a.z, b.x, b.z), 15, 4.5, "radial", "paris");
    }
  }
  const W = { plaza: 14, major: 13, minor: 9, outer: 13 }, SW = { plaza: 5, major: 4.5, minor: 3, outer: 4 };
  for (let i = 0; i < Rs.length; i++) {
    const t = ringT[i];
    for (let k = 0; k < 8; k++) {
      if (t === "minor" && rand() < 0.2) continue;
      const a0 = angs[k], a1 = angs[(k + 1) % 8] + (k === 7 ? Math.PI * 2 : 0);
      const bulge = t === "minor" ? rr(-11, 11) : 0;
      edge(N[k][i], N[(k + 1) % 8][i], arcPts(P.x, P.z, Rs[i], a0, a1, bulge), W[t], SW[t], t, "paris");
    }
  }
  reserved.push({ x: P.x, z: P.z, r: 31 });
  landmarks.parisPlaza = { x: P.x, z: P.z };

  // ---------- New York city ----------
  const AX = [-100, 0, 100, 200, 300, 400, 500, 600];
  const SZ = [];
  for (let z = -480; z <= 480; z += 80) SZ.push(z);
  const warp = (x, z) => [x + 22 * Math.sin(z / 210 + 0.6), z + 14 * Math.sin(x / 170 + 1.3)];
  const RBi = 4, RBj = 6, RR = 30;
  const [rcx, rcz] = warp(AX[RBi], SZ[RBj]);
  const G = AX.map((x, i) => SZ.map((z, j) => (i === RBi && j === RBj ? null : node(...warp(x, z)))));
  const ring = [];
  const trimToRing = (pts) => {
    let k = 0;
    while (k < pts.length && Math.hypot(pts[k][0] - rcx, pts[k][1] - rcz) < RR) k++;
    const a = pts[k - 1], b = pts[k];
    const da = Math.hypot(a[0] - rcx, a[1] - rcz), db = Math.hypot(b[0] - rcx, b[1] - rcz);
    const t = (RR - da) / (db - da);
    const ip = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const n = node(ip[0], ip[1]);
    n.ang = Math.atan2(ip[1] - rcz, ip[0] - rcx);
    ring.push(n);
    return [n, [ip, ...pts.slice(k)]];
  };
  const gridEdge = (i1, j1, i2, j2, w, sw, kind) => {
    let pts = linePts(AX[i1], SZ[j1], AX[i2], SZ[j2]).map(([x, z]) => warp(x, z));
    let a = G[i1][j1], b = G[i2][j2];
    if (!a) [a, pts] = trimToRing(pts);
    if (!b) { let r; [b, r] = trimToRing(pts.slice().reverse()); pts = r.reverse(); }
    return edge(a, b, pts, w, sw, kind, "city");
  };
  for (let i = 0; i < AX.length; i++) for (let j = 0; j < SZ.length - 1; j++) gridEdge(i, j, i, j + 1, 14, 4.5, "avenue");
  for (let j = 0; j < SZ.length; j++) for (let i = 0; i < AX.length - 1; i++) gridEdge(i, j, i + 1, j, 10, 4, "street");
  ring.sort((p, q) => p.ang - q.ang);
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], b = ring[(k + 1) % ring.length];
    const a1 = b.ang + (k === ring.length - 1 ? Math.PI * 2 : 0);
    edge(a, b, arcPts(rcx, rcz, RR, a.ang, a1), 12, 4, "roundabout", "city");
  }
  reserved.push({ x: rcx, z: rcz, r: RR - 11 });
  landmarks.roundabout = { x: rcx, z: rcz, r: RR - 11 };

  // Broadway: a long curving diagonal across the grid.
  const ba = G[0][1], bb = G[7][11];
  const bpts = catmull([[ba.x, ba.z], [40, -300], [150, -160], [232, -45], [345, 140], [452, 282], [bb.x, bb.z]]);
  edge(ba, bb, bpts, 14, 4.5, "broadway", "city");
  // Times-Square-style plaza where Broadway passes mid-town.
  let best = null;
  for (const p of bpts) {
    const d = Math.hypot(p[0] - 190, p[1] + 100);
    if (!best || d < best.d) best = { x: p[0], z: p[1], d };
  }
  landmarks.times = { x: best.x, z: best.z };

  // ---------- Park: winding parkways between the two ----------
  const pw = (a, b, mids) => edge(a, b, catmull([[a.x, a.z], ...mids, [b.x, b.z]]), 11, 3, "parkway", "park");
  pw(N[0][6], G[0][6], [[-196, 38], [-160, -26], [-128, 16]]);
  pw(N[7][6], G[0][3], [[-282, -262], [-215, -214], [-156, -250]]);
  pw(N[1][6], G[0][9], [[-282, 262], [-215, 214], [-156, 250]]);

  // ---------- London: east of Midtown, reached along five cross streets ----------
  generateLondonRoads({
    node, edge, arcPts, linePts, reserved, landmarks,
    eastNodes: [1, 4, 6, 8, 11].map((j) => G[AX.length - 1][j]),
  });

  // ---------- Kathmandu: north of Midtown, reached up four avenues and from Paris ----------
  generateKathmanduRoads({
    node, edge, reserved, landmarks,
    gates: [0, 1, 3, 5, 7].map((i) => G[i][SZ.length - 1]),
    parisNode: N[2][Rs.length - 1],
  });

  indexRoads();
  placeLondonLandmarks(roadDist, reserved, landmarks);
}

// ---------------------------------------------------------------- road distance index
const RG = 16;
const rgrid = new Map();
const rkey = (ix, iz) => (ix + 2000) * 8192 + (iz + 2000);
function indexRoads() {
  for (const e of edges) {
    const clear = e.w / 2 + e.sw;
    for (let i = 0; i < e.xs.length - 1; i++) {
      const seg = { x0: e.xs[i], z0: e.zs[i], x1: e.xs[i + 1], z1: e.zs[i + 1], hw: e.w / 2, clear, e, s0: e.cum[i] };
      const minX = Math.min(seg.x0, seg.x1) - clear, maxX = Math.max(seg.x0, seg.x1) + clear;
      const minZ = Math.min(seg.z0, seg.z1) - clear, maxZ = Math.max(seg.z0, seg.z1) + clear;
      for (let ix = Math.floor(minX / RG); ix <= Math.floor(maxX / RG); ix++) {
        for (let iz = Math.floor(minZ / RG); iz <= Math.floor(maxZ / RG); iz++) {
          const k = rkey(ix, iz);
          let c = rgrid.get(k);
          if (!c) { c = []; rgrid.set(k, c); }
          c.push(seg);
        }
      }
    }
  }
}
function segDist(px, pz, s) {
  const dx = s.x1 - s.x0, dz = s.z1 - s.z0;
  const l2 = dx * dx + dz * dz || 1;
  const t = clamp(((px - s.x0) * dx + (pz - s.z0) * dz) / l2, 0, 1);
  return Math.hypot(px - (s.x0 + dx * t), pz - (s.z0 + dz * t));
}
// Signed clearance from the road corridor (asphalt + sidewalks). < 0 = on it.
export function roadDist(x, z) {
  const c = rgrid.get(rkey(Math.floor(x / RG), Math.floor(z / RG)));
  let best = 40;
  if (c) for (const s of c) { const d = segDist(x, z, s) - s.clear; if (d < best) best = d; }
  return best;
}
// Signed clearance from asphalt only.
export function asphaltDist(x, z) {
  const c = rgrid.get(rkey(Math.floor(x / RG), Math.floor(z / RG)));
  let best = 40;
  if (c) for (const s of c) { const d = segDist(x, z, s) - s.hw; if (d < best) best = d; }
  return best;
}
export function nearestEdge(x, z) {
  let best = null, bd = Infinity;
  for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
    const c = rgrid.get(rkey(Math.floor(x / RG) + ix, Math.floor(z / RG) + iz));
    if (!c) continue;
    for (const s of c) { const d = segDist(x, z, s); if (d < bd) { bd = d; best = s; } }
  }
  return best ? { e: best.e, d: bd } : null;
}

// ---------------------------------------------------------------- meshes
export const lampPools = [];   // the light-pool meshes (shown at night)
export const bulbMats = [];
export const lampSpots = [];

export function buildRoadMeshes() {
  const asphaltTex = noiseTex("asphalt", "#3b3e43", 3500, "120,120,125", "15,15,18", 128, [1, 2]);
  const asphaltMat = flatTexMat("asphaltM", asphaltTex, 0.4);
  asphaltMat.zOffset = -4;
  const asphalt = makeAcc("asphalt", asphaltMat, 8, 8);
  const walkMat = (name, tex) => { const m = texMat(name, tex, 0.03); m.zOffset = -3; return m; };
  const walks = {
    city: makeAcc("walkCity", walkMat("walkCityM", slabTex("walkCityT", "#a9a8a3", "rgba(70,70,70,0.45)")), 3, 3),
    paris: makeAcc("walkParis", walkMat("walkParisM", slabTex("walkParisT", "#c9bea6", "rgba(110,95,70,0.45)", 6)), 3, 3),
    park: makeAcc("walkPark", walkMat("walkParkM", slabTex("walkParkT", "#b8b2a2", "rgba(90,85,70,0.4)")), 3, 3),
    london: makeAcc("walkLondon", walkMat("walkLondonM", slabTex("walkLondonT", "#a3a09a", "rgba(60,58,55,0.5)", 3)), 3, 3),
    kathmandu: makeAcc("walkKtm", walkMat("walkKtmM", slabTex("walkKtmT", "#a8836a", "rgba(90,55,40,0.45)", 6)), 3, 3),
  };
  const lineM = (n, c) => { const m = flatMat(n, hex(c), 0.3); m.zOffset = -5; return m; };
  const white = makeAcc("lineWhite", lineM("lineWhiteM", "#e2dfd2"));
  const yellow = makeAcc("lineYellow", lineM("lineYellowM", "#e6b833"));

  for (const e of edges) {
    const hw = e.w / 2, n = e.xs.length;
    const R = [];
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
      const tx = e.xs[i1] - e.xs[i0], tz = e.zs[i1] - e.zs[i0];
      const l = Math.hypot(tx, tz) || 1;
      R.push([tz / l, -tx / l]);
    }
    const P = (i, off) => [e.xs[i] + R[i][0] * off, e.zs[i] + R[i][1] * off];
    const walk = walks[e.district] || walks.park;
    for (let i = 0; i < n - 1; i++) {
      const u0 = e.cum[i] / 8, u1 = e.cum[i + 1] / 8;
      // on hills / bridge ramps, split the road across into ~3 m lanes so it
      // follows the ground's curve (a single quad edge-to-edge stays flat
      // across and the ground pokes up through the middle)
      const [ax, az] = P(i, 0), [bx, bz] = P(i + 1, 0);
      const hilly = terrainH(ax, az) > 0.01 || terrainH(bx, bz) > 0.01;
      const nS = hilly ? Math.max(1, Math.ceil(e.w / 3)) : 1;
      for (let k = 0; k < nS; k++) {
        const a = -hw + (2 * hw * k) / nS, b = -hw + (2 * hw * (k + 1)) / nS;
        addFlatQuad(asphalt, P(i, a), P(i, b), P(i + 1, b), P(i + 1, a), 0.07,
          [[a / 8, u0], [b / 8, u0], [b / 8, u1], [a / 8, u1]]);
      }
      const w0 = e.cum[i] / 3, w1 = e.cum[i + 1] / 3;
      for (const sd of [-1, 1]) {
        const a = hw * sd, b = (hw + e.sw) * sd;
        addFlatQuad(walk, P(i, a), P(i, b), P(i + 1, b), P(i + 1, a), 0.055, [[a / 3, w0], [b / 3, w0], [b / 3, w1], [a / 3, w1]]);
      }
    }

    // markings — skipped near busy junctions
    const busyA = e.a.edges.length >= 3, busyB = e.b.edges.length >= 3;
    const s0 = busyA ? 14 : 2, s1 = e.len - (busyB ? 14 : 2);
    const strip = (acc, off, w, sa, sb) => {
      if (sb - sa < 0.5) return;
      const pa = pathAt(e, sa, {}), pb = pathAt(e, sb, {});
      const ra = [pa.tz, -pa.tx], rb = [pb.tz, -pb.tx];
      addFlatQuad(acc,
        [pa.x + ra[0] * (off - w / 2), pa.z + ra[1] * (off - w / 2)], [pa.x + ra[0] * (off + w / 2), pa.z + ra[1] * (off + w / 2)],
        [pb.x + rb[0] * (off + w / 2), pb.z + rb[1] * (off + w / 2)], [pb.x + rb[0] * (off - w / 2), pb.z + rb[1] * (off - w / 2)],
        0.08, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    };
    if (e.kind === "avenue" || e.kind === "broadway") {
      for (let s = s0; s < s1; s += 3) { strip(yellow, -0.18, 0.13, s, Math.min(s + 3, s1)); strip(yellow, 0.18, 0.13, s, Math.min(s + 3, s1)); }
      for (let s = s0; s < s1 - 3; s += 8) { strip(white, -3.6, 0.13, s, s + 3); strip(white, 3.6, 0.13, s, s + 3); }
    } else if (e.w >= 11) {
      for (let s = s0; s < s1 - 3; s += 7) strip(white, 0, 0.14, s, s + 3);
    }
    // London kerbs: double yellow lines
    if (e.district === "london" && e.kind !== "circus" && e.kind !== "bridge") {
      for (let s = s0; s < s1; s += 6) {
        const sb = Math.min(s + 6, s1);
        for (const sd of [-1, 1]) for (const o of [0.32, 0.58]) strip(yellow, sd * (hw - o), 0.1, s, sb);
      }
    }
    // zebra crossings at busy junctions
    for (const [nd, atStart] of [[e.a, true], [e.b, false]]) {
      if (nd.edges.length < 3 || e.len < 30 || e.kind === "galli") continue;
      let maxClear = 0;
      for (const o of nd.edges) if (o !== e) maxClear = Math.max(maxClear, o.w / 2 + o.sw);
      const s = atStart ? maxClear + 2.2 : e.len - maxClear - 2.2;
      for (let off = -hw + 0.6; off < hw - 0.3; off += 1.1) strip(white, off, 0.55, s - 1.3, s + 1.3);
    }
  }
}

// Street lamps: modern arm lamps in the city, cast-iron lanterns in Paris.
export function buildLamps() {
  const postM = makeAcc("lampPost", litMat("lampPostM", hex("#33373c"), 0.3));
  const parisPostM = makeAcc("lampPostParis", litMat("lampPostParisM", hex("#1f2a24"), 0.3));

  const armBulbM = new BABYLON.StandardMaterial("bulbM", scene);
  armBulbM.disableLighting = true;
  armBulbM.emissiveColor = hex("#8d8b84");
  const lanternM = new BABYLON.StandardMaterial("lanternM", scene);
  lanternM.disableLighting = true;
  lanternM.emissiveColor = hex("#b9b3a0");
  bulbMats.push({ m: armBulbM, day: "#8d8b84", night: "#ffe3a8" }, { m: lanternM, day: "#b9b3a0", night: "#ffd98e" });

  const bulbT = BABYLON.MeshBuilder.CreateBox("bulb", { width: 0.36, height: 0.14, depth: 0.6 }, scene);
  bulbT.material = armBulbM; bulbT.setEnabled(false); glow.addIncludedOnlyMesh(bulbT);
  const lanternT = BABYLON.MeshBuilder.CreateBox("lantern", { width: 0.42, height: 0.62, depth: 0.42 }, scene);
  lanternT.material = lanternM; lanternT.setEnabled(false); glow.addIncludedOnlyMesh(lanternT);

  const poolTex = radialTex("pool", [[0, "rgba(255,206,130,0.75)"], [0.45, "rgba(255,180,100,0.32)"], [1, "rgba(255,170,90,0)"]]);
  const poolMat = new BABYLON.StandardMaterial("poolM", scene);
  poolMat.disableLighting = true;
  poolMat.emissiveTexture = poolTex;
  poolMat.opacityTexture = poolTex;
  poolMat.alphaMode = BABYLON.Engine.ALPHA_ADD;
  poolMat.zOffset = -6;
  const poolT = BABYLON.MeshBuilder.CreateGround("pool", { width: 1, height: 1 }, scene);
  poolT.material = poolMat; poolT.setEnabled(false);

  const pools = [];
  for (const e of edges) {
    if (e.kind === "galli") continue;                         // Kathmandu lanes: no street lamps
    const paris = e.district === "paris" || e.district === "london";
    const spacing = paris ? 26 : 34;
    let side = rand() < 0.5 ? 1 : -1;
    for (let s = 10; s < e.len - 8; s += spacing) {
      side = -side;
      const p = pathAt(e, s);
      const rx = p.tz * side, rz = -p.tx * side;            // outward (toward this sidewalk)
      const off = e.w / 2 + e.sw - 0.55;
      const x = p.x + rx * off, z = p.z + rz * off;
      if (asphaltDist(x, z) < 0.8) continue;                 // would stand in another road
      if (lampSpots.some((l) => Math.abs(l.x - x) < 6 && Math.abs(l.z - z) < 6)) continue;
      const yaw = Math.atan2(-rx, -rz);                      // local +z faces the road
      const gy = terrainH(x, z);
      setLift(gy);
      setXF(makeXF(x, z, yaw));
      if (paris) {
        solidBox(-0.09, 0, -0.09, 0.09, 4.3, 0.09, parisPostM);
        addBox(-0.18, 0, -0.18, 0.18, 0.7, 0.18, parisPostM);
        addBox(-0.28, 4.93, -0.28, 0.28, 5.05, 0.28, parisPostM);
        clearXF();
        staticInstance(lanternT, x, 4.62 + gy, z, yaw);
        pools.push([x, z, 12]);
      } else {
        solidBox(-0.1, 0, -0.1, 0.1, 6.7, 0.1, postM);
        addBox(-0.05, 6.5, 0, 0.05, 6.62, 1.65, postM);
        clearXF();
        const bx = x - rx * 1.5, bz = z - rz * 1.5;
        staticInstance(bulbT, bx, 6.42 + gy, bz, yaw);
        pools.push([x - rx * 3.2, z - rz * 3.2, 15]);
      }
      setLift(0);
      lampSpots.push({ x, z });
    }
  }
  // (lying along the slope on the hillside)
  for (const [x, z, s] of pools) {
    staticInstance(poolT, x, 0.12 + terrainH(x, z), z, 0, [s, 1, s],
      -Math.atan(terrainSlope(x, z, 0, 1)), Math.atan(terrainSlope(x, z, 1, 0)));
  }
  onStaticFlush(() => {
    for (const m of staticMeshes(poolT)) { m.isVisible = false; lampPools.push(m); }
  });
}
