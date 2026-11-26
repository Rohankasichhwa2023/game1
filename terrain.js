// terrain.js — ground height. The world is flat (y = 0) everywhere except
// Kathmandu, which sits on a hillside: level at its southern gates (where the
// Midtown avenues come in), rising steadily northwards to ~30 m at the top of
// town, with gentle rolling bumps on top so streets run up and down. Around
// the district the hills ease back down to the flat parkland. The temple
// squares and Durbar Square are levelled into flat terraces.
//
// Everything that stands on the ground asks terrainH(x, z): road ribbons and
// the ground mesh are draped over it, buildings / lamps / trees are lifted to
// it, and the player, cars and people walk and drive on it.
import { KTM } from "./kathmandu.js";
import { landSdfSmooth, deckAt } from "./water.js";

const RISE = 30;          // height at the north edge of town
const SOUTH_FLAT = 30;    // the first metres inside the south edge stay level
const SIDE = 110;         // west / east: hills ease out over this many metres
const NORTH = 720;        // north: past the top of town the ridge carries on to Swayambhu's hill, then falls to the sea
const BX0 = KTM.x0 - SIDE, BX1 = KTM.x1 + SIDE, BZ0 = KTM.z0, BZ1 = KTM.z1 + NORTH;
export const TERRAIN_BOX = { x0: BX0, x1: BX1, z0: BZ0, z1: BZ1 };

const sstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function raw(x, z) {
  // steady rise to the north
  const u = (z - KTM.z0 - SOUTH_FLAT) / (KTM.z1 - KTM.z0 - SOUTH_FLAT);
  const base = RISE * sstep(0, 1.12, u) * 1.03;
  // rolling hills on top (fade in away from the flat southern gates)
  const bumps = 2.4 * Math.sin(x / 53 + 0.7) * Math.cos(z / 61 - 0.4)
    + 1.2 * Math.sin((x * 0.6 - z * 0.8) / 34 + 1.9);
  const h = base + bumps * sstep(KTM.z0 + 20, KTM.z0 + 170, z);
  // Kathmandu is an island: the hill comes down to sea level at the shore,
  // over a long, smooth fall (sharp bends here showed as ground poking
  // through the roads, and jolted cars and the camera)
  const coast = sstep(0, 130, -landSdfSmooth(x, z));
  return Math.max(0, h * coast);
}

// ---------------------------------------------------------------- Swayambhu
// A big forested hill north of the town with the great stupa on its flat
// summit: a smooth dome (steepest half-way up) with lumps in the forest.
//   R0: the flat summit's radius   RB: where the hill meets the ridge
//   RW: the wall round its foot     H: how much it rises     hw: stair half-width
export const SWAY = { x: 190, z: 1430, R0: 40, RB: 270, RW: 278, H: 150, hw: 2.6 };
// The stairways: a maze of flights climbing in every direction round the
// hill. Only "main" reaches the summit (south → west → north → east, then
// up); the nine branches wander off and stop at a wall. Waypoints are
// [compass degrees from the centre (0 = north, 180 = the gate side), radius].
const ROUTES = {
  main: [[180, 262], [155, 232], [200, 206], [240, 184], [212, 160], [250, 140], [288, 122], [318, 104], [348, 88], [22, 76], [58, 64], [95, 55], [128, 47], [150, 39]],
  b2: [[240, 184], [262, 210], [278, 236]],
  b3: [[288, 122], [310, 150], [335, 172], [358, 190]],
  b4: [[212, 160], [178, 172], [150, 182]],
  b5: [[318, 104], [290, 92], [262, 86], [236, 92]],
  b6: [[348, 88], [8, 100], [32, 110], [55, 118]],
  b7: [[58, 64], [75, 90], [95, 112], [120, 128]],
  b8: [[22, 76], [40, 52], [65, 44]],
  b9: [[155, 232], [128, 246], [102, 252]],
  b10: [[95, 55], [110, 80], [140, 96], [165, 110]],
};
export const SWAY_ROUTES = [];   // { name, pts: [{ x, z, h }] }
export const SWAY_SEGS = [];     // { ax, az, ah, bx, bz, bh, len, ux, uz, route, i }
let swayTop = null;
function swaySetup() {
  if (swayTop !== null) return;
  swayTop = raw(SWAY.x, SWAY.z) + SWAY.H;
  // a waypoint's height: the smooth hill there (the summit's, at the top)
  const smoothH = (x, z) => {
    const r = Math.hypot(x - SWAY.x, z - SWAY.z);
    return r <= SWAY.R0 ? swayTop : raw(x, z) + SWAY.H * (1 - sstep(SWAY.R0, SWAY.RB, r));
  };
  for (const [name, list] of Object.entries(ROUTES)) {
    const pts = list.map(([deg, r]) => {
      const a = (deg * Math.PI) / 180, x = SWAY.x + Math.sin(a) * r, z = SWAY.z + Math.cos(a) * r;
      return { x, z, h: smoothH(x, z) };
    });
    SWAY_ROUTES.push({ name, pts });
    for (let i = 0; i < pts.length - 1; i++) {
      const A = pts[i], B = pts[i + 1], len = Math.hypot(B.x - A.x, B.z - A.z);
      SWAY_SEGS.push({ ax: A.x, az: A.z, ah: A.h, bx: B.x, bz: B.z, bh: B.h, len, ux: (B.x - A.x) / len, uz: (B.z - A.z) / len, route: name, i });
    }
  }
}
// The nearest stairway to (x, z): { d (metres off its centre line), h (its height there), seg, t (0..1 along it) }
export function swayPath(x, z) {
  swaySetup();
  let best = null, bd = Infinity;
  for (const s of SWAY_SEGS) {
    const px = x - s.ax, pz = z - s.az;
    const t = Math.max(0, Math.min(s.len, px * s.ux + pz * s.uz));
    const d = Math.hypot(px - s.ux * t, pz - s.uz * t);
    if (d < bd) { bd = d; best = { d, h: s.ah + (s.bh - s.ah) * (t / s.len), seg: s, t: t / s.len }; }
  }
  return best;
}
// the hill's height (before the stairways are cut in)
function swayNatural(x, z) {
  const h = raw(x, z);
  const r = Math.hypot(x - SWAY.x, z - SWAY.z);
  if (r >= SWAY.RB) return h;
  const rise = SWAY.H * (1 - sstep(SWAY.R0, SWAY.RB, r));
  const lumps = (2.6 * Math.sin(x / 17 + 1.3) * Math.cos(z / 21) + 1.6 * Math.sin((x + z) / 11))
    * sstep(SWAY.R0 + 6, SWAY.R0 + 30, r) * (1 - sstep(SWAY.RB - 30, SWAY.RB, r));
  return h + rise + lumps;
}
// Heights over the hill, worked out once on a 1 m grid: the natural hill,
// a flat-across shelf cut along every stairway, the flat summit.
let grid = null;
const G = { x0: 0, z0: 0, n: 0 };
function swayGrid() {
  swaySetup();
  const ext = SWAY.RB + 4;
  G.x0 = SWAY.x - ext; G.z0 = SWAY.z - ext; G.n = Math.ceil(ext * 2) + 2;
  grid = new Float32Array(G.n * G.n);
  const hw = SWAY.hw;
  for (let j = 0; j < G.n; j++) for (let i = 0; i < G.n; i++) {
    const x = G.x0 + i, z = G.z0 + j;
    let h = swayNatural(x, z);
    const p = swayPath(x, z);
    if (p && p.d < hw + 6) h += (p.h - h) * (1 - sstep(hw + 0.7, hw + 6, p.d));
    const r = Math.hypot(x - SWAY.x, z - SWAY.z);
    const summit = 1 - sstep(SWAY.R0 - 3, SWAY.R0 + 2, r);
    grid[j * G.n + i] = h + (swayTop - h) * summit;
  }
}
function swayHeight(x, z) {
  if (!grid) swayGrid();
  const fx = x - G.x0, fz = z - G.z0, i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= G.n - 1 || j >= G.n - 1) return raw(x, z);
  const tx = fx - i, tz = fz - j, k = j * G.n + i;
  const a = grid[k] + (grid[k + 1] - grid[k]) * tx, b = grid[k + G.n] + (grid[k + G.n + 1] - grid[k + G.n]) * tx;
  return a + (b - a) * tz;
}

// levelled terraces: { x, z, r, R, h } — flat within r, blending out to r + R
const flats = [];
export function addTerrainFlat(x, z, r, R = 30) {
  flats.push({ x, z, r, R, h: landH(x, z) });
}

// The walkable surface: the land, or a bridge deck over the water.
export function terrainH(x, z) {
  const d = deckAt(x, z);
  return d > 0 ? Math.max(d, landH(x, z)) : landH(x, z);
}
// The same, for something at height y: under a bridge you're on the water,
// not on the deck above you.
export function groundAt(x, z, y) {
  const d = deckAt(x, z), g = landH(x, z);
  if (d > g && y >= d - 1.6) return d;
  return g;
}
// The bare land (no bridges): for ground meshes, the camera, trees.
export function landH(x, z) {
  if (x <= BX0 || x >= BX1 || z <= BZ0 || z >= BZ1) return 0;
  const sx = x - SWAY.x, sz = z - SWAY.z;
  let h = sx * sx + sz * sz < (SWAY.RB + 1) * (SWAY.RB + 1) ? swayHeight(x, z) : raw(x, z);
  for (const f of flats) {
    const d = Math.hypot(x - f.x, z - f.z);
    if (d >= f.r + f.R) continue;
    const w = 1 - sstep(f.r, f.r + f.R, d);
    h += (f.h - h) * w;
  }
  return h;
}
// Slope (rise per metre) along the unit direction (dx, dz).
export function terrainSlope(x, z, dx, dz) {
  // flat everywhere except Kathmandu's hills and the bridge ramps
  if ((x <= BX0 - 2 || x >= BX1 + 2 || z <= BZ0 - 2 || z >= BZ1 + 2) && !deckAt(x, z) && !deckAt(x + dx, z + dz) && !deckAt(x - dx, z - dz)) return 0;
  return (terrainH(x + dx, z + dz) - terrainH(x - dx, z - dz)) / 2;
}
