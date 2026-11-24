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
const NORTH = 200;        // north: past the top of town the ridge falls away again
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
  let h = raw(x, z);
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
