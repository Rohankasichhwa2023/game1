// himalaya.js — the Himalayas: the Everest massif and its range, base camp on
// the Khumbu glacier, yetis on the ice.
//
// None of it exists until you first walk through the gateway on Swayambhu's
// north shore: then (behind a loading screen) the range is raised out at HIM
// (realm.js), ~15 km from town — far past the camera's reach from anywhere in
// the city, so the two are never drawn together. Leaving switches the whole
// range off; coming back just switches it on again.
//
//   terrain   one height function (u east, v north of HIM): a Khumbu-like
//             valley climbing north from base camp to an icefall, walled by
//             Nuptse, with Everest's pyramid behind, Lhotse beside it, Pumori
//             and Ama Dablam nearby and a ring of further giants. Ridged noise
//             makes the ridgelines and gullies. Sampled once on an 8 m grid
//             (what you walk on), drawn as three rings of mesh (8 / 24 / 80 m)
//             stitched so no cracks show; vertex colours put snow on the
//             gentler slopes, bare rock on the cliffs, moraine and patchy snow
//             on the valley floor, white-blue glacier ice with crevasses up the
//             valley, a trodden trail.
//   detail    thousands of moraine boulders, the icefall's seracs, a frozen
//             lake, clouds wrapped round the peaks, a plume of snow off the
//             summit, falling snow round you.
//   camp      tents, a mess tent, a puja chorten with prayer flags strung out
//             from its pole, mani stones, a campfire, a sign, the gate home.
//   world     the gateway itself (Swayambhu's north shore), and a far skyline
//             of snow peaks behind the hill, seen from all over town.
import { scene, glow, hex, V3, C3, clamp, litMat, canvasTex, radialTex, addSolidR, colorTemplate, landH, hemi, SWAY, query, circleHit } from "./engine.js";
import { seaAt } from "./water.js";
import { WORLD, asphaltDist } from "./roads.js";
import { HIM, CAMP, setHimHeight, toWorld } from "./realm.js";
import { NPASS } from "./terrain.js";
import { spawnRealmAnimals } from "./wildlife.js";
import { spawnSnowmobiles } from "./vehicles.js";

const MB = BABYLON.MeshBuilder;
let seed = 4471;
const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const rr = (a, b) => a + (b - a) * R();
const sstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- noise
const PERM = new Uint8Array(512);
{
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(R() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
const GX = [1, -1, 1, -1, 1, -1, 0, 0],
  GZ = [1, 1, -1, -1, 0, 0, 1, -1];
function perlin(x, y) {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    xf = x - xi,
    yf = y - yi;
  const X = xi & 255,
    Y = yi & 255;
  const g = (h, dx, dy) => GX[h & 7] * dx + GZ[h & 7] * dy;
  const a = PERM[X + PERM[Y]],
    b = PERM[X + 1 + PERM[Y]],
    c = PERM[X + PERM[Y + 1]],
    d = PERM[X + 1 + PERM[Y + 1]];
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10),
    v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const x1 = g(a, xf, yf) + (g(b, xf - 1, yf) - g(a, xf, yf)) * u;
  const x2 = g(c, xf, yf - 1) + (g(d, xf - 1, yf - 1) - g(c, xf, yf - 1)) * u;
  return (x1 + (x2 - x1) * v) * 0.9;
}
function fbm(x, y, o) {
  let s = 0,
    a = 0.5,
    f = 1;
  for (let i = 0; i < o; i++) {
    s += perlin(x * f, y * f) * a;
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}
// sharp ridgelines (1 on a crest, falling away into gullies)
function ridged(x, y, o) {
  let s = 0,
    a = 0.55,
    f = 1,
    w = 1;
  for (let i = 0; i < o; i++) {
    let n = 1 - Math.abs(perlin(x * f, y * f));
    n *= n * w;
    w = clamp(n * 1.8, 0, 1);
    s += n * a;
    f *= 2.1;
    a *= 0.5;
  }
  return s;
}

// ---------------------------------------------------------------- the lie of the land (local u east, v north)
// the valley floor: down-valley to the south, up through the icefall to the
// Western Cwm in the north
const VALLEY = [[0, -3600], [160, -2600], [-70, -1650], [0, -700], [-110, 120], [70, 820], [160, 1380]];
const TRAIL = [[0, -2700], [70, -1750], [0, -780], [-40, -220], [-95, 260]];
const vFloor = (v) => (v < -700 ? -150 * sstep(-700, -3600, v) : 120 * sstep(-700, 820, v) + 120 * sstep(820, 1400, v));
function polyDist(pts, u, v) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i],
      [bx, bz] = pts[i + 1];
    const dx = bx - ax,
      dz = bz - az,
      l2 = dx * dx + dz * dz;
    const t = clamp(((u - ax) * dx + (v - az) * dz) / l2, 0, 1);
    const d = Math.hypot(u - ax - dx * t, v - az - dz * t);
    if (d < best) best = d;
  }
  return best;
}
// the giants: u, v, height, radius, ridges (spurs), spur strength, rotation, east-west stretch
const P = (name, u, v, h, r, k, rd, rot, sx = 1) => ({ name, u, v, h, r, k, rd, rot, sx, sd: R() * 50 });
const PEAKS = [
  P("Everest", 150, 2350, 2050, 1650, 3, 0.26, 0.35),
  P("Lhotse", 1050, 1650, 1420, 1100, 3, 0.24, 1.25),
  P("Nuptse", -560, 1360, 1150, 900, 3, 0.27, 0.15, 1.3),
  P("", -1060, 1180, 880, 700, 3, 0.25, 0.9),
  P("Pumori", -1350, 430, 1000, 720, 3, 0.22, 0.85),
  P("Changtse", -260, 3350, 1260, 1000, 3, 0.25, 0.1),
  P("Ama Dablam", 1550, -1650, 1080, 620, 4, 0.3, 0.3),
  P("Cho Oyu", -2750, 2400, 1560, 1500, 3, 0.24, 0.7),
  P("Makalu", 3300, 1650, 1620, 1350, 4, 0.26, 0.2),
  P("Thamserku", 2300, -2700, 1020, 850, 3, 0.24, 0.6),
  P("Kongde", -2350, -2550, 960, 950, 3, 0.22, 1.4),
  P("", -3050, -620, 1150, 1100, 3, 0.25, 0.5),
  P("", 2950, -320, 1220, 1000, 3, 0.25, 1.1),
  P("", -1550, -1500, 720, 700, 3, 0.22, 0.3),
  P("", 820, -2750, 680, 600, 3, 0.22, 0.9),
  P("", -650, -3300, 820, 900, 3, 0.22, 0.2),
  P("", 1700, 800, 820, 700, 3, 0.24, 0.7),
  P("", -1900, 1250, 900, 800, 3, 0.24, 1.0),
];
for (let i = 0; i < 24; i++) {
  const a = (i / 24) * Math.PI * 2 + rr(-0.1, 0.1),
    d = rr(4700, 6500);
  PEAKS.push(P("", Math.sin(a) * d, 700 + Math.cos(a) * d, rr(900, 1600), rr(1000, 1500), 3 + (i % 2), rr(0.18, 0.3), rr(0, 6.28)));
}
const LAKE = { u: -270, v: -560, r: 55 };
const EXIT_L = { u: 0, v: -905 };        // the trail home (walk into it)
const ARRIVE_L = { u: 0, v: -850 };       // where you come out, facing camp
const campLevel = () => vFloor(CAMP.v) + 1.2;
// the height of the land (no flattening)
function natural(u, v) {
  const vd = polyDist(VALLEY, u, v);
  const vf = vFloor(v);
  let h = vf + sstep(50, 950, vd) * (380 + 300 * fbm(u / 1300 + 7.1, v / 1300 - 3.3, 3));
  for (const p of PEAKS) {
    const du = (u - p.u) / p.sx,
      dv = v - p.v;
    if (du > p.r || du < -p.r || dv > p.r || dv < -p.r) continue;
    const d = Math.hypot(du, dv);
    if (d >= p.r) continue;
    const dd = d * (1 + p.rd * Math.cos(p.k * (Math.atan2(du, dv) - p.rot)));
    if (dd >= p.r) continue;
    const prof = Math.pow(1 - dd / p.r, 1.45);
    h += p.h * prof * (0.78 + 0.4 * ridged(u / 650 + p.sd, v / 650, 3));
  }
  // gullies and ribs on the high ground, lumps on the moraine
  const hi = sstep(30, 500, h - vf);
  h += (ridged(u / 210 + 3.1, v / 210 - 1.7, 4) - 0.35) * 90 * hi;
  // crags and buttresses (70 m), knobs of rock (30 m)
  const mid = sstep(20, 160, h - vf);
  h += (ridged(u / 70 - 5.3, v / 70 + 2.2, 3) - 0.35) * 32 * mid + perlin(u / 28 + 9, v / 28) * 6 * mid;
  // rock bands: in places the face is broken into steep steps and ledges
  // (16 m), so it's climbed ledge by ledge rather than marched straight up
  const band = 16,
    f = h / band,
    fl = Math.floor(f);
  const stepped = (fl + sstep(0.35, 0.75, f - fl)) * band;
  h += (stepped - h) * 0.8 * mid * sstep(-0.15, 0.25, fbm(u / 260 + 4, v / 260 - 6, 2));
  h += fbm(u / 38, v / 38, 2) * 3.4 * (1 - hi * 0.6);
  return h;
}
// … with base camp's terrace, the frozen lake's basin and the gate's plot levelled
function rawH(u, v) {
  let h = natural(u, v);
  const cd = Math.hypot(u - CAMP.u, v - CAMP.v);
  if (cd < CAMP.r + 40) h += (campLevel() + fbm(u / 20, v / 20, 1) * 0.35 - h) * (1 - sstep(CAMP.r - 10, CAMP.r + 40, cd));
  const ld = Math.hypot(u - LAKE.u, v - LAKE.v);
  if (ld < LAKE.r + 30) h += (campLevel() - 2.2 - h) * (1 - sstep(LAKE.r - 6, LAKE.r + 30, ld));
  return h;
}

// ---------------------------------------------------------------- the walkable height grid (8 m)
const GS = 8,
  GE = 3120,
  GN = (2 * GE) / GS + 1;
let grid = null;
function gridH(u, v) {
  const fx = (u + GE) / GS,
    fz = (v + GE) / GS;
  const i = Math.floor(fx),
    j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= GN - 1 || j >= GN - 1) return rawH(u, v);
  const tx = fx - i,
    tz = fz - j,
    k = j * GN + i;
  const a = grid[k] + (grid[k + 1] - grid[k]) * tx,
    b = grid[k + GN] + (grid[k + GN + 1] - grid[k + GN]) * tx;
  return a + (b - a) * tz;
}

// The surface you stand on is exactly the one that's drawn: inside NEAR the
// 8 m mesh, out to MID the 16 m one — the same triangles (each grid cell is
// split along its flatter diagonal, as ringMesh does), not a smooth
// interpolation of them, which on a steep face differs by metres (you'd sink
// under the slope, or float off it).
const NEAR = 1536,
  MID = 3120;
const gAt = (u, v) => grid[Math.round((v + GE) / GS) * GN + Math.round((u + GE) / GS)];
function triH(u, v, step, half) {
  const fx = (u + half) / step,
    fz = (v + half) / step;
  const i = Math.floor(fx),
    j = Math.floor(fz),
    tx = fx - i,
    tz = fz - j;
  const u0 = -half + i * step,
    v0 = -half + j * step;
  const ha = gAt(u0, v0),
    hb = gAt(u0 + step, v0),
    hc = gAt(u0, v0 + step),
    hd = gAt(u0 + step, v0 + step);
  if (Math.abs(ha - hd) < Math.abs(hb - hc))
    return tx >= tz ? ha + (hb - ha) * tx + (hd - hb) * tz : ha + (hc - ha) * tz + (hd - hc) * tx;
  return tx + tz <= 1 ? ha + (hb - ha) * tx + (hc - ha) * tz : hd + (hc - hd) * (1 - tx) + (hb - hd) * (1 - tz);
}
export function himGround(u, v) {
  if (!grid) return rawH(u, v);
  const au = Math.abs(u),
    av = Math.abs(v);
  if (au < NEAR && av < NEAR) return triH(u, v, 8, NEAR);
  if (au < MID - 0.01 && av < MID - 0.01) return triH(u, v, 16, MID);
  return rawH(u, v);
}


// ---------------------------------------------------------------- the map (M, and the minimap, while you're up here)
// A shaded-relief map of the range, baked once: the same snow / rock /
// glacier colours as the land itself, lit from the north-west, with contour
// lines every 100 m (heavier every 500 m). North is up; 8 m per pixel, out to
// MAP_EXT each way. The named peaks are labelled — Everest with a gold star.
const MAP_EXT = 3100,
  MAP_S = 8;
let mapCanvas = null;
function bakeMap() {
  const N = Math.round((2 * MAP_EXT) / MAP_S);
  const hs = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const v = MAP_EXT - (j + 0.5) * MAP_S;          // (row 0 is the north edge)
    for (let i = 0; i < N; i++) hs[j * N + i] = himGround(-MAP_EXT + (i + 0.5) * MAP_S, v);
  }
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const ctx = c.getContext("2d"),
    img = ctx.createImageData(N, N),
    D = img.data;
  const L = [-0.55, 0.62, 0.55];                    // light from the north-west, high up
  const ll = Math.hypot(...L);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const k = j * N + i,
        h = hs[k];
      const hl = hs[j * N + Math.max(0, i - 1)],
        hr = hs[j * N + Math.min(N - 1, i + 1)];
      const hn = hs[Math.max(0, j - 1) * N + i],
        hsd = hs[Math.min(N - 1, j + 1) * N + i];
      // normal (x east, y up, z north): rows run south, so north is j - 1
      const nx = -(hr - hl) / (2 * MAP_S),
        nz = -(hn - hsd) / (2 * MAP_S),
        nl = Math.hypot(nx, 1, nz);
      const shade = Math.max(0, (nx * L[0] + L[1] + nz * L[2]) / (nl * ll));
      const u = -MAP_EXT + (i + 0.5) * MAP_S,
        v = MAP_EXT - (j + 0.5) * MAP_S;
      let [r, g, b] = landColour(u, v, h, 1 / nl);
      const lit = 0.45 + 0.75 * shade;
      r *= lit;
      g *= lit;
      b *= lit;
      // contour lines
      const band = Math.floor(h / 100);
      if (band !== Math.floor(hr / 100) || band !== Math.floor(hsd / 100)) {
        const major = Math.floor(h / 500) !== Math.floor(hr / 500) || Math.floor(h / 500) !== Math.floor(hsd / 500);
        const k2 = major ? 0.62 : 0.82;
        r *= k2;
        g *= k2;
        b *= k2 * 1.04;
      }
      D[k * 4] = Math.min(255, r * 255);
      D[k * 4 + 1] = Math.min(255, g * 255);
      D[k * 4 + 2] = Math.min(255, b * 255);
      D[k * 4 + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  // the trail
  ctx.strokeStyle = "rgba(120,72,40,0.85)";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  TRAIL.forEach(([u, v], i) => {
    const x = (u + MAP_EXT) / MAP_S,
      y = (MAP_EXT - v) / MAP_S;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  mapCanvas = c;
}
// world (x, z) → map pixels
const himToMap = (x, z) => [(x - HIM.x + MAP_EXT) / MAP_S, (MAP_EXT - (z - HIM.z)) / MAP_S];
export function himMapData() {
  if (!mapCanvas) bakeMap();
  const labels = [];
  for (const p of PEAKS) {
    if (!p.name) continue;
    const [x, z] = toWorld(p.u, p.v);
    if (Math.abs(p.u) > MAP_EXT || Math.abs(p.v) > MAP_EXT) continue;
    labels.push({ x, z, t: p.name.toUpperCase(), s: altitudeAt(himGround(p.u, p.v)).toLocaleString() + " m", everest: p === PEAKS[0] });
  }
  const [cx, cz] = toWorld(CAMP.u, CAMP.v),
    [gx, gz] = toWorld(EXIT_L.u, EXIT_L.v);
  return { canvas: mapCanvas, toMap: himToMap, scale: MAP_S, labels, camp: { x: cx, z: cz }, gate: { x: gx, z: gz } };
}
// where to head for: Everest's summit (and once you've stood on it, back down to camp)
let summited = false;
export function himObjective(p) {
  const E = PEAKS[0],
    [ex, ez] = toWorld(E.u, E.v);
  if (Math.hypot(p.x - ex, p.z - ez) < 25 && p.y > himGround(E.u, E.v) - 12) summited = true;
  if (summited) {
    const [cx, cz] = toWorld(CAMP.u, CAMP.v);
    if (Math.hypot(p.x - cx, p.z - cz) < CAMP.r) summited = false;
    return { x: cx, z: cz, label: "Base camp" };
  }
  return { x: ex, z: ez, y: himGround(E.u, E.v), label: "Everest summit" };
}
// the climbing teams, for the map
export function climberSpots() {
  return teams.map((T) => T.members[0].node.position);
}

// ---------------------------------------------------------------- textures / materials
function detailTex() {
  const t = canvasTex(
    "himDetailT",
    256,
    (ctx, S) => {
      ctx.fillStyle = "#e6e6e6";
      ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 2600; i++) {
        const v = 190 + Math.floor(R() * 65);
        ctx.fillStyle = `rgba(${v},${v},${v},${0.35 + R() * 0.5})`;
        const s = 1 + R() * (R() < 0.08 ? 9 : 3);
        ctx.fillRect(R() * S, R() * S, s, s);
      }
      for (let i = 0; i < 90; i++) {
        ctx.strokeStyle = `rgba(150,150,150,${0.15 + R() * 0.2})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const x = R() * S,
          y = R() * S;
        ctx.moveTo(x, y);
        ctx.lineTo(x + rr(-14, 14), y + rr(-14, 14));
        ctx.stroke();
      }
    },
    true,
  );
  return t;
}
function cloudTexture(name, s0) {
  let s = s0;
  const Rn = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const t = canvasTex(
    name,
    256,
    (ctx, W, Hh) => {
      ctx.clearRect(0, 0, W, Hh);
      for (let i = 0; i < 16; i++) {
        const x = W * (0.15 + Rn() * 0.7),
          y = Hh * (0.4 + Rn() * 0.3),
          r = Hh * (0.16 + Rn() * 0.22);
        const g = ctx.createRadialGradient(x, y - r * 0.2, 0, x, y, r);
        g.addColorStop(0, "rgba(255,255,255,0.9)");
        g.addColorStop(0.6, "rgba(240,244,250,0.6)");
        g.addColorStop(1, "rgba(225,232,242,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    false,
    128,
  );
  t.hasAlpha = true;
  t.wrapU = t.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
  return t;
}
const emis = (name, col, alpha = 1) => {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.disableLighting = true;
  m.emissiveColor = col;
  m.alpha = alpha;
  return m;
};

// ---------------------------------------------------------------- terrain mesh: one ring
// A square grid from -half..half (step) with the square -inner..inner left
// out; the outer edge is stitched to the coarser ring outside (its in-between
// vertices follow the coarse edge) so no cracks open between them.
function ringMesh(name, half, inner, step, stitch, mat) {
  const n = Math.round((2 * half) / step) + 1;
  const pos = new Float32Array(n * n * 3),
    col = new Float32Array(n * n * 4),
    uv = new Float32Array(n * n * 2),
    hs = new Float32Array(n * n);
  const hAt = (u, v) => gridH(u, v);
  for (let j = 0; j < n; j++) {
    const v = -half + j * step;
    for (let i = 0; i < n; i++) {
      const u = -half + i * step;
      let h;
      const edgeX = i === 0 || i === n - 1,
        edgeZ = j === 0 || j === n - 1;
      if (stitch && (edgeX || edgeZ)) {
        // along the edge, between the coarse ring's vertices
        const along = edgeX ? v : u,
          a0 = Math.floor((along + half) / stitch) * stitch - half,
          t = (along - a0) / stitch;
        if (t < 1e-6) h = hAt(u, v);
        else if (edgeX) h = hAt(u, a0) + (hAt(u, a0 + stitch) - hAt(u, a0)) * t;
        else h = hAt(a0, v) + (hAt(a0 + stitch, v) - hAt(a0, v)) * t;
      } else h = hAt(u, v);
      const k = j * n + i;
      hs[k] = h;
      const [x, z] = toWorld(u, v);
      pos[k * 3] = x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z;
      uv[k * 2] = u / 7;
      uv[k * 2 + 1] = v / 7;
    }
  }
  const idx = [];
  for (let j = 0; j < n - 1; j++) {
    const v0 = -half + j * step;
    for (let i = 0; i < n - 1; i++) {
      const u0 = -half + i * step;
      if (inner && u0 >= -inner - 1e-6 && u0 + step <= inner + 1e-6 && v0 >= -inner - 1e-6 && v0 + step <= inner + 1e-6) continue;
      const a = j * n + i,
        b = a + 1,
        c = a + n,
        d = c + 1;
      // split along the shorter diagonal (follows ridges better)
      // (wound so the upper side is the front face)
      if (Math.abs(hs[a] - hs[d]) < Math.abs(hs[b] - hs[c])) idx.push(a, d, c, a, b, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  // normals from the heights (smooth, and matching across the rings)
  const nrm = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const hl = hs[j * n + Math.max(0, i - 1)],
        hr = hs[j * n + Math.min(n - 1, i + 1)];
      const hd = hs[Math.max(0, j - 1) * n + i],
        hu = hs[Math.min(n - 1, j + 1) * n + i];
      const sx = (i === 0 || i === n - 1 ? 1 : 2) * step,
        sz = (j === 0 || j === n - 1 ? 1 : 2) * step;
      const nx = -(hr - hl) / sx,
        nz = -(hu - hd) / sz,
        l = Math.hypot(nx, 1, nz);
      nrm[k * 3] = nx / l;
      nrm[k * 3 + 1] = 1 / l;
      nrm[k * 3 + 2] = nz / l;
      const [r, g, b] = landColour(-half + i * step, -half + j * step, hs[k], 1 / l);
      col[k * 4] = r;
      col[k * 4 + 1] = g;
      col[k * 4 + 2] = b;
      col[k * 4 + 3] = 1;
    }
  const m = new BABYLON.Mesh(name, scene);
  const vd = new BABYLON.VertexData();
  vd.positions = pos;
  vd.normals = nrm;
  vd.uvs = uv;
  vd.colors = col;
  vd.indices = new Uint32Array(idx);
  vd.applyToMesh(m, false);
  m.material = mat;
  m.parent = root;
  m.isPickable = false;
  m.freezeWorldMatrix();
  return m;
}
// snow on the gentler slopes and the high ground, bare rock on the cliffs,
// moraine and patchy snow on the valley floor, glacier ice up the valley
function landColour(u, v, h, ny) {
  const vf = vFloor(v),
    alt = h - vf;
  const n1 = fbm(u / 70 + 11, v / 70, 2),
    n2 = perlin(u / 9, v / 9);
  // rock: dark granite, browner lower down
  let r = 0.27 + 0.06 * n1 + 0.03 * n2,
    g = 0.26 + 0.05 * n1 + 0.03 * n2,
    b = 0.27 + 0.04 * n1 + 0.03 * n2;
  if (alt < 40) {
    const m = 1 - sstep(10, 40, alt);
    r += (0.5 + 0.05 * n2 - r) * m;
    g += (0.47 + 0.05 * n2 - g) * m;
    b += (0.43 + 0.04 * n2 - b) * m;
  }
  // snow lies almost everywhere: the moraine shows through in patches on the
  // valley floor, and the cliffs stay bare rock
  let snow = Math.max(sstep(-45, 25, alt + n1 * 80), sstep(25, 170, alt + n1 * 110));
  snow *= sstep(0.47, 0.72, ny);
  if (alt > 650) snow = Math.max(snow, sstep(0.32, 0.56, ny));        // up high it's white but for the steepest rock
  const sb = 0.97 + 0.03 * n2;
  r += (0.92 * sb - r) * snow;
  g += (0.945 * sb - g) * snow;
  b += (0.99 - b) * snow;
  // the glacier: from just above camp up through the icefall
  const vd = polyDist(VALLEY, u, v);
  if (v > -650 && v < 1500 && vd < 170) {
    // only on the glacier itself: low above the valley floor, gentle, and
    // fading out at the head of the valley, never painted up the walls
    const ice = sstep(170, 100, vd) * sstep(-650, -540, v) * sstep(1500, 1300, v) * (1 - sstep(20, 70, alt)) * sstep(0.5, 0.75, ny);
    let ir = 0.8 + 0.06 * n2,
      ig = 0.88 + 0.05 * n2,
      ib = 0.95;
    if (Math.sin(v * 0.085 + u * 0.03 + n1 * 5) > 0.93) {
      ir = 0.32;
      ig = 0.48;
      ib = 0.64;
    } // crevasses
    r += (ir - r) * ice;
    g += (ig - g) * ice;
    b += (ib - b) * ice;
  }
  // the trodden trail
  const td = polyDist(TRAIL, u, v);
  if (td < 2.8) {
    const t = 1 - sstep(1.4, 2.8, td);              // trodden snow and grit
    r += (0.64 - r) * t;
    g += (0.6 - g) * t;
    b += (0.56 - b) * t;
  }
  return [r, g, b];
}

// ---------------------------------------------------------------- state
let root = null,
  built = false,
  summitFlag = null,
  snowPS = null,
  backdrop = null,
  backdropMat = null,
  fire = null;
const clouds = [],
  portals = [];
export const himalayaBuilt = () => built;
export const himalayaRoot = () => root;

// prayer flags: lines [ax, ay, az, bx, by, bz] — little squares in the five
// colours hanging from each sagging string
const FLAG_COLS = ["#2f62c9", "#f2f0ea", "#c9302c", "#2f9a4c", "#e8c22c"].map((h) => hex(h));
function flagMesh(name, lines, parent) {
  const pos = [],
    col = [],
    nrm = [],
    idx = [];
  for (const [ax, ay, az, bx, by, bz] of lines) {
    const len = Math.hypot(bx - ax, by - ay, bz - az),
      n = Math.max(2, Math.floor(len / 0.62));
    const dx = (bx - ax) / len,
      dz = (bz - az) / len;
    for (let i = 0; i < n; i++) {
      const t0 = (i + 0.1) / n,
        t1 = (i + 0.9) / n;
      const P = (t, drop) => {
        const sag = Math.sin(Math.PI * t) * len * 0.06;
        return [ax + (bx - ax) * t, ay + (by - ay) * t - sag - drop, az + (bz - az) * t];
      };
      const c = FLAG_COLS[i % 5],
        b = pos.length / 3;
      for (const p of [P(t0, 0), P(t1, 0), P(t1, 0.46), P(t0, 0.46)]) {
        pos.push(p[0], p[1], p[2]);
        col.push(c.r, c.g, c.b, 1);
        nrm.push(-dz, 0, dx);
      }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  const m = new BABYLON.Mesh(name, scene);
  const vd = new BABYLON.VertexData();
  vd.positions = pos;
  vd.colors = col;
  vd.normals = nrm;
  vd.indices = idx;
  vd.applyToMesh(m);
  const mat = new BABYLON.StandardMaterial(name + "M", scene);
  mat.backFaceCulling = false;
  mat.diffuseColor = new C3(1, 1, 1);
  mat.emissiveColor = new C3(0.18, 0.18, 0.18);
  mat.specularColor = new C3(0, 0, 0);
  m.material = mat;
  m.parent = parent;
  m.isPickable = false;
  return m;
}

// ---------------------------------------------------------------- the world side: the pass north + the far skyline
// North of Swayambhu the land climbs into a pass between rocky, snowy
// foothills (terrain.js NPASS gives its height). Walk up it past the prayer
// flags and you're in the Himalayas — no door, no key. Its ground is drawn
// here: grass and scree by the shore, then scree, rock and snow as it rises.
export const WORLD_GATE = { x: SWAY.x, z: NPASS.z0 + 150 };   // where the pass takes you up (and where you come back)
let passMat = null;
function passColour(x, z, h, ny) {
  const n1 = perlin(x / 60 + 3, z / 60),
    n2 = perlin(x / 9, z / 9);
  // grass by the shore, scree further up
  const scree = sstep(NPASS.z0 + 20, NPASS.z0 + 110, z);
  let r = 0.42 + (0.5 - 0.42) * scree + 0.04 * n2,
    g = 0.55 + (0.47 - 0.55) * scree + 0.04 * n2,
    b = 0.3 + (0.43 - 0.3) * scree + 0.03 * n2;
  // bare rock on the steep bits
  const steep = 1 - sstep(0.6, 0.82, ny);
  r += (0.34 - r) * steep;
  g += (0.33 - g) * steep;
  b += (0.33 - b) * steep;
  // snow, thicker the higher it gets (lying on the gentler slopes)
  const snow = sstep(26, 80, h + n1 * 26) * sstep(0.55, 0.78, ny) * sstep(NPASS.z0 + 60, NPASS.z0 + 160, z);
  r += (0.93 - r) * snow;
  g += (0.95 - g) * snow;
  b += (0.99 - b) * snow;
  return [r, g, b];
}
export function buildHimalayaGateway() {
  // the ground of the pass (10 m grid, drawn just over the coast's grass)
  const STEP = 10,
    X0 = NPASS.x - NPASS.half,
    Z0 = NPASS.z0 + 14,
    NX = Math.round((2 * NPASS.half) / STEP) + 1,
    NZ = Math.round((NPASS.z1 - Z0) / STEP) + 1;
  const pos = [],
    col = [],
    nrm = [],
    uv = [],
    idx = [];
  for (let j = 0; j < NZ; j++)
    for (let i = 0; i < NX; i++) {
      const x = X0 + i * STEP,
        z = Z0 + j * STEP,
        h = landH(x, z);
      const e = 2,
        nx = -(landH(x + e, z) - landH(x - e, z)) / (2 * e),
        nz = -(landH(x, z + e) - landH(x, z - e)) / (2 * e),
        l = Math.hypot(nx, 1, nz);
      pos.push(x, h + 0.12, z);
      nrm.push(nx / l, 1 / l, nz / l);
      uv.push(x / 7, z / 7);
      const [r, g, b] = passColour(x, z, h, 1 / l);
      col.push(r, g, b, 1);
    }
  for (let j = 0; j < NZ - 1; j++)
    for (let i = 0; i < NX - 1; i++) {
      const a = j * NX + i;
      idx.push(a, a + NX + 1, a + NX, a, a + 1, a + NX + 1);
    }
  const m = new BABYLON.Mesh("himPass", scene);
  const vd = new BABYLON.VertexData();
  vd.positions = pos;
  vd.normals = nrm;
  vd.colors = col;
  vd.uvs = uv;
  vd.indices = idx;
  vd.applyToMesh(m);
  passMat = new BABYLON.StandardMaterial("himPassM", scene);
  passMat.diffuseTexture = detailTex();
  passMat.specularColor = new C3(0.05, 0.05, 0.05);
  passMat.zOffset = -3;
  m.material = passMat;
  m.isPickable = false;
  m.freezeWorldMatrix();
  // prayer flags strung across the pass, cairns along it, a signpost
  const stone = litMat("passStoneM", hex("#6d6862"), 0.05);
  const fz = WORLD_GATE.z - 12,
    lines = [];
  for (const k of [0, 1]) {
    const z = fz + k * 9,
      xa = NPASS.x - 13,
      xb = NPASS.x + 13;
    for (const x of [xa, xb]) {
      const pole = MB.CreateCylinder("passPole", { diameter: 0.14, height: 5.5, tessellation: 6 }, scene);
      pole.position.set(x, landH(x, z) + 2.75, z);
      pole.material = stone;
      pole.isPickable = false;
    }
    lines.push([xa, landH(xa, z) + 5.3, z, xb, landH(xb, z) + 5.3, z]);
  }
  flagMesh("passFlags", lines, null);
  // (the cairns' 40 stones merged into one mesh: one draw call, not 40)
  const stones = [];
  for (let k = 0; k < 8; k++) {
    const x = NPASS.x + (k % 2 ? 7 : -7) + Math.sin(k * 1.7) * 1.5,
      z = NPASS.z0 + 40 + k * 14;
    stones.push(...cairn(null, x, landH(x, z), z, stone));
  }
  const cairns = BABYLON.Mesh.MergeMeshes(stones, true);
  if (cairns) {
    cairns.isPickable = false;
    cairns.freezeWorldMatrix();
  }
  signpost(null, NPASS.x + 6, WORLD_GATE.z - 30, Math.PI, "HIMALAYAS ↑", "Everest base camp — keep going north", stone);
  buildWaySigns(stone);
  return m;
}

// ---------------------------------------------------------------- the way to the pass
// Fingerposts all over the islands, each an arrow-shaped board pointing to
// the next one along the way (round Swayambhu's hill — not through its
// forest), with the distance still to go. Read from either side.
// [id, x, z, next id]
const WAY = [
  ["pass", NPASS.x, NPASS.z0 + 100, null],
  ["hillW1", -118, 1620, "pass"],
  ["hillW2", -125, 1270, "hillW1"],
  ["hillE1", 505, 1300, "hillE2"],
  ["hillE2", 505, 1640, "pass"],
  ["swayGate", SWAY.x - 18, SWAY.z - SWAY.RW - 30, "hillW2"],
  ["ktmCore", 215, 905, "swayGate"],
  ["ktmSouth", 205, 655, "ktmCore"],
  ["ktmEast", 470, 1000, "hillE1"],
  ["midNorth", 330, 515, "ktmSouth"],
  ["midtown", 330, 10, "midNorth"],
  ["london", 800, 90, "midtown"],
  ["paris", -300, 10, "midtown"],
  ["parisN", -560, 280, "midNorth"],
];
const WAY_BY = Object.fromEntries(WAY.map((w) => [w[0], w]));
const wayLeft = (id) => {
  let d = 0,
    w = WAY_BY[id];
  while (w && w[3]) {
    const n = WAY_BY[w[3]];
    d += Math.hypot(n[1] - w[1], n[2] - w[2]);
    w = n;
  }
  return d;
};
// a clear patch of land near (x, z): not sea, not inside anything
function clearSpot(x, z) {
  for (let r = 0; r <= 24; r += 3)
    for (let k = 0; k < (r ? 10 : 1); k++) {
      const a = (k / 10) * Math.PI * 2,
        px = x + Math.cos(a) * r,
        pz = z + Math.sin(a) * r;
      if (seaAt(px, pz) || asphaltDist(px, pz) < 1.5) continue;   // (on land, off the carriageway)
      let hit = false;
      for (const s of query(px - 1.4, px + 1.4, pz - 1.4, pz + 1.4)) if (s.maxY > landH(px, pz) + 0.3 && circleHit(s, px, pz, 1.4)) hit = true;
      if (!hit) return [px, pz];
    }
  return null;
}
// the arrow board's two faces (tip right / tip left), text the right way round on both
function arrowTex(name, tipRight, title, sub) {
  const t = canvasTex(
    name,
    512,
    (ctx, W, Hh) => {
      ctx.clearRect(0, 0, W, Hh);
      const tip = 70;
      ctx.beginPath();
      if (tipRight) {
        ctx.moveTo(6, 10);
        ctx.lineTo(W - tip, 10);
        ctx.lineTo(W - 6, Hh / 2);
        ctx.lineTo(W - tip, Hh - 10);
        ctx.lineTo(6, Hh - 10);
      } else {
        ctx.moveTo(W - 6, 10);
        ctx.lineTo(tip, 10);
        ctx.lineTo(6, Hh / 2);
        ctx.lineTo(tip, Hh - 10);
        ctx.lineTo(W - 6, Hh - 10);
      }
      ctx.closePath();
      ctx.fillStyle = "#1f4f8a";
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = "#f2efe6";
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      const cx = tipRight ? (W - tip) / 2 + 6 : W / 2 + tip / 2 - 3;
      ctx.font = "bold 44px Segoe UI, sans-serif";
      ctx.fillText(title, cx, 60);
      ctx.font = "600 28px Segoe UI, sans-serif";
      ctx.fillStyle = "#cfe3ff";
      ctx.fillText(sub, cx, 102);
    },
    true,
    128,
  );
  t.hasAlpha = true;
  t.wrapU = t.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
  return t;
}
function fingerpost(x, z, tx, tz, title, sub, postMat) {
  const y = landH(x, z),
    node = new BABYLON.TransformNode("fingerpost", scene);
  node.position.set(x, y, z);
  const post = MB.CreateCylinder("fpPost", { diameter: 0.16, height: 3.4, tessellation: 8 }, scene);
  post.parent = node;
  post.position.y = 1.7;
  post.material = postMat;
  addSolidR(x, z, 0, 0.12, 0.12, y - 0.5, y + 3.4);
  // the board swings to point at (tx, tz): local +x toward it
  const arm = new BABYLON.TransformNode("fpArm", scene);
  arm.parent = node;
  arm.position.y = 2.75;
  arm.rotation.y = Math.atan2(-(tz - z), tx - x);
  for (const front of [true, false]) {
    const m = new BABYLON.StandardMaterial("fpM", scene);
    m.diffuseTexture = arrowTex("fpT", front, title, sub);
    m.emissiveColor = new C3(0.3, 0.3, 0.3);
    const p = MB.CreatePlane("fpBoard", { width: 2.9, height: 0.72 }, scene);
    p.parent = arm;
    p.position.set(1.35, 0, front ? -0.025 : 0.025);
    if (!front) p.rotation.y = Math.PI;
    p.material = m;
    p.isPickable = false;
  }
  post.isPickable = false;
}
function buildWaySigns(postMat) {
  for (const [id, x0, z0, next] of WAY) {
    if (!next) continue;
    const spot = clearSpot(x0, z0);
    if (!spot) continue;
    const [x, z] = spot,
      n = WAY_BY[next];
    const left = wayLeft(id) + Math.hypot(x - x0, z - z0),
      dist = left > 950 ? (left / 1000).toFixed(1) + " km" : Math.round(left / 10) * 10 + " m";
    fingerpost(x, z, n[1], n[2], "HIMALAYA PASS", "Everest  ·  " + dist, postMat);
  }
}

// a stack of flat stones (→ the stones)
function cairn(parent, x, y, z, mat) {
  const out = [];
  for (let k = 0; k < 5; k++) {
    const st = MB.CreateBox("cairn", { width: 0.95 - k * 0.16, height: 0.3, depth: 0.85 - k * 0.14 }, scene);
    st.position.set(x, y + 0.15 + k * 0.28, z);
    st.rotation.y = R() * 3;
    st.material = mat;
    st.parent = parent;
    st.isPickable = false;
    out.push(st);
  }
  return out;
}
// a wooden signpost (faces yaw)
function signpost(parent, x, z, yaw, title, sub, postMat) {
  const y = parent ? himGround(x - HIM.x, z - HIM.z) : landH(x, z);
  const tx = canvasTex(
    "signT" + title,
    512,
    (ctx, W, Hh) => {
      ctx.fillStyle = "#5a3a22";
      ctx.fillRect(0, 0, W, Hh);
      ctx.strokeStyle = "#2c1b10";
      ctx.lineWidth = 8;
      ctx.strokeRect(6, 6, W - 12, Hh - 12);
      ctx.fillStyle = "#f3e7c9";
      ctx.textAlign = "center";
      ctx.font = "bold 54px Georgia, serif";
      ctx.fillText(title, W / 2, 92);
      ctx.font = "28px Georgia, serif";
      ctx.fillText(sub, W / 2, 158);
    },
    true,
    200,
  );
  const sm = new BABYLON.StandardMaterial("signM" + title, scene);
  sm.diffuseTexture = tx;
  sm.emissiveColor = new C3(0.15, 0.15, 0.15);
  const board = MB.CreatePlane("sign", { width: 3.2, height: 1.25, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
  board.position.set(x, y + 2.2, z);
  board.rotation.y = yaw;
  board.material = sm;
  board.parent = parent;
  for (const s of [-1, 1]) {
    const p = MB.CreateCylinder("signPost", { diameter: 0.14, height: 2.9, tessellation: 6 }, scene);
    p.position.set(x + Math.cos(yaw) * s * 1.45, y + 1.45, z - Math.sin(yaw) * s * 1.45);
    p.material = postMat;
    p.parent = parent;
  }
}

// A far, hazy skyline of snow peaks to the north, always ~2–3 km off (it
// moves with the camera, like the sky), so it rises behind Swayambhu's hill
// from anywhere in town. Unlit and unfogged: tinted by the time of day
// (white at noon, pink-gold alpenglow at dusk, a dark silhouette at night).
export function buildHimalayaBackdrop() {
  const NX = 170,
    NZ = 26,
    X0 = -3200,
    X1 = 3200,
    D0 = 2050,
    D1 = 3080;
  const big = [[0, 880, 950], [-1150, 640, 720], [950, 720, 820], [-2150, 560, 800], [1950, 650, 720], [2800, 500, 600], [-2850, 520, 700], [420, 470, 450], [-520, 500, 520], [1450, 420, 400], [-1650, 430, 420]];
  const crestH = (x) => {
    let h = 150;
    for (const [px, ph, w] of big) {
      const t = 1 - Math.abs(x - px) / w;
      if (t > 0) h += ph * Math.pow(t, 1.35);
    }
    return h * (0.86 + 0.28 * ridged(x / 380 + 5, 2.3, 3));
  };
  const crestD = (x) => 2750 + 160 * Math.sin(x / 640 + 1.2);
  const H = (x, d) => {
    const c = crestD(x),
      top = crestH(x);
    const prof = d < c ? sstep(D0, c, d) : 1 - 0.35 * sstep(c, D1, d);
    return -260 + (top + 260) * prof + 55 * ridged(x / 150, d / 150, 3) * sstep(D0 + 150, c, d);
  };
  const pos = [],
    col = [],
    idx = [];
  const L = new V3(0.55, 0.62, -0.3).normalize();
  for (let j = 0; j < NZ; j++) {
    const d = D0 + ((D1 - D0) * j) / (NZ - 1);
    for (let i = 0; i < NX; i++) {
      const x = X0 + ((X1 - X0) * i) / (NX - 1);
      const y = H(x, d);
      pos.push(x, y, d);
      const e = 8,
        nx = -(H(x + e, d) - H(x - e, d)) / (2 * e),
        nz = -(H(x, d + e) - H(x, d - e)) / (2 * e),
        l = Math.hypot(nx, 1, nz);
      const shade = 0.62 + 0.42 * Math.max(0, (nx * L.x + L.y + nz * L.z) / l);
      const ny = 1 / l;
      const snow = sstep(120, 260, y + 70 * perlin(x / 120, d / 120)) * sstep(0.4, 0.7, ny);
      let r = 0.36,
        g = 0.4,
        b = 0.48;
      if (y < 60) {
        const t = 1 - sstep(-120, 60, y);
        r += (0.2 - r) * t;
        g += (0.26 - g) * t;
        b += (0.33 - b) * t;
      }
      r += (0.95 - r) * snow;
      g += (0.96 - g) * snow;
      b += (1.0 - b) * snow;
      r *= shade;
      g *= shade;
      b *= shade * 0.98 + 0.02;
      // aerial haze: further rows paler and bluer
      const hz = 0.18 + 0.3 * ((d - D0) / (D1 - D0));
      col.push(r + (0.7 - r) * hz, g + (0.78 - g) * hz, b + (0.9 - b) * hz, 1);
    }
  }
  for (let j = 0; j < NZ - 1; j++)
    for (let i = 0; i < NX - 1; i++) {
      const a = j * NX + i;
      idx.push(a, a + NX, a + 1, a + 1, a + NX, a + NX + 1);
    }
  const m = new BABYLON.Mesh("himBackdrop", scene);
  const vd = new BABYLON.VertexData();
  vd.positions = pos;
  vd.colors = col;
  vd.indices = idx;
  vd.applyToMesh(m);
  backdropMat = new BABYLON.StandardMaterial("himBackdropM", scene);
  backdropMat.disableLighting = true;
  backdropMat.fogEnabled = false;
  backdropMat.backFaceCulling = false;
  backdropMat.emissiveColor = new C3(1, 1, 1);
  m.material = backdropMat;
  m.infiniteDistance = true;
  m.isPickable = false;
  backdrop = m;
  return m;
}
// called from applyTimeOfDay (f: 0 night … 1 day, warmth: golden hour)
export function tintBackdrop(f, warmth) {
  if (!backdropMat) return;
  const day = 0.08 + 0.92 * f;
  const w = warmth * (0.35 + 0.65 * f);
  backdropMat.emissiveColor.set(day * (1 + 0.08 * w), day * (1 - 0.22 * w), day * (1 - 0.32 * w));
}

// ---------------------------------------------------------------- building the range (async, behind the loading screen)
const tick = () => new Promise((r) => setTimeout(r, 0));
export async function buildHimalaya(progress) {
  if (built) return;
  root = new BABYLON.TransformNode("himalaya", scene);
  root.setEnabled(false);
  // 1) the height grid
  progress(0.02, "Raising the mountains");
  await tick();
  grid = new Float32Array(GN * GN);
  for (let j = 0; j < GN; j++) {
    const v = -GE + j * GS;
    for (let i = 0; i < GN; i++) grid[j * GN + i] = rawH(-GE + i * GS, v);
    if (j % 30 === 0) {
      progress(0.02 + (0.42 * j) / GN, "Raising the mountains");
      await tick();
    }
  }
  setHimHeight(himGround);
  // 2) the land
  progress(0.46, "Carving the glaciers");
  await tick();
  const tex = detailTex();
  const mat = new BABYLON.StandardMaterial("himTerrainM", scene);
  mat.diffuseTexture = tex;
  mat.specularColor = new C3(0.07, 0.07, 0.08);
  mat.specularPower = 24;
  ringMesh("himNear", NEAR, 0, 8, 16, mat);
  progress(0.58, "Carving the glaciers");
  await tick();
  ringMesh("himMid", MID, NEAR, 16, 80, mat);
  progress(0.66, "Shaping the far peaks");
  await tick();
  ringMesh("himFar", 7200, MID, 80, 0, mat);
  // 3) detail
  progress(0.69, "Drawing the map");
  await tick();
  bakeMap();
  progress(0.72, "Scattering the moraine");
  await tick();
  buildRocks();
  buildIce();
  buildLake();
  progress(0.8, "Pitching base camp");
  await tick();
  buildCamp();
  buildTrailhead();
  buildSummitFlag();
  // a row of snowmobiles at the east edge of camp
  spawnSnowmobiles(
    [[44, -716], [47, -709], [50, -702], [53, -695], [-46, -690]].map(([u, v]) => {
      const [x, z] = toWorld(u, v);
      return [x, z, 0.35 + rr(-0.15, 0.15)];
    }),
  );
  buildClimbers();
  progress(0.87, "Gathering the clouds");
  await tick();
  buildClouds();
  buildSnow();
  progress(0.93, "Waking the yetis");
  await tick();
  spawnRealmAnimals();
  built = true;
}

// ---------------------------------------------------------------- the trail home, and the flag on top
function buildTrailhead() {
  const stone = litMat("trailStoneM", hex("#5f5a54"), 0.05);
  const lines = [];
  for (const dv of [0, 10]) {
    const v = EXIT_L.v + 22 + dv,
      pts = [];
    for (const u of [EXIT_L.u - 12, EXIT_L.u + 12]) {
      const [x, z] = toWorld(u, v),
        y = himGround(u, v);
      const pole = MB.CreateCylinder("trailPole", { diameter: 0.14, height: 5.5, tessellation: 6 }, scene);
      pole.position.set(x, y + 2.75, z);
      pole.material = stone;
      pole.parent = root;
      pts.push(x, y + 5.3, z);
    }
    lines.push(pts);
  }
  flagMesh("trailFlags", lines, root);
  for (let k = 0; k < 6; k++) {
    const u = EXIT_L.u + (k % 2 ? 6 : -6),
      v = EXIT_L.v + 40 + k * 12,
      [x, z] = toWorld(u, v);
    cairn(root, x, himGround(u, v), z, stone);
  }
  const [sx, sz] = toWorld(EXIT_L.u + 7, EXIT_L.v + 48);
  signpost(root, sx, sz, 0, "KATHMANDU ↓", "The trail home — keep walking", stone);
}
// Nepal's flag (two crimson pennants edged in blue, the moon above, the sun
// below) on a pole on the highest point of Everest, prayer flags fanning out
// from it down onto the snow.
function buildSummitFlag() {
  const E = PEAKS[0];
  let bu = E.u,
    bv = E.v,
    bh = -1e9;
  for (let du = -40; du <= 40; du += 4)
    for (let dv = -40; dv <= 40; dv += 4) {
      const h = himGround(E.u + du, E.v + dv);
      if (h > bh) {
        bh = h;
        bu = E.u + du;
        bv = E.v + dv;
      }
    }
  const [x, z] = toWorld(bu, bv);
  const W = 256,
    Hh = 312;
  const tex = canvasTex(
    "nepalFlagT",
    W,
    (ctx) => {
      ctx.clearRect(0, 0, W, Hh);
      const shape = (k) => {
        // the double pennant, inset by k
        ctx.beginPath();
        ctx.moveTo(4 + k, 4 + k * 1.4);
        ctx.lineTo(W - 10 - k * 2.4, Hh * 0.44 - k * 0.6);
        ctx.lineTo(W * 0.36 + k * 0.3, Hh * 0.44 - k * 0.6);
        ctx.lineTo(W - 10 - k * 2.4, Hh - 4 - k);
        ctx.lineTo(4 + k, Hh - 4 - k);
        ctx.closePath();
      };
      shape(0);
      ctx.fillStyle = "#003893";
      ctx.fill();
      shape(12);
      ctx.fillStyle = "#dc143c";
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      // the moon: a white disc with a crimson bite, and its little crescent below
      const mx = W * 0.3,
        my = Hh * 0.26;
      ctx.beginPath();
      ctx.arc(mx, my, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#dc143c";
      ctx.beginPath();
      ctx.arc(mx, my - 9, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      for (let i = 0; i < 8; i++) {
        const a = Math.PI * (0.15 + (0.7 * i) / 7);
        ctx.beginPath();
        ctx.moveTo(mx + Math.cos(a) * 8, my + 4 + Math.sin(a) * 8);
        ctx.lineTo(mx + Math.cos(a - 0.2) * 15, my + 4 + Math.sin(a - 0.2) * 15);
        ctx.lineTo(mx + Math.cos(a + 0.2) * 15, my + 4 + Math.sin(a + 0.2) * 15);
        ctx.fill();
      }
      // the sun: a disc with twelve rays
      const sx = W * 0.3,
        sy = Hh * 0.74;
      ctx.beginPath();
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2,
          r = i % 2 ? 22 : 36;
        ctx.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    },
    true,
    Hh,
  );
  tex.hasAlpha = true;
  tex.wrapU = tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
  const fm = new BABYLON.StandardMaterial("nepalFlagM", scene);
  fm.diffuseTexture = tex;
  fm.emissiveColor = new C3(0.25, 0.25, 0.25);
  fm.backFaceCulling = false;
  const poleM = litMat("summitPoleM", hex("#9aa1a8"), 0.6);
  const pole = MB.CreateCylinder("summitPole", { diameter: 0.07, height: 3.6, tessellation: 8 }, scene);
  pole.position.set(x, bh + 1.8, z);
  pole.material = poleM;
  pole.parent = root;
  summitFlag = new BABYLON.TransformNode("summitFlag", scene);
  summitFlag.parent = root;
  summitFlag.position.set(x, bh + 3.55, z);
  const flag = MB.CreatePlane("nepalFlag", { width: 1.15, height: 1.4 }, scene);
  flag.parent = summitFlag;
  flag.position.set(0.6, -0.72, 0);
  flag.material = fm;
  // prayer flags from the pole down onto the snow, and a little cairn at its foot
  const lines = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3,
      u = bu + Math.sin(a) * 9,
      v = bv + Math.cos(a) * 9,
      [fx, fz] = toWorld(u, v);
    lines.push([x, bh + 3.2, z, fx, himGround(u, v) + 0.4, fz]);
  }
  flagMesh("summitFlags", lines, root);
  cairn(root, x + 0.7, bh, z + 0.5, litMat("summitStoneM", hex("#57534d"), 0.05));
}

// ---------------------------------------------------------------- moraine boulders
function thin(mesh, mats) {
  const buf = new Float32Array(mats.length * 16);
  mats.forEach((M, i) => M.copyToArray(buf, i * 16));
  mesh.thinInstanceSetBuffer("matrix", buf, 16, true);
  mesh.thinInstanceRefreshBoundingInfo(false);
  mesh.parent = root;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = false;
}
function buildRocks() {
  const rock = MB.CreateIcoSphere("himRock", { radius: 1, subdivisions: 1, flat: true }, scene);
  const rt = canvasTex(
    "himRockT",
    128,
    (ctx, S) => {
      ctx.fillStyle = "#77736e";
      ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 900; i++) {
        const v = 80 + Math.floor(R() * 90);
        ctx.fillStyle = `rgba(${v},${v - 4},${v - 8},0.6)`;
        ctx.fillRect(R() * S, R() * S, 1 + R() * 4, 1 + R() * 4);
      }
    },
    true,
  );
  const m = new BABYLON.StandardMaterial("himRockM", scene);
  m.diffuseTexture = rt;
  m.specularColor = new C3(0.05, 0.05, 0.05);
  rock.material = m;
  const mats = [];
  const q = new BABYLON.Quaternion(),
    s = new V3(),
    t = new V3();
  for (let i = 0; i < 3200 && mats.length < 2600; i++) {
    const u = rr(-1750, 1750),
      v = rr(-2500, 950);
    const h = himGround(u, v),
      alt = h - vFloor(v);
    if (alt > 220 || R() > 1 - sstep(40, 220, alt) * 0.85) continue;
    if (Math.hypot(u - CAMP.u, v - CAMP.v) < CAMP.r - 5 || polyDist(TRAIL, u, v) < 4 || Math.hypot(u - LAKE.u, v - LAKE.v) < LAKE.r + 4) continue;
    const big = R() < 0.03;
    const sz = big ? rr(3.5, 7) : 0.25 + 2.6 * Math.pow(R(), 3);
    s.set(sz * rr(0.8, 1.3), sz * rr(0.5, 0.95), sz * rr(0.8, 1.3));
    BABYLON.Quaternion.RotationYawPitchRollToRef(R() * 6.28, rr(-0.3, 0.3), rr(-0.3, 0.3), q);
    const [x, z] = toWorld(u, v);
    t.set(x, h - s.y * 0.35, z);
    mats.push(BABYLON.Matrix.Compose(s, q, t));
  }
  thin(rock, mats);
}
// the icefall's seracs and scattered blocks on the glacier
function buildIce() {
  const ice = MB.CreateIcoSphere("himSerac", { radius: 0.6, subdivisions: 1, flat: true }, scene);
  const m = new BABYLON.StandardMaterial("himIceM", scene);
  m.diffuseColor = new C3(0.78, 0.88, 0.97);
  m.emissiveColor = new C3(0.08, 0.12, 0.18);
  m.specularColor = new C3(0.55, 0.6, 0.65);
  m.specularPower = 64;
  ice.material = m;
  const mats = [],
    q = new BABYLON.Quaternion(),
    s = new V3(),
    t = new V3();
  for (let i = 0; i < 1400 && mats.length < 460; i++) {
    const v = rr(-450, 1300),
      u = rr(-260, 300);
    const vd = polyDist(VALLEY, u, v);
    const inFall = v > -60 && v < 820;
    if (vd > (inFall ? 135 : 110) || (!inFall && R() < 0.82)) continue;
    const k = inFall ? 1 : 0.6;
    s.set(rr(2.5, 7) * k, rr(4, 12) * k, rr(2.5, 6) * k);
    BABYLON.Quaternion.RotationYawPitchRollToRef(R() * 6.28, rr(-0.4, 0.4), rr(-0.4, 0.4), q);
    const h = himGround(u, v),
      [x, z] = toWorld(u, v);
    t.set(x, h + s.y * 0.25, z);
    mats.push(BABYLON.Matrix.Compose(s, q, t));
  }
  thin(ice, mats);
}
function buildLake() {
  const [x, z] = toWorld(LAKE.u, LAKE.v);
  const d = MB.CreateDisc("himLake", { radius: LAKE.r + 4, tessellation: 48 }, scene);
  d.rotation.x = Math.PI / 2;
  d.position.set(x, campLevel() - 1.0, z);
  const m = new BABYLON.StandardMaterial("himLakeM", scene);
  m.diffuseColor = new C3(0.62, 0.78, 0.88);
  m.emissiveColor = new C3(0.06, 0.1, 0.14);
  m.specularColor = new C3(0.8, 0.85, 0.9);
  m.specularPower = 90;
  d.material = m;
  d.parent = root;
}

// ---------------------------------------------------------------- base camp
function buildCamp() {
  const [cx, cz] = toWorld(CAMP.u, CAMP.v);
  const cy = campLevel();
  // dome tents: one vertex-coloured template per colour, instanced
  const tents = ["#e8742a", "#f0c330", "#c93a2e", "#2f6fc4", "#3c9a52"].map((c, i) => {
    const dome = MB.CreateSphere("t", { diameter: 2.6, segments: 12, slice: 0.5 }, scene);
    dome.scaling.set(1, 0.68, 1.3);
    const fly = MB.CreateSphere("t", { diameter: 2.75, segments: 12, slice: 0.18 }, scene);
    fly.scaling.set(1, 0.55, 1.36);
    fly.position.y = 0.1;
    const door = MB.CreateBox("t", { width: 0.9, height: 1.0, depth: 0.1 }, scene);
    door.position.set(0, 0.45, 1.66);
    const base = MB.CreateBox("t", { width: 2.7, height: 0.06, depth: 3.5 }, scene);
    base.position.y = 0.02;
    return colorTemplate("himTent" + i, [
      { mesh: dome, mat: { diffuseColor: hex(c) } },
      { mesh: fly, mat: { diffuseColor: hex(c).scale(0.78) } },
      { mesh: door, mat: { diffuseColor: hex("#2a2622") } },
      { mesh: base, mat: { diffuseColor: hex("#4a463f") } },
    ]);
  });
  const spots = [];
  for (let i = 0; i < 200 && spots.length < 22; i++) {
    const a = R() * Math.PI * 2,
      r = rr(16, CAMP.r - 10);
    const u = CAMP.u + Math.sin(a) * r,
      v = CAMP.v + Math.cos(a) * r;
    if (Math.abs(u - CAMP.u) < 7 && v < CAMP.v - 20) continue;            // keep the path from the gate clear
    if ((u > 36 && v < CAMP.v + 12 && v > CAMP.v - 24) || (u < -38 && Math.abs(v - CAMP.v - 10) < 7)) continue;   // the snowmobiles' spots
    if (spots.some(([su, sv]) => Math.hypot(su - u, sv - v) < 5.5)) continue;
    spots.push([u, v, a + Math.PI + rr(-0.5, 0.5)]);
  }
  spots.forEach(([u, v, yaw], i) => {
    const t = tents[i % tents.length].createInstance("himTentI");
    const [x, z] = toWorld(u, v);
    const y = himGround(u, v);
    t.position.set(x, y, z);
    t.rotation.y = yaw;
    t.parent = root;
    addSolidR(x, z, yaw, 1.3, 1.7, y - 0.5, y + 1.7);
  });
  // the mess tent: a long yellow ridge tent
  {
    const u = CAMP.u + 30,
      v = CAMP.v + 22,
      [x, z] = toWorld(u, v),
      y = himGround(u, v);
    const body = MB.CreateBox("himMess", { width: 4.2, height: 1.4, depth: 8 }, scene);
    body.position.set(x, y + 0.7, z);
    const roof = MB.CreateCylinder("himMessRoof", { diameter: 4.9, height: 8, tessellation: 3 }, scene);
    roof.rotation.set(Math.PI / 2, 0, Math.PI);
    roof.scaling.set(1, 1, 0.55);
    roof.position.set(x, y + 1.9, z);
    const m = litMat("himMessM", hex("#e6b92c"), 0.05);
    body.material = roof.material = m;
    body.parent = roof.parent = root;
    addSolidR(x, z, 0, 2.2, 4.1, y - 0.5, y + 3);
  }
  // the puja chorten at the heart of camp, its pole hung with prayer flags
  const stone = litMat("himChortenM", hex("#e9e4d8"), 0.05),
    dark = litMat("himStoneM", hex("#57534d"), 0.05),
    gold = litMat("himGoldM", hex("#c99a2e"), 0.6);
  gold.emissiveColor = hex("#3a2a08");
  const add = (mesh, y, mat) => {
    mesh.position.set(cx, cy + y, cz);
    mesh.material = mat;
    mesh.parent = root;
    return mesh;
  };
  add(MB.CreateBox("ch1", { width: 4.6, height: 0.8, depth: 4.6 }, scene), 0.4, dark);
  add(MB.CreateBox("ch2", { width: 3.4, height: 0.9, depth: 3.4 }, scene), 1.25, stone);
  add(MB.CreateBox("ch3", { width: 2.5, height: 0.7, depth: 2.5 }, scene), 2.05, stone);
  add(MB.CreateSphere("ch4", { diameter: 2.2, segments: 14, slice: 0.6 }, scene), 2.4, stone);
  add(MB.CreateCylinder("ch5", { diameterTop: 0.15, diameterBottom: 0.7, height: 1.8, tessellation: 10 }, scene), 4.2, gold);
  add(MB.CreateCylinder("chPole", { diameter: 0.16, height: 9, tessellation: 6 }, scene), 4.5, dark);
  addSolidR(cx, cz, 0, 2.3, 2.3, cy - 1, cy + 3.2);
  const lines = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2,
      u = CAMP.u + Math.sin(a) * 24,
      v = CAMP.v + Math.cos(a) * 24;
    const [x, z] = toWorld(u, v);
    lines.push([cx, cy + 8.9, cz, x, himGround(u, v) + 1.2, z]);
    // a cairn where each line is tied down
    for (let k = 0; k < 4; k++) {
      const st = MB.CreateBox("cairn", { width: 0.9 - k * 0.18, height: 0.32, depth: 0.8 - k * 0.15 }, scene);
      st.position.set(x, himGround(u, v) + 0.16 + k * 0.3, z);
      st.rotation.y = R() * 3;
      st.material = dark;
      st.parent = root;
    }
  }
  // strings across camp between the tents
  for (let i = 0; i < 6; i++) {
    const a = R() * 6.28,
      b = a + rr(1.2, 2.4);
    const u1 = CAMP.u + Math.sin(a) * 50,
      v1 = CAMP.v + Math.cos(a) * 50,
      u2 = CAMP.u + Math.sin(b) * 50,
      v2 = CAMP.v + Math.cos(b) * 50;
    const [x1, z1] = toWorld(u1, v1),
      [x2, z2] = toWorld(u2, v2);
    lines.push([x1, himGround(u1, v1) + 3.2, z1, x2, himGround(u2, v2) + 3.2, z2]);
  }
  flagMesh("himFlags", lines, root);
  // a mani wall: carved stones stacked along the path in from the gate
  for (const s of [-1, 1]) {
    const u = CAMP.u + s * 6,
      v = CAMP.v - 40,
      [x, z] = toWorld(u, v),
      y = himGround(u, v);
    const w = MB.CreateBox("maniWall", { width: 1.3, height: 1.1, depth: 14 }, scene);
    w.position.set(x, y + 0.5, z);
    w.material = dark;
    w.parent = root;
    addSolidR(x, z, 0, 0.65, 7, y - 0.5, y + 1.1);
    for (let k = 0; k < 9; k++) {
      const st = MB.CreateBox("mani", { width: 0.9, height: 0.12, depth: 1.2 }, scene);
      st.position.set(x, y + 1.13, z - 6 + k * 1.5);
      st.rotation.y = rr(-0.2, 0.2);
      st.material = k % 2 ? stone : dark;
      st.parent = root;
    }
  }
  // a campfire (glows at night)
  {
    const u = CAMP.u - 14,
      v = CAMP.v + 8,
      [x, z] = toWorld(u, v),
      y = himGround(u, v);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2,
        st = MB.CreateBox("fireStone", { width: 0.4, height: 0.3, depth: 0.4 }, scene);
      st.position.set(x + Math.sin(a) * 0.9, y + 0.15, z + Math.cos(a) * 0.9);
      st.material = dark;
      st.parent = root;
    }
    const logM = litMat("himLogM", hex("#3a2616"), 0.05);
    for (let k = 0; k < 3; k++) {
      const lg = MB.CreateCylinder("log", { diameter: 0.18, height: 1.2, tessellation: 6 }, scene);
      lg.position.set(x, y + 0.25, z);
      lg.rotation.set(Math.PI / 2 - 0.35, (k / 3) * Math.PI * 2, 0);
      lg.material = logM;
      lg.parent = root;
    }
    const flameTex = radialTex("himFlameT", [
      [0, "rgba(255,240,180,1)"],
      [0.3, "rgba(255,170,60,0.9)"],
      [0.65, "rgba(230,80,20,0.4)"],
      [1, "rgba(200,40,10,0)"],
    ]);
    const fm = new BABYLON.StandardMaterial("himFlameM", scene);
    fm.disableLighting = true;
    fm.emissiveTexture = flameTex;
    fm.opacityTexture = flameTex;
    fm.disableDepthWrite = true;
    const fl = MB.CreatePlane("himFlame", { width: 1.2, height: 1.6 }, scene);
    fl.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
    fl.position.set(x, y + 0.85, z);
    fl.material = fm;
    fl.parent = root;
    glow.addIncludedOnlyMesh(fl);
    fire = fl;
  }
  // the sign
  {
    const u = CAMP.u + 7,
      v = CAMP.v - 52,
      [x, z] = toWorld(u, v),
      y = himGround(u, v);
    const tx = canvasTex(
      "himSignT",
      512,
      (ctx, W, Hh) => {
        ctx.fillStyle = "#5a3a22";
        ctx.fillRect(0, 0, W, Hh);
        ctx.strokeStyle = "#2c1b10";
        ctx.lineWidth = 8;
        ctx.strokeRect(6, 6, W - 12, Hh - 12);
        ctx.fillStyle = "#f3e7c9";
        ctx.textAlign = "center";
        ctx.font = "bold 46px Georgia, serif";
        ctx.fillText("EVEREST BASE CAMP", W / 2, 78);
        ctx.font = "bold 40px Georgia, serif";
        ctx.fillText("5,364 m", W / 2, 140);
        ctx.font = "26px Georgia, serif";
        ctx.fillText("Sagarmatha National Park", W / 2, 196);
      },
      true,
      230,
    );
    const sm = new BABYLON.StandardMaterial("himSignM", scene);
    sm.diffuseTexture = tx;
    sm.emissiveColor = new C3(0.15, 0.15, 0.15);
    const board = MB.CreatePlane("himSign", { width: 3.2, height: 1.45, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
    board.position.set(x, y + 2.1, z);   // (faces the gate: you read it as you arrive)
    board.material = sm;
    board.parent = root;
    const postM = litMat("himPostM", hex("#3d2a1a"), 0.05);
    for (const s of [-1, 1]) {
      const p = MB.CreateCylinder("himSignPost", { diameter: 0.14, height: 2.9, tessellation: 6 }, scene);
      p.position.set(x + s * 1.45, y + 1.45, z);
      p.material = postM;
      p.parent = root;
    }
  }
}


// ---------------------------------------------------------------- expeditions
// Roped teams in bright down suits (helmet, goggles, a big pack, an ice axe)
// trudging single file up the routes: Everest by the icefall, the Western Cwm
// and the summit ridge; Lhotse's face; Pumori. They walk slowly, stop to
// rest now and then, raise their arms on the summit, and come back down; the
// rope between them is drawn each frame. (Only while you're up here.)
const ROUTES = {
  everest: [[18, -640], [-40, -250], [-95, 250], [-10, 650], [120, 1150], [260, 1600], [300, 1950], [230, 2200], [150, 2350]],
  lhotse: [[30, -640], [-40, -250], [-95, 250], [-10, 650], [120, 1150], [520, 1350], [800, 1520], [1050, 1650]],
  pumori: [[-40, -660], [-380, -480], [-760, -160], [-1060, 160], [-1250, 330], [-1350, 430]],
};
const SUITS = ["#d7262e", "#f2c12e", "#ef6c1a", "#2f6fd1"];
const teams = [];
let climberT = null;
function climberTemplates() {
  const C = (h) => ({ diffuseColor: hex(h) });
  const S = (d, s, p, c) => {
    const m = MB.CreateSphere("cl", { diameter: d, segments: 8 }, scene);
    m.scaling.set(...s);
    m.position.set(...p);
    return { mesh: m, mat: C(c) };
  };
  const B = (w, h, d, p, c, r = [0, 0, 0]) => {
    const m = MB.CreateBox("cl", { width: w, height: h, depth: d }, scene);
    m.position.set(...p);
    m.rotation.set(...r);
    return { mesh: m, mat: C(c) };
  };
  const Y = (dt, db, h, p, c, r = [0, 0, 0]) => {
    const m = MB.CreateCylinder("cl", { diameterTop: dt, diameterBottom: db, height: h, tessellation: 8 }, scene);
    m.position.set(...p);
    m.rotation.set(...r);
    return { mesh: m, mat: C(c) };
  };
  return SUITS.map((suit, i) => {
    const dark = "#20232a",
      pack = ["#2b3a55", "#3a3f2a", "#552b2b", "#2a4a3a"][i];
    return {
      body: colorTemplate("climberBody" + i, [
        S(1, [0.54, 0.64, 0.4], [0, 1.25, 0], suit),
        S(1, [0.44, 0.32, 0.34], [0, 0.98, 0], suit),
        S(1, [0.36, 0.14, 0.32], [0, 1.52, 0.02], suit),                  // fur-trimmed collar
        B(0.42, 0.62, 0.28, [0, 1.32, -0.28], pack),                       // pack
        Y(0.16, 0.16, 0.46, [0, 1.68, -0.28], "#c9c2b0", [0, 0, Math.PI / 2]),   // sleeping mat
        Y(0.11, 0.11, 0.3, [0.12, 1.15, -0.44], "#d0d4d8", [0.15, 0, 0]),  // oxygen bottle
        S(0.24, [1, 1, 1], [0, 1.68, 0.03], "#c08a66"),                     // face
        S(1, [0.3, 0.25, 0.31], [0, 1.76, 0], i % 2 ? "#f4f4f0" : "#e8742a"),   // helmet
        B(0.22, 0.07, 0.06, [0, 1.69, 0.13], "#111318"),                  // goggles
        B(0.12, 0.08, 0.06, [0, 1.6, 0.13], "#3a3d44"),                   // oxygen mask
      ]),
      leg: colorTemplate("climberLeg" + i, [
        Y(0.17, 0.15, 0.8, [0, -0.4, 0], suit),
        B(0.17, 0.16, 0.32, [0, -0.86, 0.05], i % 2 ? "#e8c22c" : dark),   // boots
      ]),
      arm: colorTemplate("climberArm" + i, [Y(0.13, 0.11, 0.62, [0, -0.31, 0], suit), S(0.13, [1, 1, 1], [0, -0.64, 0], dark)]),
      axe: colorTemplate("climberAxe" + i, [
        Y(0.13, 0.11, 0.62, [0, -0.31, 0], suit),
        S(0.13, [1, 1, 1], [0, -0.64, 0], dark),
        Y(0.03, 0.03, 0.72, [0, -0.62, 0.22], "#5a5f66", [1.25, 0, 0]),
        B(0.04, 0.05, 0.3, [0, -0.5, 0.56], "#8a9098", [0.2, 0, 0]),
      ]),
    };
  });
}
function routePts(list) {
  const pts = [];
  let L = 0;
  for (let i = 0; i < list.length; i++) {
    const [u, v] = list[i];
    if (i) L += Math.hypot(u - list[i - 1][0], v - list[i - 1][1]);
    pts.push({ u, v, L });
  }
  return { pts, len: L };
}
function routeAt(r, s) {
  s = clamp(s, 0, r.len);
  const P = r.pts;
  let i = 1;
  while (i < P.length - 1 && P[i].L < s) i++;
  const a = P[i - 1],
    b = P[i],
    t = (s - a.L) / Math.max(1e-6, b.L - a.L);
  return { u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t, du: b.u - a.u, dv: b.v - a.v };
}
function buildClimbers() {
  if (!climberT) climberT = climberTemplates();
  const plan = [
    ["everest", 4, 0.18, 1],
    ["everest", 5, 0.55, 1],
    ["everest", 3, 0.82, -1],
    ["lhotse", 4, 0.62, 1],
    ["pumori", 3, 0.4, 1],
  ];
  let n = 0;
  for (const [route, size, at, dir] of plan) {
    const r = routePts(ROUTES[route]);
    const members = [];
    for (let k = 0; k < size; k++) {
      const T = climberT[(n++ + k) % climberT.length];
      const node = new BABYLON.TransformNode("climber", scene);
      node.parent = root;
      const body = T.body.createInstance("clb");
      body.parent = node;
      const legs = [-1, 1].map((sx) => {
        const l = T.leg.createInstance("cll");
        l.parent = node;
        l.position.set(sx * 0.12, 0.95, 0);
        return l;
      });
      const arms = [-1, 1].map((sx) => {
        const a = (sx > 0 ? T.axe : T.arm).createInstance("cla");
        a.parent = node;
        a.position.set(sx * 0.3, 1.46, 0);
        a.rotation.z = sx * 0.12;
        return a;
      });
      members.push({ node, legs, arms, phase: rr(0, 6) });
    }
    const rope = BABYLON.MeshBuilder.CreateLines("climbRope", { points: members.map(() => new V3()), updatable: true }, scene);
    rope.color = new C3(0.95, 0.45, 0.1);
    rope.parent = root;
    rope.isPickable = false;
    teams.push({ r, members, rope, s: r.len * at, dir, speed: rr(0.55, 0.8), rest: 0, restIn: rr(30, 90), summit: 0, ropePts: members.map(() => new V3()) });
  }
}
const GAP = 3.4; // metres of rope between climbers
function updateClimbers(dt) {
  for (const T of teams) {
    // walk on, rest a while every minute or so; on top: celebrate, then down
    if (T.summit > 0) T.summit -= dt;
    else if (T.rest > 0) T.rest -= dt;
    else {
      T.s += T.dir * T.speed * dt;
      if ((T.restIn -= dt) <= 0) {
        T.rest = rr(5, 12);
        T.restIn = rr(40, 110);
      }
      const lead = (T.members.length - 1) * GAP;
      if (T.dir > 0 && T.s >= T.r.len) {
        T.s = T.r.len;
        T.dir = -1;
        T.summit = 14;
      } else if (T.dir < 0 && T.s <= lead) {
        T.s = lead;
        T.dir = 1;
        T.rest = 25;                       // back at camp: a long breather, then up again
      }
    }
    const moving = T.summit <= 0 && T.rest <= 0;
    T.members.forEach((m, k) => {
      // the leader goes first (up or down), the rest follow along the rope
      const s = T.dir > 0 ? T.s - k * GAP : T.s + k * GAP;
      const p = routeAt(T.r, s);
      const [x, z] = toWorld(p.u, p.v);
      const y = himGround(p.u, p.v);
      const head = Math.atan2(p.du, p.dv) + (T.dir < 0 ? Math.PI : 0);
      const fx = Math.sin(head),
        fz = Math.cos(head);
      const slope = (himGround(p.u + fx * 1.5, p.v + fz * 1.5) - himGround(p.u - fx * 1.5, p.v - fz * 1.5)) / 3;
      m.node.position.set(x, y, z);
      m.node.rotation.y = head;
      m.node.rotation.x = clamp(slope * 0.5, -0.25, 0.6) * (moving ? 1 : 0.4);    // lean into the climb
      if (moving) m.phase += dt * T.speed * 4.2;
      const sw = moving ? Math.sin(m.phase) : 0;
      m.legs[0].rotation.x = sw * 0.42;
      m.legs[1].rotation.x = -sw * 0.42;
      if (T.summit > 0) {
        // on top of the world
        const wave = Math.sin(performance.now() / 260 + k) * 0.25;
        m.arms[0].rotation.x = -2.8 + wave;
        m.arms[1].rotation.x = -2.8 - wave;
      } else if (moving) {
        m.arms[0].rotation.x = -sw * 0.35 - 0.15;
        m.arms[1].rotation.x = sw * 0.3 - 0.45;     // the axe hand, planting it ahead
      } else {
        m.arms[0].rotation.x = -0.1;
        m.arms[1].rotation.x = -0.6;               // leaning on the axe
      }
      T.ropePts[k].set(x, y + 1.0, z);
    });
    BABYLON.MeshBuilder.CreateLines(null, { points: T.ropePts, instance: T.rope });
  }
}

// ---------------------------------------------------------------- clouds round the peaks, the summit plume, falling snow
function buildClouds() {
  const mats = [17, 61, 133].map((s, i) => {
    const t = cloudTexture("himCloudT" + i, s);
    const m = new BABYLON.StandardMaterial("himCloudM" + i, scene);
    m.disableLighting = true;
    m.emissiveTexture = t;
    m.opacityTexture = t;
    m.backFaceCulling = false;
    m.disableDepthWrite = true;
    return m;
  });
  for (let i = 0; i < 28; i++) {
    const a = R() * Math.PI * 2,
      d = rr(1800, 5600);
    const u = Math.sin(a) * d,
      v = 600 + Math.cos(a) * d;
    const w = rr(700, 1500);
    const c = MB.CreatePlane("himCloud", { width: w, height: w * 0.42 }, scene);
    c.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    c.material = mats[i % 3];
    const [x, z] = toWorld(u, v);
    c.position.set(x, rr(650, 1250), z);
    c.parent = root;
    c.isPickable = false;
    clouds.push({ m: c, u, v, sp: rr(4, 9) });
  }
  // the plume streaming off the summit
  const E = PEAKS[0],
    top = rawH(E.u, E.v);
  for (let i = 0; i < 5; i++) {
    const c = MB.CreatePlane("himPlume", { width: 380 + i * 120, height: 120 + i * 25 }, scene);
    c.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    c.material = mats[i % 3];
    const [x, z] = toWorld(E.u + 160 + i * 230, E.v - 60 - i * 40);
    c.position.set(x, top - 40 - i * 45, z);
    c.visibility = 0.85 - i * 0.12;
    c.parent = root;
    c.isPickable = false;
  }
}
function buildSnow() {
  const tex = radialTex("himSnowT", [
    [0, "rgba(255,255,255,1)"],
    [0.4, "rgba(255,255,255,0.85)"],
    [1, "rgba(255,255,255,0)"],
  ], 32);
  const ps = new BABYLON.ParticleSystem("himSnow", 1400, scene);
  ps.particleTexture = tex;
  ps.emitter = new V3(HIM.x, 0, HIM.z);
  ps.minEmitBox = new V3(-42, 0, -42);
  ps.maxEmitBox = new V3(42, 4, 42);
  ps.color1 = new BABYLON.Color4(1, 1, 1, 0.9);
  ps.color2 = new BABYLON.Color4(0.92, 0.95, 1, 0.75);
  ps.colorDead = new BABYLON.Color4(1, 1, 1, 0);
  ps.minSize = 0.05;
  ps.maxSize = 0.14;
  ps.minLifeTime = 6;
  ps.maxLifeTime = 9;
  ps.emitRate = 230;
  ps.direction1 = new V3(0.6, -1.6, -0.3);
  ps.direction2 = new V3(1.8, -2.2, 0.4);
  ps.minEmitPower = 1;
  ps.maxEmitPower = 1.6;
  ps.gravity = new V3(0.15, -0.4, 0);
  ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
  snowPS = ps;
}

// ---------------------------------------------------------------- going there and back
// → where you arrive (world coordinates)
export function enterHimalaya() {
  root.setEnabled(true);
  if (backdrop) backdrop.setEnabled(false);
  if (snowPS) snowPS.start();
  const [x, z] = toWorld(ARRIVE_L.u, ARRIVE_L.v);
  return { x, z, yaw: 0 };
}
export function leaveHimalaya() {
  if (root) root.setEnabled(false);
  if (backdrop) backdrop.setEnabled(true);
  if (snowPS) snowPS.stop();
  return { x: WORLD_GATE.x, z: WORLD_GATE.z - 45, yaw: Math.PI };
}
// walked far enough up the pass ("enter") / into the trail home ("leave")?
export function himTrigger(x, z, inRealm) {
  // (the very top of the map, anywhere across the pass — on foot or on wheels)
  if (!inRealm) return z > WORLD.z1 - 9 && Math.abs(x - NPASS.x) < NPASS.half - 60 ? "enter" : null;
  const [ex, ez] = toWorld(EXIT_L.u, EXIT_L.v);
  return Math.hypot(x - ex, z - ez) < 10 || (z < ez && Math.abs(x - ex) < 45) ? "leave" : null;
}
// height above sea level for the HUD (base camp = 5,364 m)
// (scaled so base camp reads 5,364 m and Everest's summit exactly 8,848 m)
let altK = null;
export function altitudeAt(y) {
  if (altK === null && grid) altK = (8848 - 5364) / (himGround(PEAKS[0].u, PEAKS[0].v) - campLevel());
  return Math.round(5364 + (y - campLevel()) * (altK ?? 1.24));
}
// sky / fog / light up here (called from applyTimeOfDay while you're in the range)
export function himAtmosphere(f, warmth) {
  const L = (a, b, t) => new C3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
  let sky = L([0.02, 0.03, 0.08], [0.3, 0.5, 0.85], f);
  let haze = L([0.05, 0.07, 0.13], [0.74, 0.81, 0.9], f);
  const w = warmth * (0.3 + 0.7 * f);
  sky = L([sky.r, sky.g, sky.b], [0.95, 0.6, 0.48], w * 0.45);
  haze = L([haze.r, haze.g, haze.b], [0.98, 0.7, 0.58], w * 0.6);
  scene.clearColor = new BABYLON.Color4(sky.r, sky.g, sky.b, 1);
  scene.fogColor = haze;
  scene.fogStart = 600 + 600 * f;
  scene.fogEnd = 4800 + 2800 * f;
  hemi.groundColor = L([0.1, 0.11, 0.16], [0.72, 0.76, 0.84], f);     // light thrown back up off the snow
}
// per frame
let t0 = 0;
export function updateHimalaya(dt, cam, inRealm) {
  t0 += dt;
  if (!inRealm || !built) return;
  if (summitFlag) {
    // flapping in the jet stream
    summitFlag.rotation.y = 1.2 + Math.sin(t0 * 2.3) * 0.22 + Math.sin(t0 * 5.1) * 0.08;
    summitFlag.scaling.x = 0.92 + 0.08 * Math.sin(t0 * 7.3);
  }
  updateClimbers(dt);
  if (snowPS) snowPS.emitter.set(cam.position.x - 8, cam.position.y + 16, cam.position.z);
  for (const c of clouds) {
    c.u += c.sp * dt;
    const [x, z] = toWorld(c.u, c.v);
    c.m.position.x = x;
    c.m.position.z = z;
    if (c.u > 7000) c.u = -7000;
  }
  if (fire) {
    const k = 0.85 + 0.25 * Math.sin(t0 * 13) * Math.sin(t0 * 7.3);
    fire.scaling.set(k, 0.9 + 0.3 * Math.sin(t0 * 9.1), 1);
  }
}

// ---------------------------------------------------------------- the loading screen
let ov = null;
export function showRealmLoading(title, sub) {
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "himLoading";
    ov.innerHTML = `
<style>
#himLoading{position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:linear-gradient(#0b1630 0%,#2a4a7a 55%,#9fb6d4 100%);color:#fff;font-family:system-ui,-apple-system,Segoe UI,sans-serif;
  opacity:0;transition:opacity .35s;pointer-events:none}
#himLoading.on{opacity:1;pointer-events:auto}
#himLoading svg{position:absolute;left:0;right:0;bottom:0;width:100%;height:46%}
#himLoading .t{position:relative;font-size:46px;font-weight:800;letter-spacing:.32em;text-shadow:0 2px 14px rgba(0,0,0,.4)}
#himLoading .s{position:relative;margin-top:10px;font-size:15px;letter-spacing:.14em;opacity:.85}
#himLoading .b{position:relative;margin-top:34px;width:320px;height:6px;border-radius:3px;background:rgba(255,255,255,.22);overflow:hidden}
#himLoading .b i{display:block;height:100%;width:0;background:#fff;border-radius:3px;transition:width .2s}
#himLoading .l{position:relative;margin-top:12px;font-size:12px;letter-spacing:.18em;opacity:.75;text-transform:uppercase}
</style>
<svg viewBox="0 0 1000 300" preserveAspectRatio="none">
  <path d="M0 300 L0 210 L80 170 L140 190 L230 110 L290 150 L360 90 L420 130 L470 40 L520 100 L560 80 L640 150 L700 120 L780 170 L860 130 L930 180 L1000 150 L1000 300Z" fill="#e8eef6" opacity=".9"/>
  <path d="M0 300 L0 240 L120 200 L200 230 L300 180 L380 220 L470 150 L560 210 L650 190 L760 230 L860 200 L1000 230 L1000 300Z" fill="#5f7898"/>
  <path d="M0 300 L0 270 L160 250 L320 268 L500 240 L680 262 L840 250 L1000 265 L1000 300Z" fill="#2b3d57"/>
</svg>
<div class="t"></div><div class="s"></div><div class="b"><i></i></div><div class="l"></div>`;
    document.body.appendChild(ov);
  }
  ov.querySelector(".t").textContent = title;
  ov.querySelector(".s").textContent = sub;
  setRealmProgress(0, "");
  requestAnimationFrame(() => ov.classList.add("on"));
}
export function setRealmProgress(p, label) {
  if (!ov) return;
  ov.querySelector(".b i").style.width = Math.round(clamp(p, 0, 1) * 100) + "%";
  if (label !== undefined) ov.querySelector(".l").textContent = label;
}
export function hideRealmLoading() {
  if (ov) ov.classList.remove("on");
}
