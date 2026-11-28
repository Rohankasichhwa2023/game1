// water.js — the sea. Each district is an island; everything between them is
// open water, and the only way across (on land) is over a bridge: every road
// that used to cross the open ground between districts now runs over the
// water on an arched deck. London's river runs out to the sea at both ends.
//
//   landSdf(x, z)   signed distance to the coast (< 0 on land, > 0 at sea),
//                   with a gently wandering shoreline
//   seaAt(x, z)     open sea (not land)
//   deckAt(x, z)    height of a bridge deck over the water here (0 = none)
//   bridgeSpans     the over-water stretches of every road (for bridges.js)
import { KTM } from "./kathmandu.js";
import { inHimBox } from "./realm.js";

// ---------------------------------------------------------------- islands
// (kept as plain numbers: roads.js / london.js import the engine, and the
// engine needs this module first)
const PARIS = { x: -560, z: 0, R: 368 };
const ISLANDS = [
  { kind: "box", x0: -150, x1: 722, z0: -566, z1: 566, r: 26 },                      // Midtown
  { kind: "box", x0: 758, x1: 1600, z0: -600, z1: 600, r: 30 },                      // London
  { kind: "box", x0: KTM.x0 - 70, x1: KTM.x1 + 70, z0: KTM.z0, z1: KTM.z1 + 640, r: 60 }, // Kathmandu + its hillside + Swayambhu
  { kind: "box", x0: 190 - 700, x1: 190 + 700, z0: 1600, z1: 3600, r: 80 },                 // the pass north to the Himalayas (terrain.js NORTH)
];
function sdBox(x, z, b) {
  // rounded rectangle
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const hx = (b.x1 - b.x0) / 2 - b.r, hz = (b.z1 - b.z0) / 2 - b.r;
  const dx = Math.abs(x - cx) - hx, dz = Math.abs(z - cz) - hz;
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0) - b.r;
}
// smooth wobble so the coast isn't ruler-straight (± ~4.5 m)
const wobble = (x, z) => 2.6 * Math.sin(x / 47 + Math.cos(z / 83) * 1.7) + 1.9 * Math.sin(z / 37 + x / 151);
export function landSdf(x, z) {
  return landSdfSmooth(x, z) + wobble(x, z);
}
// The same without the wandering shoreline: a smooth field for shaping the
// hills down to the sea (the wobble's tight bends made the slopes lumpy).
export function landSdfSmooth(x, z) {
  if (x < -4000 && inHimBox(x, z)) return -500;     // the Himalayas: all land
  let d = Math.hypot(x - PARIS.x, z - PARIS.z) - PARIS.R;
  for (const b of ISLANDS) d = Math.min(d, sdBox(x, z, b));
  return d;
}
export const seaAt = (x, z) => landSdf(x, z) > 0;
// the area the coastline meshes cover (the world plus a margin of sea)
export const SEA_BOX = { x0: -1100, x1: 1700, z0: -700, z1: 1960 };

// ---------------------------------------------------------------- bridges
// Every road is walked in 2 m steps; runs of samples over the sea become a
// bridge span. The deck eases up off the shore (no kink where it leaves the
// land), climbs at up to ~16 % and levels off at 6 m, so boats fit under all
// but the shortest bridges.
const STEP = 2, DECK_MAX = 6, DECK_RAMP = 55;
const deckProfile = (dShore) => {
  const t = Math.min(1, Math.max(0, dShore / DECK_RAMP));
  return DECK_MAX * t * t * (3 - 2 * t);
};
export const bridgeSpans = [];      // { e, s0, s1, pts: [{ x, z, s, h, tx, tz }], hw }
const BG = 16, bgrid = new Map();
const bkey = (ix, iz) => (ix + 4000) * 16384 + (iz + 4000);
let built = false;

// Called once the road graph exists (before anything is built on it).
export function buildBridges(edges, pathAt) {
  if (built) return;
  built = true;
  for (const e of edges) {
    const n = Math.max(2, Math.ceil(e.len / STEP));
    const S = [];
    for (let i = 0; i <= n; i++) {
      const s = (e.len * i) / n, q = pathAt(e, s, {});
      S.push({ s, x: q.x, z: q.z, tx: q.tx, tz: q.tz, wet: seaAt(q.x, q.z) });
    }
    if (!S.some((p) => p.wet)) continue;
    // contiguous wet runs, each grown by one sample of land at either end
    for (let i = 0; i < S.length; i++) {
      if (!S[i].wet) continue;
      let j = i;
      while (j + 1 < S.length && S[j + 1].wet) j++;
      const a = Math.max(0, i - 1), b = Math.min(S.length - 1, j + 1);
      const pts = S.slice(a, b + 1).map((p) => ({ ...p }));
      // distance along the road to the nearest shore (either end of the run)
      const sa = S[i].s, sb = S[j].s;
      // (the two shore ramps multiplied: a rounded crest on short bridges,
      // not a sharp peak where the nearer shore switches sides)
      for (const p of pts) {
        p.h = p.wet ? (DECK_MAX * deckProfile(p.s - sa + STEP / 2) * deckProfile(sb - p.s + STEP / 2)) / (DECK_MAX * DECK_MAX) : 0;
      }
      const span = { e, s0: pts[0].s, s1: pts[pts.length - 1].s, pts, hw: e.w / 2 + e.sw + 0.6 };
      bridgeSpans.push(span);
      for (let k = 0; k < pts.length - 1; k++) {
        const p = pts[k], q = pts[k + 1], m = span.hw + 1;
        for (let ix = Math.floor((Math.min(p.x, q.x) - m) / BG); ix <= Math.floor((Math.max(p.x, q.x) + m) / BG); ix++) {
          for (let iz = Math.floor((Math.min(p.z, q.z) - m) / BG); iz <= Math.floor((Math.max(p.z, q.z) + m) / BG); iz++) {
            const key = bkey(ix, iz);
            let c = bgrid.get(key);
            if (!c) bgrid.set(key, (c = []));
            c.push({ span, k });
          }
        }
      }
      i = j;
    }
  }
}
// Deck height at (x, z). Within one bridge, the segment nearest the point
// decides (neighbouring segments' corridors overlap; taking the highest of
// them turned the smooth ramp into a staircase). Where two bridges overlap,
// the higher deck wins.
const nearest = new Map();
export function deckAt(x, z) {
  const c = bgrid.get(bkey(Math.floor(x / BG), Math.floor(z / BG)));
  if (!c) return 0;
  nearest.clear();
  for (const { span, k } of c) {
    const p = span.pts[k], q = span.pts[k + 1];
    const dx = q.x - p.x, dz = q.z - p.z, l2 = dx * dx + dz * dz || 1;
    const t = Math.min(1, Math.max(0, ((x - p.x) * dx + (z - p.z) * dz) / l2));
    const d = Math.hypot(x - (p.x + dx * t), z - (p.z + dz * t));
    if (d > span.hw) continue;
    const prev = nearest.get(span);
    if (!prev || d < prev.d) nearest.set(span, { d, h: p.h + (q.h - p.h) * t });
  }
  let best = 0;
  for (const v of nearest.values()) if (v.h > best) best = v.h;
  return best;
}
// On a bridge's deck corridor at all (even where the deck is still ~0 at the shore)?
export function onBridge(x, z) {
  const c = bgrid.get(bkey(Math.floor(x / BG), Math.floor(z / BG)));
  if (!c) return false;
  for (const { span, k } of c) {
    const p = span.pts[k], q = span.pts[k + 1];
    const dx = q.x - p.x, dz = q.z - p.z, l2 = dx * dx + dz * dz || 1;
    const t = Math.min(1, Math.max(0, ((x - p.x) * dx + (z - p.z) * dz) / l2));
    if (Math.hypot(x - (p.x + dx * t), z - (p.z + dz * t)) <= span.hw) return true;
  }
  return false;
}
